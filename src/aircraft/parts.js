import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/** Loft a fuselage from superellipse cross-sections along +Z. */
export function loftGeometry(sections, radialSegments = 20, boxiness = 2.0) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const rings = [];
  const R = radialSegments;

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const ring = [];
    for (let i = 0; i < R; i++) {
      const theta = (i / R) * Math.PI * 2;
      const cx = Math.cos(theta);
      const sy = Math.sin(theta);
      const px = Math.sign(cx) * Math.pow(Math.abs(cx), 2 / boxiness) * (sec.w ?? 0.5);
      const py = Math.sign(sy) * Math.pow(Math.abs(sy), 2 / boxiness) * (sec.h ?? 0.5);
      const idx = positions.length / 3;
      positions.push(px, (sec.y ?? 0) + py, sec.z);
      uvs.push(i / R, s / (sections.length - 1));
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

  // Caps.
  const first = sections[0];
  const last = sections[sections.length - 1];
  const firstCenter = positions.length / 3;
  positions.push(0, first.y ?? 0, first.z);
  uvs.push(0.5, 0);
  const lastCenter = positions.length / 3;
  positions.push(0, last.y ?? 0, last.z);
  uvs.push(0.5, 1);
  for (let i = 0; i < R; i++) {
    const ni = (i + 1) % R;
    indices.push(firstCenter, rings[0][ni], rings[0][i]);
    indices.push(lastCenter, rings[rings.length - 1][i], rings[rings.length - 1][ni]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function airfoilLoop(points = 14, thickness = 0.12, camber = 0.02) {
  const upper = [];
  const lower = [];
  for (let i = 0; i <= points; i++) {
    const x = 0.5 * (1 - Math.cos((Math.PI * i) / points));
    const yt =
      5 *
      thickness *
      (0.2969 * Math.sqrt(Math.max(x, 0)) -
        0.126 * x -
        0.3516 * x * x +
        0.2843 * x * x * x -
        0.1036 * x * x * x * x);
    const yc = camber * Math.sin(Math.PI * x);
    upper.push([x, yc + yt]);
    lower.push([x, yc - yt]);
  }
  const loop = [];
  for (let i = upper.length - 1; i >= 0; i--) loop.push(upper[i]);
  for (let i = 1; i < lower.length; i++) loop.push(lower[i]);
  return loop;
}

/**
 * Build a wing as a lofted airfoil. Span extends along X (sideSign mirrored),
 * chord extends towards -Z.
 */
export function wingGeometry({
  span = 5,
  rootChord = 2,
  tipChord = 1,
  sweep = 0,
  dihedral = 0,
  baseY = 0,
  baseZ = 0,
  baseX = 0,
  thickness = 0.13,
  camber = 0.02,
  side = 1,
  segments = 12,
  tipRound = 0.65,
} = {}) {
  const loop = airfoilLoop(14, thickness, camber);
  const positions = [];
  const indices = [];
  const rings = [];
  const uvs = [];

  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const chord = rootChord + (tipChord - rootChord) * t;
    const x = side * (baseX + span * t);
    const leadZ = baseZ - sweep * t;
    const yBase = baseY + dihedral * t;
    const ring = [];
    for (let p = 0; p < loop.length; p++) {
      const [chordFrac, thicknessFrac] = loop[p];
      // Round the tip slightly by shrinking the last sections' thickness.
      const tipScale = 1;
      const idx = positions.length / 3;
      positions.push(
        x,
        yBase + thicknessFrac * chord * tipScale,
        leadZ - chordFrac * chord
      );
      uvs.push(t, chordFrac);
      ring.push(idx);
    }
    rings.push(ring);
  }

  for (let s = 0; s < rings.length - 1; s++) {
    const ringA = rings[s];
    const ringB = rings[s + 1];
    const loopLen = loop.length;
    for (let i = 0; i < loopLen; i++) {
      const ni = (i + 1) % loopLen;
      if (side > 0) {
        indices.push(ringA[i], ringA[ni], ringB[i], ringA[ni], ringB[ni], ringB[i]);
      } else {
        indices.push(ringA[i], ringB[i], ringA[ni], ringA[ni], ringB[i], ringB[ni]);
      }
    }
  }

  // Cap the tip.
  const tipRing = rings[rings.length - 1];
  const tipCenter = positions.length / 3;
  const lastT = 1;
  positions.push(side * (baseX + span * lastT), baseY + dihedral * lastT, baseZ - sweep * lastT - tipChord * 0.4);
  uvs.push(1, 0.5);
  for (let i = 0; i < tipRing.length; i++) {
    const ni = (i + 1) % tipRing.length;
    if (side > 0) indices.push(tipCenter, tipRing[i], tipRing[ni]);
    else indices.push(tipCenter, tipRing[ni], tipRing[i]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Vertical fin or slab from a 2D outline in (z, y), extruded sideways. */
export function finGeometry(points, thickness = 0.12) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.25,
    bevelSize: thickness * 0.25,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(thickness / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/** A flat panel (used for control surfaces). Pivot sits on the leading edge. */
export function controlSurface(width, chord, thickness = 0.04) {
  const geo = new THREE.BoxGeometry(width, thickness, chord);
  geo.translate(0, 0, -chord / 2);
  return geo;
}

export function makeWheel(radius, width, tireMat, hubMat) {
  const group = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  group.add(tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.04, 12), hubMat);
  hub.rotation.z = Math.PI / 2;
  group.add(hub);
  return group;
}

export function strutBetween(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 7), material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  mesh.castShadow = true;
  return mesh;
}

export function quad(points, material) {
  const geo = new THREE.BufferGeometry();
  const verts = [];
  for (const p of points) verts.push(p.x, p.y, p.z);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

export function navLight(color, size = 0.1, glowMap, glowSize = 1.2) {
  const group = new THREE.Group();
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), bulbMat);
  group.add(bulb);
  let sprite = null;
  if (glowMap) {
    const spriteMat = new THREE.SpriteMaterial({
      map: glowMap,
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    sprite = new THREE.Sprite(spriteMat);
    sprite.scale.setScalar(glowSize);
    group.add(sprite);
  }
  group.userData.bulbMat = bulbMat;
  group.userData.sprite = sprite;
  group.userData.color = new THREE.Color(color);
  return group;
}

export function landingLightGroup(color = 0xfff0c8) {
  const group = new THREE.Group();
  const light = new THREE.SpotLight(color, 0, 1200, 0.32, 0.55, 1.0);
  light.position.set(0, 0, 0);
  light.target.position.set(0, -8, 120);
  group.add(light);
  group.add(light.target);
  const lamp = new THREE.Mesh(
    new THREE.CircleGeometry(0.13, 12),
    new THREE.MeshBasicMaterial({ color: 0x332d1d })
  );
  lamp.position.set(0, 0, 0.015);
  group.add(lamp);
  group.userData.light = light;
  group.userData.lampMat = lamp.material;
  return group;
}

export function mirrorGeometryX(geo) {
  const mirrored = geo.clone();
  mirrored.scale(-1, 1, 1);
  const index = mirrored.index.array;
  for (let i = 0; i < index.length; i += 3) {
    const tmp = index[i];
    index[i] = index[i + 2];
    index[i + 2] = tmp;
  }
  mirrored.index.needsUpdate = true;
  mirrored.computeVertexNormals();
  return mirrored;
}

export function panelLineSegments(points, material) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geo, material);
}

export function makePropeller(radius, materials) {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  const bladeGeo = new THREE.BoxGeometry(0.11, radius * 2, 0.035);
  const blade = new THREE.Mesh(bladeGeo, materials.blade);
  blade.rotation.y = 0.28;
  blade.castShadow = true;
  spin.add(blade);
  group.add(spin);
  const spinner = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 0.22, radius * 0.55, 12),
    materials.spinner
  );
  spinner.rotation.x = Math.PI / 2;
  spinner.position.z = radius * 0.17;
  spinner.castShadow = true;
  group.add(spinner);
  group.userData.spin = spin;
  return group;
}
