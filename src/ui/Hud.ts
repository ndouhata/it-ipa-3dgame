// 常時表示のHUD。学習データは前面に出さず、通常のRPGとしての情報だけを見せる。
import { h, bar, setBar, clear, fmtTime } from './dom';

export interface PartyView {
  heroName: string;
  partnerName: string;
  level: number;
  hp: number; maxHp: number;
  exp: number; expNext: number;
  partnerHp: number; partnerMaxHp: number;
  nodes: { hp: number; maxHp: number }[];
}

export interface SkillButtonView {
  id: string;
  key: string;
  name: string;
  levelText: string;
  levelDown: boolean;
  locked: boolean;
  cooldown: number;
  cooldownTotal: number;
  highlight: boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private party: HTMLElement;
  private heroHead: HTMLElement;
  private heroHp: HTMLElement;
  private heroHpText: HTMLElement;
  private heroExp: HTMLElement;
  private heroExpText: HTMLElement;
  private partnerHead: HTMLElement;
  private partnerHp: HTMLElement;
  private nodesBox: HTMLElement;
  private questBox: HTMLElement;
  private prompt: HTMLElement;
  private toasts: HTMLElement;
  private speech: HTMLElement | null = null;
  private speechTimer = 0;
  private skillbar: HTMLElement;
  private skillEls = new Map<string, HTMLElement>();
  private help: HTMLElement;
  menuButton: HTMLButtonElement;
  onSkillClick: (id: string) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'hud', style: { position: 'absolute', inset: '0' } });
    this.heroHead = h('div', { class: 'hud-member-head' });
    this.heroHp = bar(1, 'hp');
    this.heroHpText = h('span');
    this.heroExp = bar(0, 'exp');
    this.heroExpText = h('span');
    this.partnerHead = h('div', { class: 'hud-member-head' });
    this.partnerHp = bar(1, 'hp');
    this.nodesBox = h('div');
    this.party = h('div', { class: 'panel hud-party' },
      h('div', { class: 'hud-member' }, this.heroHead, this.heroHp, h('div', { class: 'hud-small' }, this.heroHpText, this.heroExpText), this.heroExp),
      h('div', { class: 'hud-member partner' }, this.partnerHead, this.partnerHp),
      this.nodesBox,
    );
    this.questBox = h('div', { class: 'panel hud-quest' });
    this.prompt = h('div', { class: 'panel prompt', style: { display: 'none' } });
    this.toasts = h('div', { class: 'toasts' });
    this.skillbar = h('div', { class: 'skillbar', style: { display: 'none' } });
    this.menuButton = h('button', { class: 'btn hud-menu-btn interactive', text: 'メニュー (M)' });
    this.help = h('div', { class: 'panel hud-help', html: '<kbd>WASD</kbd>移動 <kbd>Shift</kbd>走る <kbd>E</kbd>話す/調べる<br><kbd>ドラッグ</kbd>カメラ <kbd>ホイール</kbd>ズーム <kbd>M</kbd>メニュー' });
    this.root.append(this.party, this.questBox, this.prompt, this.toasts, this.skillbar, this.menuButton, this.help);
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
    clear(this.nodesBox);
    v.nodes.forEach((n, i) => {
      this.nodesBox.append(h('div', { class: 'hud-member partner' },
        h('div', { class: 'hud-member-head' }, h('span', { text: `分散ノード${v.nodes.length > 1 ? i + 1 : ''}` }), h('span', { class: 'muted', text: `${Math.ceil(n.hp)} / ${n.maxHp}` })),
        bar(n.hp / n.maxHp, 'node')));
    });
  }

  updateQuest(area: string, title: string | null, step: string | null, timerMs: number | null) {
    clear(this.questBox);
    this.questBox.append(h('div', { class: 'hud-area' }, h('span', { text: area }), timerMs !== null ? h('span', { class: 'hud-timer', text: `⏱ ${fmtTime(timerMs)}` }) : null));
    if (title) this.questBox.append(h('div', { class: 'hud-quest-title', text: `◆ ${title}` }));
    if (step) this.questBox.append(h('div', { class: 'hud-quest-step', text: step }));
  }

  setPrompt(text: string | null) {
    if (!text) { this.prompt.style.display = 'none'; return; }
    this.prompt.style.display = '';
    this.prompt.innerHTML = '';
    this.prompt.append(h('kbd', { text: 'E' }), text);
  }

  toast(text: string, tone: 'normal' | 'good' | 'bad' | 'rare' = 'normal', life = 2.4) {
    const el = h('div', { class: `panel toast ${tone}`, text });
    el.style.setProperty('--life', `${life}s`);
    this.toasts.append(el);
    setTimeout(() => el.remove(), (life + 0.5) * 1000);
    while (this.toasts.children.length > 6) this.toasts.firstElementChild?.remove();
  }

  say(who: string, text: string, seconds = 3.5) {
    this.speech?.remove();
    this.speech = h('div', { class: 'panel speech' }, h('span', { class: 'who', text: who }), text);
    this.root.append(this.speech);
    this.speechTimer = seconds;
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

  showSkills(list: SkillButtonView[] | null) {
    if (!list) { this.skillbar.style.display = 'none'; return; }
    this.skillbar.style.display = '';
    for (const s of list) {
      let el = this.skillEls.get(s.id);
      if (!el) {
        el = h('div', { class: 'panel skill interactive', onclick: () => this.onSkillClick(s.id) },
          h('div', { class: 'cd' }), h('span', { class: 'k' }), h('div', { class: 'nm' }), h('div', { class: 'lv' }));
        this.skillEls.set(s.id, el);
        this.skillbar.append(el);
      }
      (el.querySelector('.k') as HTMLElement).textContent = s.key;
      (el.querySelector('.nm') as HTMLElement).textContent = s.name;
      const lv = el.querySelector('.lv') as HTMLElement;
      lv.textContent = s.levelText;
      lv.classList.toggle('down', s.levelDown);
      const cd = el.querySelector('.cd') as HTMLElement;
      cd.style.transform = `scaleY(${s.cooldownTotal > 0 ? Math.min(1, s.cooldown / s.cooldownTotal) : 0})`;
      el.classList.toggle('locked', s.locked);
      el.classList.toggle('ready-glow', s.highlight && s.cooldown <= 0 && !s.locked);
    }
  }

  flashSkill(id: string) {
    const el = this.skillEls.get(id);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  setFieldHelpVisible(v: boolean) { this.help.style.display = v ? '' : 'none'; }
  setVisible(v: boolean) { this.root.style.display = v ? '' : 'none'; }

  tick(dt: number) {
    if (this.speech) {
      this.speechTimer -= dt;
      if (this.speechTimer <= 0) { this.speech.remove(); this.speech = null; }
    }
  }
}
