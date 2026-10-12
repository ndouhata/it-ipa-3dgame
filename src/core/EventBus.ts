// 型付きイベント。ゲーム各システムはここを介して疎結合に連携する。
export interface GameEvents {
  levelUp: { from: number; to: number; diff: Record<string, [number, number]> };
  itemGained: { itemId: string; count: number; rare: boolean };
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
