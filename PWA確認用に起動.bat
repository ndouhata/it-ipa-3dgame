@echo off
chcp 65001 > nul
rem ダブルクリックで本番ビルドを作り、PWA確認用サーバーを起動してブラウザで開く
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

echo 本番用にビルドしています...
call npm run build
if errorlevel 1 (
  echo ビルドに失敗しました。
  pause
  exit /b 1
)

echo PWA確認用サーバーを起動しています。ブラウザが自動で開きます。
echo 終了するときは、この画面を閉じてください。
call npm run preview -- --open
pause
