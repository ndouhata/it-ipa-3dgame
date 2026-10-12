// map.json から3Dフィールドを生成する。建物は仮形状（プリミティブ）。
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { MapData } from '../data/schema';

interface Box { minX: number; maxX: number; minZ: number; maxZ: number }
interface Circle { x: number; z: number; r: number }

export class World {
  private boxes: Box[] = [];
  private circles: Circle[] = [];
  private mats = new Map<string, StandardMaterial>();
  readonly shadows: ShadowGenerator;
  readonly bound: number;
  /** 群衆（宿屋Aの行列）。フラグで消す */
  crowd: TransformNode | null = null;
  readonly runMarkerRoot: TransformNode;
  private staticRoot: TransformNode;

  constructor(private scene: Scene, readonly map: MapData) {
    this.bound = map.groundSize / 2 - 4;
    scene.clearColor = new Color4(0.62, 0.78, 0.95, 1);
    scene.fogMode = 3; // LINEAR
    scene.fogStart = 70;
    scene.fogEnd = 190;
    scene.fogColor = new Color3(0.62, 0.78, 0.95);
    scene.ambientColor = new Color3(0.3, 0.3, 0.3);

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.35, 0.33, 0.3);
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.35), scene);
    sun.intensity = 0.85;
    sun.position = new Vector3(30, 60, -20);
    this.shadows = new ShadowGenerator(1024, sun);
    this.shadows.useBlurExponentialShadowMap = false;
    this.shadows.bias = 0.002;
    sun.autoUpdateExtends = true;

    this.staticRoot = new TransformNode('static', scene);
    this.runMarkerRoot = new TransformNode('run-markers', scene);
    this.build();
  }

  private mat(key: string, rgb: readonly number[], emissive = 0): StandardMaterial {
    const k = `${key}:${rgb.join(',')}:${emissive}`;
    let m = this.mats.get(k);
    if (!m) {
      m = new StandardMaterial(k, this.scene);
      m.diffuseColor = new Color3(rgb[0], rgb[1], rgb[2]);
      m.specularColor = new Color3(0.05, 0.05, 0.05);
      if (emissive) m.emissiveColor = new Color3(rgb[0] * emissive, rgb[1] * emissive, rgb[2] * emissive);
      this.mats.set(k, m);
    }
    return m;
  }

  private add(mesh: AbstractMesh, receive = true) {
    mesh.parent = this.staticRoot;
    mesh.receiveShadows = receive;
    mesh.isPickable = false;
    return mesh;
  }

  private build() {
    const s = this.scene;
    const m = this.map;
    const ground = MeshBuilder.CreateGround('ground', { width: m.groundSize, height: m.groundSize }, s);
    ground.material = this.mat('ground', [0.38, 0.56, 0.3]);
    this.add(ground);

    for (const a of m.areas) {
      const disc = MeshBuilder.CreateDisc(`area-${a.id}`, { radius: a.radius, tessellation: 48 }, s);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(a.center[0], 0.01, a.center[1]);
      disc.material = this.mat('area', a.color);
      this.add(disc);
    }

    for (const r of m.roads) {
      const dx = r.to[0] - r.from[0], dz = r.to[1] - r.from[1];
      const len = Math.hypot(dx, dz);
      const road = MeshBuilder.CreateBox('road', { width: r.width, height: 0.04, depth: len }, s);
      road.position.set((r.from[0] + r.to[0]) / 2, 0.02, (r.from[1] + r.to[1]) / 2);
      road.rotation.y = Math.atan2(dx, dz);
      road.material = this.mat('road', [0.66, 0.58, 0.44]);
      this.add(road);
    }

    for (const b of m.buildings) this.buildBuilding(b);
    for (const p of m.props) this.buildProp(p);
    this.buildCrowd();

    this.staticRoot.getChildMeshes().forEach((mm) => mm.freezeWorldMatrix());
    // マテリアルの凍結は初回描画（シェーダ準備）の後に行う
    this.scene.executeWhenReady(() => { for (const mm of this.mats.values()) mm.freeze(); });
  }

  private buildBuilding(b: MapData['buildings'][number]) {
    const s = this.scene;
    const [w, h, d] = b.size;
    const body = MeshBuilder.CreateBox(`bld-${b.id}`, { width: w, height: h, depth: d }, s);
    body.position.set(b.pos[0], h / 2, b.pos[1]);
    body.material = this.mat('wall', b.color);
    this.add(body);
    this.shadows.addShadowCaster(body);
    if (b.roof) {
      const roof = MeshBuilder.CreateCylinder(`roof-${b.id}`, { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 4 }, s);
      roof.scaling.set(w * 1.45, Math.min(w, d) * 0.45, d * 1.45);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(b.pos[0], h + Math.min(w, d) * 0.225, b.pos[1]);
      roof.material = this.mat('roof', b.roof);
      this.add(roof);
    }
    if (b.door) {
      const dir = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] }[b.door];
      const door = MeshBuilder.CreateBox(`door-${b.id}`, { width: dir[0] ? 0.2 : 1.6, height: 2.4, depth: dir[0] ? 1.6 : 0.2 }, s);
      door.position.set(b.pos[0] + (dir[0] * w) / 2, 1.2, b.pos[1] + (dir[1] * d) / 2);
      door.material = this.mat('door', [0.35, 0.22, 0.12]);
      this.add(door);
    }
    this.boxes.push({ minX: b.pos[0] - w / 2, maxX: b.pos[0] + w / 2, minZ: b.pos[1] - d / 2, maxZ: b.pos[1] + d / 2 });
  }

  private buildProp(p: MapData['props'][number]) {
    const s = this.scene;
    const sc = p.scale ?? 1;
    const node = new TransformNode(`prop-${p.type}`, s);
    node.parent = this.staticRoot;
    node.position.set(p.pos[0], 0, p.pos[1]);
    node.rotation.y = p.rotation ?? 0;
    node.scaling.setAll(sc);
    const part = (mesh: Mesh, mat: StandardMaterial, caster = true) => {
      mesh.parent = node;
      mesh.material = mat;
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      if (caster) this.shadows.addShadowCaster(mesh);
      return mesh;
    };
    let radius = 0;
    switch (p.type) {
      case 'tree': {
        const trunk = part(MeshBuilder.CreateCylinder('trunk', { height: 2.2, diameter: 0.45, tessellation: 8 }, s), this.mat('trunk', [0.42, 0.28, 0.16]));
        trunk.position.y = 1.1;
        const leaves = part(MeshBuilder.CreateCylinder('leaves', { height: 3.6, diameterTop: 0, diameterBottom: 3, tessellation: 8 }, s), this.mat('leaves', [0.2, 0.45, 0.22]));
        leaves.position.y = 3.6;
        radius = 0.6;
        break;
      }
      case 'rock': {
        const r = part(MeshBuilder.CreateIcoSphere('rock', { radius: 1, subdivisions: 1 }, s), this.mat('rock', [0.52, 0.5, 0.48]));
        r.scaling.set(1.2, 0.7, 1);
        r.position.y = 0.4;
        radius = 1.1;
        break;
      }
      case 'lamp': {
        const pole = part(MeshBuilder.CreateCylinder('pole', { height: 3, diameter: 0.12, tessellation: 6 }, s), this.mat('iron', [0.2, 0.2, 0.22]));
        pole.position.y = 1.5;
        const light = part(MeshBuilder.CreateSphere('lamp', { diameter: 0.4, segments: 6 }, s), this.mat('lamp', [1, 0.85, 0.5], 0.9), false);
        light.position.y = 3.1;
        break;
      }
      case 'fence': {
        const rail = part(MeshBuilder.CreateBox('fence', { width: 6, height: 0.9, depth: 0.15 }, s), this.mat('wood', [0.55, 0.4, 0.25]));
        rail.position.y = 0.45;
        break;
      }
      case 'crate': {
        const c = part(MeshBuilder.CreateBox('crate', { size: 1 }, s), this.mat('wood', [0.55, 0.4, 0.25]));
        c.position.y = 0.5;
        radius = 0.7;
        break;
      }
      case 'device': {
        const base = part(MeshBuilder.CreateCylinder('dev-base', { height: 1.1, diameter: 1.4, tessellation: 8 }, s), this.mat('stone', [0.55, 0.55, 0.6]));
        base.position.y = 0.55;
        const orb = part(MeshBuilder.CreateSphere('dev-orb', { diameter: 0.7, segments: 12 }, s), this.mat('orb', [0.3, 0.85, 1], 0.8), false);
        orb.position.y = 1.55;
        const ring = part(MeshBuilder.CreateTorus('dev-ring', { diameter: 1.2, thickness: 0.08, tessellation: 24 }, s), this.mat('gold', [0.9, 0.75, 0.3], 0.3), false);
        ring.position.y = 1.55;
        ring.rotation.x = Math.PI / 2.5;
        radius = 0.9;
        break;
      }
      case 'stone': {
        const st = part(MeshBuilder.CreateBox('stone', { width: 1.4, height: 2.6, depth: 0.5 }, s), this.mat('stone', [0.5, 0.52, 0.58]));
        st.position.y = 1.3;
        const rune = part(MeshBuilder.CreatePlane('rune', { width: 0.9, height: 1.4 }, s), this.mat('rune', [0.55, 0.75, 1], 0.6), false);
        rune.position.set(0, 1.4, -0.26);
        radius = 1.0;
        break;
      }
      case 'anvil': {
        const a = part(MeshBuilder.CreateBox('anvil', { width: 1.2, height: 0.5, depth: 0.6 }, s), this.mat('iron', [0.2, 0.2, 0.22]));
        a.position.y = 0.75;
        const st = part(MeshBuilder.CreateBox('anvil-base', { width: 0.6, height: 0.5, depth: 0.5 }, s), this.mat('wood', [0.55, 0.4, 0.25]));
        st.position.y = 0.25;
        radius = 0.8;
        break;
      }
      case 'board': {
        const panel = part(MeshBuilder.CreateBox('board', { width: 2, height: 1.3, depth: 0.12 }, s), this.mat('wood', [0.55, 0.4, 0.25]));
        panel.position.y = 1.6;
        const paper = part(MeshBuilder.CreatePlane('paper', { width: 0.7, height: 0.9 }, s), this.mat('paper', [0.95, 0.92, 0.8], 0.2), false);
        paper.position.set(0, 1.6, -0.07);
        for (const x of [-0.85, 0.85]) {
          const post = part(MeshBuilder.CreateBox('post', { width: 0.15, height: 2.2, depth: 0.15 }, s), this.mat('wood', [0.45, 0.32, 0.2]));
          post.position.set(x, 1.1, 0);
        }
        radius = 1.0;
        break;
      }
      case 'cart': {
        const bed = part(MeshBuilder.CreateBox('cart', { width: 1.8, height: 0.8, depth: 3 }, s), this.mat('wood', [0.55, 0.4, 0.25]));
        bed.position.y = 0.9;
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const wheel = part(MeshBuilder.CreateCylinder('wheel', { height: 0.15, diameter: 0.9, tessellation: 10 }, s), this.mat('iron', [0.2, 0.2, 0.22]));
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x * 0.95, 0.45, z * 1.0);
        }
        radius = 1.5;
        break;
      }
      case 'tower': {
        const t = part(MeshBuilder.CreateCylinder('tower', { height: 6, diameterTop: 1.2, diameterBottom: 2, tessellation: 8 }, s), this.mat('stone', [0.5, 0.5, 0.56]));
        t.position.y = 3;
        const crystal = part(MeshBuilder.CreatePolyhedron('crystal', { type: 1, size: 0.6 }, s), this.mat('crystal', [0.6, 0.5, 1], 0.7), false);
        crystal.position.y = 6.8;
        radius = 1.1;
        break;
      }
    }
    if (p.solid !== false && radius > 0) this.circles.push({ x: p.pos[0], z: p.pos[1], r: radius * sc });
  }

  /** 宿屋Aの前の行列（カプセルの旅人） */
  private buildCrowd() {
    const c = this.map.crowd;
    const root = new TransformNode('crowd', this.scene);
    const colors = [[0.7, 0.3, 0.3], [0.3, 0.5, 0.7], [0.6, 0.6, 0.3], [0.4, 0.6, 0.4], [0.6, 0.4, 0.6]];
    for (let i = 0; i < c.count; i++) {
      const g = MeshBuilder.CreateCapsule(`guest-${i}`, { height: 1.5, radius: 0.25 }, this.scene);
      g.material = this.mat('guest', colors[i % colors.length]);
      // 宿屋Aの入口から外へ伸びる列
      g.position.set(c.around[0] + (i % 2) * 0.7 + i * 0.9, 0.75, c.around[1] + Math.sin(i) * 0.4 - i * 0.15);
      g.parent = root;
      g.isPickable = false;
      this.shadows.addShadowCaster(g);
    }
    this.crowd = root;
  }

  /** 円（キャラクター）を障害物から押し出す */
  resolve(x: number, z: number, r: number): [number, number] {
    for (const b of this.boxes) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // 中心が箱の内部：最も近い辺へ押し出す
          const pushes = [[b.minX - r - x, 0], [b.maxX + r - x, 0], [0, b.minZ - r - z], [0, b.maxZ + r - z]];
          pushes.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
          x += pushes[0][0];
          z += pushes[0][1];
        }
      }
    }
    for (const c of this.circles) {
      const dx = x - c.x, dz = z - c.z;
      const min = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = c.x + (dx / d) * min;
        z = c.z + (dz / d) * min;
      }
    }
    x = Math.max(-this.bound, Math.min(this.bound, x));
    z = Math.max(-this.bound, Math.min(this.bound, z));
    return [x, z];
  }

  areaAt(x: number, z: number) {
    let best: MapData['areas'][number] | null = null;
    for (const a of this.map.areas) {
      if (Math.hypot(x - a.center[0], z - a.center[1]) <= a.radius && (!best || a.radius < best.radius)) best = a;
    }
    return best;
  }

  setCrowdVisible(v: boolean) { this.crowd?.setEnabled(v); }
}
