// 登録キャラクターの定義（見た目）。ゲーム上の役割・ステータスとは分離している。
export type CharacterRole = 'hero' | 'partner' | 'npc';
export const ROLE_LABELS: Record<CharacterRole, string> = { hero: '主人公', partner: 'パートナー', npc: 'NPC' };

/** 論理アニメーション状態。GLB内のAnimationGroup名はユーザーが割り当てる */
export const REQUIRED_ANIMS = ['idle', 'walk', 'run'] as const;
export const OPTIONAL_ANIMS = ['attack', 'hit', 'victory'] as const;
export type LogicalAnim = (typeof REQUIRED_ANIMS)[number] | (typeof OPTIONAL_ANIMS)[number];
export const ANIM_LABELS: Record<LogicalAnim, string> = {
  idle: '待機', walk: '歩行', run: '走行', attack: '攻撃（任意）', hit: '被弾（任意）', victory: '勝利（任意）',
};

export interface CharacterDefinition {
  id: string;
  name: string;
  role: CharacterRole;
  modelAssetId: string;
  fileName: string;
  fileSize: number;
  animationMap: Partial<Record<LogicalAnim, string>>;
  transform: { scale: number; rotationY: number; yOffset: number };
  locomotion: { walkSpeed: number; runSpeed: number; animSpeedScale: number };
  stripRootMotion: boolean;
  stats: { triangles: number; bones: number; maxTextureSize: number; animationCount: number; height: number };
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

export const DEFAULT_LOCOMOTION = { walkSpeed: 2.4, runSpeed: 6.0, animSpeedScale: 1 };
