// 分配ギミックの画面。宿屋・馬車・魔力塔・サーバで見た目の文言だけが変わる。
import type { GimmickDefinition } from '../data/schema';
import { DistributionPuzzle } from '../gimmick/DistributionPuzzle';
import { h, bar, setBar, panel } from './dom';

export interface PuzzleOutcome { success: boolean; balance: number; lost: number }

export class PuzzleUI {
  private puzzle: DistributionPuzzle | null = null;
  private root: HTMLElement | null = null;
  private targetEls: HTMLElement[] = [];
  private source!: HTMLElement;
  private waitBar!: HTMLElement;
  private status!: HTMLElement;
  private resultBox!: HTMLElement;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private resolve: ((o: PuzzleOutcome) => void) | null = null;
  private started = false;
  onHint: (trigger: string) => void = () => {};
  /** 1回の挑戦ごとの結果（失敗→再挑戦も含めて学習記録に使う） */
  onAttempt: (def: GimmickDefinition, o: PuzzleOutcome) => void = () => {};

  constructor(private parent: HTMLElement) {}

  get isOpen() { return this.root !== null; }

  open(def: GimmickDefinition): Promise<PuzzleOutcome> {
    this.close();
    this.puzzle = new DistributionPuzzle(def);
    this.started = false;
    this.source = h('div', { class: 'puzzle-unit' });
    this.waitBar = bar(0, 'puzzle-wait');
    this.status = h('div', { class: 'puzzle-status' });
    this.resultBox = h('div', { class: 'puzzle-result' });
    this.targetEls = def.targets.map((t, i) => {
      const el = h('div', { class: 'panel ptarget interactive', onclick: () => this.route(i) },
        h('div', { class: 'key', text: String(i + 1) }),
        h('div', null, h('div', { class: 'lbl', text: t.label }), h('div', { class: 'slots' })),
        h('div', { class: 'small muted rate' }),
      );
      return el;
    });
    const startBtn = h('button', { class: 'btn btn-primary', text: def.demoSeconds > 0 ? '様子を見る' : 'はじめる' });
    const intro = h('div', null, h('div', { class: 'puzzle-intro', text: def.intro }), startBtn);
    const play = h('div', { style: { display: 'none' } },
      h('div', { class: 'puzzle' },
        h('div', { class: 'card puzzle-source' }, h('div', { class: 'muted small', text: def.sourceLabel }), this.source, this.waitBar),
        h('div', { class: 'puzzle-targets' }, ...this.targetEls),
      ),
      this.status, this.resultBox,
    );
    startBtn.onclick = () => {
      intro.style.display = 'none';
      play.style.display = '';
      this.started = true;
      this.onHint(`gimmick:${def.variant}`);
    };
    this.root = panel(def.title, null, intro, play);
    this.parent.append(this.root);
    this.keyHandler = (e) => {
      if (e.repeat) return;
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) this.route(Number(m[1]) - 1);
      if ((e.code === 'Enter' || e.code === 'Space') && !this.started) startBtn.click();
    };
    window.addEventListener('keydown', this.keyHandler);
    this.render();
    return new Promise((r) => (this.resolve = r));
  }

  private route(i: number) {
    if (!this.puzzle || this.puzzle.phase !== 'play') return;
    this.puzzle.route(i);
  }

  tick(dt: number) {
    const p = this.puzzle;
    if (!p || !this.started) return;
    p.tick(dt);
    for (const ev of p.drainEvents()) {
      if (ev.type === 'routed' || ev.type === 'overflow') {
        const el = this.targetEls[ev.target];
        el.classList.remove('flash-ok', 'flash-ng');
        void el.offsetWidth;
        el.classList.add(ev.type === 'overflow' ? 'flash-ng' : 'flash-ok');
      }
      if (ev.type === 'end') this.finish(ev.success);
    }
    this.render();
  }

  private render() {
    const p = this.puzzle;
    if (!p) return;
    const d = p.def;
    p.targets.forEach((t, i) => {
      const el = this.targetEls[i];
      el.classList.toggle('down', t.down);
      const slots = el.querySelector('.slots') as HTMLElement;
      const filled = Math.ceil(t.load - 1e-6);
      if (slots.childElementCount !== t.capacity) slots.replaceChildren(...Array.from({ length: t.capacity }, () => h('div', { class: 'slot' })));
      Array.from(slots.children).forEach((s, k) => s.classList.toggle('on', k < filled));
      (el.querySelector('.rate') as HTMLElement).textContent =
        t.down ? '停止中' : t.serviceRate > 0 ? `${d.unitLabel} ${filled}/${t.capacity}` : `積載 ${Math.round(t.load)}/${t.capacity}`;
    });
    if (p.pending) {
      this.source.replaceChildren(d.unitIcon, p.pending.size > 1 ? h('span', { class: 'sz', text: `×${p.pending.size}` }) : '');
      setBar(this.waitBar, 1 - p.pending.wait / d.autoRouteAfter);
    } else {
      this.source.replaceChildren(h('span', { class: 'muted small', text: '…' }));
      setBar(this.waitBar, 0);
    }
    const demo = p.phase === 'demo';
    this.status.replaceChildren(
      demo ? h('span', { class: 'puzzle-demo', text: `何もしないと…すべて${d.targets[d.defaultTarget].label}へ。あふれた${d.unitLabel}：${p.demoLost}（${Math.max(0, d.demoSeconds - p.time).toFixed(0)}秒後に操作開始）` })
        : h('span', { text: `残り ${p.remaining + (p.pending ? 1 : 0)} ${d.unitLabel}` }),
      demo ? '' : h('span', { class: p.lost > 0 ? 'bad' : '', text: `あふれた：${p.lost} / 許容 ${d.allowedLoss}` }),
    );
  }

  private finish(success: boolean) {
    const p = this.puzzle!;
    this.onAttempt(p.def, { success, balance: p.balanceScore(), lost: p.lost });
    const done = () => {
      const r = this.resolve;
      const outcome = { success, balance: p.balanceScore(), lost: p.lost };
      this.close();
      r?.(outcome);
    };
    const retry = () => {
      const r = this.resolve;
      this.resolve = null;
      const def = p.def;
      this.close();
      void this.open({ ...def, demoSeconds: 0 }).then((o) => r?.(o));
    };
    this.resultBox.replaceChildren(
      h('div', { class: success ? 'good' : 'bad', text: success ? p.def.success : p.def.failure }),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        success ? h('button', { class: 'btn btn-primary', text: 'OK', onclick: done }) : h('button', { class: 'btn btn-primary', text: 'もう一度', onclick: retry }),
        success ? null : h('button', { class: 'btn', text: 'あきらめる', onclick: done }),
      ),
    );
  }

  close() {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    this.root?.remove();
    this.root = null;
    this.puzzle = null;
  }
}
