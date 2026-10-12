// ゲーム全体のまとめ役。フィールド・会話・ギミック・戦闘・周回・メニュー・登録画面の切替と、各システムの接続を担う。
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { GameData } from '../data/registry';
import type { Action, RunSegment } from '../data/schema';
import { EventBus } from '../core/EventBus';
import { KeyboardInput } from '../core/Input';
import { World } from '../world/World';
import { ThirdPersonCamera } from '../world/ThirdPersonCamera';
import { PlayerController, PartnerController, Pawn } from '../actors/Controllers';
import { CharacterInstance } from '../character/CharacterInstance';
import { CharacterLoader } from '../character/CharacterLoader';
import { CharacterRepository } from '../character/CharacterRepository';
import { GameState } from './GameState';
import { QuestSystem } from '../quest/QuestSystem';
import { SaveManager } from '../save/SaveManager';
import { storageEstimate } from '../save/db';
import { getProgress, pickRunEvent } from '../learning/Learning';
import { BattleSystem, type AllyInit } from '../battle/BattleSystem';
import { BattleView } from '../battle/BattleView';
import { rollDrops, mergeDrops, type Drop } from '../inventory/Drops';
import { WorldOverlay } from '../ui/WorldOverlay';
import { Hud } from '../ui/Hud';
import { DialogueUI } from '../ui/DialogueUI';
import { PuzzleUI } from '../ui/PuzzleUI';
import { MenuUI } from '../ui/MenuUI';
import { CraftUI } from '../ui/CraftUI';
import { ResultUI } from '../ui/ResultUI';
import { ExamUI } from '../ui/ExamUI';
import { RegistryScreen } from '../registry/RegistryScreen';
import { h } from '../ui/dom';

type Mode = 'field' | 'dialogue' | 'puzzle' | 'battle' | 'menu' | 'craft' | 'result' | 'exam' | 'registry' | 'busy';

interface NpcActor { id: string; name: string; pawn: Pawn; color: Color3; facing: number }

interface RunState {
  questId: string;
  segments: RunSegment[];
  index: number;
  elapsedMs: number;
  drops: Drop[];
  exp: number;
  levelBefore: number;
  damageTaken: number;
  focusBlasts: number;
  focusDistributed: number;
  eventId: string;
  eventTriggered: boolean;
}

interface BattleCtx {
  sys: BattleSystem;
  segIndex: number;
  center: [number, number];
  boss: boolean;
  endTimer: number;
  exp: number;
}

const DEFAULT_NAMES = { hero: 'アルト', partner: 'リナ' };
const INTERACT_RANGE = 2.6;
const ENCOUNTER_RANGE = 8.5;

export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly bus = new EventBus();
  readonly gs: GameState;
  private world: World;
  private cam: ThirdPersonCamera;
  private input = new KeyboardInput();
  private player: PlayerController;
  private partner: PartnerController;
  private loader: CharacterLoader;
  private quests: QuestSystem;
  private npcs: NpcActor[] = [];
  private overlay: WorldOverlay;
  private hud: Hud;
  private dialogueUI: DialogueUI;
  private puzzleUI: PuzzleUI;
  private menuUI: MenuUI;
  private craftUI: CraftUI;
  private resultUI: ResultUI;
  private examUI: ExamUI;
  private registry: RegistryScreen;
  private battleView: BattleView;
  private mode: Mode = 'field';
  private queue: (() => Promise<void> | void)[] = [];
  private interactCooldown = 0;
  private hintCooldowns = new Map<string, number>();
  private autosaveTimer = 0;
  private hudTimer = 0;
  private run: RunState | null = null;
  private battle: BattleCtx | null = null;
  private partnerHp = -1;
  private names = { ...DEFAULT_NAMES };
  private appearanceNames = { hero: '仮の人形', partner: '仮の人形' };
  private lastSkillLevels = new Map<string, number>();
  private frameErrorLogged = false;
  private runBeacon: Mesh | null = null;

  constructor(private canvas: HTMLCanvasElement, ui: HTMLElement, readonly data: GameData, private saves: SaveManager, save: GameState['save']) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, powerPreference: 'high-performance' }, false);
    // 高DPI端末でも描画解像度を抑える（スマホ想定）
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new Scene(this.engine);
    this.gs = new GameState(save, data, this.bus);
    this.world = new World(this.scene, data.map);
    this.cam = new ThirdPersonCamera(this.scene, canvas);
    this.player = new PlayerController(this.world, this.cam, this.input);
    this.partner = new PartnerController(this.world, this.player);
    this.loader = new CharacterLoader(this.scene);
    this.overlay = new WorldOverlay(ui, this.scene);
    this.hud = new Hud(ui);
    this.dialogueUI = new DialogueUI(ui);
    this.puzzleUI = new PuzzleUI(ui);
    this.menuUI = new MenuUI(ui);
    this.craftUI = new CraftUI(ui);
    this.resultUI = new ResultUI(ui);
    this.examUI = new ExamUI(ui);
    this.battleView = new BattleView(this.scene, this.world.shadows, this.overlay);
    this.battleView.getAllyPos = (id) => this.allyPawn(id)?.character?.position ?? null;
    this.quests = new QuestSystem(this.gs, (a) => this.runActions(a));
    this.registry = new RegistryScreen(this.engine, ui, {
      activeIds: () => ({ hero: this.gs.save.party.heroAppearanceId, partner: this.gs.save.party.partnerAppearanceId, npcs: this.gs.save.party.npcAppearances }),
      npcList: data.map.npcs.map((n) => ({ id: n.id, name: n.name })),
      setActive: (role, id) => { if (role === 'hero') this.gs.save.party.heroAppearanceId = id; else this.gs.save.party.partnerAppearanceId = id; },
      setNpcAppearance: (npc, id) => { if (id) this.gs.save.party.npcAppearances[npc] = id; else delete this.gs.save.party.npcAppearances[npc]; },
      onClose: (changed) => void this.closeRegistry(changed),
    });

    this.hud.menuButton.onclick = () => this.openMenu();
    this.hud.onSkillClick = (id) => this.useSkill(id);
    this.puzzleUI.onHint = (t) => this.hint(t);
    this.puzzleUI.onAttempt = (def, o) => {
      this.gs.recordKnowledge({ knowledgeId: def.knowledgeId, kind: 'application', variant: def.variant, correct: o.success && o.balance > 0.15 });
    };
    this.subscribe();
    for (const id of data.skills.keys()) this.lastSkillLevels.set(id, this.gs.effectiveSkillLevel(id));
    window.addEventListener('resize', () => this.engine.resize());
  }

  // ---------- 起動 ----------
  async start() {
    const s = this.gs.save;
    this.player.pawn.place(s.position.x, s.position.z, s.position.facing);
    this.buildNpcs();
    await this.loadAppearances();
    this.partner.teleportBehindLeader();
    this.cam.snapTo(this.player.pawn.character!.position);
    this.cam.camera.alpha = -Math.PI / 2 - s.position.facing;
    this.buildSigns();
    this.world.setCrowdVisible(!s.flags[this.data.map.crowd.hideWhenFlag]);
    this.partnerHp = this.gs.partnerStats().hp;
    this.quests.checkConditions();
    this.engine.runRenderLoop(() => {
      try {
        this.frame();
      } catch (e) {
        // 1フレームの失敗で全体を止めない
        if (!this.frameErrorLogged) { console.error('frame error', e); this.frameErrorLogged = true; }
      }
    });
    // 最初の一言
    if (this.gs.quest('inn-trouble').state === 'inactive') {
      setTimeout(() => this.hud.say(this.names.partner, 'ここがルクスの町かぁ。広場に町長さんがいるみたい。話しかけてみよう！', 5), 800);
    }
  }

  private buildNpcs() {
    for (const n of this.data.map.npcs) {
      const pawn = new Pawn();
      const actor: NpcActor = { id: n.id, name: n.name, pawn, color: new Color3(...n.color), facing: n.facing };
      pawn.place(n.pos[0], n.pos[1], n.facing);
      this.npcs.push(actor);
      this.overlay.set(`npc:${n.id}`, h('div', { class: 'wlabel-name', text: n.name }), () => pawn.character ? pawn.character.position.add(new Vector3(0, pawn.character.height + 0.35, 0)) : null, 16);
    }
  }

  private buildSigns() {
    for (const b of this.data.map.buildings) {
      if (!b.label) continue;
      this.overlay.set(`sign:${b.id}`, h('div', { class: 'wlabel-sign', text: b.label }), () => new Vector3(b.pos[0], b.size[1] + 2.4, b.pos[1]), 55);
    }
    for (const it of this.data.map.interactables) {
      this.overlay.set(`obj:${it.id}`, h('div', { class: 'wlabel-name', text: it.label }), () => new Vector3(it.pos[0], 2.9, it.pos[1]), 16);
    }
    this.overlay.set('marker', h('div', { class: 'wlabel-marker', text: '▼' }), () => {
      const m = this.currentMarker();
      return m ? new Vector3(m[0], 3.6, m[1]) : null;
    }, 200);
  }

  /** 登録キャラクターを読み込み、主人公・パートナー・NPCの見た目に反映する */
  private async loadAppearances() {
    const party = this.gs.save.party;
    const make = async (id: string | null, color: Color3, name: string) => {
      const def = id ? await CharacterRepository.get(id).catch(() => undefined) : undefined;
      const container = def ? await this.loader.load(def.modelAssetId) : null;
      if (def && !container) this.hud.toast(`「${def.name}」のモデルを読み込めなかったため、仮の姿で表示します`, 'bad', 4);
      const inst = CharacterInstance.create(this.scene, def ?? null, container, { placeholderColor: color, name });
      for (const m of inst.root.getChildMeshes()) { this.world.shadows.addShadowCaster(m); m.isPickable = false; }
      return { inst, def };
    };
    const swap = (pawn: Pawn, inst: CharacterInstance) => {
      pawn.character?.dispose();
      pawn.character = inst;
      inst.setPosition(pawn.x, pawn.z);
      inst.setFacing(pawn.facing);
    };
    const hero = await make(party.heroAppearanceId, new Color3(0.2, 0.42, 0.85), 'hero');
    swap(this.player.pawn, hero.inst);
    this.names.hero = hero.def?.name ?? DEFAULT_NAMES.hero;
    this.appearanceNames.hero = hero.def?.name ?? '仮の人形';
    const partner = await make(party.partnerAppearanceId, new Color3(0.9, 0.5, 0.18), 'partner');
    swap(this.partner.pawn, partner.inst);
    this.names.partner = partner.def?.name ?? DEFAULT_NAMES.partner;
    this.appearanceNames.partner = partner.def?.name ?? '仮の人形';
    for (const npc of this.npcs) {
      const r = await make(party.npcAppearances[npc.id] ?? null, npc.color, `npc-${npc.id}`);
      swap(npc.pawn, r.inst);
    }
  }

  private subscribe() {
    this.bus.on('progress', (p) => this.quests.onProgress(p.event, p.id));
    this.bus.on('flagChanged', ({ flag }) => {
      this.quests.checkConditions();
      if (flag === this.data.map.crowd.hideWhenFlag) this.world.setCrowdVisible(false);
    });
    this.bus.on('questChanged', () => this.requestSave());
    this.bus.on('levelUp', (e) => {
      const rows = Object.entries(e.diff).filter(([, [a, b]]) => b !== a)
        .map(([k, [a, b]]) => [this.data.progression.statLabels[k] ?? k, `${a} → ${b}`, `+${b - a}`] as [string, string, string]);
      this.hud.banner(`LEVEL UP!  Lv ${e.to}`, rows);
      this.partnerHp = this.gs.partnerStats().hp;
    });
    this.bus.on('itemGained', (e) => this.hud.toast(`${this.gs.itemName(e.itemId)} ×${e.count} を手に入れた${e.rare ? '！ ★レア★' : ''}`, e.rare ? 'rare' : 'normal', e.rare ? 3.5 : 2.2));
    this.bus.on('skillUnlocked', (e) => {
      const sk = this.data.skills.get(e.skillId);
      if (sk) this.hud.banner(`新しい技：${sk.nameJa}`, [['使い方', `[${sk.key}]キー`, sk.type === 'reaction' ? '敵の大技の予兆中に' : '']]);
      this.lastSkillLevels.set(e.skillId, this.gs.effectiveSkillLevel(e.skillId));
    });
    // 習熟度そのものは見せない。技の冴え（実効レベル）の変化だけをRPGとして伝える
    this.bus.on('masteryChanged', () => {
      for (const [id, sk] of this.data.skills) {
        const now = this.gs.effectiveSkillLevel(id);
        const before = this.lastSkillLevels.get(id) ?? now;
        if (now > before) this.hud.toast(`${sk.nameJa}の冴えが戻った！ Lv${now}`, 'good', 3);
        if (now < before) this.hud.toast(`${sk.nameJa}の調子が落ちた… Lv${now}（正しい場面で使えば戻る）`, 'bad', 3.5);
        this.lastSkillLevels.set(id, now);
      }
    });
  }

  // ---------- メインループ ----------
  private frame(forcedDt?: number) {
    const dt = forcedDt ?? Math.min(0.05, this.engine.getDeltaTime() / 1000);
    if (this.mode === 'registry') {
      this.registry.render();
      return;
    }
    this.gs.save.playTimeMs += dt * 1000;
    const actions = this.input.consumeActions();
    this.interactCooldown = Math.max(0, this.interactCooldown - dt);
    for (const k of this.hintCooldowns.keys()) this.hintCooldowns.set(k, this.hintCooldowns.get(k)! - dt);

    if (actions.has('menu') && (this.mode === 'field')) this.openMenu();
    else if (actions.has('cancel') || actions.has('menu')) this.closeOverlays();

    const canMove = this.mode === 'field';
    if (this.mode === 'battle') this.updateBattle(dt, actions);
    else this.player.update(dt, canMove);
    if (this.mode !== 'battle') this.partner.update(dt);
    for (const n of this.npcs) n.pawn.sync(dt);
    this.battleView.update(dt);
    this.puzzleUI.tick(dt);

    if (this.mode === 'field') {
      this.updateInteraction(actions);
      if (this.run) this.updateRun(dt);
      this.autosaveTimer += dt;
      if (this.autosaveTimer > 30) this.requestSave();
      if (this.queue.length) void this.processQueue();
    }
    if (this.runBeacon) this.runBeacon.rotation.y += dt;

    this.cam.follow(this.player.pawn.character!.position, dt);
    this.hud.tick(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.1; this.updateHud(); }
    this.scene.render();
    this.overlay.update();
  }

  private updateHud() {
    const s = this.gs.save;
    const hs = this.gs.heroStats();
    const ps = this.gs.partnerStats();
    const b = this.battle?.sys;
    const heroC = b?.hero(), partnerC = b?.partner();
    this.hud.updateParty({
      heroName: this.names.hero, partnerName: this.names.partner, level: s.player.level,
      hp: heroC ? heroC.hp : s.player.hp, maxHp: hs.hp,
      exp: s.player.exp, expNext: s.player.level >= this.data.progression.maxLevel ? 0 : this.gs.expToNext(s.player.level),
      partnerHp: partnerC ? partnerC.hp : this.partnerHp, partnerMaxHp: ps.hp,
      nodes: b ? b.combatants.filter((c) => c.kind === 'node').map((c) => ({ hp: c.hp, maxHp: c.maxHp })) : [],
    });
    const p = this.player.pawn;
    const area = this.world.areaAt(p.x, p.z)?.label ?? '街道';
    if (this.run) {
      const seg = this.run.segments[this.run.index];
      const q = this.data.quests.get(this.run.questId)!;
      this.hud.updateQuest(area, q.title, seg ? `▶ ${seg.label}（${this.run.index + 1}/${this.run.segments.length}）` : '', this.run.elapsedMs);
    } else {
      const obj = this.quests.objective();
      this.hud.updateQuest(area, obj?.title ?? null, obj ? this.resolve(obj.step) : null, null);
    }
    this.hud.setFieldHelpVisible(this.mode === 'field' && s.playTimeMs < 10 * 60 * 1000);
    if (this.battle) this.hud.showSkills(this.skillViews());
    else this.hud.showSkills(null);
  }

  private currentMarker(): [number, number] | null {
    if (this.run) return this.run.segments[this.run.index]?.pos ?? null;
    return this.quests.objective()?.marker ?? null;
  }

  // ---------- 調べる・話す ----------
  private updateInteraction(actions: Set<string>) {
    const p = this.player.pawn;
    let best: { kind: 'npc' | 'obj'; id: string; label: string; d: number } | null = null;
    for (const n of this.npcs) {
      const d = Math.hypot(n.pawn.x - p.x, n.pawn.z - p.z);
      if (d < INTERACT_RANGE && (!best || d < best.d)) best = { kind: 'npc', id: n.id, label: `${n.name}と話す`, d };
    }
    for (const it of this.data.map.interactables) {
      const d = Math.hypot(it.pos[0] - p.x, it.pos[1] - p.z);
      if (d < it.radius && (!best || d < best.d)) best = { kind: 'obj', id: it.id, label: `${it.label}を調べる`, d };
    }
    this.hud.setPrompt(best && !this.run ? best.label : best?.label ?? null);
    if (best && actions.has('interact') && this.interactCooldown <= 0) {
      if (best.kind === 'npc') {
        const npc = this.npcs.find((n) => n.id === best!.id)!;
        npc.pawn.facing = Math.atan2(p.x - npc.pawn.x, p.z - npc.pawn.z);
        p.facing = Math.atan2(npc.pawn.x - p.x, npc.pawn.z - p.z);
        const def = this.data.map.npcs.find((n) => n.id === best!.id)!;
        const sel = def.dialogues.find((d) => this.gs.check(d.when));
        if (sel) void this.talk(sel.dialogueId, () => { npc.pawn.facing = npc.facing; });
      } else {
        const def = this.data.map.interactables.find((i) => i.id === best!.id)!;
        const sel = def.dialogues.find((d) => this.gs.check(d.when));
        if (sel) void this.talk(sel.dialogueId);
      }
    }
  }

  private resolve(text: string) {
    return text.replaceAll('{hero}', this.names.hero).replaceAll('{partner}', this.names.partner);
  }

  async talk(dialogueId: string, after?: () => void) {
    const def = this.data.dialogues.get(dialogueId);
    if (!def) return;
    this.mode = 'dialogue';
    this.hud.setPrompt(null);
    await this.dialogueUI.play(def, { resolve: (t) => this.resolve(t), runActions: (a) => this.runActions(a) });
    after?.();
    this.mode = 'field';
    this.interactCooldown = 0.35;
    this.requestSave();
  }

  /** データに書かれたアクションを実行。画面遷移を伴うものは会話の後に順番に実行する */
  runActions(actions: Action[] | undefined) {
    if (!actions) return;
    for (const a of actions) {
      if (a.setFlag) this.gs.setFlag(a.setFlag);
      if (a.recordKnowledge) this.gs.recordKnowledge(a.recordKnowledge);
      if (a.learnFormalTerm) this.gs.learnFormalTerm(a.learnFormalTerm);
      if (a.unlockSkill) this.gs.unlockSkill(a.unlockSkill);
      if (a.giveItem) this.gs.addItem(a.giveItem.itemId, a.giveItem.count);
      if (a.healParty) this.healParty();
      if (a.startQuest) this.quests.start(a.startQuest);
      if (a.emit) this.bus.emit('progress', a.emit);
      if (a.partnerSay) this.hud.say(this.names.partner, this.resolve(a.partnerSay));
      if (a.startDialogue) { const id = a.startDialogue; this.queue.push(() => this.talk(id)); }
      if (a.startGimmick) { const id = a.startGimmick; this.queue.push(async () => { await this.startGimmick(id); }); }
      if (a.startRun) { const id = a.startRun; this.queue.push(() => this.startRun(id)); }
      if (a.openCraft) this.queue.push(() => this.openCraft());
      if (a.openExam) { const id = a.openExam; this.queue.push(() => this.openExam(id)); }
    }
  }

  private async processQueue() {
    while (this.queue.length && this.mode === 'field') {
      const job = this.queue.shift()!;
      await job();
    }
  }

  private healParty() {
    this.gs.save.player.hp = this.gs.heroStats().hp;
    this.partnerHp = this.gs.partnerStats().hp;
  }

  // ---------- ヒント（パートナー） ----------
  private hint(trigger: string) {
    const prio = getProgress(this.gs.save, 'load-balancing').reviewPriority;
    for (const hd of this.data.hints) {
      if (hd.trigger !== trigger) continue;
      if (!this.gs.check(hd.when)) continue;
      if (hd.minReviewPriority !== undefined && prio < hd.minReviewPriority) continue;
      if ((this.hintCooldowns.get(hd.id) ?? 0) > 0) continue;
      this.hintCooldowns.set(hd.id, hd.cooldownSec);
      this.hud.say(this.names.partner, this.resolve(hd.lines[Math.floor(Math.random() * hd.lines.length)]));
      return;
    }
  }

  // ---------- ギミック ----------
  private async startGimmick(id: string): Promise<boolean> {
    const def = this.data.gimmicks.get(id);
    if (!def) return false;
    this.mode = 'puzzle';
    this.hud.setPrompt(null);
    this.gs.recordKnowledge({ knowledgeId: def.knowledgeId, kind: 'experience', variant: def.variant, correct: true });
    const outcome = await this.puzzleUI.open(def);
    this.mode = 'field';
    this.interactCooldown = 0.35;
    if (outcome.success) this.runActions(def.onSuccess);
    this.requestSave();
    return outcome.success;
  }

  // ---------- 周回クエスト ----------
  private async startRun(questId: string) {
    const q = this.data.quests.get(questId);
    if (!q?.run) return;
    this.endRunCleanup();
    const pool = q.run.segments.flatMap((s) => s.eventPool ?? []).map((id) => this.data.gimmicks.get(id)!).map((g) => ({ id: g.id, knowledgeId: g.knowledgeId, variant: g.variant }));
    const eventId = pool.length ? pickRunEvent(this.gs.save, pool) : '';
    this.run = {
      questId, segments: q.run.segments, index: 0, elapsedMs: 0, drops: [], exp: 0, levelBefore: this.gs.save.player.level,
      damageTaken: 0, focusBlasts: 0, focusDistributed: 0, eventId, eventTriggered: false,
    };
    q.run.segments.forEach((seg, i) => {
      if (seg.groupId) this.battleView.spawnGroup(`seg${i}`, this.data.encounters[seg.groupId].map((e) => this.data.enemies.get(e)!), seg.pos);
    });
    this.healParty();
    const gate = this.data.map.returnPoint;
    this.player.pawn.place(gate[0], gate[1] + 6, 0);
    this.player.clearTrail();
    this.partner.teleportBehindLeader();
    this.cam.camera.alpha = -Math.PI / 2;
    this.placeBeacon();
    this.hud.banner(q.title);
    this.hint('run:start');
    this.requestSave();
  }

  private placeBeacon() {
    this.runBeacon?.dispose();
    this.runBeacon = null;
    const seg = this.run?.segments[this.run.index];
    if (!seg || seg.type !== 'event') return;
    const b = MeshBuilder.CreateCylinder('beacon', { height: 0.2, diameter: 3, tessellation: 6 }, this.scene);
    const m = new StandardMaterial('beacon-m', this.scene);
    m.diffuseColor = new Color3(1, 0.85, 0.4);
    m.emissiveColor = new Color3(0.8, 0.6, 0.2);
    m.alpha = 0.6;
    b.material = m;
    b.position.set(seg.pos[0], 0.1, seg.pos[1]);
    this.runBeacon = b;
  }

  private updateRun(dt: number) {
    const run = this.run!;
    run.elapsedMs += dt * 1000;
    const seg = run.segments[run.index];
    const p = this.player.pawn;
    if (!seg) return;
    // 町へ戻ったら中断
    if (p.z < this.data.map.returnPoint[1] - 2) {
      this.hud.toast('交易路の防衛を中断して町へ戻った', 'bad');
      this.endRunCleanup();
      return;
    }
    if (seg.type === 'event') {
      if (!run.eventTriggered && Math.hypot(seg.pos[0] - p.x, seg.pos[1] - p.z) < 3.5) {
        run.eventTriggered = true;
        const id = run.eventId;
        this.queue.push(async () => {
          await this.startGimmick(id);
          if (this.run) { this.run.index++; this.placeBeacon(); }
        });
      }
    } else if (this.battleView.nearestGroup(`seg${run.index}-`, p.x, p.z) < ENCOUNTER_RANGE) {
      this.startBattle(run.index, seg);
    }
  }

  private endRunCleanup() {
    this.run = null;
    this.battleView.clearAllEnemies();
    this.runBeacon?.dispose();
    this.runBeacon = null;
  }

  // ---------- 戦闘 ----------
  private allyPawn(id: string): Pawn | null {
    if (id === 'hero') return this.player.pawn;
    if (id === 'partner') return this.partner.pawn;
    return null;
  }

  private startBattle(segIndex: number, seg: RunSegment) {
    const hs = this.gs.heroStats(), ps = this.gs.partnerStats();
    const allies: AllyInit[] = [
      { id: 'hero', kind: 'hero', name: this.names.hero, maxHp: hs.hp, hp: Math.max(1, this.gs.save.player.hp), atk: hs.atk, def: hs.def, attackInterval: 1.0 },
      { id: 'partner', kind: 'partner', name: this.names.partner, maxHp: ps.hp, hp: Math.max(1, this.partnerHp), atk: ps.atk, def: ps.def, attackInterval: 1.25 },
    ];
    const nodes = this.gs.distributionNodes();
    for (let i = 0; i < nodes.count; i++) allies.push({ id: `node-${i}`, kind: 'node', name: '分散ノード', maxHp: nodes.hp, hp: nodes.hp, atk: 0, def: nodes.def, attackInterval: 99 });
    const enemies = [...this.battleView.enemies.values()].filter((v) => v.id.startsWith(`seg${segIndex}-`)).map((v) => ({ id: v.id, def: v.def }));
    const skills = [...this.data.skills.values()].map((def) => ({ def, level: this.gs.effectiveSkillLevel(def.id) }));
    const sys = new BattleSystem({
      allies, enemies, skills, damage: this.data.progression.damage,
      onKnowledge: (ev) => this.gs.recordKnowledge(ev),
    });
    this.battle = { sys, segIndex, center: seg.pos, boss: seg.type === 'boss', endTimer: -1, exp: 0 };
    this.battleView.begin(sys, seg.pos);
    this.mode = 'battle';
    this.hud.setPrompt(null);
  }

  private skillViews() {
    const b = this.battle?.sys;
    return [...this.data.skills.values()].map((sk) => {
      const eff = this.gs.effectiveSkillLevel(sk.id);
      const owned = this.gs.ownedSkillLevel(sk.id);
      const charging = !!b?.enemies().some((e) => e.charging?.behavior.action === 'focusBlast');
      return {
        id: sk.id, key: sk.key, name: sk.nameJa,
        levelText: eff > 0 ? (sk.levels.length > 1 ? `Lv${eff} ${sk.levels.find((l) => l.level === eff)?.label ?? ''}` : '') : '未習得',
        levelDown: eff < owned, locked: eff === 0,
        cooldown: b?.cooldown(sk.id) ?? 0, cooldownTotal: b?.cooldownTotal(sk.id) ?? 1,
        highlight: sk.effect === 'distribute' && charging,
      };
    });
  }

  private useSkill(id: string) {
    if (!this.battle) return;
    this.battle.sys.useSkill(id);
  }

  private updateBattle(dt: number, actions: Set<string>) {
    const ctx = this.battle!;
    const sys = ctx.sys;
    const keyMap: Record<string, string> = {};
    for (const sk of this.data.skills.values()) keyMap[`skill${sk.key}`] = sk.id;
    for (const a of actions) if (keyMap[a]) this.useSkill(keyMap[a]);
    if (actions.has('interact')) {
      // 対象切替
      const list = sys.enemies();
      const idx = list.findIndex((e) => e.id === sys.targetId);
      if (list.length) sys.setTarget(list[(idx + 1) % list.length].id);
    }
    if (this.run) this.run.elapsedMs += dt * 1000;
    sys.tick(dt);
    const events = sys.drainEvents();
    this.battleView.handle(sys, events, (id) => this.onEnemyDefeated(id));
    for (const ev of events) {
      if (ev.type === 'attack' && (ev.sourceId === 'hero' || ev.sourceId === 'partner')) this.allyPawn(ev.sourceId)?.character?.playAction('attack');
      if (ev.type === 'hint') this.hint(ev.trigger);
      if (ev.type === 'notice') this.hud.toast(ev.text, ev.tone === 'good' ? 'good' : ev.tone === 'bad' ? 'bad' : 'normal', 2);
      if (ev.type === 'skill') { if (ev.ok) this.hud.flashSkill(ev.skillId); else if (ev.reason) this.hud.toast(ev.reason, 'bad', 1.2); }
      if (ev.type === 'end') ctx.endTimer = 1.3;
    }
    // 味方を陣形の位置へ寄せ、敵の方を向かせる
    const target = sys.get(sys.targetId) ?? sys.enemies()[0];
    const tv = target ? this.battleView.enemies.get(target.id) : null;
    for (const id of ['hero', 'partner']) {
      const pawn = this.allyPawn(id)!;
      const slot = this.battleView.allySlots.get(id)!;
      const c = sys.get(id)!;
      const dx = slot.x - pawn.x, dz = slot.z - pawn.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const step = Math.min(d, 6.5 * dt);
        pawn.x += (dx / d) * step;
        pawn.z += (dz / d) * step;
        pawn.speed = step / dt;
        pawn.facing = Math.atan2(dx, dz);
      } else {
        pawn.speed = 0;
        if (tv) pawn.facing = Math.atan2(tv.root.position.x - pawn.x, tv.root.position.z - pawn.z);
      }
      pawn.sync(dt);
      pawn.character?.root.setEnabled(true);
      if (pawn.character) pawn.character.root.scaling.y = c.alive ? 1 : 0.35;
    }

    if (ctx.endTimer > 0) {
      ctx.endTimer -= dt;
      if (ctx.endTimer <= 0) this.endBattle();
    }
  }

  private onEnemyDefeated(id: string) {
    const v = this.battleView.enemies.get(id);
    if (!v || !this.battle) return;
    this.battle.exp += v.def.exp;
    const drops = rollDrops(this.data.dropTables, v.def.dropTableId, this.gs.save.pity, (i) => this.data.materials.get(i)?.rarity === 'rare');
    for (const d of drops) this.gs.addItem(d.itemId, d.count);
    this.run?.drops.push(...drops);
    this.overlay.popup(v.root.position.add(new Vector3(0, 1.5, 0)), h('div', { class: 'dmg heal', text: `+${v.def.exp} EXP` }), 1100);
  }

  private endBattle() {
    const ctx = this.battle!;
    const sys = ctx.sys;
    const hero = sys.hero(), partner = sys.partner();
    this.battleView.end();
    this.battle = null;
    this.mode = 'field';
    this.gs.save.player.hp = Math.max(1, hero.hp);
    this.partnerHp = Math.max(1, partner?.hp ?? 1);
    for (const id of ['hero', 'partner']) { const c = this.allyPawn(id)?.character; if (c) c.root.scaling.y = 1; }
    this.gs.addExp(ctx.exp);
    if (this.run) {
      this.run.exp += ctx.exp;
      this.run.damageTaken += sys.stats.damageTaken;
      this.run.focusBlasts += sys.stats.focusBlasts;
      this.run.focusDistributed += sys.stats.focusDistributed;
    }
    if (sys.ended === 'defeat') {
      void this.finishRun(false);
      return;
    }
    if (ctx.boss) {
      void this.finishRun(true);
      return;
    }
    // 雑魚戦の後はひと息ついて少し回復（テンポ優先）
    const hs = this.gs.heroStats();
    this.gs.save.player.hp = Math.min(hs.hp, this.gs.save.player.hp + Math.round(hs.hp * 0.35));
    this.partnerHp = Math.min(this.gs.partnerStats().hp, this.partnerHp + Math.round(this.gs.partnerStats().hp * 0.35));
    if (this.run) { this.run.index++; this.placeBeacon(); }
    this.requestSave();
  }

  private async finishRun(success: boolean) {
    const run = this.run;
    if (!run) return;
    const q = this.data.quests.get(run.questId)!;
    const qp = this.gs.quest(run.questId);
    const bonuses: string[] = [];
    if (success) {
      const bonusExp = q.run?.rewardExp ?? 0;
      this.gs.addExp(bonusExp);
      run.exp += bonusExp;
      if (run.focusBlasts > 0 && run.focusDistributed === run.focusBlasts) {
        this.gs.addItem('lb-crystal', 1);
        run.drops.push({ itemId: 'lb-crystal', count: 1, rare: false });
        bonuses.push('完全分散ボーナス：分散結晶 +1');
      }
    }
    const prev = qp.lastTimeMs;
    const best = qp.bestTimeMs;
    const newBest = success && (best === null || run.elapsedMs < best);
    if (success) {
      qp.clears++;
      qp.lastTimeMs = run.elapsedMs;
      if (newBest) qp.bestTimeMs = run.elapsedMs;
    }
    const result = {
      questTitle: q.title, success, timeMs: run.elapsedMs, prevMs: success ? prev : null, bestMs: best, newBest,
      exp: run.exp, levelBefore: run.levelBefore, levelAfter: this.gs.save.player.level,
      drops: mergeDrops(run.drops), bonuses, damageTaken: run.damageTaken,
    };
    this.endRunCleanup();
    await this.saveNow();
    this.mode = 'result';
    this.resultUI.open(this.gs, result,
      () => { this.mode = 'field'; void this.startRun(q.id); },
      () => { this.mode = 'field'; this.returnToTown(); });
  }

  private returnToTown() {
    const r = this.data.map.returnPoint;
    this.player.pawn.place(r[0], r[1], Math.PI);
    this.player.clearTrail();
    this.partner.teleportBehindLeader();
    this.cam.camera.alpha = Math.PI / 2;
    this.healParty();
    this.requestSave();
  }

  // ---------- メニュー・工房・試練・登録 ----------
  private openMenu() {
    if (this.mode !== 'field') return;
    this.mode = 'menu';
    this.input.enabled = false;
    this.menuUI.open({
      gs: this.gs, heroName: this.names.hero, partnerName: this.names.partner, appearance: this.appearanceNames,
      openRegistry: () => { this.menuUI.close(); this.openRegistry(); },
      saveNow: () => this.saveNow(),
      resetData: async () => {
        const fresh = await this.saves.reset();
        fresh.party = { ...this.gs.save.party };
        await this.saves.save(fresh);
        location.reload();
      },
      storageInfo: async () => {
        const e = await storageEstimate();
        return e ? `保存領域：${(e.usage / 1048576).toFixed(1)}MB 使用 / ${(e.quota / 1048576).toFixed(0)}MB` : '保存領域の情報を取得できません';
      },
      close: () => this.closeOverlays(),
    });
  }

  private closeOverlays() {
    if (this.mode === 'menu') { this.menuUI.close(); this.mode = 'field'; this.input.enabled = true; this.interactCooldown = 0.2; }
    else if (this.mode === 'craft') { this.craftUI.close(); this.mode = 'field'; this.interactCooldown = 0.3; this.requestSave(); }
  }

  private openCraft() {
    this.mode = 'craft';
    this.hud.setPrompt(null);
    this.craftUI.open(this.gs, () => { this.mode = 'field'; this.interactCooldown = 0.3; this.requestSave(); }, (msg) => {
      this.hud.toast(msg, 'good', 3);
      this.lastSkillLevels.forEach((_, id) => this.lastSkillLevels.set(id, this.gs.effectiveSkillLevel(id)));
      this.requestSave();
    });
  }

  private openExam(knowledgeId: string): Promise<void> {
    const pool = this.data.exams.questions.filter((q) => q.knowledgeIds.includes(knowledgeId));
    const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
    if (!picked.length) return Promise.resolve();
    this.mode = 'exam';
    return new Promise((resolve) => {
      this.examUI.open('試練の石碑 ― 負荷分散の試練', picked,
        (a) => this.gs.recordKnowledge({ knowledgeId, kind: 'exam', variant: 'exam', correct: a.correct, questionId: a.question.id }),
        (answers) => {
          this.mode = 'field';
          this.interactCooldown = 0.3;
          if (answers.length === picked.length && answers.every((x) => x.correct)) {
            const flag = `exam-clear-${knowledgeId}`;
            if (!this.gs.save.flags[flag]) {
              this.gs.setFlag(flag);
              this.gs.addItem('tuning-core', 1);
              this.hud.banner('試練達成！', [['報酬', '調律核', '×1']]);
            } else {
              this.gs.addItem('lb-crystal', 2);
            }
          }
          this.requestSave();
          resolve();
        });
    });
  }

  private openRegistry() {
    this.mode = 'registry';
    this.input.enabled = false;
    this.hud.setVisible(false);
    this.overlay.root.style.display = 'none';
    this.cam.camera.detachControl();
    this.registry.open();
  }

  private async closeRegistry(changed: boolean) {
    this.cam.camera.attachControl(this.canvas, true);
    this.hud.setVisible(true);
    this.overlay.root.style.display = '';
    this.input.enabled = true;
    if (changed) {
      this.mode = 'busy';
      await this.loadAppearances();
      this.partner.teleportBehindLeader();
      await this.saveNow();
      this.hud.toast('キャラクターの見た目を更新しました', 'good');
    }
    this.mode = 'field';
  }

  // ---------- セーブ ----------
  private savePending = false;
  requestSave() {
    this.autosaveTimer = 0;
    if (this.savePending) return;
    this.savePending = true;
    setTimeout(() => { this.savePending = false; void this.saveNow(); }, 300);
  }

  async saveNow() {
    const p = this.player.pawn;
    const s = this.gs.save;
    if (!this.run) s.position = { x: p.x, z: p.z, facing: p.facing };
    const ok = await this.saves.save(s);
    if (!ok && this.saves.lastError) this.hud.toast(this.saves.lastError, 'bad', 4);
    return ok;
  }

  /** 開発・動作確認用 */
  debug() {
    return {
      gs: this.gs, mode: () => this.mode, run: () => this.run, battle: () => this.battle,
      teleport: (x: number, z: number) => { this.player.pawn.place(x, z); this.partner.teleportBehindLeader(); },
      engine: this.engine,
      /** 描画ループが止まっている環境（非表示タブ等）でも時間を進める */
      advance: (seconds: number, step = 1 / 30) => { for (let t = 0; t < seconds; t += step) this.frame(step); },
      talk: (id: string) => this.talk(id), gimmick: (id: string) => this.startGimmick(id), startRun: (id: string) => this.startRun(id),
    };
  }
}
