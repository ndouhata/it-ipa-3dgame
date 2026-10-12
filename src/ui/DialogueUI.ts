// 会話ウィンドウ。会話データ（ノード・選択肢・アクション）を順に再生する。
import type { Action, DialogueDefinition } from '../data/schema';
import { h } from './dom';

export interface DialogueContext {
  resolve: (text: string) => string;
  runActions: (actions: Action[] | undefined) => void;
}

export class DialogueUI {
  private el: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private parent: HTMLElement) {}

  get isOpen() { return this.el !== null; }

  play(def: DialogueDefinition, ctx: DialogueContext): Promise<void> {
    return new Promise((resolve) => {
      const show = (nodeId: string | undefined) => {
        const node = nodeId ? def.nodes[nodeId] : undefined;
        if (!node) return this.close(resolve);
        ctx.runActions(node.actions);
        const choices = node.choices;
        const box = h('div', { class: 'panel dialogue interactive' },
          h('div', { class: 'who', text: ctx.resolve(node.speaker) }),
          h('div', { class: 'txt', text: ctx.resolve(node.text) }),
        );
        let advance: (() => void) | null = null;
        let pick: ((i: number) => void) | null = null;
        if (choices?.length) {
          const list = h('div', { class: 'choices' });
          pick = (i: number) => {
            const c = choices[i];
            if (!c) return;
            ctx.runActions(c.actions);
            show(c.next);
          };
          choices.forEach((c, i) => list.append(h('button', { class: 'btn', text: `${i + 1}. ${ctx.resolve(c.text)}`, onclick: (e: MouseEvent) => { e.stopPropagation(); pick!(i); } })));
          box.append(list);
        } else {
          box.append(h('div', { class: 'next', text: '▼' }));
          advance = () => show(node.next);
          box.addEventListener('click', advance);
        }
        this.mount(box);
        this.bindKeys((e) => {
          if (pick && /^Digit[1-9]$/.test(e.code)) pick(Number(e.code.slice(5)) - 1);
          else if (advance && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE')) advance();
        });
      };
      show(def.start);
    });
  }

  private mount(box: HTMLElement) {
    this.el?.remove();
    this.el = box;
    this.parent.append(box);
  }

  private bindKeys(fn: (e: KeyboardEvent) => void) {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    // 直前のキー入力（会話を開いたEキー等）で即座に進まないよう、少し遅らせて登録
    this.keyHandler = (e) => { if (!e.repeat) fn(e); };
    const handler = this.keyHandler;
    setTimeout(() => { if (this.keyHandler === handler) window.addEventListener('keydown', handler); }, 60);
  }

  private close(done: () => void) {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    this.el?.remove();
    this.el = null;
    done();
  }
}
