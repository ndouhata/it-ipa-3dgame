// セーブデータの形。ゲーム定義（data/）とは分離し、IDで参照する。
export const SAVE_VERSION = 1;

export type QuestState = 'inactive' | 'active' | 'completed';

export interface QuestProgress {
  state: QuestState;
  step: number;
  clears: number;
  bestTimeMs: number | null;
  lastTimeMs: number | null;
}

export interface OwnedEquipment {
  uid: string;
  equipId: string;
  enhance: number;
}

export interface KnowledgeEvent {
  knowledgeId: string;
  kind: 'experience' | 'application' | 'discrimination' | 'exam';
  variant: string;
  correct: boolean;
  at: string;
  questionId?: string;
}

export interface KnowledgeProgress {
  knowledgeId: string;
  mastery: number;
  experienceCount: number;
  applicationCount: number;
  experiencedVariants: string[];
  appliedVariants: string[];
  discrimination: { correct: number; incorrect: number; recent: boolean[] };
  examCorrectCount: number;
  examIncorrectCount: number;
  examRecent: { questionId: string; correct: boolean; at: string }[];
  formalTermLearned: boolean;
  lastExperiencedAt: string | null;
  nextReviewAt: string | null;
  reviewPriority: number;
}

export interface SaveData {
  version: number;
  createdAt: string;
  updatedAt: string;
  playTimeMs: number;
  party: { heroAppearanceId: string | null; partnerAppearanceId: string | null; npcAppearances: Record<string, string> };
  player: { level: number; exp: number; hp: number };
  equipment: { weapon: string | null; armor: string | null; accessory: string | null };
  ownedEquipment: OwnedEquipment[];
  inventory: Record<string, number>;
  quests: Record<string, QuestProgress>;
  flags: Record<string, boolean>;
  skills: Record<string, { unlocked: boolean; level: number }>;
  knowledge: Record<string, KnowledgeProgress>;
  knowledgeLog: KnowledgeEvent[];
  pity: Record<string, number>;
  position: { x: number; z: number; facing: number };
  /** 周回の道中イベントの直近履歴（同じものばかりにならないように） */
  recentRunEvents: string[];
}

export function createNewSave(spawn: [number, number]): SaveData {
  const now = new Date().toISOString();
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    playTimeMs: 0,
    party: { heroAppearanceId: null, partnerAppearanceId: null, npcAppearances: {} },
    player: { level: 1, exp: 0, hp: -1 },
    equipment: { weapon: null, armor: null, accessory: null },
    ownedEquipment: [],
    inventory: {},
    quests: {},
    flags: {},
    skills: {},
    knowledge: {},
    knowledgeLog: [],
    pity: {},
    position: { x: spawn[0], z: spawn[1], facing: 0 },
    recentRunEvents: [],
  };
}

export function createKnowledgeProgress(knowledgeId: string): KnowledgeProgress {
  return {
    knowledgeId,
    mastery: 0,
    experienceCount: 0,
    applicationCount: 0,
    experiencedVariants: [],
    appliedVariants: [],
    discrimination: { correct: 0, incorrect: 0, recent: [] },
    examCorrectCount: 0,
    examIncorrectCount: 0,
    examRecent: [],
    formalTermLearned: false,
    lastExperiencedAt: null,
    nextReviewAt: null,
    reviewPriority: 0,
  };
}

/** 古い版のセーブを現行版へ。版を上げたらここに変換を足す。 */
export function migrateSave(raw: SaveData, spawn: [number, number]): SaveData {
  const base = createNewSave(spawn);
  const merged: SaveData = { ...base, ...raw, version: SAVE_VERSION };
  merged.position ??= base.position;
  merged.recentRunEvents ??= [];
  merged.party = { ...base.party, ...raw.party };
  merged.party.npcAppearances ??= {};
  return merged;
}
