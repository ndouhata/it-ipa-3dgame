// ゲームデータ（src/data/*.json）のスキーマ。型はここから推論し、データとコードの形を一致させる。
import { z } from 'zod';

const Rgb = z.tuple([z.number(), z.number(), z.number()]);
export const StatsSchema = z.record(z.string(), z.number());

// ---- Knowledge ----
export const KnowledgeSchema = z.object({
  knowledgeId: z.string(),
  nameJa: z.string(),
  nameEn: z.string(),
  category: z.string(),
  formalDescription: z.string(),
});
export type KnowledgeDefinition = z.infer<typeof KnowledgeSchema>;

export const MasteryRulesSchema = z.object({
  recentWindow: z.number(),
  level2Accuracy: z.number(),
  level3Accuracy: z.number(),
  level3SeenRatio: z.number(),
  level4Accuracy: z.number(),
  level5MinDistinctDays: z.number(),
});
export type MasteryRules = z.infer<typeof MasteryRulesSchema>;

// ---- Exam / Question ----
export const QuestionSchema = z.object({
  id: z.string(),
  knowledgeIds: z.array(z.string()).min(1),
  examIds: z.array(z.string()),
  source: z.object({ type: z.enum(['ipa', 'original']), label: z.string(), url: z.string().optional() }),
  stem: z.string(),
  choices: z.array(z.string()).min(2),
  answer: z.number(),
  explanation: z.string(),
});
export type ExamQuestion = z.infer<typeof QuestionSchema>;

export const ExamDataSchema = z.object({
  exams: z.array(z.object({ examId: z.string(), name: z.string(), sourceUrl: z.string().optional() })),
  links: z.array(z.object({ examId: z.string(), knowledgeId: z.string(), syllabusRef: z.string(), weight: z.number() })),
  questions: z.array(QuestionSchema),
});
export type ExamData = z.infer<typeof ExamDataSchema>;

// ---- Quest ----
export const QuestSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** 拠点での見出し（資格の種類など） */
  group: z.string(),
  summary: z.string(),
  recommendedLevel: z.number(),
  unlockAfter: z.string().optional(),
  knowledgeIds: z.array(z.string()).min(1),
  waves: z.array(z.array(z.string()).min(1)).min(1),
  rewardExp: z.number(),
  stage: z.object({ ground: Rgb, sky: Rgb }),
});
export type QuestDefinition = z.infer<typeof QuestSchema>;

// ---- Enemy ----
export const EnemySchema = z.object({
  id: z.string(),
  name: z.string(),
  rank: z.enum(['normal', 'boss']),
  stats: StatsSchema,
  exp: z.number(),
  dropTableId: z.string(),
  appearance: z.object({ shape: z.enum(['slime', 'beetle', 'ogre']), color: Rgb, scale: z.number() }),
});
export type EnemyDefinition = z.infer<typeof EnemySchema>;

// ---- Items ----
export const MaterialSchema = z.object({
  id: z.string(), name: z.string(), rarity: z.enum(['common', 'rare']), icon: z.string(), description: z.string(), sourceHint: z.string(),
});
export type MaterialDefinition = z.infer<typeof MaterialSchema>;

const Cost = z.array(z.object({ itemId: z.string(), count: z.number() }));
const Grants = z.object({ fastBonusSec: z.number().optional() });
export const EquipmentSchema = z.object({
  id: z.string(), name: z.string(), slot: z.enum(['weapon', 'armor', 'accessory']), icon: z.string(), description: z.string(),
  baseStats: StatsSchema,
  perEnhance: StatsSchema,
  maxEnhance: z.number(),
  grants: Grants.optional(),
  grantsPerEnhance: Grants.optional(),
  recipe: Cost,
  enhanceCost: z.array(Cost),
});
export type EquipmentDefinition = z.infer<typeof EquipmentSchema>;

export const DropTableSchema = z.record(z.string(), z.object({
  entries: z.array(z.object({ itemId: z.string(), chance: z.number(), min: z.number(), max: z.number() })),
  pity: z.object({ itemId: z.string(), guaranteeAfter: z.number() }).optional(),
}));
export type DropTables = z.infer<typeof DropTableSchema>;

// ---- 成長・問題の評価 ----
const OutcomeTable = z.object({ fastCorrect: z.number(), slowCorrect: z.number(), slowWrong: z.number(), fastWrong: z.number() });
export type OutcomeKey = keyof z.infer<typeof OutcomeTable>;

export const QuizConfigSchema = z.object({
  fastSec: z.object({ base: z.number(), perStemChar: z.number(), perChoiceChar: z.number(), min: z.number(), max: z.number() }),
  timeLimitFactor: z.number(),
  repeatAfterWrong: z.number(),
  repeatGap: z.number(),
  activeSetSize: z.number(),
  masteredStreak: z.number(),
  outcomes: z.object({ attack: OutcomeTable, defense: OutcomeTable, exp: OutcomeTable }),
});
export type QuizConfig = z.infer<typeof QuizConfigSchema>;

export const ProgressionSchema = z.object({
  maxLevel: z.number(),
  expCurve: z.object({ base: z.number(), exponent: z.number() }),
  baseStats: StatsSchema,
  growthPerLevel: StatsSchema,
  partnerRatio: StatsSchema,
  statLabels: z.record(z.string(), z.string()),
  damage: z.object({ defFactor: z.number(), variance: z.number(), min: z.number() }),
  betweenWavesHeal: z.number(),
  quiz: QuizConfigSchema,
});
export type ProgressionData = z.infer<typeof ProgressionSchema>;
