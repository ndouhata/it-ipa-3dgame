import { getDB, describeStorageError } from './db';
import { createNewSave, migrateSave, type SaveData } from './SaveData';

const SLOT = 'slot1';

export class SaveManager {
  lastError: string | null = null;

  constructor(private spawn: [number, number]) {}

  async load(): Promise<SaveData> {
    try {
      const db = await getDB();
      const raw = await db.get('saves', SLOT);
      return raw ? migrateSave(raw, this.spawn) : createNewSave(this.spawn);
    } catch (e) {
      console.error(e);
      this.lastError = describeStorageError(e);
      return createNewSave(this.spawn);
    }
  }

  async save(data: SaveData): Promise<boolean> {
    try {
      data.updatedAt = new Date().toISOString();
      const db = await getDB();
      // structuredClone で Proxy/参照を切り離して保存
      await db.put('saves', structuredClone(data), SLOT);
      this.lastError = null;
      return true;
    } catch (e) {
      console.error(e);
      this.lastError = describeStorageError(e);
      return false;
    }
  }

  async reset(): Promise<SaveData> {
    const fresh = createNewSave(this.spawn);
    await this.save(fresh);
    return fresh;
  }
}
