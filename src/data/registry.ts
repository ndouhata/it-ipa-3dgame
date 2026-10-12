// 起動時に全ゲームデータを読み込み・検証し、IDで引けるようにする。
import { z } from 'zod';
import * as S from './schema';
import knowledgeJson from './knowledge.json';
import examsJson from './exams.json';
import questsJson from './quests.json';
import enemiesJson from './enemies.json';
import itemsJson from './items.json';
import progressionJson from './progression.json';

// 分野ごとの問題ファイル（src/data/questions/*.json）をすべて読み込む。ファイルを足すだけで問題が増える
const questionFiles = import.meta.glob('./questions/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function parse<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`データ定義エラー (${file})\n${issues}`);
  }
  return r.data;
}

const byId = <T, K extends keyof T>(list: T[], key: K) => new Map(list.map((x) => [x[key] as unknown as string, x]));

export function loadGameData() {
  const k = parse(z.object({ knowledge: z.array(S.KnowledgeSchema), masteryRules: S.MasteryRulesSchema }), knowledgeJson, 'knowledge.json');
  const exams = parse(S.ExamDataSchema, examsJson, 'exams.json');
  for (const [file, json] of Object.entries(questionFiles)) {
    exams.questions.push(...parse(z.object({ questions: z.array(S.QuestionSchema) }), json, file.replace('./', '')).questions);
  }
  const dup = exams.questions.map((q) => q.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dup.length) throw new Error(`問題IDが重複しています: ${dup.join(', ')}`);
  const quests = parse(z.object({ quests: z.array(S.QuestSchema) }), questsJson, 'quests.json').quests;
  const enemies = parse(z.object({ enemies: z.array(S.EnemySchema) }), enemiesJson, 'enemies.json').enemies;
  const items = parse(z.object({ materials: z.array(S.MaterialSchema), equipment: z.array(S.EquipmentSchema), dropTables: S.DropTableSchema }), itemsJson, 'items.json');
  const progression = parse(S.ProgressionSchema, progressionJson, 'progression.json');

  const data = {
    knowledge: byId(k.knowledge, 'knowledgeId'),
    masteryRules: k.masteryRules,
    exams,
    questions: byId(exams.questions, 'id'),
    quests: byId(quests, 'id'),
    questList: quests,
    enemies: byId(enemies, 'id'),
    materials: byId(items.materials, 'id'),
    equipment: byId(items.equipment, 'id'),
    dropTables: items.dropTables,
    progression,
  };
  validateReferences(data);
  return data;
}

export type GameData = ReturnType<typeof loadGameData>;

/** ID参照の整合性チェック（存在しないIDを参照していたら起動時に気付けるように） */
function validateReferences(d: GameData) {
  const errors: string[] = [];
  const itemExists = (id: string) => d.materials.has(id) || d.equipment.has(id);
  for (const [, e] of d.enemies) if (!d.dropTables[e.dropTableId]) errors.push(`enemy ${e.id}: dropTable ${e.dropTableId}`);
  for (const [tid, t] of Object.entries(d.dropTables)) for (const e of t.entries) if (!itemExists(e.itemId)) errors.push(`dropTable ${tid}: ${e.itemId}`);
  for (const [, q] of d.quests) {
    for (const w of q.waves) for (const id of w) if (!d.enemies.has(id)) errors.push(`quest ${q.id}: enemy ${id}`);
    for (const k of q.knowledgeIds) {
      if (!d.knowledge.has(k)) errors.push(`quest ${q.id}: knowledge ${k}`);
      else if (!d.exams.questions.some((x) => x.knowledgeIds.includes(k))) errors.push(`quest ${q.id}: knowledge ${k} に問題がない`);
    }
    if (q.unlockAfter && !d.quests.has(q.unlockAfter)) errors.push(`quest ${q.id}: unlockAfter ${q.unlockAfter}`);
  }
  for (const q of d.exams.questions) {
    for (const k of q.knowledgeIds) if (!d.knowledge.has(k)) errors.push(`question ${q.id}: knowledge ${k}`);
    if (q.answer < 0 || q.answer >= q.choices.length) errors.push(`question ${q.id}: answer index`);
  }
  for (const [, e] of d.equipment) for (const c of [...e.recipe, ...e.enhanceCost.flat()]) if (!itemExists(c.itemId)) errors.push(`equipment ${e.id}: ${c.itemId}`);
  if (errors.length) throw new Error(`データ参照エラー:\n${errors.join('\n')}`);
}
