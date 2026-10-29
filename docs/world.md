# The world: Scott Air Force Base, Illinois

The simulator used to sit in the Nevada desert. It now sits where the reference photos
were taken — a flat Illinois flood plain, a 3,048 m runway, and two white barrel-vault
hangars that are the most recognisable thing on the field.

---

## Why the world was rebuilt

The first environment was a Mojave desert with an airbase in it: mesas, dry lake beds, a
distant city skyline, creosote and Joshua trees. It looked good in stills and it was wrong
for the game. Everything was far away, the ground was one colour for kilometres, and the
base itself read as a scattering of boxes on a vast apron.

Scott AFB is the opposite problem, and a much better one: the field is *flat*, the
surroundings are *agricultural*, and the hangars are objects with a shape you can
recognise from the air. Depth comes from hedgerows, woodlots and field boundaries instead
of from mountains — which is exactly what makes the aerial reference photos work.

The fiction stayed the same: real layout, real runway heading, real proportions, with
liberties taken where a photograph was not enough.

---

## The field

| Feature | Value |
| --- | --- |
| Runway | 14/32 |
| Length / width | 3,048 m × 46 m |
| Field elevation | 140 m |
| Parallel taxiway | 23 m wide, offset 120 m |
| Main ramp | ~1,050 m × 700 m of concrete |
| Hangars | Two, 76 m span × 84 m deep, 18.5 m crown |
| Hangar doors | 52 m wide × 15.5 m high |

Everything on the field is built in **airfield-local coordinates** — *u* along 14/32,
*v* to the left of the runway — and then rotated and placed once. That is why a change to
the runway heading rotates the taxiways, the markings, the hangars, the ramp, the lamps and
the parked cars together instead of leaving a field full of misaligned yellow lines.

The runway carries what a runway carries: centreline and edge paint, threshold bars and
designators at both ends, touchdown zone markings, aiming points, a full set of
piano-key markings, taxi lead-in lines, and a parallel taxiway with a real connection
geometry rather than a straight line drawn beside the runway.

---

## The hangars

The reference hangars are wide, shallow barrel vaults, not half-cylinders on the ground.
Modelling that correctly is what makes them read as Scott:

- **A 76 m span with an 18.5 m crown** — a flattened arch, with 7 m of vertical wall
  underneath it.
- **A closed front facade with a tall door opening**, not an open tube. An open-ended
  barrel looks like a black tunnel from the ramp; a facade with a lit interior behind a
  door reads as a hangar.
- **External ribs** along the arch, which is the strongest visual cue in the photographs.
- **A concrete floor** inside, with the bay marked and lit, and a warm practical light deep
  in the roof so the interior has depth when you taxi out of it.

Both bays are modelled, signed and usable. Aircraft start **inside bay 01** on the marked
stand, nose out, wheels on the floor — the view from the cockpit at a cold start is the
inside of the hangar door with the ramp beyond it.

---

## Around the field

- A control tower with a glass cab, roof antenna and a beacon that comes up at night.
- An operations building with a lit sign and window rows.
- A fuel farm of three tanks beyond the ramp.
- A parking lot with rows of cars — small, low-poly, and enormously effective at giving
  the ramp a human scale.
- Six apron light masts and the full runway edge-light set, both dark metal by day and
  warm by night.
- Ground support equipment where aircraft actually park: a tow tractor, a fuel bowser, age
  carts, a ground power unit, a boarding ladder, cones in a taxi line, chocks and tie-downs
  around the showcase aircraft.
- Apron wear: oil stains, tyre rubber at the stop points, dirt in the expansion joints.
  It is the cheapest realism in the whole project and the one players notice without being
  able to say why.

---

## The farmland

Outside the airfield the world is the Illinois flood plain:

- three nested terrain layers totalling 240 km across, sharing one material so there is no
  LOD seam;
- per-vertex colour carrying pasture, ploughed field, hedgerow and river silt;
- field boundaries drawn into the ground texture, laid out in the long rectangles of
  American farmland rather than a noise pattern;
- instanced hedgerows and woodlots — thousands of low-cost trees placed along the field
  boundaries and in blocks, with density driven by the quality tier;
- fog colour sampled from the sky so haze matches the hour.

The airfield itself is flattened into the terrain over a 3 km radius and blended back into
the farmland over 6 km, so there is no cliff where the plateau ends.

---

## Time of day

Four presets and a continuous slider, all driven by one sun/moon rig:

| Preset | Local time | What it is for |
| --- | --- | --- |
| Dawn | 06:21 | Long shadows, low contrast, cold sky |
| Day | 13:12 | The reference look — flat light, hard shadows |
| Golden hour | 16:51 | Warm rim light, the best screenshots |
| Night | 22:24 | Stars, moon, runway lights, apron lamps, lit windows |

Sun and moon swap over, exposure is compensated, the cloud deck is tinted from above and
below, stars fade in, and the environment map is re-baked as the hour changes so aircraft
metalwork reflects the sky it is actually under.

---

## What is next for the world

The field needs the things that make an airbase *read* as an airbase at ground level:
more apron clutter, a proper tower cab interior for the camera, taxi signs on the
pavement, and a departure end that looks like a departure end. Beyond that, more fields —
the world system is data-driven enough that a second base is a layout problem, not an
engine problem.
