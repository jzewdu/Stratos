import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';

// ---------------------------------------------------------------------------
// Shared procedural finishes for the aircraft: painted skin with panel lines
// and rivets, matte radar-absorbent coatings, stencils, national insignia and
// a few small cockpit/propeller textures.  Everything is generated at boot so
// the sim stays asset-free.
// ---------------------------------------------------------------------------

const cache = new Map();

function cached(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function toTexture(canvas, { srgb = true, wrap = THREE.RepeatWrapping } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = wrap;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

const VARIANTS = {
  // Glossy cream/white aircraft enamel.
  paint: {
    base: '#e9e5d9',
    seam: 'rgba(120,114,98,0.55)',
    rivet: 'rgba(150,144,128,0.5)',
    mottle: 9,
    rough: 0.44,
    metal: 0.22,
  },
  // Bare polished aluminium.
  metal: {
    base: '#c8cccd',
    seam: 'rgba(92,98,102,0.55)',
    rivet: 'rgba(110,116,120,0.45)',
    mottle: 12,
    rough: 0.3,
    metal: 0.85,
  },
  // Radar-absorbent coating on the B-2: dark, matte, very low contrast.
  stealth: {
    base: '#5b6165',
    seam: 'rgba(38,42,46,0.7)',
    rivet: 'rgba(72,78,83,0.35)',
    mottle: 9,
    rough: 0.64,
    metal: 0.16,
  },
  // F-22 low-observable grey.
  fighter: {
    base: '#98a0a5',
    seam: 'rgba(96,104,110,0.5)',
    rivet: 'rgba(120,128,134,0.32)',
    mottle: 8,
    rough: 0.46,
    metal: 0.42,
  },
};

function buildPanelCanvases(variant) {
  const cfg = VARIANTS[variant] || VARIANTS.paint;
  const S = 1024;
  const rng = mulberry32(variant.length * 7717 + 31);

  const albedo = makeCanvas(S, S);
  const a = albedo.getContext('2d');
  a.fillStyle = cfg.base;
  a.fillRect(0, 0, S, S);

  // Broad tonal blotches, as if panels were painted on different days.
  for (let i = 0; i < 90; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 30 + rng() * 150;
    const g = a.createRadialGradient(x, y, 0, x, y, r);
    const light = rng() > 0.5;
    g.addColorStop(0, `rgba(${light ? 255 : 0},${light ? 255 : 0},${light ? 255 : 0},${0.012 + rng() * 0.02})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = g;
    a.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine grain so large flat areas are never perfectly smooth.
  const img = a.getImageData(0, 0, S, S);
  const d = img.data;
  const grain = cfg.mottle;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * grain;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  a.putImageData(img, 0, 0);

  const normal = makeCanvas(S, S);
  const n = normal.getContext('2d');
  n.fillStyle = 'rgb(128,128,255)';
  n.fillRect(0, 0, S, S);

  const rough = makeCanvas(S, S);
  const r = rough.getContext('2d');
  const baseRough = Math.round(cfg.rough * 255);
  r.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`;
  r.fillRect(0, 0, S, S);

  const seam = (x1, y1, x2, y2, weight = 1) => {
    // Albedo: a thin dark groove.
    a.strokeStyle = cfg.seam;
    a.lineWidth = weight;
    a.beginPath();
    a.moveTo(x1, y1);
    a.lineTo(x2, y2);
    a.stroke();
    // Normal map: offset highlight/shadow pair makes a shallow groove.
    n.strokeStyle = 'rgba(108,108,255,0.9)';
    n.lineWidth = 2;
    n.beginPath();
    n.moveTo(x1, y1 - 1.5);
    n.lineTo(x2, y2 - 1.5);
    n.stroke();
    n.strokeStyle = 'rgba(150,150,255,0.9)';
    n.beginPath();
    n.moveTo(x1, y1 + 1.5);
    n.lineTo(x2, y2 + 1.5);
    n.stroke();
    // Panel edges collect grime and read slightly rougher.
    r.strokeStyle = `rgba(${baseRough + 45},${baseRough + 45},${baseRough + 45},0.55)`;
    r.lineWidth = weight + 2;
    r.beginPath();
    r.moveTo(x1, y1);
    r.lineTo(x2, y2);
    r.stroke();
  };

  const rivet = (x, y, size = 1.5) => {
    a.fillStyle = cfg.rivet;
    a.beginPath();
    a.arc(x, y, size, 0, Math.PI * 2);
    a.fill();
    n.fillStyle = 'rgba(168,168,255,0.7)';
    n.beginPath();
    n.arc(x, y - 0.7, size, 0, Math.PI * 2);
    n.fill();
    n.fillStyle = 'rgba(102,102,255,0.5)';
    n.beginPath();
    n.arc(x, y + 0.9, size, 0, Math.PI * 2);
    n.fill();
  };

  // Main panel grid.
  const rows = 5 + Math.floor(rng() * 2);
  const cols = 5 + Math.floor(rng() * 2);
  const ys = [];
  const xs = [];
  for (let i = 0; i < rows; i++) ys.push((i / rows) * S + (rng() - 0.5) * 60);
  for (let i = 0; i < cols; i++) xs.push((i / cols) * S + (rng() - 0.5) * 60);

  for (const y of ys) {
    seam(0, y, S, y, 1.4);
    for (let x = 8; x < S; x += 13) rivet(x, y - 4, 1.2);
  }
  for (const x of xs) {
    seam(x, 0, x, S, 1.4);
    for (let y = 14; y < S; y += 15) rivet(x + 4, y, 1.1);
  }

  // A few access panels with denser fastener rings.
  for (let i = 0; i < 9; i++) {
    const px = Math.floor(rng() * S);
    const py = Math.floor(rng() * S);
    const w = 60 + rng() * 150;
    const h = 45 + rng() * 110;
    seam(px, py, px + w, py, 1.2);
    seam(px + w, py, px + w, py + h, 1.2);
    seam(px + w, py + h, px, py + h, 1.2);
    seam(px, py + h, px, py, 1.2);
    for (let x = px + 8; x < px + w; x += 12) {
      rivet(x, py + 5, 1);
      rivet(x, py + h - 5, 1);
    }
    for (let y = py + 8; y < py + h; y += 12) {
      rivet(px + 5, y, 1);
      rivet(px + w - 5, y, 1);
    }
  }

  return { albedo, normal, rough, cfg };
}

function panelCanvases(variant) {
  return cached(`panels:${variant}`, () => buildPanelCanvases(variant));
}

/**
 * Skin material with tiled panel-line, normal and roughness maps.
 * `repeat` controls how many times the panel tile is repeated on the mesh.
 */
export function skinMaterial({
  variant = 'paint',
  color = 0xffffff,
  repeat = [2, 2],
  metalness,
  roughness,
  clearcoat = 0.35,
  clearcoatRoughness = 0.3,
  envMapIntensity = 1.15,
  specularIntensity = 0.5,
} = {}) {
  const { albedo, normal, rough, cfg } = panelCanvases(variant);
  const map = toTexture(albedo);
  const normalMap = toTexture(normal, { srgb: false });
  const roughnessMap = toTexture(rough, { srgb: false });
  for (const t of [map, normalMap, roughnessMap]) t.repeat.set(repeat[0], repeat[1]);

  return new THREE.MeshPhysicalMaterial({
    color,
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughnessMap,
    metalness: metalness ?? cfg.metal,
    roughness: roughness ?? 1,
    clearcoat,
    clearcoatRoughness,
    envMapIntensity,
    specularIntensity,
  });
}

/** Flat painted material for small parts (no UV detail needed). */
export function paintMaterial(color, { metalness = 0.3, roughness = 0.4, clearcoat = 0.5 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness,
    roughness,
    clearcoat,
    clearcoatRoughness: 0.25,
    envMapIntensity: 1.15,
  });
}

export function rubberMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x121213, roughness: 0.88, metalness: 0.02 });
}

export function chromeMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd7dbdc,
    metalness: 1,
    roughness: 0.16,
    clearcoat: 0.6,
    envMapIntensity: 1.5,
  });
}

export function titaniumMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x8b8f92, metalness: 0.95, roughness: 0.34 });
}

/** Gold-tinted canopy coating (F-22 style). */
export function canopyMaterial({ gold = false, tint = 0x51646b, opacity = 0.42 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: gold ? 0xc9a86a : tint,
    metalness: gold ? 0.85 : 0.35,
    roughness: gold ? 0.08 : 0.04,
    transparent: true,
    opacity,
    iridescence: gold ? 1 : 0,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [120, 520],
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 2.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/** Canvas-backed text used for registrations, codes and stencils. */
export function textTexture(
  text,
  {
    color = '#1a1c1f',
    size = 128,
    weight = 700,
    font = '"Arial Narrow", Arial, sans-serif',
    italic = false,
    spacing = 0,
    outline = null,
    opacity = 1,
    padding = 24,
  } = {}
) {
  const key = `text:${text}:${color}:${size}:${weight}:${font}:${italic}:${spacing}:${outline}:${opacity}:${padding}`;
  return cached(key, () => {
    const measure = makeCanvas(8, 8).getContext('2d');
    measure.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
    const chars = [...text];
    let width = 0;
    for (const c of chars) width += measure.measureText(c).width + spacing;
    const W = Math.ceil(width + padding * 2);
    const H = Math.ceil(size * 1.5 + padding * 2);
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = opacity;
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.lineWidth = Math.max(2, size * 0.06);
      ctx.strokeStyle = outline;
      let x = padding;
      for (const c of chars) {
        ctx.strokeText(c, x, H / 2 + size * 0.05);
        x += ctx.measureText(c).width + spacing;
      }
    }
    ctx.fillStyle = color;
    let x = padding;
    for (const c of chars) {
      ctx.fillText(c, x, H / 2 + size * 0.05);
      x += ctx.measureText(c).width + spacing;
    }
    return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
  });
}

/** Standard United States star-and-bar insignia. */
export function insigniaTexture({ subdued = false, border = true } = {}) {
  const key = `insignia:${subdued}:${border}`;
  return cached(key, () => {
    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const white = subdued ? '#8c9297' : '#f2f3f1';
    const blue = subdued ? '#5a6167' : '#1d3459';
    const red = subdued ? '#6a6f74' : '#a5232c';

    // Side bars.
    ctx.fillStyle = white;
    ctx.fillRect(38, 206, 140, 100);
    ctx.fillRect(334, 206, 140, 100);
    if (border) {
      ctx.strokeStyle = blue;
      ctx.lineWidth = 10;
      ctx.strokeRect(38, 206, 140, 100);
      ctx.strokeRect(334, 206, 140, 100);
    }

    // Blue disc.
    ctx.fillStyle = blue;
    ctx.beginPath();
    ctx.arc(256, 256, 150, 0, Math.PI * 2);
    ctx.fill();
    if (border) {
      ctx.strokeStyle = white;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(256, 256, 145, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Five-pointed star.
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? 132 : 54;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = 256 + Math.cos(angle) * radius;
      const py = 256 + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = white;
    ctx.fill();

    // Thin red stripe through each bar (1947 pattern).
    ctx.fillStyle = red;
    ctx.fillRect(38, 248, 140, 7);
    ctx.fillRect(334, 248, 140, 7);

    return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
  });
}

/** Horizontal cheatline / pinstripe used as a decal on the fuselage sides. */
export function stripeTexture({
  color = '#a5232c',
  secondary = '#7d1a22',
} = {}) {
  return cached(`stripe:${color}:${secondary}`, () => {
    const W = 512;
    const H = 256;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color;
    ctx.fillRect(0, 102, W, 54);
    ctx.fillStyle = secondary;
    ctx.fillRect(0, 164, W, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(0, 106, W, 5);
    return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
  });
}

/** Instrument-panel face: dark panel with a believable gauge cluster. */
export function instrumentPanelTexture() {
  return cached('instrument-panel', () => {
    const W = 1024;
    const H = 256;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b1d20';
    ctx.fillRect(0, 0, W, H);
    const rng = mulberry32(99);
    for (let i = 0; i < 7; i++) {
      const x = 110 + i * 135;
      const y = 96;
      ctx.fillStyle = '#0d0f11';
      ctx.beginPath();
      ctx.arc(x, y, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a9adb2';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#d9dde0';
      ctx.lineWidth = 2;
      for (let t = 0; t < 12; t++) {
        const ang = (t / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * 36, y + Math.sin(ang) * 36);
        ctx.lineTo(x + Math.cos(ang) * 42, y + Math.sin(ang) * 42);
        ctx.stroke();
      }
      const needle = rng() * Math.PI * 2;
      ctx.strokeStyle = '#e8b36a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(needle) * 33, y + Math.sin(needle) * 33);
      ctx.stroke();
      ctx.fillStyle = '#6b7075';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Radio stack.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#101214';
      ctx.fillRect(100 + i * 170, 176, 150, 48);
      ctx.strokeStyle = '#33383c';
      ctx.strokeRect(100 + i * 170, 176, 150, 48);
      ctx.fillStyle = '#7fe0a8';
      ctx.font = '600 22px monospace';
      ctx.fillText(`122.${String(70 + i * 5).padStart(3, '0')}`, 112 + i * 170, 208);
    }
    return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
  });
}

/** Propeller blade finish: black with yellow tips and a worn metal edge. */
export function propellerBladeTexture() {
  return cached('prop-blade', () => {
    const W = 128;
    const H = 512;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#191a1c';
    ctx.fillRect(0, 0, W, H);
    // Slight sheen variation along the blade.
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.01 + Math.random() * 0.02})`;
      ctx.fillRect(0, Math.random() * H, W, 1 + Math.random() * 3);
    }
    // Yellow tip band (v = 0 is root when mapped by radius).
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.12);
    grad.addColorStop(0, '#d8a427');
    grad.addColorStop(1, '#b9871f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H * 0.11);
    ctx.fillStyle = 'rgba(20,20,20,0.35)';
    ctx.fillRect(0, H * 0.02, W, 3);
    return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
  });
}

/** Soft roundel used behind insignia for a little paint contrast. */
export function exhaustStainTexture() {
  return cached('exhaust-stain', () => {
    const S = 256;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(S * 0.5, S * 0.35, 8, S * 0.5, S * 0.5, S * 0.55);
    g.addColorStop(0, 'rgba(18,18,18,0.65)');
    g.addColorStop(0.45, 'rgba(30,28,26,0.28)');
    g.addColorStop(1, 'rgba(30,28,26,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
  });
}
