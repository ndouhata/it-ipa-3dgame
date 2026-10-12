// 拠点メニュー。移動はなく、ここからクエストを選んで出撃する。
import type { GameState } from '../game/GameState';
import { h, clear, fmtTime } from './dom';

export interface HubActions {
  start: (questId: string) => void;
  craft: () => void;
  menu: () => void;
  characters: () => void;
  importQuestions: () => void;
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
    const quests = h('div', { class: 'hub-quests' });
    let lastGroup = '';
    for (const q of gs.data.questList) {
      if (q.group !== lastGroup) {
        lastGroup = q.group;
        quests.append(h('div', { class: 'hub-group', text: q.group }));
      }
      const unlocked = gs.isUnlocked(q.id);
      const qp = gs.quest(q.id);
      const stars = q.knowledgeIds.map((k) => {
        const kd = gs.data.knowledge.get(k)!;
        const m = gs.mastery(k);
        return h('span', { class: 'hub-know', title: kd.formalDescription }, kd.nameJa, h('span', { class: 'stars', text: '★'.repeat(m.level) + '☆'.repeat(5 - m.level) }));
      });
      const prev = q.unlockAfter ? gs.data.quests.get(q.unlockAfter)?.title : '';
      quests.append(h('div', { class: `panel hub-quest${unlocked ? '' : ' locked'}` },
        h('div', { class: 'row spread' }, h('h3', { text: q.title }), h('span', { class: 'tag', text: `敵Lv ${gs.enemyLevelFor(q.id)}${gs.enemyLevelFor(q.id) < q.recommendedLevel ? `（最大${q.recommendedLevel}）` : ''}` })),
        h('p', { class: 'small', text: unlocked ? q.summary : `「${prev}」をクリアすると解放` }),
        h('div', { class: 'small muted', text: `出題分野：${q.knowledgeIds.map((k) => gs.data.knowledge.get(k)!.nameJa).join('・')}` }),
        h('div', { class: 'hub-knows' }, ...stars),
        h('div', { class: 'row spread' },
          h('span', { class: 'small muted', text: qp.clears ? `クリア ${qp.clears}回　最速 ${fmtTime(qp.bestTimeMs ?? 0)}　最高正答率 ${Math.round((qp.bestAccuracy ?? 0) * 100)}%` : '未クリア' }),
          h('button', { class: 'btn btn-primary', text: '出撃', disabled: !unlocked, onclick: () => act.start(q.id) }))));
    }
    const side = h('div', { class: 'hub-side' },
      h('button', { class: 'btn hub-btn', text: '⚒ 工房（装備の作成・強化）', onclick: act.craft }),
      h('button', { class: 'btn hub-btn', text: '📜 ステータス・装備・図鑑', onclick: act.menu }),
      h('button', { class: 'btn hub-btn', text: '🧍 キャラクター登録', onclick: act.characters }),
      h('button', { class: 'btn hub-btn', text: '📥 自分の問題を取り込む', onclick: act.importQuestions }));
    this.root.append(h('div', { class: 'hub-title', text: 'クエストを選んで出撃' }), h('div', { class: 'hub-body' }, quests, side));
  }

  hide() { this.root.style.display = 'none'; }
}
