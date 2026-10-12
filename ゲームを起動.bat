@echo off
chcp 65001 > nul
rem ダブルクリックで開発サーバーを起動し、ブラウザで開く
cd /d "%~dp0"

where npm > nul 2>&1
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ からインストールしてください。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 初回のみ：必要なパッケージをインストールしています...
  call npm install
  if errorlevel 1 (
    echo インストールに失敗しました。
    pause
    exit /b 1
  )
)

echo ゲームを起動しています。ブラウザが自動で開きます。
echo 終了するときは、この画面を閉じてください。
call npm run dev -- --open
pause
