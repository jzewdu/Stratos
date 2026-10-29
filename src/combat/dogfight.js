import * as THREE from 'three';
import { FlightPhysics } from '../flight/flight.js';
import { AIRCRAFT_SPECS } from '../aircraft/specs.js';
import { cloneImportedAircraft } from '../aircraft/imported.js';
import { createAircraft } from '../aircraft/models.js';
import { GunSystem, MUZZLE_SPEED } from './guns.js';
import { clamp, mulberry32, terrainHeight } from '../core/utils.js';

const F22 = AIRCRAFT_SPECS.f22;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

function forwardOf(physics, out = new THREE.Vector3()) {
  return out.set(0, 0, 1).applyQuaternion(physics.quaternion);
}

function rightOf(physics, out = new THREE.Vector3()) {
  return out.set(1, 0, 0).applyQuaternion(physics.quaternion);
}

function upOf(physics, out = new THREE.Vector3()) {
  return out.set(0, 1, 0).applyQuaternion(physics.quaternion);
}

/**
 * A guns-only 1v1 against a Raptor flown by an AI pilot.
 *
 * The bandit is a full FlightPhysics airframe, not a scripted spline: it has
 * mass, thrust, lift, stall and G limits like the player. The controller only
 * moves the stick and throttle, which is what keeps the fight honest and lets
 * extra bandits be added later without changing the flight model.
 */
export class Dogfight {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.active = false;
    this.player = null;
    this.bandits = [];
    this.guns = new GunSystem(game.scene);
    this.kills = 0;
    this.losses = 0;
    this.hitFlash = 0;
    this.hitMarker = 0;
    this.respawnTimer = 0;
    this.rng = mulberry32(7117);
    this.banditSerial = 0;
    this.guns.onShot = (shooter, origin, direction) => {
      this.game.effects.muzzleFlash(origin, direction);
    };
    this.guns.onHit = (target, shooter, point) => this._onHit(target, shooter, point);
  }

  start(playerPhysics, playerModel) {
    this.stop();
    this.active = true;
    this.kills = 0;
    this.losses = 0;
    this.hitFlash = 0;
    this.hitMarker = 0;
    this.respawnTimer = 0;
    this.banditSerial = 0;

    this.player = {
      id: 'player',
      name: 'RAPTOR 1',
      team: 'blue',
      isPlayer: true,
      physics: playerPhysics,
      model: playerModel,
      health: 100,
      maxHealth: 100,
      alive: true,
      hitRadius: 5.2,
      spread: 0,
      smokeTimer: 0,
    };
    this.guns.equip(this.player, {
      rounds: 480,
      muzzles: [new THREE.Vector3(1.24, -0.2, 5.0)],
    });

    this._spawnBandit(true);
  }

  stop() {
    this.active = false;
    this.guns.clear();
    for (const bandit of this.bandits) {
      if (bandit.model?.group) {
        // Geometry and materials belong to the cached template (or to the
        // procedural cache); removing the node graph is all that is required.
        this.scene.remove(bandit.model.group);
      }
    }
    this.bandits.length = 0;
    this.player = null;
  }

  _spawnBandit(initial = false) {
    const playerPhysics = this.player.physics;
    const physics = new FlightPhysics(F22);
    physics.reset({ mode: 'airborne', controlId: 'pilot' });
    physics.controlId = 'pilot';
    physics.onGround = false;
    physics.crashed = false;
    physics.crashReason = '';
    physics.gearDown = false;
    physics.gearT = 0;
    physics.throttle = 0.84;
    physics.afterburnerLevel = 0;
    physics.speed = 250;
    physics.telemetry = null;

    const playerPos = playerPhysics.position;
    const playerForward = forwardOf(playerPhysics);
    const playerRight = rightOf(playerPhysics);

    let pos;
    if (initial) {
      // Head-on pass, 2.6 km in front and slightly low. Both aircraft see each
      // other immediately instead of the fight starting with a blind turn.
      pos = playerPos
        .clone()
        .addScaledVector(playerForward, 2600)
        .addScaledVector(playerRight, 620);
      pos.y += 140;
    } else {
      // Respawn ahead and to one side so the player is never shot from behind
      // by an aircraft that just materialised on their six.
      const side = this.rng() > 0.5 ? 1 : -1;
      pos = playerPos
        .clone()
        .addScaledVector(playerForward, 2200 + this.rng() * 700)
        .addScaledVector(playerRight, side * (900 + this.rng() * 500));
      pos.y += 260 + this.rng() * 420;
    }
    const ground = Math.max(terrainHeight(pos.x, pos.z), 0);
    pos.y = Math.max(pos.y, ground + 1400);
    pos.y = Math.min(pos.y, ground + 8200);

    const toPlayer = _v1.subVectors(playerPos, pos).normalize();
    const heading = Math.atan2(toPlayer.x, toPlayer.z);
    // Negative X Euler is nose-up; point the jet at the lead turn, not at the
    // ground, so the AI does not start with a 90° dive.
    const pitch = Math.asin(clamp(toPlayer.y, -0.7, 0.7));
    physics.position.copy(pos);
    physics.quaternion.setFromEuler(new THREE.Euler(-pitch * 0.6, heading, 0, 'YXZ'));
    physics.velocity.set(0, 0, 0).addScaledVector(forwardOf(physics), 245);
    physics.speed = 245;
    physics.mach = 0.72;

    const model = cloneImportedAircraft('f22') || createAircraft('f22');
    if (!model) return null;
    model.group.visible = true;
    if (model.parts.gearGroup) model.parts.gearGroup.visible = false;
    if (model.parts.gearUpGroup) model.parts.gearUpGroup.visible = true;
    model.group.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    this.scene.add(model.group);

    this.banditSerial++;
    const bandit = {
      id: `bandit-${this.banditSerial}`,
      name: `VIPER ${this.banditSerial}`,
      team: 'red',
      physics,
      model,
      health: 100,
      maxHealth: 100,
      alive: true,
      hitRadius: 5.4,
      spread: 0.011,
      smokeTimer: 0,
      burstTimer: 0.8,
      bursting: false,
      fire: false,
      respawnIn: 0,
      turnDir: 0,
      skill: 0.82 + this.rng() * 0.12,
    };
    this.guns.equip(bandit, {
      rounds: 480,
      muzzles: [new THREE.Vector3(1.24, -0.2, 5.0)],
    });
    this.bandits.push(bandit);
    this._syncBandit(bandit);
    return bandit;
  }

  _resetBandit(bandit) {
    const playerPhysics = this.player.physics;
    const playerPos = playerPhysics.position;
    const forward = forwardOf(playerPhysics);
    const right = rightOf(playerPhysics);
    const side = this.rng() > 0.5 ? 1 : -1;
    const pos = playerPos
      .clone()
      .addScaledVector(forward, 2400 + this.rng() * 800)
      .addScaledVector(right, side * (600 + this.rng() * 700));
    pos.y += 160 + this.rng() * 500;
    const ground = Math.max(terrainHeight(pos.x, pos.z), 0);
    pos.y = clamp(pos.y, ground + 1300, ground + 8000);

    const p = bandit.physics;
    p.position.copy(pos);
    p.crashed = false;
    p.crashReason = '';
    p.onGround = false;
    p.gearDown = false;
    p.gearT = 0;
    p.throttle = 0.86;
    p.afterburnerLevel = 0;
    p.angularVelocity.set(0, 0, 0);
    p.airborneTime = 0;
    p.telemetry = null;

    const toPlayer = _v1.subVectors(playerPos, pos).normalize();
    const heading = Math.atan2(toPlayer.x, toPlayer.z);
    const pitch = Math.asin(clamp(toPlayer.y, -0.7, 0.7));
    p.quaternion.setFromEuler(new THREE.Euler(-pitch * 0.6, heading, 0, 'YXZ'));
    p.velocity.copy(forwardOf(p)).multiplyScalar(240);
    p.speed = 240;
    bandit.health = 100;
    bandit.alive = true;
    bandit.ammo = 480;
    bandit.gunCooldown = 0;
    bandit.smokeTimer = 0;
    bandit.burstTimer = 0.7;
    bandit.bursting = false;
    bandit.fire = false;
    bandit.respawnIn = 0;
    bandit.turnDir = 0;
    bandit.model.group.visible = true;
    this._syncBandit(bandit);
  }

  /**
   * One fixed simulation step: fly the bandit, pull both triggers, advance
   * every projectile and resolve damage. Kept out of the render loop so the
   * guns and the flight model share the same 120 Hz clock.
   */
  step(dt) {
    if (!this.active || !this.player) return;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.6);
    this.hitMarker = Math.max(0, this.hitMarker - dt * 3.2);
    this.game.hitShake = Math.max(0, (this.game.hitShake || 0) - dt * 2.8);

    if (!this.player.alive) return;

    this.guns.trigger(this.player, !!this.game.input.firing, dt);
    this._emitDamage(this.player, dt);

    for (const bandit of this.bandits) {
      if (!bandit.alive) {
        bandit.respawnIn -= dt;
        if (bandit.respawnIn <= 0) this._resetBandit(bandit);
        continue;
      }
      const input = this._banditInput(bandit, dt);
      bandit.physics.step(dt, input, 'pilot', this.game.time);
      bandit.physics.onRunway = false;

      if (bandit.physics.crashed || bandit.physics.onGround) {
        bandit.physics.crash('Ground collision');
        this._killBandit(bandit, false);
        continue;
      }

      const aimError = this.guns.aimError(bandit, this.player);
      const dist = bandit.physics.position.distanceTo(this.player.physics.position);
      this._updateBurst(bandit, dt, aimError, dist);
      this.guns.trigger(bandit, bandit.fire, dt);
      this._emitDamage(bandit, dt);
    }

    const targets = [this.player, ...this.bandits];
    this.guns.update(dt, targets);
  }

  _banditInput(bandit, dt) {
    const p = bandit.physics;
    const target = this.player.physics;
    const to = _v1.subVectors(target.position, p.position);
    const dist = to.length();

    const invQ = _q.copy(p.quaternion).invert();
    // Geometry uses the target itself, not the ballistic aim point. The gun
    // solution is a relative-frame vector and can become very short (or flip
    // sign) at long range, which must never drive the turn controller.
    const local = to.clone().applyQuaternion(invQ);
    const right = rightOf(p, new THREE.Vector3());
    const up = upOf(p, new THREE.Vector3());

    // Keep the full -180..180 geometry. Clamping the forward component turns
    // a target behind the jet into a small error and the AI flies away.
    const headingError = Math.atan2(local.x, local.z);
    const flat = Math.hypot(local.x, local.z);
    const pitchError = Math.atan2(local.y, Math.max(flat, 4));
    const targetDir = to.clone().normalize();
    const angleOff = Math.acos(clamp(forwardOf(p).dot(targetDir), -1, 1));
    const targetBehind = angleOff > 1.55;
    // Latch the turn direction until the nose is back inside 60°. Recomputing
    // it from the sign of a target directly astern makes the AI reverse its
    // bank at the 180° point and orbit the fight without ever re-engaging.
    if (angleOff > 1.5 && bandit.turnDir === 0) {
      bandit.turnDir = headingError >= 0 ? 1 : -1;
    } else if (angleOff < 0.5) {
      bandit.turnDir = 0;
    }
    const turningAround = bandit.turnDir !== 0;
    const bank = Math.atan2(-right.y, up.y); // positive = right wing down
    const rollRate = p.angularVelocity.z;

    // In a turning fight the target is usually behind the wing, not in front
    // of the nose. Holding altitude with a hard bank turns the jet far faster
    // than trying to point the nose straight at a target on the six.
    const desiredBank = turningAround
      ? bandit.turnDir * 1.4
      : clamp(headingError * 2.0, -1.24, 1.24);
    const altitudeError = target.position.y - p.position.y;

    let pitch;
    let roll = clamp((desiredBank - bank) * 2.4 - rollRate * 0.2, -1, 1);
    if (turningAround) {
      // A bank alone does not turn an aircraft: the wing has to carry the
      // extra load. Hold the desired vertical speed with pitch, so the turn is
      // a sustained loaded turn instead of a wide, level arc.
      const desiredVs = clamp(altitudeError * 0.055, -70, 55);
      pitch = clamp((desiredVs - p.velocity.y) * 0.0095, -0.62, 0.62);
      pitch += Math.abs(Math.sin(bank)) * 0.06;
    } else {
      pitch = clamp(pitchError * 2.2 + Math.abs(Math.sin(bank)) * 0.14, -0.82, 0.82);
    }
    // Never hold a high-G pull into a stall; unload a little but keep the
    // bank so the turn can continue once the speed is back.
    if (p.speed < 205) {
      roll *= 0.7;
      pitch = Math.min(pitch, -0.45);
    } else if ((p.telemetry?.gLoad || 1) > 8.4) {
      pitch = Math.min(pitch, 0.08);
    }
    const yaw = clamp(headingError * 0.55, -0.4, 0.4);

    // If the fight gets very close, unload and extend instead of colliding.
    if (dist < 170) {
      roll = clamp(roll + (this.rng() - 0.5) * 0.4, -1, 1);
      pitch = clamp(pitch + 0.25, -1, 1);
    }

    // Ground avoidance is non-negotiable for an AI that is allowed to pull.
    const ground = Math.max(terrainHeight(p.position.x, p.position.z), 0);
    const agl = p.position.y - ground;
    if (agl < 520) {
      const urgency = clamp((520 - agl) / 420, 0, 1);
      if (p.velocity.y < 35) pitch = Math.max(pitch, urgency);
      if (agl < 240) {
        roll *= 0.25;
        pitch = Math.max(pitch, 0.55 + urgency * 0.45);
      }
    }
    if (p.position.y > ground + 9800) pitch = Math.min(pitch, -0.35);

    let throttle = 0.86;
    if (turningAround) {
      // Trade speed for turn rate. A 300 m/s level turn has a three-kilometre
      // radius; a 220 m/s loaded turn halves that and brings the nose around
      // while the player is still in range.
      throttle = p.speed > 235 ? 0.15 : 0.8;
    } else if (dist > 1800 || p.speed < 235) {
      throttle = 1;
    } else if (dist < 320) {
      throttle = 0.7;
    }
    if (p.speed > 330) throttle = Math.min(throttle, 0.62);
    if (agl < 360) throttle = 1;

    return {
      pitch,
      roll,
      yaw,
      throttle,
      brake: false,
    };
  }

  _updateBurst(bandit, dt, aimError, dist) {
    if (dist > 1150 || dist < 75 || aimError > 0.045 || bandit.ammo <= 0) {
      bandit.fire = false;
      bandit.bursting = false;
      bandit.burstTimer = 0.35 + this.rng() * 0.5;
      return;
    }
    bandit.burstTimer -= dt;
    if (bandit.burstTimer <= 0) {
      bandit.bursting = !bandit.bursting;
      bandit.burstTimer = bandit.bursting
        ? 0.34 + this.rng() * 0.32
        : 0.62 + this.rng() * 0.8;
    }
    bandit.fire = bandit.bursting;
  }

  _onHit(target, shooter, point) {
    if (!target?.alive || !shooter) return;
    const playerShot = !!shooter.isPlayer;
    const damage = playerShot ? 4.4 : 2.55;
    target.health -= damage;
    this.game.effects.sparks(point, playerShot ? 0xffd08a : 0xff9a72);
    if (playerShot) {
      this.hitFlash = 1;
      this.hitMarker = 1;
      this.game.hitShake = Math.min(0.75, (this.game.hitShake || 0) + 0.16);
    }
    if (target.isPlayer) {
      this.game.hitShake = Math.min(1.1, (this.game.hitShake || 0) + 0.4);
      if (target.health <= 0 && target.alive) this._playerDown(shooter);
    } else if (target.health <= 0 && target.alive) {
      this._killBandit(target, true, shooter);
    }
  }

  _killBandit(bandit, byPlayer, shooter = null) {
    if (!bandit.alive) return;
    bandit.alive = false;
    bandit.model.group.visible = false;
    bandit.respawnIn = 7.5;
    this.game.effects.explosion(bandit.physics.position, 1);
    if (byPlayer) {
      this.kills++;
      this.hitMarker = 1;
      this.game.ui.toast(`SPLASH · ${bandit.name} DESTROYED · NEXT CONTACT IN 8s`, 3200);
    } else {
      this.game.ui.toast(`${bandit.name} lost · next contact in 8s`, 2600);
    }
    bandit.fire = false;
  }

  _playerDown(shooter) {
    if (!this.player.alive) return;
    this.player.alive = false;
    this.player.health = 0;
    this.active = false;
    this.guns.clear();
    this.game.effects.explosion(this.player.physics.position, 1.2);
    this.game.ui.toast('SHOT DOWN · AIRFRAME LOST', 3000);
    this.game.physics.crash(`Shot down by ${shooter?.name || 'a hostile fighter'}`);
  }

  _emitDamage(entity, dt) {
    if (!entity.alive || entity.health > 55) return;
    entity.smokeTimer -= dt;
    if (entity.smokeTimer > 0) return;
    entity.smokeTimer = entity.health < 25 ? 0.045 : 0.09;
    const pos = entity.physics.position;
    const effects = this.game.effects;
    const rng = this.rng;
    const smoke = new THREE.Vector3(
      pos.x + (rng() - 0.5) * 4,
      pos.y + (rng() - 0.5) * 2,
      pos.z + (rng() - 0.5) * 4
    );
    const vel = entity.physics.velocity.clone().multiplyScalar(0.08);
    vel.x += (rng() - 0.5) * 3;
    vel.y += (rng() - 0.5) * 2;
    vel.z += (rng() - 0.5) * 3;
    effects.spawn(smoke, vel, {
      life: 2.4 + rng() * 2.5,
      size0: 1.1,
      size1: 11,
      alpha: 0.34,
      color: entity.health < 25 ? 0x5a2a16 : 0x3c3630,
      drag: 0.6,
      rise: 1.5,
    });
    if (entity.health < 26 && rng() > 0.5) {
      effects.spawn(smoke, new THREE.Vector3(vel.x, vel.y + 3, vel.z), {
        life: 0.32 + rng() * 0.3,
        size0: 1.6,
        size1: 5.2,
        alpha: 0.55,
        color: 0xff8a36,
        drag: 1.6,
        rise: 3,
      });
    }
  }

  _syncBandit(bandit) {
    const model = bandit.model;
    const physics = bandit.physics;
    if (!model?.group) return;
    model.group.position.copy(physics.position);
    model.group.quaternion.copy(physics.quaternion);

    const parts = model.parts;
    const ab = physics.afterburnerLevel || 0;
    if (parts.afterburners) {
      for (const flame of parts.afterburners) {
        flame.visible = ab > 0.03;
        flame.material.opacity = ab * (flame.userData.opacityScale ?? 0.5);
        flame.scale.set(0.94 + ab * 0.06, 0.5 + ab * 0.5, 0.94 + ab * 0.06);
      }
    }
    if (parts.abCores) {
      for (const core of parts.abCores) {
        core.visible = ab > 0.03;
        core.material.opacity = ab * (core.userData.opacityScale ?? 0.9);
        core.scale.set(0.96, 0.55 + ab * 0.55, 0.96);
      }
    }
    if (parts.abGlows) {
      for (const glow of parts.abGlows) {
        glow.visible = ab > 0.03;
        glow.material.opacity = ab * 0.5;
      }
    }
    if (parts.abShockCells) {
      for (const cell of parts.abShockCells) {
        const active = ab * clamp((physics.mach - 0.55) * 1.8, 0, 1);
        cell.visible = active > 0.18;
        cell.material.opacity = Math.max(0, active - 0.18) * (cell.userData.opacityScale ?? 0.2);
      }
    }
  }

  sync() {
    if (!this.player) return;
    for (const bandit of this.bandits) {
      if (!bandit.alive) continue;
      this._syncBandit(bandit);
    }
    this.guns.sync();
  }

  /**
   * Everything the HUD needs to draw the gunsight and the target tally.
   * Screen coordinates are projected from the real target and the real lead
   * point, so the pipper is the same solution the bullets use.
   */
  hudData(camera) {
    if (!this.active || !this.player) return { active: false };
    const width = window.innerWidth;
    const height = window.innerHeight;
    const playerPhysics = this.player.physics;

    let target = null;
    let nearest = Infinity;
    for (const bandit of this.bandits) {
      if (!bandit.alive) continue;
      const d = bandit.physics.position.distanceToSquared(playerPhysics.position);
      if (d < nearest) {
        nearest = d;
        target = bandit;
      }
    }

    const out = {
      active: true,
      target: null,
      gun: null,
      ammo: this.player.ammo,
      maxAmmo: this.player.maxAmmo,
      health: this.player.health,
      kills: this.kills,
      hitMarker: this.hitMarker,
      hitFlash: this.hitFlash,
      noTarget: !target,
      respawnIn: target ? 0 : Math.max(0, this.bandits[0]?.respawnIn || 0),
    };
    if (!target) return out;

    const dist = Math.sqrt(nearest);
    const targetScreen = this._project(camera, target.physics.position, width, height);
    const aim = this.guns.predictAim(this.player, target, MUZZLE_SPEED);
    const aimScreen = this._project(camera, aim, width, height);
    const aimError = this.guns.aimError(this.player, target);
    const ls = _v1.subVectors(target.physics.position, playerPhysics.position).normalize();
    const rel = _v2.subVectors(target.physics.velocity, playerPhysics.velocity);
    const closure = -rel.dot(ls);
    const targetSize = clamp((19 / Math.max(dist, 1)) * (height / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 2.2, 20, 118);

    out.target = {
      name: target.name,
      dist,
      closure,
      health: Math.max(0, target.health),
      screen: targetScreen,
      size: targetSize,
      aspect: Math.acos(clamp(forwardOf(playerPhysics).dot(ls), -1, 1)) * (180 / Math.PI),
    };
    out.gun = {
      screen: aimScreen,
      inCone: aimError < 0.026 && dist < 1250,
      aimErrorDeg: aimError * (180 / Math.PI),
      ready: this.player.ammo > 0,
    };
    return out;
  }

  _project(camera, world, width, height) {
    const cam = _v3.copy(world).applyMatrix4(camera.matrixWorldInverse);
    const inFront = cam.z < -0.1;
    const ndc = cam.clone().applyMatrix4(camera.projectionMatrix);
    const x = (ndc.x * 0.5 + 0.5) * width;
    const y = (-ndc.y * 0.5 + 0.5) * height;
    return {
      x,
      y,
      inFront,
      visible: inFront && ndc.x > -1.05 && ndc.x < 1.05 && ndc.y > -1.05 && ndc.y < 1.05,
    };
  }
}
