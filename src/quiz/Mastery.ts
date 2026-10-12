// 知識ごとの習熟度（0〜5）を、その知識に属する問題の成績から算出する。回数ではなく正答率と網羅度で決まり、間違えると下がる。
import type { ExamQuestion, MasteryRules } from '../data/schema';
import type { SaveData } from '../save/SaveData';

export const MASTERY_LABELS = ['未挑戦', '出会った', '半分は解ける', 'だいたい解ける', 'ほぼ確実', '別の日でも確実'];

export interface MasteryInfo {
  level: number;
  accuracy: number;
  seen: number;
  total: number;
}

export function knowledgeMastery(knowledgeId: string, questions: ExamQuestion[], save: SaveData, rules: MasteryRules, masteredStreak: number): MasteryInfo {
  const qs = questions.filter((q) => q.knowledgeIds.includes(knowledgeId));
  const stats = qs.map((q) => save.quiz.stats[q.id]).filter((s) => s && s.seen > 0);
  const total = qs.length;
  const seen = stats.length;
  if (!seen) return { level: 0, accuracy: 0, seen, total };
  const recent = stats.flatMap((s) => s!.recent.slice(-rules.recentWindow));
  const accuracy = recent.filter(Boolean).length / Math.max(1, recent.length);
  let level = 1;
  if (accuracy >= rules.level2Accuracy) level = 2;
  if (level === 2 && accuracy >= rules.level3Accuracy && seen / total >= rules.level3SeenRatio) level = 3;
  if (level === 3 && accuracy >= rules.level4Accuracy && seen === total) level = 4;
  if (level === 4) {
    const allStreak = stats.every((s) => s!.repeatLeft === 0 && s!.recent.length >= masteredStreak && s!.recent.slice(-masteredStreak).every(Boolean));
    const days = new Set(stats.flatMap((s) => s!.correctDays));
    if (allStreak && days.size >= rules.level5MinDistinctDays) level = 5;
  }
  return { level, accuracy, seen, total };
}
