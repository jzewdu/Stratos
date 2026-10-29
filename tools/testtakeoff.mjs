import { AIRCRAFT_SPECS } from '../src/aircraft/specs.js';
import { FlightPhysics } from '../src/flight/flight.js';
import { RUNWAY_LENGTH } from '../src/core/utils.js';

for (const id of ['cessna170','b2','f22']) {
  const spec=AIRCRAFT_SPECS[id];
  const fp=new FlightPhysics(spec);
  fp.reset({mode:'runway',controlId:'pilot'});
  const startX=fp.position.x;
  let liftT=null, liftX=null, liftSpeed=null, maxX=startX;
  for(let i=0;i<120*120;i++){
    const t=i/120;
    const vr=fp.stallSpeedAt()*1.15;
    const pitch = fp.onGround ? (fp.groundSpeed>vr*0.85?0.7:0) : 0.12;
    fp.step(1/120,{pitch,roll:0,yaw:0,throttle:1,brake:false},'pilot',t);
    maxX=Math.max(maxX,fp.position.x);
    if(!fp.onGround && liftT===null){liftT=t; liftX=fp.position.x; liftSpeed=fp.speed;}
    if(fp.crashed) break;
    if(t>60 && !fp.onGround) break;
  }
  console.log(`${id}: liftoff ${liftT?.toFixed(1)}s, x=${liftX?.toFixed(0)} (${(liftX-startX).toFixed(0)}m roll), speed ${(liftSpeed*3.6).toFixed(0)} km/h, `+
    `final alt ${fp.position.y.toFixed(0)} spd ${(fp.speed*3.6).toFixed(0)} crashed=${fp.crashed} ${fp.crashReason||''} runwayEnd=${RUNWAY_LENGTH/2}`);
}
