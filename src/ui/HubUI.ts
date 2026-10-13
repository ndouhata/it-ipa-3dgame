// 拠点メニュー。まず試験を選び、その試験のクエストを選んで出撃する。
import type { GameState } from '../game/GameState';
import type { CompletionInfo } from '../quiz/Mastery';
import { h, clear, fmtTime } from './dom';

export interface HubActions {
  start: (questId: string) => void;
  craft: () => void;
  menu: () => void;
  characters: () => void;
  importQuestions: () => void;
  /** 選んだ試験を覚えておく（null で試験選びに戻る） */
  selectGroup: (group: string | null) => void;
}

/** 問題数・正解したことがある数・習得数（コンプ率）の表示 */
function completionView(c: CompletionInfo) {
  const pct = (n: number) => (c.total ? Math.round((n / c.total) * 100) : 0);
  return h('div', { class: 'comp' },
    h('div', { class: 'comp-head' },
      h('span', { class: 'comp-rate', text: `コンプ率 ${pct(c.mastered)}%` }),
      h('span', { class: 'small muted', text: `全${c.total}問　習得 ${c.mastered}　正解したことがある ${c.everCorrect}　出会った ${c.seen}` })),
    h('div', { class: 'comp-bar' },
      h('div', { class: 'comp-seen', style: { width: `${pct(c.seen)}%` } }),
      h('div', { class: 'comp-correct', style: { width: `${pct(c.everCorrect)}%` } }),
      h('div', { class: 'comp-mastered', style: { width: `${pct(c.mastered)}%` } })));
}

export class HubUI {
  private root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'hub', style: { display: 'none' } });
    parent.append(this.root);
  }

  show(gs: GameState, act: HubActions) {
    clear(this.root);
    this.root.style.display = '';
    this.root.scrollTop = 0;
    const groups = gs.groups();
    const selected = gs.save.selectedGroup && groups.includes(gs.save.selectedGroup) ? gs.save.selectedGroup : null;
    const main = selected ? this.questList(gs, act, selected) : this.examList(gs, act, groups);
    const side = h('div', { class: 'hub-side' },
      h('button', { class: 'btn hub-btn', text: '⚒ 工房（装備の作成・強化）', onclick: act.craft }),
      h('button', { class: 'btn hub-btn', text: '📜 ステータス・装備・図鑑', onclick: act.menu }),
      h('button', { class: 'btn hub-btn', text: '🧍 キャラクター登録', onclick: act.characters }),
      h('button', { class: 'btn hub-btn', text: '📥 自分の問題を取り込む', onclick: act.importQuestions }));
    this.root.append(h('div', { class: 'hub-body' }, main, side));
  }

  /** 1段目：試験を選ぶ */
  private examList(gs: GameState, act: HubActions, groups: string[]) {
    const list = h('div', { class: 'hub-quests' }, h('div', { class: 'hub-title', text: '試験を選ぶ' }));
    for (const g of groups) {
      const quests = gs.data.questList.filter((q) => q.group === g);
      list.append(h('div', { class: 'panel hub-quest hub-exam clickable', onclick: () => act.selectGroup(g) },
        h('div', { class: 'row spread' }, h('h3', { text: g }), h('span', { class: 'tag', text: `クエスト ${quests.length}` })),
        completionView(gs.groupCompletion(g)),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn btn-primary', text: 'この試験で遊ぶ ▶' }))));
    }
    list.append(h('div', { class: 'small muted hub-note', text: 'コンプ率＝習得した問題 ÷ 全問題。「習得」は、出し直しが終わっていて、直近2回続けて正解した問題です。間違えると習得から外れます。' }));
    return list;
  }

  /** 2段目：選んだ試験のクエストを選ぶ */
  private questList(gs: GameState, act: HubActions, group: string) {
    const list = h('div', { class: 'hub-quests' },
      h('div', { class: 'row spread hub-title-row' },
        h('div', { class: 'hub-title', text: group }),
        h('button', { class: 'btn btn-small', text: '← 試験を選び直す', onclick: () => act.selectGroup(null) })),
      h('div', { class: 'panel hub-quest' }, h('div', { class: 'small muted', text: 'この試験の全体' }), completionView(gs.groupCompletion(group))));
    for (const q of gs.data.questList.filter((x) => x.group === group)) {
      const qp = gs.quest(q.id);
      const lv = gs.enemyLevelFor(q.id);
      const stars = q.knowledgeIds.map((k) => {
        const kd = gs.data.knowledge.get(k)!;
        const m = gs.mastery(k);
        return h('span', { class: 'hub-know', title: kd.formalDescription }, kd.nameJa, h('span', { class: 'stars', text: '★'.repeat(m.level) + '☆'.repeat(5 - m.level) }));
      });
      list.append(h('div', { class: 'panel hub-quest' },
        h('div', { class: 'row spread' }, h('h3', { text: q.title }), h('span', { class: 'tag', text: `敵Lv ${lv}${lv < q.recommendedLevel ? `（最大${q.recommendedLevel}）` : ''}` })),
        h('p', { class: 'small', text: q.summary }),
        completionView(gs.questCompletion(q.id)),
        h('div', { class: 'hub-knows' }, ...stars),
        h('div', { class: 'row spread' },
          h('span', { class: 'small muted', text: qp.clears ? `クリア ${qp.clears}回　最速 ${fmtTime(qp.bestTimeMs ?? 0)}　最高正答率 ${Math.round((qp.bestAccuracy ?? 0) * 100)}%` : '未クリア' }),
          h('button', { class: 'btn btn-primary', text: '出撃', onclick: () => act.start(q.id) }))));
    }
    return list;
  }

  hide() { this.root.style.display = 'none'; }
}
