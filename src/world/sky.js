import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { smoothstep, clamp } from '../core/utils.js';
import {
  glowTexture,
  moonTexture,
  starTexture,
  cloudDomeTexture,
} from './textures.js';

export const TIME_PRESETS = {
  dawn: { hours: 6.35, label: 'Dawn' },
  day: { hours: 13.2, label: 'Day' },
  golden: { hours: 16.85, label: 'Golden hour' },
  night: { hours: 22.4, label: 'Night' },
};

/**
 * The Preetham sky is authored for a much lower exposure than a lit landscape,
 * so its radiance is scaled down to sit in a believable HDR range next to the
 * terrain. This keeps blue gradients alive instead of clipping to white.
 */
const SKY_GAIN = 0.18;

function applySkyGain(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSkyGain = { value: SKY_GAIN };
    shader.fragmentShader =
      'uniform float uSkyGain;\n' +
      shader.fragmentShader.replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        'gl_FragColor = vec4( texColor * uSkyGain, 1.0 );'
      );
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => 'skydome-gain';
}

function normalizedPath(from, to) {
  let diff = to - from;
  while (diff > 12) diff -= 24;
  while (diff < -12) diff += 24;
  return diff;
}

/**
 * Day/night rig. Owns the sky dome, sun/moon, stars, fog colours and
 * image-based lighting. Time is expressed in hours (0-24).
 */
export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hours = TIME_PRESETS.golden.hours;
    this.targetHours = this.hours;
    this.sunDirection = new THREE.Vector3(0, 0.3, -1).normalize();
    this.moonDirection = new THREE.Vector3(0, 0.7, 0.7).normalize();
    this.sunColor = new THREE.Color(0xfff2df);
    this.nightFactor = 0;
    this.sunElevation = 0;
    this.lastEnvHours = -999;
    this.lastEnvTime = 0;
    this.envRT = null;

    this.scene.fog = new THREE.FogExp2(0xd6c8b2, 0.000012);

    // Sky dome.
    this.sky = new Sky();
    this.sky.scale.setScalar(200000);
    this.sky.renderOrder = -20;
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5.4;
    u.rayleigh.value = 2.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    this.sky.material.depthWrite = false;
    applySkyGain(this.sky.material);
    this.scene.add(this.sky);

    // Cloud deck: an equirectangular shell between the sky dome and the world.
    this.cloudMaterial = new THREE.MeshBasicMaterial({
      map: cloudDomeTexture(),
      transparent: true,
      opacity: 0.75,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(150000, 48, 24),
      this.cloudMaterial
    );
    this.clouds.renderOrder = -18;
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);

    // A second sky used only to bake the environment map.
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(4000);
    const eu = this.envSky.material.uniforms;
    eu.turbidity.value = u.turbidity.value;
    eu.rayleigh.value = u.rayleigh.value;
    eu.mieCoefficient.value = u.mieCoefficient.value;
    eu.mieDirectionalG.value = u.mieDirectionalG.value;
    applySkyGain(this.envSky.material);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();

    // Lights.
    this.sunLight = new THREE.DirectionalLight(0xfff1dd, 3.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(4096, 4096);
    this.sunLight.shadow.camera.near = 20;
    this.sunLight.shadow.camera.far = 9000;
    this.sunLight.shadow.camera.left = -430;
    this.sunLight.shadow.camera.right = 430;
    this.sunLight.shadow.camera.top = 430;
    this.sunLight.shadow.camera.bottom = -430;
    this.sunLight.shadow.camera.updateProjectionMatrix();
    this.sunLight.shadow.bias = -0.00022;
    // Two metres of normal bias detached every shadow from its caster; a few
    // centimetres is enough for a 4096 map over this footprint.
    this.sunLight.shadow.normalBias = 0.12;
    // Soft PCF penumbra (three's PCF kernel scales with this radius).
    this.sunLight.shadow.radius = 2.6;
    this.sunLight.target.position.set(0, 0, 0);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.moonLight = new THREE.DirectionalLight(0x9db8e8, 0.0);
    this.moonLight.castShadow = false;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    this.hemi = new THREE.HemisphereLight(0x99c4ee, 0x3f3b2c, 0.5);
    this.scene.add(this.hemi);

    // Stars.
    const starCount = 2600;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const color = new THREE.Color();
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < starCount; i++) {
      const theta = rnd() * Math.PI * 2;
      const y = 0.04 + Math.pow(rnd(), 0.7) * 0.96;
      const r = Math.sqrt(1 - y * y);
      const radius = 180000;
      positions[i * 3] = Math.cos(theta) * r * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = Math.sin(theta) * r * radius;
      const temp = rnd();
      color.setHSL(0.58 - temp * 0.08, 0.2 + temp * 0.35, 0.72 + rnd() * 0.25);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.starMaterial = new THREE.PointsMaterial({
      size: 2.2,
      map: starTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      sizeAttenuation: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMaterial);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // Moon.
    this.moonMaterial = new THREE.SpriteMaterial({
      map: moonTexture(),
      color: 0xdce8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.moon = new THREE.Sprite(this.moonMaterial);
    this.moon.scale.setScalar(9000);
    this.scene.add(this.moon);

    // Sun halo (the sky shader supplies the disc; this adds a soft bloom).
    this.sunMaterial = new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,240,210,0.9)', 'rgba(255,170,90,0)'),
      color: 0xffe6bd,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.sunSprite = new THREE.Sprite(this.sunMaterial);
    this.sunSprite.scale.setScalar(11000);
    this.sunSprite.renderOrder = -5;
    this.scene.add(this.sunSprite);

    this._apply(0);
  }

  registerWater(water) {
    this.water = water;
    if (water) this.updateWater();
  }

  setTime(hours, immediate = false) {
    this.targetHours = ((hours % 24) + 24) % 24;
    if (immediate) {
      this.hours = this.targetHours;
      this._apply(0);
    }
  }

  get displayTime() {
    const h = Math.floor(this.hours % 24);
    const m = Math.floor((this.hours % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt, camera, playerPosition) {
    if (Math.abs(normalizedPath(this.hours, this.targetHours)) > 0.001) {
      const diff = normalizedPath(this.hours, this.targetHours);
      const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 3.2);
      this.hours = (this.hours + step + 24) % 24;
      this._apply(dt);
    }

    const t = performance.now() / 1000;
    if (this.water) {
      this.water.material.uniforms.time.value += dt * 0.55;
      this.updateWater();
    }

    if (camera) {
      this.stars.position.copy(camera.position);
      this.clouds.position.copy(camera.position);
      this.moon.position.copy(camera.position).addScaledVector(this.moonDirection, 165000);
      this.sunSprite.position.copy(camera.position).addScaledVector(this.sunDirection, 150000);
    }
    // Clouds drift slowly east so the sky is never static.
    if (this.cloudMaterial.map) {
      this.cloudMaterial.map.offset.x = (t * 0.0016) % 1;
    }

    if (playerPosition) {
      const dir = this.sunDirection;
      // Snap the shadow frustum to whole metres so the texel grid does not
      // crawl across the ground as the aircraft moves.
      const sx = Math.round(playerPosition.x);
      const sz = Math.round(playerPosition.z);
      this.sunLight.position.set(sx + dir.x * 3200, playerPosition.y + dir.y * 3200, sz + dir.z * 3200);
      this.sunLight.target.position.set(sx, playerPosition.y, sz);
      this.sunLight.target.updateMatrixWorld();
      this.moonLight.position.copy(playerPosition).addScaledVector(this.moonDirection, 2500);
      this.moonLight.target.position.copy(playerPosition);
      this.moonLight.target.updateMatrixWorld();
    }

    // Bake sky lighting occasionally so the slider stays responsive.
    const now = performance.now();
    if (
      Math.abs(this.hours - this.lastEnvHours) > 0.015 &&
      now - this.lastEnvTime > 260
    ) {
      this.regenerateEnvironment();
    }
  }

  updateWater() {
    if (!this.water) return;
    const u = this.water.material.uniforms;
    u.sunDirection.value.copy(this.sunDirection);
    u.sunColor.value.copy(this.sunColor);
  }

  regenerateEnvironment() {
    this.lastEnvHours = this.hours;
    this.lastEnvTime = performance.now();
    const eu = this.envSky.material.uniforms;
    const u = this.sky.material.uniforms;
    for (const key of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) {
      eu[key].value = u[key].value;
    }
    eu.sunPosition.value.copy(this.sunDirection);
    const rt = this.pmrem.fromScene(this.envScene, 0.02, 1, 10000);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }

  _apply() {
    const t = this.hours;
    const angle = ((t - 6) / 12) * Math.PI;
    const sx = Math.cos(angle);
    const sy = Math.sin(angle) * 0.94;
    const sz = -Math.sin(angle) * 0.34 - 0.08;
    this.sunDirection.set(sx, sy, sz).normalize();
    this.moonDirection.set(-sx * 0.7, -sy * 0.95 + 0.12, -sz * 0.7 + 0.18).normalize();

    this.sunElevation = Math.asin(clamp(this.sunDirection.y, -1, 1)) * (180 / Math.PI);
    const dark = smoothstep(0.10, -0.14, this.sunDirection.y);
    const daylight = smoothstep(-0.03, 0.32, this.sunDirection.y);
    // Strongest while the sun sits just above the horizon.
    const dusk = smoothstep(0.34, 0.0, this.sunDirection.y) * (1 - dark);
    this.nightFactor = dark;

    // Sky parameters shift warmer near the horizon.
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDirection);
    u.turbidity.value = 5.2 + dark * 3.0;
    u.rayleigh.value = 2.0 + smoothstep(0.32, 0.02, this.sunDirection.y) * 1.5;
    u.mieCoefficient.value = 0.0016 + smoothstep(0.22, 0.0, this.sunDirection.y) * 0.0055;
    u.mieDirectionalG.value = 0.8;

    // Sun / moon lights.
    const sunWarm = new THREE.Color(0xffa35c);
    const sunHigh = new THREE.Color(0xfff3e2);
    this.sunColor.copy(sunWarm).lerp(sunHigh, smoothstep(0.03, 0.38, this.sunDirection.y));
    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = 7.6 * smoothstep(-0.02, 0.16, this.sunDirection.y) * (1 + dusk * 1.6);
    this.sunLight.visible = this.sunLight.intensity > 0.01;
    this.moonLight.intensity = 1.9 * dark;
    this.moonLight.visible = this.moonLight.intensity > 0.01;

    // Fog / haze.
    const dayFog = new THREE.Color(0xd7c9b2);
    const duskFog = new THREE.Color(0xe3a56f);
    const nightFog = new THREE.Color(0x070b12);
    const fog = duskFog
      .clone()
      .lerp(dayFog, smoothstep(0.02, 0.34, this.sunDirection.y))
      .lerp(nightFog, dark);
    this.scene.fog.color.copy(fog);
    this.scene.fog.density = 0.000009 + dark * 0.000004;
    this.hemi.color.copy(fog).lerp(new THREE.Color(0x99bbdd), 0.55);
    this.hemi.groundColor.setHex(0x3a3527);
    this.hemi.intensity = 0.13 + daylight * 0.28 + dusk * 0.16 + dark * 0.18;
    this.scene.environmentIntensity = 0.12 + daylight * 0.32 + dusk * 0.18 + dark * 0.22;

    // Stars, moon, sun halo.
    this.starMaterial.opacity = smoothstep(0.06, -0.14, this.sunDirection.y) * 0.95;
    this.stars.visible = this.starMaterial.opacity > 0.005;
    this.moonMaterial.opacity = smoothstep(0.02, -0.12, this.sunDirection.y) * 0.9;
    this.moon.visible = this.moonMaterial.opacity > 0.005;
    this.sunMaterial.opacity = 0.28 * smoothstep(-0.06, 0.04, this.sunDirection.y);
    this.sunSprite.visible = this.sunMaterial.opacity > 0.01;

    // Cloud deck lighting: warm sunlit tops at golden hour, dark at night.
    this.cloudMaterial.color
      .copy(this.sunColor)
      .multiplyScalar(0.36 + daylight * 0.40 + dusk * 0.24);
    this.cloudMaterial.opacity = 0.25 + daylight * 0.62 + dusk * 0.5;
    this.clouds.visible = this.cloudMaterial.opacity > 0.02;
    this.sunMaterial.color.copy(this.sunColor);

    if (this.water) this.updateWater();
  }
}
