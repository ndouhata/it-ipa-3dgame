// セーブデータ＋ゲームデータに対する純ロジック（3D非依存）。成長・所持品・装備・スキル・クエスト状態・条件判定。
import type { GameData } from '../data/registry';
import type { Condition } from '../data/schema';
import type { EventBus } from '../core/EventBus';
import type { QuestProgress, SaveData } from '../save/SaveData';
import { getProgress, recordKnowledgeEvent, markFormalTerm } from '../learning/Learning';
import type { KnowledgeEvent } from '../save/SaveData';

export type Stats = Record<string, number>;
export type Cost = { itemId: string; count: number }[];

export class GameState {
  constructor(public save: SaveData, readonly data: GameData, readonly bus: EventBus) {
    if (this.save.player.hp < 0) this.save.player.hp = this.heroStats().hp;
    for (const [id, s] of this.data.skills) if (s.startsUnlocked) this.save.skills[id] ??= { unlocked: true, level: 1 };
  }

  // ---------- 条件 ----------
  check(conds: Condition[] | undefined): boolean {
    if (!conds) return true;
    return conds.every((c) => {
      if (c.flag && !this.save.flags[c.flag]) return false;
      if (c.notFlag && this.save.flags[c.notFlag]) return false;
      if (c.questState && this.quest(c.questState.questId).state !== c.questState.state) return false;
      if (c.questStepAtLeast && this.quest(c.questStepAtLeast.questId).step < c.questStepAtLeast.step) return false;
      if (c.masteryAtLeast && this.mastery(c.masteryAtLeast.knowledgeId) < c.masteryAtLeast.level) return false;
      if (c.masteryBelow && this.mastery(c.masteryBelow.knowledgeId) >= c.masteryBelow.level) return false;
      return true;
    });
  }

  setFlag(flag: string, v = true) {
    if (!!this.save.flags[flag] === v) return;
    this.save.flags[flag] = v;
    this.bus.emit('flagChanged', { flag });
  }

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

  equipmentStats(): Stats {
    const out: Stats = {};
    for (const uid of Object.values(this.save.equipment)) {
      const owned = this.save.ownedEquipment.find((e) => e.uid === uid);
      const def = owned && this.data.equipment.get(owned.equipId);
      if (!owned || !def) continue;
      for (const [k, v] of Object.entries(def.baseStats)) out[k] = (out[k] ?? 0) + v;
      for (const [k, v] of Object.entries(def.perEnhance)) out[k] = (out[k] ?? 0) + v * owned.enhance;
    }
    return out;
  }

  heroStats(): Stats {
    const base = this.baseStatsAt(this.save.player.level);
    const eq = this.equipmentStats();
    for (const [k, v] of Object.entries(eq)) base[k] = (base[k] ?? 0) + v;
    return base;
  }

  partnerStats(): Stats {
    const base = this.baseStatsAt(this.save.player.level);
    const ratio = this.data.progression.partnerRatio;
    const out: Stats = {};
    for (const [k, v] of Object.entries(base)) out[k] = Math.round(v * (ratio[k] ?? 1));
    return out;
  }

  /** EXP加算。レベルアップごとにステータス差分付きでイベントを出す */
  addExp(amount: number) {
    const p = this.save.player;
    const max = this.data.progression.maxLevel;
    p.exp += amount;
    const ups: { from: number; to: number }[] = [];
    while (p.level < max && p.exp >= this.expToNext(p.level)) {
      p.exp -= this.expToNext(p.level);
      const before = this.heroStats();
      p.level++;
      const after = this.heroStats();
      const diff: Record<string, [number, number]> = {};
      for (const k of Object.keys(after)) diff[k] = [before[k] ?? 0, after[k]];
      p.hp = Math.min(after.hp, p.hp + (after.hp - before.hp));
      this.bus.emit('levelUp', { from: p.level - 1, to: p.level, diff });
      ups.push({ from: p.level - 1, to: p.level });
    }
    if (p.level >= max) p.exp = 0;
    return ups;
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
    if (!def) return;
    this.save.equipment[def.slot] = uid;
  }

  unequip(slot: 'weapon' | 'armor' | 'accessory') { this.save.equipment[slot] = null; }

  /** 装備による分散ノード（受け皿）の数と性能 */
  distributionNodes(): { count: number; hp: number; def: number } {
    let count = 0, hp = 0, def = 0;
    for (const uid of Object.values(this.save.equipment)) {
      const owned = this.save.ownedEquipment.find((e) => e.uid === uid);
      const d = owned && this.data.equipment.get(owned.equipId);
      if (!d?.grants?.distributionNodes) continue;
      count += d.grants.distributionNodes;
      hp = Math.max(hp, (d.grants.nodeHp ?? 100) + owned!.enhance * 30);
      def = Math.max(def, (d.grants.nodeDef ?? 0) + owned!.enhance * 2);
    }
    return { count, hp, def };
  }

  // ---------- スキル ----------
  skillUnlocked(id: string) { return !!this.save.skills[id]?.unlocked; }

  unlockSkill(id: string) {
    if (this.skillUnlocked(id)) return;
    this.save.skills[id] = { unlocked: true, level: 1 };
    this.bus.emit('skillUnlocked', { skillId: id });
  }

  /** 強化済みのレベル（素材で上げたもの） */
  ownedSkillLevel(id: string) { return this.save.skills[id]?.level ?? 0; }

  /** 強化の上限＝関連知識の習熟度。知識に紐づかないスキルは上限なし */
  skillCap(id: string) {
    const def = this.data.skills.get(id);
    if (!def || def.knowledgeIds.length === 0) return def?.levels.length ?? 1;
    return Math.max(1, Math.min(...def.knowledgeIds.map((k) => this.mastery(k))));
  }

  /** 戦闘で実際に使われるレベル。習熟度が下がると下がる（強化済みの分は失われず、習熟が戻れば復帰） */
  effectiveSkillLevel(id: string) {
    const owned = this.ownedSkillLevel(id);
    if (owned === 0) return 0;
    return Math.min(owned, this.skillCap(id));
  }

  nextSkillUpgrade(id: string) {
    const def = this.data.skills.get(id);
    const owned = this.ownedSkillLevel(id);
    if (!def || owned === 0) return null;
    const next = def.levels.find((l) => l.level === owned + 1);
    if (!next) return null;
    return { next, capped: next.level > this.skillCap(id) };
  }

  upgradeSkill(id: string) {
    const up = this.nextSkillUpgrade(id);
    if (!up || up.capped || !this.pay(up.next.cost)) return false;
    this.save.skills[id].level = up.next.level;
    return true;
  }

  // ---------- 知識 ----------
  mastery(knowledgeId: string) { return getProgress(this.save, knowledgeId).mastery; }

  recordKnowledge(ev: Omit<KnowledgeEvent, 'at'>) {
    const { before, after } = recordKnowledgeEvent(this.save, this.data.masteryRules, ev);
    this.bus.emit('knowledge', ev);
    if (before !== after) this.bus.emit('masteryChanged', { knowledgeId: ev.knowledgeId, from: before, to: after });
  }

  learnFormalTerm(knowledgeId: string) {
    const { before, after } = markFormalTerm(this.save, this.data.masteryRules, knowledgeId);
    if (before !== after) this.bus.emit('masteryChanged', { knowledgeId, from: before, to: after });
  }

  // ---------- クエスト ----------
  quest(id: string): QuestProgress {
    return (this.save.quests[id] ??= { state: 'inactive', step: 0, clears: 0, bestTimeMs: null, lastTimeMs: null });
  }
}
