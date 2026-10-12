// ゲームデータ（src/data/*.json）のスキーマ。型はここから推論し、データとコードの形を一致させる。
import { z } from 'zod';

const Vec2 = z.tuple([z.number(), z.number()]);
const Rgb = z.tuple([z.number(), z.number(), z.number()]);
export const StatsSchema = z.record(z.string(), z.number());

// ---- 条件・アクション（会話・クエスト・ヒントで共通） ----
export const ConditionSchema = z.object({
  flag: z.string().optional(),
  notFlag: z.string().optional(),
  questState: z.object({ questId: z.string(), state: z.enum(['inactive', 'active', 'completed']) }).optional(),
  questStepAtLeast: z.object({ questId: z.string(), step: z.number() }).optional(),
  masteryAtLeast: z.object({ knowledgeId: z.string(), level: z.number() }).optional(),
  masteryBelow: z.object({ knowledgeId: z.string(), level: z.number() }).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.object({
  setFlag: z.string().optional(),
  startQuest: z.string().optional(),
  emit: z.object({ event: z.string(), id: z.string() }).optional(),
  unlockSkill: z.string().optional(),
  learnFormalTerm: z.string().optional(),
  recordKnowledge: z.object({
    knowledgeId: z.string(),
    kind: z.enum(['experience', 'application', 'discrimination']),
    variant: z.string(),
    correct: z.boolean(),
  }).optional(),
  startGimmick: z.string().optional(),
  startRun: z.string().optional(),
  startDialogue: z.string().optional(),
  giveItem: z.object({ itemId: z.string(), count: z.number() }).optional(),
  openCraft: z.boolean().optional(),
  openExam: z.string().optional(),
  healParty: z.boolean().optional(),
  partnerSay: z.string().optional(),
});
export type Action = z.infer<typeof ActionSchema>;

// ---- Knowledge ----
export const KnowledgeSchema = z.object({
  knowledgeId: z.string(),
  nameJa: z.string(),
  nameEn: z.string(),
  category: z.string(),
  formalDescription: z.string(),
  experienceDescription: z.string(),
  formalTerms: z.array(z.object({ term: z.string(), description: z.string() })),
  relatedQuestIds: z.array(z.string()),
  relatedSkillIds: z.array(z.string()),
  relatedEnemyIds: z.array(z.string()),
  relatedExamIds: z.array(z.string()),
  variants: z.array(z.object({ id: z.string(), label: z.string(), stage: z.enum(['metaphor', 'it', 'exam']) })),
  sources: z.array(z.object({ title: z.string(), url: z.string().optional(), note: z.string().optional() })),
});
export type KnowledgeDefinition = z.infer<typeof KnowledgeSchema>;

export const MasteryRulesSchema = z.object({
  discriminationWindow: z.number(),
  discriminationMinEvents: z.number(),
  discriminationMinCorrect: z.number(),
  level3MinVariants: z.number(),
  level5MinExamCorrect: z.number(),
  level5MinDistinctDays: z.number(),
  level5RecentWindow: z.number(),
  level4BlockIfRecentExamWrong: z.number(),
  reviewIntervalsDays: z.array(z.number()),
});
export type MasteryRules = z.infer<typeof MasteryRulesSchema>;

// ---- Exam ----
export const ExamDataSchema = z.object({
  exams: z.array(z.object({ examId: z.string(), name: z.string(), sourceUrl: z.string().optional() })),
  links: z.array(z.object({ examId: z.string(), knowledgeId: z.string(), syllabusRef: z.string(), weight: z.number() })),
  questions: z.array(z.object({
    id: z.string(),
    knowledgeIds: z.array(z.string()),
    examIds: z.array(z.string()),
    source: z.object({ type: z.enum(['ipa', 'original']), label: z.string(), url: z.string().optional() }),
    stem: z.string(),
    choices: z.array(z.string()),
    answer: z.number(),
    explanation: z.string(),
  })),
});
export type ExamData = z.infer<typeof ExamDataSchema>;
export type ExamQuestion = ExamData['questions'][number];

// ---- Map ----
export const MapSchema = z.object({
  groundSize: z.number(),
  spawn: Vec2,
  returnPoint: Vec2,
  roads: z.array(z.object({ from: Vec2, to: Vec2, width: z.number() })),
  areas: z.array(z.object({ id: z.string(), label: z.string(), center: Vec2, radius: z.number(), color: Rgb })),
  buildings: z.array(z.object({
    id: z.string(), label: z.string().optional(), pos: Vec2, size: z.tuple([z.number(), z.number(), z.number()]),
    color: Rgb, roof: Rgb.optional(), rotation: z.number().optional(), door: z.enum(['n', 's', 'e', 'w']).optional(),
  })),
  props: z.array(z.object({ type: z.enum(['tree', 'rock', 'lamp', 'fence', 'crate', 'device', 'stone', 'board', 'anvil', 'cart', 'tower']), pos: Vec2, scale: z.number().optional(), rotation: z.number().optional(), solid: z.boolean().optional() })),
  npcs: z.array(z.object({
    id: z.string(), name: z.string(), pos: Vec2, facing: z.number(), color: Rgb,
    characterId: z.string().optional(),
    dialogues: z.array(z.object({ when: z.array(ConditionSchema).optional(), dialogueId: z.string() })),
  })),
  interactables: z.array(z.object({
    id: z.string(), label: z.string(), pos: Vec2, radius: z.number(),
    dialogues: z.array(z.object({ when: z.array(ConditionSchema).optional(), dialogueId: z.string() })),
  })),
  crowd: z.object({ around: Vec2, count: z.number(), hideWhenFlag: z.string() }),
});
export type MapData = z.infer<typeof MapSchema>;

// ---- Dialogue ----
export const DialogueNodeSchema = z.object({
  speaker: z.string(),
  text: z.string(),
  actions: z.array(ActionSchema).optional(),
  next: z.string().optional(),
  choices: z.array(z.object({ text: z.string(), next: z.string().optional(), actions: z.array(ActionSchema).optional() })).optional(),
});
export const DialoguesSchema = z.record(z.string(), z.object({ start: z.string(), nodes: z.record(z.string(), DialogueNodeSchema) }));
export type DialogueDefinition = z.infer<typeof DialoguesSchema>[string];
export type DialogueNode = z.infer<typeof DialogueNodeSchema>;

// ---- Quest ----
export const RunSegmentSchema = z.object({
  type: z.enum(['battle', 'event', 'boss']),
  pos: Vec2,
  label: z.string(),
  groupId: z.string().optional(),
  eventPool: z.array(z.string()).optional(),
});
export const QuestSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(['story', 'repeatable']),
  summary: z.string(),
  knowledgeIds: z.array(z.string()),
  steps: z.array(z.object({
    id: z.string(),
    description: z.string(),
    completeOn: z.object({ event: z.string(), id: z.string() }).optional(),
    completeWhen: z.array(ConditionSchema).optional(),
    onEnter: z.array(ActionSchema).optional(),
    marker: Vec2.optional(),
  })),
  onComplete: z.array(ActionSchema).optional(),
  run: z.object({ segments: z.array(RunSegmentSchema), rewardExp: z.number() }).optional(),
});
export type QuestDefinition = z.infer<typeof QuestSchema>;
export type RunSegment = z.infer<typeof RunSegmentSchema>;

// ---- Gimmick（DistributionPuzzle） ----
export const GimmickSchema = z.object({
  id: z.string(),
  knowledgeId: z.string(),
  variant: z.string(),
  title: z.string(),
  intro: z.string(),
  unitLabel: z.string(),
  unitIcon: z.string(),
  sourceLabel: z.string(),
  targets: z.array(z.object({
    id: z.string(), label: z.string(), capacity: z.number(), serviceRate: z.number(),
    downAt: z.number().optional(), upAt: z.number().optional(),
  })),
  units: z.number(),
  unitSize: z.tuple([z.number(), z.number()]),
  arrivalInterval: z.number(),
  autoRouteAfter: z.number(),
  defaultTarget: z.number(),
  allowedLoss: z.number(),
  demoSeconds: z.number(),
  success: z.string(),
  failure: z.string(),
  onSuccess: z.array(ActionSchema).optional(),
});
export type GimmickDefinition = z.infer<typeof GimmickSchema>;

// ---- Battle ----
export const BehaviorSchema = z.object({
  action: z.enum(['focusBlast', 'spreadWave']),
  name: z.string(),
  power: z.number(),
  telegraph: z.number(),
  every: z.number(),
  firstAt: z.number(),
  target: z.enum(['highestHp', 'hero', 'random']).optional(),
  enrageEvery: z.number().optional(),
});
export type BehaviorSpec = z.infer<typeof BehaviorSchema>;

export const EnemySchema = z.object({
  id: z.string(),
  name: z.string(),
  rank: z.enum(['normal', 'boss']),
  stats: StatsSchema,
  attackInterval: z.number(),
  exp: z.number(),
  dropTableId: z.string(),
  appearance: z.object({ shape: z.enum(['slime', 'beetle', 'ogre']), color: Rgb, scale: z.number() }),
  behaviors: z.array(BehaviorSchema),
  knowledgeIds: z.array(z.string()),
});
export type EnemyDefinition = z.infer<typeof EnemySchema>;

export const EncounterSchema = z.record(z.string(), z.array(z.string()));

export const SkillSchema = z.object({
  id: z.string(),
  nameJa: z.string(),
  description: z.string(),
  key: z.string(),
  type: z.enum(['active', 'reaction']),
  knowledgeIds: z.array(z.string()),
  cooldown: z.number(),
  effect: z.enum(['powerStrike', 'distribute', 'guard']),
  power: z.number().optional(),
  window: z.number().optional(),
  startsUnlocked: z.boolean(),
  levels: z.array(z.object({
    level: z.number(),
    label: z.string(),
    description: z.string(),
    cooldown: z.number(),
    mode: z.enum(['roundRobin', 'healthCheck', 'weighted']).optional(),
    cost: z.array(z.object({ itemId: z.string(), count: z.number() })),
  })),
});
export type SkillDefinition = z.infer<typeof SkillSchema>;

// ---- Items ----
export const MaterialSchema = z.object({
  id: z.string(), name: z.string(), rarity: z.enum(['common', 'rare']), icon: z.string(), description: z.string(),
  knowledgeIds: z.array(z.string()), sourceHint: z.string(),
});
export type MaterialDefinition = z.infer<typeof MaterialSchema>;

export const EquipmentSchema = z.object({
  id: z.string(), name: z.string(), slot: z.enum(['weapon', 'armor', 'accessory']), icon: z.string(), description: z.string(),
  baseStats: StatsSchema,
  perEnhance: StatsSchema,
  maxEnhance: z.number(),
  grants: z.object({ distributionNodes: z.number().optional(), nodeHp: z.number().optional(), nodeDef: z.number().optional() }).optional(),
  recipe: z.array(z.object({ itemId: z.string(), count: z.number() })),
  enhanceCost: z.array(z.array(z.object({ itemId: z.string(), count: z.number() }))),
});
export type EquipmentDefinition = z.infer<typeof EquipmentSchema>;

export const DropTableSchema = z.record(z.string(), z.object({
  entries: z.array(z.object({ itemId: z.string(), chance: z.number(), min: z.number(), max: z.number() })),
  pity: z.object({ itemId: z.string(), guaranteeAfter: z.number() }).optional(),
}));
export type DropTables = z.infer<typeof DropTableSchema>;

export const ProgressionSchema = z.object({
  maxLevel: z.number(),
  expCurve: z.object({ base: z.number(), exponent: z.number() }),
  baseStats: StatsSchema,
  growthPerLevel: StatsSchema,
  partnerRatio: StatsSchema,
  statLabels: z.record(z.string(), z.string()),
  damage: z.object({ defFactor: z.number(), variance: z.number(), min: z.number() }),
});
export type ProgressionData = z.infer<typeof ProgressionSchema>;

export const HintSchema = z.array(z.object({
  id: z.string(),
  trigger: z.string(),
  when: z.array(ConditionSchema).optional(),
  minReviewPriority: z.number().optional(),
  lines: z.array(z.string()),
  cooldownSec: z.number(),
}));
export type HintDefinition = z.infer<typeof HintSchema>[number];
