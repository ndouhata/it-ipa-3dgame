import './styles.css';
import { loadGameData } from './data/registry';
import { SaveManager } from './save/SaveManager';
import { Game } from './game/Game';

const bootMsg = document.getElementById('boot-msg')!;
const boot = document.getElementById('boot')!;

function showFatal(e: unknown) {
  console.error(e);
  bootMsg.className = 'boot-sub boot-error';
  bootMsg.textContent = `起動できませんでした。\n${(e as Error)?.message ?? String(e)}`;
  boot.classList.remove('hide');
}

async function main() {
  const data = loadGameData();
  const saves = new SaveManager(data.map.spawn);
  const save = await saves.load();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  const game = new Game(canvas, ui, data, saves, save);
  await game.start();
  if (saves.lastError) bootMsg.textContent = saves.lastError;
  boot.classList.add('hide');
  // 動作確認用フック（開発時、または ?debug 付きURLのときだけ）
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) (window as unknown as { __game: unknown }).__game = game.debug();
  void registerPwa(ui);
}

/** Service Worker登録。更新があればボタンで反映（プレイ中に勝手に切り替えない） */
async function registerPwa(ui: HTMLElement) {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    const update = registerSW({
      onNeedRefresh() {
        const bar = document.createElement('div');
        bar.className = 'panel interactive';
        bar.style.cssText = 'position:absolute;left:50%;bottom:90px;transform:translateX(-50%);padding:8px 14px;display:flex;gap:10px;align-items:center;pointer-events:auto';
        bar.textContent = '新しいバージョンがあります';
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = '更新する';
        btn.onclick = () => void update(true);
        bar.append(btn);
        ui.append(bar);
      },
    });
  } catch (e) {
    console.warn('PWA登録に失敗', e);
  }
}

window.addEventListener('error', (e) => { if (!document.getElementById('boot')?.classList.contains('hide')) showFatal(e.error ?? e.message); });
main().catch(showFatal);
