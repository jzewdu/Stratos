# Aircraft

Three airframes, one flight model, and a lot of work spent making imported meshes look
like they were built for the simulator.

---

## The fleet

| | Cessna 182T Skylane | B-2A Spirit | F-22A Raptor |
| --- | --- | --- | --- |
| Role | Tourer | Stealth bomber | Air-superiority fighter |
| Power | 230 hp piston | 4 × turbofan | 2 × afterburning turbofan |
| Top speed | 320 km/h | Mach 0.95 | Mach 2.25 |
| Stall | 91 km/h | 248 km/h | 250 km/h |
| Ceiling | 5,500 m | 15,200 m | 19,800 m |
| Gear | Fixed | Retractable | Retractable |
| Character | Honest, slow, rewarding | Enormous inertia | Energy fighter, 9 g |

The specs are the published ones, and the simulation is expected to meet them. A harness
flies each airframe at several altitudes and compares achieved Mach and true airspeed
against those numbers, which is how "the F-22 does Mach 2.25" stays a property of the
aerodynamics rather than a line in a table.

---

## Two ways to have an aircraft

Each airframe exists twice:

1. **A detailed imported mesh** — a GLB with a proper fuselage, panels, cockpit and gear
   bays. This is what the player sees.
2. **A procedural airframe built in code** — every surface generated from primitives and
   procedural textures, used as the fallback and as the shape reference.

The procedural version is not wasted work. It defines the gear positions, the wheel stance,
the light positions and the part naming that the imported mesh has to match, and it means
the simulator still runs if a model fails to load instead of presenting an empty hangar.

---

## Preparing an imported airframe

A model straight out of a marketplace is not a flight simulator aircraft. The preparation
pass does roughly this, per airframe:

- **Re-axis and scale.** Each source file has its own idea of forward — one is nose-down
  minus Z, one is span-along-Z, one is already nose-forward. Each gets its own transform
  and a scale that matches the real aircraft's length.
- **Re-material.** Sketchfab exports commonly arrive with metalness at 1.0 and a roughness
  map, which under an ACES sky turns the airframe into a dark mirror. Materials are
  re-tuned by surface group: matte low-observable coating for the Raptor, painted skin
  with clearcoat for the Skylane, a dark, slightly rough RAM coat for the Spirit.
- **Strip what does not belong.** The Raptor model ships with a boarding ladder parked
  beside the jet, and with small high-contrast wheel-side decoration that reads as noise at
  sim scale. Both are removed.
- **Shadow flags.** Every mesh casts and receives, or the aircraft floats.
- **Lights.** Navigation lights, a landing light and a formation strip are added where the
  real aircraft has them, and wired to the night factor and the gear state.

---

## Undercarriage

The Raptor mesh is baked **gear-up**: there is no gear to lower. Rather than accept a jet
that lands on its belly, a complete undercarriage is built to match the airframe —

- two main legs with a clean oleo and a plain tyre, sized to the stance;
- one nose leg;
- flat, restrained bay doors tucked against the airframe.

The wheels were deliberately simplified. An earlier pass gave them layered hubs and
decorative detail that looked like ornaments at a metre away and like noise from the
cockpit. A tire should read as a black disc from the side and a wheel should read as a
wheel; anything more is a distraction that costs frames.

Gear retraction is a timed animation driven by the flight state, not a visibility toggle,
and the well geometry is hidden or shown to match. The same applies to the Spirit, whose
source model conveniently includes both gear poses as named nodes.

---

## Afterburner

A plume that is a cone is a lie. The Raptor's two-stage afterburner is built from several
layers that behave differently as thrust increases:

- a **broad orange outer plume** that grows with afterburner level;
- a **white-hot inner core** that is shorter and much brighter;
- **additive glow disks** at each nozzle, which is what actually reads as "lit" at
  distance;
- **shock diamonds** — evenly spaced bright rings inside the near plume, the detail that
  turns a flame into an afterburner;
- a subtle **heat shimmer** from the effect system at high power.

The layers are driven by the same afterburner level that drives thrust, so the plume talks
to the flight model: light the cans and the flame front moves out and the diamonds stretch;
come out of burner and it collapses to a short blue-white core. At night, the bloom pass
does the rest.

---

## Finishes

All aircraft paint is procedural: a base tone with tonal blotches as if panels were painted
on different days, a fine grain so large flat areas are never perfectly smooth, panel lines
built as a shallow groove (a dark line in albedo and an offset highlight/shadow pair in the
normal map), access panels with fastener rings, grime collected at panel edges, and
stencils and national insignia where the real aircraft carries them.

The Raptor wears its low-observable grey with a matte finish; the Spirit is near-black and
almost perfectly flat, because a stealth bomber that glints is a stealth bomber that does
not exist; the Skylane carries Civil Air Patrol colours, cream with red trim.

---

## What is next

- Per-aircraft cockpit interiors for the cockpit camera (the Raptor currently flies on a
  clean HUD view).
- Damage visuals that match the combat model — missing panels, hydraulic mist, engine fire.
- More airframes, which is now mostly a data problem: a spec, an imported mesh, a gear
  stance and a material pass.
