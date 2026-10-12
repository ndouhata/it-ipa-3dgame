// ステータス・装備・素材・図鑑・システム。
import type { GameState } from '../game/GameState';
import { MASTERY_LABELS } from '../quiz/Mastery';
import { h, panel, clear, fmtTime, bar } from './dom';

export interface MenuContext {
  gs: GameState;
  heroName: string;
  partnerName: string;
  saveNow: () => Promise<boolean>;
  resetData: () => Promise<void>;
  storageInfo: () => Promise<string>;
  close: () => void;
}

type Tab = 'status' | 'equip' | 'items' | 'book' | 'system';
const TABS: [Tab, string][] = [['status', 'ステータス'], ['equip', '装備'], ['items', '素材'], ['book', '図鑑'], ['system', 'システム']];

export class MenuUI {
  private root: HTMLElement | null = null;
  private tab: Tab = 'status';

  constructor(private parent: HTMLElement) {}
  get isOpen() { return this.root !== null; }

  open(ctx: MenuContext) {
    this.close();
    const body = h('div');
    const tabs = h('div', { class: 'tabs' });
    const render = () => {
      clear(tabs);
      for (const [id, label] of TABS) tabs.append(h('button', { class: `tab${this.tab === id ? ' active' : ''}`, text: label, onclick: () => { this.tab = id; render(); } }));
      clear(body);
      body.append(this.renderTab(ctx, render));
    };
    this.root = panel('メニュー', ctx.close, tabs, body);
    this.parent.append(this.root);
    render();
  }

  close() {
    this.root?.remove();
    this.root = null;
  }

  private renderTab(ctx: MenuContext, rerender: () => void): HTMLElement {
    const { gs } = ctx;
    const s = gs.save;
    const d = gs.data;
    switch (this.tab) {
      case 'status': {
        const hero = gs.heroStats(), eq = gs.equipmentStats(), partner = gs.partnerStats();
        const next = gs.expToNext(s.player.level);
        const table = (st: Record<string, number>, extra?: Record<string, number>) => h('table', { class: 'stat-table' },
          ...Object.entries(st).map(([k, v]) => h('tr', null, h('td', { text: d.progression.statLabels[k] ?? k }),
            h('td', null, String(v), extra?.[k] ? h('span', { class: 'good small', text: ` (装備+${extra[k]})` }) : ''))));
        const bonus = gs.fastBonusSec();
        return h('div', { class: 'grid2' },
          h('div', { class: 'card' }, h('h4', { text: `${ctx.heroName}　Lv ${s.player.level}` }),
            h('div', { class: 'small muted', text: `EXP ${s.player.exp} / ${next}` }), bar(s.player.exp / next, 'exp'),
            table(hero, eq), bonus ? h('div', { class: 'small good', text: `速攻判定 +${bonus}秒` }) : null),
          h('div', { class: 'card' }, h('h4', { text: `${ctx.partnerName}　Lv ${s.player.level}` }), table(partner),
            h('p', { class: 'small muted', text: '毎ターン、主人公の攻撃に続いて自動で攻撃する。' })),
          h('div', { class: 'card' }, h('h4', { text: '冒険の記録' }),
            h('table', { class: 'stat-table' },
              h('tr', null, h('td', { text: 'プレイ時間' }), h('td', { text: fmtTime(s.playTimeMs) })),
              h('tr', null, h('td', { text: '解いた問題' }), h('td', { text: `${Object.values(s.quiz.stats).reduce((n, x) => n + x.seen, 0)}問` })),
              h('tr', null, h('td', { text: '速攻正解' }), h('td', { text: `${Object.values(s.quiz.stats).reduce((n, x) => n + x.fastCorrect, 0)}回` })))));
      }
      case 'equip': {
        const slots: ['weapon' | 'armor' | 'accessory', string][] = [['weapon', '武器'], ['armor', '防具'], ['accessory', 'アクセサリー']];
        return h('div', { class: 'grid2' }, ...slots.map(([slot, label]) => {
          const cur = s.ownedEquipment.find((e) => e.uid === s.equipment[slot]);
          const owned = s.ownedEquipment.filter((e) => d.equipment.get(e.equipId)?.slot === slot);
          return h('div', { class: 'card' }, h('h4', { text: label }),
            h('div', { text: cur ? `${gs.itemName(cur.equipId)} +${cur.enhance}` : '（なし）' }),
            ...owned.map((o) => {
              const def = d.equipment.get(o.equipId)!;
              const stats = Object.entries(def.baseStats).map(([k, v]) => `${d.progression.statLabels[k] ?? k}+${v + (def.perEnhance[k] ?? 0) * o.enhance}`).join(' ');
              const fast = def.grants?.fastBonusSec ? `速攻+${def.grants.fastBonusSec + (def.grantsPerEnhance?.fastBonusSec ?? 0) * o.enhance}秒` : '';
              return h('div', { class: 'row spread', style: { marginTop: '6px' } },
                h('span', { class: 'small', text: `${def.icon}${def.name} +${o.enhance}　${stats} ${fast}` }),
                s.equipment[slot] === o.uid
                  ? h('button', { class: 'btn btn-small', text: '外す', onclick: () => { gs.unequip(slot); rerender(); } })
                  : h('button', { class: 'btn btn-small', text: '装備', onclick: () => { gs.equip(o.uid); rerender(); } }));
            }),
            owned.length === 0 ? h('div', { class: 'small muted', text: '工房で作成できる' }) : null);
        }));
      }
      case 'items': {
        return h('div', { class: 'grid2' }, ...[...d.materials.values()].map((m) => h('div', { class: 'card' },
          h('div', { class: 'row spread' }, h('h4', { text: `${m.icon} ${m.name}` }), h('span', { class: 'stars', text: `× ${gs.count(m.id)}` })),
          m.rarity === 'rare' ? h('span', { class: 'tag rare', text: 'レア' }) : null,
          h('p', { class: 'small', text: m.description }),
          h('div', { class: 'small muted', text: `入手：${m.sourceHint}` }))));
      }
      case 'book': {
        return h('div', null, ...[...d.knowledge.values()].map((k) => {
          const m = gs.mastery(k.knowledgeId);
          return h('div', { class: 'card', style: { marginBottom: '8px' } },
            h('div', { class: 'row spread' },
              h('h4', { text: m.seen ? `${k.nameJa}（${k.nameEn}）` : '？？？' }),
              h('span', { class: 'stars', text: '★'.repeat(m.level) + '☆'.repeat(5 - m.level) })),
            h('div', { class: 'small muted', text: `${k.category}　${MASTERY_LABELS[m.level]}　出会った問題 ${m.seen}/${m.total}${m.seen ? `　最近の正答率 ${Math.round(m.accuracy * 100)}%` : ''}` }),
            m.seen ? h('p', { class: 'small', text: k.formalDescription }) : null);
        }));
      }
      case 'system': {
        const info = h('div', { class: 'small muted', text: '…' });
        void ctx.storageInfo().then((t) => (info.textContent = t));
        const msg = h('div', { class: 'small' });
        return h('div', { class: 'grid2' },
          h('div', { class: 'card' }, h('h4', { text: 'セーブ' }),
            h('p', { class: 'small', text: '戦闘の後やクラフトの後に自動でセーブされます。' }),
            h('button', { class: 'btn', text: '今すぐセーブ', onclick: async () => { msg.textContent = (await ctx.saveNow()) ? 'セーブしました。' : 'セーブに失敗しました。'; } }), msg, info),
          h('div', { class: 'card' }, h('h4', { text: 'データ初期化' }),
            h('p', { class: 'small', text: 'レベル・装備・問題の成績をすべて最初からやり直します（登録キャラクターは残ります）。' }),
            h('button', { class: 'btn btn-danger', text: '最初から', onclick: async () => { if (confirm('本当に最初からやり直しますか？')) await ctx.resetData(); } })));
      }
    }
  }
}
