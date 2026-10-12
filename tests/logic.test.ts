import { describe, it, expect } from 'vitest';
import { loadGameData } from '../src/data/registry';
import { BattleSystem, splitLoad, type Combatant } from '../src/battle/BattleSystem';
import { rollDrops } from '../src/inventory/Drops';
import { DistributionPuzzle } from '../src/gimmick/DistributionPuzzle';
import { createNewSave } from '../src/save/SaveData';
import { recordKnowledgeEvent, getProgress, markFormalTerm } from '../src/learning/Learning';
import { GameState } from '../src/game/GameState';
import { EventBus } from '../src/core/EventBus';

const data = loadGameData();
const rules = data.masteryRules;

const ally = (id: string, hp: number, def = 0): Combatant => ({
  id, side: 'ally', kind: 'hero', name: id, maxHp: hp, hp, atk: 10, def, alive: true, attackInterval: 1, attackTimer: 1,
});

describe('データ', () => {
  it('全データが読み込め、参照が解決できる', () => {
    expect(data.knowledge.get('load-balancing')?.nameEn).toBe('Load Balancing');
    expect(data.quests.get('trade-road')?.run?.segments.length).toBe(4);
  });
});

describe('負荷分散の分配', () => {
  it('ラウンドロビン：均等に分ける（1200 → 400/400/400）', () => {
    const parts = splitLoad([ally('a', 1000), ally('b', 1000), ally('c', 1000)], 1200, 'roundRobin', 0.5);
    expect(parts.map((p) => p.raw)).toEqual([400, 400, 400]);
  });
  it('ヘルスチェック：受けたら倒れる者を外す', () => {
    const parts = splitLoad([ally('a', 1000), ally('b', 100), ally('c', 1000)], 1200, 'healthCheck', 0.5);
    expect(parts.map((p) => p.c.id)).toEqual(['a', 'c']);
    expect(parts.map((p) => p.raw)).toEqual([600, 600]);
  });
  it('重み付け：耐久力に比例して分ける', () => {
    const parts = splitLoad([ally('a', 600), ally('b', 300)], 300, 'weighted', 0.5);
    expect(parts.map((p) => p.raw)).toEqual([200, 100]);
  });
});

describe('戦闘', () => {
  const ogre = data.enemies.get('boss-ogre')!;
  const skills = [
    { def: data.skills.get('distribution-array')!, level: 1 },
    { def: data.skills.get('guard')!, level: 1 },
  ];
  const make = (events: { kind: string; correct: boolean }[]) => new BattleSystem({
    allies: [
      { id: 'hero', kind: 'hero', name: 'H', maxHp: 200, hp: 200, atk: 1, def: 0, attackInterval: 99 },
      { id: 'partner', kind: 'partner', name: 'P', maxHp: 200, hp: 200, atk: 1, def: 0, attackInterval: 99 },
    ],
    enemies: [{ id: 'e1', def: ogre }],
    skills,
    damage: { defFactor: 0.5, variance: 0, min: 1 },
    rand: () => 0.99,
    onKnowledge: (ev) => events.push(ev),
  });

  it('一点集中砲の予兆中に分散陣を使うと、ダメージが分割され「正しい適用」が記録される', () => {
    const ev: { kind: string; correct: boolean }[] = [];
    const b = make(ev);
    for (let i = 0; i < 52; i++) b.tick(0.1); // firstAt=5 → 予兆開始
    expect(b.enemies()[0].charging?.behavior.action).toBe('focusBlast');
    expect(b.useSkill('distribution-array')).toBe(true);
    for (let i = 0; i < 40; i++) b.tick(0.1);
    const all = b.drainEvents();
    const dist = all.find((e) => e.type === 'distribute');
    expect(dist && dist.type === 'distribute' && dist.parts.map((p) => p.raw)).toEqual([55, 55]);
    expect(ev).toContainEqual(expect.objectContaining({ kind: 'application', correct: true }));
  });

  it('分散陣が使えたのに一点で受けると「見極めの失敗」が記録される', () => {
    const ev: { kind: string; correct: boolean }[] = [];
    const b = make(ev);
    for (let i = 0; i < 90; i++) b.tick(0.1);
    expect(b.hero().hp).toBeLessThan(200 - 100);
    expect(ev).toContainEqual(expect.objectContaining({ kind: 'discrimination', correct: false }));
  });
});

describe('習熟度', () => {
  it('使用回数だけでは上がらず、間違えると下がり、正しく使うと戻る', () => {
    const save = createNewSave([0, 0]);
    const rec = (kind: 'experience' | 'application' | 'discrimination', variant: string, correct: boolean) =>
      recordKnowledgeEvent(save, rules, { knowledgeId: 'load-balancing', kind, variant, correct });
    rec('experience', 'inn', true);
    expect(getProgress(save, 'load-balancing').mastery).toBe(1);
    for (let i = 0; i < 10; i++) rec('experience', 'inn', true);
    expect(getProgress(save, 'load-balancing').mastery).toBe(1); // 回数だけでは上がらない
    rec('application', 'inn', true);
    for (let i = 0; i < 3; i++) rec('discrimination', 'battle-focus', true);
    expect(getProgress(save, 'load-balancing').mastery).toBe(2);
    rec('application', 'battle-focus', true);
    expect(getProgress(save, 'load-balancing').mastery).toBe(3);
    rec('discrimination', 'battle-focus', false);
    expect(getProgress(save, 'load-balancing').mastery).toBe(2); // ミスで下がる
    rec('discrimination', 'battle-focus', true);
    expect(getProgress(save, 'load-balancing').mastery).toBe(3); // 正しく使うと戻る
    markFormalTerm(save, rules, 'load-balancing');
    expect(getProgress(save, 'load-balancing').mastery).toBe(4);
  });

  it('スキルの実効レベルは習熟度で頭打ちになり、下がる', () => {
    const save = createNewSave([0, 0]);
    const gs = new GameState(save, data, new EventBus());
    gs.unlockSkill('distribution-array');
    save.skills['distribution-array'].level = 3;
    gs.recordKnowledge({ knowledgeId: 'load-balancing', kind: 'experience', variant: 'inn', correct: true });
    expect(gs.effectiveSkillLevel('distribution-array')).toBe(1);
  });
});

describe('ドロップ', () => {
  it('レアが出ない周回が続くと確定で出る', () => {
    const pity: Record<string, number> = {};
    let got = -1;
    for (let i = 0; i < 8; i++) {
      const d = rollDrops(data.dropTables, 'ogre', pity, (id) => id === 'tuning-core', () => 0.99);
      if (d.some((x) => x.itemId === 'tuning-core')) { got = i; break; }
    }
    expect(got).toBe(7);
  });
});

describe('分配ギミック', () => {
  it('何もしないと既定先に集中してあふれる。分散すれば成功する', () => {
    const def = data.gimmicks.get('inn-routing')!;
    const idle = new DistributionPuzzle({ ...def, demoSeconds: 0 }, () => 0);
    for (let i = 0; i < 600 && idle.phase !== 'done'; i++) idle.tick(0.1);
    expect(idle.success).toBe(false);

    const smart = new DistributionPuzzle({ ...def, demoSeconds: 0 }, () => 0);
    for (let i = 0; i < 2000 && smart.phase !== 'done'; i++) {
      if (smart.pending) {
        // 空き率が最も高い受け皿へ（最小コネクション的な振る舞い）
        const best = smart.targets.map((t, idx) => ({ idx, free: (t.capacity - t.load) / t.capacity })).sort((a, b) => b.free - a.free)[0];
        smart.route(best.idx);
      }
      smart.tick(0.1);
    }
    expect(smart.success).toBe(true);
  });
});
