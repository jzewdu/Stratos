import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { importedModelInfo } from '../aircraft/imported.js';
import {
  AIRFIELD_ELEVATION,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_HEADING,
  HANGAR_BAY_U,
  HANGAR_BAY_V,
  mulberry32,
  randRange,
  terrainHeight,
  terrainSlope,
  valueNoise,
  clamp,
  smoothstep,
  fbm,
} from '../core/utils.js';
import {
  asphaltTexture,
  concreteTexture,
  facadeTextures,
  glowTexture,
  runwayNumberTexture,
  solarPanelTexture,
  signTexture,
} from './textures.js';

const AF_Y = AIRFIELD_ELEVATION;
const RWY_ROT = RUNWAY_HEADING - Math.PI / 2;
const SECOND_LEN = 2743;
const SECOND_Z = -650;

// Airfield-local (u along 03, v to the left/west) to world XZ.
function fieldToWorld(u, v) {
  const s = Math.sin(RUNWAY_HEADING);
  const c = Math.cos(RUNWAY_HEADING);
  return { x: u * s - v * c, z: u * c + v * s };
}

function inAirfield(x, z, margin = 0) {
  const s = Math.sin(RUNWAY_HEADING);
  const c = Math.cos(RUNWAY_HEADING);
  const u = x * s + z * c;
  const v = -x * c + z * s;
  return Math.abs(u) < 1950 + margin && v > -1050 - margin && v < 1650 + margin;
}

function coloredGeometry(geo, hex) {
  const color = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function makeHardwoodGeometry() {
  const parts = [];
  const rng = mulberry32(77);
  const trunk = new THREE.CylinderGeometry(0.18, 0.34, 3.4, 5).toNonIndexed();
  trunk.translate(0, 1.7, 0);
  parts.push(coloredGeometry(trunk, 0x5a4a39));
  const canopyColors = [0x3f6833, 0x4c763b, 0x355c2d, 0x577f40];
  for (let i = 0; i < 4; i++) {
    const blob = new THREE.IcosahedronGeometry(1.9 + rng() * 1.1, 0);
    blob.scale(1.1, 0.86 + rng() * 0.2, 1.1);
    blob.translate((rng() - 0.5) * 2.4, 3.5 + rng() * 2.6, (rng() - 0.5) * 2.4);
    parts.push(coloredGeometry(blob, canopyColors[i % canopyColors.length]));
  }
  return mergeGeometries(parts, false);
}

/** Drop the -Z end cap of an extruded hangar shell so the bay is open. */
function openFrontCap(geometry, halfDepth) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.attributes.position;
  const kept = [];
  for (let i = 0; i < pos.count; i += 3) {
    if (
      pos.getZ(i) < -halfDepth + 0.1 &&
      pos.getZ(i + 1) < -halfDepth + 0.1 &&
      pos.getZ(i + 2) < -halfDepth + 0.1
    ) {
      continue;
    }
    for (let k = 0; k < 3; k++) {
      kept.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeCreosoteGeometry() {
  const parts = [];
  const rng = mulberry32(31);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(0.42 + rng() * 0.25, 0);
    g.scale(1.15, 0.72, 1.15);
    g.translate((rng() - 0.5) * 0.7, 0.35 + rng() * 0.35, (rng() - 0.5) * 0.7);
    parts.push(coloredGeometry(g, i % 2 ? 0x5c6242 : 0x6a6f4a));
  }
  for (let i = 0; i < 3; i++) {
    const stem = new THREE.CylinderGeometry(0.035, 0.07, 0.55, 4).toNonIndexed();
    stem.translate((rng() - 0.5) * 0.4, 0.27, (rng() - 0.5) * 0.4);
    parts.push(coloredGeometry(stem, 0x4a3b2b));
  }
  return mergeGeometries(parts, false);
}

function makeYuccaGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.09, 0.16, 1.2, 5).toNonIndexed();
  trunk.translate(0, 0.6, 0);
  parts.push(coloredGeometry(trunk, 0x5e4a33));
  const rng = mulberry32(77);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rng() * 0.3;
    const leaf = new THREE.ConeGeometry(0.075, 1.25 + rng() * 0.55, 3).toNonIndexed();
    leaf.translate(0, 0.6, 0);
    leaf.rotateZ(a);
    leaf.rotateX((rng() - 0.5) * 0.5);
    leaf.translate(Math.cos(a) * 0.12, 1.12, Math.sin(a) * 0.12);
    parts.push(coloredGeometry(leaf, 0x6f764c));
  }
  return mergeGeometries(parts, false);
}

function makeJoshuaGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.22, 3.2, 5).toNonIndexed();
  trunk.translate(0, 1.6, 0);
  parts.push(coloredGeometry(trunk, 0x5b4936));
  const rng = mulberry32(99);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng() * 0.4;
    const len = 1.2 + rng() * 1.0;
    const branch = new THREE.CylinderGeometry(0.05, 0.09, len, 4).toNonIndexed();
    branch.translate(0, len / 2, 0);
    branch.rotateZ(0.5 + rng() * 0.35);
    branch.rotateY(a);
    branch.translate(0, 2.6 + rng() * 0.8, 0);
    parts.push(coloredGeometry(branch, 0x554533));
    const tuft = new THREE.IcosahedronGeometry(0.42, 0).toNonIndexed();
    tuft.scale(1.1, 1.35, 1.1);
    const bx = Math.sin(a) * Math.sin(0.65) * len;
    const bz = Math.cos(a) * Math.sin(0.65) * len;
    tuft.translate(bx, 3.1 + Math.cos(0.65) * len, bz);
    parts.push(coloredGeometry(tuft, 0x596040));
  }
  return mergeGeometries(parts, false);
}

function makePinyonGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.08, 0.16, 1.1, 5).toNonIndexed();
  trunk.translate(0, 0.55, 0);
  parts.push(coloredGeometry(trunk, 0x4c3b2b));
  const tiers = [
    { r: 0.82, h: 1.5, y: 1.15 },
    { r: 0.62, h: 1.25, y: 1.95 },
    { r: 0.4, h: 1.0, y: 2.6 },
  ];
  for (const t of tiers) {
    const cone = new THREE.ConeGeometry(t.r, t.h, 7, 1).toNonIndexed();
    cone.translate(0, t.y + t.h / 2, 0);
    parts.push(coloredGeometry(cone, 0x3f4d35));
  }
  return mergeGeometries(parts, false);
}

function createInstanced(geometry, entries, material, castShadow) {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    dummy.position.set(e.x, e.y, e.z);
    dummy.rotation.set(0, e.rot, 0);
    dummy.scale.set(e.size * e.width, e.size, e.size * e.width);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(e.hue, e.sat, e.light);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Split a plant set into ~5km cells before instancing it.
 *
 * One InstancedMesh per species means every one of the 30k plants is submitted
 * every frame, wherever the camera looks. Chunking lets the frustum discard the
 * three quarters of the desert behind and beside the player, which matters far
 * more than the extra draw calls.
 */
function createInstancedChunks(parent, geometry, entries, material, castShadow, sink) {
  const CHUNK = 5000;
  const cells = new Map();
  for (const e of entries) {
    const key = `${Math.floor(e.x / CHUNK)},${Math.floor(e.z / CHUNK)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(e);
  }
  for (const list of cells.values()) {
    const mesh = createInstanced(geometry, list, material, castShadow);
    parent.add(mesh);
    if (sink) sink.push({ mesh, full: mesh.count });
  }
}

export class Scenery {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    scene.add(this.group);
    this.nightMaterials = [];
    this.pointLights = [];
    this.beacon = null;
    this.cloudSprites = [];
    this.cloudMaterials = [];
    this.vegetation = [];
    this.treeCount = 0;
    this.cityMaterials = [];

    this.buildFarmland();
    this.buildScottAFB();
    this.buildClouds();
  }

  // -------------------------------------------------------------------------
  // Scott AFB, Illinois: farmland and the airfield
  // -------------------------------------------------------------------------

  /**
   * The flat Illinois flood plain around Scott: hedgerows, woodlots and the
   * tree line behind the hangars. There are no mountains and no desert scrub;
   * the ground itself is painted by the terrain shader.
   */
  buildFarmland() {
    const rng = mulberry32(44017);
    const treeGeo = makeHardwoodGeometry();
    const treeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.25,
    });
    const entries = [];
    const addTree = (x, z, scale, force = false) => {
      if (!force && inAirfield(x, z, 260)) return;
      const h = terrainHeight(x, z);
      if (h < 0) return;
      entries.push({
        x,
        y: h - 0.25,
        z,
        rot: rng() * Math.PI * 2,
        size: scale,
        width: 0.9 + rng() * 0.16,
        hue: 0.25 + rng() * 0.035,
        sat: 0.09 + rng() * 0.05,
        light: 0.56 + rng() * 0.1,
      });
    };

    // The line of trees immediately behind the hangar roofs in the reference.
    for (let u = -1280; u < 40; u += 14) {
      const p = fieldToWorld(u + (rng() - 0.5) * 8, 1084 + rng() * 24);
      addTree(p.x, p.z, 1.6 + rng() * 1.0, true);
    }
    // A second, deeper belt so the tree line does not read as a single row.
    for (let u = -1340; u < 80; u += 22) {
      const p = fieldToWorld(u + (rng() - 0.5) * 18, 1160 + rng() * 90);
      addTree(p.x, p.z, 1.2 + rng() * 1.3, true);
    }

    // Woodlots and hedgerows scattered through the fields.
    for (let i = 0; i < 18; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 1500 + rng() * 6000;
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;
      const count = 28 + Math.floor(rng() * 50);
      for (let j = 0; j < count; j++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 240;
        addTree(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 1.1 + rng() * 1.6);
      }
    }

    // Long hedgerows along the field boundaries, still outside the airfield.
    for (let i = 0; i < 5; i++) {
      const offset = (rng() - 0.5) * 7000;
      for (let step = -3600; step < 3600; step += 26) {
        const p = fieldToWorld(step, 1900 + i * 620 + offset * 0.15);
        if (rng() > 0.22) addTree(p.x, p.z, 1.0 + rng() * 0.8);
      }
    }

    createInstancedChunks(this.group, treeGeo, entries, treeMat, true, this.vegetation);
    this.treeCount = entries.length;
  }

  /**
   * The reference is the pair of white barrel-vault hangars, the wide concrete
   * ramp and the parking lot — not a city skyline. Everything here is built in
   * airfield-local coordinates (u along 14/32, v to the left of the runway).
   */
  buildScottAFB() {
    const group = new THREE.Group();
    group.name = 'scott-afb';
    group.position.y = AF_Y;
    group.rotation.y = RWY_ROT;
    this.group.add(group);
    this.airfield = group;

    const asphalt = asphaltTexture().clone();
    asphalt.needsUpdate = true;
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
    asphalt.repeat.set(90, 2);
    const runwayMat = new THREE.MeshStandardMaterial({
      map: asphalt,
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const taxiTex = asphalt.clone();
    taxiTex.repeat.set(80, 1.2);
    taxiTex.needsUpdate = true;
    const taxiMat = runwayMat.clone();
    taxiMat.map = taxiTex;

    const concrete = concreteTexture().clone();
    concrete.needsUpdate = true;
    concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
    concrete.repeat.set(44, 30);
    const concreteMat = new THREE.MeshStandardMaterial({
      map: concrete,
      color: 0xd5d1c7,
      roughness: 0.97,
      metalness: 0.0,
      envMapIntensity: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const lot = asphalt.clone();
    lot.repeat.set(18, 10);
    lot.needsUpdate = true;
    const lotMat = new THREE.MeshStandardMaterial({
      map: lot,
      color: 0x8d8c87,
      roughness: 0.98,
      metalness: 0.0,
      envMapIntensity: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const addPlane = (w, d, mat, u, v, y = 0.06) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(u, y, v);
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    // Runway 14/32, parallel taxiway and the ramp.
    addPlane(RUNWAY_LENGTH, RUNWAY_WIDTH, runwayMat, 0, 0, 0.06);
    addPlane(RUNWAY_LENGTH - 180, 23, taxiMat, 0, 120, 0.05);
    addPlane(23, 90, taxiMat, -200, 165, 0.045);
    addPlane(23, 90, taxiMat, 900, 165, 0.045);
    addPlane(1050, 700, concreteMat, -575, 560, 0.04);
    addPlane(320, 110, concreteMat, -800, 855, 0.045);
    addPlane(230, 130, lotMat, -1005, 940, 0.045);

    const markingMat = new THREE.MeshStandardMaterial({
      color: 0xf1efe4,
      emissive: 0x161410,
      emissiveIntensity: 0.02,
      roughness: 0.98,
      metalness: 0.0,
      envMapIntensity: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const yellowMat = new THREE.MeshStandardMaterial({
      color: 0xc9a54b,
      roughness: 0.97,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const addMark = (w, d, u, v, y = 0.13, mat = markingMat) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(u, y, v);
      m.receiveShadow = true;
      group.add(m);
      return m;
    };

    // Runway markings.
    const edge = RUNWAY_WIDTH / 2 - 2.4;
    addMark(RUNWAY_LENGTH - 20, 0.9, 0, -edge);
    addMark(RUNWAY_LENGTH - 20, 0.9, 0, edge);
    for (let u = -RUNWAY_LENGTH / 2 + 100; u <= RUNWAY_LENGTH / 2 - 100; u += 60) {
      addMark(26, 1.15, u, 0);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        addMark(24, 2.0, side * (RUNWAY_LENGTH / 2 - 40), -19.5 + i * 5.6);
      }
      addMark(46, 6.2, side * (RUNWAY_LENGTH / 2 - 480), -9);
      addMark(46, 6.2, side * (RUNWAY_LENGTH / 2 - 480), 9);
      for (let k = 0; k < 3; k++) {
        addMark(20, 2.4, side * (RUNWAY_LENGTH / 2 - (300 + k * 160)), -14);
        addMark(20, 2.4, side * (RUNWAY_LENGTH / 2 - (300 + k * 160)), 14);
      }
    }
    const numberMatA = new THREE.MeshStandardMaterial({
      map: runwayNumberTexture('14'),
      transparent: true,
      roughness: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5,
    });
    const numberMatB = new THREE.MeshStandardMaterial({
      map: runwayNumberTexture('32'),
      transparent: true,
      roughness: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5,
    });
    const thresholdA = new THREE.Mesh(new THREE.PlaneGeometry(24, 34), numberMatA);
    thresholdA.rotation.x = -Math.PI / 2;
    thresholdA.rotation.z = Math.PI / 2;
    thresholdA.position.set(-RUNWAY_LENGTH / 2 + 135, 0.15, 0);
    group.add(thresholdA);
    const thresholdB = new THREE.Mesh(new THREE.PlaneGeometry(24, 34), numberMatB);
    thresholdB.rotation.x = -Math.PI / 2;
    thresholdB.rotation.z = -Math.PI / 2;
    thresholdB.position.set(RUNWAY_LENGTH / 2 - 135, 0.15, 0);
    group.add(thresholdB);

    // Taxi guidance: a yellow line along the parallel taxiway, plus lead-ins
    // from both hangars to the ramp.
    for (let u = -1350; u <= 1350; u += 80) addMark(50, 0.55, u, 120, 0.14, yellowMat);
    addMark(0.65, 150, -200, 190, 0.14, yellowMat);
    addMark(0.65, 150, 900, 190, 0.14, yellowMat);
    for (const u of [-800, -714]) {
      addMark(0.65, 120, u, 840, 0.14, yellowMat);
      addMark(18, 0.65, u, 790, 0.14, yellowMat);
    }

    // Parking stand boxes on the ramp.
    for (let i = 0; i < 6; i++) {
      const u = -980 + i * 75;
      addMark(0.5, 54, u - 14, 700, 0.14, markingMat);
      addMark(0.5, 54, u + 14, 700, 0.14, markingMat);
      addMark(28, 0.5, u, 673, 0.14, markingMat);
    }

    // Painted ramp name.
    const rampName = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 38),
      new THREE.MeshStandardMaterial({
        map: signTexture('SCOTT AFB', { bg: 'rgba(0,0,0,0)', fg: 'rgba(228,224,210,0.8)', accent: 'rgba(0,0,0,0)', size: 150 }),
        transparent: true,
        roughness: 0.8,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      })
    );
    rampName.rotation.x = -Math.PI / 2;
    rampName.rotation.z = -Math.PI / 2;
    rampName.position.set(-620, 0.16, 520);
    group.add(rampName);

    // --- The two white barrel-vault hangars --------------------------------
    // The reference hangars are wide and shallow, not half-cylinders: a 76 m
    // span with an 18.5 m arch reads as the Scott AMC shelters. Their fronts
    // are closed facades with a tall door, which is what stops the bay from
    // looking like a black tunnel from the ramp.
    const hangarWidth = 76;
    const hangarDepth = 84;
    const wallHeight = 7;
    const archHeight = 18.5;
    const radius = hangarWidth / 2;
    const archRatio = archHeight / radius;
    const doorHalf = 26;
    const doorHeight = 15.5;
    const shape = new THREE.Shape();
    shape.moveTo(-radius, 0);
    shape.lineTo(-radius, wallHeight);
    shape.absellipse(0, wallHeight, radius, archHeight, Math.PI, 0, true);
    shape.lineTo(radius, 0);
    shape.lineTo(-radius, 0);
    const hangarGeo = new THREE.ExtrudeGeometry(shape, {
      depth: hangarDepth,
      bevelEnabled: false,
      curveSegments: 32,
    });
    hangarGeo.translate(0, 0, -hangarDepth / 2);
    const shellGeo = openFrontCap(hangarGeo, hangarDepth / 2);

    const hangarWhite = new THREE.MeshStandardMaterial({
      color: 0xe8e4d7,
      roughness: 0.7,
      metalness: 0.06,
      side: THREE.DoubleSide,
      envMapIntensity: 0.5,
    });
    const hangarTrim = new THREE.MeshStandardMaterial({
      color: 0xc5c1b4,
      roughness: 0.62,
      metalness: 0.18,
    });
    const interiorMat = new THREE.MeshStandardMaterial({
      color: 0x4d4d47,
      roughness: 0.9,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });
    const floorTex = concrete.clone();
    floorTex.repeat.set(8, 8);
    floorTex.needsUpdate = true;
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      color: 0x9b968c,
      roughness: 0.98,
      metalness: 0.0,
    });
    const backShape = new THREE.Shape();
    backShape.moveTo(-radius + 0.4, 0.1);
    backShape.lineTo(-radius + 0.4, wallHeight);
    backShape.absellipse(0, wallHeight, radius - 0.4, archHeight - 0.2, Math.PI, 0, true);
    backShape.lineTo(radius - 0.4, 0.1);
    backShape.lineTo(-radius + 0.4, 0.1);
    const backGeo = new THREE.ShapeGeometry(backShape, 32);
    const ribGeo = new THREE.TorusGeometry(radius + 0.08, 0.16, 4, 40, Math.PI);
    const frontTrimGeo = new THREE.TorusGeometry(radius + 0.16, 0.38, 5, 40, Math.PI);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });

    // The front wall is the full gable silhouette with a real hangar-door
    // opening cut out of it. Without it, the shell is an open half-tube and
    // the bay reads as a black cave from every angle.
    const facadeShape = new THREE.Shape();
    facadeShape.moveTo(-radius, 0);
    facadeShape.lineTo(-radius, wallHeight);
    facadeShape.absellipse(0, wallHeight, radius, archHeight, Math.PI, 0, true);
    facadeShape.lineTo(radius, 0);
    facadeShape.lineTo(-radius, 0);
    const doorHole = new THREE.Path();
    doorHole.moveTo(-doorHalf, 0.1);
    doorHole.lineTo(doorHalf, 0.1);
    doorHole.lineTo(doorHalf, doorHeight);
    doorHole.lineTo(-doorHalf, doorHeight);
    doorHole.lineTo(-doorHalf, 0.1);
    facadeShape.holes.push(doorHole);
    const facadeGeo = new THREE.ShapeGeometry(facadeShape, 32);
    const doorPostGeo = new THREE.BoxGeometry(1.4, doorHeight, 0.9);
    const doorHeaderGeo = new THREE.BoxGeometry(doorHalf * 2 + 2.8, 1.3, 1.0);
    const facadeRibGeo = new THREE.BoxGeometry(0.28, 8.2, 0.38);

    const buildHangar = (u, number) => {
      const centerV = HANGAR_BAY_V;
      const frontV = centerV - hangarDepth / 2;
      const hangar = new THREE.Mesh(shellGeo, hangarWhite);
      hangar.position.set(u, 0, centerV);
      hangar.castShadow = true;
      hangar.receiveShadow = true;
      group.add(hangar);

      const back = new THREE.Mesh(backGeo, interiorMat);
      back.position.set(u, 0, centerV + hangarDepth / 2 - 0.15);
      back.receiveShadow = true;
      group.add(back);

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(hangarWidth - 2, hangarDepth - 2), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(u, 0.075, centerV);
      floor.receiveShadow = true;
      group.add(floor);

      const facade = new THREE.Mesh(facadeGeo, hangarWhite);
      facade.position.set(u, 0, frontV + 0.05);
      facade.rotation.y = Math.PI;
      facade.castShadow = true;
      facade.receiveShadow = true;
      group.add(facade);

      // Door frame, header and corrugation on the flat front.
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(doorPostGeo, hangarTrim);
        post.position.set(u + side * doorHalf, doorHeight / 2, frontV - 0.25);
        post.castShadow = true;
        group.add(post);
        for (let i = 0; i < 3; i++) {
          const rib = new THREE.Mesh(facadeRibGeo, hangarTrim);
          rib.position.set(u + side * (doorHalf + 3.2 + i * 3.4), 4.1, frontV - 0.28);
          group.add(rib);
        }
      }
      const header = new THREE.Mesh(doorHeaderGeo, hangarTrim);
      header.position.set(u, doorHeight + 0.65, frontV - 0.25);
      header.castShadow = true;
      group.add(header);

      // The external ribs are the strongest visual cue that these are the
      // corrugated AMC hangars from the reference rather than plain tubes.
      for (let i = -4; i <= 4; i++) {
        const rib = new THREE.Mesh(ribGeo, hangarTrim);
        rib.position.set(u, wallHeight, centerV + i * 10);
        rib.scale.y = archRatio;
        group.add(rib);
      }
      const frontTrim = new THREE.Mesh(frontTrimGeo, hangarTrim);
      frontTrim.position.set(u, wallHeight, frontV - 0.2);
      frontTrim.scale.y = archRatio;
      group.add(frontTrim);

      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 3.2),
        new THREE.MeshStandardMaterial({
          map: signTexture(`SCOTT ${number}`, { bg: '#20262a', fg: '#f1ead8', accent: '#b9a15a', size: 88 }),
          roughness: 0.7,
          side: THREE.DoubleSide,
        })
      );
      sign.position.set(u, doorHeight + 3.4, frontV - 0.4);
      sign.rotation.y = Math.PI;
      group.add(sign);

      // Ceiling strips down the bay and a warm fill light so aircraft and
      // equipment inside are legible from the ramp, not silhouettes in a void.
      for (let i = -3; i <= 3; i++) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(18, 0.14, 0.9), lightMat);
        strip.position.set(u, wallHeight + archHeight - 4.2, centerV + i * 10);
        group.add(strip);
      }
      const bayFill = new THREE.PointLight(0xffe3b8, 1000, 120, 1.6);
      bayFill.position.set(u, 14, centerV);
      group.add(bayFill);
    };
    buildHangar(-800, '1');
    buildHangar(-714, '2');

    // --- Tower, operations and fuel farm -----------------------------------
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.78, metalness: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3b4246, roughness: 0.6, metalness: 0.25 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x263c46, roughness: 0.14, metalness: 0.55 });

    const tower = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(8, 24, 8), wallMat);
    shaft.position.y = 12;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    tower.add(shaft);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(13, 5.2, 13), glassMat);
    cab.position.y = 26.6;
    cab.castShadow = true;
    tower.add(cab);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 14), darkMat);
    cabRoof.position.y = 29.4;
    tower.add(cabRoof);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 9), darkMat);
    antenna.position.y = 34;
    tower.add(antenna);
    const beaconBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x5a1512, toneMapped: false })
    );
    beaconBulb.position.y = 30.1;
    tower.add(beaconBulb);
    this.nightMaterials.push({
      material: beaconBulb.material,
      base: new THREE.Color(0.35, 0.04, 0.03),
      color: new THREE.Color(3.0, 0.2, 0.12),
    });
    tower.position.set(-130, 0, 900);
    group.add(tower);

    const ops = new THREE.Group();
    const opsBody = new THREE.Mesh(new THREE.BoxGeometry(72, 11, 26), wallMat);
    opsBody.position.y = 5.5;
    opsBody.castShadow = true;
    opsBody.receiveShadow = true;
    ops.add(opsBody);
    const opsRoof = new THREE.Mesh(new THREE.BoxGeometry(74, 0.8, 28), darkMat);
    opsRoof.position.y = 11.4;
    ops.add(opsRoof);
    for (let i = -2; i <= 2; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.6), glassMat);
      win.position.set(i * 12, 6.4, 13.1);
      ops.add(win);
    }
    const opsSign = new THREE.Mesh(
      new THREE.PlaneGeometry(33, 5.4),
      new THREE.MeshStandardMaterial({
        map: signTexture('SCOTT AFB', { bg: '#1b2226', fg: '#f1ead8', accent: '#b9a15a', size: 86 }),
        roughness: 0.7,
      })
    );
    opsSign.position.set(0, 3.5, 13.15);
    ops.add(opsSign);
    ops.position.set(-360, 0, 1010);
    group.add(ops);

    // Fuel farm beyond the ramp.
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xe4e1d7, roughness: 0.55, metalness: 0.2 });
    for (let i = 0; i < 3; i++) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 11, 20), tankMat);
      tank.position.set(-1190 + i * 18, 5.5, 690);
      tank.castShadow = true;
      tank.receiveShadow = true;
      group.add(tank);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(6.7, 6.7, 0.5, 20), darkMat);
      cap.position.set(-1190 + i * 18, 11.25, 690);
      group.add(cap);
    }

    // --- Parking lot and cars ----------------------------------------------
    const carColors = [0x2f4c72, 0x8b8e92, 0x7a2c28, 0x2f3b37, 0xd8d5ca];
    for (let i = 0; i < 18; i++) {
      const row = i % 2;
      const col = Math.floor(i / 2);
      const u = -1090 + col * 17 + (row ? 6 : 0);
      const v = 905 + row * 55;
      const mat = new THREE.MeshStandardMaterial({ color: carColors[i % carColors.length], roughness: 0.45, metalness: 0.3 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.25, 1.85), mat);
      body.position.set(u, 0.8, v);
      body.castShadow = true;
      group.add(body);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.72, 1.65), mat);
      cabin.position.set(u - 0.2, 1.72, v);
      cabin.castShadow = true;
      group.add(cabin);
      for (const dx of [-1.3, 1.3]) {
        for (const dz of [-0.78, 0.78]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 10), darkMat);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(u + dx, 0.34, v + dz);
          group.add(wheel);
        }
      }
    }
    // Parking bay stripes.
    for (let i = 0; i <= 10; i++) {
      addMark(0.35, 46, -1098 + i * 17, 932, 0.14, markingMat);
    }

    // --- Apron lamps --------------------------------------------------------
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x5f563d, toneMapped: false });
    this.nightMaterials.push({
      material: lampMat,
      base: new THREE.Color(0.3, 0.27, 0.2),
      color: new THREE.Color(4.2, 3.0, 1.45),
    });
    for (let i = 0; i < 6; i++) {
      const u = -1000 + i * 170;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 18, 7), darkMat);
      pole.position.set(u, 9, 930);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 1.0), lampMat);
      head.position.set(u, 18, 927.2);
      group.add(head);
    }

    // Runway edge lights. Instanced and dark by day, warm by night.
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x564e39, toneMapped: false });
    this.nightMaterials.push({
      material: edgeMat,
      base: new THREE.Color(0.34, 0.3, 0.2),
      color: new THREE.Color(3.4, 2.5, 1.2),
    });
    const edgeGeo = new THREE.SphereGeometry(0.32, 6, 5);
    const edgePositions = [];
    for (let u = -RUNWAY_LENGTH / 2; u <= RUNWAY_LENGTH / 2; u += 55) {
      edgePositions.push([u, -RUNWAY_WIDTH / 2 - 2.5]);
      edgePositions.push([u, RUNWAY_WIDTH / 2 + 2.5]);
    }
    const edgeLights = new THREE.InstancedMesh(edgeGeo, edgeMat, edgePositions.length);
    const dummy = new THREE.Object3D();
    edgePositions.forEach(([u, v], index) => {
      dummy.position.set(u, 0.35, v);
      dummy.updateMatrix();
      edgeLights.setMatrixAt(index, dummy.matrix);
    });
    edgeLights.instanceMatrix.needsUpdate = true;
    group.add(edgeLights);

    // A simple white boundary fence along the public side of the field.
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xb7b7ae, roughness: 0.8, metalness: 0.2 });
    for (let u = -1350; u <= 1350; u += 24) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4, 5), fenceMat);
      post.position.set(u, 1.2, 1055);
      group.add(post);
    }
    addMark(2700, 0.12, 0, 1055, 2.2, new THREE.MeshBasicMaterial({ color: 0x8f9089 }));
  }

  // -------------------------------------------------------------------------
  // Desert vegetation and rocks
  // -------------------------------------------------------------------------
  buildDesert() {
    const rng = mulberry32(87021);
    const creosote = makeCreosoteGeometry();
    const yucca = makeYuccaGeometry();
    const joshua = makeJoshuaGeometry();
    const pinyon = makePinyonGeometry();
    const plantMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0.0,
      envMapIntensity: 0.3,
    });

    const sets = { creosote: [], yucca: [], joshua: [], pinyon: [] };
    const maxPlants = 34000;
    let count = 0;
    let attempts = 0;

    while (count < maxPlants && attempts < 140000) {
      attempts++;
      const radius = Math.sqrt(rng()) * 30000;
      const angle = rng() * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (inAirfield(x, z, 180)) continue;
      if (Math.hypot(x + 13000, z + 14000) < 5200) continue;

      const h = terrainHeight(x, z);
      if (h < 535 || h > 2480) continue;
      const slope = terrainSlope(x, z);
      if (slope > 0.52) continue;

      const moisture = valueNoise(x * 0.0013 + 4.2, z * 0.0013 - 1.3) * 0.65 +
        valueNoise(x * 0.0051 - 7.1, z * 0.0051 + 3.8) * 0.35;
      let accept;
      let species;
      if (h < 1230) {
        accept = 0.16 + Math.max(0, moisture - 0.48) * 0.85;
        const pick = rng();
        species = pick < 0.68 ? 'creosote' : pick < 0.9 ? 'yucca' : 'joshua';
      } else if (h < 2260) {
        accept = 0.12 + Math.max(0, moisture - 0.44) * 0.8;
        const pick = rng();
        species = pick < 0.72 ? 'pinyon' : pick < 0.9 ? 'creosote' : 'joshua';
      } else {
        accept = 0.025;
        species = 'pinyon';
      }
      if (rng() > accept) continue;

      const tall = species === 'joshua' || species === 'pinyon';
      sets[species].push({
        x,
        y: h - 0.15,
        z,
        rot: rng() * Math.PI * 2,
        size: tall ? randRange(rng, 1.4, 3.1) : randRange(rng, 0.7, 1.8),
        width: randRange(rng, 0.8, 1.25),
        hue: 0.18 + rng() * 0.08,
        sat: 0.12 + rng() * 0.16,
        light: 0.24 + rng() * 0.12,
      });
      count++;
    }

    for (const [species, entries] of Object.entries(sets)) {
      if (!entries.length) continue;
      const geo = { creosote, yucca, joshua, pinyon }[species];
      createInstancedChunks(this.group, geo, entries, plantMat, false, this.vegetation);
    }
    this.treeCount = count;

    // Weathered boulders on the fans and lower slopes.
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f6252, roughness: 0.95, metalness: 0 });
    const rocks = [];
    for (let i = 0; i < 4200; i++) {
      const radius = Math.sqrt(rng()) * 26000;
      const angle = rng() * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (radius < 4000) continue;
      const h = terrainHeight(x, z);
      if (h < 540 || h > 2400) continue;
      const slope = terrainSlope(x, z);
      if (slope < 0.08 && rng() > 0.15) continue;
      rocks.push({
        x,
        y: h + 0.1,
        z,
        rot: rng() * Math.PI * 2,
        size: randRange(rng, 0.4, 3.2),
        width: randRange(rng, 0.7, 1.5),
        hue: 0.09,
        sat: 0.06,
        light: 0.25 + rng() * 0.1,
      });
    }
    if (rocks.length) createInstancedChunks(this.group, rockGeo, rocks, rockMat, false, this.vegetation);
  }

  /** Scale the desert planting to the frame budget (1 = full density). */
  setVegetationDensity(factor) {
    for (const entry of this.vegetation) {
      entry.mesh.count = Math.max(1, Math.floor(entry.full * factor));
    }
  }

  // -------------------------------------------------------------------------
  // Nellis AFB
  // -------------------------------------------------------------------------
  buildAirfield() {
    const group = new THREE.Group();
    group.name = 'nellis-afb';
    group.position.y = AF_Y;
    group.rotation.y = RWY_ROT;
    this.group.add(group);
    this.airfield = group;

    const asphalt = asphaltTexture().clone();
    asphalt.needsUpdate = true;
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
    asphalt.repeat.set(90, 2);
    const runwayMat = new THREE.MeshStandardMaterial({
      map: asphalt,
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0.0,
      // Grazing-angle Fresnel on a huge flat surface picked up the baked sun
      // in the env map and smeared a white beam down the runway.
      envMapIntensity: 0.06,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const concrete = concreteTexture().clone();
    concrete.needsUpdate = true;
    concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
    concrete.repeat.set(46, 18);
    const concreteMat = new THREE.MeshStandardMaterial({
      map: concrete,
      color: 0xd6d0c2,
      roughness: 0.97,
      metalness: 0.0,
      envMapIntensity: 0.06,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const addPlane = (w, d, mat, x, z, y = 0.06, rotZ = 0) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = rotZ;
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    addPlane(RUNWAY_LENGTH, RUNWAY_WIDTH, runwayMat, 0, 0, 0.06);
    addPlane(SECOND_LEN, RUNWAY_WIDTH, runwayMat, 0, SECOND_Z, 0.06);

    const taxiMat = runwayMat.clone();
    taxiMat.map = asphalt.clone();
    taxiMat.map.repeat.set(80, 1.4);
    taxiMat.map.needsUpdate = true;
    addPlane(RUNWAY_LENGTH - 180, 23, taxiMat, 0, 125, 0.045);
    addPlane(SECOND_LEN - 150, 23, taxiMat, 0, -535, 0.045);
    for (const x of [-1180, -620, 0, 620, 1180]) {
      addPlane(23, 125, taxiMat, x, 62, 0.044);
      addPlane(23, 115, taxiMat, x, -592, 0.044);
    }

    // Main ramp and the Thunderbirds apron.
    addPlane(1900, 620, concreteMat, 0, 610, 0.04);
    addPlane(1250, 560, concreteMat, -560, 1080, 0.042);
    addPlane(620, 340, concreteMat, -1240, 980, 0.041);
    addPlane(260, 720, concreteMat, 1090, 650, 0.041);
    addPlane(1900, 24, taxiMat, 0, 300, 0.05);
    addPlane(34, 440, taxiMat, -260, 860, 0.049);
    for (const x of [-820, -260, 300, 860]) addPlane(24, 300, taxiMat, x, 430, 0.049);
    for (const x of [-980, -620, -260, 100, 460]) addPlane(28, 230, taxiMat, x, 940, 0.048);

    const markingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x1c1a16,
      emissiveIntensity: 0.03,
      // Paint is chalky; a glossy stripe throws a huge specular streak down the
      // runway that bloom turns into a white beam.
      roughness: 0.98,
      metalness: 0.0,
      envMapIntensity: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const yellowMat = new THREE.MeshStandardMaterial({
      color: 0xc9a54b,
      roughness: 0.97,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const addMark = (w, d, x, z, y = 0.13, mat = markingMat, rotZ = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rotZ;
      m.position.set(x, y, z);
      m.receiveShadow = true;
      group.add(m);
      return m;
    };

    const buildRunwayMarkings = (length, z, labelA, labelB) => {
      addMark(length - 20, 0.9, 0, z - RUNWAY_WIDTH / 2 + 2.4);
      addMark(length - 20, 0.9, 0, z + RUNWAY_WIDTH / 2 - 2.4);
      for (let x = -length / 2 + 110; x <= length / 2 - 110; x += 60) {
        addMark(26, 1.15, x, z);
      }
      for (const side of [-1, 1]) {
        for (let i = 0; i < 8; i++) {
          addMark(24, 2.0, side * (length / 2 - 40), z - 19.5 + i * 5.6);
        }
        addMark(46, 6.2, side * (length / 2 - 480), z - 9);
        addMark(46, 6.2, side * (length / 2 - 480), z + 9);
        for (let k = 0; k < 3; k++) {
          const dist = 300 + k * 160;
          addMark(20, 2.4, side * (length / 2 - dist), z - 14);
          addMark(20, 2.4, side * (length / 2 - dist), z + 14);
        }
      }
      const numA = new THREE.MeshStandardMaterial({
        map: runwayNumberTexture(labelA),
        transparent: true,
        roughness: 0.7,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      });
      const numB = new THREE.MeshStandardMaterial({
        map: runwayNumberTexture(labelB),
        transparent: true,
        roughness: 0.7,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      });
      const a = new THREE.Mesh(new THREE.PlaneGeometry(24, 34), numA);
      a.rotation.x = -Math.PI / 2;
      a.rotation.z = Math.PI / 2;
      a.position.set(-length / 2 + 135, 0.15, z);
      group.add(a);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(24, 34), numB);
      b.rotation.x = -Math.PI / 2;
      b.rotation.z = -Math.PI / 2;
      b.position.set(length / 2 - 135, 0.15, z);
      group.add(b);
    };
    buildRunwayMarkings(RUNWAY_LENGTH, 0, '03L', '21R');
    buildRunwayMarkings(SECOND_LEN, SECOND_Z, '03R', '21L');

    // Taxi guidance and parking leads.
    for (let x = -1300; x <= 1300; x += 80) {
      addMark(50, 0.55, x, 125, 0.14, yellowMat);
      addMark(50, 0.55, x, -535, 0.14, yellowMat);
      addMark(40, 0.55, x, 300, 0.14, yellowMat);
    }
    for (const x of [-820, -620, -420, -220, -20, 180, 380, 580, 780]) {
      addMark(0.65, 160, x, 470, 0.14, yellowMat);
      addMark(18, 0.65, x, 440, 0.14, yellowMat);
    }

    // Approach lighting off the 03 thresholds. These are dark fixtures by day
    // (white slabs here used to bloom into a beam right under the camera).
    const approachMat = new THREE.MeshStandardMaterial({
      color: 0x413f38,
      roughness: 0.9,
      metalness: 0.2,
    });
    for (const [z, len] of [[0, RUNWAY_LENGTH], [SECOND_Z, SECOND_LEN]]) {
      for (let i = 0; i < 16; i++) {
        addMark(0.9, 2.2, -len / 2 - 30 - i * 30, z, 0.3, approachMat);
      }
      for (let i = 0; i < 4; i++) {
        addMark(1.3, 0.7, len / 2 + 28, z + 34 + i * 2.4, 1.1, approachMat);
      }
    }

    // Painted ramp name.
    const rampName = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 34),
      new THREE.MeshStandardMaterial({
        map: signTexture('NELLIS', { bg: 'rgba(0,0,0,0)', fg: 'rgba(225,222,210,0.8)', accent: 'rgba(0,0,0,0)', size: 170 }),
        transparent: true,
        roughness: 0.8,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      })
    );
    rampName.rotation.x = -Math.PI / 2;
    rampName.rotation.z = -Math.PI / 2;
    rampName.position.set(-520, 0.16, 660);
    group.add(rampName);

    // --- Lighting hardware -------------------------------------------------
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x5f563d });
    this.nightMaterials.push({
      material: edgeMat,
      color: new THREE.Color(3.2, 2.35, 1.2),
      base: new THREE.Color(0.35, 0.3, 0.2),
    });
    const edgeGeo = new THREE.SphereGeometry(0.34, 7, 5);
    const edgePositions = [];
    for (let x = -RUNWAY_LENGTH / 2; x <= RUNWAY_LENGTH / 2; x += 55) {
      edgePositions.push([x, -RUNWAY_WIDTH / 2 - 2.5]);
      edgePositions.push([x, RUNWAY_WIDTH / 2 + 2.5]);
      edgePositions.push([x, SECOND_Z - RUNWAY_WIDTH / 2 - 2.5]);
      edgePositions.push([x, SECOND_Z + RUNWAY_WIDTH / 2 + 2.5]);
    }
    const edgeLights = new THREE.InstancedMesh(edgeGeo, edgeMat, edgePositions.length);
    const dummy = new THREE.Object3D();
    edgePositions.forEach(([x, z], i) => {
      dummy.position.set(x, 0.55, z);
      dummy.updateMatrix();
      edgeLights.setMatrixAt(i, dummy.matrix);
    });
    edgeLights.instanceMatrix.needsUpdate = true;
    group.add(edgeLights);

    const thresholdGreen = new THREE.MeshBasicMaterial({ color: 0x1b3a20 });
    this.nightMaterials.push({
      material: thresholdGreen,
      color: new THREE.Color(0.2, 2.6, 0.55),
      base: new THREE.Color(0.1, 0.25, 0.12),
    });
    const thresholdRed = new THREE.MeshBasicMaterial({ color: 0x3a1b1b });
    this.nightMaterials.push({
      material: thresholdRed,
      color: new THREE.Color(2.8, 0.25, 0.2),
      base: new THREE.Color(0.25, 0.1, 0.1),
    });
    const thresholdGeo = new THREE.SphereGeometry(0.4, 7, 5);
    for (const [z, len] of [[0, RUNWAY_LENGTH], [SECOND_Z, SECOND_LEN]]) {
      for (const side of [-1, 1]) {
        const mat = side < 0 ? thresholdGreen : thresholdRed;
        const mesh = new THREE.InstancedMesh(thresholdGeo, mat, 9);
        for (let i = 0; i < 9; i++) {
          dummy.position.set(side * (len / 2 + 3), 0.55, z - 22 + i * 5.5);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
    }

    const taxiMatLight = new THREE.MeshBasicMaterial({ color: 0x1a2740 });
    this.nightMaterials.push({
      material: taxiMatLight,
      color: new THREE.Color(0.25, 0.55, 2.8),
      base: new THREE.Color(0.12, 0.16, 0.3),
    });
    const taxiGeo = new THREE.SphereGeometry(0.24, 6, 4);
    const taxiLights = new THREE.InstancedMesh(taxiGeo, taxiMatLight, 100);
    let lightIndex = 0;
    for (let x = -1200; x <= 1200 && lightIndex < 100; x += 60) {
      dummy.position.set(x, 0.45, 125);
      dummy.updateMatrix();
      taxiLights.setMatrixAt(lightIndex++, dummy.matrix);
    }
    taxiLights.count = lightIndex;
    taxiLights.instanceMatrix.needsUpdate = true;
    group.add(taxiLights);

    // Windsock, flood masts and the tower beacon.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc0, roughness: 0.5, metalness: 0.6 });
    const sockMat = new THREE.MeshStandardMaterial({ color: 0xd97524, roughness: 0.8, side: THREE.DoubleSide });
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, 4, 10, 1, true), sockMat);
    sock.rotation.z = Math.PI / 2;
    sock.position.set(890, 5.6, 170);
    group.add(sock);
    const sockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 6, 8), poleMat);
    sockPole.position.set(890, 3, 172);
    group.add(sockPole);

    const lampGlow = glowTexture('rgba(255,225,170,0.9)', 'rgba(255,180,90,0)');
    for (let i = 0; i < 5; i++) {
      const x = -1000 + i * 470;
      const z = 330;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 18, 8), poleMat);
      mast.position.set(x, 9, z);
      group.add(mast);
      const lamp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: lampGlow,
          color: 0xffe0a8,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        })
      );
      lamp.scale.setScalar(14);
      lamp.position.set(x, 18, z);
      group.add(lamp);
      this.nightMaterials.push({
        sprite: lamp.material,
        base: new THREE.Color(0, 0, 0),
        color: new THREE.Color(1.2, 0.95, 0.6),
      });
      const light = new THREE.PointLight(0xffd7a0, 0, 340, 1.8);
      light.position.set(x, 16, z);
      group.add(light);
      this.pointLights.push(light);
    }

    // --- Hangars, shelters and base buildings ------------------------------
    // A little self-illumination stands in for sky bounce on the shaded faces:
    // without it every shed and hangar side that turns away from the sun reads
    // as a black box.
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x9a9487,
      roughness: 0.72,
      metalness: 0.18,
      emissive: 0x14171a,
      emissiveIntensity: 0.6,
      // The extruded shell is single-sided; without this the inside of every
      // bay is invisible from the apron and the hangar reads as a black hole.
      side: THREE.DoubleSide,
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x6d6f6c, roughness: 0.55, metalness: 0.5 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x565b5d, roughness: 0.6, metalness: 0.45 });
    // The extruded back cap faces outward, so the bays need an interior back
    // wall of their own to keep the view through the doors from passing
    // straight through the building.
    const interiorMat = new THREE.MeshStandardMaterial({
      color: 0x2b2f31,
      roughness: 0.9,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    const interiorFloorMat = new THREE.MeshStandardMaterial({ color: 0x77766f, roughness: 0.95, metalness: 0.0 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc9a54b, roughness: 0.6 });

    const hangarShape = new THREE.Shape();
    hangarShape.moveTo(-28, 0);
    hangarShape.lineTo(-28, 7);
    hangarShape.absarc(0, 7, 28, Math.PI, 0, true);
    hangarShape.lineTo(28, 0);
    hangarShape.lineTo(-28, 0);
    const hangarGeo = new THREE.ExtrudeGeometry(hangarShape, {
      depth: 54,
      bevelEnabled: false,
      curveSegments: 20,
    });
    hangarGeo.translate(0, 0, -27);

    // The far cap faces outward, so build an arch-shaped wall for the inside
    // instead of a rectangle: a 56x34 plane pokes its corners through the
    // curved roof and was visible as a black slab from the apron.
    const backShape = new THREE.Shape();
    backShape.moveTo(-27.7, 0.1);
    backShape.lineTo(-27.7, 7);
    backShape.absarc(0, 7, 27.7, Math.PI, 0, true);
    backShape.lineTo(27.7, 0.1);
    backShape.lineTo(-27.7, 0.1);
    const backGeo = new THREE.ShapeGeometry(backShape, 20);

    // ExtrudeGeometry caps both ends. Drop the -Z cap so every bay has a real
    // doorway — walls, arched roof and back wall stay, the entrance is open and
    // the aircraft inside is visible (and can taxi straight out).
    const hangarShell = (() => {
      const src = hangarGeo.index ? hangarGeo.toNonIndexed() : hangarGeo;
      const pos = src.attributes.position;
      const kept = [];
      for (let i = 0; i < pos.count; i += 3) {
        if (
          pos.getZ(i) < -26.9 &&
          pos.getZ(i + 1) < -26.9 &&
          pos.getZ(i + 2) < -26.9
        ) {
          continue;
        }
        for (let k = 0; k < 3; k++) {
          kept.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
      geo.computeVertexNormals();
      return geo;
    })();

    for (let i = 0; i < 5; i++) {
      const bayU = -780 + i * 120;
      const hangar = new THREE.Mesh(hangarShell, wallMat);
      hangar.position.set(bayU, 0, 980);
      hangar.castShadow = true;
      hangar.receiveShadow = true;
      group.add(hangar);
      if (i === 0) {
        // The active bay needs its own fill light: the arched shell blocks the
        // sun, and the showcase/start aircraft sits deep inside it.
        const bayFill = new THREE.PointLight(0xffe3b8, 900, 120, 1.4);
        bayFill.position.set(bayU, 15, 974);
        group.add(bayFill);
      }
      const backWall = new THREE.Mesh(backGeo, interiorMat);
      backWall.position.set(bayU, 0, 1006.2);
      backWall.receiveShadow = true;
      group.add(backWall);
      const hangarFloor = new THREE.Mesh(new THREE.PlaneGeometry(54, 53), interiorFloorMat);
      hangarFloor.rotation.x = -Math.PI / 2;
      hangarFloor.position.set(bayU, 0.075, 980);
      hangarFloor.receiveShadow = true;
      group.add(hangarFloor);
      // Roll-up doors are lifted open for the five visible aircraft bays.
      const door = new THREE.Mesh(new THREE.PlaneGeometry(46, 1.1), doorMat);
      door.position.set(-780 + i * 120, 20.5, 950.65);
      group.add(door);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(46, 0.9), stripeMat);
      stripe.position.set(-780 + i * 120, 19.9, 950.6);
      group.add(stripe);
      for (const dx of [-15, 0, 15]) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 4), roofMat);
        vent.position.set(-780 + i * 120 + dx, 33, 980);
        group.add(vent);
      }
      const bayLight = new THREE.Mesh(
        new THREE.BoxGeometry(22, 0.12, 1.1),
        new THREE.MeshBasicMaterial({ color: 0xffdfab, toneMapped: false })
      );
      bayLight.position.set(-780 + i * 120, 30.1, 980);
      group.add(bayLight);
      const rearLight = new THREE.Mesh(
        new THREE.BoxGeometry(16, 0.1, 0.8),
        new THREE.MeshBasicMaterial({ color: 0xffdfab, toneMapped: false })
      );
      rearLight.position.set(-780 + i * 120, 27.8, 1004);
      group.add(rearLight);
      const number = new THREE.Mesh(
        new THREE.PlaneGeometry(7, 5),
        new THREE.MeshStandardMaterial({
          map: signTexture(`0${i + 1}`, { bg: '#1b1e20', fg: '#e8e3d5', accent: '#1b1e20', size: 160 }),
          roughness: 0.7,
        })
      );
      number.position.set(-780 + i * 120, 26.5, 951.6);
      group.add(number);
    }

    // Maintenance sheds and a store behind the hangar line.
    const shedMat = new THREE.MeshStandardMaterial({ color: 0x8f8b80, roughness: 0.8, metalness: 0.15 });
    const shedRoof = new THREE.MeshStandardMaterial({ color: 0x5b5d5b, roughness: 0.65, metalness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const shed = new THREE.Mesh(new THREE.BoxGeometry(54, 9, 26), shedMat);
      shed.position.set(-900 + i * 78, 4.5, 1250);
      shed.castShadow = true;
      shed.receiveShadow = true;
      group.add(shed);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(56, 0.8, 28), shedRoof);
      roof.position.set(-900 + i * 78, 9.4, 1250);
      group.add(roof);
      const bay = new THREE.Mesh(new THREE.PlaneGeometry(10, 6.5), doorMat);
      bay.position.set(-900 + i * 78, 3.25, 1236.9);
      group.add(bay);
    }

    const warehouse = new THREE.Mesh(new THREE.BoxGeometry(110, 14, 46), shedMat);
    warehouse.position.set(560, 7, 1040);
    warehouse.castShadow = true;
    warehouse.receiveShadow = true;
    group.add(warehouse);
    const warehouseRoof = new THREE.Mesh(new THREE.BoxGeometry(112, 1, 48), shedRoof);
    warehouseRoof.position.set(560, 14.4, 1040);
    group.add(warehouseRoof);
    const warehouseBay = new THREE.Mesh(new THREE.PlaneGeometry(22, 9), doorMat);
    warehouseBay.position.set(560, 4.5, 1016.9);
    group.add(warehouseBay);

    // Thunderbirds hangar: a bigger blue-roofed bay with the team name.
    const tbShape = new THREE.Shape();
    tbShape.moveTo(-34, 0);
    tbShape.lineTo(-34, 7);
    tbShape.absarc(0, 7, 34, Math.PI, 0, true);
    tbShape.lineTo(34, 0);
    tbShape.lineTo(-34, 0);
    const tbGeo = new THREE.ExtrudeGeometry(tbShape, { depth: 58, bevelEnabled: false, curveSegments: 20 });
    tbGeo.translate(0, 0, -29);
    const tb = new THREE.Mesh(tbGeo, new THREE.MeshStandardMaterial({ color: 0xd8d5cb, roughness: 0.65, metalness: 0.2 }));
    tb.position.set(-1240, 0, 940);
    tb.castShadow = true;
    tb.receiveShadow = true;
    group.add(tb);
    const tbDoor = new THREE.Mesh(
      new THREE.PlaneGeometry(52, 22),
      new THREE.MeshStandardMaterial({ color: 0x273b63, roughness: 0.55, metalness: 0.35 })
    );
    tbDoor.position.set(-1240, 11, 910);
    group.add(tbDoor);
    const tbSign = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 8),
      new THREE.MeshStandardMaterial({
        map: signTexture('THUNDERBIRDS', { bg: '#17233d', fg: '#f2efe4', accent: '#b43a3a', size: 92 }),
        roughness: 0.6,
        metalness: 0.1,
      })
    );
    tbSign.position.set(-1240, 26, 909);
    group.add(tbSign);
    const tbStripe = new THREE.Mesh(
      new THREE.PlaneGeometry(52, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xb43a3a, roughness: 0.6 })
    );
    tbStripe.position.set(-1240, 20, 909.4);
    group.add(tbStripe);

    // Sun shelters over the fighter ramp.
    const shelterRoof = new THREE.MeshStandardMaterial({
      color: 0xa8a79c,
      roughness: 0.82,
      metalness: 0.25,
    });
    const shelterDark = new THREE.MeshStandardMaterial({
      color: 0x565a56,
      roughness: 0.9,
    });
    const shelterPositions = [];
    for (let i = 0; i < 12; i++) shelterPositions.push(-820 + i * 68);
    for (const rowZ of [470, 650]) {
      for (const x of shelterPositions) {
        const shelter = new THREE.Group();
        const roof = new THREE.Mesh(new THREE.BoxGeometry(30, 1.1, 20), shelterRoof);
        roof.position.y = 8.2;
        roof.rotation.z = 0.04;
        roof.castShadow = true;
        shelter.add(roof);
        const lip = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 1.2), shelterRoof);
        lip.position.set(0, 7.5, -10);
        shelter.add(lip);
        const back = new THREE.Mesh(new THREE.BoxGeometry(29, 7.6, 0.5), shelterDark);
        back.position.set(0, 3.8, 9.5);
        shelter.add(back);
        for (const dx of [-13, 13]) {
          for (const dz of [-8, 8]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 8, 0.55), shelterDark);
            post.position.set(dx, 4, dz);
            shelter.add(post);
          }
        }
        shelter.position.set(x, 0, rowZ);
        group.add(shelter);
      }
    }

    // Operations building and control tower.
    const ops = new THREE.Mesh(new THREE.BoxGeometry(86, 14, 34), wallMat);
    ops.position.set(50, 7, 1120);
    ops.castShadow = true;
    ops.receiveShadow = true;
    group.add(ops);
    const opsGlass = new THREE.Mesh(
      new THREE.BoxGeometry(82, 5, 0.6),
      new THREE.MeshPhysicalMaterial({
        color: 0x7da3b0,
        roughness: 0.08,
        metalness: 0.25,
        transparent: true,
        opacity: 0.78,
        envMapIntensity: 1.4,
      })
    );
    opsGlass.position.set(50, 7.5, 1103);
    group.add(opsGlass);

    const tower = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 4.2, 40, 12),
      new THREE.MeshStandardMaterial({ color: 0xc0b9aa, roughness: 0.75 })
    );
    shaft.position.y = 20;
    shaft.castShadow = true;
    tower.add(shaft);
    const cab = new THREE.Mesh(
      new THREE.CylinderGeometry(6.2, 6.2, 4.4, 14, 1),
      new THREE.MeshPhysicalMaterial({
        color: 0x638a99,
        roughness: 0.08,
        metalness: 0.3,
        transparent: true,
        opacity: 0.82,
        envMapIntensity: 1.5,
      })
    );
    cab.position.y = 42;
    tower.add(cab);
    const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 6.8, 0.8, 14), roofMat);
    cabRoof.position.y = 44.5;
    tower.add(cabRoof);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 11, 6), poleMat);
    antenna.position.y = 50;
    tower.add(antenna);
    tower.position.set(330, 0, 1030);
    group.add(tower);

    this.beaconPivot = new THREE.Group();
    this.beaconPivot.position.set(330, 50, 1030);
    const beaconCone = new THREE.Mesh(
      new THREE.ConeGeometry(18, 420, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff0c4,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      })
    );
    beaconCone.rotation.z = Math.PI / 2;
    beaconCone.position.x = 210;
    this.beaconPivot.add(beaconCone);
    this.beaconMat = beaconCone.material;
    group.add(this.beaconPivot);

    // Radar head.
    const radarBase = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 12, 10), wallMat);
    radarBase.position.set(720, 6, 1260);
    group.add(radarBase);
    const radome = new THREE.Mesh(
      new THREE.SphereGeometry(9, 24, 14),
      new THREE.MeshStandardMaterial({ color: 0xe2e0d6, roughness: 0.8, metalness: 0.05 })
    );
    radome.position.set(720, 17, 1260);
    radome.castShadow = true;
    group.add(radome);

    // Fuel farm with berms.
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xc4c2b8, roughness: 0.55, metalness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 15, 20), tankMat);
      tank.position.set(-1390 + i * 30, 7.5, 760);
      tank.castShadow = true;
      tank.receiveShadow = true;
      group.add(tank);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(10, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), tankMat);
      cap.position.set(-1390 + i * 30, 15, 760);
      group.add(cap);
    }
    const bermMat = new THREE.MeshStandardMaterial({ color: 0x9c8a6d, roughness: 0.97 });
    for (const x of [-1420, -1340]) {
      const berm = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 34), bermMat);
      berm.position.set(x, 1.1, 760);
      group.add(berm);
    }

    // Base entrance sign.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 13),
      new THREE.MeshStandardMaterial({
        map: signTexture('NELLIS AIR FORCE BASE', { bg: '#1b2024', fg: '#efeada', accent: '#b9a15a', size: 74 }),
        roughness: 0.55,
        metalness: 0.15,
      })
    );
    sign.position.set(1240, 8, 820);
    sign.rotation.y = -Math.PI / 2;
    group.add(sign);
    for (const dz of [-28, 28]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), poleMat);
      post.position.set(1240, 4.5, 820 + dz);
      group.add(post);
    }

    // Fire station on the west side of the ramp.
    addPlane(90, 64, concreteMat, -1550, 620, 0.043);
    const fireStation = new THREE.Mesh(
      new THREE.BoxGeometry(52, 12, 26),
      new THREE.MeshStandardMaterial({ color: 0xb7b0a2, roughness: 0.75, metalness: 0.12 })
    );
    fireStation.position.set(-1550, 6, 650);
    fireStation.castShadow = true;
    fireStation.receiveShadow = true;
    group.add(fireStation);
    const fireRoof = new THREE.Mesh(
      new THREE.BoxGeometry(54, 1, 28),
      new THREE.MeshStandardMaterial({ color: 0x6d6f6c, roughness: 0.55, metalness: 0.5 })
    );
    fireRoof.position.set(-1550, 12.4, 650);
    group.add(fireRoof);
    for (let i = 0; i < 3; i++) {
      const bay = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 8),
        new THREE.MeshStandardMaterial({ color: 0xa8322a, roughness: 0.5, metalness: 0.25 })
      );
      bay.position.set(-1572 + i * 22, 4, 636.9);
      group.add(bay);
    }
    const fireSign = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 4),
      new THREE.MeshStandardMaterial({
        map: signTexture('FIRE', { bg: '#7c1d18', fg: '#f4efe4', accent: '#d9c6a2', size: 150 }),
        roughness: 0.6,
      })
    );
    fireSign.position.set(-1550, 10, 636.7);
    group.add(fireSign);

    // Ramp parking leads.
    for (let x = -840; x <= 840; x += 80) {
      addMark(0.65, 30, x, 555, 0.14, yellowMat);
      addMark(26, 0.65, x, 540, 0.14, yellowMat);
    }

    // Fire trucks and ground equipment.
    const redMat = new THREE.MeshStandardMaterial({ color: 0xa52a24, roughness: 0.45, metalness: 0.3 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.55, metalness: 0.2 });
    for (let i = 0; i < 3; i++) {
      const truck = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(9, 3.2, 3.2), redMat);
      body.position.y = 2.2;
      truck.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 3.1), whiteMat);
      cab.position.set(3.5, 2.6, 0);
      truck.add(cab);
      for (const dx of [-2.8, 2.8]) {
        for (const dz of [-1.4, 1.4]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }));
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(dx, 0.65, dz);
          truck.add(wheel);
        }
      }
      truck.position.set(-1180 + i * 16, 0, 880);
      group.add(truck);
    }

    this.buildRampClutter(group, markingMat, glowTexture);
  }

  /**
   * Ground equipment and apron wear around the showcase spot. Real ramps are
   * crowded: carts, bowsers, cones, chocks, ladders and oil stains. This is
   * what stops the airfield reading as an empty grey plane.
   */
  buildRampClutter(group, markingMat, glowTex) {
    const tyre = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
    const olive = new THREE.MeshStandardMaterial({ color: 0x5c6048, roughness: 0.72, metalness: 0.18 });
    const oliveDark = new THREE.MeshStandardMaterial({ color: 0x3e4236, roughness: 0.8, metalness: 0.2 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a1, roughness: 0.55, metalness: 0.6 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xc9a13f, roughness: 0.65, metalness: 0.2 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xc25a20, roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x2b3a40, roughness: 0.12, metalness: 0.4 });
    const whitePaint = new THREE.MeshStandardMaterial({ color: 0xe6e3d8, roughness: 0.7 });

    const wheel = (r = 0.38, w = 0.26) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 12), tyre);
      m.rotation.x = Math.PI / 2;
      m.castShadow = true;
      return m;
    };

    const place = (obj, u, v, rot = 0, y = 0) => {
      obj.position.set(u, y, v);
      obj.rotation.y = rot;
      group.add(obj);
      return obj;
    };

    // --- Tow tractor -------------------------------------------------------
    const tractor = new THREE.Group();
    const tBody = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.15, 2.1), yellow);
    tBody.position.y = 0.95;
    tBody.castShadow = true;
    tractor.add(tBody);
    const tCab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.9), yellow);
    tCab.position.set(-0.7, 2.0, 0);
    tCab.castShadow = true;
    tractor.add(tCab);
    const tGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 1.55), glass);
    tGlass.position.set(0.06, 2.15, 0);
    tractor.add(tGlass);
    const tBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), orange);
    tBeacon.position.set(-0.7, 2.85, 0);
    tractor.add(tBeacon);
    for (const dx of [-1.2, 1.2]) for (const dz of [-0.85, 0.85]) {
      const w = wheel(0.46, 0.34);
      w.position.set(dx, 0.46, dz);
      tractor.add(w);
    }
    place(tractor, -42, 648, 0.5);

    // --- Fuel bowser -------------------------------------------------------
    const bowser = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 6.2, 16), whitePaint);
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0, 1.9, 0);
    tank.castShadow = true;
    bowser.add(tank);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 2.3), oliveDark);
    chassis.position.y = 0.95;
    bowser.add(chassis);
    const bCab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.7, 2.2), whitePaint);
    bCab.position.set(3.9, 1.75, 0);
    bCab.castShadow = true;
    bowser.add(bCab);
    const bGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 1.8), glass);
    bGlass.position.set(4.86, 2.05, 0);
    bowser.add(bGlass);
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 6, 14), oliveDark);
    hose.position.set(-2.6, 1.8, 1.05);
    hose.rotation.y = Math.PI / 2;
    bowser.add(hose);
    for (const dx of [-2.4, 1.9, 3.7]) for (const dz of [-1.05, 1.05]) {
      const w = wheel(0.5, 0.4);
      w.position.set(dx, 0.5, dz);
      bowser.add(w);
    }
    place(bowser, 92, 655, -0.35);

    // --- AGE carts ---------------------------------------------------------
    for (let i = 0; i < 5; i++) {
      const cart = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 1.5), olive);
      body.position.y = 0.95;
      body.castShadow = true;
      cart.add(body);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 1.6), oliveDark);
      lid.position.y = 1.48;
      cart.add(lid);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 6), steel);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(-1.3, 1.0, 0);
      cart.add(handle);
      for (const dx of [-0.8, 0.8]) for (const dz of [-0.6, 0.6]) {
        const w = wheel(0.26, 0.2);
        w.position.set(dx, 0.26, dz);
        cart.add(w);
      }
      place(cart, 44 + i * 3.3, 566 - (i % 2) * 1.6, 0.06 * i);
    }

    // --- Ground power unit / light cart -----------------------------------
    const gpu = new THREE.Group();
    const gpuBody = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.15, 1.5), oliveDark);
    gpuBody.position.y = 0.95;
    gpuBody.castShadow = true;
    gpu.add(gpuBody);
    const gpuGrill = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.05), steel);
    gpuGrill.position.set(0, 1.0, 0.78);
    gpu.add(gpuGrill);
    for (const dz of [-0.55, 0.55]) {
      const w = wheel(0.3, 0.22);
      w.position.set(0, 0.3, dz);
      gpu.add(w);
    }
    place(gpu, -22, 588, 0.2);

    // --- Boarding ladder ---------------------------------------------------
    const ladder = new THREE.Group();
    for (const dz of [-0.42, 0.42]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 0.1), steel);
      rail.position.set(2.3, 1.9, dz);
      rail.rotation.z = 0.42;
      ladder.add(rail);
    }
    for (let i = 0; i < 7; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.9), steel);
      step.position.set(0.5 + i * 0.58, 0.32 + i * 0.27, 0);
      ladder.add(step);
    }
    place(ladder, 62, 610, 1.1);

    // --- Cones in a taxi line ---------------------------------------------
    const coneGeo = new THREE.ConeGeometry(0.24, 0.72, 8);
    for (let i = 0; i < 9; i++) {
      const cone = new THREE.Mesh(coneGeo, orange);
      cone.position.set(-96 + i * 11, 0.36, 612 + Math.sin(i * 0.7) * 1.4);
      cone.castShadow = true;
      group.add(cone);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.185, 0.12, 8), whitePaint);
      band.position.set(cone.position.x, 0.4, cone.position.z);
      group.add(band);
    }

    // --- Wheel chocks and tie-downs around the showcase ------------------
    for (const [u, v, r] of [[-6, 596, 0.4], [10, 596, -0.6], [-6, 624, 1.2], [10, 624, 0.2]]) {
      const chock = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.26, 0.34), yellow);
      chock.position.set(u, 0.14, v);
      chock.rotation.y = r;
      chock.castShadow = true;
      group.add(chock);
    }

    // --- Apron wear: oil stains, tyre rubber and expansion-joint dirt -----
    const stainTex = glowTex('rgba(26,22,17,0.62)', 'rgba(26,22,17,0)');
    const stainMat = new THREE.MeshStandardMaterial({
      map: stainTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    const rng = mulberry32(6113);
    for (let i = 0; i < 22; i++) {
      const u = -120 + rng() * 260;
      const v = 540 + rng() * 150;
      const stain = new THREE.Mesh(new THREE.PlaneGeometry(8 + rng() * 16, 6 + rng() * 10), stainMat);
      stain.rotation.x = -Math.PI / 2;
      stain.rotation.z = rng() * Math.PI;
      stain.position.set(u, 0.115, v);
      stain.renderOrder = 2;
      group.add(stain);
    }
    // Rubber laid down at the touchdown zones.
    for (const z of [0, SECOND_Z]) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const mark = new THREE.Mesh(
            new THREE.PlaneGeometry(70 - i * 6, 1.1 + rng() * 1.2),
            stainMat
          );
          mark.rotation.x = -Math.PI / 2;
          mark.position.set(side * (RUNWAY_LENGTH / 2 - 460 - i * 20), 0.118, z + (side * 14) / 2);
          mark.renderOrder = 2;
          group.add(mark);
        }
      }
    }
  }

  /** Park Raptors in hangar 2 and on the ramp outside the active bay. */
  addParkedAircraft() {
    const template = importedModelInfo('f22');
    if (!template || !this.airfield) return;
    const spots = [
      { u: -714, v: HANGAR_BAY_V, rot: Math.PI },
      { u: -560, v: 760, rot: Math.PI + 0.3 },
      { u: -410, v: 760, rot: Math.PI + 0.22 },
      { u: -270, v: 760, rot: Math.PI - 0.18 },
      { u: -130, v: 760, rot: Math.PI + 0.12 },
    ];
    for (const spot of spots) {
      const jet = cloneSkinned(template.group);
      // Hangar floors are slabs 8 cm above the terrain; ramp parking stands are
      // painted concrete a few centimetres up. Sitting the tyres on the slab
      // instead of inside it is the difference between parked and sunken.
      jet.position.set(spot.u, (template.parts.groundContactOffset ?? 1.14) + 0.08, spot.v);
      jet.rotation.y = spot.rot;
      jet.name = 'parked-f22';
      jet.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      this.airfield.add(jet);
    }
  }

  // -------------------------------------------------------------------------
  // Nellis solar farm
  // -------------------------------------------------------------------------
  buildSolarFarm() {
    const group = new THREE.Group();
    group.name = 'solar-farm';
    this.group.add(group);
    const tex = solarPanelTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    const panelMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0x8ea9bd,
      roughness: 0.32,
      metalness: 0.45,
      side: THREE.DoubleSide,
      envMapIntensity: 0.8,
    });
    const panelGeo = new THREE.PlaneGeometry(9, 4.4);
    const rows = 26;
    const cols = 34;
    const panels = new THREE.InstancedMesh(panelGeo, panelMat, rows * cols);
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -5200 + c * 12;
        const z = 1800 + r * 10;
        const y = terrainHeight(x, z) + 1.1;
        dummy.position.set(x, y, z);
        dummy.rotation.set(-0.42, 0, 0);
        dummy.updateMatrix();
        panels.setMatrixAt(i++, dummy.matrix);
      }
    }
    panels.instanceMatrix.needsUpdate = true;
    group.add(panels);

    const service = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 16),
      new THREE.MeshStandardMaterial({ color: 0x4c4a44, roughness: 0.95 })
    );
    service.rotation.x = -Math.PI / 2;
    service.position.set(-5200 + (cols * 12) / 2, terrainHeight(-4950, 2000) + 0.08, 2000);
    group.add(service);
  }

  // -------------------------------------------------------------------------
  // Las Vegas
  // -------------------------------------------------------------------------
  buildVegas() {
    const group = new THREE.Group();
    group.name = 'las-vegas';
    this.group.add(group);
    this.cityGroup = group;
    this.cityMaterials = [];
    this.cityLights = null;

    const variants = [facadeTextures(0), facadeTextures(1)];
    const materials = variants.map((tex) => {
      tex.emissive.repeat.set(1, 1);
      const mat = new THREE.MeshStandardMaterial({
        map: tex.map,
        emissiveMap: tex.emissive,
        emissive: new THREE.Color(0xffc27a),
        emissiveIntensity: 0,
        roughness: 0.8,
        metalness: 0.1,
      });
      this.cityMaterials.push(mat);
      return mat;
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x4b4d4e, roughness: 0.85 });
    const rng = mulberry32(44117);
    const geos = [[], []];
    const roofs = [];

    const towers = [
      { x: -12700, z: -13700, w: 40, d: 40, h: 210 },
      { x: -12100, z: -14200, w: 34, d: 34, h: 170 },
      { x: -13400, z: -13100, w: 30, d: 30, h: 150 },
      { x: -14100, z: -14600, w: 46, d: 42, h: 120 },
      { x: -11200, z: -13000, w: 28, d: 28, h: 130 },
    ];
    for (let i = 0; i < 130; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * 6200;
      const x = -13000 + Math.cos(angle) * radius;
      const z = -14000 + Math.sin(angle) * radius * 0.72;
      const ground = terrainHeight(x, z);
      const w = 14 + rng() * 26;
      const d = 14 + rng() * 24;
      const h = 10 + Math.pow(rng(), 2.1) * 70;
      const variant = rng() > 0.5 ? 0 : 1;
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(x, ground + h / 2 - 0.6, z);
      geos[variant].push(geo);
      const roof = new THREE.BoxGeometry(w + 0.5, 0.8, d + 0.5);
      roof.translate(x, ground + h - 0.2, z);
      roofs.push(roof);
    }
    for (const t of towers) {
      const ground = terrainHeight(t.x, t.z);
      const geo = new THREE.BoxGeometry(t.w, t.h, t.d);
      geo.translate(t.x, ground + t.h / 2, t.z);
      geos[0].push(geo);
      const roof = new THREE.BoxGeometry(t.w + 1, 1.2, t.d + 1);
      roof.translate(t.x, ground + t.h, t.z);
      roofs.push(roof);
    }
    for (let i = 0; i < 2; i++) {
      if (!geos[i].length) continue;
      const merged = mergeGeometries(geos[i], false);
      const mesh = new THREE.Mesh(merged, materials[i]);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    if (roofs.length) {
      const roofMesh = new THREE.Mesh(mergeGeometries(roofs, false), roofMat);
      group.add(roofMesh);
    }

    // Luxor-like pyramid and the Stratosphere-like tower are unmistakable
    // silhouettes even at 13 km.
    const pyramid = new THREE.Mesh(
      new THREE.ConeGeometry(180, 150, 4),
      new THREE.MeshStandardMaterial({
        color: 0x6d5a2e,
        emissive: 0x3a2a10,
        emissiveIntensity: 0.15,
        roughness: 0.35,
        metalness: 0.55,
        envMapIntensity: 1.0,
      })
    );
    pyramid.position.set(-15100, terrainHeight(-15100, -15200) + 75, -15200);
    pyramid.rotation.y = Math.PI / 4;
    group.add(pyramid);

    const stratGround = terrainHeight(-11200, -12100);
    const strat = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 11, 250, 12),
      new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.45, metalness: 0.55 })
    );
    shaft.position.y = 125;
    strat.add(shaft);
    const pod = new THREE.Mesh(
      new THREE.CylinderGeometry(17, 13, 12, 14),
      new THREE.MeshStandardMaterial({
        color: 0xb5a468,
        roughness: 0.25,
        metalness: 0.6,
        emissive: 0x221a08,
        emissiveIntensity: 0.2,
      })
    );
    pod.position.y = 238;
    strat.add(pod);
    const needle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 1.2, 42, 8),
      new THREE.MeshStandardMaterial({ color: 0xcfd3d5, roughness: 0.4, metalness: 0.7 })
    );
    needle.position.y = 264;
    strat.add(needle);
    strat.position.set(-11200, stratGround, -12100);
    group.add(strat);

    // Warm sodium glow over the valley at night.
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,210,140,0.9)', 'rgba(255,150,60,0)'),
      color: 0xffbc78,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    const cityGlow = new THREE.Sprite(glowMat);
    cityGlow.scale.set(15000, 4200, 1);
    cityGlow.position.set(-13000, terrainHeight(-13000, -14000) + 500, -14000);
    group.add(cityGlow);
    this.cityGlow = glowMat;

    // Point lights for the Strip. These are cheap sprites, not real lights.
    const count = 260;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * 5400;
      const x = -13000 + Math.cos(angle) * radius;
      const z = -14000 + Math.sin(angle) * radius * 0.72;
      positions[i * 3] = x;
      positions[i * 3 + 1] = terrainHeight(x, z) + 8 + rng() * 130;
      positions[i * 3 + 2] = z;
      color.setHSL(0.07 + rng() * 0.08, 0.7, 0.65 + rng() * 0.3);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.cityLightMaterial = new THREE.PointsMaterial({
      size: 30,
      map: glowTexture('rgba(255,255,255,0.95)', 'rgba(255,220,160,0)'),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
      fog: false,
    });
    this.cityLights = new THREE.Points(geo, this.cityLightMaterial);
    group.add(this.cityLights);
  }

  /**
   * Weld static geometry into one buffer per material.
   *
   * The airfield is built from ~1100 small meshes: one per wall, post, cone,
   * cart or prop. That is cheap in triangles (under 200k) but each mesh costs a
   * draw call, and a draw call is ~40us of driver time on an integrated GPU.
   * Across the main pass, the shadow pass and the GTAO depth pass that was the
   * single most expensive thing in the frame.
   *
   * Only opaque, non-instanced, non-animated meshes are merged, so the rotating
   * beacon, decals, glass and the parked Raptors keep their own draw calls.
   */
  bakeStatics() {
    this.group.updateMatrixWorld(true);
    const skip = new Set();
    if (this.beaconPivot) this.beaconPivot.traverse((o) => skip.add(o));

    const shared = new Map();
    this.group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        shared.set(obj.geometry.uuid, (shared.get(obj.geometry.uuid) || 0) + 1);
      }
    });

    const buckets = new Map();
    this.group.traverse((obj) => {
      if (!obj.isMesh || obj.isInstancedMesh || obj.isSkinnedMesh) return;
      if (skip.has(obj) || obj.userData.dynamic) return;
      if (Array.isArray(obj.material) || !obj.material || obj.material.transparent) return;
      if (obj.geometry.morphAttributes && Object.keys(obj.geometry.morphAttributes).length) return;
      const key = [
        obj.material.uuid,
        obj.castShadow ? 1 : 0,
        obj.receiveShadow ? 1 : 0,
        obj.renderOrder,
        Object.keys(obj.geometry.attributes).sort().join(','),
      ].join('|');
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          material: obj.material,
          meshes: [],
          castShadow: obj.castShadow,
          receiveShadow: obj.receiveShadow,
          renderOrder: obj.renderOrder,
        };
        buckets.set(key, bucket);
      }
      bucket.meshes.push(obj);
    });

    let merged = 0;
    for (const bucket of buckets.values()) {
      if (bucket.meshes.length < 2) continue;
      const parts = [];
      for (const mesh of bucket.meshes) {
        const src = mesh.geometry;
        const geo = src.index ? src.toNonIndexed() : src.clone();
        geo.clearGroups();
        geo.applyMatrix4(mesh.matrixWorld);
        parts.push(geo);
      }
      const geometry = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!geometry) continue;

      const owned = [];
      for (const mesh of bucket.meshes) {
        if (shared.get(mesh.geometry.uuid) === 1) owned.push(mesh.geometry);
        mesh.parent?.remove(mesh);
      }
      for (const geo of owned) geo.dispose();

      const mesh = new THREE.Mesh(geometry, bucket.material);
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = bucket.receiveShadow;
      mesh.renderOrder = bucket.renderOrder;
      // The merged buffer spans the whole field, so per-object culling is moot.
      mesh.frustumCulled = false;
      this.group.add(mesh);
      merged++;
    }
    return merged;
  }

  // -------------------------------------------------------------------------
  // Clouds
  // -------------------------------------------------------------------------
  buildClouds() {
    // Billboard cumulus were superseded by the HDR cloud deck in SkySystem.
  }

  update(dt, { sunColor, nightFactor, sunDir, camera }) {
    for (const entry of this.nightMaterials) {
      if (entry.material) {
        entry.material.color.copy(entry.base).lerp(entry.color, nightFactor);
      } else if (entry.sprite) {
        entry.sprite.opacity = 0.7 * nightFactor;
        entry.sprite.color.copy(entry.color);
      }
    }
    for (const light of this.pointLights) {
      light.intensity = nightFactor * 520;
    }
    for (const mat of this.cityMaterials) {
      mat.emissiveIntensity = nightFactor * 2.1 + 0.01;
    }
    if (this.cityLightMaterial) this.cityLightMaterial.opacity = nightFactor * 0.9;
    if (this.cityGlow) this.cityGlow.opacity = nightFactor * 0.16;
    if (this.beaconPivot) {
      this.beaconPivot.rotation.y += dt * 0.7;
      this.beaconMat.opacity = nightFactor * 0.05;
    }

    const cloudTint = new THREE.Color(0xd2d6d8).lerp(new THREE.Color(0xf4f2ea), 0.35);
    if (sunDir) {
      const warm = smoothstep(0.28, 0.02, sunDir.y) * (1 - nightFactor);
      cloudTint.lerp(new THREE.Color(0xffb98a), warm * 0.7);
    }
    cloudTint.lerp(new THREE.Color(0x0c1420), nightFactor * 0.9);
    const baseOpacityFactor = 1 - nightFactor * 0.55;
    for (const sprite of this.cloudSprites) {
      sprite.position.x += dt * 2.2;
      sprite.position.z += dt * 0.8;
      if (sprite.position.x > 58000) sprite.position.x -= 116000;
      if (sprite.position.z > 58000) sprite.position.z -= 116000;
      sprite.material.color.copy(cloudTint);
      if (!sprite.userData.baseOpacity) sprite.userData.baseOpacity = sprite.material.opacity;
      sprite.material.opacity = sprite.userData.baseOpacity * baseOpacityFactor;
    }
  }
}
