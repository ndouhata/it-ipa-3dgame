// 戦闘ステージの3D表示。闘技場・味方（登録キャラ）・敵モデル・ダメージ表示を担当する。ロジックは持たない。
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { EnemyDefinition } from '../data/schema';
import type { BattleEvent, TurnBattle } from './TurnBattle';
import type { CharacterInstance } from '../character/CharacterInstance';
import type { WorldOverlay } from '../ui/WorldOverlay';
import { h, bar, setBar } from '../ui/dom';

interface EnemyVisual {
  id: string;
  def: EnemyDefinition;
  root: TransformNode;
  body: TransformNode;
  mat: StandardMaterial;
  flash: number;
  lunge: number;
  dying: number;
  t: number;
}

const HERO_POS = new Vector3(-1.3, 0, -2.2);
const PARTNER_POS = new Vector3(1.5, 0, -2.9);

export class BattleStage {
  readonly camera: ArcRotateCamera;
  readonly shadows: ShadowGenerator;
  private enemies = new Map<string, EnemyVisual>();
  private ground: Mesh;
  private groundMat: StandardMaterial;
  private party: { hero: CharacterInstance | null; partner: CharacterInstance | null } = { hero: null, partner: null };
  private shake = new Map<CharacterInstance, number>();
  private camTime = 0;
  onTargetClick: (id: string) => void = () => {};

  constructor(private scene: Scene, canvas: HTMLCanvasElement, private overlay: WorldOverlay) {
    scene.clearColor = new Color4(0.62, 0.78, 0.95, 1);
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.8;
    hemi.groundColor = new Color3(0.35, 0.33, 0.3);
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.6), scene);
    sun.intensity = 0.8;
    sun.position = new Vector3(10, 20, -10);
    this.shadows = new ShadowGenerator(1024, sun);
    this.shadows.bias = 0.002;

    this.ground = MeshBuilder.CreateDisc('arena', { radius: 14, tessellation: 64 }, scene);
    this.ground.rotation.x = Math.PI / 2;
    this.ground.receiveShadows = true;
    this.groundMat = new StandardMaterial('arena-m', scene);
    this.groundMat.specularColor = Color3.Black();
    this.ground.material = this.groundMat;
    const outer = MeshBuilder.CreateGround('outer', { width: 200, height: 200 }, scene);
    outer.position.y = -0.02;
    const om = new StandardMaterial('outer-m', scene);
    om.diffuseColor = new Color3(0.32, 0.48, 0.28);
    om.specularColor = Color3.Black();
    outer.material = om;
    // 周りの石柱（雰囲気づくり）
    const pm = new StandardMaterial('pillar-m', scene);
    pm.diffuseColor = new Color3(0.55, 0.55, 0.58);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      if (Math.cos(a) < 0.2) continue; // カメラ側には置かない
      const p = MeshBuilder.CreateCylinder('pillar', { height: 4 + (i % 3), diameter: 0.9, tessellation: 8 }, scene);
      p.position.set(Math.sin(a) * 13, (4 + (i % 3)) / 2, Math.cos(a) * 13);
      p.material = pm;
      this.shadows.addShadowCaster(p);
    }
    this.setStage([0.5, 0.48, 0.3], [0.62, 0.78, 0.95]);

    this.camera = new ArcRotateCamera('cam', -Math.PI / 2 - 0.4, 1.0, 13, new Vector3(0.2, 0.2, -0.6), scene);
    this.camera.lowerRadiusLimit = 6;
    this.camera.upperRadiusLimit = 30;
    this.camera.lowerBetaLimit = 0.5;
    this.camera.upperBetaLimit = 1.4;
    this.camera.panningSensibility = 0;
    this.camera.wheelDeltaPercentage = 0.01;
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    this.camera.attachControl(canvas, true);
  }

  /** 縦長の画面（スマホ縦向き）では、敵と味方が収まるようにカメラを引く */
  fitToScreen() {
    const engine = this.scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    this.camera.radius = aspect < 1 ? 13 / Math.max(0.45, aspect) * 0.75 : 13;
  }

  setStage(ground: readonly number[], sky: readonly number[]) {
    this.groundMat.diffuseColor = new Color3(ground[0], ground[1], ground[2]);
    this.scene.clearColor = new Color4(sky[0], sky[1], sky[2], 1);
  }

  setParty(hero: CharacterInstance, partner: CharacterInstance) {
    this.party = { hero, partner };
    for (const [c, pos] of [[hero, HERO_POS], [partner, PARTNER_POS]] as const) {
      c.setPosition(pos.x, pos.z);
      c.setFacing(0);
      for (const m of c.root.getChildMeshes()) { this.shadows.addShadowCaster(m); m.isPickable = false; }
    }
  }

  private allyPos(id: string): Vector3 | null {
    const c = id === 'hero' ? this.party.hero : id === 'partner' ? this.party.partner : null;
    return c ? c.position.add(new Vector3(0, c.height + 0.2, 0)) : null;
  }

  // ---------- 敵 ----------
  spawnWave(battle: TurnBattle) {
    this.clearEnemies();
    const list = battle.enemies();
    const n = list.length;
    list.forEach((f, i) => {
      const boss = f.enemy!.rank === 'boss';
      const pos = new Vector3((i - (n - 1) / 2) * 3.2, 0, boss ? 3.8 : 3 - Math.abs(i - (n - 1) / 2) * 0.5);
      const v = this.buildEnemy(f.id, f.enemy!, pos);
      this.enemies.set(f.id, v);
      const el = h('div', { class: `wlabel-enemy clickable${boss ? ' boss' : ''}`, onclick: () => this.onTargetClick(f.id) },
        h('div', { class: 'ename', text: f.name }), bar(1, 'hp'));
      this.overlay.set(`enemy:${f.id}`, el, () => v.dying > 0 ? null : v.root.position.add(new Vector3(0, this.enemyHeight(v) + 0.3, 0)), 80);
    });
  }

  clearEnemies() {
    for (const v of this.enemies.values()) v.root.dispose(false, true);
    this.enemies.clear();
    this.overlay.removePrefix('enemy:');
  }

  refreshLabels(battle: TurnBattle) {
    for (const f of battle.fighters) {
      const el = this.overlay.get(`enemy:${f.id}`);
      if (!el) continue;
      setBar(el.querySelector('.bar') as HTMLElement, f.hp / f.maxHp);
      el.classList.toggle('targeted', battle.targetId === f.id);
    }
  }

  private enemyHeight(v: EnemyVisual) {
    return (v.def.appearance.shape === 'ogre' ? 4.1 : v.def.appearance.shape === 'beetle' ? 1.4 : 1.25) * v.def.appearance.scale;
  }

  private buildEnemy(id: string, def: EnemyDefinition, pos: Vector3): EnemyVisual {
    const s = this.scene;
    const root = new TransformNode(`enemy-${id}`, s);
    root.position.copyFrom(pos);
    root.rotation.y = Math.PI;
    const body = new TransformNode('body', s);
    body.parent = root;
    const mat = new StandardMaterial(`emat-${id}`, s);
    const [r, g, b] = def.appearance.color;
    mat.diffuseColor = new Color3(r, g, b);
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    const dark = new StandardMaterial(`edark-${id}`, s);
    dark.diffuseColor = new Color3(0.08, 0.08, 0.1);
    const add = (m: Mesh, material = mat) => { m.parent = body; m.material = material; m.isPickable = false; this.shadows.addShadowCaster(m); return m; };
    const eye = (x: number, y: number, z: number, d = 0.14) => { const e = add(MeshBuilder.CreateSphere('eye', { diameter: d, segments: 6 }, s), dark); e.position.set(x, y, z); };
    switch (def.appearance.shape) {
      case 'slime': {
        const b0 = add(MeshBuilder.CreateSphere('slime', { diameter: 1.2, segments: 14 }, s));
        b0.scaling.y = 0.75;
        b0.position.y = 0.45;
        eye(-0.2, 0.6, 0.5); eye(0.2, 0.6, 0.5);
        break;
      }
      case 'beetle': {
        const shell = add(MeshBuilder.CreateSphere('shell', { diameter: 1, segments: 12 }, s));
        shell.scaling.set(1.3, 0.75, 1.7);
        shell.position.y = 0.6;
        const head = add(MeshBuilder.CreateSphere('head', { diameter: 0.6, segments: 10 }, s), dark);
        head.position.set(0, 0.55, 0.85);
        const horn = add(MeshBuilder.CreateCylinder('horn', { height: 0.7, diameterTop: 0, diameterBottom: 0.18, tessellation: 6 }, s), dark);
        horn.position.set(0, 0.85, 1.05);
        horn.rotation.x = 0.9;
        eye(-0.15, 0.62, 1.1, 0.1); eye(0.15, 0.62, 1.1, 0.1);
        break;
      }
      case 'ogre': {
        const torso = add(MeshBuilder.CreateBox('torso', { width: 1.9, height: 1.8, depth: 1.1 }, s));
        torso.position.y = 2.1;
        const head = add(MeshBuilder.CreateBox('head', { width: 0.95, height: 0.85, depth: 0.85 }, s));
        head.position.y = 3.4;
        for (const sx of [-1, 1]) {
          const arm = add(MeshBuilder.CreateBox('arm', { width: 0.55, height: 1.7, depth: 0.55 }, s));
          arm.position.set(sx * 1.3, 1.9, 0.1);
          const leg = add(MeshBuilder.CreateBox('leg', { width: 0.65, height: 1.25, depth: 0.65 }, s), dark);
          leg.position.set(sx * 0.5, 0.62, 0);
        }
        const club = add(MeshBuilder.CreateCylinder('club', { height: 2.2, diameterTop: 0.45, diameterBottom: 0.2, tessellation: 8 }, s), dark);
        club.position.set(1.35, 1.2, 0.6);
        club.rotation.x = 0.5;
        eye(-0.22, 3.5, 0.44, 0.16); eye(0.22, 3.5, 0.44, 0.16);
        break;
      }
    }
    body.scaling.setAll(def.appearance.scale);
    return { id, def, root, body, mat, flash: 0, lunge: 0, dying: 0, t: Math.random() * 10 };
  }

  private posOf(id: string): Vector3 | null {
    const v = this.enemies.get(id);
    if (v) return v.root.position.add(new Vector3(0, this.enemyHeight(v) * 0.6, 0));
    return this.allyPos(id);
  }

  // ---------- 演出 ----------
  /** 戦闘イベントを順に演出する（攻撃の踏み込み→ダメージ表示）。終わったら解決する */
  async play(events: BattleEvent[], style: { label?: string; tone?: string } = {}) {
    for (const ev of events) {
      if (ev.type === 'attack') {
        const v = this.enemies.get(ev.sourceId);
        if (v) v.lunge = 0.35;
        const c = ev.sourceId === 'hero' ? this.party.hero : ev.sourceId === 'partner' ? this.party.partner : null;
        c?.playAction('attack');
        await wait(170);
      } else if (ev.type === 'damage') {
        const v = this.enemies.get(ev.targetId);
        if (v) v.flash = 0.18;
        const ally = ev.targetId === 'hero' ? this.party.hero : ev.targetId === 'partner' ? this.party.partner : null;
        if (ally) this.shake.set(ally, 0.3);
        const pos = this.posOf(ev.targetId);
        if (pos) {
          const big = v && ev.mult >= 1.5;
          const cls = v ? `enemy-hit${big ? ' big' : ''}` : 'ally-hit';
          this.overlay.popup(pos.add(new Vector3((Math.random() - 0.5) * 0.5, 0, 0)), h('div', { class: `dmg ${cls}`, text: String(ev.amount) }));
        }
        await wait(260);
      } else if (ev.type === 'defeated') {
        const v = this.enemies.get(ev.id);
        if (v) { v.dying = 0.6; this.overlay.remove(`enemy:${ev.id}`); }
        await wait(200);
      }
    }
    if (style.label) await wait(100);
  }

  popupAt(id: string, el: HTMLElement, life = 1100) {
    const pos = this.posOf(id);
    if (pos) this.overlay.popup(pos.add(new Vector3(0, 0.6, 0)), el, life);
  }

  update(dt: number) {
    this.camTime += dt;
    for (const v of this.enemies.values()) {
      v.t += dt;
      if (v.dying > 0) {
        v.dying -= dt;
        v.body.scaling.setAll(v.def.appearance.scale * Math.max(0, v.dying / 0.6));
        if (v.dying <= 0) v.root.setEnabled(false);
        continue;
      }
      const bobAmp = v.def.appearance.shape === 'slime' ? 0.12 : 0.04;
      v.body.position.y = Math.abs(Math.sin(v.t * 3)) * bobAmp;
      if (v.def.appearance.shape === 'slime') v.body.scaling.y = v.def.appearance.scale * (1 - Math.sin(v.t * 6) * 0.06);
      if (v.lunge > 0) {
        v.lunge = Math.max(0, v.lunge - dt);
        v.body.position.z = Math.sin((v.lunge / 0.35) * Math.PI) * 1.2;
      } else v.body.position.z = 0;
      if (v.flash > 0) {
        v.flash -= dt;
        v.mat.emissiveColor = v.flash > 0 ? new Color3(0.9, 0.9, 0.9) : Color3.Black();
      }
    }
    for (const [c, t] of this.shake) {
      const nt = t - dt;
      const base = c === this.party.hero ? HERO_POS : PARTNER_POS;
      if (nt <= 0) { this.shake.delete(c); c.setPosition(base.x, base.z); continue; }
      this.shake.set(c, nt);
      c.setPosition(base.x + Math.sin(nt * 60) * 0.08, base.z);
    }
    for (const c of [this.party.hero, this.party.partner]) {
      if (!c) continue;
      c.setLocomotion(0);
      c.update(dt);
    }
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
