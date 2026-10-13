// セーブデータ＋ゲームデータに対する純ロジック（3D非依存）。成長・所持品・装備・クエスト解放・習熟度。
import type { GameData } from '../data/registry';
import type { EventBus } from '../core/EventBus';
import type { EnemyDefinition } from '../data/schema';
import type { QuestProgress, SaveData } from '../save/SaveData';
import { completion, knowledgeMastery } from '../quiz/Mastery';

export type Stats = Record<string, number>;
export type Cost = { itemId: string; count: number }[];

export class GameState {
  constructor(public save: SaveData, readonly data: GameData, readonly bus: EventBus) {}

  // ---------- 成長 ----------
  expToNext(level: number) {
    const c = this.data.progression.expCurve;
    return Math.round(c.base * Math.pow(level, c.exponent));
  }

  baseStatsAt(level: number): Stats {
    const p = this.data.progression;
    const out: Stats = {};
    for (const [k, v] of Object.entries(p.baseStats)) out[k] = Math.round(v + (p.growthPerLevel[k] ?? 0) * (level - 1));
    return out;
  }

  private equipped() {
    return Object.values(this.save.equipment)
      .map((uid) => this.save.ownedEquipment.find((e) => e.uid === uid))
      .filter((o): o is NonNullable<typeof o> => !!o)
      .map((o) => ({ owned: o, def: this.data.equipment.get(o.equipId)! }))
      .filter((x) => !!x.def);
  }

  equipmentStats(): Stats {
    const out: Stats = {};
    for (const { owned, def } of this.equipped()) {
      for (const [k, v] of Object.entries(def.baseStats)) out[k] = (out[k] ?? 0) + v;
      for (const [k, v] of Object.entries(def.perEnhance)) out[k] = (out[k] ?? 0) + v * owned.enhance;
    }
    return out;
  }

  heroStats(): Stats {
    const base = this.baseStatsAt(this.save.player.level);
    for (const [k, v] of Object.entries(this.equipmentStats())) base[k] = (base[k] ?? 0) + v;
    return base;
  }

  partnerStats(): Stats {
    const base = this.baseStatsAt(this.save.player.level);
    const ratio = this.data.progression.partnerRatio;
    const out: Stats = {};
    for (const [k, v] of Object.entries(base)) out[k] = Math.round(v * (ratio[k] ?? 1));
    return out;
  }

  /** 装備による「速攻」判定時間の延長（秒） */
  fastBonusSec() {
    let s = 0;
    for (const { owned, def } of this.equipped()) s += (def.grants?.fastBonusSec ?? 0) + (def.grantsPerEnhance?.fastBonusSec ?? 0) * owned.enhance;
    return s;
  }

  addExp(amount: number) {
    const p = this.save.player;
    const max = this.data.progression.maxLevel;
    p.exp += amount;
    while (p.level < max && p.exp >= this.expToNext(p.level)) {
      p.exp -= this.expToNext(p.level);
      const before = this.heroStats();
      p.level++;
      const after = this.heroStats();
      const diff: Record<string, [number, number]> = {};
      for (const k of Object.keys(after)) diff[k] = [before[k] ?? 0, after[k]];
      this.bus.emit('levelUp', { from: p.level - 1, to: p.level, diff });
    }
    if (p.level >= max) p.exp = 0;
  }

  // ---------- 所持品 ----------
  count(itemId: string) { return this.save.inventory[itemId] ?? 0; }

  addItem(itemId: string, n: number) {
    this.save.inventory[itemId] = this.count(itemId) + n;
    const rare = this.data.materials.get(itemId)?.rarity === 'rare';
    this.bus.emit('itemGained', { itemId, count: n, rare });
  }

  canAfford(cost: Cost) { return cost.every((c) => this.count(c.itemId) >= c.count); }

  pay(cost: Cost) {
    if (!this.canAfford(cost)) return false;
    for (const c of cost) this.save.inventory[c.itemId] -= c.count;
    return true;
  }

  itemName(id: string) {
    const m = this.data.materials.get(id);
    if (m) return `${m.icon}${m.name}`;
    const e = this.data.equipment.get(id);
    return e ? `${e.icon}${e.name}` : id;
  }

  // ---------- 装備 ----------
  ownedOf(equipId: string) { return this.save.ownedEquipment.find((e) => e.equipId === equipId) ?? null; }

  craft(equipId: string) {
    const def = this.data.equipment.get(equipId);
    if (!def || this.ownedOf(equipId) || !this.pay(def.recipe)) return null;
    const owned = { uid: `${equipId}-${Date.now().toString(36)}`, equipId, enhance: 0 };
    this.save.ownedEquipment.push(owned);
    this.equip(owned.uid);
    return owned;
  }

  enhanceCost(uid: string): Cost | null {
    const owned = this.save.ownedEquipment.find((e) => e.uid === uid);
    const def = owned && this.data.equipment.get(owned.equipId);
    if (!owned || !def || owned.enhance >= def.maxEnhance) return null;
    return def.enhanceCost[owned.enhance] ?? null;
  }

  enhance(uid: string) {
    const owned = this.save.ownedEquipment.find((e) => e.uid === uid);
    const cost = this.enhanceCost(uid);
    if (!owned || !cost || !this.pay(cost)) return false;
    owned.enhance++;
    return true;
  }

  equip(uid: string) {
    const owned = this.save.ownedEquipment.find((e) => e.uid === uid);
    const def = owned && this.data.equipment.get(owned.equipId);
    if (def) this.save.equipment[def.slot] = uid;
  }

  unequip(slot: 'weapon' | 'armor' | 'accessory') { this.save.equipment[slot] = null; }

  // ---------- クエスト ----------
  quest(id: string): QuestProgress {
    return (this.save.quests[id] ??= { clears: 0, bestTimeMs: null, lastTimeMs: null, bestAccuracy: null });
  }

  isUnlocked(questId: string) {
    const q = this.data.quests.get(questId);
    return !!q && (!q.unlockAfter || this.quest(q.unlockAfter).clears > 0);
  }

  // ---------- 敵の強さ ----------
  /** 推奨レベルより低いときは、敵を「自分のレベル＋1」相当に弱める（どの分野からでも勉強できるように） */
  enemyLevelFor(questId: string) {
    const q = this.data.quests.get(questId)!;
    return Math.min(q.recommendedLevel, this.save.player.level + 1);
  }

  /** 推奨レベル基準で定義された敵を、実際の敵レベルに合わせて換算する */
  scaledEnemy(def: EnemyDefinition, questLevel: number, level: number): EnemyDefinition {
    if (level >= questLevel) return def;
    const a = this.baseStatsAt(level), b = this.baseStatsAt(questLevel);
    const atkRatio = a.atk / b.atk, hpRatio = a.hp / b.hp;
    const s = def.stats;
    return {
      ...def,
      stats: { ...s, hp: Math.max(1, Math.round(s.hp * atkRatio)), def: Math.round(s.def * atkRatio), atk: Math.max(1, Math.round(s.atk * hpRatio)) },
      exp: Math.max(1, Math.round(def.exp * this.expToNext(level) / this.expToNext(questLevel))),
    };
  }

  // ---------- 問題の進み具合 ----------
  questionsFor(knowledgeIds: string[]) {
    return this.data.exams.questions.filter((q) => q.knowledgeIds.some((k) => knowledgeIds.includes(k)));
  }

  questCompletion(questId: string) {
    const q = this.data.quests.get(questId)!;
    return completion(this.questionsFor(q.knowledgeIds), this.save, this.data.progression.quiz.masteredStreak);
  }

  /** 試験（クエストの見出し）全体の進み具合 */
  groupCompletion(group: string) {
    const ids = new Set(this.data.questList.filter((q) => q.group === group).flatMap((q) => q.knowledgeIds));
    return completion(this.questionsFor([...ids]), this.save, this.data.progression.quiz.masteredStreak);
  }

  groups() {
    return [...new Set(this.data.questList.map((q) => q.group))];
  }

  // ---------- 習熟度 ----------
  mastery(knowledgeId: string) {
    return knowledgeMastery(knowledgeId, this.data.exams.questions, this.save, this.data.masteryRules, this.data.progression.quiz.masteredStreak);
  }
}
