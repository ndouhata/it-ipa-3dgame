// 試練の石碑：十分に体験した知識だけを、試験形式で確かめる場所。
import type { ExamQuestion } from '../data/schema';
import { h, panel, clear } from './dom';

export interface ExamAnswer { question: ExamQuestion; correct: boolean }

export class ExamUI {
  private root: HTMLElement | null = null;
  constructor(private parent: HTMLElement) {}
  get isOpen() { return this.root !== null; }

  open(title: string, questions: ExamQuestion[], onAnswer: (a: ExamAnswer) => void, onDone: (answers: ExamAnswer[]) => void) {
    this.close();
    const body = h('div');
    const answers: ExamAnswer[] = [];
    let i = 0;
    const show = () => {
      clear(body);
      const q = questions[i];
      if (!q) {
        const ok = answers.filter((a) => a.correct).length;
        body.append(
          h('div', { class: 'exam-stem', text: `${questions.length}問中 ${ok}問 正解` }),
          h('p', { class: ok === questions.length ? 'good' : 'muted', text: ok === questions.length ? '石碑が強く輝いた――試練を乗り越えた！' : '石碑の光が揺らいでいる……。冒険を続けてから、また挑もう。' }),
          h('button', { class: 'btn btn-primary', text: '閉じる', onclick: () => { this.close(); onDone(answers); } }));
        return;
      }
      const choices = h('div', { class: 'exam-choices' });
      const explain = h('div');
      const labels = ['ア', 'イ', 'ウ', 'エ', 'オ'];
      q.choices.forEach((c, idx) => {
        const btn = h('button', { class: 'btn', text: `${labels[idx]}　${c}` });
        btn.onclick = () => {
          const correct = idx === q.answer;
          answers.push({ question: q, correct });
          onAnswer({ question: q, correct });
          Array.from(choices.children).forEach((b, k) => {
            (b as HTMLButtonElement).disabled = true;
            if (k === q.answer) b.classList.add('correct');
            else if (k === idx) b.classList.add('wrong');
          });
          explain.append(
            h('p', { class: correct ? 'good' : 'bad', text: correct ? '正解！' : `不正解…　正解は「${labels[q.answer]}」` }),
            h('p', { class: 'small', text: q.explanation }),
            h('button', { class: 'btn btn-primary', text: i + 1 < questions.length ? '次へ' : '結果を見る', onclick: () => { i++; show(); } }));
        };
        choices.append(btn);
      });
      body.append(
        h('div', { class: 'small muted', text: `第${i + 1}問 / ${questions.length}` }),
        h('div', { class: 'exam-stem', text: q.stem }), choices, explain,
        h('div', { class: 'exam-source', text: `出典：${q.source.label}` }));
    };
    this.root = panel(title, () => { this.close(); onDone(answers); }, body);
    this.parent.append(this.root);
    show();
  }

  close() {
    this.root?.remove();
    this.root = null;
  }
}
