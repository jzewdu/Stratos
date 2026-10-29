import { AIRCRAFT_SPECS } from '../src/aircraft/specs.js';
import { FlightPhysics } from '../src/flight/flight.js';

for (const id of ['cessna170', 'b2', 'f22']) {
  const fp = new FlightPhysics(AIRCRAFT_SPECS[id]);
  fp.reset({ mode: 'runway', controlId: 'pilot' });
  const dt = 1 / 120;
  let pitch = 0;
  console.log('---', id, 'start', fp.position.toArray().map(n=>+n.toFixed(1)));
  for (let t = 0; t < 45; t += dt) {
    const kmh = fp.speed * 3.6;
    // rotate gently past 1.1x stall speed
    const rotate = kmh > AIRCRAFT_SPECS[id].stallKmh * 1.08 ? 0.35 : 0;
    fp.step(dt, { pitch: rotate, roll: 0, yaw: 0, throttle: 1, brake: false }, 'pilot', t);
    if (Math.abs(t % 5) < dt) {
      console.log(`t=${t.toFixed(0)}s kmh=${kmh.toFixed(0)} y=${fp.position.y.toFixed(1)} vs=${fp.velocity.y.toFixed(1)} og=${fp.onGround} thr=${fp.throttle.toFixed(2)} crashed=${fp.crashed} reason=${fp.crashReason||''}`);
    }
    if (fp.crashed) break;
  }
  console.log('end', { kmh: +(fp.speed*3.6).toFixed(0), y: +fp.position.y.toFixed(1), crashed: fp.crashed });
}
