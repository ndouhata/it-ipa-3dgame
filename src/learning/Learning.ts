// 学習層（裏側）。ゲーム側からの学習イベントを記録し、習熟度を「証拠」から算出する。
// 使用回数だけでは上がらない。間違えると下がり、正しく使うと戻る。
import type { MasteryRules } from '../data/schema';
import { createKnowledgeProgress, type KnowledgeEvent, type KnowledgeProgress, type SaveData } from '../save/SaveData';

const LOG_LIMIT = 500;
const PRIORITY_MAX = 4;

export const MASTERY_LABELS = ['未体験', '体験した', '見極められる', '応用できる', '用語として理解', '試験でも安定'];

export function getProgress(save: SaveData, knowledgeId: string): KnowledgeProgress {
  return (save.knowledge[knowledgeId] ??= createKnowledgeProgress(knowledgeId));
}

/** 規則から求まる「根拠のある」レベル（ペナルティ前） */
export function ruleLevel(p: KnowledgeProgress, rules: MasteryRules): number {
  if (p.experienceCount + p.applicationCount === 0) return 0;
  let level = 1;

  const recent = p.discrimination.recent.slice(-rules.discriminationWindow);
  const correct = recent.filter(Boolean).length;
  const ratioOk = recent.length > 0 && correct / recent.length >= rules.discriminationMinCorrect / rules.discriminationWindow;
  if (recent.length >= rules.discriminationMinEvents && ratioOk) level = 2; else return level;

  if (p.appliedVariants.length >= rules.level3MinVariants) level = 3; else return level;

  const lastExams = p.examRecent.slice(-rules.level4BlockIfRecentExamWrong);
  const blocked = lastExams.length === rules.level4BlockIfRecentExamWrong && lastExams.every((e) => !e.correct);
  if (p.formalTermLearned && !blocked) level = 4; else return level;

  const window = p.examRecent.slice(-rules.level5RecentWindow);
  const days = new Set(p.examRecent.filter((e) => e.correct).map((e) => e.at.slice(0, 10)));
  if (
    p.examCorrectCount >= rules.level5MinExamCorrect &&
    window.length === rules.level5RecentWindow && window.every((e) => e.correct) &&
    days.size >= rules.level5MinDistinctDays
  ) level = 5;
  return level;
}

/** 直近のミスによる一時的な低下（reviewPriority 2 につき1段階） */
export function computeMastery(p: KnowledgeProgress, rules: MasteryRules): number {
  const base = ruleLevel(p, rules);
  if (base === 0) return 0;
  return Math.max(1, base - Math.floor(p.reviewPriority / 2));
}

export function recordKnowledgeEvent(save: SaveData, rules: MasteryRules, ev: Omit<KnowledgeEvent, 'at'>, now = new Date()) {
  const p = getProgress(save, ev.knowledgeId);
  const before = p.mastery;
  const at = now.toISOString();
  save.knowledgeLog.push({ ...ev, at });
  if (save.knowledgeLog.length > LOG_LIMIT) save.knowledgeLog.splice(0, save.knowledgeLog.length - LOG_LIMIT);

  const addVariant = (list: string[]) => { if (!list.includes(ev.variant)) list.push(ev.variant); };
  switch (ev.kind) {
    case 'experience':
      p.experienceCount++;
      addVariant(p.experiencedVariants);
      break;
    case 'application':
      if (ev.correct) {
        p.applicationCount++;
        addVariant(p.appliedVariants);
        addVariant(p.experiencedVariants);
      }
      break;
    case 'discrimination':
      p.discrimination.recent.push(ev.correct);
      if (p.discrimination.recent.length > 20) p.discrimination.recent.shift();
      if (ev.correct) p.discrimination.correct++; else p.discrimination.incorrect++;
      break;
    case 'exam':
      if (ev.correct) p.examCorrectCount++; else p.examIncorrectCount++;
      p.examRecent.push({ questionId: ev.questionId ?? '', correct: ev.correct, at });
      if (p.examRecent.length > 20) p.examRecent.shift();
      break;
  }
  // 体験そのものには正誤がない。使用・判断・試験の正誤で優先度を上下させる
  if (ev.kind !== 'experience') {
    p.reviewPriority = ev.correct ? Math.max(0, p.reviewPriority - 1) : Math.min(PRIORITY_MAX, p.reviewPriority + 2);
  }
  p.lastExperiencedAt = at;
  p.mastery = computeMastery(p, rules);
  p.nextReviewAt = nextReview(p, rules, now);
  return { before, after: p.mastery };
}

export function markFormalTerm(save: SaveData, rules: MasteryRules, knowledgeId: string) {
  const p = getProgress(save, knowledgeId);
  const before = p.mastery;
  p.formalTermLearned = true;
  p.mastery = computeMastery(p, rules);
  return { before, after: p.mastery };
}

function nextReview(p: KnowledgeProgress, rules: MasteryRules, now: Date): string {
  const days = p.reviewPriority >= 2 ? 0 : rules.reviewIntervalsDays[Math.min(p.mastery, rules.reviewIntervalsDays.length - 1)];
  return new Date(now.getTime() + days * 86400000).toISOString();
}

export function isReviewDue(p: KnowledgeProgress, now = new Date()) {
  return p.reviewPriority >= 2 || (p.nextReviewAt !== null && new Date(p.nextReviewAt) <= now);
}

/**
 * 再遭遇の演出を決める。プレイヤーに「復習」とは見せず、周回の道中イベントの選択に反映する。
 * 未体験の形 → 復習期限/ミスが多い知識の形 → 直近に出していない形、の順で選ぶ。
 */
export function pickRunEvent(save: SaveData, pool: { id: string; knowledgeId: string; variant: string }[], rand = Math.random): string {
  const scored = pool.map((g) => {
    const p = getProgress(save, g.knowledgeId);
    let score = rand() * 0.5;
    if (!p.experiencedVariants.includes(g.variant)) score += 3;
    if (isReviewDue(p)) score += 1;
    const recentIdx = save.recentRunEvents.lastIndexOf(g.id);
    if (recentIdx >= 0) score -= 2 / (save.recentRunEvents.length - recentIdx);
    return { id: g.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const chosen = scored[0].id;
  save.recentRunEvents.push(chosen);
  if (save.recentRunEvents.length > 6) save.recentRunEvents.shift();
  return chosen;
}
