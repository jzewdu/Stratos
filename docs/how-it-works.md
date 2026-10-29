# How STRATOS works

A tour of the moving parts, from the frame loop down to the modules.

---

## The shape of the project

The simulator is roughly 13,500 lines of hand-written JavaScript and CSS, split into
twenty-four modules across six areas:

| Area | Responsibility |
| --- | --- |
| `core` | Math, noise, terrain sampling, atmosphere, shared constants, quality tiers |
| `world` | Sky, terrain mesh, textures, water, buildings, vegetation, clouds |
| `aircraft` | Airframe definitions, procedural airframes, imported meshes, material work |
| `flight` | The six-degree-of-freedom flight model and ground contact |
| `game` | Input, cameras, particle effects, audio |
| `ui` | The canvas HUD and the hangar interface |
| `combat` | Gun ballistics and the AI bandit |
| root | The game object: state, wiring, render loop |

The rule that keeps it readable: **`core` depends on nothing, `flight` and `combat` depend
only on `core`, and only the top-level game object knows about all of it.** The flight model
has no idea that a renderer or a HUD exists — it consumes an input structure and produces
a state structure. That is also why the AI can fly a *real* aircraft: it feeds the same
input structure through the same physics.

---

## The loop

There are two clocks and they are not the same clock.

```
requestAnimationFrame
  └─ accumulator += real frame time
     └─ while accumulator >= 1/120 s
        ├─ read input
        ├─ step flight physics          (player)
        ├─ step bandit physics + AI     (combat, if active)
        ├─ step projectiles + hits      (combat, if active)
        ├─ step ground contact / crashes
        └─ accumulator -= 1/120 s
     ├─ update cameras, particles, sky, lights
     ├─ draw HUD (30 Hz)
     └─ render the post-processing chain
```

The simulation runs at a **fixed 120 Hz**. Rendering runs as fast as the machine allows.
A 200 ms hitch is paid for with twenty-four physics steps, not with a 200 ms physics step —
which matters enormously for a gun that fires 3,900 rounds a minute and for an AI that
must not tunnel through the ground.

Frame time is also fed into the adaptive quality governor (see below) in ~1 second windows,
so one bad frame cannot trigger a quality change.

---

## The game object

A single `Game` class owns everything and exposes a small state machine:

| State | What is happening |
| --- | --- |
| `loading` | Models and environment are being prepared |
| `menu` | Hangar interface, slow orbit around the selected aircraft |
| `flying` | Simulation and rendering at full rate |
| `paused` | Simulation frozen, pause menu live, scene still rendered |
| `crashed` | Wreck simulation, crash card |

Transitions are explicit methods (`startFlight`, `pauseFlight`, `resumeFlight`,
`returnToHangar`, `restartFlight`) rather than flags scattered through the loop, and each
one resets exactly the subsystems it owns: input capture, engine audio, combat, hit shake,
the camera rig, the quality governor's hold timer.

**Launch modes** are part of the state, not a special case:

- *Airborne* — already at altitude and cruise speed.
- *Runway* — lined up, cold, engine at idle.
- *Hangar* — parked inside bay 01, wheels on the floor, nose out.
- *Dogfight* — airborne over the farmland, no bandit closer than 2.6 km.

Choosing *Dogfight* swaps the airframe to the Raptor, because a Cessna would be a
formality.

---

## Rendering pipeline

The renderer never draws straight to the canvas. Every frame goes through a composer:

1. **Render pass** into a multisampled target.
2. **GTAO** (ground-truth ambient occlusion) at half resolution — contact shadows under
   the aircraft, the hangar ribs, the ground equipment. Only on high and ultra.
3. **Bloom** — the sun, afterburners, runway lights, apron lamps.
4. **Output pass** — tone mapping and colour space conversion.
5. **SMAA** on top, then a final **grade pass** that handles vignette, subtle chromatic
   warmth and the film-like shoulder the scene is lit for.

ACES filmic tone mapping is used throughout with a deliberately conservative exposure. That
is what keeps the sky from clipping to white and lets an afterburner plume sit two stops
above the airframe without turning the whole frame into a light bulb.

The full detail is in [rendering.md](rendering.md).

---

## The quality governor

Quality is a negotiated property of the machine, not a checkbox.

**At startup** the renderer string is read (when the browser exposes it) and matched
against GPU families — software rasterisers, discrete parts, integrated parts — combined
with the number of physical pixels on the display. That produces a starting tier and, more
importantly, a **ceiling**. A detected integrated GPU is never silently promoted to ultra;
a blocked renderer string starts conservative and is allowed to climb once it has proven
itself. A saved choice from the pause menu overrides all of it.

**During flight** a governor measures a rolling average of frames and reacts:

| Measurement | Response |
| --- | --- |
| Below 54 fps | Shed vegetation density first (barely visible at altitude), then internal render resolution, then a whole tier |
| Below 36 fps | Skip the queue — drop a tier immediately, because that is a slideshow |
| Above 59 fps for four windows | Reclaim pixel density, then vegetation, then consider the next tier |
| Promotion that then misses 57 fps | Revert the promotion and lock promotions for 45 seconds |

Two details make it behave like a person rather than a thermostat:

- **It only runs in flight.** The hangar orbits a close-up with a small shadow frustum;
  letting that decide the tier used to leave flights stuck on *low* after a slow intro.
- **It has hysteresis and a probe.** A promotion is provisional: if the next window misses,
  the old tier is restored and promotions are locked out for a while, so the player is not
  bounced between two settings every minute.

Resolution scaling bottoms out at 60% of the tier's pixel budget. Below that the tier drops
instead — a blurry but stable picture beats a sharp slideshow.

---

## Input

One input manager owns the keyboard and mouse and exposes a *state*, not events:

```
{ pitch, roll, yaw, throttleDelta, brake, firing, ... }
```

Both the player and the AI produce that same structure. The flight model cannot tell them
apart — which is the whole point: the bandit is not cheating, it is just a better pilot
than you on a bad day.

Actions (gear, flaps, camera, pause, restart) are dispatched as discrete events so that
holding a key cannot toggle a gear ten times a second.

---

## Presentation layers

**HUD** — a full-screen 2D canvas redrawn at 30 Hz. It draws speed and altitude tapes,
an attitude ladder with a flight-path marker, a heading ribbon, a status block, warnings,
and in combat a gunsight, target tally and match state. It is drawn in screen space with a
scale factor so it stays legible from a laptop panel to a 4K monitor.

**Hangar UI** — a DOM interface over the 3D showcase: airframe selection, time of day,
control level, launch mode and a live quality readout. It exists as DOM rather than canvas
because text selection, scroll and accessibility come free.

**Audio** — synthesised, not sampled: filtered noise and oscillators for the turbofan and
the piston engine, wind noise that scales with airspeed, a stall horn, and a cannon voice
built from noise chopped at the gun's cadence. Starting or stopping a flight is a fade,
not a file load.

---

## Verification

The project is checked the way a simulator should be — by flying it, headlessly:

- a **top-speed harness** that flies each airframe at several altitudes and compares
  achieved Mach against the published envelope;
- a **take-off harness** that measures runway roll and liftoff speed per airframe;
- a **ground-handling harness** for steering, braking and climb-out;
- a **browser driver** that loads the real build in headless Chrome, clicks through the UI,
  runs in-game commands, collects console errors and saves screenshots.

That last one is how screenshots in this repository were produced: the same build a player
would load, driven through its own public hooks.
