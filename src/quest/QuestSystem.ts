// データ駆動のクエスト進行。ステップは「イベント」または「条件」で完了する。
import type { Action, QuestDefinition } from '../data/schema';
import type { GameState } from '../game/GameState';

export class QuestSystem {
  constructor(private gs: GameState, private runActions: (a: Action[] | undefined) => void) {}

  start(id: string) {
    const def = this.gs.data.quests.get(id);
    const qp = this.gs.quest(id);
    if (!def || qp.state !== 'inactive') return;
    qp.state = 'active';
    qp.step = 0;
    this.gs.bus.emit('questChanged', { questId: id });
    if (def.steps[0]) this.runActions(def.steps[0].onEnter);
    this.checkConditions();
  }

  onProgress(event: string, id: string) {
    for (const def of this.activeStory()) {
      const step = def.steps[this.gs.quest(def.id).step];
      if (step?.completeOn && step.completeOn.event === event && step.completeOn.id === id) this.advance(def);
    }
    this.checkConditions();
  }

  checkConditions() {
    for (let guard = 0; guard < 10; guard++) {
      let advanced = false;
      for (const def of this.activeStory()) {
        const step = def.steps[this.gs.quest(def.id).step];
        if (step?.completeWhen && this.gs.check(step.completeWhen)) { this.advance(def); advanced = true; }
      }
      if (!advanced) break;
    }
  }

  private activeStory(): QuestDefinition[] {
    return [...this.gs.data.quests.values()].filter((q) => q.type === 'story' && this.gs.quest(q.id).state === 'active');
  }

  private advance(def: QuestDefinition) {
    const qp = this.gs.quest(def.id);
    qp.step++;
    if (qp.step >= def.steps.length) {
      qp.state = 'completed';
      this.gs.bus.emit('questChanged', { questId: def.id });
      this.runActions(def.onComplete);
      return;
    }
    this.gs.bus.emit('questChanged', { questId: def.id });
    this.runActions(def.steps[qp.step].onEnter);
  }

  /** HUDに出す現在の目的 */
  objective(): { title: string; step: string; marker: [number, number] | null } | null {
    const story = this.activeStory()[0];
    if (story) {
      const step = story.steps[this.gs.quest(story.id).step];
      if (step) return { title: story.title, step: step.description, marker: step.marker ?? null };
    }
    const rep = [...this.gs.data.quests.values()].find((q) => q.type === 'repeatable' && this.gs.quest(q.id).state === 'active');
    if (rep) return { title: rep.title, step: '門番ガルドに話して出発する（何度でも挑戦できる）', marker: null };
    return null;
  }
}
