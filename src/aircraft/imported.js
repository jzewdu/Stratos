import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { navLight, landingLightGroup } from './parts.js';
import { glowTexture, propBlurTexture } from '../world/textures.js';

/**
 * Imported airframes.
 *
 * The three GLBs are Sketchfab models with wildly different orientations,
 * scales and extra props. Each one is normalised here once at boot: nose +Z,
 * metres, origin at the wing centre and the wheels on y = -groundClearance.
 * The flight model still owns all motion; this module only supplies the
 * visual shell and the handful of moving parts the sim can drive.
 */

// Built from Vite's base so the GLBs resolve both at the site root and under
// the /<repo>/ subpath GitHub Pages serves the game from.
const MODELS = `${import.meta.env.BASE_URL}models/`;

const CONFIG = {
  // Cessna 182T Skylane, CAP livery. Nose is -Z in the source file.
  cessna170: {
    url: `${MODELS}cessna182.glb`,
    rotateY: Math.PI,
    fit: 'span',
    target: 11.0,
    groundClearance: 1.31,
    remove: [],
    fixedGear: true,
  },
  // B-2A Spirit. Source is span-along-Z, nose +X.
  b2: {
    url: `${MODELS}b2.glb`,
    rotateY: -Math.PI / 2,
    fit: 'span',
    target: 52.4,
    groundClearance: 3.11,
    remove: [],
    fixedGear: false,
    gearUp: ['B_2_landingOff_2'],
    gearDown: ['LGFront_3', 'LG_RightBack_4', 'LG_LeftBack_5', 'B_2LandingOn_6'],
  },
  // F-22A Raptor, nose already +Z. The Sketchfab scene ships with a boarding
  // ladder beside the jet (Circle_47) and its undercarriage baked in the
  // retracted pose, so the gear below is built to match the airframe.
  f22: {
    url: `${MODELS}f22.glb`,
    rotateY: 0,
    fit: 'length',
    target: 18.92,
    groundClearance: 1.14,
    bellyOrigin: true,
    remove: ['Circle_47'],
    fixedGear: false,
    gearUp: [],
    gearDown: [],
  },
};

const templates = new Map();
const glow = () => glowTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');

function findNode(root, name) {
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.name === name) found = obj;
  });
  return found;
}

function forEachMaterial(root, fn) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) if (mat) fn(mat, obj);
  });
}

function tuneMaterials(root, id, maxAniso) {
  forEachMaterial(root, (mat, mesh) => {
    mat.envMapIntensity = 1.05;
    for (const key of [
      'map',
      'normalMap',
      'roughnessMap',
      'metalnessMap',
      'aoMap',
      'emissiveMap',
      'alphaMap',
    ]) {
      if (mat[key]) {
        mat[key].anisotropy = maxAniso;
        mat[key].needsUpdate = true;
      }
    }
    if (mat.transparent) {
      mat.depthWrite = false;
      mat.side = THREE.DoubleSide;
      mesh.castShadow = false;
    }
  });

  // Keep the imported paint reading as aircraft skin rather than chrome. The
  // Sketchfab exports carry metalness = 1 with a roughness map, which turns the
  // airframe into a dark mirror under an ACES sky.
  if (id === 'f22') {
    forEachMaterial(root, (mat) => {
      const name = mat.name || '';
      if (/^(Glass)$/i.test(name)) {
        mat.metalness = 0.35;
        mat.roughness = 0.06;
        mat.color.setHex(0x2b2417);
        mat.envMapIntensity = 1.6;
        mat.transparent = true;
        mat.opacity = 0.55;
        return;
      }
      if (/^Tyre$/i.test(name)) {
        mat.metalness = 0;
        mat.roughness = 0.94;
        mat.metalnessMap = null;
        mat.roughnessMap = null;
        mat.color.setHex(0x171819);
        return;
      }
      if (/^White_disk$/i.test(name)) {
        mat.color.setHex(0x242729);
        mat.metalness = 0.12;
        mat.roughness = 0.88;
        mat.metalnessMap = null;
        mat.roughnessMap = null;
        return;
      }
      if (/^(Material\.010|Material\.011|Material\.012|Black\.001)$/i.test(name)) return;
      // Suppress the source model's small high-contrast wheel-side details.
      if (/^Black$/i.test(name)) {
        mat.color.setHex(0x232729);
        mat.roughness = 0.86;
        mat.metalness = 0.12;
        mat.metalnessMap = null;
        mat.roughnessMap = null;
        return;
      }
      // Everything else is airframe skin, gear or store hardware.
      mat.metalnessMap = null;
      mat.metalness = 0.16;
      mat.roughness = Math.max(mat.roughness ?? 0.6, 0.52);
      mat.envMapIntensity = 0.95;
      if (/^(Body|Body_1|Body\.001|Body_cabin|Tail|Gray|Gray_nose|material|material_11|Material\.009)$/i.test(name)) {
        mat.color.setHex(0xd4dade);
      }
    });
  } else if (id === 'b2') {
    forEachMaterial(root, (mat) => {
      if (/B_2_airframe/i.test(mat.name || '')) {
        mat.metalness = 0.24;
        mat.roughness = 0.52;
        mat.color.setHex(0x9aa1a5);
        mat.envMapIntensity = 1.1;
      }
      if (/B_2_canopy/i.test(mat.name || '')) {
        mat.opacity = 0.62;
        mat.roughness = 0.08;
        mat.metalness = 0.2;
      }
    });
  }
}

/**
 * One additive layer of an afterburner plume.
 *
 * The geometry is translated so its origin sits on the nozzle plane and it
 * extends aft (-Z after the rotation), which lets the render loop lengthen the
 * flame by scaling Y without dragging the base away from the exhaust.
 */
function makeFlame(color, radius, length, opacityScale, name = 'ab-plume') {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const geometry = new THREE.CylinderGeometry(radius * 0.55, radius, length, 20, 1, true);
  geometry.translate(0, length / 2, 0);
  const flame = new THREE.Mesh(geometry, material);
  flame.rotation.x = -Math.PI / 2;
  flame.name = name;
  flame.visible = false;
  flame.frustumCulled = false;
  flame.userData.opacityScale = opacityScale;
  return flame;
}

/**
 * Two-stage afterburner for the Raptor's F119 nozzles: a broad orange outer
 * plume around a hot blue-white core, a nozzle glow and the shock diamonds
 * that appear in the exhaust at high pressure ratios.
 */
function addAfterburners(group, { y, z, spread }, parts) {
  const plumes = [];
  const cores = [];
  const glows = [];
  const shockCells = [];
  const nozzleZ = z - 0.18;

  for (const side of [-1, 1]) {
    const px = side * spread;

    const outer = makeFlame(0xff5d20, 0.33, 3.3, 0.5, 'ab-plume');
    outer.position.set(px, y, nozzleZ);
    group.add(outer);
    plumes.push(outer);

    const inner = makeFlame(0xffb066, 0.21, 2.1, 0.62, 'ab-plume');
    inner.position.set(px, y, nozzleZ);
    group.add(inner);
    plumes.push(inner);

    const core = makeFlame(0xd8e8ff, 0.12, 1.15, 0.9, 'ab-core');
    core.position.set(px, y, nozzleZ);
    group.add(core);
    cores.push(core);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,236,205,0.55)', 'rgba(255,110,30,0)'),
        color: 0xffb877,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      })
    );
    glow.name = 'ab-glow';
    glow.scale.set(1.15, 0.62, 1);
    glow.position.set(px, y, nozzleZ + 0.05);
    group.add(glow);
    glows.push(glow);

    // Shock diamonds: evenly spaced bright rings inside the near plume.
    for (let n = 0; n < 3; n++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.15 - n * 0.022, 0.011, 4, 22),
        new THREE.MeshBasicMaterial({
          color: 0xcfe0ff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      );
      ring.name = 'ab-ring';
      ring.position.set(px, y, nozzleZ - (0.42 + n * 0.34));
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      ring.userData.opacityScale = 0.22 - n * 0.04;
      group.add(ring);
      shockCells.push(ring);
    }
  }
  parts.afterburners = plumes;
  parts.abCores = cores;
  parts.abGlows = glows;
  parts.abShockCells = shockCells;
}

function strutBetween(a, b, r1, r2, material) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r2, r1, delta.length(), 14),
    material
  );
  mesh.position.copy(start).addScaledVector(delta, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  return mesh;
}

function gearWheel(radius, width) {
  const wheel = new THREE.Group();
  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.92,
    metalness: 0.02,
  });
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0x6d7378,
    roughness: 0.5,
    metalness: 0.6,
  });

  // A solid cylinder, not a torus: from the side a tire is a black disc, and
  // the old torus left a hole straight through the middle of the wheel.
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 20),
    tyreMat
  );
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  wheel.add(tyre);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, width + 0.008, 16),
    hubMat
  );
  hub.rotation.z = Math.PI / 2;
  wheel.add(hub);

  return wheel;
}

/**
 * The new Raptor mesh is baked gear-up. This builds a matching undercarriage
 * so the jet stands correctly on the ramp and taxiways.
 */
function buildF22Gear(size, stance) {
  const gear = new THREE.Group();
  gear.name = 'f22-undercarriage';
  const metal = new THREE.MeshStandardMaterial({
    color: 0x777e83,
    roughness: 0.52,
    metalness: 0.55,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x7d848a,
    roughness: 0.62,
    metalness: 0.25,
    side: THREE.DoubleSide,
  });
  // Keep the tires understated at sim scale; the old oversized hubs looked like ornaments.
  const wheelR = 0.30;
  const noseR = 0.22;
  const mainY = -stance + wheelR;
  const noseY = -stance + noseR;
  const mainZ = -size.z * 0.045;
  const wheelZ = mainZ + 0.55;
  const noseWheelZ = size.z * 0.3 - 0.35;
  const mainX = size.x * 0.128;

  for (const side of [-1, 1]) {
    const x = side * mainX;
    // A clean oleo and plain tire keep the gear legible at game scale.
    gear.add(strutBetween([x, -0.02, mainZ], [x, mainY + wheelR * 0.55, mainZ], 0.075, 0.055, metal));
    const wheel = gearWheel(wheelR, 0.14);
    wheel.position.set(x + side * 0.13, mainY, wheelZ);
    gear.add(wheel);
    // Restrained flat bay door, kept tucked against the airframe.
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.24, 0.66), doorMat);
    door.position.set(x + side * 0.16, -stance + 0.22, mainZ + 0.04);
    door.rotation.z = side * 0.12;
    gear.add(door);
  }

  // One modest nose strut/tire, with no layered wheel-face decoration.
  gear.add(strutBetween([0, -0.03, noseWheelZ], [0, noseY + noseR * 0.5, noseWheelZ], 0.06, 0.045, metal));
  const noseWheel = gearWheel(noseR, 0.12);
  noseWheel.position.set(0, noseY, noseWheelZ);
  gear.add(noseWheel);
  const noseDoor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.58), doorMat);
  noseDoor.position.set(0, -stance + 0.24, noseWheelZ + 0.62);
  noseDoor.rotation.x = -0.24;
  gear.add(noseDoor);

  // Place tire bottoms on the ground plane in hangar and runway starts.
  gear.userData.contactOffset = stance;
  gear.userData.mainWheelContactOffset = stance - wheelR;
  gear.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return gear;
}

function addNavLights(group, id, size, bottom) {
  const nav = {};
  const halfX = size.x * 0.5;
  const wingY = bottom + size.y * (id === 'cessna170' ? 0.66 : 0.5);
  const wingZ = id === 'b2' ? size.z * 0.02 : -size.z * 0.03;
  const glowSize = id === 'b2' ? 1.15 : id === 'f22' ? 0.75 : 0.55;

  const left = navLight(0xff2b2b, id === 'b2' ? 0.12 : 0.07, glow(), glowSize);
  left.position.set(-halfX * 0.985, wingY, wingZ);
  group.add(left);
  nav.left = left;

  const right = navLight(0x35ff6a, id === 'b2' ? 0.12 : 0.07, glow(), glowSize);
  right.position.set(halfX * 0.985, wingY, wingZ);
  group.add(right);
  nav.right = right;

  const tail = navLight(0xffffff, 0.06, glow(), 1.2);
  tail.position.set(0, bottom + size.y * (id === 'cessna170' ? 0.58 : 0.4), -size.z * 0.5 + 0.2);
  group.add(tail);
  nav.tail = tail;

  const strobe = navLight(0xffffff, 0.065, glow(), 2.3);
  strobe.position.set(0, bottom + size.y * (id === 'cessna170' ? 0.92 : 0.7), -size.z * 0.38);
  group.add(strobe);
  nav.strobe = strobe;

  if (id === 'cessna170') {
    const beacon = navLight(0xff3322, 0.055, glow(), 1.4);
    beacon.position.set(0, bottom + size.y * 0.86, -size.z * 0.08);
    group.add(beacon);
    nav.beacon = beacon;
  }

  return nav;
}

function addLandingLight(group, id, size, bottom) {
  const landing = landingLightGroup();
  landing.position.set(0, bottom + size.y * 0.22, size.z * 0.32);
  landing.userData.light.distance = id === 'b2' ? 1800 : 1400;
  group.add(landing);
  return landing;
}

function addSkins(group, root, id, parts) {
  // The Cessna's propeller pivot is local Y (the source model is -Z forward,
  // then rotated 180°). The F-22 and B-2 have no propeller.
  if (id !== 'cessna170') return;
  const prop = findNode(root, 'prop_1_33');
  if (!prop) return;
  parts.propSpin = prop;
  parts.propAxis = 'y';
  parts.propSlow = findNode(root, 'prop_1_slow_31');
  parts.propFast = findNode(root, 'prop_1_fast_32');
  if (parts.propFast) parts.propFast.visible = false;

  group.updateMatrixWorld(true);
  const hub = new THREE.Vector3();
  prop.getWorldPosition(hub);
  group.worldToLocal(hub);

  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(1.95, 1.95),
    new THREE.MeshBasicMaterial({
      map: propBlurTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  disc.position.copy(hub);
  disc.position.z += 0.01;
  disc.renderOrder = 3;
  group.add(disc);
  parts.propDisc = disc;
}

function prepare(id, gltf, maxAniso) {
  const cfg = CONFIG[id];
  const root = gltf.scene;

  for (const name of cfg.remove) {
    const node = findNode(root, name);
    if (node?.parent) node.parent.remove(node);
  }
  if (id === 'f22') {
    // Remove the source model's tiny wheel meshes: replace those busy baked
    // details with a single clean, readable set of sim landing gear below.
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      if (mats.some((mat) => /^(Tyre|White_disk)$/i.test(mat.name || ''))) obj.visible = false;
    });
  }

  // Rotate first so the bbox and all subsequent placements are in sim axes.
  const orient = new THREE.Group();
  orient.rotation.y = cfg.rotateY;
  orient.add(root);
  orient.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(orient);
  const preSize = box.getSize(new THREE.Vector3());
  const fitSize = cfg.fit === 'span' ? preSize.x : preSize.z;
  const scale = cfg.target / Math.max(fitSize, 0.0001);
  orient.scale.setScalar(scale);
  orient.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(orient);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Wrapper origin: wing centre, lowest point on -groundClearance. The Raptor
  // uses the belly as its origin so the added gear reaches the ground plane.
  const group = new THREE.Group();
  const gc = cfg.groundClearance;
  const bottom = cfg.bellyOrigin ? 0 : -gc;
  orient.position.set(-center.x, bottom - box.min.y, -center.z);
  group.add(orient);
  group.updateMatrixWorld(true);

  tuneMaterials(root, id, maxAniso);
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = true;
  });

  const parts = {
    ailerons: null,
    flaps: null,
    elevator: null,
    rudder: null,
    stabilators: [],
    gearGroup: null,
    gearUpGroup: null,
    importedGear: !cfg.fixedGear,
    nav: {},
    landingLights: [],
    afterburners: [],
    abGlows: [],
    propSpin: null,
    propDisc: null,
    propAxis: 'z',
  };

  // Gear: attach the source nodes into identity groups so they can be
  // hidden as a unit without disturbing their baked transforms.
  if (cfg.gearDown?.length) {
    const down = new THREE.Group();
    down.name = 'gear-down';
    group.add(down);
    group.updateMatrixWorld(true);
    for (const name of cfg.gearDown) {
      const node = findNode(root, name);
      if (node) down.attach(node);
    }
    parts.gearGroup = down;
    group.updateMatrixWorld(true);
  }
  if (cfg.gearUp?.length) {
    const up = new THREE.Group();
    up.name = 'gear-up';
    group.add(up);
    group.updateMatrixWorld(true);
    for (const name of cfg.gearUp) {
      const node = findNode(root, name);
      if (node) up.attach(node);
    }
    up.visible = false;
    parts.gearUpGroup = up;
  }

  addSkins(group, root, id, parts);
  if (id === 'f22') {
    const gear = buildF22Gear(size, gc);
    group.add(gear);
    parts.gearGroup = gear;
    parts.groundContactOffset = gear.userData.contactOffset;
    parts.mainWheelContactOffset = gear.userData.mainWheelContactOffset;
  }
  parts.nav = addNavLights(group, id, size, bottom);
  const landing = addLandingLight(group, id, size, bottom);
  parts.landingLights.push(landing);
  if (id === 'f22') {
    addAfterburners(
      group,
      {
        x: 0,
        y: bottom + size.y * 0.33,
        z: -size.z * 0.5 + 0.12,
        spread: size.x * 0.082,
      },
      parts
    );
  }

  let cockpit;
  if (id === 'cessna170') {
    cockpit = new THREE.Vector3(0, bottom + size.y * 0.52, size.z * 0.06);
  } else if (id === 'b2') {
    cockpit = new THREE.Vector3(0, bottom + size.y * 0.66, size.z * 0.13);
  } else {
    cockpit = new THREE.Vector3(0, bottom + size.y * 0.62, size.z * 0.23);
  }

  const exhaustZ = -size.z * 0.5 + 0.3;
  const contrailOrigins =
    id === 'f22'
      ? [
          new THREE.Vector3(-size.x * 0.082, bottom + size.y * 0.38, exhaustZ),
          new THREE.Vector3(size.x * 0.082, bottom + size.y * 0.38, exhaustZ),
        ]
      : id === 'b2'
        ? [
            new THREE.Vector3(-size.x * 0.17, bottom + size.y * 0.32, exhaustZ),
            new THREE.Vector3(-size.x * 0.055, bottom + size.y * 0.32, exhaustZ),
            new THREE.Vector3(size.x * 0.055, bottom + size.y * 0.32, exhaustZ),
            new THREE.Vector3(size.x * 0.17, bottom + size.y * 0.32, exhaustZ),
          ]
        : [];

  return {
    group,
    parts,
    cockpit,
    gearHeight: gc,
    exhausts:
      id === 'f22'
        ? [
            new THREE.Vector3(-size.x * 0.082, bottom + size.y * 0.33, exhaustZ),
            new THREE.Vector3(size.x * 0.082, bottom + size.y * 0.33, exhaustZ),
          ]
        : [],
    contrailOrigins,
    hasProp: id === 'cessna170',
    shared: true,
    imported: true,
    dimensions: size.clone(),
    credits: gltf.scene.userData?.credits || null,
  };
}

export async function loadAircraftModels({ maxAnisotropy = 8, onProgress } = {}) {
  const loader = new GLTFLoader();
  const entries = Object.entries(CONFIG);
  let done = 0;
  for (const [id, cfg] of entries) {
    onProgress?.(done / entries.length, `Loading ${id === 'cessna170' ? 'Cessna 182T' : id === 'b2' ? 'B-2 Spirit' : 'F-22A Raptor'}…`);
    try {
      const gltf = await loader.loadAsync(cfg.url);
      templates.set(id, prepare(id, gltf, maxAnisotropy));
    } catch (err) {
      console.warn(`[aircraft] ${id} could not be loaded; using procedural fallback`, err);
    }
    done++;
  }
  onProgress?.(1, 'Airframes ready.');
  return templates;
}

export function createImportedAircraft(id) {
  const template = templates.get(id);
  if (!template) return null;
  // Only one airframe is ever in the scene. The prepared template is reused
  // rather than cloned, which keeps a single copy of the very large textures
  // and preserves the skinned Cessna rig.
  template.group.visible = true;
  return template;
}

export function importedModelInfo(id) {
  return templates.get(id) || null;
}

/**
 * Independent copy of an imported airframe for a second aircraft in the same
 * scene. Geometry and textures stay shared with the cached template; only the
 * node graph and the parts that animate (gear, control surfaces, afterburners)
 * are duplicated. Enough for a whole flight of bandits, not just one.
 */
export function cloneImportedAircraft(id) {
  const template = templates.get(id);
  if (!template) return null;
  const group = cloneSkinned(template.group);
  const parts = {
    ...template.parts,
    // Arrays from the template must not be shared between airframes.
    afterburners: [],
    abCores: [],
    abGlows: [],
    abShockCells: [],
    landingLights: [],
    nav: {},
  };

  group.traverse((obj) => {
    if (obj.name === 'ab-plume') parts.afterburners.push(obj);
    else if (obj.name === 'ab-core') parts.abCores.push(obj);
    else if (obj.name === 'ab-glow') parts.abGlows.push(obj);
    else if (obj.name === 'ab-ring') parts.abShockCells.push(obj);
    else if (obj.name === 'gear-down' || obj.name === 'f22-undercarriage') parts.gearGroup = obj;
    else if (obj.name === 'gear-up') parts.gearUpGroup = obj;
  });

  return {
    ...template,
    group,
    parts,
    shared: false,
    clone: true,
  };
}
