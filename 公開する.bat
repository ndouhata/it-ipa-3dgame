@echo off
chcp 65001 > nul
rem ダブルクリックでビルドして Cloudflare Pages（https://it-ipa-3dgame.pages.dev/）へ公開する
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run deploy
if errorlevel 1 (
  echo 公開に失敗しました。Cloudflareにログインしていない場合は「npx wrangler login」を実行してください。
) else (
  echo 公開しました： https://it-ipa-3dgame.pages.dev/
)
pause
