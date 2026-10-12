// メインメニュー。通常のRPGとしての情報（ステータス・装備・素材・スキル・クエスト・図鑑）を見せる。
import type { GameState } from '../game/GameState';
import { MASTERY_LABELS } from '../learning/Learning';
import { getProgress } from '../learning/Learning';
import { h, panel, clear, fmtTime, bar } from './dom';

export interface MenuContext {
  gs: GameState;
  heroName: string;
  partnerName: string;
  appearance: { hero: string; partner: string };
  openRegistry: () => void;
  saveNow: () => Promise<boolean>;
  resetData: () => Promise<void>;
  storageInfo: () => Promise<string>;
  close: () => void;
}

type Tab = 'status' | 'equip' | 'items' | 'skills' | 'quests' | 'book' | 'chars' | 'system';
const TABS: [Tab, string][] = [
  ['status', 'ステータス'], ['equip', '装備'], ['items', '素材'], ['skills', 'スキル'],
  ['quests', 'クエスト'], ['book', '図鑑'], ['chars', 'キャラクター'], ['system', 'システム'],
];

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
        const hero = gs.heroStats(), base = gs.baseStatsAt(s.player.level), eq = gs.equipmentStats(), partner = gs.partnerStats();
        const next = gs.expToNext(s.player.level);
        const table = (st: Record<string, number>, extra?: Record<string, number>) => h('table', { class: 'stat-table' },
          ...Object.entries(st).map(([k, v]) => h('tr', null, h('td', { text: d.progression.statLabels[k] ?? k }),
            h('td', null, String(v), extra?.[k] ? h('span', { class: 'good small', text: ` (+${extra[k]})` }) : ''))));
        return h('div', { class: 'grid2' },
          h('div', { class: 'card' }, h('h4', { text: `${ctx.heroName}　Lv ${s.player.level}` }),
            h('div', { class: 'small muted', text: `EXP ${s.player.exp} / ${next}` }), bar(s.player.exp / next, 'exp'),
            table({ ...base, hp: hero.hp, atk: hero.atk, def: hero.def }, eq)),
          h('div', { class: 'card' }, h('h4', { text: `${ctx.partnerName}　Lv ${s.player.level}` }), table(partner),
            h('p', { class: 'small muted', text: '戦闘では自動で攻撃し、主人公が危なくなると回復してくれる。' })),
          h('div', { class: 'card' }, h('h4', { text: '冒険の記録' }),
            h('table', { class: 'stat-table' },
              h('tr', null, h('td', { text: 'プレイ時間' }), h('td', { text: fmtTime(s.playTimeMs) })),
              h('tr', null, h('td', { text: '交易路の防衛 クリア回数' }), h('td', { text: String(gs.quest('trade-road').clears) })),
              h('tr', null, h('td', { text: '最速タイム' }), h('td', { text: gs.quest('trade-road').bestTimeMs ? fmtTime(gs.quest('trade-road').bestTimeMs!) : '—' })))),
        );
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
              return h('div', { class: 'row spread', style: { marginTop: '6px' } },
                h('span', { class: 'small', text: `${def.icon}${def.name} +${o.enhance}　${stats}${def.grants?.distributionNodes ? '　分散ノード+1' : ''}` }),
                s.equipment[slot] === o.uid
                  ? h('button', { class: 'btn btn-small', text: '外す', onclick: () => { gs.unequip(slot); rerender(); } })
                  : h('button', { class: 'btn btn-small', text: '装備', onclick: () => { gs.equip(o.uid); rerender(); } }));
            }),
            owned.length === 0 ? h('div', { class: 'small muted', text: '工房で作成できる' }) : null);
        }));
      }
      case 'items': {
        const mats = [...d.materials.values()];
        return h('div', { class: 'grid2' }, ...mats.map((m) => h('div', { class: 'card' },
          h('div', { class: 'row spread' }, h('h4', { text: `${m.icon} ${m.name}` }), h('span', { class: 'stars', text: `× ${gs.count(m.id)}` })),
          m.rarity === 'rare' ? h('span', { class: 'tag rare', text: 'レア' }) : null,
          h('p', { class: 'small', text: m.description }),
          h('div', { class: 'small muted', text: `入手：${m.sourceHint}` }))));
      }
      case 'skills': {
        return h('div', { class: 'grid2' }, ...[...d.skills.values()].map((sk) => {
          const unlocked = gs.skillUnlocked(sk.id);
          const eff = gs.effectiveSkillLevel(sk.id);
          const owned = gs.ownedSkillLevel(sk.id);
          const lv = sk.levels.find((l) => l.level === Math.max(1, eff)) ?? sk.levels[0];
          return h('div', { class: 'card' },
            h('div', { class: 'row spread' }, h('h4', { text: `[${sk.key}] ${sk.nameJa}` }),
              unlocked ? h('span', { class: eff < owned ? 'bad' : 'stars', text: `Lv ${eff}${eff < owned ? `（強化済 Lv${owned}・調子が落ちている）` : ''}` }) : h('span', { class: 'muted', text: '未習得' })),
            h('p', { class: 'small', text: unlocked ? sk.description : '？？？' }),
            unlocked ? h('div', { class: 'small' }, h('span', { class: 'tag', text: lv.label }), ` ${lv.description}`) : null,
            unlocked && sk.levels.length > 1 ? h('div', { class: 'small muted', style: { marginTop: '6px' }, text: '工房のボルグに素材を渡すと強化できる。実戦で使いこなすほど、強化の上限が上がる。' }) : null);
        }));
      }
      case 'quests': {
        const list = [...d.quests.values()].filter((q) => gs.quest(q.id).state !== 'inactive');
        if (!list.length) return h('p', { class: 'muted', text: '受けているクエストはない。町の人に話しかけてみよう。' });
        return h('div', { class: 'grid2' }, ...list.map((q) => {
          const qp = gs.quest(q.id);
          const step = q.steps[qp.step];
          return h('div', { class: 'card' },
            h('div', { class: 'row spread' }, h('h4', { text: q.title }), h('span', { class: 'tag', text: q.type === 'repeatable' ? '周回' : qp.state === 'completed' ? '完了' : 'ストーリー' })),
            h('p', { class: 'small', text: q.summary }),
            q.type === 'repeatable'
              ? h('div', { class: 'small' }, `クリア ${qp.clears}回　最速 ${qp.bestTimeMs ? fmtTime(qp.bestTimeMs) : '—'}　前回 ${qp.lastTimeMs ? fmtTime(qp.lastTimeMs) : '—'}`, h('div', { class: 'muted', text: '門番ガルドか依頼掲示板から出発できる。' }))
              : qp.state === 'active' && step ? h('div', { class: 'small', text: `▶ ${step.description.replace('{partner}', ctx.partnerName)}` }) : null);
        }));
      }
      case 'book': {
        const entries = [...d.knowledge.values()].filter((k) => getProgress(s, k.knowledgeId).experienceCount + getProgress(s, k.knowledgeId).applicationCount > 0);
        if (!entries.length) return h('p', { class: 'muted', text: 'まだ何も記録されていない。' });
        return h('div', null, ...entries.map((k) => {
          const p = getProgress(s, k.knowledgeId);
          const named = s.flags['lb-named'];
          const variants = k.variants.filter((v) => p.experiencedVariants.includes(v.id) || p.appliedVariants.includes(v.id)).map((v) => v.label);
          return h('div', { class: 'card' },
            h('div', { class: 'row spread' },
              h('h4', { text: named ? `${k.nameJa}（${k.nameEn}）` : '？？？' }),
              h('span', { class: 'stars', text: '★'.repeat(p.mastery) + '☆'.repeat(5 - p.mastery) })),
            h('div', { class: 'small muted', text: MASTERY_LABELS[p.mastery] }),
            h('p', { text: k.experienceDescription }),
            variants.length ? h('div', { class: 'small', text: `出会った場面：${variants.join(' / ')}` }) : null,
            p.formalTermLearned
              ? h('div', { style: { marginTop: '8px' } },
                h('div', { class: 'small', text: k.formalDescription }),
                h('table', { class: 'stat-table small', style: { marginTop: '6px' } }, ...k.formalTerms.map((t) => h('tr', null, h('td', { text: t.term }), h('td', { style: { textAlign: 'left' }, text: t.description })))))
              : h('div', { class: 'small muted', style: { marginTop: '6px' }, text: '（古代の記録はまだ読み解けていない）' }));
        }));
      }
      case 'chars': {
        return h('div', { class: 'grid2' },
          h('div', { class: 'card' }, h('h4', { text: '現在の見た目' }),
            h('div', { text: `主人公：${ctx.appearance.hero}` }), h('div', { text: `パートナー：${ctx.appearance.partner}` })),
          h('div', { class: 'card' }, h('h4', { text: 'キャラクター登録' }),
            h('p', { class: 'small', text: 'Tripo等で作ったGLBキャラクターを登録して、主人公・パートナー・NPCとして使えます。' }),
            h('button', { class: 'btn btn-primary', text: 'キャラクター登録を開く', onclick: ctx.openRegistry })));
      }
      case 'system': {
        const info = h('div', { class: 'small muted', text: '…' });
        void ctx.storageInfo().then((t) => (info.textContent = t));
        const msg = h('div', { class: 'small' });
        return h('div', { class: 'grid2' },
          h('div', { class: 'card' }, h('h4', { text: 'セーブ' }),
            h('p', { class: 'small', text: 'クエスト完了・クラフト・戦闘後などに自動でセーブされます。' }),
            h('button', { class: 'btn', text: '今すぐセーブ', onclick: async () => { msg.textContent = (await ctx.saveNow()) ? 'セーブしました。' : 'セーブに失敗しました。'; } }), msg, info),
          h('div', { class: 'card' }, h('h4', { text: 'データ初期化' }),
            h('p', { class: 'small', text: '冒険の進行をすべて最初からやり直します（登録キャラクターは残ります）。' }),
            h('button', { class: 'btn btn-danger', text: '冒険を最初から', onclick: async () => { if (confirm('本当に冒険を最初からやり直しますか？')) await ctx.resetData(); } })));
      }
    }
  }
}
