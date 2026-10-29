import * as THREE from 'three';
import {
  AIRFIELD_ELEVATION,
  terrainHeight,
  terrainNormal,
  valueNoise,
  clamp,
  smoothstep,
} from '../core/utils.js';
import { grassTexture, terrainNormalTexture } from './textures.js';

const scratchColor = new THREE.Color();

const COLORS = {
  pastureA: new THREE.Color(0x71894b),
  pastureB: new THREE.Color(0x8b9d5d),
  mown: new THREE.Color(0x829c55),
  crop: new THREE.Color(0xa99b63),
  cropPale: new THREE.Color(0xbdb077),
  wood: new THREE.Color(0x3f5a35),
  wet: new THREE.Color(0x536d3d),
};
for (const key of Object.keys(COLORS)) COLORS[key].convertSRGBToLinear();

const colorA = new THREE.Color();

/**
 * Illinois farmland colouring. Large field patches come from the very low
 * frequencies; the fine noise only adds the mown-stripe / stubble texture.
 * The base is deliberately muted so the concrete and the white hangars are the
 * brightest things in the scene.
 */
function terrainVertexColor(elevation, normalY, x, z, out) {
  const field = valueNoise(x * 0.00042 + 4.1, z * 0.00042 - 2.2);
  const patch = valueNoise(x * 0.0016 - 9.2, z * 0.0016 + 3.4);
  const fine = valueNoise(x * 0.014 + 3.3, z * 0.014 - 7.7);
  const broad = valueNoise(x * 0.00011 + 8.4, z * 0.00011 + 1.7);

  // Pasture with broad tonal drift.
  out.copy(COLORS.pastureA).lerp(COLORS.pastureB, field * 0.75 + broad * 0.25);

  // Crop fields: pale wheat / soybean blocks separated by hedgerows.
  const cropMask = smoothstep(0.54, 0.74, patch) * smoothstep(0.42, 0.68, broad);
  colorA.copy(COLORS.crop).lerp(COLORS.cropPale, field);
  out.lerp(colorA, cropMask * 0.72);

  // Dark woodlots and the damp drainage lines.
  const woodMask = smoothstep(0.69, 0.86, valueNoise(x * 0.0011 + 12.3, z * 0.0011 - 5.4));
  out.lerp(COLORS.wood, woodMask * 0.45);
  if (elevation < AIRFIELD_ELEVATION - 1.4) {
    out.lerp(COLORS.wet, smoothstep(1.4, 5, AIRFIELD_ELEVATION - elevation) * 0.35);
  }

  // The mown strip around the airfield: cleaner, lighter, shorter grass.
  const d = Math.hypot(x, z);
  out.lerp(COLORS.mown, (1 - smoothstep(500, 1900, d)) * 0.32);

  // Slopes catch a little more light; the plain is almost flat, so this is
  // only a subtle break-up, not exposed soil.
  out.lerp(COLORS.pastureB, clamp((1 - normalY) * 2.2, 0, 0.18));

  const shade = 0.95 + fine * 0.09 + field * 0.045;
  out.multiplyScalar(shade);
}

function buildLayer(halfSize, segments, holeHalf, yOffset) {
  const n = segments + 1;
  const size = halfSize * 2;
  const step = size / segments;
  const vertexCount = n * n;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let j = 0; j < n; j++) {
    const z = -halfSize + j * step;
    for (let i = 0; i < n; i++) {
      const x = -halfSize + i * step;
      const idx = j * n + i;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = terrainHeight(x, z) - yOffset;
      positions[idx * 3 + 2] = z;
      uvs[idx * 2] = x / 24;
      uvs[idx * 2 + 1] = z / 24;
    }
  }

  const indices = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const cx = -halfSize + (i + 0.5) * step;
      const cz = -halfSize + (j + 0.5) * step;
      if (holeHalf > 0 && Math.abs(cx) < holeHalf && Math.abs(cz) < holeHalf) continue;
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const normals = geo.attributes.normal.array;
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    terrainVertexColor(y, normals[i * 3 + 1], x, z, scratchColor);
    colors[i * 3] = scratchColor.r;
    colors[i * 3 + 1] = scratchColor.g;
    colors[i * 3 + 2] = scratchColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

export class Terrain {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.material = this.createMaterial();

    const layers = [
      { half: 7000, seg: 560, hole: 0, offset: 0 },
      { half: 45000, seg: 480, hole: 6990, offset: 0.45 },
      { half: 120000, seg: 360, hole: 44990, offset: 0.9 },
    ];
    for (const layer of layers) {
      const geo = buildLayer(layer.half, layer.seg, layer.hole, layer.offset);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
    }
  }

  createMaterial() {
    const map = grassTexture();
    const normalMap = terrainNormalTexture();
    map.anisotropy = 16;
    normalMap.anisotropy = 8;
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.97,
      metalness: 0.0,
      envMapIntensity: 0.3,
      dithering: true,
    });
  }

  heightAt(x, z) {
    return terrainHeight(x, z);
  }

  normalAt(x, z) {
    return terrainNormal(x, z);
  }
}
