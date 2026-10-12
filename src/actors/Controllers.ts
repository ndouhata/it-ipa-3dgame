// PlayerController / PartnerController。どちらも Pawn（位置・向き・当たり判定）を動かし、
// 見た目は CharacterInstance に速度と向きを渡すだけ。GLBには一切依存しない。
import type { CharacterInstance } from '../character/CharacterInstance';
import type { InputSource } from '../core/Input';
import type { World } from '../world/World';
import type { ThirdPersonCamera } from '../world/ThirdPersonCamera';

export const MOVE = { walk: 3.2, run: 6.8, radius: 0.4 };

export class Pawn {
  x = 0;
  z = 0;
  facing = 0;
  speed = 0;
  character: CharacterInstance | null = null;

  place(x: number, z: number, facing = this.facing) {
    this.x = x;
    this.z = z;
    this.facing = facing;
    this.character?.setPosition(x, z);
    this.character?.setFacing(facing);
  }

  /** 見た目へ反映 */
  sync(dt: number) {
    const c = this.character;
    if (!c) return;
    c.setPosition(this.x, this.z);
    c.faceTowards(this.facing, dt);
    c.setLocomotion(this.speed);
    c.update(dt);
  }
}

export class PlayerController {
  readonly pawn = new Pawn();
  /** 移動の軌跡（パートナーが辿る） */
  readonly trail: { x: number; z: number }[] = [];

  constructor(private world: World, private cam: ThirdPersonCamera, private input: InputSource) {}

  update(dt: number, canMove: boolean) {
    const p = this.pawn;
    const mv = canMove ? this.input.getMove() : { x: 0, y: 0, run: false };
    const len = Math.hypot(mv.x, mv.y);
    if (len > 0.01) {
      const [wx, wz] = this.cam.toWorld(mv.x / len, mv.y / len);
      const speed = (mv.run ? MOVE.run : MOVE.walk) * Math.min(1, len);
      const [nx, nz] = this.world.resolve(p.x + wx * speed * dt, p.z + wz * speed * dt, MOVE.radius);
      p.speed = Math.hypot(nx - p.x, nz - p.z) / Math.max(dt, 1e-4);
      p.x = nx;
      p.z = nz;
      p.facing = Math.atan2(wx, wz);
      this.recordTrail();
    } else {
      p.speed = 0;
    }
    p.sync(dt);
  }

  private recordTrail() {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - this.pawn.x, last.z - this.pawn.z) > 0.35) {
      this.trail.push({ x: this.pawn.x, z: this.pawn.z });
      if (this.trail.length > 120) this.trail.shift();
    }
  }

  clearTrail() { this.trail.length = 0; }
}

export class PartnerController {
  readonly pawn = new Pawn();
  private followDistance = 2.2;

  constructor(private world: World, private leader: PlayerController) {}

  /** 主人公の軌跡を一定距離遅れて辿る。離れすぎたら走り、極端に離れたらワープ */
  update(dt: number) {
    const p = this.pawn;
    const L = this.leader.pawn;
    const distToLeader = Math.hypot(L.x - p.x, L.z - p.z);
    if (distToLeader > 22) {
      this.teleportBehindLeader();
      p.sync(dt);
      return;
    }
    const goal = this.pickTrailPoint();
    let speed = 0;
    if (goal && distToLeader > this.followDistance) {
      const dx = goal.x - p.x, dz = goal.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        const desired = distToLeader > 6 ? MOVE.run * 1.05 : distToLeader > 3.2 ? Math.max(MOVE.walk, L.speed) : MOVE.walk * 0.8;
        const step = Math.min(d, desired * dt);
        const [nx, nz] = this.world.resolve(p.x + (dx / d) * step, p.z + (dz / d) * step, MOVE.radius);
        speed = Math.hypot(nx - p.x, nz - p.z) / Math.max(dt, 1e-4);
        p.x = nx;
        p.z = nz;
        p.facing = Math.atan2(dx, dz);
      }
    } else if (distToLeader < 1.0) {
      // 近すぎるときは少し離れる
      const dx = p.x - L.x, dz = p.z - L.z;
      const d = Math.max(0.01, Math.hypot(dx, dz));
      const [nx, nz] = this.world.resolve(p.x + (dx / d) * 1.5 * dt, p.z + (dz / d) * 1.5 * dt, MOVE.radius);
      p.x = nx;
      p.z = nz;
    } else {
      // 立ち止まったら主人公の方を向く
      if (L.speed < 0.1) p.facing = Math.atan2(L.x - p.x, L.z - p.z);
    }
    p.speed = speed;
    p.sync(dt);
  }

  private pickTrailPoint() {
    const trail = this.leader.trail;
    const L = this.leader.pawn;
    // 主人公から followDistance 以上離れた最新の軌跡点を目標にする
    for (let i = trail.length - 1; i >= 0; i--) {
      if (Math.hypot(trail[i].x - L.x, trail[i].z - L.z) >= this.followDistance) return trail[i];
    }
    return trail[0] ?? null;
  }

  teleportBehindLeader() {
    const L = this.leader.pawn;
    const [x, z] = this.world.resolve(L.x - Math.sin(L.facing) * 1.8 + 0.6, L.z - Math.cos(L.facing) * 1.8, MOVE.radius);
    this.pawn.place(x, z, L.facing);
  }
}
