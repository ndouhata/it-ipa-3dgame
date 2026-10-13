// セーブデータの形。ゲーム定義（data/）とは分離し、IDで参照する。
export const SAVE_VERSION = 2;

export interface QuestProgress {
  clears: number;
  bestTimeMs: number | null;
  lastTimeMs: number | null;
  bestAccuracy: number | null;
}

export interface OwnedEquipment {
  uid: string;
  equipId: string;
  enhance: number;
}

/** 問題ごとの成績。出題の選び方と習熟度の両方に使う */
export interface QuestionStat {
  seen: number;
  correct: number;
  fastCorrect: number;
  /** 直近の正誤（新しいものが末尾） */
  recent: boolean[];
  /** 間違えた後に、あと何回出すか */
  repeatLeft: number;
  /** 出題カウンタがこの値以上になったら再出題してよい */
  dueAt: number;
  lastAt: string | null;
  /** 正解した日付（YYYY-MM-DD）。別の日にも解けているかの判定用 */
  correctDays: string[];
}

export interface SaveData {
  version: number;
  createdAt: string;
  updatedAt: string;
  playTimeMs: number;
  party: { heroAppearanceId: string | null; partnerAppearanceId: string | null };
  player: { level: number; exp: number };
  equipment: { weapon: string | null; armor: string | null; accessory: string | null };
  ownedEquipment: OwnedEquipment[];
  inventory: Record<string, number>;
  quests: Record<string, QuestProgress>;
  quiz: { counter: number; stats: Record<string, QuestionStat> };
  pity: Record<string, number>;
  /** 拠点で最後に選んだ試験（クエストの見出し） */
  selectedGroup: string | null;
}

export function createNewSave(): SaveData {
  const now = new Date().toISOString();
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    playTimeMs: 0,
    party: { heroAppearanceId: null, partnerAppearanceId: null },
    player: { level: 1, exp: 0 },
    equipment: { weapon: null, armor: null, accessory: null },
    ownedEquipment: [],
    inventory: {},
    quests: {},
    quiz: { counter: 0, stats: {} },
    pity: {},
    selectedGroup: null,
  };
}

/** 古い版のセーブを現行版へ。版1（移動ありの試作）からは成長・所持品・見た目だけ引き継ぐ */
export function migrateSave(raw: Partial<SaveData> & { version?: number }): SaveData {
  const base = createNewSave();
  return {
    ...base,
    createdAt: raw.createdAt ?? base.createdAt,
    playTimeMs: raw.playTimeMs ?? 0,
    party: { heroAppearanceId: raw.party?.heroAppearanceId ?? null, partnerAppearanceId: raw.party?.partnerAppearanceId ?? null },
    player: { level: raw.player?.level ?? 1, exp: raw.player?.exp ?? 0 },
    equipment: raw.version === SAVE_VERSION && raw.equipment ? raw.equipment : base.equipment,
    ownedEquipment: raw.version === SAVE_VERSION ? raw.ownedEquipment ?? [] : [],
    inventory: raw.inventory ?? {},
    quests: raw.version === SAVE_VERSION ? raw.quests ?? {} : {},
    quiz: raw.version === SAVE_VERSION && raw.quiz ? raw.quiz : base.quiz,
    pity: raw.pity ?? {},
    selectedGroup: raw.selectedGroup ?? null,
  };
}
