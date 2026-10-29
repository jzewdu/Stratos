import * as THREE from 'three';
import {
  G,
  DEG,
  RAD,
  RUNWAY_LENGTH,
  RUNWAY_HEADING,
  HANGAR_BAY_U,
  HANGAR_BAY_V,
  HANGAR_APRON_V,
  terrainHeight,
  terrainNormal,
  altitudeAtmosphere,
  clamp,
  smoothstep,
  noise1,
} from '../core/utils.js';
import { CONTROL_LEVELS } from '../aircraft/specs.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

function clampAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class FlightPhysics {
  constructor(spec) {
    this.spec = spec;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3();
    this.input = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
    this.time = 0;
    this.reset({ mode: 'airborne' });
  }

  reset({ mode = 'airborne', controlId = 'pilot' } = {}) {
    const spec = this.spec;
    this.time = 0;
    this.controlId = controlId;
    this.crashed = false;
    this.crashReason = '';
    this.onGround = mode === 'runway' || mode === 'hangar';
    this.landingImpact = 0;
    this.airborneTime = 0;
    this.wasAirborne = false;
    this.flapIndex = 0;
    this.flapAngle = 0;
    this.angularVelocity.set(0, 0, 0);
    this.landingLightsOn = false;

    if (this.spec.fixedGear) {
      this.gearDown = true;
      this.gearT = 1;
    } else {
      this.gearDown = mode === 'runway' || mode === 'hangar';
      this.gearT = this.gearDown ? 1 : 0;
    }

    if (mode === 'runway') {
      const heading = RUNWAY_HEADING; // 03 at Nellis
      const along = -RUNWAY_LENGTH / 2 + 170;
      this.groundPitch = 0.025;
      this.position.set(Math.sin(heading) * along, 0, Math.cos(heading) * along);
      this.position.y = Math.max(terrainHeight(this.position.x, this.position.z), 0) + this.clearance();
      this.quaternion.setFromEuler(new THREE.Euler(-this.groundPitch, heading, 0, 'YXZ'));
      this.velocity.set(0, 0, 0);
      this.throttle = 0;
      this.afterburnerLevel = 0;
    } else if (mode === 'hangar') {
      // Active bay at Scott AFB: the hangar opens toward -v. Start on the
      // concrete just inside the doors, nose-out, so the airframe is sheltered
      // and its wheels sit on the bay floor rather than the apron outside.
      const localU = HANGAR_BAY_U;
      const localV = HANGAR_BAY_V;
      const sin = Math.sin(RUNWAY_HEADING);
      const cos = Math.cos(RUNWAY_HEADING);
      const heading = RUNWAY_HEADING + Math.PI / 2;
      this.groundPitch = 0;
      this.position.set(
        localU * sin - localV * cos,
        Math.max(terrainHeight(localU * sin - localV * cos, localU * cos + localV * sin), 0) +
          this.clearance() +
          0.08, // top of the hangar floor slab
        localU * cos + localV * sin
      );
      this.quaternion.setFromEuler(new THREE.Euler(0, heading, 0, 'YXZ'));
      this.velocity.set(0, 0, 0);
      // Begin cold and let the player advance throttle with Shift.
      this.throttle = 0;
      this.afterburnerLevel = 0;
    } else if (mode === 'dogfight') {
      // A guns-only engagement starts at medium altitude over the Illinois
      // farmland: fast enough to fight, high enough that the first mistake is
      // recoverable and the ground is not the primary threat.
      const heading = RUNWAY_HEADING;
      const x = -5200;
      const z = -2800;
      const surface = Math.max(terrainHeight(x, z), 0);
      const altitude = surface + 2600;
      const speed = 260;
      this.position.set(x, altitude, z);
      this.quaternion.setFromEuler(new THREE.Euler(-0.012, heading, 0, 'YXZ'));
      this.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
      this.throttle = 0.88;
      this.afterburnerLevel = 0;
      this.groundPitch = 0;
    } else {
      const heading = RUNWAY_HEADING;
      const x = -5200;
      const z = -2800;
      const surface = Math.max(terrainHeight(x, z), 0);
      const altitude = surface + spec.startAlt;
      const atm = altitudeAtmosphere(altitude);
      const speed = spec.startSpeed;
      const qbar = 0.5 * atm.density * speed * speed;
      const clNeeded = (spec.mass * G) / (qbar * spec.wingArea);
      const alphaDeg = clamp((clNeeded - spec.cl0) / spec.clAlpha, -2.5, 7.5);
      const pitch = alphaDeg * DEG;
      this.position.set(x, altitude, z);
      this.quaternion.setFromEuler(new THREE.Euler(-pitch, heading, 0, 'YXZ'));
      this.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
      this.throttle = spec.startThrottle;
      this.afterburnerLevel = 0;
      this.groundPitch = 0;
    }

    this.alpha = 0;
    this.beta = 0;
    this.speed = this.velocity.length();
    this.mach = 0;
    this.gLoad = 1;
    this.stallWarning = false;
    this.overspeedWarning = false;
    this.stallSeverity = 0;
    this.vs = 0;
    this.groundSpeed = 0;
    this.onRunway = mode === 'runway';
    this.telemetryCache = null;
  }

  toggleGear() {
    if (this.spec.fixedGear) return false;
    if (this.onGround && this.gearDown) return false;
    this.gearDown = !this.gearDown;
    return true;
  }

  changeFlaps(direction) {
    const next = clamp(this.flapIndex + direction, 0, this.spec.flaps.length - 1);
    if (next === this.flapIndex) return false;
    this.flapIndex = next;
    return true;
  }

  get flapTarget() {
    return this.spec.flaps[this.flapIndex] ?? 0;
  }

  surfaceAt(x, z) {
    return Math.max(terrainHeight(x, z), 0);
  }

  clearance() {
    if (this.spec.fixedGear) return this.spec.groundClearance;
    if (this.spec.id === 'f22') {
      return this.gearT > 0.4 ? this.spec.groundClearance : 0.62;
    }
    return this.gearT > 0.4 ? this.spec.groundClearance : this.spec.groundClearance * 0.55;
  }

  stallSpeedAt(rho = 1.225) {
    return Math.sqrt((2 * this.spec.mass * G) / (rho * this.spec.wingArea * this.spec.clMax));
  }

  liftCoefficient(alphaDeg) {
    const spec = this.spec;
    const flapBonus = this.flapAngle * spec.flapLift;
    const stall = spec.stallAlpha + this.flapAngle * 0.12;
    const clMax = spec.clMax + flapBonus * 3.0;
    if (alphaDeg <= stall) {
      return spec.cl0 + spec.clAlpha * alphaDeg + flapBonus;
    }
    const peak = Math.min(spec.cl0 + spec.clAlpha * stall + flapBonus, clMax);
    const post = clamp((alphaDeg - stall) / 14, 0, 1);
    const falling = peak * (1 - 0.58 * post);
    return Math.max(falling, 0.18 * peak);
  }

  _wind(time, level) {
    const strength = 1.6 + level.turbulence * 1.4;
    const gust = noise1(time * 0.21, 3) * strength;
    const gustZ = noise1(time * 0.17 + 12, 7) * strength * 0.6;
    return new THREE.Vector3(-2.0 + gust, 0, 0.9 + gustZ);
  }

  _thrust(speed, rho) {
    const spec = this.spec;
    const densityRatio = rho / 1.225;
    if (spec.turbo) {
      return this.throttle * spec.maxThrust * Math.pow(densityRatio, 0.4);
    }
    const available =
      (spec.powerKW * 1000 * spec.propEfficiency * densityRatio) /
      Math.max(speed, 11);
    return this.throttle * Math.min(spec.maxThrust, available);
  }

  step(dt, rawInput, controlId = 'pilot', time = 0) {
    dt = Math.min(dt, 0.05);
    const spec = this.spec;
    const level = CONTROL_LEVELS[controlId] || CONTROL_LEVELS.pilot;
    this.controlId = controlId;

    const input = {
      pitch: clamp(rawInput?.pitch ?? 0, -1, 1),
      roll: clamp(rawInput?.roll ?? 0, -1, 1),
      yaw: clamp(rawInput?.yaw ?? 0, -1, 1),
      throttle: clamp(rawInput?.throttle ?? this.throttle, 0, 1),
      brake: !!rawInput?.brake,
    };
    this.input = input;

    if (this.crashed) {
      this.velocity.multiplyScalar(Math.exp(-2.0 * dt));
      return;
    }

    this.time += dt;

    // Engine spool.
    const spool = spec.spool * (input.throttle < this.throttle ? 1.4 : 1);
    this.throttle += clamp(input.throttle - this.throttle, -spool * dt, spool * dt);
    this.afterburnerLevel = spec.afterburner ? smoothstep(0.82, 1.0, this.throttle) : 0;

    // Gear and flaps.
    const gearTarget = spec.fixedGear ? 1 : this.gearDown ? 1 : 0;
    const gearRate = dt / Math.max(spec.gearTime, 0.05);
    this.gearT += clamp(gearTarget - this.gearT, -gearRate, gearRate);
    this.flapAngle += clamp(this.flapTarget - this.flapAngle, -28 * dt, 28 * dt);

    const wind = this._wind(this.time, level);
    const rel = new THREE.Vector3().subVectors(this.velocity, wind);
    const speed = rel.length();
    const surface = this.surfaceAt(this.position.x, this.position.z);
    const clearance = this.clearance();

    if (this.onGround) {
      this._stepGround(dt, input, level, rel, speed, surface, clearance);
      this._updateTelemetry(level, surface);
      return;
    }

    // --- Airborne attitude control ---------------------------------------
    const q = this.quaternion;
    let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    let up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    let right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const invQ = q.clone().invert();
    const vBody = rel.clone().applyQuaternion(invQ);
    const airspeed = rel.length();
    const alpha = Math.atan2(-vBody.y, Math.max(vBody.z, 2));
    const beta = Math.atan2(vBody.x, Math.max(Math.abs(vBody.z), 2));
    const alphaDeg = alpha * RAD;
    this.alpha = alpha;
    this.beta = beta;

    const atm = altitudeAtmosphere(this.position.y);
    const sound = atm.soundSpeed;
    const qbar = 0.5 * atm.density * airspeed * airspeed;
    const authority = clamp(airspeed / (this.stallSpeedAt(atm.density) * 1.9), 0.22, 1.2);
    const sens = level.sensitivity;

    let pitchRate = -input.pitch * spec.rates.pitch * authority * sens;
    let rollRate = -input.roll * spec.rates.roll * authority * sens;
    let yawRate = input.yaw * spec.rates.yaw * authority * sens;

    // Stall departure.
    const stallDeg = spec.stallAlpha + this.flapAngle * 0.12;
    const stallSeverity = clamp(
      smoothstep(stallDeg * 0.96, stallDeg + 7, alphaDeg) * (1 - smoothstep(0.9, 1.4, Math.abs(beta) / 0.5) * 0.3),
      0,
      1
    );
    this.stallSeverity = stallSeverity;
    if (stallSeverity > 0.01) {
      pitchRate += stallSeverity * spec.rates.pitch * (level.stallProtection ? 0.45 : 1.25);
      rollRate +=
        Math.sin(this.time * 5.3) *
        stallSeverity *
        spec.rates.roll *
        (level.stallProtection ? 0.12 : 0.55);
      yawRate += Math.sin(this.time * 3.1) * stallSeverity * 0.25;
    }

    // Coordinated-flight assists.
    yawRate += beta * level.autoRudder * 1.8 * authority;
    yawRate += beta * 0.35 * authority;

    if (level.adverseYaw) {
      yawRate -= input.roll * spec.rates.yaw * 0.55 * authority;
    }

    // Gentle attitude stability. Cadet holds the horizon; the others only
    // get a light pitch trim so the aircraft is flyable hands-off.
    const pitchAngle = Math.asin(clamp(forward.y, -1, 1));
    if (level.autoLevel > 0.1 && Math.abs(input.pitch) < 0.08) {
      const targetPitch = clamp(-this.velocity.y * 0.012 + 0.012, -0.1, 0.12);
      pitchRate += (pitchAngle - targetPitch) * 2.2 * level.autoLevel;
    }
    if (level.autoLevel > 0.1 && Math.abs(input.roll) < 0.08) {
      rollRate += -right.y * 2.8 * level.autoLevel;
    }
    if (level.autoLevel < 0.5 && Math.abs(input.pitch) < 0.05) {
      pitchRate += (pitchAngle - 0.035) * 0.3;
    }

    // Turbulence.
    const agl = this.position.y - surface;
    const turbBase =
      level.turbulence *
      (0.25 + 0.75 * smoothstep(2600, 60, agl)) *
      clamp(airspeed / 90, 0.25, 1.4) *
      0.09;
    pitchRate += noise1(this.time * 0.85, 1) * turbBase;
    rollRate += noise1(this.time * 0.67, 2) * turbBase * 1.15;
    yawRate += noise1(this.time * 0.54, 3) * turbBase * 0.7;

    // Integrate body rates.
    const response = spec.response * (1 + (1 - authority) * 1.2);
    const k = 1 - Math.exp(-response * dt);
    this.angularVelocity.x += (pitchRate - this.angularVelocity.x) * k;
    this.angularVelocity.y += (yawRate - this.angularVelocity.y) * k;
    this.angularVelocity.z += (rollRate - this.angularVelocity.z) * k;
    this.angularVelocity.clampLength(0, 6.5);

    const w = this.angularVelocity;
    const dq = new THREE.Quaternion(w.x * 0.5 * dt, w.y * 0.5 * dt, w.z * 0.5 * dt, 1);
    q.multiply(dq).normalize();

    forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const vDir = rel.clone().normalize();

    // --- Forces -----------------------------------------------------------
    const cl = this.liftCoefficient(alphaDeg) * (1 - stallSeverity * 0.5);
    let cd =
      spec.cd0 +
      (cl * cl) / (Math.PI * spec.oswald * spec.aspect) +
      this.flapAngle * spec.flapDrag +
      this.gearT * spec.gearCd;

    if (spec.turbo) {
      cd += 0.0035 * smoothstep(0.82, 1.05, airspeed / sound);
    }

    // Keep the aircraft inside its published speed envelope. A fighter's
    // structural limit eases with altitude until Mach becomes limiting.
    let limit = spec.vne;
    if (spec.maxMach) {
      const machSpeed = spec.maxMach * sound;
      const blend = smoothstep(5000, 10500, this.position.y);
      limit = spec.vne + (machSpeed - spec.vne) * blend;
    }
    this.speedLimit = limit;
    const barrier = limit * 0.998;
    if (airspeed > barrier) {
      const over = (airspeed / barrier - 1) * 60;
      cd += over * over * 0.8;
    }

    const groundEffectFactor =
      agl < spec.wingArea ** 0.5 * 8
        ? 1 + 0.075 * (1 - clamp(agl / 45, 0, 1))
        : 1;
    const liftForce = qbar * spec.wingArea * cl * groundEffectFactor;
    const liftDir =
      vDir.lengthSq() > 0.01
        ? new THREE.Vector3().crossVectors(vDir, right).normalize()
        : up.clone();
    const dragForce = qbar * spec.wingArea * cd;

    const thrust = this._thrust(airspeed, atm.density);
    const forces = new THREE.Vector3();
    forces.addScaledVector(liftDir, liftForce);
    forces.addScaledVector(vDir, -dragForce);
    forces.addScaledVector(forward, thrust);
    forces.y -= spec.mass * G;

    this.velocity.addScaledVector(forces, dt / spec.mass);
    this.position.addScaledVector(this.velocity, dt);
    this.airborneTime += dt;
    this.wasAirborne = true;

    this.gLoad = liftForce / (spec.mass * G);
    this.mach = airspeed / sound;
    this.speed = airspeed;
    this.vs = this.velocity.y;
    this.stallWarning = alphaDeg > stallDeg * 0.9 || stallSeverity > 0.02;
    this.overspeedWarning =
      airspeed > limit * 0.985 ||
      (spec.maxMach && this.mach > spec.maxMach * 0.99) ||
      (this.gearT > 0.05 && !spec.fixedGear && airspeed > 95);

    // Terrain contact.
    const newSurface = this.surfaceAt(this.position.x, this.position.z);
    const newClearance = this.clearance();
    const contactY = newSurface + newClearance;
    if (this.position.y <= contactY) {
      this._handleContact(newSurface, newClearance, level);
    }

    this._updateTelemetry(level, newSurface);
  }

  _stepGround(dt, input, level, rel, speed, surface, clearance) {
    const spec = this.spec;
    const atm0 = altitudeAtmosphere(this.position.y);
    const q = this.quaternion;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    let yaw = Math.atan2(forward.x, forward.z);
    let groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    const steerAuthority = clamp(groundSpeed / 16, 0.18, 1.25);
    yaw += input.yaw * 0.52 * steerAuthority * dt;
    if (groundSpeed < 1.5) yaw += input.yaw * 0.25 * dt;

    // Rotation attitude scales with the airframe: the flying wing and the
    // fighter both need more nose-up than the taildragger to unstick.
    const rotatePitch = clamp(spec.stallAlpha * 0.7, 8.5, 13) * DEG;
    let targetPitch = 0.018;
    if (input.pitch > 0.08) targetPitch = rotatePitch;
    const rotateSpeed = this.stallSpeedAt(atm0.density) * 1.1;
    const autoRotate = groundSpeed > rotateSpeed && input.throttle > 0.35;
    if (autoRotate) targetPitch = Math.max(targetPitch, rotatePitch * 0.9);
    this.groundPitch += (targetPitch - this.groundPitch) * Math.min(1, dt * 2.1);
    // groundPitch is a nose-up angle; +X rotation in three tilts +Z down.
    this.quaternion.setFromEuler(new THREE.Euler(-this.groundPitch, yaw, 0, 'YXZ'));

    const flatForward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const atm = atm0;
    const thrust = this._thrust(groundSpeed, atm.density);      groundSpeed += (thrust / spec.mass) * dt;
      groundSpeed = Math.max(0, groundSpeed - (input.brake ? 4.2 : 0.1) * dt);
    groundSpeed *= Math.exp(-0.0022 * dt);
    if (input.brake && groundSpeed < 0.8) groundSpeed = 0;

    this.position.x += flatForward.x * groundSpeed * dt;
    this.position.z += flatForward.z * groundSpeed * dt;
    const newSurface = this.surfaceAt(this.position.x, this.position.z);
    this.position.y = newSurface + clearance;
    this.velocity.set(flatForward.x * groundSpeed, 0, flatForward.z * groundSpeed);
    this.speed = groundSpeed;
    this.groundSpeed = groundSpeed;
    this.vs = 0;
    this.alpha = this.groundPitch;
    this.gLoad = 1;

    // Take-off check using the actual angle of attack and lift available.
    const qbar = 0.5 * atm.density * groundSpeed * groundSpeed;
    const cl = this.liftCoefficient(this.groundPitch * RAD);
    const lift = qbar * spec.wingArea * cl;
    this.stallWarning = false;
    this.overspeedWarning = groundSpeed > spec.vne * 0.98;

    if (
      groundSpeed > this.stallSpeedAt(atm.density) * 1.05 &&
      lift >= spec.mass * G * 1.01 &&
      this.groundPitch > 0.06
    ) {
      this.onGround = false;
      this.onRunway = false;
      this.airborneTime = 0;
      // Leave the ground with the nose up but the flight path still shallow:
      // that angle of attack is what keeps the wing flying after rotation.
      this.velocity.set(flatForward.x * groundSpeed, 0, flatForward.z * groundSpeed);
      this.position.y = newSurface + clearance + 0.35;
      this.groundPitch = 0;
      this.angularVelocity.set(0, 0, 0);
    }
  }

  _handleContact(surface, clearance, level) {
    const spec = this.spec;
    const impact = Math.max(0, -this.velocity.y);
    const normal = terrainNormal(this.position.x, this.position.z);
    const bankRad = Math.abs(Math.atan2(-this._right().y, this._up().y));
    const bank = bankRad * RAD;
    const water = this.position.y <= 1.5 && terrainHeight(this.position.x, this.position.z) < 0.2;
    const gearProblem = !spec.fixedGear && !this.gearDown && impact > 1.4;

    const crashThreshold = 7.0 * level.crashForgiveness;
    if (impact > crashThreshold || bank > 42 || normal.y < 0.68 || water || gearProblem) {
      this.crash(water ? 'Ditched in the sea' : 'Impact with the terrain');
      return;
    }

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    const yaw = Math.atan2(forward.x, forward.z);
    const pitch = Math.asin(clamp(forward.y, -1, 1));
    const roll = Math.atan2(-this._right().y, this._up().y);
    this.onGround = true;
    this.onRunway = false;
    this.groundPitch = clamp(pitch, 0.005, 0.11);
    this.quaternion.setFromEuler(new THREE.Euler(-this.groundPitch, yaw, 0, 'YXZ'));
    this.angularVelocity.set(0, 0, 0);
    this.landingImpact = impact;
    let hs = Math.hypot(this.velocity.x, this.velocity.z);
    hs *= 1 - clamp(impact * 0.018 + Math.abs(roll) * 0.08, 0, 0.3);
    this.velocity.set(Math.sin(yaw) * hs, 0, Math.cos(yaw) * hs);
    this.position.y = surface + clearance;
    this.stallSeverity = 0;
  }

  _right() {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
  }

  _up() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
  }

  crash(reason) {
    this.crashed = true;
    this.crashReason = reason;
    this.onGround = true;
    this.velocity.multiplyScalar(0.04);
    this.angularVelocity.set(0, 0, 0);
    this.stallSeverity = 0;
  }

  _updateTelemetry(level, surface) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    const right = this._right();
    const up = this._up();
    const heading = (Math.atan2(forward.x, forward.z) * RAD + 360) % 360;
    const pitch = Math.asin(clamp(forward.y, -1, 1)) * RAD;
    const roll = Math.atan2(-right.y, up.y) * RAD;
    const atm = altitudeAtmosphere(this.position.y);
    const speed = this.speed;
    this.vs = this.velocity.y;
    this.telemetry = {
      speed,
      kmh: speed * 3.6,
      kts: speed * 1.94384,
      mach: speed / atm.soundSpeed,
      altitudeMSL: this.position.y,
      altitudeFT: this.position.y * 3.28084,
      agl: Math.max(0, this.position.y - surface),
      vs: this.velocity.y,
      vsFpm: this.velocity.y * 196.85,
      heading,
      pitch,
      roll,
      alphaDeg: this.alpha * RAD,
      betaDeg: this.beta * RAD,
      gLoad: this.gLoad,
      throttle: this.throttle,
      gearT: this.gearT,
      gearDown: this.gearDown,
      flaps: this.flapAngle,
      stallWarning: this.stallWarning,
      overspeedWarning: this.overspeedWarning,
      onGround: this.onGround,
      crashed: this.crashed,
      parkingAvailable: this.onGround && this.speed < 2.5 && this._nearActiveApron(),
      afterburner: this.afterburnerLevel,
      time: this.time,
      controlId: this.controlId,
      autopilot: level.autoLevel > 0.5,
    };
  }

  _nearActiveApron() {
    const u = this.position.x * Math.sin(RUNWAY_HEADING) + this.position.z * Math.cos(RUNWAY_HEADING);
    const v = -this.position.x * Math.cos(RUNWAY_HEADING) + this.position.z * Math.sin(RUNWAY_HEADING);
    // Bay 01 and the apron directly in front of it: wide enough to accept a
    // stopped aircraft anywhere on its marked stand, including inside the bay.
    return this.gearDown && Math.hypot(u - HANGAR_BAY_U, v - HANGAR_APRON_V) < 52;
  }

  getTelemetry() {
    return this.telemetry;
  }
}
