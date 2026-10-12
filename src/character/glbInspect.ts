// GLBの事前検証と、ロード後の解析（スケルトン/アニメ/重さ）。
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { REQUIRED_ANIMS, type LogicalAnim } from './CharacterDefinition';

export type IssueLevel = 'error' | 'warn' | 'info';
export interface Issue { level: IssueLevel; message: string }

// ★暫定値（設計書の要確認事項7）。data化しやすいようここに集約。
export const GLB_LIMITS = {
  warnBytes: 15 * 1024 * 1024,
  strongWarnBytes: 50 * 1024 * 1024,
  warnTriangles: 60_000,
  warnTextureSize: 2048,
  warnBones: 120,
};

const MB = (b: number) => `${(b / 1048576).toFixed(1)}MB`;

/** ロード前のチェック（マジックナンバーとサイズ） */
export async function precheckGlb(file: Blob, fileName: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  if (file.size < 20) return [{ level: 'error', message: 'ファイルが空、または小さすぎます。' }];
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3]);
  if (magic !== 'glTF') {
    const hint = /\.gltf$/i.test(fileName) ? '（.gltf形式は外部ファイル参照があるため、.glb形式で書き出してください）' : '';
    return [{ level: 'error', message: `GLBファイルではありません${hint}。` }];
  }
  const version = new DataView(head.buffer).getUint32(4, true);
  if (version !== 2) issues.push({ level: 'error', message: `glTFのバージョン${version}には対応していません（2.0のみ）。` });
  if (file.size >= GLB_LIMITS.strongWarnBytes) {
    issues.push({ level: 'warn', message: `ファイルが非常に大きいです（${MB(file.size)}）。スマートフォンでは動作が重くなる、または読み込めない可能性があります。` });
  } else if (file.size >= GLB_LIMITS.warnBytes) {
    issues.push({ level: 'warn', message: `ファイルが大きめです（${MB(file.size)}）。スマートフォンでは重くなる可能性があります。` });
  } else {
    issues.push({ level: 'info', message: `ファイルサイズ：${MB(file.size)}` });
  }
  return issues;
}

export interface GlbAnalysis {
  animationNames: string[];
  durations: Record<string, number>;
  skeletons: number;
  bones: number;
  triangles: number;
  maxTextureSize: number;
  suggestions: Partial<Record<LogicalAnim, string>>;
  issues: Issue[];
}

const PATTERNS: Record<LogicalAnim, RegExp[]> = {
  idle: [/idle/i, /stand/i, /breath/i, /wait/i, /待機/],
  walk: [/walk/i, /stroll/i, /歩/],
  run: [/run/i, /sprint/i, /dash/i, /jog/i, /走/],
  attack: [/attack/i, /slash/i, /punch/i, /strike/i, /攻撃/],
  hit: [/hit/i, /damage/i, /hurt/i, /被弾/],
  victory: [/victory/i, /win/i, /cheer/i, /celebrat/i, /勝利/],
};

/** 名前から割当候補を「提案」するだけ。最終決定はユーザーがプルダウンで行う */
export function suggestAnimations(names: string[]): Partial<Record<LogicalAnim, string>> {
  const out: Partial<Record<LogicalAnim, string>> = {};
  const used = new Set<string>();
  for (const slot of Object.keys(PATTERNS) as LogicalAnim[]) {
    for (const re of PATTERNS[slot]) {
      const hit = names.find((n) => re.test(n) && !used.has(n));
      if (hit) { out[slot] = hit; used.add(hit); break; }
    }
  }
  return out;
}

export function analyzeContainer(c: AssetContainer): GlbAnalysis {
  const issues: Issue[] = [];
  const animationNames = c.animationGroups.map((g) => g.name);
  const durations = Object.fromEntries(c.animationGroups.map((g) => [g.name, (g.to - g.from) / 60]));
  let triangles = 0;
  for (const m of c.meshes) {
    const idx = m.getTotalIndices?.() ?? 0;
    triangles += idx > 0 ? idx / 3 : (m.getTotalVertices?.() ?? 0) / 3;
  }
  let maxTextureSize = 0;
  for (const t of c.textures) {
    const s = t.getSize?.();
    if (s) maxTextureSize = Math.max(maxTextureSize, s.width, s.height);
  }
  const bones = c.skeletons.reduce((n, s) => n + s.bones.length, 0);

  if (c.meshes.filter((m) => m.getTotalVertices() > 0).length === 0) issues.push({ level: 'error', message: '表示できるメッシュがありません。' });
  if (c.skeletons.length === 0) issues.push({ level: 'warn', message: 'スケルトン（リグ）が見つかりません。アニメーションしない静止モデルとして扱われます。' });
  if (animationNames.length === 0) issues.push({ level: 'warn', message: 'アニメーション（AnimationGroup）が含まれていません。移動中も静止したままになります。' });
  if (triangles > GLB_LIMITS.warnTriangles) issues.push({ level: 'warn', message: `ポリゴン数が多めです（約${Math.round(triangles).toLocaleString()}三角形）。` });
  if (maxTextureSize > GLB_LIMITS.warnTextureSize) issues.push({ level: 'warn', message: `テクスチャが大きいです（${maxTextureSize}px）。スマートフォンではメモリ不足の原因になります。` });
  if (bones > GLB_LIMITS.warnBones) issues.push({ level: 'warn', message: `ボーン数が多めです（${bones}本）。` });

  const suggestions = suggestAnimations(animationNames);
  if (animationNames.length > 0) {
    for (const slot of REQUIRED_ANIMS) {
      if (!suggestions[slot]) issues.push({ level: 'info', message: `「${slot}」に当たりそうなアニメーションが名前から見つかりませんでした。一覧から手動で選んでください。` });
    }
  }
  return { animationNames, durations, skeletons: c.skeletons.length, bones, triangles: Math.round(triangles), maxTextureSize, suggestions, issues };
}
