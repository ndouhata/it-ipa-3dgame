// シーン上のキャラクター1体。Controllerはこのクラスだけを触り、GLBの中身には依存しない。
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { AnimationController } from './AnimationController';
import { DEFAULT_LOCOMOTION, type CharacterDefinition, type LogicalAnim } from './CharacterDefinition';

export interface InstanceOptions {
  /** GLB未登録・ロード失敗時のプレースホルダー色 */
  placeholderColor: Color3;
  name: string;
}

export class CharacterInstance {
  readonly root: TransformNode;
  private offset: TransformNode;
  anim: AnimationController | null = null;
  private locomotion = { ...DEFAULT_LOCOMOTION };
  private placeholderBody: TransformNode | null = null;
  private bobTime = 0;
  private lastSpeed = 0;
  private rootMotionObserver: Observer<Scene> | null = null;
  private lunge = 0;
  /** 表示上の高さ（頭上UIの位置合わせ用） */
  height = 1.7;

  private constructor(private scene: Scene, name: string) {
    this.root = new TransformNode(`${name}-root`, scene);
    this.offset = new TransformNode(`${name}-offset`, scene);
    this.offset.parent = this.root;
  }

  /** GLB（AssetContainer）からインスタンス化。containerがnullならプレースホルダー */
  static create(scene: Scene, def: CharacterDefinition | null, container: AssetContainer | null, opts: InstanceOptions): CharacterInstance {
    const inst = new CharacterInstance(scene, opts.name);
    if (def && container) {
      try {
        inst.attachModel(def, container);
        return inst;
      } catch (e) {
        console.error('キャラクターの生成に失敗。プレースホルダーで代替します', e);
      }
    }
    inst.buildPlaceholder(opts.placeholderColor);
    return inst;
  }

  private attachModel(def: CharacterDefinition, container: AssetContainer) {
    const entries = container.instantiateModelsToScene((n) => `${def.id}:${n}`, false, { doNotInstantiate: true });
    for (const n of entries.rootNodes) n.parent = this.offset;
    this.applyTransform(def);
    this.locomotion = { ...def.locomotion };
    this.anim = new AnimationController(entries.animationGroups, def.animationMap);
    if (def.stripRootMotion && entries.skeletons[0]) {
      const rootBone = entries.skeletons[0].bones.find((b) => !b.getParent());
      const node = rootBone?.getTransformNode();
      if (node) {
        const x0 = node.position.x, z0 = node.position.z;
        this.rootMotionObserver = this.scene.onAfterAnimationsObservable.add(() => {
          node.position.x = x0;
          node.position.z = z0;
        });
      }
    }
    this.height = Math.max(0.5, def.stats.height * def.transform.scale);
    this.anim.setState('idle');
  }

  applyTransform(def: Pick<CharacterDefinition, 'transform'>) {
    const t = def.transform;
    this.offset.scaling.setAll(t.scale);
    this.offset.rotation.y = t.rotationY;
    this.offset.position.y = t.yOffset;
  }

  private buildPlaceholder(color: Color3) {
    const body = new TransformNode('placeholder', this.scene);
    body.parent = this.offset;
    const mat = new StandardMaterial('ph-mat', this.scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    const skin = new StandardMaterial('ph-skin', this.scene);
    skin.diffuseColor = new Color3(0.98, 0.84, 0.7);
    skin.specularColor = Color3.Black();
    const torso = MeshBuilder.CreateCapsule('ph-torso', { height: 1.15, radius: 0.28 }, this.scene);
    torso.position.y = 0.62;
    torso.material = mat;
    torso.parent = body;
    const head = MeshBuilder.CreateSphere('ph-head', { diameter: 0.46, segments: 12 }, this.scene);
    head.position.y = 1.42;
    head.material = skin;
    head.parent = body;
    const nose = MeshBuilder.CreateBox('ph-nose', { size: 0.09 }, this.scene);
    nose.position.set(0, 1.42, 0.23);
    nose.material = mat;
    nose.parent = body;
    this.placeholderBody = body;
    this.height = 1.7;
  }

  get isPlaceholder() { return this.placeholderBody !== null; }

  /** 移動速度(m/s)からIdle/Walk/Runを選ぶ */
  setLocomotion(speed: number) {
    this.lastSpeed = speed;
    if (!this.anim) return;
    const { walkSpeed, runSpeed, animSpeedScale } = this.locomotion;
    let state: LogicalAnim = 'idle';
    let ratio = 1;
    if (speed > 0.15) {
      if (speed < (walkSpeed + runSpeed) / 2) {
        state = 'walk';
        ratio = (speed / walkSpeed) * animSpeedScale;
      } else {
        state = 'run';
        ratio = (speed / runSpeed) * animSpeedScale;
      }
    }
    this.anim.setState(state, Math.max(0.3, Math.min(2.5, ratio)));
  }

  /** 攻撃などの一回再生。アニメが無ければ前へ踏み込む動きで代用 */
  playAction(state: LogicalAnim) {
    if (!this.anim?.playOnce(state)) this.lunge = 0.25;
  }

  setPosition(x: number, z: number, y = 0) { this.root.position.set(x, y, z); }
  get position(): Vector3 { return this.root.position; }

  /** 向きを滑らかに目標角度へ */
  faceTowards(angle: number, dt: number, speed = 12) {
    let d = angle - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * speed);
  }
  setFacing(angle: number) { this.root.rotation.y = angle; }
  get facing() { return this.root.rotation.y; }

  update(dt: number) {
    this.anim?.update(dt);
    if (this.placeholderBody) {
      // 簡易な歩行の上下動
      this.bobTime += dt * (2 + this.lastSpeed * 2.2);
      const amp = Math.min(0.08, this.lastSpeed * 0.015);
      this.placeholderBody.position.y = Math.abs(Math.sin(this.bobTime)) * amp;
      this.placeholderBody.rotation.x = Math.min(0.25, this.lastSpeed * 0.03);
    }
    if (this.lunge > 0) {
      this.lunge = Math.max(0, this.lunge - dt);
      const p = this.lunge / 0.25;
      this.offset.position.z = Math.sin(p * Math.PI) * 0.45;
    }
  }

  setVisible(v: boolean) { this.root.setEnabled(v); }

  dispose() {
    if (this.rootMotionObserver) this.scene.onAfterAnimationsObservable.remove(this.rootMotionObserver);
    this.anim?.dispose();
    this.root.dispose(false, true);
  }
}
