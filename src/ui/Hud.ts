// 常時表示のHUD：パーティの状態、戦闘の進行、通知、レベルアップ演出。
import { h, bar, setBar, clear, fmtTime } from './dom';

export interface PartyView {
  heroName: string;
  partnerName: string;
  level: number;
  hp: number; maxHp: number;
  exp: number; expNext: number;
  partnerHp: number; partnerMaxHp: number;
}

export class Hud {
  readonly root: HTMLElement;
  private heroHead: HTMLElement;
  private heroHp: HTMLElement;
  private heroHpText: HTMLElement;
  private heroExp: HTMLElement;
  private heroExpText: HTMLElement;
  private partnerHead: HTMLElement;
  private partnerHp: HTMLElement;
  private header: HTMLElement;
  private toasts: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'hud', style: { position: 'absolute', inset: '0' } });
    this.heroHead = h('div', { class: 'hud-member-head' });
    this.heroHp = bar(1, 'hp');
    this.heroHpText = h('span');
    this.heroExp = bar(0, 'exp');
    this.heroExpText = h('span');
    this.partnerHead = h('div', { class: 'hud-member-head' });
    this.partnerHp = bar(1, 'hp');
    const party = h('div', { class: 'panel hud-party' },
      h('div', { class: 'hud-member' }, this.heroHead, this.heroHp, h('div', { class: 'hud-small' }, this.heroHpText, this.heroExpText), this.heroExp),
      h('div', { class: 'hud-member partner' }, this.partnerHead, this.partnerHp));
    this.header = h('div', { class: 'panel hud-quest', style: { display: 'none' } });
    this.toasts = h('div', { class: 'toasts' });
    this.root.append(party, this.header, this.toasts);
    parent.append(this.root);
  }

  updateParty(v: PartyView) {
    this.heroHead.replaceChildren(h('span', { text: v.heroName }), h('span', { class: 'lv', text: `Lv ${v.level}` }));
    setBar(this.heroHp, v.hp / v.maxHp);
    this.heroHp.classList.toggle('low', v.hp / v.maxHp < 0.3);
    this.heroHpText.textContent = `HP ${Math.ceil(v.hp)} / ${v.maxHp}`;
    setBar(this.heroExp, v.expNext > 0 ? v.exp / v.expNext : 1);
    this.heroExpText.textContent = v.expNext > 0 ? `次のLvまで ${v.expNext - v.exp}` : 'MAX';
    this.partnerHead.replaceChildren(h('span', { text: v.partnerName }), h('span', { class: 'muted', text: `HP ${Math.ceil(v.partnerHp)} / ${v.partnerMaxHp}` }));
    setBar(this.partnerHp, v.partnerHp / v.partnerMaxHp);
    this.partnerHp.classList.toggle('low', v.partnerHp / v.partnerMaxHp < 0.3);
  }

  /** 戦闘中の見出し（クエスト名・ウェーブ・経過時間・正答数） */
  setHeader(info: { title: string; wave: string; timeMs: number; score: string } | null) {
    if (!info) { this.header.style.display = 'none'; return; }
    this.header.style.display = '';
    clear(this.header);
    this.header.append(
      h('div', { class: 'hud-area' }, h('span', { text: info.title }), h('span', { class: 'hud-timer', text: `⏱ ${fmtTime(info.timeMs)}` })),
      h('div', { class: 'hud-quest-step', text: info.wave }),
      h('div', { class: 'small muted', text: info.score }));
  }

  toast(text: string, tone: 'normal' | 'good' | 'bad' | 'rare' = 'normal', life = 2.4) {
    const el = h('div', { class: `panel toast ${tone}`, text });
    el.style.setProperty('--life', `${life}s`);
    this.toasts.append(el);
    setTimeout(() => el.remove(), (life + 0.5) * 1000);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
  }

  banner(main: string, rows: [string, string, string][] = []) {
    const el = h('div', { class: 'banner' }, h('div', { class: 'banner-main', text: main }));
    if (rows.length) {
      const sub = h('div', { class: 'panel banner-sub' });
      for (const [a, b, c] of rows) sub.append(h('span', { text: a }), h('span', { text: b }), h('span', { class: 'up', text: c }));
      el.append(h('div', null, sub));
    }
    this.root.append(el);
    setTimeout(() => el.remove(), 2700);
  }

  setVisible(v: boolean) { this.root.style.display = v ? '' : 'none'; }
}
