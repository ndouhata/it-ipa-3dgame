// 三人称カメラ。マウスドラッグ/タッチで回転、ホイール/ピンチでズーム。
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

export class ThirdPersonCamera {
  readonly camera: ArcRotateCamera;
  private target = new Vector3();

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.15, 10, Vector3.Zero(), scene);
    this.camera.lowerRadiusLimit = 4;
    this.camera.upperRadiusLimit = 22;
    this.camera.lowerBetaLimit = 0.35;
    this.camera.upperBetaLimit = 1.45;
    this.camera.wheelDeltaPercentage = 0.01;
    this.camera.pinchDeltaPercentage = 0.01;
    this.camera.angularSensibilityX = 1500;
    this.camera.angularSensibilityY = 1500;
    this.camera.panningSensibility = 0;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 400;
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    this.camera.attachControl(canvas, true);
  }

  /** 毎フレーム、追従対象へ滑らかに寄せる */
  follow(pos: Vector3, dt: number, height = 1.3) {
    this.target.set(pos.x, pos.y + height, pos.z);
    Vector3.LerpToRef(this.camera.target, this.target, Math.min(1, dt * 8), this.camera.target);
  }

  snapTo(pos: Vector3, height = 1.3) {
    this.camera.target.set(pos.x, pos.y + height, pos.z);
  }

  /** カメラ基準の移動方向（ワールドXZ）。入力 x:右, y:前 */
  toWorld(x: number, y: number): [number, number] {
    const fwdX = -Math.cos(this.camera.alpha), fwdZ = -Math.sin(this.camera.alpha);
    // Babylonは左手系：右ベクトル = up × forward = (fwdZ, -fwdX)
    const rightX = fwdZ, rightZ = -fwdX;
    return [fwdX * y + rightX * x, fwdZ * y + rightZ * x];
  }
}
