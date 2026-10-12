// 入力の抽象。Controllerは InputSource だけを見るので、将来の仮想スティック/ゲームパッドも差し替え可能。
export interface MoveIntent {
  /** 画面基準の入力 (-1..1)。x:右, y:前 */
  x: number;
  y: number;
  run: boolean;
}

export interface InputSource {
  getMove(): MoveIntent;
  /** このフレームに押されたアクション（interact / skill1..3 / menu / cancel） */
  consumeActions(): Set<string>;
}

const ACTION_KEYS: Record<string, string> = {
  KeyE: 'interact', Enter: 'interact', Space: 'interact',
  Digit1: 'skill1', Digit2: 'skill2', Digit3: 'skill3',
  Numpad1: 'skill1', Numpad2: 'skill2', Numpad3: 'skill3',
  Escape: 'cancel', KeyM: 'menu', Tab: 'menu',
};

export class KeyboardInput implements InputSource {
  private down = new Set<string>();
  private actions = new Set<string>();
  enabled = true;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!e.repeat && ACTION_KEYS[e.code]) this.actions.add(ACTION_KEYS[e.code]);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  getMove(): MoveIntent {
    if (!this.enabled) return { x: 0, y: 0, run: false };
    const d = this.down;
    const x = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0);
    const y = (d.has('KeyW') || d.has('ArrowUp') ? 1 : 0) - (d.has('KeyS') || d.has('ArrowDown') ? 1 : 0);
    return { x, y, run: d.has('ShiftLeft') || d.has('ShiftRight') };
  }

  consumeActions() {
    const a = this.actions;
    this.actions = new Set();
    return a;
  }

  /** UIボタン等から同じアクションを発火する */
  push(action: string) { this.actions.add(action); }
}

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
