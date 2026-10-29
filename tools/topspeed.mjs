import * as THREE from 'three';
import { AIRCRAFT_SPECS } from '../src/aircraft/specs.js';
import { FlightPhysics } from '../src/flight/flight.js';
import { altitudeAtmosphere } from '../src/core/utils.js';

for (const id of ['cessna170','b2','f22']) {
  const spec=AIRCRAFT_SPECS[id];
  for (const alt of [500, 6000, 12000, 16000]) {
    const fp=new FlightPhysics(spec); fp.reset({mode:'airborne',controlId:'pilot'});
    fp.position.set(0,alt,40000); fp.onGround=false; fp.gearDown=false; fp.gearT=0;
    const heading=Math.PI/2;
    const atm=altitudeAtmosphere(alt);
    fp.quaternion.setFromEuler(new THREE.Euler(0,heading,0,'YXZ'));
    fp.velocity.set(Math.sin(heading)*spec.startSpeed,0,Math.cos(heading)*spec.startSpeed);
    fp.throttle=1; fp.angularVelocity.set(0,0,0);
    let max=0;
    for(let i=0;i<200*120;i++){
      // Level-flight measuring rig: hold altitude and a slight nose-up attitude.
      fp.step(1/120,{pitch:0,roll:0,yaw:0,throttle:1,brake:false},'pilot',i/120);
      fp.position.y=alt; fp.velocity.y=0;
      fp.quaternion.setFromEuler(new THREE.Euler(0.02,heading,0,'YXZ'));
      max=Math.max(max,fp.speed);
      if(fp.crashed) break;
    }
    console.log(`${id} ${String(alt).padStart(6)}m  speed ${(fp.speed*3.6).toFixed(0).padStart(5)} km/h  mach ${fp.mach.toFixed(2)}  max ${(max*3.6).toFixed(0)} km/h  crashed=${fp.crashed}`);
  }
}
