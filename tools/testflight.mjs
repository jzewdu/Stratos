import * as THREE from 'three';
import { AIRCRAFT_SPECS } from '../src/aircraft/specs.js';
import { FlightPhysics } from '../src/flight/flight.js';
import { altitudeAtmosphere, clamp, terrainHeight, G } from '../src/core/utils.js';

function airStart(fp, altitude, speed) {
  fp.position.set(0, altitude, 40000);
  fp.onGround = false;
  fp.crashed = false;
  fp.gearDown = !fp.spec.fixedGear ? false : true;
  fp.gearT = fp.gearDown ? 1 : 0;
  fp.flapIndex = 0;
  fp.flapAngle = 0;
  const heading = Math.PI / 2;
  const atm = altitudeAtmosphere(altitude);
  const q = 0.5 * atm.density * speed * speed;
  const cl = (fp.spec.mass * G) / (q * fp.spec.wingArea);
  const alpha = clamp((cl - fp.spec.cl0) / fp.spec.clAlpha, -2, 8);
  fp.quaternion.setFromEuler(new THREE.Euler(alpha * Math.PI / 180, heading, 0, 'YXZ'));
  fp.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
  fp.angularVelocity.set(0, 0, 0);
  fp.throttle = 1;
  fp.alpha = alpha * Math.PI / 180;
}

function run(id, altitude, seconds = 420) {
  const spec = AIRCRAFT_SPECS[id];
  const fp = new FlightPhysics(spec);
  fp.reset({ mode: 'airborne', controlId: 'pilot' });
  airStart(fp, altitude, spec.startSpeed);
  let maxSpeed = 0;
  let maxMach = 0;
  let minAlt = Infinity;
  const dt = 1 / 120;
  for (let t = 0; t < seconds; t += dt) {
    const altErr = altitude - fp.position.y;
    const pitchInput = clamp(altErr * 0.0014 - fp.velocity.y * 0.03, -0.55, 0.55);
    fp.step(dt, { pitch: pitchInput, roll: 0, yaw: 0, throttle: 1, brake: false }, 'pilot', t);
    maxSpeed = Math.max(maxSpeed, fp.speed);
    maxMach = Math.max(maxMach, fp.mach);
    minAlt = Math.min(minAlt, fp.position.y);
    if (fp.crashed) break;
  }
  const atm = altitudeAtmosphere(fp.position.y);
  console.log(
    `${id.padEnd(10)} alt ${String(altitude).padStart(6)} m | ` +
      `speed ${fp.speed.toFixed(1).padStart(6)} m/s = ${(fp.speed * 3.6).toFixed(0).padStart(5)} km/h | ` +
      `mach ${fp.mach.toFixed(2)} | max ${(maxSpeed * 3.6).toFixed(0).padStart(5)} km/h | ` +
      `alt ${fp.position.y.toFixed(0).padStart(6)} | vs ${fp.velocity.y.toFixed(2).padStart(6)} | ` +
      `alpha ${(fp.alpha * 180 / Math.PI).toFixed(1).padStart(5)}° | g ${fp.gLoad.toFixed(2)} | ` +
      `crashed=${fp.crashed}`
  );
  return { fp, maxSpeed };
}

for (const id of ['cessna170', 'b2', 'f22']) {
  for (const alt of [600, 6000, 12000, 15000]) {
    run(id, alt);
  }
}

// Stall test: full up elevator at idle from 1500 m.
console.log('\n--- stall behaviour (idle, full nose-up) ---');
for (const id of ['cessna170', 'f22']) {
  const spec = AIRCRAFT_SPECS[id];
  const fp = new FlightPhysics(spec);
  fp.reset({ mode: 'airborne', controlId: 'ace' });
  airStart(fp, 1500, Math.max(45, spec.startSpeed * 0.8));
  fp.throttle = 0;
  let minSpeed = 999;
  let maxAlpha = -999;
  let stalledAt = null;
  const dt = 1 / 120;
  for (let t = 0; t < 90; t += dt) {
    fp.step(dt, { pitch: 1, roll: 0.1, yaw: 0, throttle: 0, brake: false }, 'ace', t);
    minSpeed = Math.min(minSpeed, fp.speed);
    maxAlpha = Math.max(maxAlpha, fp.alpha * 180 / Math.PI);
    if (fp.stallSeverity > 0.25 && stalledAt === null) stalledAt = t;
    if (fp.crashed) break;
  }
  console.log(
    `${id}: stall at ${stalledAt?.toFixed(1)}s, min ${(minSpeed * 3.6).toFixed(0)} km/h, ` +
      `maxAoA ${maxAlpha.toFixed(1)}°, altitude ${fp.position.y.toFixed(0)}, crashed=${fp.crashed}`
  );
}
