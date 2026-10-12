// シームレス・リアルタイムコマンド戦闘のロジック（3D非依存）。
// 通常攻撃は自動。敵の大技は「予兆」→判断→解決。分散陣はダメージを受け皿へ実際に振り分ける。
import type { BehaviorSpec, EnemyDefinition, SkillDefinition } from '../data/schema';
import type { KnowledgeEvent } from '../save/SaveData';

export type DistributionMode = 'roundRobin' | 'healthCheck' | 'weighted';

export interface Combatant {
  id: string;
  side: 'ally' | 'enemy';
  kind: 'hero' | 'partner' | 'node' | 'enemy';
  name: string;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  alive: boolean;
  attackInterval: number;
  attackTimer: number;
  enemy?: EnemyDefinition;
  behaviorTimers?: number[];
  charging?: ChargeState | null;
}

export interface ChargeState {
  behavior: BehaviorSpec;
  remaining: number;
  total: number;
  targetId: string | null;
  /** 予兆の間に分散陣を使える状態だったか（使えなかったミスは責めない） */
  distributionWasReady: boolean;
  distributionUsed: boolean;
  guardUsed: boolean;
}

export type BattleEvent =
  | { type: 'attack'; sourceId: string; targetId: string }
  | { type: 'damage'; targetId: string; amount: number; style: 'normal' | 'skill' | 'focus' | 'spread' | 'split' | 'guarded' }
  | { type: 'telegraph'; sourceId: string; name: string; action: BehaviorSpec['action']; targetId: string | null; duration: number }
  | { type: 'telegraphEnd'; sourceId: string }
  | { type: 'distribute'; sourceId: string; total: number; mode: DistributionMode; parts: { targetId: string; raw: number }[] }
  | { type: 'heal'; targetId: string; amount: number }
  | { type: 'defeated'; id: string }
  | { type: 'skill'; skillId: string; ok: boolean; reason?: string }
  | { type: 'notice'; text: string; tone: 'good' | 'bad' | 'info' }
  | { type: 'hint'; trigger: string }
  | { type: 'end'; result: 'victory' | 'defeat' };

export interface AllyInit {
  id: string;
  kind: 'hero' | 'partner' | 'node';
  name: string;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  attackInterval: number;
}

export interface SkillSlot {
  def: SkillDefinition;
  level: number;
}

export interface BattleConfig {
  allies: AllyInit[];
  enemies: { id: string; def: EnemyDefinition }[];
  skills: SkillSlot[];
  damage: { defFactor: number; variance: number; min: number };
  rand?: () => number;
  onKnowledge?: (ev: Omit<KnowledgeEvent, 'at'>) => void;
}

export interface BattleStats {
  elapsed: number;
  damageTaken: number;
  focusBlasts: number;
  focusDistributed: number;
  knockouts: number;
}

const DIST_KNOWLEDGE = 'load-balancing';

export class BattleSystem {
  readonly combatants: Combatant[] = [];
  private events: BattleEvent[] = [];
  private cooldowns = new Map<string, number>();
  private distributeUntil = -1;
  private distributeMode: DistributionMode = 'roundRobin';
  private guardUntil = -1;
  private partnerHealTimer = 4;
  private rand: () => number;
  time = 0;
  ended: 'victory' | 'defeat' | null = null;
  targetId: string | null = null;
  readonly stats: BattleStats = { elapsed: 0, damageTaken: 0, focusBlasts: 0, focusDistributed: 0, knockouts: 0 };

  constructor(private cfg: BattleConfig) {
    this.rand = cfg.rand ?? Math.random;
    for (const a of cfg.allies) {
      this.combatants.push({ ...a, side: 'ally', alive: a.hp > 0, attackTimer: 0.4 + this.rand() * 0.5 });
    }
    for (const e of cfg.enemies) {
      const d = e.def;
      this.combatants.push({
        id: e.id, side: 'enemy', kind: 'enemy', name: d.name,
        maxHp: d.stats.hp, hp: d.stats.hp, atk: d.stats.atk, def: d.stats.def, alive: true,
        attackInterval: d.attackInterval, attackTimer: 1 + this.rand() * d.attackInterval,
        enemy: d, behaviorTimers: d.behaviors.map((b) => b.firstAt), charging: null,
      });
    }
    this.targetId = this.enemies()[0]?.id ?? null;
    if (cfg.enemies.some((e) => e.def.rank === 'boss')) this.events.push({ type: 'hint', trigger: 'battle:boss' });
  }

  // ---------- 参照 ----------
  get(id: string | null) { return id ? this.combatants.find((c) => c.id === id) ?? null : null; }
  allies() { return this.combatants.filter((c) => c.side === 'ally' && c.alive); }
  fighters() { return this.allies().filter((c) => c.kind !== 'node'); }
  enemies() { return this.combatants.filter((c) => c.side === 'enemy' && c.alive); }
  hero() { return this.combatants.find((c) => c.kind === 'hero')!; }
  partner() { return this.combatants.find((c) => c.kind === 'partner') ?? null; }
  slot(id: string) { return this.cfg.skills.find((s) => s.def.id === id) ?? null; }
  cooldown(id: string) { return Math.max(0, this.cooldowns.get(id) ?? 0); }
  cooldownTotal(id: string) {
    const s = this.slot(id);
    if (!s) return 1;
    return s.def.levels.find((l) => l.level === s.level)?.cooldown ?? s.def.cooldown;
  }
  isDistributing() { return this.time <= this.distributeUntil; }
  isGuarding() { return this.time <= this.guardUntil; }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  private dmg(atk: number, def: number, mult = 1) {
    const d = this.cfg.damage;
    const v = 1 + (this.rand() * 2 - 1) * d.variance;
    return Math.max(d.min, Math.round((atk * mult - def * d.defFactor) * v));
  }

  private applyDamage(t: Combatant, amount: number, style: Extract<BattleEvent, { type: 'damage' }>['style']) {
    if (!t.alive) return;
    t.hp = Math.max(0, t.hp - amount);
    if (t.side === 'ally') this.stats.damageTaken += amount;
    this.events.push({ type: 'damage', targetId: t.id, amount, style });
    if (t.hp <= 0) {
      t.alive = false;
      t.charging = null;
      if (t.side === 'ally' && t.kind !== 'node') this.stats.knockouts++;
      this.events.push({ type: 'defeated', id: t.id });
      if (t.id === this.targetId) this.targetId = this.enemies()[0]?.id ?? null;
    }
  }

  // ---------- スキル ----------
  useSkill(id: string): boolean {
    const fail = (reason: string) => { this.events.push({ type: 'skill', skillId: id, ok: false, reason }); return false; };
    if (this.ended) return false;
    const s = this.slot(id);
    if (!s || s.level <= 0) return fail('まだ使えない');
    if (!this.hero().alive) return fail('主人公が戦闘不能');
    if (this.cooldown(id) > 0) return fail('準備中');
    const lv = s.def.levels.find((l) => l.level === s.level) ?? s.def.levels[0];
    this.cooldowns.set(id, lv.cooldown);
    this.events.push({ type: 'skill', skillId: id, ok: true });
    switch (s.def.effect) {
      case 'powerStrike': {
        const t = this.get(this.targetId) ?? this.enemies()[0];
        if (t) {
          this.events.push({ type: 'attack', sourceId: this.hero().id, targetId: t.id });
          this.applyDamage(t, this.dmg(this.hero().atk, t.def, s.def.power ?? 2), 'skill');
        }
        break;
      }
      case 'distribute': {
        this.distributeUntil = this.time + (s.def.window ?? 3);
        this.distributeMode = lv.mode ?? 'roundRobin';
        let anyCharge = false;
        for (const e of this.enemies()) {
          if (!e.charging) continue;
          anyCharge = true;
          e.charging.distributionUsed = true;
        }
        if (!anyCharge) this.events.push({ type: 'notice', text: '分散陣を展開した……が、狙われている気配はない', tone: 'info' });
        break;
      }
      case 'guard': {
        this.guardUntil = this.time + (s.def.window ?? 2.5);
        for (const e of this.enemies()) if (e.charging) e.charging.guardUsed = true;
        break;
      }
    }
    return true;
  }

  setTarget(id: string) {
    const t = this.get(id);
    if (t?.alive && t.side === 'enemy') this.targetId = id;
  }

  private distributionReady() {
    const s = this.slot('distribution-array');
    return !!s && s.level > 0 && this.cooldown('distribution-array') <= 0 && this.hero().alive;
  }

  // ---------- 進行 ----------
  tick(dt: number) {
    if (this.ended) return;
    this.time += dt;
    this.stats.elapsed = this.time;
    for (const [k, v] of this.cooldowns) this.cooldowns.set(k, v - dt);

    // 味方の通常攻撃
    for (const a of this.fighters()) {
      a.attackTimer -= dt;
      if (a.attackTimer > 0) continue;
      a.attackTimer = a.attackInterval;
      const t = this.get(this.targetId) ?? this.enemies()[0];
      if (!t) break;
      this.events.push({ type: 'attack', sourceId: a.id, targetId: t.id });
      this.applyDamage(t, this.dmg(a.atk, t.def), 'normal');
    }

    // パートナーAI：HPの割合が最も低い仲間（自分含む）が危なくなったら回復
    const partner = this.partner();
    if (partner?.alive) {
      this.partnerHealTimer -= dt;
      const weakest = this.fighters().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (this.partnerHealTimer <= 0 && weakest && weakest.hp < weakest.maxHp * 0.35) {
        const amount = Math.round(weakest.maxHp * 0.3);
        weakest.hp = Math.min(weakest.maxHp, weakest.hp + amount);
        this.events.push({ type: 'heal', targetId: weakest.id, amount });
        this.partnerHealTimer = 10;
      }
    }

    for (const e of this.enemies()) this.tickEnemy(e, dt);

    if (this.enemies().length === 0) this.finish('victory');
    else if (this.fighters().length === 0) this.finish('defeat');
  }

  private finish(result: 'victory' | 'defeat') {
    this.ended = result;
    this.events.push({ type: 'end', result });
  }

  private tickEnemy(e: Combatant, dt: number) {
    const d = e.enemy!;
    if (e.charging) {
      const c = e.charging;
      c.remaining -= dt;
      if (this.distributionReady()) c.distributionWasReady = true;
      if (this.isDistributing()) c.distributionUsed = true;
      if (this.isGuarding()) c.guardUsed = true;
      if (c.remaining <= 0) this.resolveBehavior(e, c);
      return;
    }
    const enraged = e.hp < e.maxHp * 0.5;
    d.behaviors.forEach((b, i) => {
      e.behaviorTimers![i] -= dt;
      if (e.behaviorTimers![i] <= 0 && !e.charging) {
        e.behaviorTimers![i] = enraged && b.enrageEvery ? b.enrageEvery : b.every;
        this.startCharge(e, b);
      }
    });
    if (e.charging) return;
    e.attackTimer -= dt;
    if (e.attackTimer <= 0) {
      e.attackTimer = e.attackInterval;
      const targets = this.fighters();
      if (!targets.length) return;
      const hero = targets.find((t) => t.kind === 'hero');
      const t = hero && this.rand() < 0.6 ? hero : targets[Math.floor(this.rand() * targets.length)];
      this.events.push({ type: 'attack', sourceId: e.id, targetId: t.id });
      let amount = this.dmg(e.atk, t.def);
      if (t.kind === 'hero' && this.isGuarding()) amount = Math.max(1, Math.round(amount / 2));
      this.applyDamage(t, amount, 'normal');
    }
  }

  private startCharge(e: Combatant, b: BehaviorSpec) {
    let targetId: string | null = null;
    if (b.action === 'focusBlast') {
      const fighters = this.fighters();
      if (b.target === 'hero') targetId = fighters.find((f) => f.kind === 'hero')?.id ?? fighters[0]?.id ?? null;
      else if (b.target === 'highestHp') targetId = [...fighters].sort((a, c) => c.hp - a.hp)[0]?.id ?? null;
      else targetId = fighters[Math.floor(this.rand() * fighters.length)]?.id ?? null;
    }
    e.charging = {
      behavior: b, remaining: b.telegraph, total: b.telegraph, targetId,
      distributionWasReady: this.distributionReady(), distributionUsed: false, guardUsed: false,
    };
    this.events.push({ type: 'telegraph', sourceId: e.id, name: b.name, action: b.action, targetId, duration: b.telegraph });
    this.events.push({ type: 'hint', trigger: b.action === 'focusBlast' ? 'battle:focus' : 'battle:spread' });
  }

  private resolveBehavior(e: Combatant, c: ChargeState) {
    e.charging = null;
    e.attackTimer = e.attackInterval;
    this.events.push({ type: 'telegraphEnd', sourceId: e.id });
    const b = c.behavior;
    const record = (kind: 'application' | 'discrimination', correct: boolean) =>
      this.cfg.onKnowledge?.({ knowledgeId: DIST_KNOWLEDGE, kind, variant: 'battle-focus', correct });

    if (b.action === 'focusBlast') {
      this.stats.focusBlasts++;
      const target = this.get(c.targetId);
      if (c.distributionUsed && this.allies().length > 1) {
        this.distribute(e, b.power);
        this.stats.focusDistributed++;
        record('application', true);
        record('discrimination', true);
        this.events.push({ type: 'notice', text: '衝撃を分散した！', tone: 'good' });
      } else {
        if (target?.alive) {
          let amount = Math.max(1, Math.round(b.power - target.def * this.cfg.damage.defFactor));
          const guarded = target.kind === 'hero' && (c.guardUsed || this.isGuarding());
          if (guarded) amount = Math.round(amount / 2);
          this.applyDamage(target, amount, guarded ? 'guarded' : 'focus');
        }
        // 分散陣を使える状態だったのに一点で受けた＝見極めの失敗（防御で凌いだ場合は中立）
        if (c.distributionWasReady && !c.guardUsed) record('discrimination', false);
      }
    } else {
      // 全体攻撃はそもそも分散されている。分散陣を使っても意味がない
      for (const a of this.allies()) {
        let amount = Math.max(1, Math.round(b.power - a.def * this.cfg.damage.defFactor));
        if (a.kind === 'hero' && (c.guardUsed || this.isGuarding())) amount = Math.round(amount / 2);
        this.applyDamage(a, amount, 'spread');
      }
      if (c.distributionUsed) {
        record('discrimination', false);
        this.events.push({ type: 'notice', text: '全体への攻撃は、すでに分散されている――分散陣の効果がない！', tone: 'bad' });
        this.events.push({ type: 'hint', trigger: 'battle:misuse' });
      } else if (c.distributionWasReady) {
        record('discrimination', true);
      }
    }
  }

  /** 実際の負荷分散方式どおりに振り分ける */
  private distribute(source: Combatant, total: number) {
    const parts = splitLoad(this.allies(), total, this.distributeMode, this.cfg.damage.defFactor);
    this.events.push({ type: 'distribute', sourceId: source.id, total, mode: this.distributeMode, parts: parts.map((p) => ({ targetId: p.c.id, raw: p.raw })) });
    for (const p of parts) {
      const amount = Math.max(1, Math.round(p.raw - p.c.def * this.cfg.damage.defFactor));
      this.applyDamage(p.c, amount, 'split');
    }
    this.distributeUntil = -1;
  }
}

/**
 * 負荷分散の方式。
 * - roundRobin : 全員で均等に受け持つ（ラウンドロビン）
 * - healthCheck: 受けたら倒れる者を外して残りで受け持つ（ヘルスチェック）
 * - weighted   : 残りの耐久力に応じた比率で受け持つ（重み付け）
 */
export function splitLoad(pool: Combatant[], total: number, mode: DistributionMode, defFactor: number) {
  let members = [...pool];
  const effective = (c: Combatant) => c.hp + c.def * defFactor;
  if (mode === 'healthCheck' || mode === 'weighted') {
    for (let guard = 0; guard < pool.length; guard++) {
      const share = total / members.length;
      const healthy = members.filter((m) => effective(m) > share);
      if (healthy.length === members.length || healthy.length === 0) break;
      members = healthy;
    }
  }
  if (mode === 'weighted') {
    const sum = members.reduce((s, m) => s + effective(m), 0);
    return members.map((c) => ({ c, raw: Math.round((total * effective(c)) / sum) }));
  }
  return members.map((c) => ({ c, raw: Math.round(total / members.length) }));
}
