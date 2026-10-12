# ロードバランス・クロニクル（仮）

普通にRPGとして遊んでいたら、IT資格の知識が身についている ―― ブラウザで動く3D RPG（PWA）のプロトタイプです。
最初のテーマは **負荷分散（Load Balancing）**。

- 設計書：[docs/design.md](docs/design.md)
- 技術：TypeScript / Vite / Babylon.js / IndexedDB / PWA（サーバー不要）

## 遊び方

| 操作 | キー |
|---|---|
| 移動 / 走る | WASD・矢印 / Shift |
| 話す・調べる | E（Enter / Space） |
| カメラ | ドラッグで回転、ホイールでズーム |
| メニュー | M |
| 戦闘スキル | 1 強撃 / 2 分散陣 / 3 防御（E で攻撃対象の切替） |

1. 広場の町長に話しかけ、宿屋の困りごとを調べる
2. 入口の案内装置で旅人を振り分ける → 「負荷分散」を知り、技「分散陣」を覚える
3. 門番ガルドから「交易路の防衛」へ。ボスの「一点集中砲」の予兆中に分散陣を使う
4. 素材を集めて工房で装備を作り、もう一周（前回比のタイムが出ます）

## キャラクター登録（Tripo等のGLB）

メニュー → キャラクター → 「キャラクター登録を開く」。
GLBを選ぶ（またはドロップ）→ 3Dプレビュー → アニメーション（待機/歩行/走行）をプルダウンで割当 → 大きさ・向き・高さを調整 → 「歩かせてみる」 → 登録。
手元にGLBがない場合は「サンプル：主人公 / パートナー」で試せます（`public/samples/`、`npm run gen:sample` で再生成）。

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm test           # ロジックの単体テスト（戦闘・習熟度・ドロップ・ギミック・バランス）
npm run build      # 本番ビルド（dist/）
```

ゲームデータはすべて `src/data/*.json`。新しい知識・敵・クエスト・装備はJSONを足すだけで追加でき、起動時にスキーマと参照の整合性が検証されます。

## デプロイ（Cloudflare Pages）

GitHubリポジトリをCloudflare Pagesに接続し、次の設定にします。

| 項目 | 値 |
|---|---|
| Framework preset | None（または Vite） |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | `.node-version`（22）で指定済み |

`main` へのpushで自動デプロイされます。PWAの更新判定に使うファイルは `public/_headers` でエッジキャッシュしないようにしています（男盛と同じ方針）。
