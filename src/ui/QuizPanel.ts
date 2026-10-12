// 攻撃・防御・経験値のたびに出る問題パネル。速さと正誤の結果を返す。
import type { PresentedQuestion, AnswerResult } from '../quiz/QuestionEngine';
import type { OutcomeKey } from '../data/schema';
import { h, clear } from './dom';

export type QuizKind = 'attack' | 'defense' | 'exp';

const KIND_LABEL: Record<QuizKind, { title: string; cls: string }> = {
  attack: { title: '⚔ 攻撃', cls: 'q-attack' },
  defense: { title: '🛡 防御', cls: 'q-defense' },
  exp: { title: '★ 経験値', cls: 'q-exp' },
};

export const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  fastCorrect: '速攻正解！',
  slowCorrect: '正解',
  slowWrong: '不正解',
  fastWrong: '早押しミス',
};

const MARKS = ['1', '2', '3', '4', '5', '6'];

export class QuizPanel {
  private root: HTMLElement;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'quiz', style: { display: 'none' } });
    parent.append(this.root);
  }

  /** 問題を出し、答え（表示位置 or 時間切れ null）と所要秒数を返す */
  ask(kind: QuizKind, subtitle: string, p: PresentedQuestion): Promise<{ chosen: number | null; seconds: number }> {
    this.cleanup();
    clear(this.root);
    this.root.style.display = '';
    const k = KIND_LABEL[kind];
    const fill = h('div', { class: 'quiz-timer-fill' });
    const fastMark = h('div', { class: 'quiz-timer-fast', style: { width: `${(p.fastSec / p.limitSec) * 100}%` } });
    const secLabel = h('span', { class: 'quiz-sec' });
    const choices = h('div', { class: 'quiz-choices' });
    const panel = h('div', { class: `panel quiz-panel ${k.cls}` },
      h('div', { class: 'quiz-head' },
        h('span', { class: 'quiz-kind', text: k.title }),
        h('span', { class: 'quiz-sub', text: subtitle }),
        p.isRepeat ? h('span', { class: 'tag rare', text: 'もう一度' }) : null,
        secLabel),
      h('div', { class: 'quiz-timer' }, fastMark, fill),
      h('div', { class: 'quiz-stem', text: p.question.stem }),
      choices);
    this.root.append(panel);

    return new Promise((resolve) => {
      const start = performance.now();
      let done = false;
      const finish = (chosen: number | null) => {
        if (done) return;
        // 前の画面を閉じたクリック・キー入力で誤って選ばないよう、表示直後は受け付けない
        if (chosen !== null && performance.now() - start < 250) return;
        done = true;
        this.cleanup();
        Array.from(choices.children).forEach((b) => ((b as HTMLButtonElement).disabled = true));
        if (chosen !== null) choices.children[chosen]?.classList.add('picked');
        resolve({ chosen, seconds: (performance.now() - start) / 1000 });
      };
      p.order.forEach((orig, i) => {
        choices.append(h('button', { class: 'btn quiz-choice', onclick: () => finish(i) },
          h('span', { class: 'quiz-mark', text: MARKS[i] }), p.question.choices[orig]));
      });
      this.keyHandler = (e) => {
        const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (m && Number(m[1]) <= p.order.length) finish(Number(m[1]) - 1);
      };
      window.addEventListener('keydown', this.keyHandler);
      const tick = () => {
        if (done) return;
        const t = (performance.now() - start) / 1000;
        fill.style.width = `${Math.min(100, (t / p.limitSec) * 100)}%`;
        fill.classList.toggle('slow', t > p.fastSec);
        secLabel.textContent = t <= p.fastSec ? `速攻あと ${(p.fastSec - t).toFixed(1)}秒` : `残り ${Math.max(0, p.limitSec - t).toFixed(0)}秒`;
        if (t >= p.limitSec) finish(null);
      };
      tick();
      this.timer = window.setInterval(tick, 50);
    });
  }

  /** 結果表示。正解はすぐ次へ、不正解は正解と解説を見せてから（クリック / Enter / 数秒） */
  showResult(p: PresentedQuestion, r: AnswerResult, effect: string): Promise<void> {
    const choices = this.root.querySelector('.quiz-choices');
    choices?.children[r.correctIndex]?.classList.add('correct');
    const picked = choices?.querySelector('.picked');
    if (picked && !r.correct) picked.classList.add('wrong');
    const panel = this.root.querySelector('.quiz-panel')!;
    const res = h('div', { class: `quiz-result ${r.correct ? 'ok' : 'ng'}` },
      h('span', { class: 'quiz-outcome', text: r.timedOut ? '時間切れ' : OUTCOME_LABEL[r.outcome] }),
      h('span', { class: 'quiz-effect', text: effect }));
    panel.append(res);
    if (r.correct) return new Promise((resolve) => setTimeout(resolve, 650));
    const nextBtn = h('button', { class: 'btn btn-primary quiz-next-btn', text: '次へ ▶（Enter）' });
    panel.append(h('div', { class: 'quiz-explain', text: `正解：${p.question.choices[p.question.answer]}\n${p.question.explanation}` }),
      h('div', { class: 'quiz-next' }, h('span', { text: '画面のどこかをクリックしても進めます' }), nextBtn));
    return new Promise((resolve) => {
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        this.cleanup();
        resolve();
      };
      // 無効化した選択肢ボタンの上ではクリックがパネルに届かないため、画面全体で受け付ける
      const onPointer = () => go();
      setTimeout(() => {
        if (done) return;
        this.keyHandler = (e) => { if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); go(); } };
        window.addEventListener('keydown', this.keyHandler);
        window.addEventListener('pointerdown', onPointer, { capture: true });
        this.extraCleanup = () => window.removeEventListener('pointerdown', onPointer, { capture: true });
      }, 250);
      nextBtn.addEventListener('click', go);
    });
  }

  private extraCleanup: (() => void) | null = null;

  hide() {
    this.cleanup();
    this.root.style.display = 'none';
    clear(this.root);
  }

  private cleanup() {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    this.extraCleanup?.();
    this.extraCleanup = null;
    clearInterval(this.timer);
  }
}
