/**
 * Graphics quality tiers.
 *
 * Every tier is a complete description of what the frame costs, because the
 * expensive things here are all-or-nothing: GTAO renders the whole scene a
 * second time for normals, bloom and SMAA are fullscreen, and the shadow map is
 * re-rendered every frame.
 *
 * The resolution a tier allows is a cap on devicePixelRatio, not a fixed scale:
 * `scale` (managed by the governor in main.js) multiplies it at runtime so a
 * machine that misses 60fps loses pixels instead of frames.
 */
export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];

export const QUALITY_SETTINGS = {
  low: {
    label: 'Low',
    pixelRatioCap: 1,
    msaa: 0,
    gtao: false,
    bloom: false,
    smaa: false,
    shadowMap: 1024,
    shadowRadius: 1.4,
    vegetation: 0.3,
    renderScale: 1,
  },
  medium: {
    // Integrated GPUs live here by default. A 1.25 DPR ceiling and 0.9 render
    // scale keep a 1080p Iris Xe/Xe2 frame affordable without giving up bloom,
    // SMAA or a usable shadow map.
    label: 'Medium',
    pixelRatioCap: 1.25,
    msaa: 0,
    gtao: false,
    bloom: true,
    smaa: true,
    shadowMap: 1536,
    shadowRadius: 1.7,
    vegetation: 0.65,
    renderScale: 0.9,
  },
  high: {
    label: 'High',
    pixelRatioCap: 1.5,
    msaa: 0,
    gtao: true,
    gtaoScale: 0.5,
    gtaoSamples: 8,
    gtaoPdSamples: 6,
    gtaoRings: 1,
    blendIntensity: 0.55,
    bloom: true,
    smaa: true,
    shadowMap: 2048,
    shadowRadius: 2.0,
    vegetation: 0.72,
    renderScale: 1,
  },
  ultra: {
    label: 'Ultra',
    pixelRatioCap: 2,
    msaa: 4,
    gtao: true,
    gtaoScale: 0.5,
    gtaoSamples: 12,
    gtaoPdSamples: 8,
    gtaoRings: 2,
    blendIntensity: 0.62,
    bloom: true,
    smaa: true,
    shadowMap: 4096,
    shadowRadius: 2.2,
    vegetation: 1,
    renderScale: 1,
  }
};

export const MIN_RENDER_SCALE = 0.6;

// Renderer strings come from ANGLE, D3D, Metal or a driver shim, so match the
// family rather than one vendor's exact wording. Discrete is tested first:
// Intel Arc and Apple M-series Pro/Max are fast despite matching "intel"/"apple".
const SOFTWARE_GPU =
  /swiftshader|llvmpipe|softpipe|software (rasterizer|renderer)|microsoft basic (render|display)/i;
const DISCRETE_GPU =
  /nvidia|geforce|quadro|rtx\s?\d|\bgtx\s?\d|radeon\s?(rx|pro|vii)|\brx\s?\d{3,4}\b|arc\b.*?[ab]\d{3}|apple\s?m\d\s?(pro|max|ultra)/i;
const INTEGRATED_GPU =
  /intel|iris|uhd|hd graphics|radeon.*graphics|vega|apple\s?m\d|mali|adreno|powervr|gfx\d/i;

function readGpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  } catch {
    /* Renderer info is optional and can be blocked for fingerprinting. */
  }
  return '';
}

function screenMegapixels() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return (window.innerWidth * window.innerHeight * dpr * dpr) / 1e6;
}

/**
 * Pick a starting tier from the GPU family and the number of physical pixels.
 *
 * `known: false` means the browser hid the renderer string; start conservative
 * and let the governor climb rather than assuming a flagship.
 */
export function detectQualityInfo(renderer) {
  const gpu = readGpuName(renderer);
  const megapixels = screenMegapixels();
  const software = SOFTWARE_GPU.test(gpu);
  const discrete = DISCRETE_GPU.test(gpu);
  const integrated = !discrete && INTEGRATED_GPU.test(gpu);
  const known = Boolean(gpu) && !software;

  let tier;
  if (software) {
    tier = 'low';
  } else if (discrete) {
    // 4K or a high-DPI 1440p panel: keep headroom for GTAO and 4x MSAA.
    tier = megapixels > 8 ? 'high' : 'ultra';
  } else if (integrated) {
    // Iris Xe / UHD / Radeon Vega / Apple base silicon. Big panels need the
    // low tier; 1440p and below start at medium with a reduced render scale.
    tier = megapixels > 8 ? 'low' : 'medium';
  } else {
    // Unknown: conservative medium for normal panels, low for 4K. The
    // governor may climb once it has measured real headroom.
    tier = megapixels > 8 ? 'low' : 'medium';
  }

  return { tier, gpu, known, megapixels };
}

/** Best guess at a starting tier from the GPU string and the pixel count. */
export function detectQuality(renderer) {
  return detectQualityInfo(renderer).tier;
}
