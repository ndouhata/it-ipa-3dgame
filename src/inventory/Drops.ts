// ドロップ抽選。レア素材には「一定回数出なければ確定」の保証を付け、不快な周回を防ぐ。
import type { DropTables } from '../data/schema';

export interface Drop { itemId: string; count: number; rare: boolean; pity?: boolean }

export function rollDrops(
  tables: DropTables,
  tableId: string,
  pity: Record<string, number>,
  isRare: (itemId: string) => boolean,
  rand: () => number = Math.random,
): Drop[] {
  const t = tables[tableId];
  if (!t) return [];
  const out: Drop[] = [];
  for (const e of t.entries) {
    const guaranteed = t.pity?.itemId === e.itemId && (pity[tableId] ?? 0) + 1 >= t.pity.guaranteeAfter;
    if (guaranteed || rand() < e.chance) {
      const count = e.min + Math.floor(rand() * (e.max - e.min + 1));
      out.push({ itemId: e.itemId, count, rare: isRare(e.itemId), pity: guaranteed && t.pity?.itemId === e.itemId });
    }
  }
  if (t.pity) {
    const got = out.some((d) => d.itemId === t.pity!.itemId);
    pity[tableId] = got ? 0 : (pity[tableId] ?? 0) + 1;
  }
  return out;
}

export function mergeDrops(list: Drop[]): Drop[] {
  const map = new Map<string, Drop>();
  for (const d of list) {
    const m = map.get(d.itemId);
    if (m) m.count += d.count; else map.set(d.itemId, { ...d });
  }
  return [...map.values()];
}
