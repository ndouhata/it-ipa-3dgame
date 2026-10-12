// 素のTSで画面を組むための最小ヘルパー。
type Child = Node | string | number | null | undefined | false;
type Props = {
  class?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  onclick?: (e: MouseEvent) => void;
  title?: string;
  [attr: string]: unknown;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function bar(ratio: number, cls: string) {
  const outer = h('div', { class: `bar ${cls}` });
  const inner = h('div', { class: 'bar-fill', style: { width: `${Math.max(0, Math.min(1, ratio)) * 100}%` } });
  outer.append(inner);
  return outer;
}

export function setBar(outer: HTMLElement, ratio: number) {
  const fill = outer.firstElementChild as HTMLElement | null;
  if (fill) fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

export const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 開いているモーダル用の共通パネル */
export function panel(title: string, onClose: (() => void) | null, ...children: Child[]) {
  return h('div', { class: 'modal-backdrop' },
    h('div', { class: 'panel modal' },
      h('div', { class: 'panel-head' },
        h('div', { class: 'panel-title', text: title }),
        onClose ? h('button', { class: 'btn btn-close', text: '✕', onclick: onClose, title: '閉じる (Esc)' }) : null,
      ),
      h('div', { class: 'panel-body' }, ...children),
    ),
  );
}
