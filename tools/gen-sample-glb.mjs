// サンプル用のリグ付きGLBを生成する（外部依存なし）。
// 箱で組んだ簡易人型 + スケルトン + アニメーション（待機/歩行/走行/手を振る）。
// hero はよくある名前、partner はわざと決め打ちできない名前にして、割当UIの検証に使う。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT_DIR = 'public/samples';

// ---- 骨格（親相対の位置。バインドポーズは回転なし） ----
const JOINTS = [
  { name: 'Hips', parent: -1, t: [0, 0.95, 0] },
  { name: 'Spine', parent: 0, t: [0, 0.08, 0] },
  { name: 'Head', parent: 1, t: [0, 0.58, 0] },
  { name: 'UpperArm.L', parent: 1, t: [0.27, 0.5, 0] },
  { name: 'LowerArm.L', parent: 3, t: [0, -0.32, 0] },
  { name: 'UpperArm.R', parent: 1, t: [-0.27, 0.5, 0] },
  { name: 'LowerArm.R', parent: 5, t: [0, -0.32, 0] },
  { name: 'UpperLeg.L', parent: 0, t: [0.11, -0.04, 0] },
  { name: 'LowerLeg.L', parent: 7, t: [0, -0.45, 0] },
  { name: 'UpperLeg.R', parent: 0, t: [-0.11, -0.04, 0] },
  { name: 'LowerLeg.R', parent: 9, t: [0, -0.45, 0] },
];
const J = Object.fromEntries(JOINTS.map((j, i) => [j.name, i]));
const worldPos = JOINTS.map(() => [0, 0, 0]);
JOINTS.forEach((j, i) => {
  const p = j.parent >= 0 ? worldPos[j.parent] : [0, 0, 0];
  worldPos[i] = [p[0] + j.t[0], p[1] + j.t[1], p[2] + j.t[2]];
});

// ---- 箱パーツ（ジョイントローカルの中心とサイズ） ----
function parts(c) {
  return [
    { joint: 'Hips', center: [0, 0, 0], size: [0.34, 0.16, 0.2], color: c.pants },
    { joint: 'Spine', center: [0, 0.27, 0], size: [0.4, 0.5, 0.22], color: c.body },
    { joint: 'Head', center: [0, 0.16, 0], size: [0.28, 0.3, 0.28], color: c.skin },
    { joint: 'Head', center: [0, 0.3, -0.02], size: [0.32, 0.08, 0.32], color: c.hair },
    { joint: 'Head', center: [0, 0.16, 0.15], size: [0.06, 0.06, 0.05], color: c.accent }, // 鼻 = 正面(+Z)
    { joint: 'UpperArm.L', center: [0, -0.16, 0], size: [0.11, 0.34, 0.11], color: c.body },
    { joint: 'LowerArm.L', center: [0, -0.14, 0], size: [0.09, 0.3, 0.09], color: c.skin },
    { joint: 'UpperArm.R', center: [0, -0.16, 0], size: [0.11, 0.34, 0.11], color: c.body },
    { joint: 'LowerArm.R', center: [0, -0.14, 0], size: [0.09, 0.3, 0.09], color: c.skin },
    { joint: 'UpperLeg.L', center: [0, -0.22, 0], size: [0.14, 0.46, 0.14], color: c.pants },
    { joint: 'LowerLeg.L', center: [0, -0.22, 0.02], size: [0.12, 0.46, 0.16], color: c.boots },
    { joint: 'UpperLeg.R', center: [0, -0.22, 0], size: [0.14, 0.46, 0.14], color: c.pants },
    { joint: 'LowerLeg.R', center: [0, -0.22, 0.02], size: [0.12, 0.46, 0.16], color: c.boots },
  ];
}

const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

function buildMesh(colors) {
  const pos = [], nrm = [], col = [], jnt = [], wgt = [], idx = [];
  for (const p of parts(colors)) {
    const ji = J[p.joint];
    const o = worldPos[ji].map((w, k) => w + p.center[k]);
    const h = p.size.map((s) => s / 2);
    for (const f of FACES) {
      const base = pos.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        for (let k = 0; k < 3; k++) {
          pos.push(o[k] + (f.n[k] + f.u[k] * su + f.v[k] * sv) * h[k]);
        }
        nrm.push(...f.n);
        col.push(...p.color);
        jnt.push(ji, 0, 0, 0);
        wgt.push(1, 0, 0, 0);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { pos, nrm, col, jnt, wgt, idx };
}

// ---- アニメーション ----
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const qxz = (ax, az) => {
  // X回転の後にZ回転（q = qz * qx）
  const [x1, , , w1] = qx(ax);
  const [, , z2, w2] = qz(az);
  return [w2 * x1, z2 * x1, z2 * w1, w2 * w1];
};
const TAU = Math.PI * 2;

function clip(name, duration, samples, fn) {
  const times = [];
  for (let i = 0; i <= samples; i++) times.push((duration * i) / samples);
  const tracks = {}; // key "joint:path" -> values[]
  for (const t of times) {
    const ph = (t / duration) * TAU;
    for (const [key, val] of Object.entries(fn(ph))) (tracks[key] ??= []).push(...val);
  }
  return { name, times, tracks };
}

const gait = (amp, knee, arm, elbow, lean, bob) => (ph) => {
  const s = Math.sin(ph);
  return {
    'Hips:translation': [0, 0.95 - bob + bob * Math.abs(Math.cos(ph)), 0],
    'Spine:rotation': qx(-lean),
    'UpperLeg.L:rotation': qx(-amp * s),
    'UpperLeg.R:rotation': qx(amp * s),
    'LowerLeg.L:rotation': qx(knee * Math.max(0, -Math.cos(ph + 0.6))),
    'LowerLeg.R:rotation': qx(knee * Math.max(0, Math.cos(ph + 0.6))),
    'UpperArm.L:rotation': qxz(arm * s, 0.08),
    'UpperArm.R:rotation': qxz(-arm * s, -0.08),
    'LowerArm.L:rotation': qx(-elbow),
    'LowerArm.R:rotation': qx(-elbow),
  };
};

const idle = (ph) => ({
  'Hips:translation': [0, 0.95 - 0.01 + 0.01 * Math.cos(ph), 0],
  'Spine:rotation': qx(0.03 * Math.sin(ph)),
  'UpperLeg.L:rotation': qx(0),
  'UpperLeg.R:rotation': qx(0),
  'LowerLeg.L:rotation': qx(0),
  'LowerLeg.R:rotation': qx(0),
  'UpperArm.L:rotation': qxz(0.04 * Math.sin(ph), 0.12 + 0.03 * Math.sin(ph)),
  'UpperArm.R:rotation': qxz(0.04 * Math.sin(ph), -0.12 - 0.03 * Math.sin(ph)),
  'LowerArm.L:rotation': qx(-0.15),
  'LowerArm.R:rotation': qx(-0.15),
});

const wave = (ph) => ({
  ...idle(ph),
  'UpperArm.R:rotation': qxz(0, -2.6),
  'LowerArm.R:rotation': qxz(0, -0.4 + 0.45 * Math.sin(ph * 2)),
});

function clipsFor(names) {
  return [
    clip(names.idle, 2.0, 24, idle),
    clip(names.walk, 1.0, 20, gait(0.55, 0.7, 0.45, 0.25, 0.04, 0.03)),
    clip(names.run, 0.6, 16, gait(0.95, 1.4, 0.9, 1.3, 0.22, 0.07)),
    clip(names.wave, 1.2, 16, wave),
  ];
}

// ---- glTF 組み立て ----
function buildGlb({ colors, names, rootName }) {
  const mesh = buildMesh(colors);
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [];
  const accessors = [];

  function addView(typed, target) {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(bytes);
    const view = { buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    byteLength += bytes.byteLength;
    bufferViews.push(view);
    return bufferViews.length - 1;
  }
  function addAccessor(typed, componentType, type, count, extra = {}, target) {
    accessors.push({ bufferView: addView(typed, target), componentType, type, count, ...extra });
    return accessors.length - 1;
  }

  const FLOAT = 5126, USHORT = 5123, ARRAY = 34962, ELEM = 34963;
  const vcount = mesh.pos.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vcount; i++) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], mesh.pos[i * 3 + k]);
    max[k] = Math.max(max[k], mesh.pos[i * 3 + k]);
  }
  const aPos = addAccessor(new Float32Array(mesh.pos), FLOAT, 'VEC3', vcount, { min, max }, ARRAY);
  const aNrm = addAccessor(new Float32Array(mesh.nrm), FLOAT, 'VEC3', vcount, {}, ARRAY);
  const aCol = addAccessor(new Float32Array(mesh.col), FLOAT, 'VEC3', vcount, {}, ARRAY);
  const aJnt = addAccessor(new Uint16Array(mesh.jnt), USHORT, 'VEC4', vcount, {}, ARRAY);
  const aWgt = addAccessor(new Float32Array(mesh.wgt), FLOAT, 'VEC4', vcount, {}, ARRAY);
  const aIdx = addAccessor(new Uint16Array(mesh.idx), USHORT, 'SCALAR', mesh.idx.length, {}, ELEM);

  // 逆バインド行列（列優先。平行移動のみ）
  const ibm = [];
  for (const p of worldPos) ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1);
  const aIbm = addAccessor(new Float32Array(ibm), FLOAT, 'MAT4', JOINTS.length);

  // ノード: 0..N-1 = ジョイント, N = メッシュ, N+1 = ルート
  const nodes = JOINTS.map((j, i) => {
    const children = JOINTS.map((c, ci) => (c.parent === i ? ci : -1)).filter((c) => c >= 0);
    const n = { name: j.name, translation: j.t };
    if (children.length) n.children = children;
    return n;
  });
  const meshNode = nodes.length;
  nodes.push({ name: 'Body', mesh: 0, skin: 0 });
  nodes.push({ name: rootName, children: [0, meshNode] });

  const animations = clipsFor(names).map((c) => {
    const input = addAccessor(new Float32Array(c.times), FLOAT, 'SCALAR', c.times.length, {
      min: [c.times[0]], max: [c.times[c.times.length - 1]],
    });
    const samplers = [], channels = [];
    for (const [key, values] of Object.entries(c.tracks)) {
      const [joint, path] = key.split(':');
      const type = path === 'rotation' ? 'VEC4' : 'VEC3';
      const output = addAccessor(new Float32Array(values), FLOAT, type, c.times.length);
      samplers.push({ input, output, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: J[joint], path } });
    }
    return { name: c.name, samplers, channels };
  });

  const gltf = {
    asset: { version: '2.0', generator: 'it-ipa sample generator' },
    scene: 0,
    scenes: [{ nodes: [nodes.length - 1] }],
    nodes,
    meshes: [{
      name: 'Body',
      primitives: [{
        attributes: { POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol, JOINTS_0: aJnt, WEIGHTS_0: aWgt },
        indices: aIdx, material: 0,
      }],
    }],
    materials: [{ name: 'VertexColor', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } }],
    skins: [{ joints: JOINTS.map((_, i) => i), inverseBindMatrices: aIbm, skeleton: 0 }],
    animations,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  const bin = new Uint8Array(byteLength + ((4 - (byteLength % 4)) % 4));
  let off = 0;
  for (const c of chunks) { bin.set(c, off); off += c.byteLength; }

  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.byteLength % 4)) % 4;
  if (jsonPad) {
    const p = new Uint8Array(json.byteLength + jsonPad).fill(0x20);
    p.set(json); json = p;
  }
  const total = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(json, 20);
  const binOff = 20 + json.byteLength;
  dv.setUint32(binOff, bin.byteLength, true);
  dv.setUint32(binOff + 4, 0x004e4942, true); // 'BIN\0'
  out.set(bin, binOff + 8);
  return out;
}

const SAMPLES = [
  {
    file: 'sample-hero.glb',
    rootName: 'SampleHero',
    colors: { body: [0.2, 0.42, 0.85], pants: [0.2, 0.22, 0.3], skin: [0.98, 0.82, 0.68], hair: [0.35, 0.22, 0.12], boots: [0.35, 0.24, 0.16], accent: [0.95, 0.6, 0.5] },
    names: { idle: 'Idle', walk: 'Walk', run: 'Run', wave: 'Wave' },
  },
  {
    // 名前を決め打ちできないことを確認するため、あえて不規則な名前にする
    file: 'sample-partner.glb',
    rootName: 'SamplePartner',
    colors: { body: [0.9, 0.5, 0.18], pants: [0.45, 0.3, 0.25], skin: [0.98, 0.84, 0.72], hair: [0.85, 0.75, 0.3], boots: [0.3, 0.2, 0.15], accent: [0.95, 0.6, 0.5] },
    names: { idle: 'Armature|Breathing_Loop', walk: 'Armature|Stroll', run: 'Armature|Dash_Fast', wave: 'Armature|Greeting' },
  },
];

for (const s of SAMPLES) {
  const glb = buildGlb(s);
  const path = `${OUT_DIR}/${s.file}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, glb);
  console.log(`${path}  ${(glb.byteLength / 1024).toFixed(1)} KB`);
}
