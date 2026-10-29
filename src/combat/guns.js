import * as THREE from 'three';
import { clamp, mulberry32, terrainHeight } from '../core/utils.js';

const UP = new THREE.Vector3(0, 1, 0);
const MUZZLE_SPEED = 1030; // M61A2 20 mm muzzle velocity, m/s
const ROUNDS_PER_MINUTE = 3900;
const ROUND_INTERVAL = 60 / ROUNDS_PER_MINUTE;
const BULLET_LIFE = 3.4;
const MAX_RANGE = 3200;
const GRAVITY = 9.80665;

const tmp = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const tmpClosest = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const ZERO = new THREE.Vector3();

export class GunSystem {
  constructor(scene) {
    this.scene = scene;
    this.bullets = [];
    this.rng = mulberry32(90210);
    this.onShot = null;
    this.onHit = null;

    this.maxBullets = 420;
    const geometry = new THREE.CylinderGeometry(0.075, 0.075, 1, 4, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffc36b,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.tracers = new THREE.InstancedMesh(geometry, material, this.maxBullets);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.tracers.renderOrder = 5;
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.tracers);
    this.dummy = new THREE.Object3D();

    // A brighter, short-lived core on every tracer so the stream reads as
    // incandescent rather than as a row of identical orange sticks.
    const coreGeo = new THREE.CylinderGeometry(0.028, 0.028, 1, 4, 1, true);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xfff1cf,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.cores = new THREE.InstancedMesh(coreGeo, coreMat, this.maxBullets);
    this.cores.frustumCulled = false;
    this.cores.count = 0;
    this.cores.renderOrder = 6;
    this.cores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.cores);
  }

  /** Give an airframe a gun: ammo count, cadence and a muzzle in body space. */
  equip(entity, { rounds = 480, muzzles = null } = {}) {
    entity.ammo = rounds;
    entity.maxAmmo = rounds;
    entity.gunCooldown = 0;
    entity.muzzles =
      muzzles ||
      [
        new THREE.Vector3(1.28, -0.18, 5.1),
      ];
  }

  /**
   * Trigger pull. Called from the fixed simulation step so the cadence is
   * independent of frame rate. Multiple rounds can leave the barrel in one
   * step if the frame is slow, bounded by the magazine.
   */
  trigger(shooter, firing, dt) {
    if (!shooter || !shooter.alive) return;
    shooter.gunCooldown = Math.max(-0.05, (shooter.gunCooldown || 0) - dt);
    if (!firing || shooter.ammo <= 0) return;

    let guard = 0;
    while (shooter.gunCooldown <= 0 && shooter.ammo > 0 && guard < 4) {
      this._fireRound(shooter);
      shooter.gunCooldown += ROUND_INTERVAL;
      guard++;
    }
  }

  _fireRound(shooter) {
    const physics = shooter.physics;
    const q = physics.quaternion;
    const forward = tmp.set(0, 0, 1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const muzzle = shooter.muzzles[(shooter.ammo - 1) % shooter.muzzles.length];
    const origin = new THREE.Vector3().copy(muzzle).applyQuaternion(q).add(physics.position);
    origin.addScaledVector(forward, 0.4);

    // Dispersion: a real gun does not put every round through the same hole.
    const spread = 0.0017 + (shooter.spread || 0);
    const yaw = (this.rng() - 0.5) * spread;
    const pitch = (this.rng() - 0.5) * spread;
    const dir = forward.clone();
    dir.addScaledVector(right, yaw).addScaledVector(up, pitch).normalize();

    const velocity = physics.velocity
      .clone()
      .addScaledVector(dir, MUZZLE_SPEED)
      .addScaledVector(up, 0.16); // muzzle jump, tiny at this mass

    shooter.ammo--;
    this.bullets.push({
      px: origin.x,
      py: origin.y,
      pz: origin.z,
      x: origin.x,
      y: origin.y,
      z: origin.z,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
      age: 0,
      owner: shooter,
      team: shooter.team,
      travelled: 0,
    });
    if (this.bullets.length > this.maxBullets) this.bullets.shift();
    this.onShot?.(shooter, origin, dir);
  }

  /** Step projectiles and resolve hits. Runs at the fixed simulation rate. */
  update(dt, targets) {
    const bullets = this.bullets;
    let write = 0;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      b.age += dt;
      if (b.age >= BULLET_LIFE) continue;

      b.px = b.x;
      b.py = b.y;
      b.pz = b.z;
      b.vy -= GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;

      const stepX = b.x - b.px;
      const stepY = b.y - b.py;
      const stepZ = b.z - b.pz;
      b.travelled += Math.hypot(stepX, stepY, stepZ);
      if (b.travelled > MAX_RANGE) continue;

      // Ground and a small altitude cutoff: a round that noses into the
      // Illinois farmland is gone, not left falling through the mesh.
      if (b.y < terrainHeight(b.x, b.z) + 0.2 || b.y > 20000) continue;

      let consumed = false;
      for (const target of targets) {
        if (!target || !target.alive || target.team === b.team) continue;
        const p = target.physics.position;
        const dx = p.x - b.px;
        const dy = p.y - b.py;
        const dz = p.z - b.pz;
        const ex = b.x - b.px;
        const ey = b.y - b.py;
        const ez = b.z - b.pz;
        const lenSq = ex * ex + ey * ey + ez * ez;
        if (lenSq < 0.0001) continue;
        const t = clamp((dx * ex + dy * ey + dz * ez) / lenSq, 0, 1);
        const cx = b.px + ex * t;
        const cy = b.py + ey * t;
        const cz = b.pz + ez * t;
        const ox = p.x - cx;
        const oy = p.y - cy;
        const oz = p.z - cz;
        const radius = target.hitRadius ?? 5.4;
        if (ox * ox + oy * oy + oz * oz > radius * radius) continue;

        tmpClosest.set(cx, cy, cz);
        this.onHit?.(target, b.owner, tmpClosest, b);
        consumed = true;
        break;
      }
      if (consumed) continue;

      bullets[write] = b;
      write++;
    }
    bullets.length = write;
  }

  /**
   * Latest lead point for a moving target. Used by the gunsight and the AI.
   *
   * The projectile leaves the aircraft, so it inherits the shooter's velocity
   * as well as the muzzle velocity. Solving in the target's world frame with
   * only the target's motion double-counts that inheritance and puts the pipper
   * far ahead of a co-speed target. The relative frame below is the correct
   * one: aim = relative displacement + relative motion + gravity drop.
   */
  predictAim(shooter, target, muzzleSpeed = MUZZLE_SPEED) {
    const from = shooter.physics ? shooter.physics.position : shooter;
    const shooterVel = shooter.physics ? shooter.physics.velocity : ZERO;
    const targetPos = target.physics ? target.physics.position : target.position;
    const targetVel = target.physics ? target.physics.velocity : ZERO;
    const relPos = tmpDir.subVectors(targetPos, from);
    const relVelX = targetVel.x - shooterVel.x;
    const relVelY = targetVel.y - shooterVel.y;
    const relVelZ = targetVel.z - shooterVel.z;

    let t = relPos.length() / muzzleSpeed;
    let ax = relPos.x;
    let ay = relPos.y;
    let az = relPos.z;
    for (let i = 0; i < 3; i++) {
      // Positive Y is up: the gun must point above the target by the drop.
      ax = relPos.x + relVelX * t;
      ay = relPos.y + relVelY * t + 0.5 * GRAVITY * t * t;
      az = relPos.z + relVelZ * t;
      t = Math.sqrt(ax * ax + ay * ay + az * az) / muzzleSpeed;
    }
    return new THREE.Vector3(from.x + ax, from.y + ay, from.z + az);
  }

  /** Aim error in radians between the boresight and the lead point. */
  aimError(shooter, target, muzzleSpeed = MUZZLE_SPEED) {
    const aim = this.predictAim(shooter, target, muzzleSpeed);
    const forward = tmp.set(0, 0, 1).applyQuaternion(shooter.physics.quaternion);
    tmpEnd.subVectors(aim, shooter.physics.position).normalize();
    return Math.acos(clamp(forward.dot(tmpEnd), -1, 1));
  }

  sync() {
    const bullets = this.bullets;
    const dummy = this.dummy;
    const forward = new THREE.Vector3();
    let count = 0;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      forward.set(b.vx, b.vy, b.vz).normalize();
      dummy.position.set(b.x, b.y, b.z);
      dummy.quaternion.setFromUnitVectors(UP, forward);
      // 12 m hot streak: at Mach 3 there is no such thing as a visible dot.
      dummy.scale.set(1, 12, 1);
      dummy.updateMatrix();
      this.tracers.setMatrixAt(count, dummy.matrix);
      dummy.scale.set(1, 8, 1);
      dummy.updateMatrix();
      this.cores.setMatrixAt(count, dummy.matrix);
      count++;
    }
    this.tracers.count = count;
    this.cores.count = count;
    this.tracers.instanceMatrix.needsUpdate = true;
    this.cores.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.bullets.length = 0;
    this.tracers.count = 0;
    this.cores.count = 0;
  }
}

export { MUZZLE_SPEED };
