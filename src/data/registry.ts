// 起動時に全ゲームデータを読み込み・検証し、IDで引けるようにする。
import { z } from 'zod';
import * as S from './schema';
import knowledgeJson from './knowledge.json';
import examsJson from './exams.json';
import mapJson from './map.json';
import dialoguesJson from './dialogues.json';
import questsJson from './quests.json';
import gimmicksJson from './gimmicks.json';
import enemiesJson from './enemies.json';
import skillsJson from './skills.json';
import itemsJson from './items.json';
import progressionJson from './progression.json';
import hintsJson from './hints.json';

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
  const map = parse(S.MapSchema, mapJson, 'map.json');
  const dialogues = parse(S.DialoguesSchema, dialoguesJson, 'dialogues.json');
  const quests = parse(z.object({ quests: z.array(S.QuestSchema) }), questsJson, 'quests.json').quests;
  const gimmicks = parse(z.object({ gimmicks: z.array(S.GimmickSchema) }), gimmicksJson, 'gimmicks.json').gimmicks;
  const enemyData = parse(z.object({ enemies: z.array(S.EnemySchema), encounters: S.EncounterSchema }), enemiesJson, 'enemies.json');
  const skills = parse(z.object({ skills: z.array(S.SkillSchema) }), skillsJson, 'skills.json').skills;
  const items = parse(z.object({ materials: z.array(S.MaterialSchema), equipment: z.array(S.EquipmentSchema), dropTables: S.DropTableSchema }), itemsJson, 'items.json');
  const progression = parse(S.ProgressionSchema, progressionJson, 'progression.json');
  const hints = parse(z.object({ hints: S.HintSchema }), hintsJson, 'hints.json').hints;

  const data = {
    knowledge: byId(k.knowledge, 'knowledgeId'),
    masteryRules: k.masteryRules,
    exams,
    map,
    dialogues: new Map(Object.entries(dialogues)),
    quests: byId(quests, 'id'),
    gimmicks: byId(gimmicks, 'id'),
    enemies: byId(enemyData.enemies, 'id'),
    encounters: enemyData.encounters,
    skills: byId(skills, 'id'),
    materials: byId(items.materials, 'id'),
    equipment: byId(items.equipment, 'id'),
    dropTables: items.dropTables,
    progression,
    hints,
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
  for (const [gid, ids] of Object.entries(d.encounters)) for (const id of ids) if (!d.enemies.has(id)) errors.push(`encounter ${gid}: ${id}`);
  for (const [tid, t] of Object.entries(d.dropTables)) for (const e of t.entries) if (!itemExists(e.itemId)) errors.push(`dropTable ${tid}: ${e.itemId}`);
  for (const npc of d.map.npcs) for (const s of npc.dialogues) if (!d.dialogues.has(s.dialogueId)) errors.push(`npc ${npc.id}: ${s.dialogueId}`);
  for (const it of d.map.interactables) for (const s of it.dialogues) if (!d.dialogues.has(s.dialogueId)) errors.push(`interactable ${it.id}: ${s.dialogueId}`);
  for (const [, q] of d.quests) for (const seg of q.run?.segments ?? []) {
    if (seg.groupId && !d.encounters[seg.groupId]) errors.push(`quest ${q.id}: group ${seg.groupId}`);
    for (const g of seg.eventPool ?? []) if (!d.gimmicks.has(g)) errors.push(`quest ${q.id}: gimmick ${g}`);
  }
  for (const [, e] of d.equipment) for (const c of [...e.recipe, ...e.enhanceCost.flat()]) if (!itemExists(c.itemId)) errors.push(`equipment ${e.id}: ${c.itemId}`);
  if (errors.length) throw new Error(`データ参照エラー:\n${errors.join('\n')}`);
}
