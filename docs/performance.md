# Performance

STRATOS was developed on **integrated graphics** — an Intel Iris Xe in an 11th-gen Core
i7 — and that shaped almost every rendering decision in it. A simulator that only runs on a
discrete GPU is a simulator most people cannot run.

---

## The budget

| Target | Value |
| --- | --- |
| Frame rate | 60 fps, 16.7 ms per frame |
| Physics | Fixed 120 Hz, decoupled from rendering |
| HUD | 30 Hz canvas redraw |
| Bundle | ~1 MB of JavaScript and CSS |
| Assets | Only the three airframe meshes (~126 MB) plus the page |

The simulation itself is cheap — a few hundred floating-point operations per aircraft per
step, plus projectile integration. The cost is almost entirely in the frame: shadows,
occlusion, bloom, foliage and fill rate.

---

## Where the milliseconds go

Roughly in order of expense, on integrated graphics:

1. **Shadow map** — the whole scene is re-rendered from the sun. Size dominates.
2. **GTAO** — a second pass over the scene's depth and normals. Expensive, and the first
   thing to go.
3. **Fill rate** — the pixel ratio, bloom blurs, and the transparent cloud shell.
4. **Vegetation** — thousands of instanced trees, cheap per instance, expensive in bulk.
5. **Geometry** — the imported airframes are dense meshes; they are the exception, not the
   rule, and there are only a few of them on screen.

That ordering is why the governor sheds in the order it does: foliage first (you cannot see
the difference at 3,000 m), then internal resolution, then a whole tier.

---

## The adaptive governor

Quality is negotiated at runtime because a machine's headroom changes with what is on
screen — a hangar interior at 20 m is not the same load as 4,000 m of farmland.

| Condition | Response |
| --- | --- |
| < 54 fps | Vegetation density ×0.68, then render scale ×0.88, then drop a tier |
| < 36 fps | Drop a tier immediately — that is a slideshow, not a hitch |
| > 59 fps for four windows | Reclaim scale ×1.06, then vegetation ×1.08, then try a tier |
| Promotion then < 57 fps | Revert, and lock promotions for 45 s |

Details that matter:

- **Windows, not frames.** Frame time is averaged over roughly a second, so one long frame
  cannot trigger a change.
- **Flight only.** The hangar runs a close-up orbit with a small shadow frustum; letting it
  drive the tier used to leave flights stuck on *low*.
- **A floor.** Render scale bottoms out at 60%. Below that the tier drops, because a stable
  60 fps at 60% resolution is playable and a sharp 25 fps is not.
- **A ceiling from detection.** A known integrated GPU is never promoted past its detected
  tier. A GPU whose name the browser hides starts conservative and is allowed to climb,
  because that is the only evidence available.
- **Overrides.** A player can pin *Low/Medium/High/Ultra* in the pause menu; the setting
  persists and disables the governor.

---

## Techniques that buy the most

- **Instancing everywhere it applies** — trees, runway edge lights, tracers, markings.
  A thousand lights cost one draw call.
- **Baked, static terrain** — normals and vertex colours computed once, matrix updates
  disabled. The ground costs nothing after startup.
- **Two shadow footprints** — 95 m in the hangar, 430 m in flight, from one map.
- **Half-resolution GTAO** — ambient occlusion is low-frequency by nature; sampling it at
  full resolution is spending pixels on a blur.
- **A single material for all three terrain layers**, with the detail blended in the shader,
  so there is no LOD seam and no shader switch.
- **No texture files.** Every surface is generated on a canvas at load: no network cost and
  no decode hitch mid-flight.
- **30 Hz HUD.** The canvas overlay is a full-screen 2D redraw; halving its rate is
  invisible behind a moving 3D scene.

---

## What is still expensive

- **The airframes themselves.** The imported meshes are large; the first load is dominated
  by fetching and parsing them. This is the biggest remaining optimisation target
  (compression, LODs, or a streamed lower-detail hangar mesh).
- **GTAO on ultra** — it is beautiful under the hangars and the first thing a laptop should
  lose.
- **Bloom at high pixel ratios** — on a 4K display the blur chain is a real cost, which is
  why the 4K starting tier for a discrete GPU is *high*, not *ultra*.

---

## Measuring

Performance work here is measured, not eyeballed:

- the in-game FPS readout and the quality readout in the pause menu, which reports the
  current tier and the governor's resolution scale;
- a headless Chrome harness that loads the real build, runs for a fixed time and reports
  frame statistics alongside console errors;
- physics harnesses that assert behaviour (take-off roll, top speed) rather than timing, so
  a physics change cannot silently make the game faster by making the aircraft wrong.
