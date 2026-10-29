# Devlog: how STRATOS got here

The project in the order it actually happened, including the parts that were wrong.

---

## Phase 1 — A world and a physics loop

The first version was an experiment: could a browser render a convincing landscape and fly
an aircraft through it with real physics?

- A heightfield terrain with layered detail, generated from noise at load.
- A physically-based sky with a sun, and image-based lighting baked from it.
- Procedural asphalt, concrete, grass, gravel, markings and signs — no texture files.
- A six-degree-of-freedom flight model with a lift curve, stall, drag and ground contact.
- A canvas HUD with tapes, a ladder and warnings.
- A hangar interface, cameras, particles and synthesised audio.

It worked, and it immediately exposed the real problem: a physically-plausible flight model
inside a visually-plausible world can still *look* like a toy if the light is wrong. Every
later phase has been about closing that gap.

---

## Phase 2 — Airframes that look like aircraft

Three aircraft were built procedurally first, then replaced by detailed imported meshes with
the procedural versions kept as fallbacks and as shape references.

That phase was mostly not modelling. It was:

- fixing each model's axis convention and scale (three files, three different "forward");
- re-tuning materials, because marketplace exports arrive as chrome mirrors and an ACES
  sky punishes that immediately;
- removing nonsense — a boarding ladder parked beside a jet, decorative wheel hubs that
  read as noise;
- **building an undercarriage for the Raptor**, whose mesh is baked gear-up, including flat
  bay doors and a stance that matches the airframe;
- a two-stage afterburner with a core, a plume, nozzle glow and shock diamonds, driven by
  the same value that drives thrust;
- navigation, formation and landing lights wired to the night factor and gear state.

The lesson: an aircraft is judged by its silhouette and its landing gear. Players forgive a
low-poly panel; they do not forgive a jet that floats on its belly.

---

## Phase 3 — The light was wrong

The complaint that started this phase was blunt: *why does it look unrealistic?* The answer
was not polygon count. It was:

- no ambient occlusion, so nothing touched anything;
- shadows with too much bias, so aircraft floated;
- tone mapping that clipped the sky to white paper;
- a sun that was a bright smear rather than a light source;
- materials that had never been authored for the renderer they were in.

Fixes, in order of impact:

1. **Calibrate the sky against the tone mapper** instead of brightening it until it looked
   right. The horizon stopped clipping and the sun became a light source.
2. **Add GTAO and bloom** to the post chain, with SMAA on top.
3. **Rebuild the shadow setup**: a few centimetres of normal bias, two footprints (hangar
   and flight), and a frustum snapped to whole metres so shadows stop crawling.
4. **Re-author the materials**: procedural paint with tonal variation, panel lines as real
   grooves, grime at panel edges, matte coating for the low-observable jets.

The lesson: realism is mostly about *contact* — shadows, occlusion, and the way light wraps
a surface. Geometry is the easy part.

---

## Phase 4 — It ran like a slideshow

The push for realism made the frame expensive, and the game became unplayable on the
machine it was being developed on: integrated graphics, no discrete GPU. The fix was not
"turn the graphics down" — it was to make quality a system:

- **four complete tiers**, each a description of what a frame costs;
- **GPU detection** from the renderer string plus the number of physical pixels, producing
  both a starting tier and a *ceiling*;
- **a runtime governor** that sheds vegetation, then resolution, then a tier, and climbs
  back with hysteresis and a probe — with a hard rule that it only runs in flight;
- **a 60% resolution floor**, because a stable blurry image beats a sharp slideshow;
- cheap wins: instanced everything, baked terrain, a 30 Hz HUD.

The lesson: adaptive quality is not a settings menu. It is a control loop, and it needs
hysteresis or it will oscillate in front of the player.

---

## Phase 5 — The world was in the wrong place

The original base was a desert airfield with a Nevada skyline. It was wrong for the game:
the reference photographs that inspired the project were of **Scott AFB, Illinois** — flat
farmland, two white barrel-vault hangars, and a runway that runs 14/32.

The rebuild was a full replacement of the environment:

- farmland instead of desert: hedgerows, woodlots, field boundaries, river silt;
- a flat field cut into the terrain and blended out over 6 km;
- runway 14/32 at 3,048 m, with a parallel taxiway, a 1,050 m ramp and proper markings;
- the twin hangars, modelled from the photographs — 76 m span, 18.5 m crown, 7 m walls,
  closed facades with a real door, external ribs, signed SCOTT 1 and SCOTT 2;
- a tower, an operations building, a fuel farm, a parking lot, apron lamps and runway edge
  lights;
- ground support equipment and apron wear, because an empty ramp looks like a render.

Aircraft start **inside bay 01**, on their wheels, nose out. That single change did more for
the game's sense of place than any amount of terrain detail.

The lesson: a place is recognisable from one or two shapes. The hangars carry Scott; the
rest is support.

---

## Phase 6 — Guns

The last major system is combat, and it started with the decision to do **guns only** —
because a gun is the one weapon that cannot lie about the flight model.

- A 20 mm cannon at 3,900 rpm and 1,030 m/s, with gravity, dispersion and inherited
  shooter velocity.
- Swept-segment hit detection, because a 1 km/s round passes through a fuselage if you test
  it as a point.
- Instanced tracers with a hot core and a 12 m streak, scaled by actual speed.
- A damage model: smoke, fire, camera shake, hit markers, a killed aircraft that explodes
  and respawns.
- **An AI bandit that flies the same physics as the player**, with bank-to-turn geometry,
  energy management, G discipline and ground avoidance.
- A fighter gunsight whose pipper is the real ballistic lead point — the same solver the
  bullets use, so "put the circle on the jet" is literally true.
- A dogfight launch mode, kills and losses, and a HUD section for ammo, health and target
  tally.

The lesson: AI built on the real flight model is easier to make convincing than AI built on
tricks, because every mistake it makes is a mistake a pilot could make.

---

## Phase 7 — Proving it

Screenshots of a build are not proof. The project gained a verification layer:

- physics harnesses for top speed, take-off roll and ground handling per airframe;
- a headless browser driver that loads the real build, clicks through the interface, runs
  in-game commands, captures console errors and saves screenshots;
- a safe stop script that only terminates the server serving this project.

The lesson: if a claim about an aircraft can be tested, test it. "It feels fast" is not a
Mach number.

---

## What is true right now

The project is a playable development build with three aircraft, a real airfield, a working
flight model and a 1v1 guns engagement. It is also visibly unfinished in a few places —
lighting and exposure are still being tuned, the hangar interior blows out under bloom, and
integrated graphics need the governor to work for a living. Those are in the
[roadmap](roadmap.md) rather than hidden.
