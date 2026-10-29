import * as THREE from 'three';
import { glowTexture, smokeTexture } from '../world/textures.js';
import { clamp, mulberry32, noise1 } from '../core/utils.js';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(220.0, aSize * uScale / max(-mv.z, 0.5));
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    if (tex.a < 0.004) discard;
    gl_FragColor = vec4(vColor, tex.a * vAlpha);
  }
`;

export class Effects {
  constructor(scene, renderer) {
    this.renderer = renderer;
    this.max = 1100;
    this.particles = [];
    this.rng = mulberry32(4242);
    this.contrailTimer = 0;
    this.wingTimer = 0;
    this.crashTimer = 0;
    this.scene = scene;
    this.flashes = [];

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.max * 3);
    this.sizes = new Float32Array(this.max);
    this.alphas = new Float32Array(this.max);
    this.colors = new Float32Array(this.max * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: smokeTexture() },
        uScale: { value: 500 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(position, velocity, opts) {
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push({
      x: position.x,
      y: position.y,
      z: position.z,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
      age: 0,
      life: opts.life ?? 1,
      size0: opts.size0 ?? 1,
      size1: opts.size1 ?? 6,
      alpha: opts.alpha ?? 0.3,
      color: opts.color ?? 0xffffff,
      drag: opts.drag ?? 0.4,
      rise: opts.rise ?? 0,
    });
  }

  landingBurst(position, heading) {
    const count = 26;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const p = new THREE.Vector3(
        position.x + Math.cos(heading) * (this.rng() - 0.5) * 5 + side * 2.5,
        position.y - 0.6,
        position.z + Math.sin(heading) * (this.rng() - 0.5) * 5
      );
      const v = new THREE.Vector3(
        (this.rng() - 0.5) * 7,
        1.5 + this.rng() * 3,
        (this.rng() - 0.5) * 7
      );
      this.spawn(p, v, {
        life: 1.4 + this.rng() * 1.4,
        size0: 1.6,
        size1: 10,
        alpha: 0.22,
        color: 0xbcae94,
        drag: 1.2,
        rise: 0.6,
      });
    }
  }

  /** Muzzle flame: a very short additive bloom at the gun port. */
  muzzleFlash(position, direction) {
    this.flash(position, 0xffd49a, 3.2, 0.07);
    const p = position.clone().addScaledVector(direction, 0.6);
    for (let i = 0; i < 2; i++) {
      this.spawn(p, new THREE.Vector3(
        direction.x * 60 + (this.rng() - 0.5) * 8,
        direction.y * 60 + (this.rng() - 0.5) * 8,
        direction.z * 60 + (this.rng() - 0.5) * 8
      ), {
        life: 0.055,
        size0: 1.3,
        size1: 3.2,
        alpha: 0.85,
        color: 0xffd79a,
        drag: 8,
      });
    }
  }

  /** Additive light burst for an explosion or a hard impact. */
  flash(position, color = 0xffb060, size = 14, life = 0.35) {
    const material = new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,245,220,0.95)', 'rgba(255,120,40,0)'),
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(size);
    sprite.renderOrder = 7;
    this.scene.add(sprite);
    this.flashes.push({ sprite, age: 0, life, size });
  }

  /** A fighter-sized fireball: orange core, black smoke, tumbling debris. */
  explosion(position, scale = 1) {
    this.flash(position, 0xffc070, 38 * scale, 0.45);
    for (let i = 0; i < 46; i++) {
      const dir = new THREE.Vector3(
        this.rng() - 0.5,
        this.rng() - 0.35,
        this.rng() - 0.5
      )
        .normalize()
        .multiplyScalar((8 + this.rng() * 34) * scale);
      this.spawn(
        new THREE.Vector3(position.x, position.y, position.z),
        dir,
        {
          life: 0.55 + this.rng() * 0.8,
          size0: (2 + this.rng() * 4) * scale,
          size1: (14 + this.rng() * 12) * scale,
          alpha: 0.55 + this.rng() * 0.3,
          color: i % 3 === 0 ? 0xffcf7a : i % 3 === 1 ? 0xff7a32 : 0x7a3218,
          drag: 1.4 + this.rng(),
          rise: 1.5,
        }
      );
    }
    for (let i = 0; i < 26; i++) {
      this.spawn(
        new THREE.Vector3(position.x, position.y, position.z),
        new THREE.Vector3(
          (this.rng() - 0.5) * 22,
          (this.rng() - 0.2) * 22,
          (this.rng() - 0.5) * 22
        ),
        {
          life: 3 + this.rng() * 4,
          size0: 3 * scale,
          size1: 20 * scale,
          alpha: 0.42,
          color: 0x2c2926,
          drag: 0.55,
          rise: 2.2,
        }
      );
    }
  }

  /** Small hard sparks from a round hitting metal. */
  sparks(position, color = 0xffcf8a) {
    for (let i = 0; i < 7; i++) {
      const dir = new THREE.Vector3(
        this.rng() - 0.5,
        this.rng() - 0.5,
        this.rng() - 0.5
      )
        .normalize()
        .multiplyScalar(8 + this.rng() * 16);
      this.spawn(position, dir, {
        life: 0.18 + this.rng() * 0.25,
        size0: 0.45,
        size1: 1.8,
        alpha: 0.9,
        color,
        drag: 2.5,
        rise: -3,
      });
    }
    this.flash(position, 0xffd2a0, 2.2, 0.12);
  }

  emit(dt, { state, model, spec, camera, time }) {
    const pos = state.position;
    const q = state.quaternion;
    const altitude = state.telemetry?.altitudeMSL ?? pos.y;
    const speed = state.speed;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const m = this.rng;

    // Engine contrails at high altitude.
    const spread = model.contrailOrigins || [];
    const contrailConditions =
      spread.length > 0 && altitude > 5800 && speed > 110 && !state.onGround;
    if (contrailConditions) {
      this.contrailTimer += dt;
      const interval = 0.075;
      while (this.contrailTimer > interval) {
        this.contrailTimer -= interval;
        for (const origin of spread) {
          const p = origin.clone().applyQuaternion(q).add(pos);
          p.x += (m() - 0.5) * 0.4;
          p.y += (m() - 0.5) * 0.4;
          p.z += (m() - 0.5) * 0.4;
          const v = forward.clone().multiplyScalar(-1.2);
          v.x += (m() - 0.5) * 0.6;
          v.y += (m() - 0.5) * 0.35;
          this.spawn(p, v, {
            life: 9 + m() * 7,
            size0: 0.6,
            size1: 8 + m() * 7,
            alpha: 0.25,
            color: 0xf3f6f8,
            drag: 0.12,
            rise: 0.08,
          });
        }
      }
    } else {
      this.contrailTimer = 0;
    }

    // Wingtip vapour during loaded manoeuvres.
    const g = Math.abs(state.gLoad || 1);
    const vapourConditions = g > 4.2 && speed > 90 && !state.onGround;
    if (vapourConditions) {
      this.wingTimer += dt;
      const interval = 0.035;
      while (this.wingTimer > interval) {
        this.wingTimer -= interval;
        const half = Math.sqrt(spec.aspect * spec.wingArea) * 0.48;
        for (const side of [-1, 1]) {
          const p = new THREE.Vector3(side * half, 0.4, -0.4).applyQuaternion(q).add(pos);
          const v = new THREE.Vector3(0, 0, 0);
          this.spawn(p, v, {
            life: 0.75 + m() * 0.4,
            size0: 0.25,
            size1: 2.2,
            alpha: 0.25,
            color: 0xffffff,
            drag: 0.5,
            rise: 0.2,
          });
        }
      }
    } else {
      this.wingTimer = 0;
    }

    // Smoke from a wreck.
    if (state.crashed) {
      this.crashTimer += dt;
      if (this.crashTimer > 0.09) {
        this.crashTimer = 0;
        const p = new THREE.Vector3(
          pos.x + (m() - 0.5) * 5,
          pos.y + 0.5 + m() * 2,
          pos.z + (m() - 0.5) * 5
        );
        this.spawn(
          p,
          new THREE.Vector3((m() - 0.5) * 2, 3 + m() * 4, (m() - 0.5) * 2),
          {
            life: 4 + m() * 3,
            size0: 2,
            size1: 16,
            alpha: 0.18,
            color: 0x3a3632,
            drag: 0.5,
            rise: 1.4,
          }
        );
      }
    } else {
      this.crashTimer = 0;
    }

    this.update(dt, camera);
  }

  update(dt, camera) {
    const particles = this.particles;
    let write = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      const t = p.age / p.life;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vz *= damp;
      p.vy = p.vy * damp + p.rise * dt;

      const idx = write;
      this.positions[idx * 3] = p.x;
      this.positions[idx * 3 + 1] = p.y;
      this.positions[idx * 3 + 2] = p.z;
      this.sizes[idx] = p.size0 + (p.size1 - p.size0) * Math.pow(t, 0.6);
      this.alphas[idx] = p.alpha * Math.pow(1 - t, 1.35);
      const color = new THREE.Color(p.color);
      this.colors[idx * 3] = color.r;
      this.colors[idx * 3 + 1] = color.g;
      this.colors[idx * 3 + 2] = color.b;
      particles[write] = p;
      write++;
    }
    particles.length = write;
    this.geo.setDrawRange(0, write);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;

    const flashes = this.flashes;
    let flashWrite = 0;
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        continue;
      }
      f.sprite.material.opacity = 0.95 * Math.pow(1 - t, 1.6);
      f.sprite.scale.setScalar(f.size * (0.7 + t * 0.9));
      flashes[flashWrite] = f;
      flashWrite++;
    }
    flashes.length = flashWrite;

    if (camera) {
      const buf = new THREE.Vector2();
      this.renderer.getDrawingBufferSize(buf);
      const scale = buf.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
      this.material.uniforms.uScale.value = scale;
    }
  }

  clear() {
    this.particles.length = 0;
    this.geo.setDrawRange(0, 0);
    for (const f of this.flashes) {
      this.scene.remove(f.sprite);
      f.sprite.material.dispose();
    }
    this.flashes.length = 0;
  }
}
