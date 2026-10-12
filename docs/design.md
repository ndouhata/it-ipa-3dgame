# 3D資格学習RPG 設計書（v0.3）

## v0.3 での方針転換（2026-10-13 試遊フィードバック）

- フィールド移動・NPC会話・振り分けミニゲームを廃止。拠点メニューからクエストを選んで出撃する連戦形式に変更
- 攻撃・防御・勝利後の経験値のたびに問題を出し、「速さ×正誤」の4段階で倍率が決まる（倍率は progression.json）
- 選択肢は毎回シャッフル。間違えた問題は1問あけて3回出し直し、2回連続正解で卒業して新しい問題へ
- 出題範囲を基本情報技術者試験の全23分野（215問、オリジナル問題）に拡大。分野ごとに `src/data/questions/*.json`
- 8クエストすべて最初から挑戦可能。プレイヤーのレベルが推奨より低いときは敵を「自分のレベル＋1」相当に換算
- 以下のv0.2以前の記述（移動・分散陣・宿屋クエストなど）は経緯として残している

# 旧：設計書（v0.2 / プロトタイプ実装済み）

## 確定事項（2026-10-12 回答）

| # | 項目 | 決定 |
|---|---|---|
| 1 | プロジェクトフォルダ | `ドキュメント/RMMZ/it-ipa`（GitHub: ndouhata/it-ipa-3dgame、Cloudflare Pagesで配信） |
| 2 | 戦闘方式 | A案：シームレス・リアルタイムコマンド |
| 3 | 3つ目の受け皿 | 分散ノード（アクセサリー「分配の護符」で設置） |
| 4 | Tripo GLBの構成 | 保留。簡易サンプルGLB（`public/samples/`）で検証 |
| 5 | 試験問題 | IPA過去問を使う方針。現状はオリジナル問題を仮置き（出典ラベルで区別、差し替え前提） |
| 6 | ミス時のスキルLv | 下げる（強化済みLvは保持し、正しく使えば戻る） |
| 7 | ドロップ率・GLBサイズ閾値 | **再確認中**（暫定：レア15%・8周で確定／15MB警告・50MB強警告・拒否なし） |
| 8 | GLB未登録時 | 仮の人形で遊べる |
| 9 | 分散陣のLv | Lv1〜3（ラウンドロビン／ヘルスチェック／重み付け） |
| 10 | UI | 素のTS |

以下は実装前に提示した設計案（v0.1）。

---

## 0. 既存ディレクトリ確認結果

| 場所 | 状態 |
|---|---|
| `ドキュメント/RMMZ/it-ipa` | 空（このdocs/のみ今回作成） |
| セッション作業フォルダ | 空 |
| 環境 | Node v24.20 / npm 11.19 / git 2.50 / Windows 11 |

既存コードはないため、新規プロジェクトとして設計します。★要確認：**`it-ipa` をこのゲームのプロジェクトフォルダとして使ってよいか。**

---

## 1. 技術構成

| 領域 | 採用案 | 理由 |
|---|---|---|
| 言語 | TypeScript (strict) | データ構造が多く型安全が効く |
| ビルド | Vite | 高速・PWAプラグインあり・静的出力 |
| 3D | Babylon.js（`@babylonjs/core` ES modules, `@babylonjs/loaders`） | GLB/AnimationGroup/Skeletonの扱いが標準で充実。tree-shakingで容量削減 |
| UI | HTML/CSSオーバーレイ（3Dキャンバスの上にDOM） | スマホ対応・文字の可読性・実装速度。Babylon GUIは使わない |
| UIライブラリ | ★要確認：素のTS + 小さな自作コンポーネント（推奨）／Preact | 依存を最小にしたい。画面数が増えたらPreact移行も容易な構成にする |
| 保存 | IndexedDB（`idb` ラッパー） | GLB Blobの保存、localStorage不使用 |
| データ検証 | `zod`（開発時のJSONスキーマ検証） | データ駆動のため、誤ったJSONを起動時に検出 |
| PWA | `vite-plugin-pwa`（Workbox） | manifest/Service Worker生成 |
| テスト | Vitest（戦闘計算・習熟度判定・ドロップ等の純ロジック） | 3D非依存ロジックを単体テスト |
| 配布 | GitHub → Cloudflare Pages（静的） | サーバー不要 |

物理エンジン（Havok等）は使いません。移動は `moveWithCollisions`（楕円体コリジョン）＋簡易地面判定で十分です。

---

## 2. ディレクトリ構成

```
it-ipa/
├─ index.html
├─ vite.config.ts
├─ public/
│   ├─ icons/                 PWAアイコン
│   └─ assets/                同梱アセット（仮建物などは基本プリミティブで生成）
├─ src/
│   ├─ main.ts                起動・ブートストラップ
│   ├─ core/                  エンジン基盤（ゲーム固有知識なし）
│   │   ├─ Game.ts            ループ・シーン切替
│   │   ├─ EventBus.ts        型付きイベント
│   │   ├─ Input/             InputSource抽象・Keyboard・(将来)VirtualStick
│   │   └─ Time.ts
│   ├─ data/                  ★全ゲームデータ（JSON）。コードにハードコードしない
│   │   ├─ knowledge/         knowledge定義
│   │   ├─ exams/             資格定義・knowledge⇔exam関連・問題
│   │   ├─ quests/  dialogues/  enemies/  skills/
│   │   ├─ items/ (materials, equipment, recipes)  dropTables/
│   │   ├─ gimmicks/          分配パズル等のパラメータ
│   │   ├─ progression/       EXP曲線・ステータス成長
│   │   └─ maps/              フィールド配置
│   ├─ schema/                zodスキーマ＋型（data/と1対1）
│   ├─ db/                    データ読込・参照（DataRegistry）
│   ├─ save/                  IndexedDB・SaveManager・マイグレーション
│   ├─ character/             CharacterDefinition / CharacterInstance / AnimationController
│   ├─ registry/              キャラクター登録画面・GLB検証・プレビュー
│   ├─ world/                 フィールド生成・エリア・トリガー・カメラ
│   ├─ actors/                PlayerController / PartnerController / NpcController
│   ├─ dialogue/              会話エンジン（条件・アクション）
│   ├─ quest/                 QuestSystem・目的・報酬
│   ├─ gimmick/               DistributionPuzzle 等（概念ギミックのロジック）
│   ├─ battle/                戦闘（BattleSystem, Combatant, EnemyAI, SkillEffects）
│   ├─ progression/           EXP/Level/ステータス
│   ├─ inventory/             素材・装備・クラフト
│   ├─ learning/              ★学習層：KnowledgeTracker / MasteryEvaluator / ReviewScheduler / ContentDirector
│   ├─ partner/               ヒントシステム
│   └─ ui/                    HUD・メニュー・リザルト・クラフト画面・図鑑
└─ tests/
```

**依存方向**：`core` ← `character` ← `actors` ← `world`、ゲームロジック（battle/quest/inventory）は Babylon に依存しない純TSで書き、3D表示は「ビュー」層が購読する形にします（スマホ移植・テストが容易）。
**学習層（learning/）はゲーム側からイベントを受け取るだけ**にし、戦闘・クエストのコードは「学習」を直接意識しません。

---

## 3. 主要クラス／モジュール

| モジュール | 責務 |
|---|---|
| `Game` | Engine/Scene管理、メインループ、状態（フィールド/戦闘/メニュー/登録画面） |
| `DataRegistry` | 起動時にJSONを読込・検証、IDで参照 |
| `SaveManager` | セーブ/ロード/オートセーブ/マイグレーション |
| `CharacterRepository` | 登録キャラ定義とGLB BlobのIndexedDB入出力 |
| `CharacterLoader` | Blob → AssetContainer（キャッシュ・遅延ロード） |
| `CharacterInstance` | シーン上の1体。表示・アニメ・トランスフォーム補正 |
| `AnimationController` | 論理状態（idle/walk/run/…）→ AnimationGroup、クロスフェード |
| `PlayerController` / `PartnerController` / `NpcController` | 移動意図の生成のみ（モデル非依存） |
| `ThirdPersonCamera` | 追従・回転・ズーム・壁めり込み回避 |
| `DialogueRunner` | 会話データの実行、条件分岐、アクション発火 |
| `QuestSystem` | 進行状態、目的判定、報酬付与、周回管理 |
| `GimmickHost` + `DistributionPuzzle` | 概念ギミック（データで見た目・パラメータ差し替え） |
| `BattleSystem` | 戦闘進行、Combatant、行動キュー、ダメージ計算 |
| `EnemyAI` | データ定義の行動パターン実行（予兆→攻撃） |
| `SkillSystem` | スキル効果（概念の性質をそのまま効果化） |
| `ProgressionSystem` | EXP・レベルアップ・ステータス |
| `Inventory` / `CraftingSystem` | 素材・装備・作成・強化 |
| `DropSystem` | ドロップ抽選・レア保証 |
| `KnowledgeTracker` | 学習イベントの記録（裏側） |
| `MasteryEvaluator` | 証拠から習熟度Lvを算出（ルールはデータ） |
| `ReviewScheduler` | 次回復習時期・再遭遇キュー |
| `ContentDirector` | 再遭遇対象の知識を、周回の敵/イベント/ヒントへ自然に混ぜる |
| `HintSystem` | パートナーの「答えを言わない」ヒント |

---

## 4. Character設計

```ts
type CharacterRole = 'hero' | 'partner' | 'npc';           // 将来: 'ally' | 'enemy' | 'boss'

interface CharacterDefinition {
  id: string;
  name: string;
  role: CharacterRole;
  modelAssetId: string | null;      // assetsストアのBlobキー。nullならプレースホルダー表示
  fileName: string; fileSize: number;
  animationMap: {                    // 論理状態 → GLB内AnimationGroup名（ユーザー指定）
    idle: string; walk: string; run: string;
    attack?: string; hit?: string; skill?: string; victory?: string; down?: string; // 任意（無ければidle等で代用）
  };
  transform: { scale: number; rotationY: number; yOffset: number };
  locomotion: { walkSpeed: number; runSpeed: number; animSpeedScale: number }; // 足滑り調整
  stripRootMotion: boolean;          // ルートモーション除去
  stats?: { triangles: number; bones: number; maxTextureSize: number };
  createdAt: string; updatedAt: string; schemaVersion: number;
}
```

- **ゲーム上の「主人公」「パートナー」はゲームデータ（PartyMember）であり、見た目（CharacterDefinition）とは別**。セーブの `party.hero.appearanceId` が登録キャラIDを参照するだけなので、見た目はいつでも差し替え可能。
- GLB未登録でも遊べるよう、**カプセル型プレースホルダー**を標準で持つ（登録前にゲームが動く／GLBが壊れても動く）。

---

## 5. Tripo GLB登録方式

**登録フロー（ゲーム内の「キャラクター登録」画面）**

1. 名前・役割を入力
2. GLBを選択（ファイル選択／ドラッグ＆ドロップ）
3. **事前検証**（ロード前）
   - 先頭4バイトが `glTF` マジックか → 違えば「GLBではありません」
   - ファイルサイズ → 閾値超えで警告（★要確認：例 15MB警告 / 50MB強い警告）
   - `navigator.storage.estimate()` で空き容量確認
4. **隔離プレビューシーンでロード**（`LoadAssetContainerAsync`、Blob URL）
   - 失敗 → エラー表示のみ、画面は維持
   - Skeleton有無、AnimationGroup一覧、ポリゴン数・ボーン数・最大テクスチャサイズを取得し警告
5. **3Dプレビュー**：ArcRotateCameraで回転・ズーム、「正面」ボタン、地面グリッド・身長表示
6. **アニメーション割当**：GLBから取得した一覧をプルダウンで `待機 / 歩行 / 走行` に割当（名前の決め打ちなし。名前に idle/walk/run 等を含むものを**初期選択の候補として提案するだけ**）。各アニメの単体再生ボタン付き
7. **調整**：Scale / 向き(Y回転) / 地面からの高さ / 歩行・走行速度 をスライダーで調整
8. **「歩かせてみる」テスト**：プレビュー内で Idle(2秒) → Walk(円周上を移動) → Run → Idle を実際に移動させて再生（足滑りも確認できる）
9. **保存**：Blob → `assets`ストア、定義 → `characters`ストア（トランザクションで同時保存）。`navigator.storage.persist()` を要求

**エラー処理**（どれも画面をクラッシュさせずメッセージ＋代替手段）

| ケース | 挙動 |
|---|---|
| GLBではない | 拒否・理由表示 |
| ロード失敗 | 例外を捕捉し表示、プレビューシーン破棄 |
| Skeletonなし | 警告（静止モデルとして登録可、アニメは不可） |
| AnimationGroupなし | 警告（プレースホルダー動作＝移動のみで登録可） |
| Idle/Walk/Run候補なし | 自動提案なし表示。手動割当、未割当時は他スロットで代用し警告 |
| 巨大モデル | サイズ/ポリゴン/テクスチャ警告。登録は可能（★要確認：上限で拒否するか） |
| 容量不足 / QuotaExceeded | 保存前に検出、失敗時はロールバックして通知 |
| IndexedDB保存失敗 | トランザクション中断・再試行案内 |

★要確認（重要）：**お手持ちのTripo出力GLBは「1ファイルに複数アニメーション」ですか？それとも「アニメごとに別GLB」ですか？**
後者の場合、「同じスケルトンの別GLBからアニメだけ追加取り込み」機能が必要になります（設計上は `animationSources: assetId[]` を追加して対応可能）。サンプルGLBを1つ頂けると検証が確実になります。

---

## 6. Animation管理方式

- `AnimationController` は**論理状態**（`idle | walk | run | attack | hit | skill | victory | down`）だけを受け付け、`animationMap` で AnimationGroup に解決。
- 移動速度から idle/walk/run を自動選択（閾値はキャラ定義の walkSpeed/runSpeed から算出）。
- 切替は**ウェイトによるクロスフェード**（0.15〜0.25秒）。
- 任意スロット未割当時のフォールバック（attack→idle 等）。
- ルートモーション除去オプション（ルートボーンの位置トラックを無効化）で「その場歩き」に統一。
- 1つのGLBを複数体で使う場合は `instantiateModelsToScene` で複製（AnimationGroupも複製される）。

---

## 7. Player/Partner Controller設計

```
InputSource（Keyboard / 将来VirtualStick / Gamepad）
    ↓ MoveIntent {dir, run, actions}
PlayerController ──→ Pawn（コライダー・位置・向き：見た目と無関係）
                         ↓ speed, facing
                    CharacterInstance ─→ AnimationController ─→ CharacterDefinition ─→ GLB
```

- **Pawn（当たり判定の楕円体）とモデルを分離**。どんなサイズのGLBでも当たり判定と移動が同じ。
- `PlayerController`：カメラ基準の移動、走行切替、インタラクト（調べる/話す）。
- `PartnerController`：主人公の移動履歴（パンくず）を一定距離遅れで辿る → 角でショートカットせず自然に追従。距離が開くと走る、極端に離れたらワープ。戦闘中は戦闘AIに切替。
- パーティは `PartyMember[]` として持ち、仲間追加は配列に足すだけ。
- 入力はキーボード（WASD＋Shift走り＋E調べる＋1〜4スキル）から開始。仮想スティック追加は InputSource 実装を足すだけ。

---

## 8. 戦闘システム案

★要確認（最重要の未確定事項）：戦闘方式。以下3案のうち **A案を推奨** します。

| 案 | 内容 | テンポ | 概念表現 | スマホ |
|---|---|---|---|---|
| **A. シームレス・リアルタイムコマンド（推奨）** | フィールド上でそのまま戦闘。通常攻撃は自動、スキルはボタン＋クールダウン。ボスは「予兆」を出して大技 | ◎ 画面遷移なし、雑魚戦15〜30秒 | ◎ 予兆に対して「どの概念で対処するか」の判断が生まれる | ◎ ボタン数個 |
| B. ターン制コマンド | 従来型RPG | △ 1戦が長くなりがち | ○ | ◎ |
| C. アクション | 回避・コンボ | ○ | △ 操作スキルが学習を阻害 | △ |

**A案の流れ**
- 戦闘エリアに敵シンボルが見えている → 接触でその場に戦闘サークル展開（ロード無し）
- 主人公・パートナーは自動で通常攻撃。プレイヤーは移動とスキル使用（1〜4キー）
- 敵の大技は**予兆（チャージゲージ＋対象表示）** → 2〜3秒の判断時間
- 勝利 → 即座に `EXP +xx` / 素材ポップ / レアは特別演出 → 1秒後に操作可能 → 次の敵へ
- 雑魚戦の目標時間：初回20〜30秒、育成後10秒前後

---

## 9. EXP/Level/ステータス設計

- ステータスは固定フィールドではなく `Record<StatId, number>`（`hp, atk, def` から開始。`tech, judgment, knowledge, agi` 等は statDefinitions.json に追加するだけ）。
- 最終値 = 基礎（レベル成長テーブル） + 装備 + スキル/バフ。計算は `StatCalculator` に集約。
- EXP曲線・成長量はデータ（`progression/*.json`）。プロトタイプ上限 Lv20 想定。
- 目安：初回周回1回で約1.5レベル、以降は周回2〜3回で1レベル。
- レベルアップ演出：光の柱＋効果音＋「HP 120→138 / 攻撃 15→18」の**差分表示**で「強くなった」を明示。
- ダメージ式：`max(1, ATK×スキル倍率 − DEF×0.5) × 乱数(0.9〜1.1)`（定数はデータ化）。

---

## 10. Skill設計

```ts
interface SkillDefinition {
  id: string; nameJa: string;
  knowledgeIds: string[];          // 関連知識（複数可）
  type: 'reaction' | 'active' | 'passive';
  cooldown: number; cost: number;
  effect: EffectSpec;              // 効果タイプ＋パラメータ（データ）
  levels: SkillLevelSpec[];        // Lvごとの効果追加
}
```

- **スキルLvの上げ方**：「**知識の習熟度Lvが上限、素材で強化**」。
  - 例：負荷分散の習熟度がLv3なら、スキルはLv3まで強化可能。強化には素材が必要。
  - → 素材集め（RPGの欲求）と、本当の理解（学習）の両方がないと最強にならない。使用回数だけでは上がらない（禁止事項に準拠）。
- 効果は `EffectSpec` の種類（`distributeDamage`, `reuseDiscount`, `failover`, …）ごとに `SkillEffects` に実装。新概念の追加＝効果タイプ1つ＋データ。

---

## 11. Knowledge設計

**定義（静的データ）と進捗（セーブデータ）を分け、同じ `knowledgeId` で結合**します。仕様17の全フィールドを保持できます。

```ts
// data/knowledge/*.json
interface KnowledgeDefinition {
  knowledgeId: string;             // 'load-balancing'
  nameJa: string; nameEn: string;
  category: string;                // 'infrastructure/availability'
  formalDescription: string;       // 試験準拠の正式説明
  experienceDescription: string;   // 世界観での説明
  formalTerms: string[];           // 'ロードバランサ','ラウンドロビン','ヘルスチェック' …
  relatedQuestIds: string[]; relatedSkillIds: string[];
  relatedEnemyIds: string[]; relatedExamIds: string[];
  variants: { id: string; context: string; stage: 'metaphor'|'it'|'exam' }[]; // 体験の形
  sources: { title: string; url?: string; version?: string }[];               // 一次情報
  prerequisites?: string[];
}

// data/exams/exam-links.json （知識⇔資格は多対多。知識を複製しない）
interface ExamKnowledgeLink { examId: string; knowledgeId: string; syllabusRef: string; weight: number }

// save: knowledgeProgress[knowledgeId]
interface KnowledgeProgress {
  knowledgeId: string;
  mastery: 0|1|2|3|4|5;
  experienceCount: number; applicationCount: number;
  experiencedVariants: string[];   // どの形で体験したか
  discrimination: { correct: number; incorrect: number };
  examCorrectCount: number; examIncorrectCount: number;
  examHistory: { questionId: string; correct: boolean; at: string }[];
  formalTermLearned: boolean;
  lastExperiencedAt: string | null; nextReviewAt: string | null;
  reviewPriority: number;          // 再遭遇の優先度
}
```

---

## 12. Knowledgeと戦闘の接続方法

**原則：「正解したら強くなる」ではなく、「概念の性質を正しく使うと戦況が良くなる」。**

### 負荷分散（Load Balancing）の戦闘表現
- ボスの大技「**一点集中砲**」：予兆で対象（例：主人公）を表示 → 1200ダメージ。
- **分散陣**（リアクションスキル）を発動すると、ダメージを複数の対象（ノード）へ振り分ける。
  - 主人公だけ：1200（瀕死）
  - 主人公＋パートナー：600 / 600
  - ＋分散ノード（装備で設置できる受け皿）：400 / 400 / 400
- **「いつ使うか」の判断が肝**（ここが「識別できる」＝Lv2の根拠になる）
  - 単体集中攻撃 → 分散が有効
  - 全体攻撃「拡散波」→ すでに分散されているので**分散陣は無意味**（クールダウンを無駄にする）
  - パートナーが瀕死 → 均等分散すると倒れる → **ヘルスチェック（倒れそうな対象を外す）**が必要
- **スキルLvと実際のIT方式を一致**させる（試験に出る用語に直結）

| スキルLv | 戦闘効果 | 対応するIT概念 |
|---|---|---|
| 1 | 均等に分散 | ラウンドロビン |
| 2 | 戦闘不能・瀕死の対象を自動除外 | ヘルスチェック |
| 3 | 防御力・残HPに応じて配分 | 重み付けラウンドロビン／最小コネクション |
| 4 | 分散ノード数+1（受け皿を増やす） | スケールアウト |
| 5 | 分散時に被ダメ軽減 | 冗長構成との組合せ（将来の冗長化知識への橋渡し） |

※ Lv4・5の内容は★要確認（プロトタイプはLv1〜3の実装で十分と考えています）。

### 記録（プレイヤーには見せない）
戦闘中の判断は `KnowledgeTracker.record({ knowledgeId, kind: 'application'|'discrimination', variant: 'battle-boss-focus', correct, at })` として記録。
- 集中攻撃に分散を使った → application 正
- 全体攻撃に分散を使った → discrimination 誤（ペナルティは「CDを無駄にした」というゲーム内結果だけ）
- 集中攻撃を分散せず受けた → discrimination 誤（ただし防御で凌いだ等は中立）

---

## 13. Quest設計

```ts
interface QuestDefinition {
  id: string; title: string; type: 'story' | 'repeatable' | 'sub';
  prerequisites: Condition[];
  steps: QuestStep[];              // talk / reach / interact / gimmick / defeat / collect
  rewards: RewardSpec;
  knowledgeIds: string[];          // 内部用
}
```

- 会話は `dialogues/*.json`（話者・本文・選択肢・条件・アクション）。アクション例：`setFlag`, `startQuest`, `advanceStep`, `unlockSkill`, `recordKnowledge`, `giveItem`。
- **概念ギミックはエンジン1つ・見た目はデータ**：`DistributionPuzzle` は「到着する負荷を、容量の異なる受け皿へ振り分ける」汎用ロジック。データで「宿屋と客」「馬車と荷物」「塔と魔力」「サーバーとアクセス」に差し替える。→ 仕様4の「同じ原理を異なる状況で」をコード複製なしで実現。

### ストーリークエスト「人気宿の困りごと」
1. 宿屋A前に客の行列（NPCカプセルが並ぶ）。宿屋A主人「満室なんだ…」
2. **調査**：宿屋B・Cを訪ねる → 「今日はガラガラ」
3. パートナーのヒント：「宿が足りないんじゃなくて…」（答えは言わない）
4. 主人公の気付き（選択肢）：「宿が足りない」／「一ヶ所に集まりすぎている」← 後者で進行（前者でもパートナーが再ヒント、失敗扱いにしない）
5. 街の入口の**案内装置**（DistributionPuzzle）：旅人が次々到着 → 振り分けルールを操作。全部A → 行列が伸びる、A/B/Cへ振り分け → 行列が消える（容量差を考慮するとさらに良い）
6. 街の技師NPCが「それは**負荷分散 / Load Balancing**と言うんだ」→ 正式名称（ゲーム世界での名前）を知る
7. 報酬：スキル「分散陣」解放、周回クエスト「交易路の防衛」解放

---

## 14. 周回クエスト設計「交易路の防衛」

```
街の門 → 街道①：雑魚ウェーブ（3体）→ 道中イベント（ランダム1つ）→ 街道②：雑魚ウェーブ → ボス → リザルト
```

- 目標所要時間：**初回 4〜5分 → 育成後 2分前後**
- **道中イベントはローテーション**（ここで「同じ知識を別の形で」再体験）
  - 馬車の荷分け（荷物を3台の馬車へ分配。偏ると馬車が壊れて報酬減）
  - 魔力塔の過熱（1本に集中した魔力を複数の塔へ）
  - （将来）旅の門番の検問所の行列、など
  - ContentDirector が「まだ体験していない形」「復習期限が来た知識」を優先して選ぶ
- **リザルト画面で「強くなった」を可視化**：クリアタイム、**前回比 / 自己ベスト比**（例：`-1:12 短縮！`）、被ダメージ、獲得EXP・素材
- 達成ボーナス：「完全分散（集中砲で誰も倒れなかった）」で分散結晶+1 → 学習的に正しい使い方がそのまま報酬増につながる

---

## 15. Enemy/Boss設計

```ts
interface EnemyDefinition {
  id: string; name: string; rank: 'normal' | 'elite' | 'boss';
  stats: Record<StatId, number>; expReward: number; dropTableId: string;
  appearance: { characterId?: string; placeholder: 'slime' | 'golem' | ... };
  behaviors: BehaviorSpec[];       // 行動パターン（データ）
  knowledgeIds: string[];          // この敵で体験できる知識（内部）
}
// BehaviorSpec例
{ "action": "focusBlast", "power": 1200, "telegraph": 2.5, "target": "highestThreat", "every": 12 }
{ "action": "spreadWave", "power": 300, "telegraph": 2.0, "target": "all", "every": 18 }
```

- プロトタイプ：雑魚2種（素早い小型／硬い小型）、ボス1体「過積載のオーガ（仮）」：集中砲と拡散波を混ぜてくる → 判断が必要。
- HP50%以下で集中砲の頻度増加（ボスらしい盛り上がり）。
- 将来、敵の見た目も登録GLBを使えるよう `appearance.characterId` を用意（今回は仮形状）。

---

## 16. Drop/Material設計

```ts
interface DropTable { id: string; entries: { itemId: string; chance: number; min: number; max: number; rarity: 'common' | 'rare' }[]; pity?: { itemId: string; guaranteeAfter: number } }
```

- 素材（仮名）：通常 `分散結晶` `街道の鉄片` / レア `調律核`
- 確率案：ボスのレア 15%、**8周連続で出なければ確定**（不快な周回を防ぐ）★要確認
- レア入手は専用演出（光る・効果音・ポップ）
- 素材には `knowledgeIds` を持たせ、図鑑の説明文で概念の比喩として機能させる（例：分散結晶＝「力を均等に分け合う性質の結晶」）

---

## 17. Equipment/Crafting設計

```ts
interface EquipmentDefinition { id: string; slot: 'weapon' | 'armor' | 'accessory'; name: string; baseStats: Record<StatId, number>; maxEnhance: number; enhanceTable: ...; grantsEffects?: EffectSpec[] }
interface RecipeDefinition { id: string; resultId: string; materials: { itemId: string; count: number }[]; requires?: Condition[] }
```

- 街の工房（鍛冶屋NPC）で作成・強化。
- プロトタイプの装備案（★要確認：武器のみか、アクセサリーも入れるか）
  - 武器「分散の剣」：分散結晶×5＋鉄片×3 → 攻撃+大。+1〜+3強化（レア素材は+3で使用）
  - アクセサリー「分配の護符」：分散結晶×8＋調律核×1 → **分散ノード+1**（400/400/400が可能に）
- 作成画面では「あと何個必要か」と「どのクエストで落ちるか」を表示 →「もう一周しよう」を誘発。

---

## 18. 習熟度管理

**レベルは「証拠」から算出。回数だけでは上がらない。ルールはデータ（masteryRules.json）。**

| Lv | 意味 | 判定条件（案） |
|---|---|---|
| 1 | 一度体験した | 体験1回以上 |
| 2 | 基本概念を識別できる | 「使うべき/使うべきでない」判断の正解が直近で一定数（例：直近5回中4回） |
| 3 | 異なる状況で適用できる | 2種類以上の**異なる形（variant）**で正しく適用 |
| 4 | 正式なIT用語として理解 | IT文脈の体験（サーバー振り分け等）＋用語の対応付け（例：ロードバランサ／ラウンドロビン）を確認 |
| 5 | 試験レベルで安定して回答 | 試験形式で、**別々の日に**複数問正解（例：3日以上に分かれて計3問連続正解） |

- **間違えたとき**：内部の `reviewPriority` を上げ、`nextReviewAt` を前倒し → ContentDirector が周回の道中イベント・敵構成・パートナーのヒント・サブクエストとして再遭遇させる。「不正解。復習してください」は出さない。
  ★要確認：**内部習熟度が下がった場合、画面上のスキルLvも下げるか？**（推奨：表示Lvは下げず、強化上限の判定だけ内部値を使う。RPGとして「弱体化」は不快なため）
- 復習間隔：簡易的な間隔反復（1日→3日→7日→14日…）。プロトタイプでは記録と再遭遇の優先度付けまで。

---

## 19. Save/IndexedDB設計

DB名 `itrpg`（バージョン管理・マイグレーション付き）

| ストア | 内容 |
|---|---|
| `saves` | スロット単位のセーブ（party, level, exp, stats, equipment, inventory, quests, knowledgeProgress, skills, flags, bestTimes, 位置） |
| `characters` | CharacterDefinition |
| `assets` | GLB Blob（キー＝assetId） |
| `meta` | スキーマバージョン、設定 |

- オートセーブ：クエスト完了・クラフト・エリア移動・リザルト時。
- localStorageは使わない（設定値の小さなキャッシュ程度のみ許容）。
- `navigator.storage.persist()` を要求して消去されにくくする。
- 将来：セーブのJSONエクスポート/インポート（GLBは別扱い）。

---

## 20. PWA設計

- `vite-plugin-pwa`：manifest（名前・アイコン・`display: standalone`・横向き推奨）、Service Workerでアプリ本体をプリキャッシュ → **オフラインで起動可能**。
- 更新時は「新しいバージョンがあります → 再読み込み」を表示（勝手に切り替えてセーブ中に壊さない）。
- ユーザーGLBはIndexedDB側（SWキャッシュには入れない）。
- Cloudflare Pagesは静的ファイル配信のみで動作。

---

## 21. 各Phaseの実装計画（各Phase完了時の確認項目つき）

| Phase | 内容 | 動作確認 |
|---|---|---|
| 1 | Vite+TS+Babylon+PWA骨格 | 画面に3D表示、ビルド成功、manifest読込 |
| 2 | 3Dフィールド（街・宿屋A/B/C・街道・戦闘/ボスエリア・工房、仮形状） | 全エリアが見える、FPS確認 |
| 3 | 主人公操作（プレースホルダー）・三人称カメラ | 歩く/走る/建物に当たる/カメラ回転 |
| 4 | GLB登録画面（検証・プレビュー・保存） | 正常GLB/非GLB/壊れGLBで期待通り |
| 5 | AnimationGroup割当・調整・歩かせてみる | 3アニメ割当・テスト再生 |
| 6 | 登録主人公でフィールドを歩く | 速度に応じてIdle/Walk/Run切替、リロード後も保持 |
| 7 | パートナー登録・追従 | 自然な追従、離れたらワープ |
| 8 | NPC・会話エンジン | データの会話が表示・分岐 |
| 9 | Questシステム | フラグ・目的・報酬 |
| 10 | Knowledgeシステム（定義/進捗/記録） | イベントが記録される（デバッグ画面で確認） |
| 11 | 宿屋クエスト＋DistributionPuzzle | 一連の流れで正式名称に到達 |
| 12 | 基本戦闘 | 雑魚戦が20〜30秒で終わる |
| 13 | 分散陣（概念スキル） | 1200→600/600 等の分配が見える |
| 14 | 敵・ボス（予兆・行動パターン） | 集中砲/拡散波の判断が成立 |
| 15 | EXP・Level・ステータス | レベルアップ演出と差分表示 |
| 16 | ドロップ・素材・レア保証 | 確率と保証の単体テスト |
| 17 | 装備作成・強化 | 装備で明確に楽になる |
| 18 | 周回クエスト＋道中イベントローテ | 再挑戦、前回比表示 |
| 19 | 習熟度の内部連動・ContentDirector | 間違えた知識の再遭遇 |
| 20 | セーブ | 全項目の保存/復元 |
| 21 | PWA動作確認 | インストール・オフライン起動 |

各Phaseで「既存機能のスモーク確認」を行い、壊れたまま次へ進みません。Phaseごとにgitコミットを分けます。

---

## 22. 技術的リスク

| リスク | 対策 |
|---|---|
| Tripo GLBの差異（スケール・向き・ルートモーション・アニメが別ファイル） | 調整UI、ルートモーション除去、別ファイルアニメ取り込み（要サンプル確認） |
| 大きなGLB・高解像度テクスチャでスマホが重い | 登録時に警告、ハードウェアスケーリング、影の制限 |
| Babylon.jsのバンドルサイズ | ES modulesの個別import、コード分割（登録画面は遅延ロード） |
| iOS SafariのIndexedDB消去（ホーム画面未追加時） | persist要求、PWAインストール推奨表示、将来エクスポート機能 |
| 「分散陣を常に押すだけ」になる | 拡散波・瀕死パートナー等、**使うべきでない状況**を混ぜる |
| 学習効果が本当にあるか（検証困難） | 内部ログで「体験→判断正解率」の推移を後から確認できるようにする |
| 試験知識の正確性・著作権 | 一次情報（IPAシラバス等）を `sources` に記録。過去問を使う場合は出典表記（★要確認） |
| バランス調整 | 数値は全てデータ化、デバッグ用チート（レベル/素材付与）を開発ビルドのみ用意 |

---

## 23. 今回作るもの（プロトタイプ）

- PWA基盤、小さな街＋周辺フィールド（仮形状）
- キャラクター登録（GLB検証・プレビュー・アニメ割当・調整・歩かせてみる・保存）
- 主人公操作、三人称カメラ、パートナー追従
- NPC会話、クエストシステム
- Knowledge 1件：負荷分散（定義・進捗・記録・習熟度算出・再遭遇優先度）
- 宿屋クエスト（DistributionPuzzle）
- シームレス戦闘、スキル「分散陣」(Lv1〜3)、雑魚2種、ボス1体
- EXP/Level/HP/攻撃/防御、レベルアップ演出
- 素材2種＋レア1種、ドロップ・レア保証
- 装備作成・強化（武器1種、★アクセサリー1種は要確認）
- 周回クエスト「交易路の防衛」＋道中イベント2種（馬車・魔力塔）
- リザルト（前回比・自己ベスト）
- IndexedDBセーブ、PWAインストール/オフライン起動
- （★要確認）負荷分散の試験形式問題を数問だけ置く「試練の石碑」（Lv5判定経路の確認用）

## 24. 今回作らないもの

- 負荷分散以外のKnowledge、複数資格の世界
- 本格的な模擬試験・試練の塔
- 仮想スティック・タッチ操作（設計上は対応可能にしておく）
- 仲間3人目以降、敵/ボスのGLB登録
- 防具、大量の装備・敵
- 高度なパートナーAI・説明を求めるイベント
- 豪華なグラフィック・サウンド全般（効果音は最小限）
- セーブのエクスポート/インポート、クラウド同期

---

## 最重要4点の実現方法

### ① テンポの良い戦闘と素材集めが純粋に楽しい
- シームレス戦闘（画面遷移なし）、雑魚戦20〜30秒、勝利→EXP/素材ポップ→1秒で次へ
- 素材は敵ごとに見た目が違うポップ、レアは特別演出、レア保証で「次は出るかも」を維持
- ボスは予兆→判断→成功で大きく有利、という「読み勝ち」の快感

### ② 強くなるために同じクエストを周回したくなる
- 作成画面に「あと2個」「交易路の防衛で入手」を表示 → 次の目標が常に見える
- 装備・レベル・スキル強化で**被ダメージ・クリアタイムが目に見えて減る**（リザルトで前回比表示）
- スキル強化は「素材」と「理解（習熟度上限）」の両輪 → 周回するほど両方が進む
- 周回ごとに道中イベントが変わる → 作業感を軽減

### ③ その周回が同時に同じIT知識の反復学習になっている
- 周回の中心ギミック（ボスの集中砲）そのものが負荷分散の適用場面。**使う/使わない**の判断も含めて毎回練習
- 道中イベントで同じ原理を別の形（馬車・塔・宿）で再体験。DistributionPuzzleは同じロジックをスキンだけ替えて使用
- スキルLvの効果がそのまま試験用語（ラウンドロビン→ヘルスチェック→重み付け→スケールアウト）に対応
- 間違い・期限到来の知識をContentDirectorが周回内容へ自然に混ぜる。プレイヤーには「復習」と表示しない

### ④ Tripoで作った好きなキャラを主人公・パートナーとして使える
- ゲーム内登録画面でGLBを選ぶだけ。アニメはGLB内の一覧から自分で割当（名前決め打ちなし）
- Scale・向き・高さ・速度を調整し「歩かせてみる」で確認してから登録
- Controller → Instance → Definition → GLB の分離で、どのモデルでも同じ操作感
- 主人公/パートナーの見た目はいつでも差し替え可能、未登録でもプレースホルダーで遊べる

---

## ★要確認事項まとめ

1. `ドキュメント/RMMZ/it-ipa` をプロジェクトフォルダとして使ってよいか
2. 戦闘方式：A案（シームレス・リアルタイムコマンド）でよいか
3. 「400/400/400」の3つ目の受け皿：分散ノード（アクセサリーで設置）案でよいか。プロトタイプの装備は武器のみか、アクセサリーも含めるか
4. Tripo GLBの構成：アニメは1ファイルにまとまっているか、別ファイルか（サンプルがあれば提供いただきたい）
5. 試験形式問題をプロトタイプに数問入れるか。入れる場合、オリジナル問題か、IPA過去問（出典明記）か
6. 間違えた時、画面上のスキルLvを下げるか（推奨：下げない）
7. ドロップ率・レア保証回数（案：15% / 8周で確定）
8. GLBサイズ警告の閾値と、拒否する上限を設けるか（案：15MB警告 / 50MB強警告 / 拒否なし）
9. GLB未登録時のプレースホルダーで遊べる仕様でよいか
10. スキル「分散陣」Lv4・5の効果内容（プロトタイプはLv1〜3でよいか）
11. UIは素のTS（推奨）かPreactか
12. 表示言語は日本語のみでよいか
