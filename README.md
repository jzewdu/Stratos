# STRATOS — Browser Flight Simulator

A real-time flight simulator built with Three.js and Vite. The airframes are imported
Sketchfab models (see Credits); the terrain, textures, clouds, trees, buildings, Nellis
AFB and the surrounding Mojave are generated in code at load time.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle into dist/
```

## Stop

- **Stop the local server:** double-click `stop-sim.cmd`, or run `npm run stop`.
  It only terminates the Vite process serving this project (checked by port and command
  line), so unrelated Node apps are left alone.
- **End a flight in the game:** `Esc` pauses; **HANGAR** ends the flight and shuts down the
  engine audio. Closing the browser tab stops the simulation itself.

## Aircraft

| Airframe | Top speed (published) | Notes |
| --- | --- | --- |
| Cessna 182T Skylane | 320 km/h | 230 hp piston tourer, CAP livery, fixed gear, flaps |
| B-2A Spirit | Mach 0.95 / 1,010 km/h | flying wing, retractable gear, speedbrake-style flaps |
| F-22A Raptor | Mach 2.25 / 2,414 km/h | afterburner, thrust-vectoring feel, supercruise |

Speeds are enforced by the aerodynamics: `tools/topspeed.mjs` flies each aircraft at
several altitudes and prints the achieved Mach/true airspeed against the published limits.

## Controls

| Input | Action |
| --- | --- |
| W / S | Pitch (W = nose up) |
| A / D | Roll |
| Q / E | Rudder |
| Shift / Ctrl | Throttle up / down |
| Space | Wheel brakes |
| G | Landing gear |
| F | Flaps |
| L | Landing light |
| C | Cycle camera (chase, wing, cockpit, fly-by) |
| T | Cycle time of day |
| M | Sound on/off |
| H | Flight manual |
| Esc | Pause |
| R | Restart |

On the runway: hold **Shift** for full power, keep straight with the rudder and ease the
nose up at rotation speed (the HUD call comes from the aircraft's stall speed).

## Flight model

* Six-degree-of-freedom rigid body with quaternion attitude.
* Lift/drag from a lift curve with stall break and post-stall falloff, altitude density,
  induced drag, flap and gear drag, ground effect.
* Three control levels — **Cadet** (auto-level, stall protection, forgiveness), **Pilot**
  (realistic, light trim) and **Ace** (manual, adverse yaw, no protection).
* Ground handling: rolling friction, braking, steering authority, taildragger rotation,
  takeoff/landing contact model with crash thresholds.

## World

* Nellis AFB, Nevada: 03L/21R and 03R/21L runways, taxiways, sun shelters with parked
  Raptors, hangars, ops building, control tower, fire station, fuel farm and solar field.
* The surrounding Mojave: 140 km multi-resolution heightfield with hypsometric colouring,
  dry lakebeds, mesas and mountain ranges, plus a distant Las Vegas skyline that lights up
  at night.
* 6k+ instanced creosote, yucca and Joshua trees; runway/taxiway edge lights, flood masts
  and base street lighting.
* Preetham sky with sun, moon, stars, volumetric-feeling cloud billboards, day/night
  presets and a live time slider. Sky radiance is calibrated so the horizon does not clip
  and image-based lighting is re-baked as the sun moves.

## Credits

Aircraft models are from Sketchfab and remain under their original licences:

* **F-22 Raptor FREE** — NLM (https://sketchfab.com/NLM-Group), CC-BY-4.0.
* **B2** — CloudHubOmniTeam (https://sketchfab.com/cloudhub), CC-BY-4.0.
* **Cessna 182 Skylane** — VTX (https://sketchfab.com/VTX_car), CC-BY-NC-SA-4.0
  (non-commercial, share-alike).

Everything else — terrain, sky, textures, buildings and effects — is original code.

## Project layout

```
src/core/utils.js        noise, terrain height/normal, atmosphere
src/world/               sky, terrain, water, scenery, procedural textures
src/aircraft/            shared part builders, three airframes, specs
src/flight/flight.js     flight dynamics and ground handling
src/game/                input, cameras, particles, audio
src/ui/                  HUD canvas and hangar UI
src/main.js              game orchestration and render loop
tools/                   headless verification scripts (physics + screenshots)
```

## Verification

```bash
node tools/topspeed.mjs      # published top speeds
node tools/testtakeoff.mjs   # runway roll and liftoff per airframe
node tools/rolltest.mjs      # ground handling and climb-out
node tools/shoot.mjs out.png "window.game.startFlight()" 6000 1440 860
```

`tools/shoot.mjs` drives the running dev server in headless Chrome over CDP, so it can
click/execute in-game actions, collect console errors and save screenshots.
