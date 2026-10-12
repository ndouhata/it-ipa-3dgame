// 戦闘の3D表示。BattleSystem（ロジック）のイベントを受けて見た目に反映するだけ。
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { EnemyDefinition } from '../data/schema';
import type { BattleSystem, BattleEvent, DistributionMode } from './BattleSystem';
import type { WorldOverlay } from '../ui/WorldOverlay';
import { h, bar, setBar } from '../ui/dom';

export interface EnemyVisual {
  id: string;
  def: EnemyDefinition;
  root: TransformNode;
  body: TransformNode;
  mat: StandardMaterial;
  flash: number;
  lunge: number;
  dying: number;
  home: Vector3;
  t: number;
}

interface Fx { mesh: Mesh | LinesMesh; life: number; total: number; grow?: boolean }

const MODE_LABEL: Record<DistributionMode, string> = { roundRobin: '均等分散', healthCheck: '見極め分散', weighted: '重み付け分散' };

export class BattleView {
  readonly enemies = new Map<string, EnemyVisual>();
  private nodes = new Map<string, TransformNode>();
  private fx: Fx[] = [];
  private telegraphRings = new Map<string, Mesh>();
  private center = new Vector3();
  /** 味方の表示位置（Game側がPawnを寄せる） */
  readonly allySlots = new Map<string, Vector3>();
  getAllyPos: (id: string) => Vector3 | null = () => null;

  constructor(private scene: Scene, private shadows: ShadowGenerator, private overlay: WorldOverlay) {}

  // ---------- 敵シンボル ----------
  spawnGroup(prefix: string, defs: EnemyDefinition[], center: [number, number]) {
    const n = defs.length;
    defs.forEach((def, i) => {
      const boss = def.rank === 'boss';
      const x = center[0] + (i - (n - 1) / 2) * 3;
      const z = center[1] + (boss ? 5 : 3.5) - Math.abs(i - (n - 1) / 2) * 0.6;
      const id = `${prefix}-${i}`;
      this.enemies.set(id, this.buildEnemy(id, def, new Vector3(x, 0, z)));
    });
  }

  private buildEnemy(id: string, def: EnemyDefinition, pos: Vector3): EnemyVisual {
    const s = this.scene;
    const root = new TransformNode(`enemy-${id}`, s);
    root.position.copyFrom(pos);
    root.rotation.y = Math.PI; // 南（主人公側）を向く
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
    return { id, def, root, body, mat, flash: 0, lunge: 0, dying: 0, home: pos.clone(), t: Math.random() * 10 };
  }

  enemyHeight(v: EnemyVisual) {
    return (v.def.appearance.shape === 'ogre' ? 4.1 : v.def.appearance.shape === 'beetle' ? 1.4 : 1.25) * v.def.appearance.scale;
  }

  /** 指定グループで近くにいる敵（接触判定用） */
  nearestGroup(prefix: string, x: number, z: number) {
    let best = Infinity;
    for (const v of this.enemies.values()) if (v.id.startsWith(prefix)) best = Math.min(best, Math.hypot(v.root.position.x - x, v.root.position.z - z));
    return best;
  }

  clearAllEnemies() {
    for (const v of this.enemies.values()) v.root.dispose(false, true);
    this.enemies.clear();
  }

  // ---------- 戦闘開始/終了 ----------
  begin(sys: BattleSystem, center: [number, number]) {
    this.center.set(center[0], 0, center[1]);
    this.allySlots.clear();
    this.allySlots.set('hero', new Vector3(center[0] - 1.2, 0, center[1] - 2.2));
    this.allySlots.set('partner', new Vector3(center[0] + 1.5, 0, center[1] - 2.8));
    const nodeAllies = sys.combatants.filter((c) => c.kind === 'node');
    nodeAllies.forEach((c, i) => {
      const pos = new Vector3(center[0] + (i % 2 === 0 ? -3.4 : 3.6), 0, center[1] - 3.6 - Math.floor(i / 2));
      this.allySlots.set(c.id, pos);
      this.nodes.set(c.id, this.buildNode(c.id, pos));
    });

    for (const c of sys.combatants) {
      if (c.side === 'enemy') {
        const v = this.enemies.get(c.id);
        if (!v) continue;
        const boss = c.enemy?.rank === 'boss';
        const el = h('div', { class: `wlabel-enemy${boss ? ' boss' : ''}` }, h('div', { class: 'ename', text: c.name }), bar(1, 'hp'), h('div', { class: 'tg' }));
        this.overlay.set(`battle:${c.id}`, el, () => v.dying > 0 ? null : v.root.position.add(new Vector3(0, this.enemyHeight(v) + 0.4, 0)), 80);
      } else if (c.kind === 'node') {
        const pos = this.allySlots.get(c.id)!;
        const el = h('div', { class: 'wlabel-enemy' }, h('div', { class: 'ename', text: '分散ノード' }), bar(1, 'node'));
        this.overlay.set(`battle:${c.id}`, el, () => pos.add(new Vector3(0, 2.3, 0)), 80);
      }
    }
  }

  private buildNode(id: string, pos: Vector3) {
    const s = this.scene;
    const root = new TransformNode(`node-${id}`, s);
    root.position.copyFrom(pos);
    const mat = new StandardMaterial(`nmat-${id}`, s);
    mat.diffuseColor = new Color3(0.55, 0.45, 1);
    mat.emissiveColor = new Color3(0.25, 0.2, 0.55);
    mat.alpha = 0.9;
    const base = MeshBuilder.CreateCylinder('nbase', { height: 0.25, diameter: 1.1, tessellation: 12 }, s);
    base.parent = root;
    base.position.y = 0.12;
    base.material = mat;
    const crystal = MeshBuilder.CreatePolyhedron('ncrystal', { type: 1, size: 0.55 }, s);
    crystal.parent = root;
    crystal.position.y = 1.3;
    crystal.scaling.y = 1.6;
    crystal.material = mat;
    this.shadows.addShadowCaster(crystal);
    root.metadata = { crystal, mat };
    return root;
  }

  end() {
    this.overlay.removePrefix('battle:');
    for (const n of this.nodes.values()) n.dispose(false, true);
    this.nodes.clear();
    for (const r of this.telegraphRings.values()) r.dispose();
    this.telegraphRings.clear();
    for (const [id, v] of this.enemies) if (v.dying > 0 || !v.root.isEnabled()) { v.root.dispose(false, true); this.enemies.delete(id); }
  }

  // ---------- 毎フレーム ----------
  private posOf(id: string): Vector3 | null {
    const v = this.enemies.get(id);
    if (v) return v.root.position.add(new Vector3(0, this.enemyHeight(v) * 0.6, 0));
    const slot = this.getAllyPos(id) ?? this.allySlots.get(id);
    return slot ? slot.add(new Vector3(0, 1.5, 0)) : null;
  }

  handle(sys: BattleSystem, events: BattleEvent[], onDefeated: (id: string) => void) {
    for (const ev of events) {
      switch (ev.type) {
        case 'attack': {
          const v = this.enemies.get(ev.sourceId);
          if (v) v.lunge = 0.3;
          break;
        }
        case 'damage': {
          const v = this.enemies.get(ev.targetId);
          if (v) v.flash = 0.15;
          const node = this.nodes.get(ev.targetId);
          if (node) (node.metadata.mat as StandardMaterial).emissiveColor = new Color3(0.9, 0.8, 1);
          const pos = this.posOf(ev.targetId);
          if (pos) {
            const cls = v ? 'enemy-hit' : ev.style === 'split' ? 'split' : 'ally-hit';
            const big = ev.style === 'skill' || ev.style === 'focus';
            const text = ev.style === 'guarded' ? `${ev.amount} 防御!` : String(ev.amount);
            this.overlay.popup(pos.add(new Vector3((Math.random() - 0.5) * 0.6, 0, 0)), h('div', { class: `dmg ${cls}${big ? ' big' : ''}`, text }));
          }
          break;
        }
        case 'heal': {
          const pos = this.posOf(ev.targetId);
          if (pos) this.overlay.popup(pos, h('div', { class: 'dmg heal', text: `+${ev.amount}` }));
          break;
        }
        case 'telegraph': {
          const v = this.enemies.get(ev.sourceId);
          const label = this.overlay.get(`battle:${ev.sourceId}`)?.querySelector('.tg');
          if (label) label.replaceChildren(h('div', { class: `telegraph${ev.action === 'spreadWave' ? ' spread' : ''}` },
            `${ev.action === 'spreadWave' ? '全体' : '集中'}：${ev.name}`, bar(0, 'tbar')));
          const ring = MeshBuilder.CreateDisc('tg-ring', { radius: 1, tessellation: 40 }, this.scene);
          ring.rotation.x = Math.PI / 2;
          const m = new StandardMaterial('tg-mat', this.scene);
          m.diffuseColor = ev.action === 'spreadWave' ? new Color3(0.7, 0.4, 1) : new Color3(1, 0.2, 0.15);
          m.emissiveColor = m.diffuseColor.scale(0.6);
          m.alpha = 0.35;
          m.disableLighting = true;
          ring.material = m;
          if (ev.action === 'spreadWave') {
            ring.position.set(this.center.x, 0.05, this.center.z - 2.8);
            ring.scaling.setAll(5);
          } else {
            const p = (ev.targetId && (this.getAllyPos(ev.targetId) ?? this.allySlots.get(ev.targetId))) || this.center;
            ring.position.set(p.x, 0.05, p.z);
            ring.scaling.setAll(0.3);
            ring.metadata = { follow: ev.targetId };
          }
          ring.metadata = { ...(ring.metadata ?? {}), total: ev.duration, t: 0, spread: ev.action === 'spreadWave' };
          this.telegraphRings.get(ev.sourceId)?.dispose();
          this.telegraphRings.set(ev.sourceId, ring);
          if (v) v.flash = 0.3;
          break;
        }
        case 'telegraphEnd': {
          const label = this.overlay.get(`battle:${ev.sourceId}`)?.querySelector('.tg');
          label?.replaceChildren();
          this.telegraphRings.get(ev.sourceId)?.dispose();
          this.telegraphRings.delete(ev.sourceId);
          const v = this.enemies.get(ev.sourceId);
          if (v) v.lunge = 0.5;
          break;
        }
        case 'distribute': {
          const from = this.posOf(ev.sourceId);
          if (from) {
            for (const p of ev.parts) {
              const to = this.posOf(p.targetId);
              if (!to) continue;
              const line = MeshBuilder.CreateLines('dist-line', { points: [from, to] }, this.scene);
              line.color = new Color3(0.75, 0.65, 1);
              this.fx.push({ mesh: line, life: 0.8, total: 0.8 });
            }
          }
          const el = h('div', { class: 'panel dist-total' },
            h('div', { class: 'small muted', text: `分散陣：${MODE_LABEL[ev.mode]}` }),
            h('div', { class: 'parts', text: `${ev.total} → ${ev.parts.map((p) => p.raw).join(' / ')}` }));
          this.overlay.root.append(el);
          setTimeout(() => el.remove(), 2100);
          break;
        }
        case 'defeated': {
          const v = this.enemies.get(ev.id);
          if (v) { v.dying = 0.6; onDefeated(ev.id); }
          const node = this.nodes.get(ev.id);
          if (node) node.setEnabled(false);
          this.overlay.remove(`battle:${ev.id}`);
          break;
        }
      }
    }
    // HPバー・予兆バー・ターゲット表示
    for (const c of sys.combatants) {
      const el = this.overlay.get(`battle:${c.id}`);
      if (!el) continue;
      const hp = el.querySelector('.bar.hp, .bar.node') as HTMLElement | null;
      if (hp) setBar(hp, c.hp / c.maxHp);
      el.classList.toggle('targeted', sys.targetId === c.id);
      const tbar = el.querySelector('.tbar') as HTMLElement | null;
      if (tbar && c.charging) setBar(tbar, 1 - c.charging.remaining / c.charging.total);
    }
  }

  update(dt: number) {
    for (const v of this.enemies.values()) {
      v.t += dt;
      if (v.dying > 0) {
        v.dying -= dt;
        const k = Math.max(0, v.dying / 0.6);
        v.body.scaling.setAll(v.def.appearance.scale * k);
        if (v.dying <= 0) v.root.setEnabled(false);
        continue;
      }
      const bobAmp = v.def.appearance.shape === 'slime' ? 0.12 : 0.04;
      v.body.position.y = Math.abs(Math.sin(v.t * 3)) * bobAmp;
      if (v.def.appearance.shape === 'slime') v.body.scaling.y = v.def.appearance.scale * (1 - Math.sin(v.t * 6) * 0.06);
      if (v.lunge > 0) {
        v.lunge = Math.max(0, v.lunge - dt);
        v.body.position.z = Math.sin((v.lunge / 0.3) * Math.PI) * 0.6;
      } else v.body.position.z = 0;
      if (v.flash > 0) {
        v.flash -= dt;
        v.mat.emissiveColor = v.flash > 0 ? new Color3(0.8, 0.8, 0.8) : Color3.Black();
      }
    }
    for (const n of this.nodes.values()) {
      const md = n.metadata as { crystal: Mesh; mat: StandardMaterial };
      md.crystal.rotation.y += dt * 1.5;
      md.mat.emissiveColor = Color3.Lerp(md.mat.emissiveColor, new Color3(0.25, 0.2, 0.55), Math.min(1, dt * 5));
    }
    for (const ring of this.telegraphRings.values()) {
      const md = ring.metadata as { total: number; t: number; spread: boolean; follow?: string };
      md.t += dt;
      const k = Math.min(1, md.t / md.total);
      if (!md.spread) {
        ring.scaling.setAll(0.3 + k * 1.2);
        const p = md.follow ? (this.getAllyPos(md.follow) ?? this.allySlots.get(md.follow)) : null;
        if (p) ring.position.set(p.x, 0.05, p.z);
      }
      (ring.material as StandardMaterial).alpha = 0.25 + 0.3 * Math.abs(Math.sin(md.t * 8));
    }
    this.fx = this.fx.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) { f.mesh.dispose(); return false; }
      (f.mesh as LinesMesh).alpha = f.life / f.total;
      return true;
    });
  }

  /** 戦闘外の敵シンボルのアイドル演出 */
  idle(dt: number) { this.update(dt); }
}
