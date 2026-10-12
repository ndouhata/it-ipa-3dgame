// 自分用の問題を取り込む画面。取り込んだ問題はこの端末の中だけに保存される。
import { h, panel, clear } from './dom';
import {
  TEMPLATE_CSV, deletePrivateSet, loadPrivateSet, parseQuestionFile, savePrivateSet, type PrivateRow,
} from '../quiz/PrivateQuestions';

export class PrivateImportUI {
  private root: HTMLElement | null = null;

  constructor(private parent: HTMLElement) {}
  get isOpen() { return this.root !== null; }

  async open(onClose: () => void, onChanged: () => void) {
    this.close();
    const body = h('div');
    this.root = panel('自分の問題を取り込む', () => { this.close(); onClose(); }, body);
    this.parent.append(this.root);
    const current = await loadPrivateSet();
    const status = h('div', { class: 'small' });
    const preview = h('div');
    let pending: { rows: PrivateRow[]; fileName: string } | null = null;
    const saveBtn = h('button', { class: 'btn btn-primary', text: 'この内容で取り込む', disabled: true });

    const fileInput = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.json,text/csv' }) as HTMLInputElement;
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const r = await parseQuestionFile(f, f.name);
      clear(preview);
      pending = r.rows.length ? { rows: r.rows, fileName: f.name } : null;
      saveBtn.disabled = !pending;
      const fields = [...new Set(r.rows.map((x) => x.field))];
      preview.append(
        h('div', { class: r.rows.length ? 'good' : 'bad', text: r.rows.length ? `${r.rows.length}問を読み込みました（分野：${fields.join('・')}）` : '取り込める問題がありませんでした' }),
        ...r.errors.slice(0, 8).map((e) => h('div', { class: 'issue warn', text: e })),
        r.errors.length > 8 ? h('div', { class: 'small muted', text: `ほか ${r.errors.length - 8}件` }) : '',
        ...r.rows.slice(0, 3).map((x) => h('div', { class: 'card small', style: { marginTop: '6px' } },
          h('div', { text: `【${x.field}】${x.stem}` }), h('div', { class: 'good', text: `正解：${x.correct}` }))));
    };
    saveBtn.onclick = async () => {
      if (!pending) return;
      saveBtn.disabled = true;
      try {
        await savePrivateSet({ fileName: pending.fileName, importedAt: new Date().toISOString(), rows: pending.rows });
        onChanged();
      } catch (e) {
        status.textContent = `保存に失敗しました：${(e as Error).message}`;
        saveBtn.disabled = false;
      }
    };
    const download = () => {
      // Excelで文字化けしないようBOM付きUTF-8で保存
      const blob = new Blob(['﻿' + TEMPLATE_CSV], { type: 'text/csv' });
      const a = h('a', { href: URL.createObjectURL(blob), download: '自分の問題_見本.csv' }) as HTMLAnchorElement;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    status.textContent = current ? `取り込み済み：${current.rows.length}問（${current.fileName}、${new Date(current.importedAt).toLocaleString('ja-JP')}）` : 'まだ取り込んでいません';
    body.append(
      h('div', { class: 'card' },
        h('h4', { text: 'この端末の中だけに保存されます' }),
        h('p', { class: 'small', text: '取り込んだ問題は、このブラウザの中（IndexedDB）にだけ保存され、公開サイトには一切アップロードされません。他の人からは見えません。スマホとPCで遊ぶときは、それぞれの端末で同じファイルを1回ずつ取り込んでください。' }),
        status,
        current ? h('button', { class: 'btn btn-danger btn-small', text: '取り込んだ問題を削除', onclick: async () => { if (confirm('取り込んだ問題を削除しますか？')) { await deletePrivateSet(); onChanged(); } } }) : null),
      h('div', { class: 'card', style: { marginTop: '10px' } },
        h('h4', { text: 'ファイルの作り方' }),
        h('p', { class: 'small', text: 'Excelやスプレッドシートで、1行に1問、左から「分野・問題文・正解・誤答1・誤答2・誤答3・解説」の順に入力し、CSVで保存します（1行目は見出しでも構いません）。誤答は1〜3個、解説は省略できます。選択肢の並びは出題のたびにシャッフルされます。' }),
        h('button', { class: 'btn btn-small', text: '見本ファイルをダウンロード', onclick: download })),
      h('div', { class: 'card', style: { marginTop: '10px' } },
        h('h4', { text: 'ファイルを選ぶ（CSV・TSV・JSON）' }),
        fileInput, preview,
        h('div', { class: 'row', style: { marginTop: '8px' } }, saveBtn)));
  }

  close() {
    this.root?.remove();
    this.root = null;
  }
}
