// 登録キャラクター定義とGLB本体（Blob）のIndexedDB入出力。
import { getDB, describeStorageError, storageEstimate, requestPersistentStorage } from '../save/db';
import type { CharacterDefinition } from './CharacterDefinition';

export class StorageError extends Error {}

export const CharacterRepository = {
  async list(): Promise<CharacterDefinition[]> {
    const db = await getDB();
    return (await db.getAll('characters')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async get(id: string): Promise<CharacterDefinition | undefined> {
    return (await getDB()).get('characters', id);
  },

  async getModelBlob(assetId: string): Promise<Blob | undefined> {
    return (await (await getDB()).get('assets', assetId))?.blob;
  },

  /** 定義とBlobを同一トランザクションで保存（片方だけ残らないように） */
  async save(def: CharacterDefinition, blob: Blob | null): Promise<void> {
    if (blob) {
      const est = await storageEstimate();
      if (est && est.quota - est.usage < blob.size * 1.2) {
        throw new StorageError(`保存容量が不足しています（空き約${((est.quota - est.usage) / 1048576).toFixed(1)}MB / 必要約${(blob.size / 1048576).toFixed(1)}MB）。`);
      }
    }
    try {
      const db = await getDB();
      const tx = db.transaction(['characters', 'assets'], 'readwrite');
      if (blob) {
        await tx.objectStore('assets').put({ id: def.modelAssetId, blob, fileName: def.fileName, size: blob.size, createdAt: new Date().toISOString() });
      }
      await tx.objectStore('characters').put(def);
      await tx.done;
      void requestPersistentStorage();
    } catch (e) {
      throw new StorageError(describeStorageError(e));
    }
  },

  async remove(def: CharacterDefinition): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(['characters', 'assets'], 'readwrite');
    await tx.objectStore('characters').delete(def.id);
    // 他の定義が同じアセットを使っていなければ削除
    const others = (await tx.objectStore('characters').getAll()).filter((c) => c.modelAssetId === def.modelAssetId);
    if (others.length === 0) await tx.objectStore('assets').delete(def.modelAssetId);
    await tx.done;
  },
};
