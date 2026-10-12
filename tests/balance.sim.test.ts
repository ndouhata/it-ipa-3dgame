// バランス確認用シミュレーション：周回1回分の戦闘を、育成段階ごとに比較する。
import { it } from 'vitest';
import { loadGameData } from '../src/data/registry';
import { BattleSystem, type AllyInit } from '../src/battle/BattleSystem';
import { createNewSave } from '../src/save/SaveData';
import { GameState } from '../src/game/GameState';
import { EventBus } from '../src/core/EventBus';

const data = loadGameData();

function simulateRun(level: number, gear: { sword?: number; charm?: number }, skillLv: number, smart: boolean) {
  const save = createNewSave([0, 0]);
  save.player.level = level;
  const gs = new GameState(save, data, new EventBus());
  if (gear.sword !== undefined) { save.ownedEquipment.push({ uid: 's', equipId: 'lb-sword', enhance: gear.sword }); save.equipment.weapon = 's'; }
  if (gear.charm !== undefined) { save.ownedEquipment.push({ uid: 'c', equipId: 'relay-charm', enhance: gear.charm }); save.equipment.accessory = 'c'; }
  const hs = gs.heroStats(), ps = gs.partnerStats();
  let heroHp = hs.hp, partnerHp = ps.hp, total = 0;
  const log: string[] = [];
  for (const group of ['wave-1', 'wave-2', 'boss']) {
    const allies: AllyInit[] = [
      { id: 'hero', kind: 'hero', name: 'H', maxHp: hs.hp, hp: heroHp, atk: hs.atk, def: hs.def, attackInterval: 1.0 },
      { id: 'partner', kind: 'partner', name: 'P', maxHp: ps.hp, hp: partnerHp, atk: ps.atk, def: ps.def, attackInterval: 1.25 },
    ];
    const nodes = gs.distributionNodes();
    for (let i = 0; i < nodes.count; i++) allies.push({ id: `node-${i}`, kind: 'node', name: 'N', maxHp: nodes.hp, hp: nodes.hp, atk: 0, def: nodes.def, attackInterval: 99 });
    const sys = new BattleSystem({
      allies,
      enemies: data.encounters[group].map((id, i) => ({ id: `e${i}`, def: data.enemies.get(id)! })),
      skills: [...data.skills.values()].map((def) => ({ def, level: def.id === 'distribution-array' ? skillLv : 1 })),
      damage: data.progression.damage,
    });
    while (!sys.ended && sys.time < 300) {
      sys.useSkill('power-strike');
      if (smart) {
        const charging = sys.enemies().find((e) => e.charging && e.charging.remaining < e.charging.total - 0.8);
        if (charging?.charging?.behavior.action === 'focusBlast') { if (!sys.useSkill('distribution-array')) sys.useSkill('guard'); }
      }
      sys.tick(0.1);
      sys.drainEvents();
    }
    heroHp = sys.hero().hp; partnerHp = sys.partner()!.hp;
    total += sys.time;
    log.push(`${group}: ${sys.time.toFixed(0)}s ${sys.ended} heroHP ${heroHp}/${hs.hp} partnerHP ${partnerHp}/${ps.hp}`);
    if (sys.ended !== 'victory') break;
    heroHp = Math.min(hs.hp, heroHp + Math.round(hs.hp * 0.35));
    partnerHp = Math.min(ps.hp, partnerHp + Math.round(ps.hp * 0.35));
  }
  return `Lv${level} ${JSON.stringify(gear)} 分散Lv${skillLv} ${smart ? '判断あり' : '判断なし'} 戦闘計${total.toFixed(0)}s\n  ${log.join('\n  ')}`;
}

function winRate(level: number, gear: { sword?: number; charm?: number }, skillLv: number, smart: boolean, n = 100) {
  let wins = 0, time = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateRun(level, gear, skillLv, smart);
    if (r.includes('boss') && r.split('boss:')[1].includes('victory')) { wins++; time += Number(/戦闘計(\d+)s/.exec(r)![1]); }
  }
  return `Lv${level} ${JSON.stringify(gear)} 分散Lv${skillLv} ${smart ? '判断あり' : '判断なし'}: 勝率${wins}% 平均戦闘${wins ? (time / wins).toFixed(0) : '-'}s`;
}

it('勝率', () => {
  console.log([
    winRate(2, {}, 0, false), winRate(2, {}, 1, false), winRate(2, {}, 1, true),
    winRate(3, {}, 1, false), winRate(3, {}, 1, true),
    winRate(3, { sword: 0 }, 1, false), winRate(3, { sword: 0 }, 1, true),
    winRate(4, { sword: 1, charm: 0 }, 2, false), winRate(4, { sword: 1, charm: 0 }, 2, true),
    winRate(6, { sword: 3, charm: 1 }, 3, true),
  ].join(String.fromCharCode(10)));
});

it.skip('周回バランス', () => {
  const cases = [
    simulateRun(1, {}, 0, false),
    simulateRun(1, {}, 1, true),
    simulateRun(1, {}, 1, false),
    simulateRun(2, {}, 1, true),
    simulateRun(2, {}, 1, false),
    simulateRun(2, {}, 0, false),
    simulateRun(3, { sword: 0 }, 1, true),
    simulateRun(4, { sword: 1, charm: 0 }, 2, true),
    simulateRun(6, { sword: 3, charm: 1 }, 3, true),
  ];
  console.log(cases.join('\n'));
});
