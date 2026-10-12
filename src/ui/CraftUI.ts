// 工房：装備の作成・強化、スキル強化。「あと何個」「どこで手に入るか」を出して、次の周回の目標にする。
import type { GameState, Cost } from '../game/GameState';
import { h, panel, clear } from './dom';

export class CraftUI {
  private root: HTMLElement | null = null;

  constructor(private parent: HTMLElement) {}
  get isOpen() { return this.root !== null; }

  open(gs: GameState, onClose: () => void, onChanged: (msg: string) => void) {
    this.close();
    const body = h('div');
    const costView = (cost: Cost) => h('div', { class: 'cost' }, ...cost.map((c) => {
      const have = gs.count(c.itemId);
      const ok = have >= c.count;
      return h('span', { class: ok ? 'ok' : 'ng', text: `${gs.itemName(c.itemId)} ${have}/${c.count}${ok ? '' : `（あと${c.count - have}）`}` });
    }));
    const where = (cost: Cost) => {
      const missing = cost.filter((c) => gs.count(c.itemId) < c.count).map((c) => gs.data.materials.get(c.itemId)?.sourceHint).filter(Boolean);
      return missing.length ? h('div', { class: 'small muted', text: `入手：${[...new Set(missing)].join(' / ')}` }) : null;
    };

    const render = () => {
      clear(body);
      // 装備
      const eqCards = [...gs.data.equipment.values()].map((def) => {
        const owned = gs.ownedOf(def.id);
        const stats = (lv: number) => Object.entries(def.baseStats).map(([k, v]) => `${gs.data.progression.statLabels[k] ?? k}+${v + (def.perEnhance[k] ?? 0) * lv}`).join(' ');
        if (!owned) {
          return h('div', { class: 'card' },
            h('h4', { text: `${def.icon} ${def.name}（未作成）` }),
            h('p', { class: 'small', text: def.description }),
            h('div', { class: 'small', text: `性能：${stats(0)}${def.grants?.distributionNodes ? '　／　戦闘で分散ノードを1基呼び出す' : ''}` }),
            costView(def.recipe), where(def.recipe),
            h('button', { class: 'btn btn-primary', text: '作成する', disabled: !gs.canAfford(def.recipe), onclick: () => {
              if (gs.craft(def.id)) { onChanged(`${def.name}を作成して装備した！`); render(); }
            } }));
        }
        const cost = gs.enhanceCost(owned.uid);
        return h('div', { class: 'card' },
          h('h4', { text: `${def.icon} ${def.name} +${owned.enhance}` }),
          h('div', { class: 'small', text: `現在：${stats(owned.enhance)}` }),
          cost ? h('div', null,
            h('div', { class: 'small', text: `強化後：${stats(owned.enhance + 1)}` }),
            costView(cost), where(cost),
            h('button', { class: 'btn btn-primary', text: `+${owned.enhance + 1} に強化`, disabled: !gs.canAfford(cost), onclick: () => {
              if (gs.enhance(owned.uid)) { onChanged(`${def.name}を +${owned.enhance} に強化した！`); render(); }
            } })) : h('div', { class: 'small good', text: '最大まで強化済み' }));
      });

      // スキル
      const skCards = [...gs.data.skills.values()].filter((s) => s.levels.length > 1 && gs.skillUnlocked(s.id)).map((sk) => {
        const up = gs.nextSkillUpgrade(sk.id);
        const owned = gs.ownedSkillLevel(sk.id);
        const cur = sk.levels.find((l) => l.level === owned)!;
        return h('div', { class: 'card' },
          h('h4', { text: `${sk.nameJa} Lv${owned}（${cur.label}）` }),
          h('div', { class: 'small', text: cur.description }),
          up ? h('div', { style: { marginTop: '6px' } },
            h('div', { class: 'small', text: `次：Lv${up.next.level}「${up.next.label}」— ${up.next.description}` }),
            costView(up.next.cost), where(up.next.cost),
            up.capped
              ? h('div', { class: 'small bad', text: 'ボルグ「まだお前さんの腕が追いついてねえな。実戦でこの技をもっと使いこなしてきな」' })
              : h('button', { class: 'btn btn-primary', text: '強化する', disabled: !gs.canAfford(up.next.cost), onclick: () => {
                if (gs.upgradeSkill(sk.id)) { onChanged(`${sk.nameJa}が Lv${gs.ownedSkillLevel(sk.id)} になった！`); render(); }
              } }))
            : h('div', { class: 'small good', text: '最大まで強化済み' }));
      });

      body.append(h('h3', { class: 'panel-title', style: { fontSize: '15px' }, text: '装備の作成・強化' }), h('div', { class: 'grid2' }, ...eqCards));
      if (skCards.length) body.append(h('h3', { class: 'panel-title', style: { fontSize: '15px', marginTop: '14px' }, text: '技の強化' }), h('div', { class: 'grid2' }, ...skCards));
    };
    this.root = panel('工房 ― 鍛冶屋ボルグ', () => { this.close(); onClose(); }, body);
    this.parent.append(this.root);
    render();
  }

  close() {
    this.root?.remove();
    this.root = null;
  }
}
