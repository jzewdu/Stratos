import * as THREE from 'three';
import {
  loftGeometry,
  wingGeometry,
  finGeometry,
  controlSurface,
  makeWheel,
  strutBetween,
  quad,
  navLight,
  landingLightGroup,
  makePropeller,
  mirrorGeometryX,
} from './parts.js';
import { glowTexture, propBlurTexture } from '../world/textures.js';
import { createImportedAircraft } from './imported.js';
import {
  skinMaterial,
  paintMaterial,
  rubberMaterial,
  chromeMaterial,
  titaniumMaterial,
  canopyMaterial,
  textTexture,
  insigniaTexture,
  instrumentPanelTexture,
  propellerBladeTexture,
  stripeTexture,
} from './finish.js';

const glow = () => glowTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function addShadows(root) {
  root.traverse((obj) => {
    if (obj.isMesh && !obj.isSprite) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

/** Transparent textured plate used for registrations, codes and stencils. */
function decal(texture, width, { opacity = 1, side = THREE.FrontSide } = {}) {
  const height = width * (texture.image.height / texture.image.width);
  const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    transparent: true,
    opacity,
    roughness: 0.5,
    metalness: 0.05,
    clearcoat: 0.2,
    clearcoatRoughness: 0.4,
    side,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = 2;
  return mesh;
}

function roundedRectGeometry(width, height, radius, segments = 6) {
  const s = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  s.closePath();
  return new THREE.ShapeGeometry(s, segments);
}

function bladeGeometry(radius, { rootChord = 0.17, tipChord = 0.085, rootPitch = 0.52, tipPitch = 0.2 } = {}) {
  const sections = [0.12, 0.22, 0.36, 0.52, 0.7, 0.86, 1.0];
  const R = 10;
  const positions = [];
  const uvs = [];
  const indices = [];
  const rings = [];

  for (let s = 0; s < sections.length; s++) {
    const t = sections[s];
    const r = radius * t;
    const chord = rootChord + (tipChord - rootChord) * t;
    const twist = rootPitch + (tipPitch - rootPitch) * t;
    const thickness = chord * 0.13;
    const ring = [];
    for (let i = 0; i < R; i++) {
      const theta = (i / R) * Math.PI * 2;
      const cx = Math.cos(theta) * (chord / 2);
      const cz = Math.sin(theta) * (thickness / 2);
      const x = cx * Math.cos(twist) + cz * Math.sin(twist);
      const z = -cx * Math.sin(twist) + cz * Math.cos(twist);
      const idx = positions.length / 3;
      positions.push(x, r, z);
      uvs.push(i / R, t);
      ring.push(idx);
    }
    rings.push(ring);
  }

  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s];
    const b = rings[s + 1];
    for (let i = 0; i < R; i++) {
      const ni = (i + 1) % R;
      indices.push(a[i], a[ni], b[i], a[ni], b[ni], b[i]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeDetailedWheel(radius, width, { tire, hub, brake } = {}) {
  const group = new THREE.Group();
  const tireMat = tire || rubberMaterial();
  const hubMat = hub || chromeMaterial();
  const brakeMat = brake || new THREE.MeshStandardMaterial({ color: 0x3c3f42, roughness: 0.7, metalness: 0.6 });

  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 28, 1);
  const tireMesh = new THREE.Mesh(tireGeo, tireMat);
  tireMesh.rotation.z = Math.PI / 2;
  group.add(tireMesh);
  // Shoulder bulge makes the tyre read as pneumatic rather than a cylinder.
  const shoulder = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.97, width * 0.26, 8, 24), tireMat);
  shoulder.rotation.y = Math.PI / 2;
  group.add(shoulder);

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 1.02, 24), hubMat);
  rim.rotation.z = Math.PI / 2;
  group.add(rim);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, width * 1.1, 22), brakeMat);
  disc.rotation.z = Math.PI / 2;
  group.add(disc);
  // Hub cap.
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hubMat);
    cap.rotation.z = side * -Math.PI / 2;
    cap.position.x = side * width * 0.55;
    cap.scale.set(1, 0.55, 1);
    group.add(cap);
  }
  return group;
}

/** Decal surface that bends with the fuselage so long text isn't buried. */
function hullDecal(texture, { side = 1, width = 1, height = 0.24, z = 0, y = 0.2, xAt }) {
  const segments = 24;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const zz = z - side * (u - 0.5) * width;
    const x = side * (xAt(zz) + 0.008);
    positions.push(x, y - height / 2, zz, x, y + height / 2, zz);
    uvs.push(u, 0, u, 1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    if (side > 0) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshPhysicalMaterial({
      map: texture,
      transparent: true,
      roughness: 0.5,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
  );
  mesh.renderOrder = 2;
  return mesh;
}

/** Thin surface seam that follows a polyline on the outside of the skin. */
function seam(points, color = 0x2b2b2b, width = 0.012) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, linewidth: 1 }));
}

// ---------------------------------------------------------------------------
// Cessna 170B — polished 1950s high-wing taildragger
// ---------------------------------------------------------------------------

function buildCessna() {
  const group = new THREE.Group();
  const skin = skinMaterial({
    variant: 'paint',
    repeat: [2, 3],
    color: 0xb8b2a3,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.7,
    specularIntensity: 0.4,
  });
  const red = paintMaterial(0xa5232c, { metalness: 0.35, roughness: 0.34, clearcoat: 0.9 });
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6, metalness: 0.25 });
  const rubber = rubberMaterial();
  const chrome = chromeMaterial();
  const glass = canopyMaterial({ tint: 0xb3ccd6, opacity: 0.3 });
  const interior = new THREE.MeshStandardMaterial({ color: 0x7a6553, roughness: 0.82 });
  const headliner = new THREE.MeshStandardMaterial({ color: 0xa39a89, roughness: 0.9 });
  const carpet = new THREE.MeshStandardMaterial({ color: 0x2c2926, roughness: 0.95 });
  const metal = titaniumMaterial();
  const bladeTex = propellerBladeTexture();

  // --- Fuselage -------------------------------------------------------------
  const sections = [
    [ -3.82, 0.07, 0.17, 0.03 ],
    [ -3.55, 0.17, 0.30, 0.04 ],
    [ -3.10, 0.28, 0.44, 0.05 ],
    [ -2.50, 0.38, 0.56, 0.04 ],
    [ -1.70, 0.48, 0.65, 0.03 ],
    [ -0.90, 0.56, 0.71, 0.02 ],
    [ -0.10, 0.605, 0.735, 0.02 ],
    [ 0.80, 0.605, 0.735, 0.02 ],
    [ 1.45, 0.555, 0.69, 0.02 ],
    [ 1.95, 0.49, 0.60, 0.01 ],
    [ 2.35, 0.445, 0.52, 0.0 ],
    [ 2.62, 0.41, 0.47, 0.0 ],
  ].map(([z, w, h, y]) => ({ z, w, h, y }));
  group.add(new THREE.Mesh(loftGeometry(sections, 28, 2.25), skin));

  // Engine cowling: tapered, with cheek inlets, exhaust and cooling louvers.
  const cowl = new THREE.Mesh(
    loftGeometry(
      [
        { z: 2.60, w: 0.415, h: 0.475, y: 0.0 },
        { z: 2.76, w: 0.43, h: 0.49, y: 0.0 },
        { z: 2.96, w: 0.41, h: 0.46, y: -0.005 },
        { z: 3.08, w: 0.35, h: 0.39, y: -0.01 },
        { z: 3.14, w: 0.29, h: 0.31, y: -0.01 },
      ],
      26,
      2.1
    ),
    skin
  );
  group.add(cowl);

  // Dark cooling opening around the spinner rather than a jet-style ring.
  const cowlOpening = new THREE.Mesh(new THREE.CircleGeometry(0.27, 24), darkTrim);
  cowlOpening.position.set(0, -0.01, 3.145);
  group.add(cowlOpening);
  const cowlFlap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.05), red);
  cowlFlap.position.set(0, -0.4, 2.92);
  cowlFlap.rotation.x = 0.3;
  group.add(cowlFlap);

  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.105, 14), darkTrim);
    cheek.rotation.y = side * Math.PI / 2;
    cheek.position.set(side * 0.405, 0.03, 2.8);
    group.add(cheek);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.016, 6, 16), skin);
    lip.rotation.y = side * Math.PI / 2;
    lip.position.set(side * 0.407, 0.03, 2.8);
    group.add(lip);

    // Cooling gills behind the cowl cheek.
    for (let i = 0; i < 3; i++) {
      const gill = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.09, 0.16), darkTrim);
      gill.position.set(side * 0.402, -0.15, 2.66 - i * 0.0);
      group.add(gill);
    }
  }

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.22, 10), metal);
  exhaust.rotation.x = Math.PI / 2 - 0.35;
  exhaust.position.set(0.25, -0.37, 2.95);
  group.add(exhaust);

  // Spinner and propeller.
  const spinnerProfile = [
    [0.0, 0.0],
    [0.075, 0.015],
    [0.17, 0.075],
    [0.235, 0.17],
    [0.26, 0.28],
    [0.255, 0.34],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const spinner = new THREE.Mesh(new THREE.LatheGeometry(spinnerProfile, 24), red);
  spinner.rotation.x = Math.PI / 2;
  spinner.position.set(0, -0.01, 3.06);
  group.add(spinner);

  const prop = new THREE.Group();
  const spin = new THREE.Group();
  const bladeMat = new THREE.MeshPhysicalMaterial({
    map: bladeTex,
    color: 0xffffff,
    roughness: 0.45,
    metalness: 0.35,
    clearcoat: 0.4,
  });
  const bladeGeo = bladeGeometry(0.95);
  const bladeA = new THREE.Mesh(bladeGeo, bladeMat);
  const bladeB = new THREE.Mesh(bladeGeo, bladeMat);
  bladeB.rotation.z = Math.PI;
  spin.add(bladeA, bladeB);
  prop.add(spin);
  prop.position.set(0, -0.01, 3.36);
  group.add(prop);
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.96, 40),
    new THREE.MeshBasicMaterial({
      map: propBlurTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: 0x565a5d,
    })
  );
  propDisc.position.set(0, -0.01, 3.44);
  group.add(propDisc);

  // --- Wing -----------------------------------------------------------------
  const wing = new THREE.Mesh(
    wingGeometry({
      span: 5.35,
      rootChord: 1.62,
      tipChord: 1.12,
      sweep: 0.1,
      dihedral: 0.06,
      baseY: 0.83,
      baseZ: 1.45,
      baseX: 0.36,
      thickness: 0.135,
      camber: 0.032,
      side: 1,
      segments: 22,
    }),
    skin
  );
  group.add(wing);
  group.add(new THREE.Mesh(mirrorGeometryX(wing.geometry), skin));

  for (const side of [-1, 1]) {
    // Wing struts and jury struts.
    const strut = strutBetween(
      new THREE.Vector3(side * 0.52, -0.16, 0.72),
      new THREE.Vector3(side * 2.52, 0.84, 0.62),
      0.036,
      chrome
    );
    group.add(strut);
    const jury = strutBetween(
      new THREE.Vector3(side * 1.52, 0.44, 0.665),
      new THREE.Vector3(side * 1.52, 0.855, 0.84),
      0.018,
      chrome
    );
    group.add(jury);
    // Strut-to-fuselage fairing.
    const strutBoot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.42), skin);
    strutBoot.position.set(side * 0.54, -0.12, 0.72);
    strutBoot.rotation.z = side * 0.18;
    group.add(strutBoot);

    // Wingtip: red cap, position light, strobe.
    const tip = new THREE.Mesh(
      loftGeometry(
        [        {
          z: 1.4, w: 0.07, h: 0.075, y: 0.89 },
          { z: 1.25, w: 0.1, h: 0.09, y: 0.89 },
          { z: 0.45, w: 0.1, h: 0.08, y: 0.88 },
        ],
        10,
        2.0
      ),
      red
    );
    tip.position.x = side * 5.71;
    group.add(tip);

    const nav = navLight(side > 0 ? 0x35ff6a : 0xff2b2b, 0.075, glow(), 1.9);
    nav.position.set(side * 5.77, 0.935, 1.08);
    group.add(nav);

    // Fuel cap and tank drain on the upper surface.
    const fuelCap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.014, 14), chrome);
    fuelCap.position.set(side * 1.75, 0.918, 0.9);
    group.add(fuelCap);
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), metal);
    drain.position.set(side * 1.55, 0.85, 0.4);
    group.add(drain);

    // Aileron and flap hinges.
    for (const hingeZ of [0.9, 0.4]) {
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 8), metal);
      hinge.rotation.z = Math.PI / 2;
      hinge.position.set(side * (4.25 + (hingeZ - 0.4) * 0.4), 0.665, hingeZ);
      group.add(hinge);
    }
  }

  // Ailerons and flaps.
  const ailerons = { left: null, right: null };
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 4.52, 0.872, 0.44);
    const surface = new THREE.Mesh(controlSurface(1.32, 0.42, 0.038), skin);
    pivot.add(surface);
    group.add(pivot);
    if (side > 0) ailerons.right = pivot;
    else ailerons.left = pivot;
  }
  const flaps = { left: null, right: null };
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.35, 0.865, 0.34);
    const surface = new THREE.Mesh(controlSurface(1.72, 0.47, 0.04), skin);
    pivot.add(surface);
    group.add(pivot);
    if (side > 0) flaps.right = pivot;
    else flaps.left = pivot;
  }

  // --- Cabin glazing --------------------------------------------------------
  const windowMat = glass;
  for (const side of [-1, 1]) {
    const doorWindow = new THREE.Mesh(roundedRectGeometry(0.94, 0.5, 0.09), windowMat);
    doorWindow.rotation.y = side * Math.PI / 2;
    doorWindow.position.set(side * 0.606, 0.29, 0.56);
    group.add(doorWindow);
    const rearWindow = new THREE.Mesh(roundedRectGeometry(0.55, 0.42, 0.08), windowMat);
    rearWindow.rotation.y = side * Math.PI / 2;
    rearWindow.position.set(side * 0.585, 0.27, -0.38);
    group.add(rearWindow);

    // Window reveal: a slim aluminium trim strip around the glass.
    const frame = new THREE.Mesh(roundedRectGeometry(1.0, 0.56, 0.11), darkTrim);
    frame.rotation.y = side * Math.PI / 2;
    frame.position.set(side * 0.601, 0.29, 0.56);
    group.add(frame);
    doorWindow.position.x = side * 0.613;
    rearWindow.position.x = side * 0.591;

    // Door handle and sill.
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.028, 0.12), chrome);
    handle.position.set(side * 0.622, 0.02, 0.05);
    group.add(handle);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 1.18), darkTrim);
    sill.position.set(side * 0.607, -0.03, 0.42);
    group.add(sill);

    // Door seam.
    const seamPts = [
      new THREE.Vector3(side * 0.607, 0.62, 1.06),
      new THREE.Vector3(side * 0.61, -0.32, 1.0),
      new THREE.Vector3(side * 0.61, -0.32, -0.15),
      new THREE.Vector3(side * 0.604, 0.62, -0.15),
    ];
    group.add(seam(seamPts));
  }

  // Windshield: two panes with a centre post.
  for (const side of [-1, 1]) {
    const pane = quad(
      [
        new THREE.Vector3(side * 0.02, 0.33, 1.72),
        new THREE.Vector3(side * 0.46, 0.31, 1.58),
        new THREE.Vector3(side * 0.31, 0.71, 1.1),
        new THREE.Vector3(side * 0.02, 0.73, 1.14),
      ],
      windowMat
    );
    group.add(pane);
  }
  const centerPost = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.045), darkTrim);
  centerPost.position.set(0, 0.52, 1.42);
  centerPost.rotation.x = -0.55;
  group.add(centerPost);
  const header = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.055, 0.08), skin);
  header.position.set(0, 0.725, 1.11);
  group.add(header);

  // --- Tail -----------------------------------------------------------------
  const fin = new THREE.Mesh(
    finGeometry(
      [
        [-2.95, 0.06],
        [-2.95, 0.52],
        [-3.34, 1.52],
        [-3.82, 1.5],
        [-3.92, 0.04],
      ],
      0.1
    ),
    skin
  );
  group.add(fin);

  // Red fin flash and registration.
  const finFlash = new THREE.Mesh(
    finGeometry(
      [
        [-3.30, 1.26],
        [-3.37, 1.52],
        [-3.82, 1.5],
        [-3.8, 1.24],
      ],
      0.108
    ),
    red
  );
  group.add(finFlash);

  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, 0.12, -3.5);
  const rudder = new THREE.Mesh(
    finGeometry(
      [
        [0.0, 0.0],
        [-0.12, 0.4],
        [-0.42, 1.34],
        [-0.78, 1.32],
        [-0.8, 0.02],
      ],
      0.075
    ),
    skin
  );
  rudderPivot.add(rudder);
  group.add(rudderPivot);

  // Horizontal stabiliser and elevators.
  const stabilizer = new THREE.Mesh(
    wingGeometry({
      span: 1.92,
      rootChord: 1.02,
      tipChord: 0.62,
      sweep: 0.3,
      dihedral: 0.02,
      baseY: 0.13,
      baseZ: -3.32,
      baseX: 0.07,
      thickness: 0.11,
      camber: 0.012,
      side: 1,
      segments: 12,
    }),
    skin
  );
  group.add(stabilizer);
  group.add(new THREE.Mesh(mirrorGeometryX(stabilizer.geometry), skin));

  const elevatorPivot = new THREE.Group();
  elevatorPivot.position.set(0, 0.145, -4.13);
  const elevator = new THREE.Mesh(controlSurface(3.55, 0.4, 0.028), skin);
  elevatorPivot.add(elevator);
  group.add(elevatorPivot);

  // Trim tab.
  const trimTab = new THREE.Mesh(controlSurface(0.5, 0.14, 0.016), skin);
  trimTab.position.set(1.28, 0.0, -0.02);
  elevatorPivot.add(trimTab);

  // --- Landing gear ---------------------------------------------------------
  const gearGroup = new THREE.Group();
  for (const side of [-1, 1]) {
    const legCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.4, -0.22, 0.55),
      new THREE.Vector3(side * 0.63, -0.62, 0.5),
      new THREE.Vector3(side * 0.8, -1.02, 0.45),
      new THREE.Vector3(side * 0.86, -1.22, 0.4),
    ]);
    const leg = new THREE.Mesh(new THREE.TubeGeometry(legCurve, 18, 0.042, 10, false), metal);
    gearGroup.add(leg);

    const fairing = new THREE.Mesh(
      loftGeometry(
        [
          { z: 0.44, w: 0.085, h: 0.2, y: -0.58 },
          { z: 0.43, w: 0.09, h: 0.17, y: -0.86 },
          { z: 0.42, w: 0.075, h: 0.12, y: -1.05 },
        ],
        10,
        2.2
      ),
      skin
    );
    fairing.position.x = side * 0.72;
    gearGroup.add(fairing);

    const wheel = makeDetailedWheel(0.32, 0.2, { tire: rubber });
    wheel.position.set(side * 0.88, -1.36, 0.4);
    gearGroup.add(wheel);

    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.12), darkTrim);
    caliper.position.set(side * 0.98, -1.34, 0.28);
    gearGroup.add(caliper);

    // Brake line.
    const brakeLine = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.4, -0.24, 0.5),
          new THREE.Vector3(side * 0.64, -0.62, 0.44),
          new THREE.Vector3(side * 0.82, -1.0, 0.3),
          new THREE.Vector3(side * 0.9, -1.25, 0.26),
        ]),
        14,
        0.008,
        6,
        false
      ),
      rubber
    );
    gearGroup.add(brakeLine);

    // Boarding step under the door.
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.14), metal);
    step.position.set(side * 0.5, -0.44, 0.42);
    gearGroup.add(step);
  }

  // Tailwheel and leaf spring.
  const spring = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.18, -3.02),
        new THREE.Vector3(0, -0.5, -3.2),
        new THREE.Vector3(0, -0.66, -3.32),
      ]),
      12,
      0.035,
      8,
      false
    ),
    metal
  );
  gearGroup.add(spring);
  const tailWheel = makeDetailedWheel(0.145, 0.1, { tire: rubber });
  tailWheel.position.set(0, -0.7, -3.36);
  gearGroup.add(tailWheel);
  const tailFork = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.1), darkTrim);
  tailFork.position.set(0, -0.58, -3.34);
  gearGroup.add(tailFork);
  group.add(gearGroup);

  // --- Cabin interior -------------------------------------------------------
  const panelMat = new THREE.MeshStandardMaterial({
    map: instrumentPanelTexture(),
    roughness: 0.7,
    metalness: 0.1,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.235), panelMat);
  panel.position.set(0, 0.19, 1.04);
  panel.rotation.x = -0.22;
  group.add(panel);
  const panelLip = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.045, 0.12), darkTrim);
  panelLip.position.set(0, 0.32, 1.0);
  panelLip.rotation.x = -0.2;
  group.add(panelLip);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.04, 1.6), carpet);
  floor.position.set(0, -0.28, 0.4);
  group.add(floor);

  // Light headliner so the cabin doesn't read as a black hole through the glass.
  const roofLiner = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.04, 1.75), headliner);
  roofLiner.position.set(0, 0.6, 0.35);
  group.add(roofLiner);
  for (const side of [-1, 1]) {
    const trimPanel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 1.5), headliner);
    trimPanel.position.set(side * 0.56, 0.2, 0.4);
    group.add(trimPanel);
  }

  for (const side of [-1, 1]) {
    const seat = new THREE.Group();
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.42), interior);
    cushion.position.set(0, -0.18, 0);
    seat.add(cushion);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.1), interior);
    back.position.set(0, 0.12, -0.19);
    back.rotation.x = -0.08;
    seat.add(back);
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.09), interior);
    headrest.position.set(0, 0.43, -0.24);
    seat.add(headrest);
    seat.position.set(side * 0.26, -0.08, 0.28);
    group.add(seat);

    const yoke = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.017, 8, 18), darkTrim);
    ring.rotation.x = Math.PI / 2;
    yoke.add(ring);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 8), darkTrim);
    column.rotation.x = Math.PI / 2;
    column.position.z = 0.12;
    yoke.add(column);
    yoke.position.set(side * 0.26, -0.05, 0.9);
    group.add(yoke);

    const rudderPedal = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.12), metal);
    rudderPedal.position.set(side * 0.26, -0.24, 1.22);
    group.add(rudderPedal);
  }

  // Rear bench.
  const rearBench = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.1, 0.44), interior);
  rearBench.position.set(0, -0.16, -1.0);
  group.add(rearBench);
  const rearBack = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.46, 0.1), interior);
  rearBack.position.set(0, 0.05, -1.2);
  group.add(rearBack);

  // --- Markings -------------------------------------------------------------
  // Classic red cheatline, broken into short panels that follow the hull width.
  const stripeTex = stripeTexture();
  const widthAt = (z) => {
    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i];
      const b = sections[i + 1];
      if (z >= a.z && z <= b.z) {
        const t = (z - a.z) / (b.z - a.z);
        return a.w + (b.w - a.w) * t;
      }
    }
    return 0.2;
  };
  for (const side of [-1, 1]) {
    for (let z = 1.95; z > -3.5; z -= 0.34) {
      const strip = decal(stripeTex, 0.36);
      strip.rotation.y = side * Math.PI / 2;
      strip.position.set(side * (widthAt(z) + 0.008), 0.02, z - 0.18);
      group.add(strip);
    }
  }

  const reg = textTexture('N170CS', { color: '#1f2124', size: 122, weight: 700, spacing: 4 });
  for (const side of [-1, 1]) {
    group.add(
      hullDecal(reg, { side, width: 1.25, height: 0.22, z: -2.45, y: 0.28, xAt: widthAt })
    );
  }
  // Small registration on the fin.
  const finReg = decal(textTexture('N170CS', { color: '#1f2124', size: 100, weight: 700, spacing: 3 }), 0.5);
  finReg.position.set(0.056, 1.22, -3.56);
  finReg.rotation.y = Math.PI / 2;
  group.add(finReg);

  // Wing walk and fuel placards.
  for (const side of [-1, 1]) {
    const walk = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95, transparent: true, opacity: 0.75 })
    );
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(side * 0.85, 0.9, 0.95);
    group.add(walk);
    const noStep = decal(textTexture('NO STEP', { color: '#2b2d30', size: 66, weight: 700 }), 0.3);
    noStep.rotation.x = -Math.PI / 2;
    noStep.rotation.z = Math.PI / 2;
    noStep.position.set(side * 1.62, 0.922, 0.92);
    group.add(noStep);
  }

  // --- Antennas, pitot, static ports ---------------------------------------
  for (const [x, z, len] of [
    [0.0, 0.35, 0.19],
    [0.0, -1.55, 0.14],
  ]) {
    const blade = new THREE.Mesh(
      finGeometry(
        [
          [-0.04, 0.0],
          [0.0, len],
          [0.07, 0.0],
        ],
        0.018
      ),
      darkTrim
    );
    blade.position.set(x, 0.93, z);
    group.add(blade);
  }
  const bellyAntenna = new THREE.Mesh(
    finGeometry(
      [
        [-0.22, 0.0],
        [-0.02, 0.16],
        [0.18, 0.0],
      ],
      0.02
    ),
    darkTrim
  );
  bellyAntenna.position.set(0, -0.72, -0.7);
  bellyAntenna.rotation.x = Math.PI;
  group.add(bellyAntenna);

  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), chrome);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.set(-1.72, 0.785, 1.48);
  group.add(pitot);
  const pitotStem = strutBetween(
    new THREE.Vector3(-1.72, 0.78, 1.4),
    new THREE.Vector3(-1.72, 0.78, 1.58),
    0.01,
    chrome
  );
  group.add(pitotStem);

  for (const side of [-1, 1]) {
    for (const z of [0.85, 1.05]) {
      const port = new THREE.Mesh(new THREE.CircleGeometry(0.016, 8), darkTrim);
      port.rotation.y = side * Math.PI / 2;
      port.position.set(side * 0.608, 0.03, z);
      group.add(port);
    }
  }

  // --- Lights ---------------------------------------------------------------
  const nav = {};
  // Wingtip lights are added above per side; collect them by walking the group.
  group.traverse((obj) => {
    if (obj.userData?.color && obj.userData?.bulbMat) {
      const c = obj.userData.color;
      if (c.r > 0.8 && c.g < 0.4) nav.left = obj;
      else if (c.g > 0.8 && c.r < 0.4) nav.right = obj;
    }
  });
  const tailLight = navLight(0xffffff, 0.06, glow(), 1.2);
  tailLight.position.set(0, 0.32, -3.94);
  group.add(tailLight);
  nav.tail = tailLight;
  const strobe = navLight(0xffffff, 0.055, glow(), 2.2);
  strobe.position.set(0, 1.55, -3.7);
  group.add(strobe);
  nav.strobe = strobe;
  const beacon = navLight(0xff3322, 0.05, glow(), 1.4);
  beacon.position.set(0, 0.73, -1.7);
  group.add(beacon);
  nav.beacon = beacon;

  const landing = landingLightGroup();
  landing.position.set(0, -0.12, 3.1);
  group.add(landing);
  const lampLens = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: 0x332d1d }));
  lampLens.position.set(0, -0.12, 3.11);
  group.add(lampLens);
  landing.userData.lampMat = lampLens.material;

  addShadows(group);
  return {
    group,
    parts: {
      prop,
      propSpin: spin,
      propDisc,
      ailerons,
      flaps,
      elevator: elevatorPivot,
      rudder: rudderPivot,
      gearGroup,
      nav,
      landingLights: [landing],
      afterburners: [],
      abGlows: [],
    },
    cockpit: new THREE.Vector3(0, 0.19, 0.72),
    gearHeight: 1.68,
    exhausts: [new THREE.Vector3(0.28, -0.32, 2.78)],
    contrailOrigins: [],
    hasProp: true,
  };
}

// ---------------------------------------------------------------------------
// B-2 Spirit — flying wing
// ---------------------------------------------------------------------------

function buildB2() {
  const group = new THREE.Group();
  const skin = skinMaterial({
    variant: 'stealth',
    repeat: [3, 4],
    color: 0xc2c7ca,
    clearcoat: 0.06,
    clearcoatRoughness: 0.6,
    envMapIntensity: 0.45,
    specularIntensity: 0.12,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.75, metalness: 0.35 });
  const darker = new THREE.MeshStandardMaterial({ color: 0x080a0b, roughness: 0.65, metalness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6b7075, metalness: 0.9, roughness: 0.4 });
  const rubber = rubberMaterial();
  const glass = canopyMaterial({ tint: 0x4d5a5f, opacity: 0.55, gold: false });

  // Planform: leading edge sweep, double-sawtooth trailing edge.
  const half = [
    [0, 10.62],
    [1.7, 10.6],
    [3.2, 10.24],
    [4.8, 9.65],
    [6.6, 9.05],
    [8.6, 8.42],
    [10.8, 7.75],
    [13.2, 7.0],
    [15.8, 6.2],
    [18.4, 5.4],
    [21.2, 4.5],
    [24.0, 3.6],
    [26.2, -2.9],
    [26.2, -6.5],
    [23.5, -7.1],
    [20.6, -6.35],
    [17.2, -8.95],
    [13.2, -6.85],
    [9.6, -9.55],
    [5.2, -7.9],
    [0, -10.15],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(half[0][0], half[0][1]);
  for (let i = 1; i < half.length; i++) shape.lineTo(half[i][0], half[i][1]);
  for (let i = half.length - 2; i >= 0; i--) shape.lineTo(-half[i][0], half[i][1]);
  shape.closePath();

  const wingGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.25,
    bevelEnabled: true,
    bevelThickness: 0.5,
    bevelSize: 1.05,
    bevelSegments: 4,
    curveSegments: 1,
  });
  wingGeo.rotateX(Math.PI / 2);
  wingGeo.translate(0, 0.625, 0);
  // Taper the aerofoil towards the tips: the B-2 is thick at the centre body
  // and almost blade-thin at the outboard panels.
  const halfSpan = 26.2;
  const thicknessAt = (x) => 1 - 0.58 * Math.pow(Math.min(1, Math.abs(x) / halfSpan), 0.75);
  const wingPos = wingGeo.attributes.position;
  for (let i = 0; i < wingPos.count; i++) {
    const x = wingPos.getX(i);
    wingPos.setY(i, wingPos.getY(i) * thicknessAt(x));
  }
  wingGeo.computeVertexNormals();
  const topAt = (x) => 1.125 * thicknessAt(x);
  group.add(new THREE.Mesh(wingGeo, skin));

  // Blended centre body and cockpit hump.
  const hump = new THREE.Mesh(
    loftGeometry(
      [
        { z: 8.9, w: 0.7, h: 0.26, y: 0.8 },
        { z: 8.1, w: 1.45, h: 0.46, y: 0.92 },
        { z: 7.0, w: 2.0, h: 0.62, y: 1.02 },
        { z: 5.6, w: 2.35, h: 0.66, y: 1.06 },
        { z: 3.5, w: 2.6, h: 0.6, y: 1.06 },
        { z: 1.0, w: 2.8, h: 0.5, y: 1.02 },
        { z: -2.0, w: 3.0, h: 0.42, y: 0.98 },
        { z: -5.0, w: 2.8, h: 0.32, y: 0.92 },
        { z: -7.4, w: 1.9, h: 0.17, y: 0.86 },
      ],
      26,
      3.0
    ),
    skin
  );
  group.add(hump);

  // Faceted, low-profile cockpit canopy set into the centre body.
  const canopyPod = new THREE.Mesh(
    loftGeometry(
      [
        { z: 7.55, w: 0.5, h: 0.06, y: 1.56 },
        { z: 7.3, w: 0.98, h: 0.18, y: 1.6 },
        { z: 6.65, w: 1.1, h: 0.22, y: 1.61 },
        { z: 6.1, w: 0.98, h: 0.18, y: 1.6 },
      ],
      18,
      2.6
    ),
    glass
  );
  group.add(canopyPod);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.5), dark);
    rail.position.set(side * 1.06, 1.61, 6.82);
    group.add(rail);
  }
  const centreRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 1.45), dark);
  centreRail.position.set(0, 1.8, 6.82);
  group.add(centreRail);
  const canopyBow = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.045, 0.05), dark);
  canopyBow.position.set(0, 1.73, 7.28);
  group.add(canopyBow);

  // Interior seen through the glass.
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 1.2), darker);
  tub.position.set(0, 1.02, 6.75);
  group.add(tub);
  for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.22), dark);
    seat.position.set(side * 0.33, 1.2, 6.35);
    group.add(seat);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.06), darker);
    panel.position.set(side * 0.33, 1.24, 7.15);
    panel.rotation.x = -0.25;
    group.add(panel);
  }

  // Engine inlets: four flush trapezoids on the upper leading edge.
  for (const side of [-1, 1]) {
    for (const [x, z] of [
      [3.1, 5.9],
      [7.4, 4.15],
    ]) {
      const y = topAt(x) + 0.012;
      const inlet = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.0), darker);
      inlet.rotation.x = -Math.PI / 2;
      inlet.rotation.z = side > 0 ? -0.08 : 0.08;
      inlet.position.set(side * x, y, z);
      group.add(inlet);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.035, 0.14), skin);
      lip.position.set(side * x, y + 0.005, z + 0.52);
      group.add(lip);
      // Serrated inlet lip.
      for (let i = 0; i < 7; i++) {
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.12, 4), skin);
        tooth.rotation.x = Math.PI / 2;
        tooth.position.set(side * x - 0.9 + i * 0.3, y + 0.02, z + 0.6);
        group.add(tooth);
      }
    }
  }

  // Exhaust troughs at the trailing edge.
  for (const side of [-1, 1]) {
    for (const [x, z] of [
      [2.2, -8.2],
      [6.6, -8.7],
    ]) {
      const y = topAt(x) + 0.008;
      const trough = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.5), darker);
      trough.rotation.x = -Math.PI / 2;
      trough.position.set(side * x, y, z);
      group.add(trough);
      const surround = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 1.62), metal);
      surround.position.set(side * x, y - 0.012, z);
      group.add(surround);
    }
  }

  // Elevons along the trailing edge.
  const elevons = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const pivot = new THREE.Group();
      const inner = 11.5 + i * 8.5;
      pivot.position.set(side * inner, topAt(inner) - 0.02, -6.4 - i * 2.5);
      pivot.rotation.y = side * (i === 0 ? 0.1 : 0.32);
      pivot.rotation.z = side * -0.032;
      const panel = new THREE.Mesh(controlSurface(6.4, 1.25, 0.055), skin);
      pivot.add(panel);
      group.add(pivot);
      elevons.push(pivot);
    }
  }

  // Nose refuelling receptacle door.
  const receptacle = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16), dark);
  receptacle.rotation.x = -Math.PI / 2;
  receptacle.position.set(0, 1.28, 8.55);
  group.add(receptacle);
  const receptacleRing = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.025, 6, 20), metal);
  receptacleRing.rotation.x = Math.PI / 2;
  receptacleRing.position.set(0, 1.29, 8.55);
  group.add(receptacleRing);

  // --- Landing gear ---------------------------------------------------------
  const gearGroup = new THREE.Group();

  // Nose gear: twin wheels, long strut.
  const noseStrut = strutBetween(new THREE.Vector3(0, -0.18, 4.55), new THREE.Vector3(0, -2.28, 4.55), 0.12, metal);
  gearGroup.add(noseStrut);
  for (const side of [-1, 1]) {
    const wheel = makeDetailedWheel(0.47, 0.22, { tire: rubber, hub: metal });
    wheel.position.set(side * 0.5, -2.47, 4.55);
    gearGroup.add(wheel);
    const axle = strutBetween(
      new THREE.Vector3(0, -2.47, 4.55),
      new THREE.Vector3(side * 0.5, -2.47, 4.55),
      0.05,
      metal
    );
    gearGroup.add(axle);
  }
  const noseDoor = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.55, 2.1), skin);
  noseDoor.position.set(0, -1.05, 5.55);
  group.add(noseDoor);

  // Main gear: two legs, tandem wheels, serrated bay doors.
  for (const side of [-1, 1]) {
    const x = side * 4.6;
    const leg = strutBetween(new THREE.Vector3(x, -0.35, -1.7), new THREE.Vector3(x, -2.2, -1.7), 0.13, metal);
    gearGroup.add(leg);
    for (const dz of [-0.65, 0.65]) {
      const wheel = makeDetailedWheel(0.54, 0.24, { tire: rubber, hub: metal });
      wheel.position.set(x, -2.4, -1.7 + dz);
      gearGroup.add(wheel);
      const axle = strutBetween(
        new THREE.Vector3(x, -2.4, -1.7),
        new THREE.Vector3(x, -2.4, -1.7 + dz),
        0.055,
        metal
      );
      gearGroup.add(axle);
    }
    // Serrated gear door hanging beside the bay.
    const door = new THREE.Mesh(
      finGeometry(
        [
          [-3.4, -0.9],
          [-3.4, 0.55],
          [-2.6, 0.6],
          [-2.35, 0.28],
          [-2.0, 0.62],
          [-1.55, 0.3],
          [-1.05, 0.6],
          [-0.7, -0.85],
        ],
        0.07
      ),
      dark
    );
    door.position.set(x + side * 1.15, 0.05, 0);
    group.add(door);
    // Door actuator.
    const actuator = strutBetween(
      new THREE.Vector3(x + side * 1.05, -0.25, -1.5),
      new THREE.Vector3(x + side * 1.15, -1.15, -1.1),
      0.035,
      metal
    );
    group.add(actuator);
  }
  group.add(gearGroup);

  // --- Markings -------------------------------------------------------------
  const insignia = insigniaTexture({ subdued: true });
  const topMark = decal(insignia, 5.6, { side: THREE.DoubleSide });
  topMark.rotation.x = -Math.PI / 2;
  topMark.position.set(-11.5, topAt(11.5) + 0.014, 0.6);
  group.add(topMark);
  const bottomMark = decal(insignia, 5.6, { side: THREE.DoubleSide });
  bottomMark.rotation.x = Math.PI / 2;
  bottomMark.position.set(11.5, -topAt(11.5) - 0.014, 0.6);
  group.add(bottomMark);

  // "WM" (Whiteman AFB) tail code on the main gear doors and the aircraft
  // name on the nose gear door.
  for (const side of [-1, 1]) {
    const wm = decal(textTexture('WM', { color: '#9aa0a4', size: 150, weight: 700, spacing: 8 }), 1.05);
    wm.rotation.y = side * Math.PI / 2;
    wm.position.set(side * 5.8, -0.22, -2.0);
    group.add(wm);

    const spirit = decal(
      textTexture('SPIRIT OF AMERICA', { color: '#8f9599', size: 62, weight: 600, spacing: 2 }),
      1.7
    );
    spirit.rotation.y = side * Math.PI / 2;
    spirit.position.set(side * 0.44, -0.92, 5.5);
    group.add(spirit);

    const noStep = decal(textTexture('NO STEP', { color: '#7c8287', size: 58, weight: 700 }), 0.8);
    noStep.rotation.x = -Math.PI / 2;
    noStep.position.set(side * 9.3, topAt(9.3) + 0.014, 2.4);
    group.add(noStep);
  }

  // --- Lights ---------------------------------------------------------------
  const nav = {};
  for (const side of [-1, 1]) {
    const light = navLight(side > 0 ? 0x35ff6a : 0xff2b2b, 0.1, glow(), 2.6);
    light.position.set(side * 26.25, 0.02, -4.6);
    group.add(light);
    nav[side > 0 ? 'right' : 'left'] = light;
  }
  const tailLight = navLight(0xffffff, 0.08, glow(), 1.8);
  tailLight.position.set(0, 0.62, -10.2);
  group.add(tailLight);
  nav.tail = tailLight;
  const strobe = navLight(0xffffff, 0.08, glow(), 2.6);
  strobe.position.set(0, 1.62, 6.9);
  group.add(strobe);
  nav.strobe = strobe;

  const landing = landingLightGroup();
  landing.position.set(0, -0.5, 8.2);
  group.add(landing);

  addShadows(group);
  return {
    group,
    parts: {
      elevons,
      gearGroup,
      nav,
      landingLights: [landing],
      afterburners: [],
      abGlows: [],
      ailerons: null,
      flaps: null,
      elevator: null,
      rudder: null,
    },
    cockpit: new THREE.Vector3(0, 1.3, 6.5),
    gearHeight: 2.95,
    exhausts: [
      new THREE.Vector3(-2.2, 0.55, -8.9),
      new THREE.Vector3(2.2, 0.55, -8.9),
      new THREE.Vector3(-6.6, 0.55, -9.3),
      new THREE.Vector3(6.6, 0.55, -9.3),
    ],
    contrailOrigins: [
      new THREE.Vector3(-2.2, 0.6, -9.0),
      new THREE.Vector3(2.2, 0.6, -9.0),
    ],
    hasProp: false,
  };
}

// ---------------------------------------------------------------------------
// F-22 Raptor
// ---------------------------------------------------------------------------

function buildF22() {
  const group = new THREE.Group();
  const skin = skinMaterial({
    variant: 'fighter',
    repeat: [2.5, 3],
    color: 0x9aa1a6,
    clearcoat: 0.22,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.65,
    specularIntensity: 0.32,
  });
  const tailSkin = skinMaterial({
    variant: 'fighter',
    repeat: [2, 2],
    color: 0x7f868b,
    clearcoat: 0.18,
    envMapIntensity: 0.55,
    specularIntensity: 0.24,
  });
  const radomeMat = paintMaterial(0x848b90, { metalness: 0.45, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x363b40, roughness: 0.55, metalness: 0.6 });
  const darkest = new THREE.MeshStandardMaterial({ color: 0x0d1012, roughness: 0.6, metalness: 0.5 });
  const metal = titaniumMaterial();
  const rubber = rubberMaterial();
  const canopy = canopyMaterial({ gold: true, opacity: 0.46 });
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x5a5e60,
    metalness: 0.95,
    roughness: 0.42,
    side: THREE.DoubleSide,
  });
  const hot = new THREE.MeshStandardMaterial({
    color: 0x171310,
    metalness: 0.75,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });

  // Fuselage: broad flat centre body with chines and a slender nose.
  const sections = [
    [9.3, 0.06, 0.05, -0.02],
    [9.05, 0.22, 0.17, -0.02],
    [8.5, 0.48, 0.32, -0.01],
    [7.6, 0.76, 0.45, 0.0],
    [6.6, 1.02, 0.55, 0.01],
    [5.4, 1.24, 0.63, 0.02],
    [4.0, 1.44, 0.68, 0.02],
    [2.4, 1.68, 0.72, 0.01],
    [0.6, 1.84, 0.72, 0.0],
    [-1.2, 1.95, 0.7, -0.01],
    [-3.0, 1.9, 0.66, -0.02],
    [-4.8, 1.76, 0.6, -0.04],
    [-6.4, 1.56, 0.52, -0.06],
    [-8.0, 1.3, 0.44, -0.08],
    [-9.0, 1.05, 0.36, -0.09],
  ].map(([z, w, h, y]) => ({ z, w, h, y }));
  group.add(new THREE.Mesh(loftGeometry(sections, 24, 3.1), skin));

  // Radome is a separate, slightly different shade with a conductive tip.
  const radome = new THREE.Mesh(
    loftGeometry(
      [
        { z: 7.45, w: 0.64, h: 0.39, y: 0 },
        { z: 8.2, w: 0.47, h: 0.3, y: -0.01 },
        { z: 8.8, w: 0.28, h: 0.2, y: -0.02 },
        { z: 9.3, w: 0.06, h: 0.05, y: -0.02 },
      ],
      22,
      2.6
    ),
    radomeMat
  );
  group.add(radome);

  // Chines blending the forebody into the wing.
  for (const side of [-1, 1]) {
    const chine = new THREE.Mesh(
      finGeometry(
        [
          [5.6, -0.16],
          [3.0, -0.08],
          [1.2, 0.18],
          [4.8, 0.2],
        ],
        0.1
      ),
      skin
    );
    chine.position.x = side * 1.18;
    group.add(chine);
  }

  // Wings.
  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(
      wingGeometry({
        span: 4.9,
        rootChord: 5.2,
        tipChord: 1.55,
        sweep: 4.0,
        dihedral: -0.03,
        baseY: -0.06,
        baseZ: 2.6,
        baseX: 1.72,
        thickness: 0.055,
        camber: 0.012,
        side,
        segments: 18,
      }),
      skin
    );
    group.add(wing);
  }

  // Flaperons.
  const ailerons = { left: null, right: null };
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 4.65, -0.08, -2.3);
    pivot.rotation.y = side * 0.3;
    const surface = new THREE.Mesh(controlSurface(2.3, 0.8, 0.05), skin);
    pivot.add(surface);
    group.add(pivot);
    if (side > 0) ailerons.right = pivot;
    else ailerons.left = pivot;
  }
  const flaps = { left: null, right: null };
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.65, -0.08, -2.05);
    pivot.rotation.y = side * 0.2;
    const surface = new THREE.Mesh(controlSurface(1.55, 0.72, 0.05), skin);
    pivot.add(surface);
    group.add(pivot);
    if (side > 0) flaps.right = pivot;
    else flaps.left = pivot;
  }

  // Stabilators.
  const stabilators = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.6, -0.02, -6.5);
    pivot.rotation.y = side * 0.06;
    const stab = new THREE.Mesh(
      wingGeometry(      {
        span: 2.55,
        rootChord: 2.6,
        tipChord: 0.78,
        sweep: 1.7,
        dihedral: 0,
        baseY: -0.08,
        baseZ: 0,
        baseX: 0,
        thickness: 0.055,
        camber: 0.0,
        side,
        segments: 10,
      }),
      skin
    );
    pivot.add(stab);
    group.add(pivot);
    stabilators.push(pivot);
  }

  // Canted twin tails with rudders.
  const fins = [];
  for (const side of [-1, 1]) {
    const finPivot = new THREE.Group();
    finPivot.position.set(side * 1.7, 0.58, -4.75);
    finPivot.rotation.z = side * -0.49;
    const fin = new THREE.Mesh(
      finGeometry(
        [
          [0.0, 0.0],
          [-1.55, 3.35],
          [-2.65, 3.32],
          [-2.35, 0.0],
        ],
        0.1
      ),
      tailSkin
    );
    finPivot.add(fin);
    const rudder = new THREE.Mesh(
      finGeometry(
        [
          [-2.05, 0.2],
          [-2.2, 3.05],
          [-2.62, 3.04],
          [-2.42, 0.2],
        ],
        0.07
      ),
      tailSkin
    );
    finPivot.add(rudder);
    // Tail code and serial.
    const code = decal(textTexture('FF', { color: '#4c5258', size: 140, weight: 800, spacing: 4 }), 0.95);
    code.position.set(side * 0.075, 1.55, -2.2);
    code.rotation.y = side * Math.PI / 2;
    finPivot.add(code);
    const serial = decal(textTexture('AF 05-4098', { color: '#5c6268', size: 66, weight: 600 }), 0.78);
    serial.position.set(side * 0.075, 1.13, -2.05);
    serial.rotation.y = side * Math.PI / 2;
    finPivot.add(serial);
    group.add(finPivot);
    fins.push(finPivot);
  }

  // Caret intakes: faired into the fuselage sides, with a dark mouth and a
  // boundary-layer splitter plate ahead of each one.
  for (const side of [-1, 1]) {
    const nacelle = new THREE.Mesh(
      loftGeometry(
        [
          { z: 2.35, w: 0.16, h: 0.18, y: -0.08 },
          { z: 3.2, w: 0.34, h: 0.3, y: -0.1 },
          { z: 4.15, w: 0.48, h: 0.4, y: -0.06 },
          { z: 4.95, w: 0.52, h: 0.45, y: -0.01 },
        ],
        18,
        3.0
      ),
      skin
    );
    nacelle.position.x = side * 1.1;
    group.add(nacelle);

    // Inlet mouth, raked back at the top like the real caret inlet.
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.54), darkest);
    mouth.position.set(side * 1.1, 0.02, 4.96);
    mouth.rotation.x = -0.06;
    group.add(mouth);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.06, 0.1), skin);
    lip.position.set(side * 1.1, 0.29, 4.94);
    lip.rotation.x = -0.18;
    group.add(lip);
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.03, 0.5), dark);
    splitter.position.set(side * 1.48, -0.2, 4.6);
    splitter.rotation.z = side * 0.1;
    group.add(splitter);

    // Wing-root glove blending the intake into the leading edge.
    const glove = new THREE.Mesh(
      loftGeometry(
        [
          { z: 2.5, w: 0.34, h: 0.07, y: 0.02 },
          { z: 1.6, w: 0.55, h: 0.1, y: 0.01 },
          { z: 0.4, w: 0.7, h: 0.09, y: 0.0 },
        ],
        10,
        3.2
      ),
      skin
    );
    glove.position.x = side * 2.05;
    group.add(glove);
  }

  // --- Canopy ---------------------------------------------------------------
  const canopyMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 26, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    canopy
  );
  canopyMesh.scale.set(0.56, 0.36, 1.5);
  canopyMesh.position.set(0, 0.93, 4.55);
  group.add(canopyMesh);
  const canopyRail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 2.2), dark);
  canopyRail.position.set(0, 1.38, 4.5);
  group.add(canopyRail);
  const canopyBow = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.045, 0.045), dark);
  canopyBow.position.set(0, 0.98, 5.72);
  canopyBow.rotation.z = 0.08;
  group.add(canopyBow);

  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.25, 1.9), darkest);
  tub.position.set(0, 0.82, 3.9);
  group.add(tub);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.56, 0.2), dark);
  seat.position.set(0, 1.02, 3.4);
  group.add(seat);
  const hud = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.4),
    new THREE.MeshBasicMaterial({ color: 0x7cffc0, transparent: true, opacity: 0.08, side: THREE.DoubleSide })
  );
  hud.position.set(0, 1.28, 5.18);
  hud.rotation.x = -0.18;
  group.add(hud);
  const hudFrame = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.42, 0.025), darkest);
  hudFrame.position.set(0, 1.28, 5.19);
  hudFrame.rotation.x = -0.18;
  group.add(hudFrame);

  // Refuelling receptacle and gun port.
  const refuel = new THREE.Mesh(new THREE.CircleGeometry(0.18, 14), dark);
  refuel.rotation.x = -Math.PI / 2;
  refuel.position.set(0, 0.73, 2.2);
  group.add(refuel);
  const gunPort = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), darkest);
  gunPort.rotation.y = Math.PI / 2;
  gunPort.position.set(1.15, 0.28, 1.0);
  group.add(gunPort);

  // --- Nozzles --------------------------------------------------------------
  // Boat-tail fairing so the engines sit inside the aft fuselage rather than
  // hanging off it as separate boxes.
  const boatTail = new THREE.Mesh(
    loftGeometry(
      [
        { z: -8.0, w: 1.22, h: 0.42, y: 0.01 },
        { z: -8.8, w: 1.16, h: 0.38, y: 0.01 },
        { z: -9.35, w: 1.0, h: 0.32, y: 0.01 },
      ],
      18,
      3.2
    ),
    skin
  );
  group.add(boatTail);

  const afterburners = [];
  const abGlows = [];
  for (const side of [-1, 1]) {
    const x = side * 0.52;
    // Rectangular 2D nozzle: top/bottom petals and side walls.
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.045, 1.0), nozzleMat);
    top.position.set(x, 0.23, -9.0);
    top.rotation.x = -0.04;
    group.add(top);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.045, 1.0), nozzleMat);
    bottom.position.set(x, -0.2, -9.0);
    bottom.rotation.x = 0.035;
    group.add(bottom);
    for (const edge of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.45, 0.98), nozzleMat);
      wall.position.set(x + edge * 0.42, 0.01, -9.0);
      group.add(wall);
    }
    // Dark exhaust opening and a subtle sawtooth rim.
    const interior = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.4), hot);
    interior.position.set(x, 0.01, -9.32);
    interior.rotation.y = Math.PI;
    group.add(interior);
    for (let i = 0; i < 4; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 4), nozzleMat);
      tooth.rotation.x = Math.PI / 2;
      tooth.position.set(x - 0.27 + i * 0.18, -0.19, -9.36);
      group.add(tooth);
    }
    // Turbine face.
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.26, 14), darkest);
    face.position.set(x, 0.02, -8.95);
    face.rotation.y = Math.PI;
    group.add(face);

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 4.2, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffa53c,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(x, 0.02, -11.2);
    group.add(flame);
    afterburners.push(flame);

    const glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,215,150,0.9)', 'rgba(255,120,30,0)'),
        color: 0xffb060,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      })
    );
    glowSprite.scale.setScalar(4.6);
    glowSprite.position.set(x, 0.02, -9.9);
    group.add(glowSprite);
    abGlows.push(glowSprite);
  }

  // --- Landing gear ---------------------------------------------------------
  const gearGroup = new THREE.Group();
  const addLeg = (x, z, wheelR, wheelY, twin = false) => {
    const topY = -0.75;
    const strut = strutBetween(new THREE.Vector3(x, topY, z), new THREE.Vector3(x, wheelY + 0.1, z), 0.075, metal);
    gearGroup.add(strut);
    if (twin) {
      for (const offset of [-0.32, 0.32]) {
        const wheel = makeDetailedWheel(wheelR, 0.19, { tire: rubber });
        wheel.position.set(x + offset, wheelY, z);
        gearGroup.add(wheel);
        gearGroup.add(
          strutBetween(
            new THREE.Vector3(x, wheelY, z),
            new THREE.Vector3(x + offset, wheelY, z),
            0.04,
            metal
          )
        );
      }
    } else {
      const wheel = makeDetailedWheel(wheelR, 0.19, { tire: rubber });
      wheel.position.set(x, wheelY, z);
      gearGroup.add(wheel);
    }
    // Door panel.
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.1), skin);
    door.position.set(x + 0.42, topY - 0.1, z + 0.1);
    door.rotation.z = 0.25;
    gearGroup.add(door);
  };
  addLeg(0, 4.55, 0.32, -2.06);
  addLeg(-1.58, -0.85, 0.4, -1.98, false);
  addLeg(1.58, -0.85, 0.4, -1.98, false);
  group.add(gearGroup);

  // --- Markings -------------------------------------------------------------
  const insignia = insigniaTexture({ subdued: true });
  for (const side of [-1, 1]) {
    const mark = decal(insignia, 1.5, { side: THREE.DoubleSide });
    mark.rotation.y = side * Math.PI / 2;
    mark.position.set(side * 1.94, 0.02, -1.6);
    group.add(mark);

    const noStep = decal(textTexture('NO STEP', { color: '#4a5056', size: 62, weight: 700 }), 0.62);
    noStep.rotation.x = -Math.PI / 2;
    noStep.position.set(side * 3.6, -0.12, -0.45);
    group.add(noStep);
  }
  const eject = decal(
    textTexture('RESCUE', { color: '#b23a34', size: 74, weight: 700, spacing: 2 }),
    0.42
  );
  eject.rotation.y = Math.PI / 2;
  eject.position.set(0.955, 0.12, 2.0);
  group.add(eject);

  // --- Lights ---------------------------------------------------------------
  const nav = {};
  for (const side of [-1, 1]) {
    const light = navLight(side > 0 ? 0x35ff6a : 0xff2b2b, 0.075, glow(), 1.8);
    light.position.set(side * 6.7, -0.22, -2.9);
    group.add(light);
    nav[side > 0 ? 'right' : 'left'] = light;
  }
  const tailLight = navLight(0xffffff, 0.06, glow(), 1.2);
  tailLight.position.set(0, 0.16, -9.15);
  group.add(tailLight);
  nav.tail = tailLight;
  const strobe = navLight(0xffffff, 0.07, glow(), 2.4);
  strobe.position.set(0, 2.9, -6.4);
  group.add(strobe);
  nav.strobe = strobe;

  const landing = landingLightGroup();
  landing.position.set(0, -0.65, 4.9);
  group.add(landing);

  // Pitot probes and angle-of-attack vanes.
  for (const side of [-1, 1]) {
    const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.5, 8), metal);
    probe.rotation.x = Math.PI / 2;
    probe.position.set(side * 1.05, -0.02, 8.95);
    group.add(probe);
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.1), metal);
    vane.position.set(side * 0.95, 0.12, 8.1);
    group.add(vane);
  }

  addShadows(group);
  return {
    group,
    parts: {
      ailerons,
      flaps,
      elevator: stabilators.length ? stabilators[0] : null,
      stabilators,
      fins,
      gearGroup,
      nav,
      landingLights: [landing],
      afterburners,
      abGlows,
      nozzleInner: null,
      propDisc: null,
    },
    cockpit: new THREE.Vector3(0, 1.2, 4.0),
    gearHeight: 2.38,
    exhausts: [new THREE.Vector3(-0.52, 0.02, -9.7), new THREE.Vector3(0.52, 0.02, -9.7)],
    contrailOrigins: [
      new THREE.Vector3(-0.52, 0.3, -9.9),
      new THREE.Vector3(0.52, 0.3, -9.9),
    ],
    hasProp: false,
  };
}

export function createAircraft(id) {
  const imported = createImportedAircraft(id);
  let model;
  if (imported) {
    model = imported;
  } else if (id === 'b2') {
    model = buildB2();
  } else if (id === 'f22') {
    model = buildF22();
  } else {
    model = buildCessna();
  }
  model.id = id;

  // Prepare nav light materials with their colours but switched off.
  for (const key of Object.keys(model.parts.nav)) {
    const light = model.parts.nav[key];
    const bulb = light.userData.bulbMat;
    bulb.color.setHex(0x1a1a1a);
    if (light.userData.sprite) light.userData.sprite.material.opacity = 0;
  }
  return model;
}
