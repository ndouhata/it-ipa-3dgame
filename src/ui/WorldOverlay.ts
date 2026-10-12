// 3D座標に追従するDOMラベル（名前・目印・敵HP・ダメージ表示）。
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { h } from './dom';

interface Label {
  el: HTMLElement;
  pos: () => Vector3 | null;
  maxDist: number;
}

export class WorldOverlay {
  readonly root: HTMLElement;
  private labels = new Map<string, Label>();
  private tmp = new Vector3();
  private identity = Matrix.Identity();

  constructor(parent: HTMLElement, private scene: Scene) {
    this.root = h('div', { class: 'world-overlay', style: { position: 'absolute', inset: '0', overflow: 'hidden' } });
    parent.append(this.root);
  }

  set(key: string, el: HTMLElement, pos: () => Vector3 | null, maxDist = 60) {
    this.remove(key);
    el.classList.add('wlabel');
    this.root.append(el);
    this.labels.set(key, { el, pos, maxDist });
  }

  get(key: string) { return this.labels.get(key)?.el ?? null; }

  remove(key: string) {
    const l = this.labels.get(key);
    if (l) { l.el.remove(); this.labels.delete(key); }
  }

  removePrefix(prefix: string) {
    for (const k of [...this.labels.keys()]) if (k.startsWith(prefix)) this.remove(k);
  }

  project(world: Vector3): { x: number; y: number; visible: boolean; dist: number } {
    const cam = this.scene.activeCamera;
    const engine = this.scene.getEngine();
    if (!cam) return { x: 0, y: 0, visible: false, dist: 0 };
    const w = engine.getRenderWidth(), hgt = engine.getRenderHeight();
    Vector3.ProjectToRef(world, this.identity, this.scene.getTransformMatrix(), cam.viewport.toGlobal(w, hgt), this.tmp);
    const scale = this.root.clientWidth / w;
    const dist = Vector3.Distance(cam.globalPosition, world);
    return { x: this.tmp.x * scale, y: this.tmp.y * scale, visible: this.tmp.z > 0 && this.tmp.z < 1, dist };
  }

  /** 一時的な表示（ダメージ数値など）。一定時間で自動削除 */
  popup(world: Vector3, el: HTMLElement, life = 900) {
    const p = this.project(world);
    if (!p.visible) return;
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    this.root.append(el);
    setTimeout(() => el.remove(), life);
  }

  update() {
    for (const l of this.labels.values()) {
      const pos = l.pos();
      if (!pos) { l.el.style.display = 'none'; continue; }
      const p = this.project(pos);
      if (!p.visible || p.dist > l.maxDist) { l.el.style.display = 'none'; continue; }
      l.el.style.display = '';
      l.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
  }
}
