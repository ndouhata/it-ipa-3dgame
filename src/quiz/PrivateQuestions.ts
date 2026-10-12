// 自分用の問題（非公開）。ファイルから取り込んで、その端末のIndexedDBだけに保存する。
// 公開サイトのファイルには含まれないので、他の人には見えない。
import type { GameData } from '../data/registry';
import type { ExamQuestion, KnowledgeDefinition, QuestDefinition } from '../data/schema';
import { getDB } from '../save/db';

export interface PrivateRow {
  field: string;
  stem: string;
  correct: string;
  wrongs: string[];
  explanation: string;
}

export interface PrivateSet {
  fileName: string;
  importedAt: string;
  rows: PrivateRow[];
}

const KEY = 'privateQuestions';
export const PRIVATE_GROUP = '自分の問題（この端末だけ）';
/** 敵の見た目と強さの元にするクエスト（レベルは自分に合わせて換算される） */
const ENEMY_TEMPLATE_QUEST = 'market';

export const TEMPLATE_CSV =
  '分野,問題文,正解,誤答1,誤答2,誤答3,解説\n' +
  '機械学習,"正解ラベルのないデータを、似たもの同士のグループに分ける手法はどれか。",クラスタリング,回帰,分類,強化学習,"教師なし学習の代表例。k-means法などがある。"\n' +
  '深層学習,"入力が0以下なら0、それ以外はそのまま出力する活性化関数はどれか。",ReLU,シグモイド関数,ソフトマックス関数,tanh関数,"勾配消失を起こしにくい。"\n';

// ---------- 読み込み ----------

/** Excelの「CSV（コンマ区切り）」はShift_JIS、「CSV UTF-8」はUTF-8。どちらでも読めるようにする */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

/** CSV/TSVを行と列に分ける（"…" で囲んだ中のカンマ・改行・"" に対応） */
export function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = firstLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function rowsToQuestions(table: string[][]): { rows: PrivateRow[]; errors: string[] } {
  const rows: PrivateRow[] = [];
  const errors: string[] = [];
  table.forEach((cols, i) => {
    const c = cols.map((x) => x.trim());
    if (i === 0 && c.some((x) => x.includes('問題'))) return; // 見出し行
    const [field, stem, correct, w1, w2, w3, explanation] = c;
    const wrongs = [w1, w2, w3].filter((x) => x);
    if (!stem || !correct || wrongs.length === 0) {
      errors.push(`${i + 1}行目：問題文・正解・誤答（1つ以上）が必要です`);
      return;
    }
    if (new Set([correct, ...wrongs]).size !== wrongs.length + 1) {
      errors.push(`${i + 1}行目：選択肢が重複しています`);
      return;
    }
    rows.push({ field: field || 'その他', stem, correct, wrongs, explanation: explanation ?? '' });
  });
  return { rows, errors };
}

export async function parseQuestionFile(file: Blob, fileName: string) {
  const text = decodeText(await file.arrayBuffer());
  if (/\.json$/i.test(fileName)) {
    try {
      const json = JSON.parse(text) as { questions?: ExamQuestion[] };
      const rows: PrivateRow[] = (json.questions ?? []).map((q) => ({
        field: q.knowledgeIds?.[0] ?? 'その他', stem: q.stem, correct: q.choices[q.answer],
        wrongs: q.choices.filter((_, i) => i !== q.answer), explanation: q.explanation ?? '',
      }));
      return { rows, errors: rows.length ? [] : ['問題が見つかりませんでした'] };
    } catch {
      return { rows: [], errors: ['JSONとして読み込めませんでした'] };
    }
  }
  return rowsToQuestions(parseDelimited(text));
}

// ---------- 保存 ----------

export async function loadPrivateSet(): Promise<PrivateSet | null> {
  try {
    return ((await (await getDB()).get('meta', KEY)) as PrivateSet | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function savePrivateSet(set: PrivateSet) {
  await (await getDB()).put('meta', set, KEY);
}

export async function deletePrivateSet() {
  await (await getDB()).delete('meta', KEY);
}

// ---------- ゲームデータへの組み込み ----------

/** 問題文から決まるID（取り込み直しても成績が引き継がれるように） */
function hashId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function applyPrivateSet(data: GameData, set: PrivateSet | null) {
  if (!set?.rows.length) return;
  const fieldIds = new Map<string, string>();
  for (const r of set.rows) {
    if (fieldIds.has(r.field)) continue;
    const id = `my-${hashId(r.field)}`;
    fieldIds.set(r.field, id);
    const k: KnowledgeDefinition = { knowledgeId: id, nameJa: r.field, nameEn: 'My Questions', category: '自分の問題', formalDescription: `取り込んだ問題（${set.fileName}）` };
    data.knowledge.set(id, k);
  }
  const seen = new Set<string>();
  for (const r of set.rows) {
    const id = `myq-${hashId(r.stem)}`;
    if (seen.has(id) || data.questions.has(id)) continue;
    seen.add(id);
    const q: ExamQuestion = {
      id, knowledgeIds: [fieldIds.get(r.field)!], examIds: ['private'],
      source: { type: 'original', label: `自分の問題（${set.fileName}）` },
      stem: r.stem, choices: [r.correct, ...r.wrongs], answer: 0, explanation: r.explanation || '（解説なし）',
    };
    data.exams.questions.push(q);
    data.questions.set(id, q);
  }
  const tpl = data.quests.get(ENEMY_TEMPLATE_QUEST)!;
  const quest: QuestDefinition = {
    id: 'my-questions', title: '自分の問題集', group: PRIVATE_GROUP,
    recommendedLevel: tpl.recommendedLevel, summary: `取り込んだ問題（${seen.size}問）で戦う。敵の強さは自分のレベルに合わせて変わる。`,
    knowledgeIds: [...fieldIds.values()], waves: tpl.waves, rewardExp: tpl.rewardExp,
    stage: { ground: [0.4, 0.38, 0.45], sky: [0.35, 0.3, 0.5] },
  };
  data.quests.set(quest.id, quest);
  data.questList.unshift(quest);
}
