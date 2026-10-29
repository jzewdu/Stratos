import * as THREE from 'three';
import { fbm, mulberry32, valueNoise, clamp, smoothstep } from '../core/utils.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(canvas, { srgb = true, repeat = 1, aniso = 8, wrap = THREE.RepeatWrapping } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  if (repeat !== 1) tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

const cache = new Map();
function cached(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

/** Ground surface detail: a soft, high-frequency grayscale texture. */
export function terrainTexture() {
  return cached('terrain', () => {
    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        // Tileable-ish multi-scale noise.
        const n =
          0.55 * valueNoise(u * 64, v * 64) +
          0.28 * valueNoise(u * 160 + 13.7, v * 160 + 7.3) +
          0.17 * valueNoise(u * 384 + 51.2, v * 384 + 29.8);
        const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        const value = 198 + n * 46 + grain * 7;
        const i = (y * S + x) * 4;
        img.data[i] = value + 4;
        img.data[i + 1] = value + 2;
        img.data[i + 2] = value - 6;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas, { repeat: 1 });
  });
}

/** Normal map derived from gentle fbm, used for ground micro relief. */
export function terrainNormalTexture() {
  return cached('terrainNormal', () => {
    const S = 512;
    const heights = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        heights[y * S + x] =
          fbm((x / S) * 48, (y / S) * 48, 4) * 0.5 +
          fbm((x / S) * 150 + 7, (y / S) * 150 + 3, 2) * 0.2;
      }
    }
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const xl = heights[y * S + ((x - 1 + S) % S)];
        const xr = heights[y * S + ((x + 1) % S)];
        const yu = heights[((y - 1 + S) % S) * S + x];
        const yd = heights[((y + 1) % S) * S + x];
        let nx = (xl - xr) * 7;
        let ny = (yu - yd) * 7;
        const nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        const i = (y * S + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz / len) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas, { srgb: false });
  });
}

/**
 * Equirectangular cloud dome: soft cumulus bands with lit tops and shaded
 * bases, transparent between the clouds so the sky shows through.
 */
export function cloudDomeTexture() {
  return cached('cloudDome', () => {
    const W = 2048;
    const H = 1024;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const density = new Float32Array(W * H);
    const tileFbm = (u, v, scale, octaves) => {
      const a = fbm(u * scale, v * scale * 2, octaves);
      const b = fbm((u - 1) * scale, v * scale * 2, octaves);
      const c = fbm(u * scale, (v - 1) * scale * 2, octaves);
      const d = fbm((u - 1) * scale, (v - 1) * scale * 2, octaves);
      return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    };
    for (let y = 0; y < H; y++) {
      const v = y / H;
      // Canvas rows run top-down, so the texture's v coordinate (which the
      // sphere maps to altitude) is 1 - v. Keep the deck above the horizon
      // and thin it out overhead.
      const alt = 1 - v;
      const band = smoothstep(0.505, 0.55, alt) * (1 - smoothstep(0.88, 1.0, alt));
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const base = tileFbm(u, v, 4.5, 5);
        const detail = tileFbm(u, v, 16, 3);
        const streak = fbm(u * 2.2 + 3.1, v * 26 + 7.4, 4);
        const d = base * 0.62 + detail * 0.22 + streak * 0.16;
        density[y * W + x] = d;
        const alpha = clamp(smoothstep(0.40, 0.58, d) * band * 1.55, 0, 1);
        const i = (y * W + x) * 4;
        if (alpha <= 0.002) {
          img.data[i + 3] = 0;
          continue;
        }
        // Cheap volume shading: density gradient darkens the underside.
        const up = y > 0 ? density[(y - 1) * W + x] : d;
        const lit = clamp(0.72 + (d - up) * 4.4 + (d - 0.55) * 0.5, 0.4, 1.0);
        img.data[i] = clamp(255 * lit, 0, 255);
        img.data[i + 1] = clamp(252 * lit, 0, 255);
        img.data[i + 2] = clamp(248 * lit, 0, 255);
        img.data[i + 3] = clamp(alpha * 255, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas, { repeat: 1, aniso: 4 });
  });
}

/**
 * Seamlessly tileable low-frequency ground colour. Sampled across hundreds of
 * metres in the terrain shader so the 18 m detail tile stops being visible
 * from the air.
 */
export function terrainMacroTexture() {
  return cached('terrainMacro', () => {
    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    const tileFbm = (u, v, scale, octaves) => {
      const a = fbm(u * scale, v * scale, octaves);
      const b = fbm((u - 1) * scale, v * scale, octaves);
      const c = fbm(u * scale, (v - 1) * scale, octaves);
      const d = fbm((u - 1) * scale, (v - 1) * scale, octaves);
      return (
        a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
      );
    };
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const broad = tileFbm(u, v, 5, 4);
        const medium = tileFbm(u, v, 14, 3);
        const grit = valueNoise(u * 190, v * 190) * 0.06;
        const shade = 0.84 + broad * 0.26 + (medium - 0.5) * 0.1 + grit;
        const warm = (broad - 0.5) * 16;
        const i = (y * S + x) * 4;
        img.data[i] = clamp(198 * shade + warm, 0, 255);
        img.data[i + 1] = clamp(181 * shade + warm * 0.7, 0, 255);
        img.data[i + 2] = clamp(152 * shade + warm * 0.2, 0, 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas, { repeat: 1, aniso: 8 });
  });
}

/** Warm desert ground detail: sand, gravel and small pebbles. */
export function desertTexture() {
  return cached('desert', () => {
    const S = 1024;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    const rng = mulberry32(811);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const n =
          valueNoise(u * 42, v * 42) * 0.5 +
          valueNoise(u * 120 + 13.7, v * 120 + 7.3) * 0.3 +
          valueNoise(u * 320 + 51.2, v * 320 + 29.8) * 0.2;
        const grain = rng();
        const value = 198 + n * 42 + grain * 9;
        const i = (y * S + x) * 4;
        img.data[i] = clamp(value + 7, 0, 255);
        img.data[i + 1] = clamp(value + 1, 0, 255);
        img.data[i + 2] = clamp(value - 10, 0, 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Scattered pebbles and darker gravel patches.
    for (let i = 0; i < 1400; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const r = 0.6 + rng() * 2.2;
      ctx.fillStyle = `rgba(${80 + rng() * 50},${72 + rng() * 44},${60 + rng() * 38},${0.12 + rng() * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.6 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(canvas, { repeat: 1, aniso: 16 });
  });
}

/** Matching normal map for the desert detail texture. */
export function desertNormalTexture() {
  return cached('desertNormal', () => {
    const S = 1024;
    const heights = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        heights[y * S + x] =
          fbm(u * 38, v * 38, 4) * 0.5 +
          fbm(u * 120 + 7, v * 120 + 3, 3) * 0.24 +
          fbm(u * 300 + 11, v * 300 + 5, 2) * 0.1;
      }
    }
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const xl = heights[y * S + ((x - 1 + S) % S)];
        const xr = heights[y * S + ((x + 1) % S)];
        const yu = heights[((y - 1 + S) % S) * S + x];
        const yd = heights[((y + 1) % S) * S + x];
        let nx = (xl - xr) * 9;
        let ny = (yu - yd) * 9;
        const nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        const i = (y * S + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz / len) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas, { srgb: false, aniso: 16 });
  });
}

/**
 * Midwest pasture detail: cool green grass with dry and clover patches.
 * Used by the terrain at an 18 m tile, so it needs fine grain but no obvious
 * repeating shape.
 */
export function grassTexture() {
  return cached('grass', () => {
    const S = 1024;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    const rng = mulberry32(1904);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const broad = valueNoise(u * 18 + 3.1, v * 18 - 4.2);
        const fine = valueNoise(u * 150 + 11.4, v * 150 + 7.8);
        const grain = rng();
        const dry = smoothstep(0.58, 0.82, broad + (fine - 0.5) * 0.18);
        const value = 0.82 + broad * 0.24 + (fine - 0.5) * 0.22 + (grain - 0.5) * 0.06;
        const i = (y * S + x) * 4;
        img.data[i] = clamp((74 + value * 42) * (1 - dry * 0.18) + dry * 34, 0, 255);
        img.data[i + 1] = clamp((88 + value * 46) * (1 - dry * 0.08) + dry * 22, 0, 255);
        img.data[i + 2] = clamp((46 + value * 24) * (1 - dry * 0.25) + dry * 14, 0, 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Short blade strokes give the tile a direction and scale that noise alone
    // cannot. They are low-contrast so they disappear at altitude.
    for (let i = 0; i < 5200; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const len = 1.5 + rng() * 4.5;
      const lean = (rng() - 0.5) * 2.6;
      const light = 0.35 + rng() * 0.4;
      ctx.strokeStyle = `rgba(${60 + light * 38},${86 + light * 44},${38 + light * 24},${0.16 + rng() * 0.22})`;
      ctx.lineWidth = 0.6 + rng() * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + lean, y - len);
      ctx.stroke();
    }
    // Clover / weed clumps.
    for (let i = 0; i < 240; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const r = 2 + rng() * 9;
      ctx.fillStyle = `rgba(${50 + rng() * 30},${76 + rng() * 34},${36 + rng() * 20},${0.05 + rng() * 0.09})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(canvas, { repeat: 1, aniso: 16 });
  });
}

/** A dark photovoltaic panel with a fine cell grid. */
export function solarPanelTexture() {
  return cached('solar', () => {
    const S = 256;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#10243a';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(90,150,190,0.34)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const p = (i / 8) * S;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(S, p);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(180,220,255,0.08)';
    for (let i = 0; i < 18; i++) {
      ctx.fillRect(8 + (i % 6) * 40, 10 + Math.floor(i / 6) * 76, 26, 58);
    }
    return finish(canvas, { repeat: 1 });
  });
}

/** Text plate for base signage and hangar names. */
export function signTexture(text, { bg = '#1b1e20', fg = '#f2f0e8', accent = '#c8a34a', size = 120 } = {}) {
  return cached(`sign:${text}:${bg}:${fg}:${accent}:${size}`, () => {
    const W = 1024;
    const H = 256;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.fillStyle = fg;
    ctx.font = `700 ${size}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2 + 2);
    return finish(canvas, { srgb: true, wrap: THREE.ClampToEdgeWrapping, aniso: 16 });
  });
}

export function asphaltTexture() {
  return cached('asphalt', () => {
    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#4b4c4b';
    ctx.fillRect(0, 0, S, S);
    const img = ctx.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const n = valueNoise(x * 0.13, y * 0.13) * 22 + valueNoise(x * 0.55, y * 0.55) * 12;
        img.data[i] = clamp(76 + n, 0, 255);
        img.data[i + 1] = clamp(77 + n, 0, 255);
        img.data[i + 2] = clamp(78 + n, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    // Faint tar seams and wear.
    const rng = mulberry32(7);
    ctx.strokeStyle = 'rgba(20,20,22,0.30)';
    for (let i = 0; i < 7; i++) {
      ctx.lineWidth = 1 + rng() * 2;
      ctx.beginPath();
      let x = rng() * S;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < S) {
        y += 24 + rng() * 30;
        x += (rng() - 0.5) * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120,115,100,0.025)';
    for (let i = 0; i < 60; i++) {
      ctx.beginPath();
      ctx.arc(rng() * S, rng() * S, 5 + rng() * 35, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(canvas, { repeat: 1 });
  });
}

export function concreteTexture() {
  return cached('concrete', () => {
    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#a5a198';
    ctx.fillRect(0, 0, S, S);
    const img = ctx.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const n = (valueNoise(x * 0.2, y * 0.2) - 0.5) * 26 + (valueNoise(x * 0.9, y * 0.9) - 0.5) * 12;
        img.data[i] = clamp(img.data[i] + n, 0, 255);
        img.data[i + 1] = clamp(img.data[i + 1] + n, 0, 255);
        img.data[i + 2] = clamp(img.data[i + 2] + n, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(62,59,53,0.35)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((i * S) / 4, 0);
      ctx.lineTo((i * S) / 4, S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i * S) / 4);
      ctx.lineTo(S, (i * S) / 4);
      ctx.stroke();
    }
    return finish(canvas, { repeat: 1 });
  });
}

/** Warm lit window pattern for night towns. */
export function facadeTextures(variant = 0) {
  return cached(`facade${variant}`, () => {
    const W = 256;
    const H = 512;
    const mapCanvas = makeCanvas(W, H);
    const emissiveCanvas = makeCanvas(W, H);
    const ctx = mapCanvas.getContext('2d');
    const ectx = emissiveCanvas.getContext('2d');
    ctx.fillStyle = variant === 0 ? '#8f8d85' : '#a39c90';
    ctx.fillRect(0, 0, W, H);
    ectx.fillStyle = '#000000';
    ectx.fillRect(0, 0, W, H);

    // Concrete banding.
    for (let y = 0; y < H; y += 8) {
      ctx.fillStyle = `rgba(50,50,48,${0.03 + (y % 16 === 0 ? 0.04 : 0)})`;
      ctx.fillRect(0, y, W, 2);
    }

    const rng = mulberry32(43 + variant * 11);
    const cols = 4;
    const rows = 11;
    const cellW = W / cols;
    const cellH = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cellW + cellW * 0.18;
        const y = r * cellH + cellH * 0.2;
        const w = cellW * 0.64;
        const h = cellH * 0.52;
        ctx.fillStyle = '#262e33';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(170,200,210,0.12)';
        ctx.fillRect(x + 2, y + 2, w - 4, h * 0.35);
        if (rng() > 0.45) {
          const warm = rng() > 0.2;
          ectx.fillStyle = warm ? 'rgba(255,190,110,0.92)' : 'rgba(190,220,255,0.8)';
          ectx.fillRect(x + 1, y + 1, w - 2, h - 2);
          // Window mullion.
          ectx.fillStyle = 'rgba(0,0,0,0.7)';
          ectx.fillRect(x + w / 2 - 1, y, 2, h);
        }
      }
    }
    return {
      map: finish(mapCanvas),
      emissive: finish(emissiveCanvas),
    };
  });
}

export function cloudPuffTexture() {
  return cached('cloud', () => {
    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        // Elliptical envelope: flat, wide cumulus with a soft edge.
        const dx = (u - 0.5) * 2;
        const dy = (v - 0.52) * 2;
        const r = Math.sqrt(dx * dx + dy * dy * 1.5);
        const envelope = clamp(1 - r, 0, 1);
        const envelopeSoft = envelope * envelope * (3 - 2 * envelope);
        const billow =
          fbm(u * 7.5 + 2.3, v * 7.5 - 1.1, 5) * 0.62 +
          fbm(u * 17 + 8.1, v * 17 + 3.7, 3) * 0.26 +
          fbm(u * 34 - 4.2, v * 34 + 9.4, 2) * 0.12;
        const density = clamp((billow - 0.42) * 3.0, 0, 1) * envelopeSoft;
        const topLight = clamp(0.5 + (0.45 - v) * 1.25, 0.15, 1);
        const relief = clamp(0.78 + (billow - 0.5) * 0.55, 0.45, 1.05);
        const shade = clamp(topLight * relief, 0.2, 1) * 255;
        const alpha = clamp(density * 1.15, 0, 1) * 255;
        const i = (y * S + x) * 4;
        img.data[i] = shade;
        img.data[i + 1] = shade * 0.995;
        img.data[i + 2] = shade * 0.985;
        img.data[i + 3] = alpha;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  });
}

export function waterNormalTexture() {
  return cached('waterNormal', () => {
    const S = 512;
    const heights = new Float32Array(S * S);
    const rng = mulberry32(31);
    const waves = [];
    for (let i = 0; i < 9; i++) {
      const fx = Math.round(1 + rng() * 5);
      const fy = Math.round(1 + rng() * 5);
      waves.push({
        fx,
        fy,
        phase: rng() * Math.PI * 2,
        amp: 0.5 / (1 + fx + fy),
      });
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let h = 0;
        for (const w of waves) {
          h += Math.sin(((x / S) * w.fx + (y / S) * w.fy) * Math.PI * 2 + w.phase) * w.amp;
        }
        heights[y * S + x] = h;
      }
    }
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    const strength = 2.4;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const xl = heights[y * S + ((x - 1 + S) % S)];
        const xr = heights[y * S + ((x + 1) % S)];
        const yu = heights[((y - 1 + S) % S) * S + x];
        const yd = heights[((y + 1) % S) * S + x];
        let nx = (xl - xr) * strength;
        let ny = (yu - yd) * strength;
        const nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        const i = (y * S + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz / len) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas, { srgb: false, repeat: 1 });
  });
}

export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return cached(`glow${inner}${outer}`, () => {
    const S = 128;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, inner);
    g.addColorStop(0.6, outer.replace(/[\d.]+\)$/, '0.18)'));
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return finish(canvas, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  });
}

export function starTexture() {
  return cached('star', () => {
    const S = 64;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(205,225,255,0.28)');
    g.addColorStop(1, 'rgba(180,210,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return finish(canvas, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  });
}

export function moonTexture() {
  return cached('moon', () => {
    const S = 256;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,252,242,1)');
    g.addColorStop(0.42, 'rgba(245,240,226,1)');
    g.addColorStop(0.48, 'rgba(220,225,235,0.6)');
    g.addColorStop(0.62, 'rgba(170,195,230,0.18)');
    g.addColorStop(1, 'rgba(150,180,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // Craters.
    const rng = mulberry32(11);
    ctx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 22; i++) {
      const x = S / 2 + (rng() - 0.5) * S * 0.4;
      const y = S / 2 + (rng() - 0.5) * S * 0.4;
      const r = 2 + rng() * 11;
      ctx.fillStyle = `rgba(140,145,155,${0.06 + rng() * 0.11})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.stroke();
    }
    return finish(canvas, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  });
}

export function propBlurTexture() {
  return cached('propBlur', () => {
    const S = 256;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2;
    const cy = S / 2;
    ctx.translate(cx, cy);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, S / 2 - 4);
      grad.addColorStop(0, 'rgba(40,40,40,0.0)');
      grad.addColorStop(0.2, 'rgba(35,35,38,0.12)');
      grad.addColorStop(0.9, 'rgba(20,20,22,0.34)');
      grad.addColorStop(1, 'rgba(20,20,22,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, S / 2 - 2, a - 0.16, a + 0.16);
      ctx.lineTo(0, 0);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, S / 2 - 14, a, a + 0.1);
      ctx.stroke();
    }
    return finish(canvas, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  });
}

export function runwayNumberTexture(text) {
  return cached(`runwayNumber${text}`, () => {
    const W = 256;
    const H = 384;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(245,245,238,0.96)';
    ctx.font = `bold ${text.length > 2 ? 142 : 210}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2);
    return finish(canvas, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  });
}

export function tailNumberTexture(text) {
  return cached(`tailNumber${text}`, () => {
    const W = 256;
    const H = 64;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,22,26,0.9)';
    ctx.font = 'bold 44px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2 + 2);
    return finish(canvas, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  });
}

export function smokeTexture() {
  return cached('smoke', () => {
    const S = 128;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.4, 'rgba(230,230,230,0.32)');
    g.addColorStop(1, 'rgba(200,200,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return finish(canvas, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  });
}
