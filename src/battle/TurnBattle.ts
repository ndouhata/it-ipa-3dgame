// ターン制戦闘のロジック（3D・画面に非依存）。
// 1ターン：主人公の攻撃（問題の結果で倍率）→ パートナーの攻撃 → 敵の一斉攻撃（問題の結果で被ダメージ倍率）
import type { EnemyDefinition } from '../data/schema';

export interface Fighter {
  id: string;
  kind: 'hero' | 'partner' | 'enemy';
  name: string;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  alive: boolean;
  enemy?: EnemyDefinition;
}

export type BattleEvent =
  | { type: 'attack'; sourceId: string; targetId: string }
  | { type: 'damage'; sourceId: string; targetId: string; amount: number; mult: number }
  | { type: 'defeated'; id: string };

export interface DamageConfig { defFactor: number; variance: number; min: number }

export interface FighterInit { name: string; maxHp: number; hp: number; atk: number; def: number }

export class TurnBattle {
  readonly fighters: Fighter[] = [];
  targetId: string | null = null;

  constructor(hero: FighterInit, partner: FighterInit | null, enemies: { id: string; def: EnemyDefinition }[], private dmg: DamageConfig, private rand: () => number = Math.random) {
    this.fighters.push({ ...hero, id: 'hero', kind: 'hero', alive: hero.hp > 0 });
    if (partner) this.fighters.push({ ...partner, id: 'partner', kind: 'partner', alive: partner.hp > 0 });
    for (const e of enemies) {
      const s = e.def.stats;
      this.fighters.push({ id: e.id, kind: 'enemy', name: e.def.name, maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, alive: true, enemy: e.def });
    }
    this.targetId = this.enemies()[0]?.id ?? null;
  }

  get(id: string | null) { return id ? this.fighters.find((f) => f.id === id) ?? null : null; }
  hero() { return this.fighters[0]; }
  partner() { return this.fighters.find((f) => f.kind === 'partner') ?? null; }
  enemies() { return this.fighters.filter((f) => f.kind === 'enemy' && f.alive); }
  allies() { return this.fighters.filter((f) => f.kind !== 'enemy' && f.alive); }
  get won() { return this.enemies().length === 0; }
  get lost() { return !this.hero().alive; }

  setTarget(id: string) {
    const t = this.get(id);
    if (t?.kind === 'enemy' && t.alive) this.targetId = id;
  }

  private target(): Fighter | null {
    const t = this.get(this.targetId);
    if (t?.alive) return t;
    this.targetId = this.enemies()[0]?.id ?? null;
    return this.get(this.targetId);
  }

  /** 防御を引いた後に倍率を掛ける（倍率が小さくても0にならないように） */
  private calc(atk: number, def: number, mult: number) {
    const v = 1 + (this.rand() * 2 - 1) * this.dmg.variance;
    return Math.max(this.dmg.min, Math.round(Math.max(1, atk - def * this.dmg.defFactor) * mult * v));
  }

  private hit(src: Fighter, t: Fighter, mult: number, out: BattleEvent[]) {
    out.push({ type: 'attack', sourceId: src.id, targetId: t.id });
    const amount = this.calc(src.atk, t.def, mult);
    t.hp = Math.max(0, t.hp - amount);
    out.push({ type: 'damage', sourceId: src.id, targetId: t.id, amount, mult });
    if (t.hp === 0) {
      t.alive = false;
      out.push({ type: 'defeated', id: t.id });
    }
  }

  heroAttack(mult: number): BattleEvent[] {
    const out: BattleEvent[] = [];
    const t = this.target();
    if (t && this.hero().alive) this.hit(this.hero(), t, mult, out);
    return out;
  }

  partnerAttack(): BattleEvent[] {
    const out: BattleEvent[] = [];
    const p = this.partner();
    const t = this.target();
    if (p?.alive && t) this.hit(p, t, 1, out);
    return out;
  }

  /** 敵の一斉攻撃。防御問題の結果（倍率）が全員の被ダメージに掛かる */
  enemiesAttack(mult: number): BattleEvent[] {
    const out: BattleEvent[] = [];
    for (const e of this.enemies()) {
      const allies = this.allies();
      if (!allies.length) break;
      const hero = allies.find((a) => a.kind === 'hero');
      const t = hero && this.rand() < 0.7 ? hero : allies[Math.floor(this.rand() * allies.length)];
      this.hit(e, t, mult, out);
    }
    return out;
  }
}
