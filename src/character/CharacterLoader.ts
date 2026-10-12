// Blob → AssetContainer。必要になったキャラだけを読み込み、シーンごとにキャッシュする。
import '@babylonjs/loaders/glTF/2.0';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Scene } from '@babylonjs/core/scene';
import { CharacterRepository } from './CharacterRepository';

export async function loadContainerFromBlob(blob: Blob, scene: Scene): Promise<AssetContainer> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return LoadAssetContainerAsync(buf, scene, { pluginExtension: '.glb' });
}

export class CharacterLoader {
  private cache = new Map<string, Promise<AssetContainer | null>>();

  constructor(private scene: Scene) {}

  /** 失敗時は null（呼び出し側はプレースホルダーで代替する） */
  load(assetId: string): Promise<AssetContainer | null> {
    let p = this.cache.get(assetId);
    if (!p) {
      p = (async () => {
        try {
          const blob = await CharacterRepository.getModelBlob(assetId);
          if (!blob) return null;
          return await loadContainerFromBlob(blob, this.scene);
        } catch (e) {
          console.error('GLBの読み込みに失敗', e);
          return null;
        }
      })();
      this.cache.set(assetId, p);
    }
    return p;
  }

  invalidate(assetId: string) {
    const p = this.cache.get(assetId);
    this.cache.delete(assetId);
    void p?.then((c) => c?.dispose());
  }
}
