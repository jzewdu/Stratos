import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { SkySystem, TIME_PRESETS } from './world/sky.js';
import { Terrain } from './world/terrain.js';
import { Scenery } from './world/scenery.js';
import { createAircraft } from './aircraft/models.js';
import { loadAircraftModels } from './aircraft/imported.js';
import { AIRCRAFT_SPECS, CONTROL_LEVELS, specFor } from './aircraft/specs.js';
import { FlightPhysics } from './flight/flight.js';
import { InputManager } from './game/input.js';
import { SimCamera } from './game/camera.js';
import { Effects } from './game/effects.js';
import { Soundscape } from './game/audio.js';
import { HUD } from './ui/hud.js';
import { Dogfight } from './combat/dogfight.js';
import { UI } from './ui/ui.js';
import {
  AIRFIELD_ELEVATION,
  RUNWAY_HEADING,
  HANGAR_BAY_U,
  HANGAR_BAY_V,
  clamp,
  pad,
  DEG,
  smoothstep,
  terrainHeight,
} from './core/utils.js';
import {
  MIN_RENDER_SCALE,
  QUALITY_LEVELS,
  QUALITY_SETTINGS,
  detectQualityInfo,
} from './core/quality.js';

const TIME_ORDER = ['day', 'golden', 'night', 'dawn'];
const FIXED_DT = 1 / 120;
const QUALITY_KEY = 'flightsim.quality';
const MIN_FOLIAGE = 0.25;

function airfieldPoint(u, v) {
  const sin = Math.sin(RUNWAY_HEADING);
  const cos = Math.cos(RUNWAY_HEADING);
  return { x: u * sin - v * cos, z: u * cos + v * sin };
}

function readQualityPref() {
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved && ['auto', ...QUALITY_LEVELS].includes(saved)) return saved;
  } catch {
    /* Storage can be blocked; fall back to auto. */
  }
  return 'auto';
}

class Game {
  constructor() {
    this.canvas = document.getElementById('viewport');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      // Nothing is drawn straight to the canvas: the composer owns antialiasing
      // (MSAA buffer + SMAA), so a multisampled default framebuffer would only
      // cost memory and fill rate on the final fullscreen quad.
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });

    // Start from the detected GPU, then let the governor trade resolution for
    // frame rate. A saved choice from the pause menu overrides detection.
    const savedQuality = readQualityPref();
    const detected = savedQuality === 'auto' ? detectQualityInfo(this.renderer) : null;
    this.quality = {
      mode: savedQuality,
      tier: detected ? detected.tier : savedQuality,
      // A known GPU is trusted as the ceiling: the governor may fall back to it
      // but never quietly promotes an Iris Xe to ultra. With a hidden renderer
      // string the ceiling stays open so measured headroom can raise the tier.
      ceiling: detected
        ? detected.known
          ? detected.tier
          : QUALITY_LEVELS[QUALITY_LEVELS.length - 1]
        : savedQuality,
      scale: 1,
      foliage: 1,
      holdUntil: 0,
      stable: 0,
      perfTime: 0,
      perfFrames: 0,
      upLockUntil: 0,
      probe: null,
    };
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.qualitySettings().pixelRatioCap)
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05080a);
    this.camera = new THREE.PerspectiveCamera(
      48,
      window.innerWidth / window.innerHeight,
      0.3,
      350000
    );
    this.camera.position.set(0, 80, 80);
    this.camera.lookAt(0, 20, 0);

    this.lastFrame = 0;
    this.time = 0;
    this.fps = 60;
    this.accumulator = 0;
    this.hitShake = 0;
    this.combat = null;
    this.state = 'loading';
    this.lastState = 'loading';
    this.crashShown = false;
    this.wasOnGround = false;
    this.showcaseAngle = 1.02;
    this.forceLights = false;

    this.selection = {
      aircraftId: 'cessna170',
      controlId: 'pilot',
      startMode: 'airborne',
      hours: TIME_PRESETS.golden.hours,
    };
    this.spec = specFor(this.selection.aircraftId);

    this.input = new InputManager();
    this.input.enabled = false;
    this.input.onAction = (action) => this.handleAction(action);

    this.hud = new HUD(document.getElementById('hud-canvas'));
    this.simCamera = new SimCamera(this.camera);
    this.sound = new Soundscape();

    this.ui = new UI(document.getElementById('ui'), {
      onAircraft: (id) => this.selectAircraft(id),
      onEnvironment: (key) => this.setEnvironment(key),
      onControl: (id) => this.setControl(id),
      onStartMode: (mode) => this.setStartMode(mode),
      onTime: (hours) => this.setTime(hours),
      onLaunch: () => this.startFlight(),
      onResume: () => this.resumeFlight(),
      onRestart: () => this.restartFlight(),
      onHangar: () => this.returnToHangar(),
      onHelp: () => this.toggleHelp(),
      onCloseHelp: () => this.closeHelp(),
      onSoundToggle: () => this.toggleSound(),
      onQuality: (mode) => this.setQuality(mode),
    });
    this.ui.setSoundLabel(false);

    this.setupPostProcessing();
    this.bindWindow();
    this.init();

    window.addEventListener('beforeunload', () => this.sound.stop());
  }

  qualitySettings() {
    return QUALITY_SETTINGS[this.quality.tier] || QUALITY_SETTINGS.medium;
  }

  /**
   * Push the active tier (and the governor's resolution scale) into the
   * renderer, the composer and every pass that has a tunable cost.
   */
  applyQuality() {
    if (!this.composer) return;
    const q = this.qualitySettings();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const base = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap);
    const pr = Math.max(0.35, base * (q.renderScale ?? 1) * this.quality.scale);

    this.renderer.setPixelRatio(pr);
    // EffectComposer resizes its render targets, not the canvas: without this
    // the viewport keeps its initial size and a resized/fullscreen window gets
    // a black band where the scene should be.
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    const rw = Math.round(w * pr);
    const rh = Math.round(h * pr);

    if (this.gtao) {
      this.gtao.enabled = q.gtao && this.quality.scale >= 0.86;
      if (this.gtao.enabled) {
        // Composer.setSize just reset the pass to full resolution; AO is a
        // soft, low-frequency signal, so it runs at a fraction of it.
        this.gtao.setSize(
          Math.max(2, Math.round(rw * q.gtaoScale)),
          Math.max(2, Math.round(rh * q.gtaoScale))
        );
        this.gtao.blendIntensity = q.blendIntensity;
        this.gtao.updateGtaoMaterial({ samples: q.gtaoSamples });
        this.gtao.updatePdMaterial({ samples: q.gtaoPdSamples, rings: q.gtaoRings });
      }
    }
    if (this.bloom) this.bloom.enabled = q.bloom && this.quality.scale >= 0.78;
    if (this.composer?.renderTarget1) {
      this.composer.renderTarget1.samples = Math.min(q.msaa || 0, this.renderer.capabilities.maxSamples ?? 0);
    }
    if (this.composer?.renderTarget2) {
      this.composer.renderTarget2.samples = Math.min(q.msaa || 0, this.renderer.capabilities.maxSamples ?? 0);
    }
    if (this.smaa) this.smaa.enabled = q.smaa;
    if (this.grade) this.grade.uniforms.resolution.value.set(rw, rh);
    this.scenery?.setVegetationDensity(q.vegetation * this.quality.foliage);

    const sun = this.sky?.sunLight;
    if (sun) {
      const radius = this.quality.scale < 0.9 ? Math.min(q.shadowRadius, 1.2) : q.shadowRadius;
      const half = this.state === 'menu' ? 95 : 430;
      const maxTextureSize = this.renderer.capabilities.maxTextureSize || q.shadowMap;
      const shadowMap = Math.min(q.shadowMap, maxTextureSize);
      const camera = sun.shadow.camera;
      if (camera.left !== -half || camera.right !== half || camera.top !== half || camera.bottom !== -half) {
        camera.left = -half;
        camera.right = half;
        camera.top = half;
        camera.bottom = -half;
        camera.updateProjectionMatrix();
      }
      if (sun.shadow.mapSize.x !== shadowMap || sun.shadow.radius !== radius) {
        if (sun.shadow.mapSize.x !== shadowMap) {
          sun.shadow.mapSize.set(shadowMap, shadowMap);
          if (sun.shadow.map) {
            sun.shadow.map.dispose();
            sun.shadow.map = null;
          }
        }
        sun.shadow.radius = radius;
      }
    }

    this.ui?.updateQuality(this.quality.mode, this.quality.tier, this.quality.scale);
  }

  /** Full-resolution showcase after a flight that had to shed pixels. */
  resetAutoQuality() {
    if (this.quality.mode !== 'auto') return;
    this.quality.scale = 1;
    this.quality.foliage = 1;
    this.quality.stable = 0;
    this.quality.probe = null;
    this.quality.holdUntil = performance.now() + 2000;
    this.applyQuality();
  }

  setQuality(mode) {
    this.quality.mode = mode;
    const detected = mode === 'auto' ? detectQualityInfo(this.renderer) : null;
    this.quality.tier = detected ? detected.tier : mode;
    this.quality.ceiling = detected
      ? detected.known
        ? detected.tier
        : QUALITY_LEVELS[QUALITY_LEVELS.length - 1]
      : mode;
    this.quality.scale = 1;
    this.quality.foliage = 1;
    this.quality.stable = 0;
    this.quality.holdUntil = performance.now() + 1500;
    this.quality.perfTime = 0;
    this.quality.perfFrames = 0;
    this.quality.probe = null;
    this.quality.upLockUntil = 0;
    try {
      localStorage.setItem(QUALITY_KEY, mode);
    } catch {
      /* Ignore storage failures. */
    }
    this.applyQuality();
  }

  /**
   * Adaptive governor.
   *
   * Only runs during flight: the menu orbits a close-up that is not
   * representative of the frame the player actually flies, and letting it
   * decide the tier used to leave flights stuck on low after a slow intro.
   *
   * Missing frames are paid for with vegetation first (barely visible in the
   * desert), then resolution, and only then a whole tier. A catastrophic frame
   * rate skips the queue so a slideshow converges in one step.
   */
  tuneQuality(fps) {
    if (this.quality.mode !== 'auto' || this.state !== 'flying') return;
    const now = performance.now();
    if (now < this.quality.holdUntil) return;

    // Did the last promotion hurt? Put the old tier back and stop retrying for
    // a while so the player is not bounced between two settings every minute.
    const probe = this.quality.probe;
    if (probe && now >= probe.until) {
      this.quality.probe = null;
      if (fps < 57) {
        this.quality.tier = probe.tier;
        this.quality.scale = probe.scale;
        this.quality.upLockUntil = now + 45000;
        this.quality.holdUntil = now + 2500;
        this.applyQuality();
        return;
      }
    }

    const index = QUALITY_LEVELS.indexOf(this.quality.tier);

    if (fps < 54) {
      this.quality.stable = 0;
      // Below ~36fps the frame is a slideshow: drop a tier now instead of
      // spending the next six seconds nibbling at vegetation and resolution.
      if (fps < 36 && index > 0) {
        this.quality.tier = QUALITY_LEVELS[index - 1];
        this.quality.foliage = 1;
        this.quality.scale = 1;
        this.quality.holdUntil = now + 2200;
        this.applyQuality();
        return;
      }
      if (this.quality.foliage > MIN_FOLIAGE) {
        this.quality.foliage = Math.max(MIN_FOLIAGE, this.quality.foliage * 0.68);
        this.quality.holdUntil = now + 800;
        this.applyQuality();
        return;
      }
      if (this.quality.scale > MIN_RENDER_SCALE + 0.001) {
        this.quality.scale = Math.max(MIN_RENDER_SCALE, this.quality.scale * 0.88);
        this.quality.holdUntil = now + 800;
        this.applyQuality();
        return;
      }
      if (index > 0) {
        this.quality.tier = QUALITY_LEVELS[index - 1];
        this.quality.foliage = 1;
        this.quality.holdUntil = now + 2500;
        this.applyQuality();
      }
      return;
    }

    // Reclaim pixel density before adding vegetation; move up tiers only with
    // sustained headroom, and never above the ceiling detection allowed.
    if (fps > 59) {
      this.quality.stable += 1;
      if (this.quality.stable < 4) return;
      this.quality.stable = 0;
      if (this.quality.scale < 1) {
        this.quality.scale = Math.min(1, this.quality.scale * 1.06);
        this.quality.holdUntil = now + 1200;
        this.applyQuality();
        return;
      }
      if (this.quality.foliage < 1) {
        this.quality.foliage = Math.min(1, this.quality.foliage * 1.08);
        this.quality.holdUntil = now + 1200;
        this.applyQuality();
        return;
      }
      const tierIndex = QUALITY_LEVELS.indexOf(this.quality.tier);
      const ceilingIndex = Math.max(tierIndex, QUALITY_LEVELS.indexOf(this.quality.ceiling));
      if (tierIndex >= 0 && tierIndex < ceilingIndex && now > this.quality.upLockUntil) {
        const previousTier = this.quality.tier;
        const previousScale = this.quality.scale;
        this.quality.tier = QUALITY_LEVELS[tierIndex + 1];
        this.quality.scale = 1;
        this.quality.foliage = 1;
        this.quality.holdUntil = now + 5000;
        this.quality.probe = {
          tier: previousTier,
          scale: previousScale,
          until: now + 5000,
        };
        this.applyQuality();
        return;
      }
    } else {
      this.quality.stable = 0;
    }
  }

  setupPostProcessing() {
    const q = this.qualitySettings();
    const maxSamples = this.renderer.capabilities.maxSamples ?? 0;
    const samples = Math.min(q.msaa || 0, maxSamples);
    const target = new THREE.WebGLRenderTarget(
      window.innerWidth,
      window.innerHeight,
      {
        type: THREE.HalfFloatType,
        samples,
      }
    );
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Ground-truth ambient occlusion: darkens every contact point, crevice and
    // panel gap so objects stop looking pasted onto the ground plane.
    this.gtao = new GTAOPass(
      this.scene,
      this.camera,
      window.innerWidth,
      window.innerHeight
    );
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.enabled = q.gtao;
    this.gtao.blendIntensity = q.blendIntensity;
    this.gtao.updateGtaoMaterial({
      radius: 2.0,
      distanceExponent: 1.3,
      thickness: 1.4,
      scale: 1.0,
      samples: q.gtaoSamples,
      distanceFallOff: 1.0,
    });
    this.gtao.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 4,
      radiusExponent: 1,
      rings: q.gtaoRings,
      samples: q.gtaoPdSamples,
    });
    this.composer.addPass(this.gtao);

    // Only genuinely hot pixels (sun disc, strobes, afterburners) bloom.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.12,
      0.45,
      1.8
    );
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // Filmic grade in display space: S-curve contrast, saturated but neutral
    // highlights, cool shadows, vignette and fine grain.
    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        resolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight),
        },
        time: { value: 0 },
        contrast: { value: 1.055 },
        saturation: { value: 1.1 },
        vignette: { value: 0.34 },
        grain: { value: 0.028 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float time;
        uniform float contrast;
        uniform float saturation;
        uniform float vignette;
        uniform float grain;
        varying vec2 vUv;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

          // Slight S-curve and a touch of punch in the mids.
          c = mix(vec3(l), c, saturation);
          c = (c - 0.5) * contrast + 0.5;
          c = clamp(c, 0.0, 1.0);
          c = c * c * (3.0 - 2.0 * c) * 0.18 + c * 0.82;

          // Split tone: cool the shadows, warm the highlights.
          float shadowMask = 1.0 - smoothstep(0.0, 0.55, l);
          float highMask = smoothstep(0.45, 1.0, l);
          c += vec3(-0.012, 0.002, 0.022) * shadowMask;
          c += vec3(0.022, 0.008, -0.014) * highMask;

          // Vignette + animated fine grain.
          vec2 p = vUv - 0.5;
          float vig = 1.0 - dot(p, p) * vignette * 2.2;
          c *= clamp(vig, 0.0, 1.0);
          c += (hash(vUv * resolution + fract(time)) - 0.5) * grain;

          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }
      `,
    });
    this.composer.addPass(this.grade);

    // Anti-aliasing after grading keeps every edge crisp regardless of the
    // MSAA sample count on the HDR buffer.
    this.smaa = new SMAAPass();
    this.smaa.enabled = q.smaa;
    this.smaa.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(this.smaa);

    this.applyQuality();
  }

  bindWindow() {
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'flying') this.pauseFlight();
    });
  }

  onResize() {
    this.applyQuality();
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.hud.resize();
  }

  async nextFrame() {
    // Yield so the loading bar paints. Background tabs throttle both rAF and
    // setTimeout, so a MessageChannel watchdog keeps initialisation moving.
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      requestAnimationFrame(() => setTimeout(finish, 0));
      const start = performance.now();
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        if (done) return;
        if (performance.now() - start > 220) finish();
        else channel.port2.postMessage(0);
      };
      channel.port2.postMessage(0);
      setTimeout(finish, 500);
    });
  }

  async init() {
    try {
      this.ui.setLoading(0.04, 'Initialising flight systems…');
      await this.nextFrame();

      this.sky = new SkySystem(this.scene, this.renderer);
      // Shadow map size depends on the tier, so re-apply now that the sun exists.
      this.applyQuality();
      this.ui.setLoading(0.12, 'Scattering the atmosphere…');
      await this.nextFrame();

      console.time('terrain');
      this.terrain = new Terrain(this.scene);
      console.timeEnd('terrain');
      this.ui.setLoading(0.46, 'Sculpting the valley and the coast…');
      await this.nextFrame();

      this.ui.setLoading(0.55, 'Surveying the Scott AFB ramp…');
      await this.nextFrame();

      console.time('scenery');
      this.scenery = new Scenery(this.scene, this.renderer);
      console.timeEnd('scenery');
      this.applyQuality();
      this.ui.setLoading(0.82, 'Planting forests and lighting the field…');
      await this.nextFrame();

      this.effects = new Effects(this.scene, this.renderer);
      this.combat = new Dogfight(this);
      this.ui.setLoading(0.84, 'Loading scanned airframes…');
      await loadAircraftModels({
        maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
        onProgress: (p, label) => this.ui.setLoading(0.84 + p * 0.09, label),
      });
      this.scenery.addParkedAircraft();
      console.time('bake');
      console.log(`baked scenery into ${this.scenery.bakeStatics()} draw batches`);
      console.timeEnd('bake');
      this.aircraft = null;
      this.createAircraft(this.selection.aircraftId);

      this.sky.setTime(this.selection.hours, true);
      this.positionShowcase();
      this.ui.setLoading(0.94, 'Warming the engines…');
      await this.nextFrame();
      this.sky.update(0.016, this.camera, this.aircraft.group.position);
      this.ui.updateSelection(this.selection, this.spec);
      this.ui.setLoading(1.0, 'Cleared for departure.');
      this.ui.hideLoading();
      this.ui.showMenu();
      this.hud.setVisible(false);
      this.state = 'menu';
      this.input.enabled = false;
      this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.animate(t));
    } catch (error) {
      console.error(error);
      const text = document.getElementById('load-text');
      if (text) {
        text.textContent = 'Unable to initialise WebGL. Please try a modern browser with hardware acceleration.';
      }
    }
  }

  createAircraft(id) {
    if (this.aircraft) {
      this.scene.remove(this.aircraft.group);
      if (this.aircraft.shared) {
        // Imported models are cached templates with shared GPU resources.
        this.aircraft.group.visible = false;
      } else {
        this.aircraft.group.traverse((obj) => {
          if (obj.isMesh) {
            if (obj.geometry) obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
              for (const mat of obj.material) mat.dispose();
            } else if (obj.material) {
              obj.material.dispose();
            }
          }
        });
      }
    }
    this.spec = specFor(id);
    this.aircraft = createAircraft(id);
    this.scene.add(this.aircraft.group);
    for (const part of Object.values(this.aircraft.parts)) {
      if (part && part.isTexture) part.dispose();
    }
  }

  positionShowcase() {
    const spec = this.spec;
    const group = this.aircraft.group;
    const point = airfieldPoint(HANGAR_BAY_U, HANGAR_BAY_V);
    const surface = Math.max(terrainHeight(point.x, point.z), 0);
    // The hangar floor slab sits 8 cm above the terrain to avoid z-fighting;
    // put the tyres on the slab, not 8 cm inside it.
    group.position.set(point.x, surface + spec.groundClearance + 0.08, point.z);
    group.quaternion.setFromEuler(new THREE.Euler(0, RUNWAY_HEADING + Math.PI, 0, 'YXZ'));
    this.resetAircraftVisuals();
  }

  resetAircraftVisuals() {
    const model = this.aircraft;
    if (!model) return;
    const parts = model.parts;
    if (parts.gearGroup) {
      parts.gearGroup.visible = true;
      parts.gearGroup.position.y = 0;
    }
    if (parts.gearUpGroup) parts.gearUpGroup.visible = false;
    if (parts.propFast) {
      parts.propFast.visible = false;
      if (parts.propSlow) parts.propSlow.visible = true;
    }
    if (parts.ailerons) {
      if (parts.ailerons.left) parts.ailerons.left.rotation.x = 0;
      if (parts.ailerons.right) parts.ailerons.right.rotation.x = 0;
    }
    if (parts.flaps) {
      if (parts.flaps.left) parts.flaps.left.rotation.x = 0;
      if (parts.flaps.right) parts.flaps.right.rotation.x = 0;
    }
    if (parts.elevator) parts.elevator.rotation.x = 0;
    if (parts.rudder) parts.rudder.rotation.y = 0;
    if (parts.stabilators) {
      for (const stab of parts.stabilators) stab.rotation.x = 0;
    }
    if (parts.elevons) {
      for (const el of parts.elevons) el.rotation.x = 0;
    }
    if (parts.afterburners) {
      for (const flame of parts.afterburners) {
        flame.visible = false;
        flame.material.opacity = 0;
      }
    }
    if (parts.abGlows) {
      for (const glow of parts.abGlows) glow.material.opacity = 0;
    }
    if (parts.abShockCells) {
      for (const cell of parts.abShockCells) {
        cell.visible = false;
        cell.material.opacity = 0;
      }
    }
    if (parts.propDisc) parts.propDisc.material.opacity = 0;
    for (const group of parts.landingLights) {
      group.userData.light.intensity = 0;
      group.userData.lampMat.color.setHex(0x332d1d);
    }
    this.updateNavLights(this.sky ? this.sky.nightFactor : 0, 0);
  }

  updateNavLights(nightFactor, time) {
    const nav = this.aircraft?.parts?.nav;
    if (!nav) return;
    const on = nightFactor > 0.22 || this.forceLights;
    for (const [key, light] of Object.entries(nav)) {
      light.visible = on;
      if (!on) continue;
      const color = light.userData.color;
      const bulb = light.userData.bulbMat;
      const sprite = light.userData.sprite;
      const isStrobe = key === 'strobe';
      const blink = isStrobe ? ((time % 1.15) < 0.08 ? 1 : 0) : 1;
      bulb.color.copy(color);
      bulb.color.multiplyScalar(2.2);
      if (sprite) {
        sprite.material.color.copy(color);
        sprite.material.opacity = blink * (isStrobe ? 0.95 : 0.5);
      }
    }
  }

  updateLandingLights(nightFactor) {
    if (!this.aircraft) return;
    const on = nightFactor > 0.22 || this.forceLights;
    for (const group of this.aircraft.parts.landingLights) {
      const light = group.userData.light;
      const lamp = group.userData.lampMat;
      light.intensity = on ? 3200 : 0;
      lamp.color.setHex(on ? 0xffedb0 : 0x332d1d);
    }
  }

  selectAircraft(id) {
    if (id === this.selection.aircraftId || this.state !== 'menu') return;
    if (this.selection.startMode === 'dogfight' && id !== 'f22') {
      this.ui.toast('Dogfight uses the F-22');
      return;
    }
    this.selection.aircraftId = id;
    this.spec = specFor(id);
    this.createAircraft(id);
    this.positionShowcase();
    this.applyQuality();
    this.ui.updateSelection(this.selection, this.spec);
  }

  setEnvironment(key) {
    const preset = TIME_PRESETS[key];
    if (!preset) return;
    this.selection.hours = preset.hours;
    this.sky.setTime(preset.hours);
    this.ui.updateTime?.(this.selection.hours);
    this.ui.updateSelection(this.selection, this.spec);
  }

  setControl(id) {
    if (!CONTROL_LEVELS[id]) return;
    this.selection.controlId = id;
    this.ui.updateSelection(this.selection, this.spec);
  }

  setStartMode(mode) {
    if (mode !== 'airborne' && mode !== 'runway' && mode !== 'hangar' && mode !== 'dogfight') return;
    // Guns-only duels are flown in the Raptor. Selecting the mission switches
    // the airframe so the player is never launched into combat in a Cessna.
    if (mode === 'dogfight' && this.selection.aircraftId !== 'f22') {
      this.selectAircraft('f22');
    }
    this.selection.startMode = mode;
    this.ui.updateSelection(this.selection, this.spec);
  }

  setTime(hours) {
    this.selection.hours = clamp(hours, 0, 24);
    this.sky.setTime(this.selection.hours, true);
    this.ui.updateTime?.(this.selection.hours);
  }

  cycleTime() {
    const current = this.selection.hours;
    let nearest = 0;
    let nearestDist = 99;
    TIME_ORDER.forEach((key, index) => {
      const d = Math.min(
        Math.abs(TIME_PRESETS[key].hours - current),
        24 - Math.abs(TIME_PRESETS[key].hours - current)
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearest = index;
      }
    });
    const next = TIME_ORDER[(nearest + 1) % TIME_ORDER.length];
    const preset = TIME_PRESETS[next];
    this.selection.hours = preset.hours;
    this.sky.setTime(preset.hours);
    this.ui.updateTime?.(preset.hours);
    this.ui.toast(`Time of day · ${preset.label}`);
  }

  startFlight() {
    if (!this.aircraft || this.state === 'loading' || this.state === 'flying' || this.state === 'paused') return;
    this.combat?.stop();
    this.spec = specFor(this.selection.aircraftId);
    this.physics = new FlightPhysics(this.spec);
    const startMode = this.selection.startMode;
    this.physics.reset({
      mode: startMode,
      controlId: this.selection.controlId,
    });
    const initialThrottle =
      startMode === 'airborne'
        ? this.spec.startThrottle
        : startMode === 'dogfight'
          ? this.physics.throttle
          : 0;
    this.input.reset(initialThrottle);
    this.input.setThrottle(this.physics.throttle);
    this.input.enabled = true;
    this.accumulator = 0;
    this.hitShake = 0;
    this.crashShown = false;
    this.wasOnGround = this.physics.onGround;
    this.forceLights = false;
    this.simCamera.reset();
    this.simCamera.mode = 0;
    this.effects.clear();
    this.sky.setTime(this.selection.hours, true);
    this.ui.hideScreens();
    this.hud.setVisible(true);
    this.state = 'flying';
    this.sound.start(this.spec);
    this.syncAircraft(0);
    this.applyQuality();
    if (startMode === 'dogfight') {
      this.combat.start(this.physics, this.aircraft);
      this.ui.toast('DOGFIGHT · VIPER 1 · GUNS ONLY · V OR LMB TO FIRE', 3400);
    } else {
      this.ui.toast(
        startMode === 'hangar'
          ? `${this.spec.name} · hangar departure · taxi via apron to runway`
          : startMode === 'runway'
            ? `${this.spec.name} · runway departure · throttle up to taxi`
            : `${this.spec.name} · airborne`,
        2600
      );
    }
  }

  restartFlight() {
    if (!this.physics && this.state !== 'menu') return;
    this.ui.hideScreens();
    this.startFlight();
  }

  returnToHangar({ parked = false } = {}) {
    if (!this.aircraft) return;
    this.state = 'menu';
    this.sound.stop();
    this.combat?.stop();
    this.effects.clear();
    this.ui.hideScreens();
    this.ui.showMenu();
    this.hud.setVisible(false);
    this.ui.updateSelection(this.selection, this.spec);
    if (this.aircraft) {
      this.positionShowcase();
      this.updateLandingLights(this.sky.nightFactor);
    }
    this.input.enabled = false;
    this.showcaseAngle = 1.02;
    this.simCamera.reset();
    this.physics = null;
    this.selection.startMode = 'hangar';
    this.resetAutoQuality();
    this.ui.updateSelection(this.selection, this.spec);
    if (parked) this.ui.toast('Aircraft parked · Scott AFB');
  }

  pauseFlight() {
    if (this.state !== 'flying') return;
    this.state = 'paused';
    this.input.reset(this.input.throttle);
    this.ui.hideHelp();
    this.ui.showPause(this.spec, this.selection);
  }

  resumeFlight() {
    if (this.state !== 'paused') return;
    this.state = 'flying';
    this.ui.hidePause();
    this.ui.hideHelp();
    this.input.reset(this.input.throttle);
    this.lastFrame = performance.now();
  }

  toggleHelp() {
    if (this.state === 'crashed') return;
    if (this.ui.isHelpOpen()) {
      this.closeHelp();
      return;
    }
    if (this.state === 'menu') {
      this.ui.showHelp();
      return;
    }
    if (this.state === 'flying') {
      this.state = 'paused';
      this.input.reset(this.input.throttle);
      this.ui.hidePause();
      this.ui.showHelp();
      return;
    }
    if (this.state === 'paused') {
      this.ui.hidePause();
      this.ui.showHelp();
    }
  }

  closeHelp() {
    this.ui.hideHelp();
    if (this.state === 'paused') {
      this.ui.showPause(this.spec, this.selection);
    } else if (this.state === 'menu') {
      this.ui.showMenu();
    }
  }

  toggleSound() {
    const muted = this.sound.toggleMute();
    this.ui.setSoundLabel(muted);
    this.ui.toast(muted ? 'Sound muted' : 'Sound on');
  }

  handleAction(action) {
    if (action === 'mute') {
      this.toggleSound();
      return;
    }
    if (action === 'pause') {
      if (this.ui.isHelpOpen()) {
        this.closeHelp();
        return;
      }
      if (this.state === 'flying') this.pauseFlight();
      else if (this.state === 'paused') this.resumeFlight();
      return;
    }
    if (action === 'help') {
      this.toggleHelp();
      return;
    }
    if (action === 'restart') {
      if (this.state === 'flying' || this.state === 'paused' || this.state === 'crashed') {
        this.restartFlight();
      }
      return;
    }
    if (this.state !== 'flying' && this.state !== 'crashed') return;
    if (!this.physics) return;

    if (action === 'camera' && this.state === 'flying') {
      const mode = this.simCamera.cycle();
      this.ui.toast(`Camera · ${mode}`);
    } else if (action === 'gear') {
      if (this.physics.toggleGear()) {
        this.ui.toast(this.physics.gearDown ? 'Landing gear · extended' : 'Landing gear · retracting');
      } else if (this.spec.fixedGear) {
        this.ui.toast('Fixed landing gear');
      } else {
        this.ui.toast('Cannot retract gear on the ground');
      }
    } else if (action === 'flaps') {
      if (this.physics.changeFlaps(1)) {
        const deg = this.spec.flaps[this.physics.flapIndex];
        this.ui.toast(`Flaps · ${deg}°`);
      } else {
        this.physics.flapIndex = 0;
        this.ui.toast('Flaps · up');
      }
    } else if (action === 'time') {
      this.cycleTime();
    } else if (action === 'lights') {
      this.forceLights = !this.forceLights;
      this.ui.toast(this.forceLights ? 'Landing lights · on' : 'Landing lights · auto');
      this.updateLandingLights(this.sky.nightFactor);
      this.updateNavLights(this.sky.nightFactor, this.time);
    } else if (action === 'park' && this.state === 'flying') {
      this.requestParking();
    }
  }

  syncAircraft(dt, state = this.physics) {
    if (!this.aircraft || !state) return;
    const model = this.aircraft;
    const parts = model.parts;
    const group = model.group;
    group.position.copy(state.position);
    group.quaternion.copy(state.quaternion);

    const time = this.time;
    if (!this.spec.fixedGear && parts.gearGroup) {
      const gearT = state.gearT ?? 1;
      parts.gearGroup.visible = gearT > 0.02;
      if (parts.importedGear) {
        if (parts.gearUpGroup) parts.gearUpGroup.visible = gearT <= 0.02;
      } else {
        parts.gearGroup.position.y = (1 - gearT) * this.spec.groundClearance * 1.25;
      }
    }

    const input = state.input || { pitch: 0, roll: 0, yaw: 0 };
    if (parts.ailerons) {
      if (parts.ailerons.left) parts.ailerons.left.rotation.x = input.roll * 0.32;
      if (parts.ailerons.right) parts.ailerons.right.rotation.x = -input.roll * 0.32;
    }
    if (parts.flaps) {
      const angle = -(state.flapAngle || 0) * DEG * 0.8;
      if (parts.flaps.left) parts.flaps.left.rotation.x = angle;
      if (parts.flaps.right) parts.flaps.right.rotation.x = angle;
    }
    if (parts.elevator) parts.elevator.rotation.x = input.pitch * 0.34;
    if (parts.stabilators) {
      for (const stab of parts.stabilators) stab.rotation.x = input.pitch * 0.3;
    }
    if (parts.rudder) parts.rudder.rotation.y = -input.yaw * 0.4;
    if (parts.elevons) {
      parts.elevons.forEach((elevon, index) => {
        const side = index % 2 === 0 ? 1 : -1;
        elevon.rotation.x = input.pitch * 0.24 + input.roll * 0.18 * side;
      });
    }

    if (model.hasProp && parts.propSpin) {
      const spinSpeed = 12 + (state.throttle || 0) * 140;
      const axis = parts.propAxis || 'z';
      parts.propSpin.rotation[axis] += spinSpeed * dt;
      if (parts.propFast) {
        const fast = (state.throttle || 0) > 0.12;
        parts.propFast.visible = fast;
        if (parts.propSlow) parts.propSlow.visible = !fast;
      }
      if (parts.propDisc) {
        parts.propDisc.material.opacity = clamp((state.throttle || 0) * 0.55, 0, 0.55);
      }
    }

    const ab = state.afterburnerLevel || 0;
    const speedMach = state.mach || 0;
    // Afterburner: the plume lights at the throttle gate, stretches with power
    // and compresses slightly with airspeed, with independent flame flicker on
    // each engine so the two nozzles never pulse in lockstep.
    const abFlicker = (seed) => 0.96 + 0.04 * Math.sin(time * 21 + seed) + 0.02 * Math.sin(time * 47 + seed * 2.3);
    if (parts.afterburners) {
      parts.afterburners.forEach((plume, index) => {
        const flicker = abFlicker(index * 2.1);
        const length = (0.5 + ab * 0.5) * (1 - Math.min(speedMach, 2.2) * 0.06) * flicker;
        plume.visible = ab > 0.03;
        plume.material.opacity = ab * (plume.userData.opacityScale ?? 0.5) * flicker;
        plume.scale.set(0.94 + ab * 0.06, length, 0.94 + ab * 0.06);
      });
    }
    if (parts.abCores) {
      parts.abCores.forEach((core, index) => {
        const flicker = abFlicker(index * 3.7 + 11);
        core.visible = ab > 0.03;
        core.material.opacity = ab * (core.userData.opacityScale ?? 0.9) * flicker;
        core.scale.set(0.96, 0.55 + ab * 0.55 * flicker, 0.96);
      });
    }
    if (parts.abGlows) {
      parts.abGlows.forEach((glow, index) => {
        const flicker = abFlicker(index * 5.3 + 23);
        glow.visible = ab > 0.03;
        glow.material.opacity = ab * 0.5 * flicker;
        glow.scale.set(0.9 + ab * 0.35, 0.5 + ab * 0.2, 1);
      });
    }
    if (parts.abShockCells) {
      parts.abShockCells.forEach((cell, index) => {
        const active = ab * smoothstep(0.55, 1.05, speedMach + 0.35);
        cell.visible = active > 0.18;
        cell.material.opacity =
          Math.max(0, active - 0.18) * (cell.userData.opacityScale ?? 0.2) * abFlicker(index * 1.9 + 5);
        cell.scale.setScalar(0.85 + active * 0.25);
      });
    }

    this.updateNavLights(this.sky?.nightFactor ?? 0, time);
    this.updateLandingLights(this.sky?.nightFactor ?? 0);
  }

  requestParking() {
    const fp = this.physics;
    const telemetry = fp?.getTelemetry();
    if (!fp || !fp.onGround || fp.speed > 2.5 || !telemetry?.parkingAvailable) {
      this.ui.toast('Stop on the hangar 01 service apron to park');
      return false;
    }
    this.returnToHangar({ parked: true });
    return true;
  }

  updateAircraftMenu(dt) {
    if (!this.aircraft) return;
    const parts = this.aircraft.parts;
    if (this.aircraft.hasProp && parts.propSpin) {
      const axis = parts.propAxis || 'z';
      parts.propSpin.rotation[axis] += dt * 4.5;
      if (parts.propDisc) parts.propDisc.material.opacity = 0.04;
    }
    this.updateNavLights(this.sky.nightFactor, this.time);
    this.updateLandingLights(this.sky.nightFactor);
  }

  updateMenu(dt) {
    this.showcaseAngle += dt * 0.028;
    const spec = this.spec;
    const pos = this.aircraft.group.position;
    const span = Math.sqrt(spec.aspect * spec.wingArea);
    const dims = this.aircraft.dimensions;
    const reach = dims ? Math.max(dims.x, dims.z) : span;
    const radius = Math.max(span * 1.15 + 10, reach * 1.15 + 8);
    const height = Math.max(2.4, span * 0.14, dims ? dims.y * 0.8 : 0) + 2.5;
    // Keep the sun behind the camera so the airframe is lit, not silhouetted.
    const sunAz = Math.atan2(this.sky.sunDirection.z, this.sky.sunDirection.x);
    const angle = sunAz + 0.55 + Math.sin(this.showcaseAngle * 0.45) * 0.28;
    this.camera.position.set(
      pos.x + Math.cos(angle) * radius,
      pos.y + height,
      pos.z + Math.sin(angle) * radius
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(pos.x, pos.y + 0.4, pos.z);
    // Three-quarter front view, lit by the sun behind the camera.
    this.aircraft.group.rotation.set(0, Math.PI / 2 - (angle + 0.85), 0);
    if (this.camera.fov !== 39) {
      this.camera.fov = 39;
      this.camera.updateProjectionMatrix();
    }

    this.updateAircraftMenu(dt);
    this.sky.update(dt, this.camera, pos);
    this.scenery.update(dt, {
      sunColor: this.sky.sunColor,
      nightFactor: this.sky.nightFactor,
      sunDir: this.sky.sunDirection,
      camera: this.camera,
    });
    this.effects.update(dt, this.camera);
    this.sound.update(dt, null);
  }

  updateFlight(dt) {
    this.input.update(dt);
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 8) {
      this.physics.step(FIXED_DT, this.input.controls(), this.selection.controlId, this.time);
      if (this.combat?.active) this.combat.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
      this.time += FIXED_DT;
    }
    if (steps === 8) this.accumulator = 0;

    if (this.physics.crashed) {
      if (!this.crashShown) this.onCrash();
    } else {
      const telemetry = this.physics.getTelemetry();
      if (!this.wasOnGround && this.physics.onGround && telemetry.agl < 5) {
        this.effects.landingBurst(
          this.physics.position,
          this.physics.telemetry?.heading * DEG || 0
        );
        this.ui.toast('Touchdown');
      } else if (this.wasOnGround && !this.physics.onGround) {
        this.ui.toast('Airborne · positive rate');
      }
      this.wasOnGround = this.physics.onGround;
    }

    this.syncAircraft(dt);
    if (this.combat?.active) this.combat.sync();

    const shake =
      (CONTROL_LEVELS[this.selection.controlId]?.turbulence ?? 0.5) * 0.16 +
      (this.physics.overspeedWarning ? 0.25 : 0) +
      this.hitShake;
    this.simCamera.update(
      dt,
      this.physics,
      this.aircraft,
      this.spec,
      this.time,
      shake
    );

    this.sky.update(dt, this.camera, this.physics.position);
    this.scenery.update(dt, {
      sunColor: this.sky.sunColor,
      nightFactor: this.sky.nightFactor,
      sunDir: this.sky.sunDirection,
      camera: this.camera,
    });
    this.effects.emit(dt, {
      state: this.physics,
      model: this.aircraft,
      spec: this.spec,
      camera: this.camera,
      time: this.time,
    });
    this.sound.update(dt, {
      throttle: this.physics.throttle,
      speed: this.physics.speed,
      afterburner: this.physics.afterburnerLevel,
      telemetry: this.physics.getTelemetry(),
      stallWarning: this.physics.stallWarning,
      onGround: this.physics.onGround,
      firing: !!this.combat?.active && this.input.firing,
    });

    if (this.state === 'flying') {
      // The HUD projects the target and the lead point through the same camera
      // that was just posed this frame, so slow camera updates would drag the
      // pipper off the aircraft it is supposed to be aiming at.
      this.camera.updateMatrixWorld();
      this.hud.draw(dt, this.physics.getTelemetry(), this.spec, {
        controlLabel: CONTROL_LEVELS[this.selection.controlId].name,
        timeLabel: this.sky.displayTime,
        fps: this.fps,
        cameraMode: this.simCamera.modeName,
        combat: this.combat?.hudData(this.camera),
      });
    }
  }

  onCrash() {
    this.crashShown = true;
    this.state = 'crashed';
    if (this.combat) this.combat.active = false;
    this.hud.setVisible(false);
    this.sound.stop();
    this.ui.showCrash(this.physics.crashReason || 'Impact with the terrain');
    this.simCamera.mode = 2;
    this.simCamera.initialized = false;
  }

  updateCrashed(dt) {
    this.syncAircraft(dt);
    this.simCamera.update(dt, this.physics, this.aircraft, this.spec, this.time, 0);
    this.sky.update(dt, this.camera, this.physics.position);
    this.scenery.update(dt, {
      sunColor: this.sky.sunColor,
      nightFactor: this.sky.nightFactor,
      sunDir: this.sky.sunDirection,
      camera: this.camera,
    });
    this.effects.emit(dt, {
      state: this.physics,
      model: this.aircraft,
      spec: this.spec,
      camera: this.camera,
      time: this.time,
    });
  }

  updatePaused(dt) {
    this.syncAircraft(0);
    this.updateAircraftMenu(0);
    this.sky.update(dt, this.camera, this.physics ? this.physics.position : this.aircraft.group.position);
    this.scenery.update(dt, {
      sunColor: this.sky.sunColor,
      nightFactor: this.sky.nightFactor,
      sunDir: this.sky.sunDirection,
      camera: this.camera,
    });
    this.effects.update(dt, this.camera);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (this.state === 'loading') return;
    const now = performance.now();
    const rawDt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0.016;
    this.lastFrame = now;
    const dt = Math.min(rawDt, 0.05);
    this.fps = this.fps * 0.93 + (1 / Math.max(rawDt, 0.001)) * 0.07;
    this.time += this.state === 'flying' ? 0 : dt;

    // Shader compiles and first-use uploads make the first second of any new
    // scene look like a slow GPU; do not let that cost the player resolution.
    if (this.state !== this.lastState) {
      this.lastState = this.state;
      this.quality.perfTime = 0;
      this.quality.perfFrames = 0;
      this.quality.stable = 0;
      this.quality.holdUntil = performance.now() + 2500;
    }

    // Average over ~1s windows: a single long frame should not trigger a
    // quality change, but a sustained miss should.
    if (rawDt < 0.5) {
      this.quality.perfTime += rawDt;
      this.quality.perfFrames += 1;
      if (this.quality.perfTime > 0.9) {
        this.tuneQuality(this.quality.perfFrames / this.quality.perfTime);
        this.quality.perfTime = 0;
        this.quality.perfFrames = 0;
      }
    }

    if (this.state === 'menu') {
      this.updateMenu(dt);
    } else if (this.state === 'flying') {
      this.updateFlight(dt);
    } else if (this.state === 'paused') {
      this.updatePaused(dt);
    } else if (this.state === 'crashed') {
      this.updateCrashed(dt);
    }

    if (this.grade) this.grade.uniforms.time.value = now * 0.001;
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

const game = new Game();
window.game = game;
window.__STRATOS__ = game;
