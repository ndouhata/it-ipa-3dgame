// IndexedDB。GLB等の大容量BlobもここへID付きで保存する（localStorageは使わない）。
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CharacterDefinition } from '../character/CharacterDefinition';
import type { SaveData } from './SaveData';

interface ItRpgDB extends DBSchema {
  saves: { key: string; value: SaveData };
  characters: { key: string; value: CharacterDefinition };
  assets: { key: string; value: { id: string; blob: Blob; fileName: string; size: number; createdAt: string } };
  meta: { key: string; value: unknown };
}

const DB_NAME = 'itrpg';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ItRpgDB>> | null = null;

export function getDB() {
  dbPromise ??= openDB<ItRpgDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('saves');
        db.createObjectStore('characters', { keyPath: 'id' });
        db.createObjectStore('assets', { keyPath: 'id' });
        db.createObjectStore('meta');
      }
    },
  });
  return dbPromise;
}

/** 保存失敗の原因をユーザー向けの文に変換する */
export function describeStorageError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') return '端末の保存容量が不足しています。不要なキャラクターを削除してください。';
  if (name === 'InvalidStateError') return 'データベースを開けませんでした（プライベートブラウズ等では保存できない場合があります）。';
  return `保存に失敗しました（${name ?? 'Unknown'}）。`;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.quota == null) return null;
    return { usage: e.usage ?? 0, quota: e.quota };
  } catch {
    return null;
  }
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* 永続化できなくても動作は継続 */
  }
}
