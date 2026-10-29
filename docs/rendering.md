# Rendering

How the scene is lit, drawn, and kept inside a frame budget on hardware that was not
promised to us.

---

## The frame

```
render pass  →  GTAO  →  bloom  →  output (tone map)  →  SMAA  →  colour grade
```

- **Render pass** — the whole scene into a multisampled colour target. The canvas itself
  is not multisampled: the composer owns antialiasing, so a default MSAA back buffer would
  cost memory and fill rate to be immediately thrown away.
- **GTAO** — ground-truth ambient occlusion, evaluated at half resolution (it is a soft,
  low-frequency signal). This is what puts a dark seam under the aircraft on the ramp and
  gives the hangar ribs their weight. High and Ultra only.
- **Bloom** — physical-ish bloom for the sun disc, afterburners, runway edge lights and
  apron lamps. It is the difference between "bright object" and "light source".
- **Output pass** — ACES filmic tone mapping and sRGB conversion, in the right order, once.
- **SMAA** — morphological antialiasing on the final image, because MSAA alone cannot fix
  a high-contrast wire or a distant runway edge.
- **Grade pass** — vignette, a subtle warm/cool split, and the mild shoulder that makes a
  flat Illinois sky read as atmosphere rather than as a gradient.

Tone mapping is ACES with a deliberately conservative exposure. It has to cover a scene
with a 20,000-lumen sun, a white concrete apron and a black hangar interior in the same
frame without clipping the horizon to paper white.

---

## Sky, sun and image-based lighting

The sky is a physically-based scattering dome, scaled to 200 km and rendered behind
everything. On top of it:

- **an equirectangular cloud shell** between the dome and the world, drifting slowly east
  so the sky is never a static backdrop;
- **2,600 stars** with per-star colour, fading in as the sun sets;
- **a moon** with its own light contribution;
- **a sun halo** layered under the hard disc the shader already draws, so the sun blooms
  naturally instead of looking like a decal;
- **fog colour** sampled from the sky near the horizon, so haze matches the light.

The sky is not just a picture. It is also the **environment map**: the scene is re-baked
through a PMREM generator as the sun moves, so metal on the Raptor reflects the actual
sky of the actual hour. Bakes are rate-limited — the time slider stays responsive because
the bake is scheduled, not synchronous with every slider pixel.

Four presets (Dawn 06:21, Day 13:12, Golden 16:51, Night 22:24) plus a continuous slider.
Sun and moon lights swap over, exposure is compensated, stars and lit windows come up, and
the cloud deck is tinted warm on top and dark underneath at golden hour.

---

## Shadows

A single directional shadow map, but a carefully managed one:

- **Soft PCF** — the kernel radius scales with the quality tier, giving the low sun a
  penumbra instead of a stencil.
- **Two footprints** — a tight 95 m box in the hangar (where the aircraft is a metre from
  the camera) and a 430 m box in flight. The same map does double duty at the resolution
  that actually matters.
- **The frustum snaps to whole metres.** Without that, the shadow texel grid crawls across
  the ground as the aircraft moves and every static shadow shimmers. This is the single
  cheapest fix with the largest visual payoff in the whole renderer.
- **A few centimetres of normal bias**, not two metres. Large bias detaches shadows from
  their casters; the correct amount is "just enough".
- Maps run from 1024 to 4096 depending on tier, clamped to the GPU's maximum texture size.

---

## Terrain

Three nested heightfield layers, each with a hole cut for the layer above it:

| Layer | Extent | Grid | Resolution |
| --- | --- | --- | --- |
| Near | ±7 km | 560 × 560 | ~25 m |
| Mid | ±45 km | 480 × 480 | ~190 m |
| Far | ±120 km | 360 × 360 | ~670 m |

One material for all three, so there is no LOD seam to hide: the shader blends two ground
textures (a fine grain and a field pattern) by altitude and slope, while per-vertex colour
carries the large-scale story — pasture, ploughed field, hedgerow, gravel, river silt.
Illinois is *flat*, and the terrain is built to look flat and agricultural, with the
airfield flattened into it over a 3 km radius and blended out by 6 km.

Normals are computed once at build, colours are baked into the vertex buffer at build, and
the mesh's matrix updates are disabled. The terrain never costs anything after startup.

---

## Materials and textures

There are **no texture files**. Asphalt, concrete, grass, gravel, runway paint, hangar
skin, signs, cloud sheets and star maps are all drawn into canvases at load, with noise and
grain layered in. That keeps the download small, the look consistent, and the whole
environment tweakable in code.

Aircraft are the exception: they are real meshes (see [aircraft.md](aircraft.md)), and their
imported materials are re-tuned on load — Sketchfab exports typically arrive with
metalness at 1.0, which under an ACES sky turns an airframe into a dark mirror. Restoring
plausible roughness and metalness per material group is the difference between "a model"
and "an aircraft".

---

## Quality tiers

| Setting | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Pixel ratio cap | 1.0 | 1.25 | 1.5 | 2.0 |
| MSAA | — | — | — | 4× |
| GTAO | off | off | half-res, 8 samples | half-res, 12 samples |
| Bloom | off | on | on | on |
| SMAA | off | on | on | on |
| Shadow map | 1024 | 1536 | 2048 | 4096 |
| Shadow radius | 1.4 | 1.7 | 2.0 | 2.2 |
| Vegetation | 30% | 65% | 72% | 100% |
| Base render scale | 1.0 | 0.9 | 1.0 | 1.0 |

Medium is the integrated-graphics target: bloom and SMAA are kept (they carry most of the
perceived quality) while GTAO and the big shadow map are traded away. Ultra is what a
discrete GPU gets when it has headroom.

On top of the tier, the runtime governor moves a **resolution scale** between 0.6 and 1.0
and a **foliage scale** multiplicatively — see [performance.md](performance.md).

---

## What was hard

Three problems ate most of the rendering time, and each one is worth recording:

1. **The horizon clipped.** The sky shader and the lit landscape were authored for
   different exposures. Fixing it meant calibrating sky radiance against the tone mapper
   rather than brightening the sky until it looked right — which is why the sun is now a
   proper light source instead of a white smear.
2. **Shadows crawled.** Every static shadow in the hangar shimmered at speed. Snapping the
   light's frustum to whole metres solved it completely, at no cost.
3. **The aircraft looked like chrome.** Imported materials wanted to be mirrors. Rebuilding
   them with sane roughness per surface group, plus a low-observable matte finish for the
   Raptor's coating, turned the model into an airframe.
