// 筋肉質の大柄な男性キャラ（簡易3D）を生成する。楕円体を組み合わせた体に、スケルトンとアニメーションを付ける。
// 使い方: node tools/gen-macho-glb.mjs  → public/samples/sample-macho.glb
import { writeFileSync, mkdirSync } from 'node:fs';

// ---- 骨格（親相対の位置） ----
const JOINTS = [
  { name: 'Hips', parent: -1, t: [0, 0.98, 0] },
  { name: 'Spine', parent: 0, t: [0, 0.1, 0] },
  { name: 'Head', parent: 1, t: [0, 0.74, 0] },
  { name: 'UpperArm.L', parent: 1, t: [0.48, 0.5, 0] },
  { name: 'LowerArm.L', parent: 3, t: [0, -0.36, 0] },
  { name: 'UpperArm.R', parent: 1, t: [-0.48, 0.5, 0] },
  { name: 'LowerArm.R', parent: 5, t: [0, -0.36, 0] },
  { name: 'UpperLeg.L', parent: 0, t: [0.17, -0.06, 0] },
  { name: 'LowerLeg.L', parent: 7, t: [0, -0.46, 0] },
  { name: 'UpperLeg.R', parent: 0, t: [-0.17, -0.06, 0] },
  { name: 'LowerLeg.R', parent: 9, t: [0, -0.46, 0] },
];
const J = Object.fromEntries(JOINTS.map((j, i) => [j.name, i]));
const worldPos = [];
JOINTS.forEach((j, i) => {
  const p = j.parent >= 0 ? worldPos[j.parent] : [0, 0, 0];
  worldPos[i] = [p[0] + j.t[0], p[1] + j.t[1], p[2] + j.t[2]];
});

// ---- 色 ----
const C = {
  skin: [0.94, 0.68, 0.52],
  skinDark: [0.82, 0.55, 0.42],
  top: [0.09, 0.09, 0.1],
  shorts: [0.11, 0.11, 0.12],
  trim: [0.9, 0.9, 0.92],
  hair: [0.22, 0.14, 0.09],
  beard: [0.17, 0.12, 0.09],
  beardGray: [0.55, 0.52, 0.5],
  eye: [0.08, 0.06, 0.05],
  shoe: [0.08, 0.08, 0.09],
  sole: [0.93, 0.93, 0.95],
};

// ---- 部位（ジョイント相対の中心と半径。L側を書くとR側は左右反転して自動生成） ----
const TORSO = [
  ['Hips', [0, -0.02, 0], [0.36, 0.17, 0.24], C.shorts],
  ['Hips', [0, 0.12, 0], [0.34, 0.06, 0.235], C.trim], // ウエストのライン
  ['Spine', [0, 0.14, 0.02], [0.37, 0.26, 0.25], C.top], // おなか
  ['Spine', [0, 0.36, 0], [0.44, 0.28, 0.27], C.top], // 胸郭・広背筋
  ['Spine', [0.16, 0.44, 0.14], [0.18, 0.13, 0.11], C.top], // 大胸筋
  ['Spine', [0, 0.58, 0.11], [0.19, 0.07, 0.1], C.skin], // 胸元
  ['Spine', [0, 0.6, -0.04], [0.27, 0.09, 0.15], C.skin], // 僧帽筋
  ['Spine', [0, 0.68, 0], [0.11, 0.1, 0.1], C.skin], // 首
  ['Spine', [0.22, 0.58, 0.0], [0.05, 0.1, 0.15], C.trim], // タンクトップの肩ひも
];
const HEAD = [
  ['Head', [0, 0.13, 0], [0.13, 0.15, 0.14], C.skin],
  ['Head', [0, 0.22, -0.01], [0.138, 0.085, 0.148], C.hair],
  ['Head', [0, 0.03, 0.065], [0.13, 0.1, 0.095], C.beard],
  ['Head', [0, -0.03, 0.08], [0.07, 0.05, 0.06], C.beardGray], // あご先の白髪まじり
  ['Head', [0, 0.08, 0.13], [0.06, 0.018, 0.02], C.beard], // 口ひげ
  ['Head', [0.045, 0.15, 0.125], [0.018, 0.018, 0.012], C.eye],
  ['Head', [0, 0.11, 0.14], [0.025, 0.032, 0.03], C.skinDark], // 鼻
  ['Head', [0.13, 0.13, 0], [0.025, 0.04, 0.03], C.skinDark], // 耳
  ['Head', [0.045, 0.185, 0.128], [0.03, 0.008, 0.01], C.hair], // 眉
];
const LIMBS = [
  ['UpperArm.L', [0.03, -0.02, 0], [0.18, 0.17, 0.18], C.skin], // 三角筋
  ['UpperArm.L', [0, -0.2, 0.02], [0.145, 0.2, 0.15], C.skin], // 上腕
  ['LowerArm.L', [0, -0.15, 0], [0.12, 0.19, 0.12], C.skin],
  ['LowerArm.L', [0, -0.36, 0.02], [0.075, 0.095, 0.05], C.skin], // 手
  ['UpperLeg.L', [0, -0.24, 0.02], [0.18, 0.27, 0.19], C.skin], // 太もも
  ['UpperLeg.L', [0, -0.09, 0], [0.2, 0.15, 0.21], C.shorts], // 短パンのすそ
  ['UpperLeg.L', [0, -0.2, 0], [0.205, 0.025, 0.215], C.trim], // すその白いライン
  ['LowerLeg.L', [0, -0.15, -0.035], [0.135, 0.2, 0.13], C.skin], // ふくらはぎ
  ['LowerLeg.L', [0, -0.3, 0], [0.085, 0.12, 0.085], C.skin],
  ['LowerLeg.L', [0, -0.38, 0], [0.08, 0.04, 0.08], C.sole], // 靴下
  ['LowerLeg.L', [0, -0.43, 0.06], [0.095, 0.055, 0.165], C.shoe],
  ['LowerLeg.L', [0, -0.475, 0.06], [0.1, 0.022, 0.17], C.sole], // ソール
];

function mirror(part) {
  const [joint, c, r, col] = part;
  if (!joint.endsWith('.L')) {
    if (c[0] === 0) return [];
    return [[joint, [-c[0], c[1], c[2]], r, col]];
  }
  return [[joint.replace('.L', '.R'), [-c[0], c[1], c[2]], r, col]];
}
const PARTS = [...TORSO, ...HEAD, ...LIMBS].flatMap((p) => [p, ...mirror(p)]);

// ---- 楕円体メッシュ（各頂点は1つのジョイントに固定） ----
function buildMesh() {
  const pos = [], nrm = [], col = [], jnt = [], wgt = [], idx = [];
  const SEG = 14, RING = 9;
  for (const [joint, c, r, color] of PARTS) {
    const ji = J[joint];
    const o = worldPos[ji].map((w, k) => w + c[k]);
    const base = pos.length / 3;
    for (let i = 0; i <= RING; i++) {
      const v = (i / RING) * Math.PI;
      for (let s = 0; s <= SEG; s++) {
        const u = (s / SEG) * Math.PI * 2;
        const ux = Math.sin(v) * Math.cos(u), uy = Math.cos(v), uz = Math.sin(v) * Math.sin(u);
        pos.push(o[0] + ux * r[0], o[1] + uy * r[1], o[2] + uz * r[2]);
        const n = [ux / r[0], uy / r[1], uz / r[2]];
        const l = Math.hypot(...n) || 1;
        nrm.push(n[0] / l, n[1] / l, n[2] / l);
        // 下側をわずかに暗くして立体感を出す
        const shade = 0.93 + 0.07 * (uy + 1) / 2;
        col.push(color[0] * shade, color[1] * shade, color[2] * shade);
        jnt.push(ji, 0, 0, 0);
        wgt.push(1, 0, 0, 0);
      }
    }
    for (let i = 0; i < RING; i++) {
      for (let s = 0; s < SEG; s++) {
        const a = base + i * (SEG + 1) + s, b = a + SEG + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  return { pos, nrm, col, jnt, wgt, idx };
}

// ---- アニメーション ----
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const qy = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const qxz = (ax, az) => qmul(qz(az), qx(ax));
const TAU = Math.PI * 2;
// 腕は筋肉で体から離れるので、少し外へ開いた姿勢が基本
const ARM_OUT = 0.32;

function clip(name, duration, samples, fn) {
  const times = [];
  for (let i = 0; i <= samples; i++) times.push((duration * i) / samples);
  const tracks = {};
  for (const t of times) {
    const ph = (t / duration) * TAU;
    for (const [key, val] of Object.entries(fn(ph, t / duration))) (tracks[key] ??= []).push(...val);
  }
  return { name, times, tracks };
}

const base = (ph) => ({
  'Hips:translation': [0, 0.98, 0],
  'Spine:rotation': qx(0),
  'Head:rotation': qx(0),
  'UpperLeg.L:rotation': qx(0), 'UpperLeg.R:rotation': qx(0),
  'LowerLeg.L:rotation': qx(0), 'LowerLeg.R:rotation': qx(0),
  'UpperArm.L:rotation': qxz(0, ARM_OUT), 'UpperArm.R:rotation': qxz(0, -ARM_OUT),
  'LowerArm.L:rotation': qx(-0.25), 'LowerArm.R:rotation': qx(-0.25),
  ...(ph === undefined ? {} : {}),
});

const idle = (ph) => ({
  ...base(),
  'Hips:translation': [0, 0.98 - 0.012 + 0.012 * Math.cos(ph), 0],
  'Spine:rotation': qx(0.025 * Math.sin(ph)), // 呼吸
  'UpperArm.L:rotation': qxz(0.03 * Math.sin(ph), ARM_OUT + 0.04 * Math.sin(ph)),
  'UpperArm.R:rotation': qxz(0.03 * Math.sin(ph), -ARM_OUT - 0.04 * Math.sin(ph)),
});

const gait = (amp, knee, arm, elbow, lean, bob) => (ph) => {
  const s = Math.sin(ph);
  return {
    ...base(),
    'Hips:translation': [0, 0.98 - bob + bob * Math.abs(Math.cos(ph)), 0],
    'Spine:rotation': qmul(qy(0.12 * s), qx(-lean)), // 肩を揺らして歩く
    'UpperLeg.L:rotation': qx(-amp * s),
    'UpperLeg.R:rotation': qx(amp * s),
    'LowerLeg.L:rotation': qx(knee * Math.max(0, -Math.cos(ph + 0.6))),
    'LowerLeg.R:rotation': qx(knee * Math.max(0, Math.cos(ph + 0.6))),
    'UpperArm.L:rotation': qxz(arm * s, ARM_OUT),
    'UpperArm.R:rotation': qxz(-arm * s, -ARM_OUT),
    'LowerArm.L:rotation': qx(-elbow),
    'LowerArm.R:rotation': qx(-elbow),
  };
};

// 右ストレート：構え→踏み込んで打つ→戻る
const punch = (_ph, k) => {
  const hit = k < 0.35 ? k / 0.35 : k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
  const wind = k < 0.2 ? k / 0.2 : Math.max(0, 1 - (k - 0.2) / 0.15);
  return {
    ...base(),
    'Hips:translation': [0, 0.98 - 0.05 * hit, 0.08 * hit],
    'Spine:rotation': qmul(qy(-0.45 * hit + 0.25 * wind), qx(-0.15 * hit)),
    'UpperArm.R:rotation': qxz(-1.45 * hit + 0.4 * wind, -ARM_OUT * (1 - hit)),
    'LowerArm.R:rotation': qx(-1.6 * (1 - hit) - 0.1),
    'UpperArm.L:rotation': qxz(-0.6, ARM_OUT * 0.6),
    'LowerArm.L:rotation': qx(-1.9),
    'UpperLeg.L:rotation': qx(-0.35 * hit),
    'LowerLeg.L:rotation': qx(0.35 * hit),
    'UpperLeg.R:rotation': qx(0.25 * hit),
  };
};

// 力こぶポーズ（ダブルバイセップス）
const flex = (ph, k) => {
  const up = Math.min(1, k / 0.25);
  const pump = 0.06 * Math.sin(ph * 2);
  return {
    ...base(),
    'Hips:translation': [0, 0.98, 0],
    'Spine:rotation': qx(0.08 * up),
    'UpperArm.L:rotation': qxz(0, ARM_OUT + (1.25 + pump) * up),
    'UpperArm.R:rotation': qxz(0, -ARM_OUT - (1.25 + pump) * up),
    'LowerArm.L:rotation': qmul(qz(1.5 * up), qx(-0.2 * up)),
    'LowerArm.R:rotation': qmul(qz(-1.5 * up), qx(-0.2 * up)),
  };
};

const CLIPS = [
  clip('Idle', 2.4, 24, idle),
  clip('Walk', 1.15, 20, gait(0.5, 0.65, 0.35, 0.3, 0.03, 0.035)),
  clip('Run', 0.7, 16, gait(0.85, 1.3, 0.75, 1.2, 0.2, 0.07)),
  clip('Punch', 0.7, 21, punch),
  clip('Flex', 2.0, 30, flex),
];

// ---- glTF（GLB）の組み立て ----
function buildGlb() {
  const mesh = buildMesh();
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [];
  const addView = (typed, target) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(bytes);
    const view = { buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    byteLength += bytes.byteLength;
    bufferViews.push(view);
    return bufferViews.length - 1;
  };
  const addAccessor = (typed, componentType, type, count, extra = {}, target) => {
    accessors.push({ bufferView: addView(typed, target), componentType, type, count, ...extra });
    return accessors.length - 1;
  };
  const FLOAT = 5126, USHORT = 5123, UINT = 5125, ARRAY = 34962, ELEM = 34963;
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
  const big = vcount > 65535;
  const aIdx = addAccessor(big ? new Uint32Array(mesh.idx) : new Uint16Array(mesh.idx), big ? UINT : USHORT, 'SCALAR', mesh.idx.length, {}, ELEM);
  const ibm = [];
  for (const p of worldPos) ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1);
  const aIbm = addAccessor(new Float32Array(ibm), FLOAT, 'MAT4', JOINTS.length);

  const nodes = JOINTS.map((j, i) => {
    const children = JOINTS.map((c, ci) => (c.parent === i ? ci : -1)).filter((c) => c >= 0);
    const n = { name: j.name, translation: j.t };
    if (children.length) n.children = children;
    return n;
  });
  const meshNode = nodes.length;
  nodes.push({ name: 'Body', mesh: 0, skin: 0 });
  nodes.push({ name: 'MachoMan', children: [0, meshNode] });

  const animations = CLIPS.map((c) => {
    const input = addAccessor(new Float32Array(c.times), FLOAT, 'SCALAR', c.times.length, { min: [c.times[0]], max: [c.times[c.times.length - 1]] });
    const samplers = [], channels = [];
    for (const [key, values] of Object.entries(c.tracks)) {
      const [joint, path] = key.split(':');
      const output = addAccessor(new Float32Array(values), FLOAT, path === 'rotation' ? 'VEC4' : 'VEC3', c.times.length);
      samplers.push({ input, output, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: J[joint], path } });
    }
    return { name: c.name, samplers, channels };
  });

  const gltf = {
    asset: { version: '2.0', generator: 'it-ipa macho generator' },
    scene: 0, scenes: [{ nodes: [nodes.length - 1] }], nodes,
    meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol, JOINTS_0: aJnt, WEIGHTS_0: aWgt }, indices: aIdx, material: 0 }] }],
    materials: [{ name: 'Skin', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.95 } }],
    skins: [{ joints: JOINTS.map((_, i) => i), inverseBindMatrices: aIbm, skeleton: 0 }],
    animations, accessors, bufferViews, buffers: [{ byteLength }],
  };
  const bin = new Uint8Array(byteLength + ((4 - (byteLength % 4)) % 4));
  let off = 0;
  for (const c of chunks) { bin.set(c, off); off += c.byteLength; }
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.byteLength % 4)) % 4;
  if (jsonPad) { const p = new Uint8Array(json.byteLength + jsonPad).fill(0x20); p.set(json); json = p; }
  const total = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, json.byteLength, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  const binOff = 20 + json.byteLength;
  dv.setUint32(binOff, bin.byteLength, true); dv.setUint32(binOff + 4, 0x004e4942, true);
  out.set(bin, binOff + 8);
  return out;
}

const glb = buildGlb();
mkdirSync('public/samples', { recursive: true });
writeFileSync('public/samples/sample-macho.glb', glb);
console.log(`public/samples/sample-macho.glb  ${(glb.byteLength / 1024).toFixed(1)} KB, parts ${PARTS.length}`);
