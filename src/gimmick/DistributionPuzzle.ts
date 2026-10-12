// 概念ギミックの汎用ロジック：「到着する負荷を、容量の異なる受け皿へ振り分ける」。
// 宿屋の客・馬車の荷物・魔力塔・サーバへのリクエストは、すべてこの1つのロジックをデータで差し替えている。
import type { GimmickDefinition } from '../data/schema';

export interface PuzzleTarget {
  id: string;
  label: string;
  capacity: number;
  serviceRate: number;
  load: number;
  processed: number;
  down: boolean;
  lost: number;
}

export interface PendingUnit { size: number; wait: number }

export type PuzzleEvent =
  | { type: 'arrive'; size: number }
  | { type: 'routed'; target: number; size: number; auto: boolean }
  | { type: 'overflow'; target: number; size: number }
  | { type: 'down'; target: number }
  | { type: 'up'; target: number }
  | { type: 'demoEnd' }
  | { type: 'end'; success: boolean };

export class DistributionPuzzle {
  readonly targets: PuzzleTarget[];
  pending: PendingUnit | null = null;
  phase: 'demo' | 'play' | 'done' = 'play';
  time = 0;
  remaining: number;
  lost = 0;
  /** デモ中にあふれた数（「何もしないとどうなるか」を見せる） */
  demoLost = 0;
  routedCounts: number[];
  private arrivalTimer = 0.6;
  private events: PuzzleEvent[] = [];
  success = false;

  constructor(readonly def: GimmickDefinition, private rand: () => number = Math.random) {
    this.targets = def.targets.map((t) => ({ ...t, load: 0, processed: 0, down: false, lost: 0 }));
    this.remaining = def.units;
    this.routedCounts = def.targets.map(() => 0);
    if (def.demoSeconds > 0) this.phase = 'demo';
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** 静的な受け皿（馬車）は処理されずに積み上がる */
  get isStatic() { return this.targets.every((t) => t.serviceRate === 0); }

  route(index: number, auto = false) {
    if (!this.pending || this.phase === 'done') return;
    const t = this.targets[index];
    if (!t) return;
    const size = this.pending.size;
    this.pending = null;
    this.routedCounts[index]++;
    this.events.push({ type: 'routed', target: index, size, auto });
    if (t.down || t.load + size > t.capacity) {
      t.lost += size;
      if (this.phase === 'play') this.lost += 1; else this.demoLost += 1;
      this.events.push({ type: 'overflow', target: index, size });
    } else {
      t.load += size;
    }
  }

  tick(dt: number) {
    if (this.phase === 'done') return;
    this.time += dt;

    // 故障・復旧（サーバ用）
    if (this.phase === 'play') {
      this.def.targets.forEach((td, i) => {
        const t = this.targets[i];
        const playTime = this.time;
        if (td.downAt !== undefined && !t.down && playTime >= td.downAt && (td.upAt === undefined || playTime < td.upAt)) {
          t.down = true;
          t.lost += t.load;
          t.load = 0;
          this.events.push({ type: 'down', target: i });
        }
        if (t.down && td.upAt !== undefined && playTime >= td.upAt) {
          t.down = false;
          this.events.push({ type: 'up', target: i });
        }
      });
    }

    for (const t of this.targets) if (!t.down && t.serviceRate > 0) {
      const done = Math.min(t.load, t.serviceRate * dt);
      t.load -= done;
      t.processed += done;
    }

    if (this.pending) {
      this.pending.wait += dt;
      if (this.pending.wait >= this.def.autoRouteAfter) this.route(this.def.defaultTarget, true);
    }
    {
      // 到着は一定間隔で続く。案内されないまま次が来たら、前の者は既定先へ流れる
      this.arrivalTimer -= dt;
      const canArrive = this.phase === 'demo' || this.remaining > 0;
      if (this.arrivalTimer <= 0 && canArrive) {
        if (this.pending) this.route(this.def.defaultTarget, true);
        const [lo, hi] = this.def.unitSize;
        const size = lo + Math.floor(this.rand() * (hi - lo + 1));
        this.pending = { size, wait: 0 };
        if (this.phase === 'play') this.remaining--;
        // デモでは到着を速めて、集中の問題をはっきり見せる
        this.arrivalTimer = this.phase === 'demo' ? this.def.arrivalInterval / 3 : this.def.arrivalInterval;
        this.events.push({ type: 'arrive', size });
      }
    }

    // デモ：何もしないと全部が既定先へ流れてあふれる様子を見せる
    if (this.phase === 'demo') {
      if (this.pending) this.route(this.def.defaultTarget, true);
      if (this.time >= this.def.demoSeconds) this.startPlay();
      return;
    }

    if (this.lost > this.def.allowedLoss) return this.finish(false);
    const drained = this.isStatic || this.targets.every((t) => t.load < 0.05 || t.down);
    if (this.remaining === 0 && !this.pending && drained) this.finish(true);
  }

  startPlay() {
    for (const t of this.targets) { t.load = 0; t.processed = 0; t.lost = 0; t.down = false; }
    this.routedCounts = this.targets.map(() => 0);
    this.pending = null;
    this.phase = 'play';
    this.time = 0;
    this.arrivalTimer = 1.2;
    this.events.push({ type: 'demoEnd' });
  }

  private finish(success: boolean) {
    this.phase = 'done';
    this.success = success;
    this.events.push({ type: 'end', success });
  }

  /** 振り分けが偏っていないか（正しく分散できたかの判定材料） */
  balanceScore() {
    const total = this.routedCounts.reduce((a, b) => a + b, 0);
    if (!total) return 0;
    return 1 - Math.max(...this.routedCounts) / total;
  }
}
