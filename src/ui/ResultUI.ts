// 周回クエストのリザルト。「前より速くなった」「あと何個」を見せて、もう一周したくさせる。
import type { Drop } from '../inventory/Drops';
import type { GameState } from '../game/GameState';
import { h, panel, fmtTime } from './dom';

export interface RunResult {
  questTitle: string;
  success: boolean;
  timeMs: number;
  prevMs: number | null;
  bestMs: number | null;
  newBest: boolean;
  exp: number;
  levelBefore: number;
  levelAfter: number;
  drops: Drop[];
  bonuses: string[];
  damageTaken: number;
}

export class ResultUI {
  private root: HTMLElement | null = null;
  constructor(private parent: HTMLElement) {}
  get isOpen() { return this.root !== null; }

  open(gs: GameState, r: RunResult, onAgain: () => void, onTown: () => void) {
    this.close();
    const diff = r.prevMs !== null ? r.timeMs - r.prevMs : null;
    const goals = this.goalLines(gs);
    const again = h('button', { class: 'btn btn-primary', text: 'もう一度挑む', onclick: () => { this.close(); onAgain(); } });
    const town = h('button', { class: 'btn', text: '町へ戻る', onclick: () => { this.close(); onTown(); } });
    this.root = panel(r.success ? `${r.questTitle}　クリア！` : `${r.questTitle}　撤退…`, null,
      h('div', { class: 'grid2' },
        h('div', { class: 'card' },
          h('div', { class: 'muted small', text: 'クリアタイム' }),
          h('div', { class: 'result-time', text: fmtTime(r.timeMs) }),
          diff !== null && r.success ? h('div', { class: `result-diff${diff < 0 ? ' faster' : ''}`, text: diff < 0 ? `前回より ${fmtTime(-diff)} 短縮！` : `前回 ${fmtTime(r.prevMs!)}` }) : null,
          r.newBest ? h('div', { class: 'tag rare', text: '自己ベスト更新！' }) : r.bestMs ? h('div', { class: 'small muted', text: `自己ベスト ${fmtTime(r.bestMs)}` }) : null,
          h('div', { class: 'small', style: { marginTop: '8px' }, text: `受けたダメージ：${r.damageTaken}` }),
          h('div', { style: { marginTop: '8px' } }, h('b', { text: `EXP +${r.exp}` }),
            r.levelAfter > r.levelBefore ? h('span', { class: 'good', text: `　Lv ${r.levelBefore} → ${r.levelAfter}！` }) : null),
          ...r.bonuses.map((b) => h('div', { class: 'small good', text: `★ ${b}` }))),
        h('div', { class: 'card' },
          h('h4', { text: '獲得した素材' }),
          r.drops.length ? h('div', { class: 'result-drops' }, ...r.drops.map((d) => h('div', { class: `drop${d.rare ? ' rare' : ''}`, text: `${gs.itemName(d.itemId)} ×${d.count}${d.rare ? '  レア！' : ''}` })))
            : h('div', { class: 'muted small', text: 'なし' }),
          goals.length ? h('div', { style: { marginTop: '10px' } }, h('h4', { text: '次の目標' }), ...goals.map((g) => h('div', { class: 'goal-line', text: g }))) : null)),
      h('div', { class: 'row', style: { marginTop: '12px', justifyContent: 'flex-end' } }, town, again));
    this.parent.append(this.root);
    const key = (e: KeyboardEvent) => { if (e.code === 'Enter') { window.removeEventListener('keydown', key); again.click(); } };
    window.addEventListener('keydown', key);
    this.cleanup = () => window.removeEventListener('keydown', key);
  }

  private cleanup: () => void = () => {};

  /** 作れそうな装備・強化までの不足素材 */
  private goalLines(gs: GameState): string[] {
    const lines: string[] = [];
    for (const def of gs.data.equipment.values()) {
      const owned = gs.ownedOf(def.id);
      const cost = owned ? gs.enhanceCost(owned.uid) : def.recipe;
      if (!cost) continue;
      const missing = cost.filter((c) => gs.count(c.itemId) < c.count);
      const label = owned ? `${def.name} +${owned.enhance + 1}` : def.name;
      lines.push(missing.length === 0 ? `✔ ${label} を工房で作れる！` : `${label}まで：${missing.map((c) => `${gs.itemName(c.itemId)} あと${c.count - gs.count(c.itemId)}`).join('、')}`);
    }
    return lines.slice(0, 3);
  }

  close() {
    this.cleanup();
    this.root?.remove();
    this.root = null;
  }
}
