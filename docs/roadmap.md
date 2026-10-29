# Roadmap

What is next, roughly in the order it will happen, plus the rough edges that are already
known.

---

## Now — polish the engagement

**More bandits.** The combat layer is already a list of combatants with team filtering, per-
aircraft AI state and nearest-target HUD selection. The next step is a two- or three-ship
engagement with formation behaviour, target sharing and a simple threat priority — the first
time the player has to think about more than one nose.

**Lighting and exposure pass.** The hangar interior blows out under bloom, and the ramp
reads brighter than the sky at some hours. This is a calibration problem, not a modelling
problem: the practical lights, the exposure curve and the bloom threshold need to be tuned
together.

**The base at ground level.** Taxiway signage, more apron clutter, a departure end that
looks like a departure end, and a tower that can be seen from the ramp.

**Performance on integrated graphics.** The governor keeps the frame rate honest, but the
first load is dominated by the imported airframes. Compression, a lower-detail hangar mesh,
or streamed loading would help more than any shader tweak.

---

## Next — systems depth

**Missiles.** The honest next step after guns, and much harder: seekers with limited gimbal
and field of view, countermeasures, notching and terrain masking, and a beyond-visual-range
fight that is about geometry and timing rather than tracking.

**Damage per system.** Instead of a health bar: engines that lose thrust, wings that lose
lift, controls that stop responding, hydraulics that bleed. The flight model already takes
per-airframe parameters, so damage can be expressed as a modification of them rather than a
special case in the loop.

**Fuel and weight.** Burn fuel, get lighter, change the stall speed. It is a small change
with a large effect on how a long sortie feels.

**A cockpit you can sit in.** A modelled interior for the cockpit camera, with instruments
that respond to the actual simulation rather than a fixed image.

---

## Later — the simulator it wants to be

- **Weather**: layered wind, cloud bases, visibility, and a proper overcast that changes the
  lighting rather than just dimming it.
- **More airfields**: the world is built from airfield-local layout data, so a second base is
  a layout and a set of ground textures, not an engine change.
- **Multiplayer**: two aircraft in the same sky is the obvious endgame for a dogfight sim,
  and the combat layer's owner/team model is already shaped for it.
- **Replay and cinematics**: the camera system already has a cinema mode; a recorder would
  make it a film tool.
- **Campaign structure**: sorties, objectives, a reason to take off.

---

## Known issues

Being explicit is cheaper than being found out:

| Area | Issue |
| --- | --- |
| Lighting | Hangar interior and ramp overexpose under bloom at some hours |
| Performance | Integrated GPUs need the governor; ultra is not for laptops |
| Load | The imported airframes are ~126 MB; first load is slow on a cold cache |
| AI | Tuned for 1v1; formation and multi-bandit behaviour does not exist yet |
| Damage | A single health pool, not per-system |
| World | The airfield is convincing from the air; the ground level is thinner |
| Cockpit | No modelled interior yet — the cockpit camera flies a clean view |
| Physics | No fuel burn, no systems, no wind layers |

---

## Not planned

- Realistic ATC and radio procedures. Interesting, but a different game.
- A mission editor. The world is procedural; authoring tools would be a project of their own.
- Mobile touch controls as a first-class input. The flight model wants a keyboard or a stick.
