// Shared math, procedural noise and atmosphere utilities.
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G = 9.80665;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const saturate = (v) => clamp(v, 0, 1);

export function smoothstep(edge0, edge1, x) {
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng, a, b) => a + (b - a) * rng();
export const randInt = (rng, a, b) => Math.floor(randRange(rng, a, b + 1));

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm(x, y, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridgedFbm(x, y, octaves = 5, lacunarity = 2.07, gain = 0.52) {
  let amp = 0.55;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * freq, y * freq) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Simple 1D smooth noise for turbulence / camera shake.
export function noise1(x, seed = 0) {
  return valueNoise(x, seed * 37.17) * 2 - 1;
}

// Scott AFB, Illinois. +X is east, +Z is north; the main runway is 14/32.
export const AIRFIELD_ELEVATION = 140;
export const AIRFIELD_FLAT_RADIUS = 3000;
export const AIRFIELD_BLEND_RADIUS = 6200;
export const RUNWAY_LENGTH = 3048;
export const RUNWAY_WIDTH = 46;
export const RUNWAY_HEADING = 140 * DEG;

// Active hangar bay at Scott. Kept here because the flight model, the showcase
// camera and the scenery all have to agree on where the aircraft stands.
export const HANGAR_BAY_U = -800;
export const HANGAR_BAY_V = 952;
export const HANGAR_APRON_V = 880;

export const SCOTT = { lat: 38.545, lon: -89.835 };

/**
 * The single source of truth for the landscape. Used by terrain meshes,
 * collision, scenery placement and the aircraft. Scott AFB sits on the flat
 * Mississippi flood plain east of Belleville: broad, gently rolling farmland
 * with no mountains and no desert. The airfield plateau is levelled so the
 * runways, taxiways and hangars sit on one plane.
 */
export function terrainHeight(x, z) {
  const macro = fbm(x * 0.000032 + 3.2, z * 0.000032 - 8.4, 4);
  const meso = fbm(x * 0.00028 - 1.1, z * 0.00028 + 2.7, 3);

  // Broad, almost imperceptible Illinois rolls: 12 m of relief over the whole
  // map, with a fine 2 m ripple to break up the silhouette.
  let h = AIRFIELD_ELEVATION - 5 + macro * 20 + (meso - 0.5) * 5;

  // A shallow drainage swale south-west of the field, the sort of wet ground
  // that shows up as a darker green line across the fields.
  const swale = 1 - smoothstep(1500, 5200, Math.abs(x * 0.6 + z * 0.8 + 14000));
  h -= swale * 2.2;

  // Flatten the airfield plateau.
  const d = Math.hypot(x, z);
  const af = 1 - smoothstep(AIRFIELD_FLAT_RADIUS, AIRFIELD_BLEND_RADIUS, d);
  h = lerp(h, AIRFIELD_ELEVATION, af);

  return h;
}

export function terrainNormal(x, z, out) {
  const e = 4;
  const hL = terrainHeight(x - e, z);
  const hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e);
  const hU = terrainHeight(x, z + e);
  const nx = hL - hR;
  const ny = 2 * e;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  if (out) {
    out.set(nx / len, ny / len, nz / len);
    return out;
  }
  return { x: nx / len, y: ny / len, z: nz / len };
}

export function terrainSlope(x, z) {
  const n = terrainNormal(x, z);
  return 1 - n.y;
}

export function altitudeAtmosphere(altitude) {
  const alt = clamp(altitude, 0, 30000);
  let temperature;
  let pressure;
  if (alt < 11000) {
    temperature = 288.15 - 0.0065 * alt;
    pressure = 101325 * Math.pow(temperature / 288.15, 5.25588);
  } else {
    temperature = 216.65;
    pressure = 22632.06 * Math.exp(-0.0001577 * (alt - 11000));
  }
  const density = pressure / (287.058 * temperature);
  const soundSpeed = Math.sqrt(1.4 * 287.058 * temperature);
  return { temperature, pressure, density, soundSpeed };
}

export function headingFromForward(forward) {
  const heading = Math.atan2(forward.x, forward.z) * RAD;
  return (heading + 360) % 360;
}

export function formatNumber(n, digits = 0) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function pad(n, width) {
  return String(n).padStart(width, '0');
}
