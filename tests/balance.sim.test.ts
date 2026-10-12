// バランス確認用：正答の傾向ごとに、1クエストで解く問題数と勝率を調べる（結果はログに出す）
import { it } from 'vitest';
import { loadGameData } from '../src/data/registry';
import { TurnBattle } from '../src/battle/TurnBattle';
import { createNewSave } from '../src/save/SaveData';
import { GameState } from '../src/game/GameState';
import { EventBus } from '../src/core/EventBus';
import type { OutcomeKey } from '../src/data/schema';

const data = loadGameData();
const out = data.progression.quiz.outcomes;

function pick(profile: Record<OutcomeKey, number>): OutcomeKey {
  let r = Math.random();
  for (const [k, p] of Object.entries(profile) as [OutcomeKey, number][]) { r -= p; if (r <= 0) return k; }
  return 'slowWrong';
}

function run(questId: string, level: number, profile: Record<OutcomeKey, number>) {
  const gs = new GameState(createNewSave(), data, new EventBus());
  gs.save.player.level = level;
  const q = data.quests.get(questId)!;
  const hs = gs.heroStats(), ps = gs.partnerStats();
  let hp = hs.hp, php = ps.hp, questions = 0;
  for (const [w, wave] of q.waves.entries()) {
    const b = new TurnBattle({ name: 'H', maxHp: hs.hp, hp, atk: hs.atk, def: hs.def }, { name: 'P', maxHp: ps.hp, hp: php, atk: ps.atk, def: ps.def },
      wave.map((id, i) => ({ id: `${w}-${i}`, def: data.enemies.get(id)! })), data.progression.damage);
    while (!b.won && !b.lost) {
      questions++; b.heroAttack(out.attack[pick(profile)]);
      if (b.won) break;
      b.partnerAttack();
      if (b.won) break;
      questions++; b.enemiesAttack(out.defense[pick(profile)]);
    }
    if (b.lost) return { win: false, questions };
    questions++;
    hp = Math.min(hs.hp, b.hero().hp + hs.hp * 0.3);
    php = Math.min(ps.hp, (b.partner()?.hp ?? 0) + ps.hp * 0.3);
  }
  return { win: true, questions };
}

it('勝率と問題数', () => {
  const profiles: Record<string, Record<OutcomeKey, number>> = {
    '得意（速攻正解7割）': { fastCorrect: 0.7, slowCorrect: 0.2, slowWrong: 0.07, fastWrong: 0.03 },
    '普通（正解6割）': { fastCorrect: 0.3, slowCorrect: 0.3, slowWrong: 0.3, fastWrong: 0.1 },
    '苦手（正解3割）': { fastCorrect: 0.1, slowCorrect: 0.2, slowWrong: 0.5, fastWrong: 0.2 },
  };
  const lines: string[] = [];
  for (const q of data.questList) {
    for (const [name, prof] of Object.entries(profiles)) {
      let wins = 0, qs = 0;
      for (let i = 0; i < 200; i++) { const r = run(q.id, q.recommendedLevel, prof); if (r.win) wins++; qs += r.questions; }
      lines.push(`${q.title} Lv${q.recommendedLevel} ${name}: 勝率${Math.round(wins / 2)}% 平均${(qs / 200).toFixed(1)}問`);
    }
  }
  console.log(lines.join('\n'));
});
