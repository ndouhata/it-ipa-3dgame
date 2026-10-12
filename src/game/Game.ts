// ゲーム全体の流れ：拠点メニュー → クエスト出撃 → ウェーブごとの戦闘（攻撃・防御・経験値の問題） → 結果。
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { GameData } from '../data/registry';
import type { QuestDefinition } from '../data/schema';
import { EventBus } from '../core/EventBus';
import { CharacterInstance } from '../character/CharacterInstance';
import { CharacterLoader } from '../character/CharacterLoader';
import { CharacterRepository } from '../character/CharacterRepository';
import { GameState } from './GameState';
import { SaveManager } from '../save/SaveManager';
import type { SaveData } from '../save/SaveData';
import { storageEstimate } from '../save/db';
import { QuestionEngine } from '../quiz/QuestionEngine';
import { TurnBattle, type BattleEvent } from '../battle/TurnBattle';
import { BattleStage } from '../battle/BattleStage';
import { rollDrops, mergeDrops, type Drop } from '../inventory/Drops';
import { WorldOverlay } from '../ui/WorldOverlay';
import { Hud } from '../ui/Hud';
import { HubUI } from '../ui/HubUI';
import { QuizPanel, type QuizKind } from '../ui/QuizPanel';
import { MenuUI } from '../ui/MenuUI';
import { CraftUI } from '../ui/CraftUI';
import { ResultUI } from '../ui/ResultUI';
import { RegistryScreen } from '../registry/RegistryScreen';

type Mode = 'hub' | 'battle' | 'menu' | 'craft' | 'result' | 'registry' | 'busy';

const DEFAULT_NAMES = { hero: 'アルト', partner: 'リナ' };

interface RunStats {
  startedAt: number;
  answered: number;
  correct: number;
  fastCorrect: number;
  damageTaken: number;
  exp: number;
  levelBefore: number;
  drops: Drop[];
}

export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly bus = new EventBus();
  readonly gs: GameState;
  private questions: QuestionEngine;
  private loader: CharacterLoader;
  private stage: BattleStage;
  private overlay: WorldOverlay;
  private hud: Hud;
  private hub: HubUI;
  private quiz: QuizPanel;
  private menuUI: MenuUI;
  private craftUI: CraftUI;
  private resultUI: ResultUI;
  private registry: RegistryScreen;
  private mode: Mode = 'hub';
  private names = { ...DEFAULT_NAMES };
  private hero: CharacterInstance | null = null;
  private partner: CharacterInstance | null = null;
  private battle: TurnBattle | null = null;
  private heroHp = 0;
  private partnerHp = 0;
  private run: { quest: QuestDefinition; wave: number; stats: RunStats } | null = null;
  private frameErrorLogged = false;

  constructor(private canvas: HTMLCanvasElement, ui: HTMLElement, readonly data: GameData, private saves: SaveManager, save: SaveData) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, powerPreference: 'high-performance' }, false);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new Scene(this.engine);
    this.gs = new GameState(save, data, this.bus);
    this.questions = new QuestionEngine(data.exams.questions, save, data.progression.quiz);
    this.loader = new CharacterLoader(this.scene);
    this.overlay = new WorldOverlay(ui, this.scene);
    this.stage = new BattleStage(this.scene, canvas, this.overlay);
    this.hud = new Hud(ui);
    this.hub = new HubUI(ui);
    this.quiz = new QuizPanel(ui);
    this.menuUI = new MenuUI(ui);
    this.craftUI = new CraftUI(ui);
    this.resultUI = new ResultUI(ui);
    this.registry = new RegistryScreen(this.engine, ui, {
      activeIds: () => ({ hero: this.gs.save.party.heroAppearanceId, partner: this.gs.save.party.partnerAppearanceId, npcs: {} }),
      npcList: [],
      setActive: (role, id) => { if (role === 'hero') this.gs.save.party.heroAppearanceId = id; else this.gs.save.party.partnerAppearanceId = id; },
      setNpcAppearance: () => {},
      onClose: (changed) => void this.closeRegistry(changed),
    });
    this.stage.onTargetClick = (id) => this.battle?.setTarget(id);

    this.bus.on('levelUp', (e) => {
      const rows = Object.entries(e.diff).filter(([, [a, b]]) => b !== a)
        .map(([k, [a, b]]) => [this.data.progression.statLabels[k] ?? k, `${a} → ${b}`, `+${b - a}`] as [string, string, string]);
      this.hud.banner(`LEVEL UP!  Lv ${e.to}`, rows);
      this.heroHp = this.gs.heroStats().hp;
      this.partnerHp = this.gs.partnerStats().hp;
    });
    this.bus.on('itemGained', (e) => this.hud.toast(`${this.gs.itemName(e.itemId)} ×${e.count}${e.rare ? '　★レア★' : ''}`, e.rare ? 'rare' : 'normal', e.rare ? 3.5 : 2));
    window.addEventListener('resize', () => this.engine.resize());
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape') this.closeOverlays(); });
  }

  async start() {
    await this.loadAppearances();
    this.healParty();
    this.engine.runRenderLoop(() => {
      try {
        this.frame();
      } catch (e) {
        if (!this.frameErrorLogged) { console.error('frame error', e); this.frameErrorLogged = true; }
      }
    });
    this.showHub();
  }

  // ---------- 見た目 ----------
  private async loadAppearances() {
    const make = async (id: string | null, color: Color3, name: string) => {
      const def = id ? await CharacterRepository.get(id).catch(() => undefined) : undefined;
      const container = def ? await this.loader.load(def.modelAssetId) : null;
      if (def && !container) this.hud.toast(`「${def.name}」のモデルを読み込めなかったため、仮の姿で表示します`, 'bad', 4);
      return { inst: CharacterInstance.create(this.scene, def ?? null, container, { placeholderColor: color, name }), def };
    };
    const p = this.gs.save.party;
    const hero = await make(p.heroAppearanceId, new Color3(0.2, 0.42, 0.85), 'hero');
    const partner = await make(p.partnerAppearanceId, new Color3(0.9, 0.5, 0.18), 'partner');
    this.hero?.dispose();
    this.partner?.dispose();
    this.hero = hero.inst;
    this.partner = partner.inst;
    this.names = { hero: hero.def?.name ?? DEFAULT_NAMES.hero, partner: partner.def?.name ?? DEFAULT_NAMES.partner };
    this.stage.setParty(this.hero, this.partner);
  }

  // ---------- ループ ----------
  private frame(forcedDt?: number) {
    const dt = forcedDt ?? Math.min(0.05, this.engine.getDeltaTime() / 1000);
    if (this.mode === 'registry') { this.registry.render(); return; }
    this.gs.save.playTimeMs += dt * 1000;
    this.stage.update(dt);
    if (this.battle) this.stage.refreshLabels(this.battle);
    this.updateHud();
    this.scene.render();
    this.overlay.update();
  }

  private updateHud() {
    const s = this.gs.save;
    const b = this.battle;
    this.hud.updateParty({
      heroName: this.names.hero, partnerName: this.names.partner, level: s.player.level,
      hp: b ? b.hero().hp : this.heroHp, maxHp: this.gs.heroStats().hp,
      exp: s.player.exp, expNext: s.player.level >= this.data.progression.maxLevel ? 0 : this.gs.expToNext(s.player.level),
      partnerHp: b ? b.partner()?.hp ?? 0 : this.partnerHp, partnerMaxHp: this.gs.partnerStats().hp,
    });
    if (this.run) {
      const st = this.run.stats;
      const n = this.run.quest.waves.length;
      this.hud.setHeader({
        title: this.run.quest.title,
        wave: this.run.wave + 1 === n ? `BOSS（${n}/${n}）` : `WAVE ${this.run.wave + 1}/${n}`,
        timeMs: performance.now() - st.startedAt,
        score: `正解 ${st.correct}/${st.answered}　速攻 ${st.fastCorrect}`,
      });
    } else this.hud.setHeader(null);
  }

  private healParty() {
    this.heroHp = this.gs.heroStats().hp;
    this.partnerHp = this.gs.partnerStats().hp;
  }

  // ---------- 拠点 ----------
  private showHub() {
    this.mode = 'hub';
    this.stage.clearEnemies();
    this.hud.setVisible(true);
    this.hub.show(this.gs, {
      start: (id) => void this.startQuest(id),
      craft: () => this.openCraft(),
      menu: () => this.openMenu(),
      characters: () => this.openRegistry(),
    });
  }

  // ---------- クエスト ----------
  private async startQuest(questId: string) {
    const quest = this.data.quests.get(questId);
    if (!quest || this.mode !== 'hub') return;
    this.hub.hide();
    this.mode = 'battle';
    this.healParty();
    this.stage.setStage(quest.stage.ground, quest.stage.sky);
    const stats: RunStats = { startedAt: performance.now(), answered: 0, correct: 0, fastCorrect: 0, damageTaken: 0, exp: 0, levelBefore: this.gs.save.player.level, drops: [] };
    this.run = { quest, wave: 0, stats };
    this.hud.banner(quest.title);
    await wait(1200);

    let cleared = true;
    for (let w = 0; w < quest.waves.length; w++) {
      this.run.wave = w;
      const won = await this.fightWave(quest, w);
      if (!won) { cleared = false; break; }
      if (w < quest.waves.length - 1) {
        // ウェーブの合間に少し回復（倒れたパートナーも起き上がる）
        const r = this.data.progression.betweenWavesHeal;
        this.heroHp = Math.min(this.gs.heroStats().hp, this.heroHp + Math.round(this.gs.heroStats().hp * r));
        this.partnerHp = Math.min(this.gs.partnerStats().hp, this.partnerHp + Math.round(this.gs.partnerStats().hp * r));
      }
      void this.saveNow();
    }
    await this.finishQuest(cleared);
  }

  private async fightWave(quest: QuestDefinition, w: number): Promise<boolean> {
    const hs = this.gs.heroStats(), ps = this.gs.partnerStats();
    const lv = this.gs.enemyLevelFor(quest.id);
    const enemies = quest.waves[w].map((id, i) => ({ id: `w${w}-${i}`, def: this.gs.scaledEnemy(this.data.enemies.get(id)!, quest.recommendedLevel, lv) }));
    const battle = new TurnBattle(
      { name: this.names.hero, maxHp: hs.hp, hp: this.heroHp, atk: hs.atk, def: hs.def },
      { name: this.names.partner, maxHp: ps.hp, hp: this.partnerHp, atk: ps.atk, def: ps.def },
      enemies, this.data.progression.damage,
    );
    this.battle = battle;
    this.stage.spawnWave(battle);
    const boss = enemies.some((e) => e.def.rank === 'boss');
    this.hud.banner(boss ? 'BOSS!' : `WAVE ${w + 1}`);
    await wait(900);
    const outcomes = this.data.progression.quiz.outcomes;

    while (!battle.won && !battle.lost) {
      // 主人公の攻撃（問題の結果で威力が決まる）
      const target = battle.get(battle.targetId);
      const atk = await this.askQuestion('attack', `${target?.name ?? '敵'}を攻撃！（敵の名前をクリックで狙いを変更）`, quest);
      await this.stage.play(battle.heroAttack(outcomes.attack[atk]));
      if (battle.won) break;
      // パートナーの攻撃（問題なし）
      await this.stage.play(battle.partnerAttack());
      if (battle.won) break;
      // 敵の一斉攻撃（問題の結果で受けるダメージが決まる）
      const n = battle.enemies().length;
      const first = battle.enemies()[0].name;
      const def = await this.askQuestion('defense', n > 1 ? `${first}たち${n}体の攻撃が来る！` : `${first}の攻撃が来る！`, quest);
      const evs = battle.enemiesAttack(outcomes.defense[def]);
      this.run!.stats.damageTaken += sumDamage(evs, ['hero', 'partner']);
      await this.stage.play(evs);
    }
    this.heroHp = battle.hero().hp;
    this.partnerHp = battle.partner()?.hp ?? 0;
    this.battle = null;
    if (battle.lost) {
      this.hud.banner('力尽きた…');
      await wait(1500);
      return false;
    }

    // 勝利 → 経験値の問題
    const baseExp = enemies.reduce((n, e) => n + e.def.exp, 0);
    const ex = await this.askQuestion('exp', `勝利！ 基本EXP ${baseExp}`, quest);
    const exp = Math.max(1, Math.round(baseExp * outcomes.exp[ex]));
    this.run!.stats.exp += exp;
    this.hud.banner(`EXP +${exp}`);
    this.gs.addExp(exp);
    for (const e of enemies) {
      const drops = rollDrops(this.data.dropTables, e.def.dropTableId, this.gs.save.pity, (i) => this.data.materials.get(i)?.rarity === 'rare');
      for (const d of drops) this.gs.addItem(d.itemId, d.count);
      this.run!.stats.drops.push(...drops);
    }
    await wait(900);
    return true;
  }

  /** 問題を出して結果を判定し、結果の種類（速攻正解など）を返す */
  private async askQuestion(kind: QuizKind, subtitle: string, quest: QuestDefinition) {
    const p = this.questions.next(quest.knowledgeIds, this.gs.fastBonusSec());
    const ans = await this.quiz.ask(kind, subtitle, p);
    const r = this.questions.answer(p, ans.chosen, ans.seconds);
    const st = this.run!.stats;
    st.answered++;
    if (r.correct) st.correct++;
    if (r.correct && r.fast) st.fastCorrect++;
    const mult = this.data.progression.quiz.outcomes[kind][r.outcome];
    const effect = kind === 'attack' ? `攻撃力 ×${mult}` : kind === 'defense' ? `受けるダメージ ×${mult}` : `経験値 ×${mult}`;
    await this.quiz.showResult(p, r, effect);
    this.quiz.hide();
    return r.outcome;
  }

  private async finishQuest(cleared: boolean) {
    const run = this.run!;
    const st = run.stats;
    const qp = this.gs.quest(run.quest.id);
    const timeMs = performance.now() - st.startedAt;
    if (cleared) {
      this.gs.addExp(run.quest.rewardExp);
      st.exp += run.quest.rewardExp;
    }
    const prev = qp.lastTimeMs;
    const best = qp.bestTimeMs;
    const newBest = cleared && (best === null || timeMs < best);
    const accuracy = st.answered ? st.correct / st.answered : 0;
    if (cleared) {
      qp.clears++;
      qp.lastTimeMs = timeMs;
      if (newBest) qp.bestTimeMs = timeMs;
      qp.bestAccuracy = Math.max(qp.bestAccuracy ?? 0, accuracy);
    }
    this.run = null;
    this.healParty();
    await this.saveNow();
    this.mode = 'result';
    this.resultUI.open(this.gs, {
      questTitle: run.quest.title, success: cleared, timeMs, prevMs: cleared ? prev : null, bestMs: best, newBest,
      exp: st.exp, levelBefore: st.levelBefore, levelAfter: this.gs.save.player.level,
      drops: mergeDrops(st.drops), bonuses: [], damageTaken: st.damageTaken,
      answered: st.answered, correct: st.correct, fastCorrect: st.fastCorrect,
    }, () => { this.mode = 'hub'; void this.startQuest(run.quest.id); }, () => this.showHub());
  }

  // ---------- メニュー・工房・登録 ----------
  private openMenu() {
    if (this.mode !== 'hub') return;
    this.mode = 'menu';
    this.hub.hide();
    this.menuUI.open({
      gs: this.gs, heroName: this.names.hero, partnerName: this.names.partner,
      saveNow: () => this.saveNow(),
      resetData: async () => { await this.saves.reset(this.gs.save.party); location.reload(); },
      storageInfo: async () => {
        const e = await storageEstimate();
        return e ? `保存領域：${(e.usage / 1048576).toFixed(1)}MB 使用 / ${(e.quota / 1048576).toFixed(0)}MB` : '保存領域の情報を取得できません';
      },
      close: () => this.closeOverlays(),
    });
  }

  private openCraft() {
    if (this.mode !== 'hub') return;
    this.mode = 'craft';
    this.hub.hide();
    this.craftUI.open(this.gs, () => { void this.saveNow(); this.showHub(); }, (msg) => { this.hud.toast(msg, 'good', 3); void this.saveNow(); });
  }

  private closeOverlays() {
    if (this.mode === 'menu') { this.menuUI.close(); void this.saveNow(); this.showHub(); }
    else if (this.mode === 'craft') { this.craftUI.close(); void this.saveNow(); this.showHub(); }
  }

  private openRegistry() {
    if (this.mode !== 'hub') return;
    this.mode = 'registry';
    this.hub.hide();
    this.hud.setVisible(false);
    this.overlay.root.style.display = 'none';
    this.stage.camera.detachControl();
    this.registry.open();
  }

  private async closeRegistry(changed: boolean) {
    this.stage.camera.attachControl(this.canvas, true);
    this.overlay.root.style.display = '';
    this.mode = 'busy';
    if (changed) {
      await this.loadAppearances();
      await this.saveNow();
      this.hud.toast('キャラクターの見た目を更新しました', 'good');
    }
    this.showHub();
  }

  async saveNow() {
    const ok = await this.saves.save(this.gs.save);
    if (!ok && this.saves.lastError) this.hud.toast(this.saves.lastError, 'bad', 4);
    return ok;
  }

  /** 開発・動作確認用 */
  debug() {
    return {
      gs: this.gs, engine: this.engine, mode: () => this.mode, battle: () => this.battle, run: () => this.run,
      startQuest: (id: string) => this.startQuest(id),
      advance: (seconds: number, step = 1 / 30) => { for (let t = 0; t < seconds; t += step) this.frame(step); },
    };
  }
}

function sumDamage(evs: BattleEvent[], targets: string[]) {
  return evs.reduce((n, e) => n + (e.type === 'damage' && targets.includes(e.targetId) ? e.amount : 0), 0);
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
