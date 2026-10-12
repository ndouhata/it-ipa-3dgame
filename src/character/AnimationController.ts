// 論理状態（idle/walk/run/…）→ ユーザーが割り当てたAnimationGroup。ウェイトでクロスフェードする。
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { LogicalAnim } from './CharacterDefinition';

const FADE_SPEED = 6; // 1秒あたりのウェイト変化量（≒0.17秒でフェード）

export class AnimationController {
  private groupsByState = new Map<LogicalAnim, AnimationGroup>();
  private weights = new Map<AnimationGroup, number>();
  private active: AnimationGroup | null = null;
  private state: LogicalAnim | null = null;
  private oneShot: { group: AnimationGroup; resume: LogicalAnim } | null = null;

  constructor(groups: AnimationGroup[], map: Partial<Record<LogicalAnim, string>>) {
    const byName = new Map(groups.map((g) => [g.name, g]));
    for (const g of groups) g.stop();
    for (const [state, name] of Object.entries(map) as [LogicalAnim, string][]) {
      const g = name ? byName.get(name) : undefined;
      if (g) this.groupsByState.set(state, g);
    }
    // 走行が未割当なら歩行で、歩行が未割当なら待機で代用
    const fallback: [LogicalAnim, LogicalAnim][] = [['walk', 'idle'], ['run', 'walk'], ['idle', 'walk']];
    for (const [s, f] of fallback) if (!this.groupsByState.has(s) && this.groupsByState.has(f)) this.groupsByState.set(s, this.groupsByState.get(f)!);
  }

  get hasAnimations() { return this.groupsByState.size > 0; }
  has(state: LogicalAnim) { return this.groupsByState.has(state); }
  get currentState() { return this.state; }

  /** ループ状態へ切り替え。speedRatio で再生速度（足滑り調整） */
  setState(state: LogicalAnim, speedRatio = 1) {
    const g = this.groupsByState.get(state);
    if (!g) return;
    if (this.oneShot) { this.oneShot.resume = state; return; }
    g.speedRatio = speedRatio;
    if (this.state === state && this.active === g) return;
    this.state = state;
    this.fadeTo(g, true);
  }

  /** 一度だけ再生（攻撃など）。終わったら直前のループ状態へ戻る */
  playOnce(state: LogicalAnim) {
    const g = this.groupsByState.get(state);
    if (!g) return false;
    this.oneShot = { group: g, resume: this.state ?? 'idle' };
    g.speedRatio = 1;
    this.fadeTo(g, false);
    g.onAnimationGroupEndObservable.addOnce(() => {
      const resume = this.oneShot?.resume ?? 'idle';
      this.oneShot = null;
      this.state = null;
      this.setState(resume);
    });
    return true;
  }

  private fadeTo(g: AnimationGroup, loop: boolean) {
    if (!g.isPlaying || !loop) {
      g.start(loop, g.speedRatio, g.from, g.to);
      if (!this.weights.has(g)) g.weight = 0;
    }
    if (!this.weights.has(g)) this.weights.set(g, 0);
    if (!this.active) {
      this.weights.set(g, 1);
      g.weight = 1;
    }
    this.active = g;
  }

  update(dt: number) {
    for (const [g, w] of this.weights) {
      const target = g === this.active ? 1 : 0;
      if (w === target) continue;
      const nw = target > w ? Math.min(1, w + FADE_SPEED * dt) : Math.max(0, w - FADE_SPEED * dt);
      this.weights.set(g, nw);
      g.weight = nw;
      if (nw === 0) { g.stop(); this.weights.delete(g); }
    }
  }

  dispose() {
    for (const g of this.groupsByState.values()) g.stop();
    this.weights.clear();
  }
}
