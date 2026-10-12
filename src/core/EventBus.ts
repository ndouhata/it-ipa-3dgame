// 型付きイベント。ゲーム各システムはここを介して疎結合に連携する。
import type { KnowledgeEvent } from '../save/SaveData';

export interface GameEvents {
  /** クエスト進行用の汎用イベント（talk / gimmickSolved / enemyDefeated など） */
  progress: { event: string; id: string };
  flagChanged: { flag: string };
  knowledge: Omit<KnowledgeEvent, 'at'>;
  masteryChanged: { knowledgeId: string; from: number; to: number };
  levelUp: { from: number; to: number; diff: Record<string, [number, number]> };
  itemGained: { itemId: string; count: number; rare: boolean };
  questChanged: { questId: string };
  skillUnlocked: { skillId: string };
  hint: { trigger: string };
  stateChanged: void;
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, h: Handler<GameEvents[K]>) {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(h as Handler<never>);
    return () => set!.delete(h as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) {
      try {
        (h as Handler<GameEvents[K]>)(payload);
      } catch (e) {
        console.error(`event handler error (${String(type)})`, e);
      }
    }
  }
}
