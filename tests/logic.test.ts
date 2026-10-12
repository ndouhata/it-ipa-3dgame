import { describe, it, expect } from 'vitest';
import { loadGameData } from '../src/data/registry';
import { QuestionEngine } from '../src/quiz/QuestionEngine';
import { TurnBattle } from '../src/battle/TurnBattle';
import { rollDrops } from '../src/inventory/Drops';
import { createNewSave } from '../src/save/SaveData';
import { GameState } from '../src/game/GameState';
import { EventBus } from '../src/core/EventBus';

const data = loadGameData();
const cfg = data.progression.quiz;
const questions = data.exams.questions;

/** 決まった乱数列（テストを再現可能にする） */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

describe('データ', () => {
  it('全データが読み込め、どのクエストにも問題がある', () => {
    expect(questions.length).toBeGreaterThanOrEqual(300);
    expect(data.knowledge.size).toBe(33);
    for (const q of data.questList) {
      expect(questions.some((x) => x.knowledgeIds.some((k) => q.knowledgeIds.includes(k)))).toBe(true);
    }
  });
});

describe('出題エンジン', () => {
  it('選択肢の順番は毎回シャッフルされ、正解の位置が変わる', () => {
    const save = createNewSave();
    const eng = new QuestionEngine(questions, save, cfg, seeded(7));
    const positions = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const p = eng.next(['system-components']);
      positions.add(p.order.indexOf(p.question.answer));
      eng.answer(p, p.order.indexOf(p.question.answer), 1);
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it('間違えた問題は、1問あけて3回出し直される（出し直しで間違えると回数が戻る）', () => {
    const save = createNewSave();
    const eng = new QuestionEngine(questions, save, cfg, seeded(3));
    const first = eng.next(['system-components']);
    const wrong = (first.order.indexOf(first.question.answer) + 1) % first.order.length;
    eng.answer(first, wrong, 1);
    const shown: string[] = [];
    for (let i = 0; i < 12; i++) {
      const p = eng.next(['system-components']);
      shown.push(p.question.id);
      eng.answer(p, p.order.indexOf(p.question.answer), 1); // 以後は正解
    }
    expect(shown[0]).not.toBe(first.question.id); // 直後ではない
    expect(shown.filter((id) => id === first.question.id).length).toBeGreaterThanOrEqual(3);
    expect(save.quiz.stats[first.question.id].repeatLeft).toBe(0);
  });

  it('正解が続いた問題は卒業し、新しい問題が出るようになる', () => {
    const save = createNewSave();
    const eng = new QuestionEngine(questions, save, cfg, seeded(11));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const p = eng.next(['algorithm']);
      seen.add(p.question.id);
      eng.answer(p, p.order.indexOf(p.question.answer), 1);
    }
    const pool = questions.filter((q) => q.knowledgeIds.some((k) => ['algorithm'].includes(k)));
    expect(seen.size).toBe(pool.length);
  });

  it('速さと正誤で4段階に判定される', () => {
    const save = createNewSave();
    const eng = new QuestionEngine(questions, save, cfg, seeded(5));
    const p = eng.next(['computer-components']);
    const right = p.order.indexOf(p.question.answer);
    const wrong = (right + 1) % p.order.length;
    expect(eng.answer(p, right, 1).outcome).toBe('fastCorrect');
    expect(eng.answer(p, right, p.fastSec + 1).outcome).toBe('slowCorrect');
    expect(eng.answer(p, wrong, 1).outcome).toBe('fastWrong');
    expect(eng.answer(p, wrong, p.fastSec + 1).outcome).toBe('slowWrong');
    expect(eng.answer(p, null, p.limitSec).outcome).toBe('slowWrong');
  });
});

describe('戦闘', () => {
  const slime = data.enemies.get('trade-road-slime')!;
  const make = () => new TurnBattle(
    { name: 'H', maxHp: 120, hp: 120, atk: 14, def: 6 }, { name: 'P', maxHp: 100, hp: 100, atk: 8, def: 5 },
    [{ id: 'e1', def: slime }], { defFactor: 0.5, variance: 0, min: 1 }, () => 0.5,
  );
  it('速く正解すると大ダメージ、速く間違えると小ダメージ', () => {
    const a = make().heroAttack(cfg.outcomes.attack.fastCorrect).find((e) => e.type === 'damage');
    const b = make().heroAttack(cfg.outcomes.attack.fastWrong).find((e) => e.type === 'damage');
    expect(a && a.type === 'damage' && a.amount).toBeGreaterThan(b && b.type === 'damage' ? b.amount * 3 : 999);
  });
  it('防御は速く正解すると被ダメージが大きく減る', () => {
    const sum = (mult: number) => make().enemiesAttack(mult).reduce((n, e) => n + (e.type === 'damage' ? e.amount : 0), 0);
    expect(sum(cfg.outcomes.defense.fastCorrect)).toBeLessThan(sum(cfg.outcomes.defense.fastWrong) / 4);
  });
});

describe('成長・ドロップ', () => {
  it('レベルアップでステータスが上がり、装備で速攻時間が延びる', () => {
    const gs = new GameState(createNewSave(), data, new EventBus());
    const before = gs.heroStats().atk;
    gs.addExp(1000);
    expect(gs.heroStats().atk).toBeGreaterThan(before);
    gs.save.inventory = { 'memory-crystal': 10, 'index-shard': 10 };
    expect(gs.craft('focus-charm')).not.toBeNull();
    expect(gs.fastBonusSec()).toBe(2);
  });
  it('レアが出ない周回が続くと確定で出る', () => {
    const pity: Record<string, number> = {};
    let got = -1;
    for (let i = 0; i < 8; i++) {
      const d = rollDrops(data.dropTables, 'road-boss', pity, (id) => id === 'tuning-core', () => 0.99);
      if (d.some((x) => x.itemId === 'tuning-core')) { got = i; break; }
    }
    expect(got).toBe(7);
  });
  it('どの分野のクエストにも最初から挑戦できる', () => {
    const gs = new GameState(createNewSave(), data, new EventBus());
    for (const q of data.questList) expect(gs.isUnlocked(q.id)).toBe(true);
  });
});

describe('敵の強さの換算', () => {
  it('レベルが低いときは敵が弱くなり、推奨レベル以上なら元の強さ', () => {
    const gs = new GameState(createNewSave(), data, new EventBus());
    const boss = data.enemies.get('market-boss')!;
    expect(gs.enemyLevelFor('market')).toBe(2);
    const weak = gs.scaledEnemy(boss, 15, 2);
    expect(weak.stats.hp).toBeLessThan(boss.stats.hp / 2);
    gs.save.player.level = 20;
    expect(gs.enemyLevelFor('market')).toBe(15);
  });
});

import { parseDelimited, rowsToQuestions, applyPrivateSet, TEMPLATE_CSV, decodeText } from '../src/quiz/PrivateQuestions';

describe('自分の問題の取り込み', () => {
  it('CSV（引用符・カンマ・改行・見出し行）を読める', () => {
    const csv = '分野,問題文,正解,誤答1,誤答2,誤答3,解説\r\nAI,"カンマ, を含む\n問題",正解A,誤1,誤2,,"""引用""あり"\r\n,問題2,B,C,,,\n';
    const { rows, errors } = rowsToQuestions(parseDelimited(csv));
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ field: 'AI', stem: 'カンマ, を含む\n問題', correct: '正解A', wrongs: ['誤1', '誤2'], explanation: '"引用"あり' });
    expect(rows[1].field).toBe('その他');
  });
  it('見本ファイルがそのまま取り込める', () => {
    const { rows, errors } = rowsToQuestions(parseDelimited(TEMPLATE_CSV));
    expect(errors).toEqual([]);
    expect(rows.length).toBe(2);
  });
  it('UTF-8でない文字コードもエラーにせず読む', () => {
    expect(decodeText(new TextEncoder().encode('\uFEFFあ').buffer as ArrayBuffer)).toBe('あ');
    expect(() => decodeText(new Uint8Array([0x82, 0xa0]).buffer)).not.toThrow(); // Shift_JISの「あ」
  });
  it('取り込んだ問題で「自分の問題集」クエストができ、出題できる', () => {
    const d = loadGameData();
    const { rows } = rowsToQuestions(parseDelimited(TEMPLATE_CSV));
    applyPrivateSet(d, { fileName: 'x.csv', importedAt: '', rows });
    const q = d.quests.get('my-questions')!;
    expect(d.questList[0].id).toBe('my-questions');
    const eng = new QuestionEngine(d.exams.questions, createNewSave(), d.progression.quiz);
    expect(eng.next(q.knowledgeIds).question.id.startsWith('myq-')).toBe(true);
  });
});
