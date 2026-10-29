# Credits and licences

---

## Airframe meshes

The three aircraft meshes are third-party models used under their original licences. The
rest of the simulator — world, sky, terrain, textures, flight model, combat, effects, audio,
HUD and interface — is original work for this project.

| Aircraft | Author | Licence |
| --- | --- | --- |
| **F-22 Raptor** | NLM ([sketchfab.com/NLM-Group](https://sketchfab.com/NLM-Group)) | CC BY 4.0 |
| **B-2 Spirit** | CloudHubOmniTeam ([sketchfab.com/cloudhub](https://sketchfab.com/cloudhub)) | CC BY 4.0 |
| **Cessna 182 Skylane** | VTX ([sketchfab.com/VTX_car](https://sketchfab.com/VTX_car)) | CC BY-NC-SA 4.0 |

Notes on what those licences mean here:

- **CC BY 4.0** requires attribution and allows commercial use. Attribution is given above
  and in the in-game credits.
- **CC BY-NC-SA 4.0** (the Cessna) is *non-commercial* and *share-alike*. The model may not
  be used in a commercial product, and derivative versions of the mesh must carry the same
  licence. Any commercial release of this project would need to replace that airframe or
  obtain permission.

The meshes ship with the game in `public/models/` and are loaded at runtime, with credit given
above, in this file and in the in-game credits. If you fork the project, those files keep their
own licences — they are not covered by the project licence in [../LICENSE](../LICENSE).

---

## Software

- **Three.js** — MIT. Scene graph, materials, post-processing.
- **Vite** — MIT. Development server and build.
- **Web Audio** and **Canvas 2D** — browser platform features used directly.

There is no physics engine, no game engine and no model-viewer dependency: the flight
model, ballistics, AI and environment are written for this project.

---

## Transparency and trademarks

STRATOS is an independent project. It is **not affiliated with, sponsored by, endorsed by
or connected to**:

- the United States Air Force, Air Mobility Command or Scott Air Force Base;
- Lockheed Martin, Northrop Grumman, Boeing or Textron;
- any operator of the aircraft depicted.

Aircraft names, designations and dimensions are used descriptively, for a flight simulator.
Real airfields are represented as a tribute to the places that inspire the project, not as
official simulations.

---

## Screenshots and media

All screenshots in this repository were captured from the running build. The Freebuff
watermark visible in some development captures is from the capture environment, not part of
the game.

---

## This repository

The simulator's source code, documentation and captures are released under the MIT licence
plus an attribution requirement: **reuse, fork and remix it freely, but credit the original
and link back to [github.com/jzewdu/Stratos](https://github.com/jzewdu/Stratos).** The full
text is in [../LICENSE](../LICENSE), which also covers the third-party mesh exception above.

Publishing the code does not transfer any rights to the aircraft meshes, and it does not imply
any affiliation with the organisations listed under trademarks.
