// Inspect a GLB: hierarchy, world bounds, triangle counts, texture sizes.
// Usage: node tools/glb-inspect.mjs path/to/model.glb
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/glb-inspect.mjs <model.glb>');
  process.exit(1);
}

const buf = readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;

const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const compCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessorData(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const n = compCount[a.type];
  const size = compSize[a.componentType];
  const stride = bv.byteStride || n * size;
  const start = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) {
    for (let c = 0; c < n; c++) {
      const o = start + k * stride + c * size;
      let v;
      if (a.componentType === 5126) v = buf.readFloatLE(o);
      else if (a.componentType === 5125) v = buf.readUInt32LE(o);
      else if (a.componentType === 5123) v = buf.readUInt16LE(o);
      else if (a.componentType === 5121) v = buf.readUInt8(o);
      else if (a.componentType === 5122) v = buf.readInt16LE(o);
      else v = buf.readInt8(o);
      out[k * n + c] = v;
    }
  }
  return { data: out, n, count: a.count };
}

// Minimal column-major mat4 helpers (three.js convention).
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
};
const fromTRS = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};
const xform = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
let tris = 0;
let verts = 0;

function meshBounds(meshIndex, matrix, name, depth) {
  const mesh = json.meshes[meshIndex];
  for (const prim of mesh.primitives) {
    const posIndex = prim.attributes.POSITION;
    if (posIndex === undefined) continue;
    const { data, count } = accessorData(posIndex);
    verts += count;
    if (prim.indices !== undefined) {
      tris += json.accessors[prim.indices].count / 3;
    } else {
      tris += count / 3;
    }
    for (let i = 0; i < count; i++) {
      const p = xform(matrix, [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
  }
  const size = max.map((v, k) => v - min[k]);
  console.log(
    `${'  '.repeat(depth)}mesh[${meshIndex}] ${name || mesh.name || ''} tri=${Math.round(
      tris
    )} bbox=${size.map((v) => v.toFixed(2)).join(' x ')}`
  );
}

function walk(nodeIndex, parentMatrix, depth) {
  const node = json.nodes[nodeIndex];
  const local = node.matrix
    ? node.matrix
    : fromTRS(node.translation, node.rotation, node.scale);
  const world = mul(parentMatrix, local);
  const label = (node.name || '').replace(/[\u0000-\u001f]/g, '?');
  let extra = '';
  if (node.mesh !== undefined) {
    const mesh = json.meshes[node.mesh];
    let t = 0;
    for (const p of mesh.primitives) {
      t += p.indices !== undefined ? json.accessors[p.indices].count / 3 : 0;
    }
    extra = ` mesh=${node.mesh} prims=${mesh.primitives.length} tris=${Math.round(t)}`;
  }
  if (node.skin !== undefined) extra += ` skin=${node.skin}`;
  console.log(`${'  '.repeat(depth)}[${nodeIndex}] ${label}${extra}`);
  if (node.mesh !== undefined) meshBounds(node.mesh, world, label, depth);
  for (const child of node.children || []) walk(child, world, depth + 1);
}

const scene = json.scenes[json.scene || 0];
for (const root of scene.nodes) walk(root, I(), 0);

console.log('\nTOTAL tris', Math.round(tris), 'verts', verts);
console.log('WORLD BBOX min', min.map((v) => v.toFixed(3)).join(', '));
console.log('WORLD BBOX max', max.map((v) => v.toFixed(3)).join(', '));
console.log('WORLD BBOX size', max.map((v, k) => (v - min[k]).toFixed(3)).join(' x '));
console.log('WORLD BBOX center', max.map((v, k) => ((v + min[k]) / 2).toFixed(3)).join(', '));

console.log('\nIMAGES');
for (let i = 0; i < (json.images || []).length; i++) {
  const img = json.images[i];
  const bv = json.bufferViews[img.bufferView];
  const start = binStart + (bv.byteOffset || 0);
  const slice = buf.subarray(start, start + Math.min(bv.byteLength, 64));
  let w = 0, h = 0, kind = img.mimeType;
  if (slice[0] === 0x89 && slice[1] === 0x50) {
    w = slice.readUInt32BE(16);
    h = slice.readUInt32BE(20);
    kind = 'png';
  } else if (slice[0] === 0xff && slice[1] === 0xd8) {
    kind = 'jpeg';
    let o = 2;
    while (o < bv.byteLength) {
      if (buf[start + o] !== 0xff) { o++; continue; }
      const marker = buf[start + o + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        h = buf.readUInt16BE(start + o + 5);
        w = buf.readUInt16BE(start + o + 7);
        break;
      }
      const len = buf.readUInt16BE(start + o + 2);
      o += 2 + len;
    }
  }
  console.log(`image[${i}] ${kind} ${w}x${h} "${img.name || ''}" ${(bv.byteLength / 1024).toFixed(0)}KB`);
}

console.log('\nMATERIALS');
for (let i = 0; i < (json.materials || []).length; i++) {
  const m = json.materials[i];
  const p = m.pbrMetallicRoughness || {};
  console.log(
    `mat[${i}] "${m.name || ''}" base=${p.baseColorFactor ? p.baseColorFactor.map(v=>v.toFixed(2)).join(',') : '-'} metal=${p.metallicFactor ?? 1} rough=${p.roughnessFactor ?? 1} tex=${p.baseColorTexture ? JSON.stringify(p.baseColorTexture) : '-'} alpha=${m.alphaMode || 'OPAQUE'} double=${m.doubleSided || false}`
  );
}
