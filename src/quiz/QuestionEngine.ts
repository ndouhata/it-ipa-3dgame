// 出題エンジン（3D・画面に非依存）。
// - 選択肢の並びは毎回シャッフルする
// - 間違えた問題は、少し間をあけて数回（既定3回）出し直す。出し直しで間違えたら回数を戻す
// - 正解が続いた問題は「卒業」とし、まだ慣れていない問題・新しい問題を優先する
import type { ExamQuestion, OutcomeKey, QuizConfig } from '../data/schema';
import type { QuestionStat, SaveData } from '../save/SaveData';
import { isQuestionMastered } from './Mastery';

export interface PresentedQuestion {
  question: ExamQuestion;
  /** 表示位置 i に、元の選択肢 order[i] を出す */
  order: number[];
  fastSec: number;
  limitSec: number;
  isRepeat: boolean;
}

export interface AnswerResult {
  correct: boolean;
  fast: boolean;
  outcome: OutcomeKey;
  /** 正解の表示位置 */
  correctIndex: number;
  timedOut: boolean;
}

const RECENT_MAX = 10;

export function emptyStat(): QuestionStat {
  return { seen: 0, correct: 0, fastCorrect: 0, recent: [], repeatLeft: 0, dueAt: 0, lastAt: null, correctDays: [] };
}

export class QuestionEngine {
  private lastIds: string[] = [];

  constructor(
    private questions: ExamQuestion[],
    private save: SaveData,
    private cfg: QuizConfig,
    private rand: () => number = Math.random,
  ) {}

  stat(id: string): QuestionStat {
    return (this.save.quiz.stats[id] ??= emptyStat());
  }

  isMastered(id: string) {
    return isQuestionMastered(this.save.quiz.stats[id], this.cfg.masteredStreak);
  }

  /** 問題文と選択肢の長さから「速攻」と判定する秒数を決める（装備で延長できる） */
  fastSecFor(q: ExamQuestion, bonusSec = 0) {
    const f = this.cfg.fastSec;
    const chars = q.choices.reduce((n, c) => n + c.length, 0);
    const sec = f.base + q.stem.length * f.perStemChar + chars * f.perChoiceChar;
    return Math.min(f.max, Math.max(f.min, sec)) + bonusSec;
  }

  next(knowledgeIds: string[], bonusSec = 0): PresentedQuestion {
    const pool = this.questions.filter((q) => q.knowledgeIds.some((k) => knowledgeIds.includes(k)));
    if (!pool.length) throw new Error('出題できる問題がありません');
    const counter = this.save.quiz.counter;
    const notRecent = (q: ExamQuestion) => !this.lastIds.includes(q.id);

    let picked: ExamQuestion | undefined;
    let isRepeat = false;

    // 1) 間違えた問題の出し直し（期限が来たもの）
    const repeats = pool.filter((q) => this.stat(q.id).repeatLeft > 0 && this.stat(q.id).dueAt <= counter && q.id !== this.lastIds[this.lastIds.length - 1]);
    if (repeats.length) {
      repeats.sort((a, b) => this.stat(a.id).dueAt - this.stat(b.id).dueAt);
      picked = repeats[0];
      isRepeat = true;
    }

    // 2) 慣れていない問題が少なければ、新しい問題を足す
    if (!picked) {
      const learning = pool.filter((q) => this.stat(q.id).seen > 0 && !this.isMastered(q.id));
      const unseen = pool.filter((q) => this.stat(q.id).seen === 0);
      if (unseen.length && learning.length < this.cfg.activeSetSize) picked = unseen[Math.floor(this.rand() * unseen.length)];
      // 3) 慣れていない問題を、正答率が低いものほど出やすく
      else if (learning.filter(notRecent).length) picked = this.weighted(learning.filter(notRecent), (q) => 1.3 - this.accuracy(q.id));
      // 4) 全部卒業していたら、しばらく出していないものから復習
      else {
        const rest = pool.filter(notRecent);
        if (rest.length) picked = this.weighted(rest, (q) => 1 + this.ageHours(q.id));
      }
    }
    picked ??= pool[Math.floor(this.rand() * pool.length)];

    this.save.quiz.counter = counter + 1;
    this.lastIds.push(picked.id);
    if (this.lastIds.length > 2) this.lastIds.shift();
    const fastSec = this.fastSecFor(picked, bonusSec);
    return { question: picked, order: this.shuffle(picked.choices.length), fastSec, limitSec: fastSec * this.cfg.timeLimitFactor, isRepeat };
  }

  /** chosen は表示位置（時間切れなら null） */
  answer(p: PresentedQuestion, chosen: number | null, seconds: number, now = new Date()): AnswerResult {
    const q = p.question;
    const correctIndex = p.order.indexOf(q.answer);
    const timedOut = chosen === null;
    const correct = !timedOut && p.order[chosen] === q.answer;
    const fast = !timedOut && seconds <= p.fastSec;
    const outcome: OutcomeKey = timedOut ? 'slowWrong' : fast ? (correct ? 'fastCorrect' : 'fastWrong') : (correct ? 'slowCorrect' : 'slowWrong');

    const s = this.stat(q.id);
    s.seen++;
    s.recent.push(correct);
    if (s.recent.length > RECENT_MAX) s.recent.shift();
    s.lastAt = now.toISOString();
    if (correct) {
      s.correct++;
      if (fast) s.fastCorrect++;
      const day = now.toISOString().slice(0, 10);
      if (!s.correctDays.includes(day)) s.correctDays.push(day);
      if (s.correctDays.length > 10) s.correctDays.shift();
    }
    const nextDue = this.save.quiz.counter + this.cfg.repeatGap - 1;
    if (!correct) {
      s.repeatLeft = this.cfg.repeatAfterWrong;
      s.dueAt = nextDue;
    } else if (s.repeatLeft > 0) {
      s.repeatLeft--;
      s.dueAt = nextDue;
    }
    return { correct, fast, outcome, correctIndex, timedOut };
  }

  accuracy(id: string) {
    const r = this.save.quiz.stats[id]?.recent ?? [];
    return r.length ? r.filter(Boolean).length / r.length : 0;
  }

  private ageHours(id: string) {
    const at = this.save.quiz.stats[id]?.lastAt;
    return at ? (Date.now() - new Date(at).getTime()) / 3600000 : 1000;
  }

  private weighted<T>(list: T[], w: (x: T) => number): T {
    const ws = list.map((x) => Math.max(0.01, w(x)));
    let r = this.rand() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  private shuffle(n: number) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
