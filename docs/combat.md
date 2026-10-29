# Combat

Guns only, for now — and deliberately so. A gun is the honest test of a flight model: no
lock tone, no missile that forgives a bad turn, just two aircraft, six hundred rounds and
whichever pilot runs out of energy first.

---

## The gun

The Raptor carries a 20 mm rotary cannon, and the simulator uses the real numbers:

| | Value |
| --- | --- |
| Calibre | 20 mm |
| Rate of fire | 3,900 rounds per minute |
| Muzzle velocity | 1,030 m/s |
| Magazine | 480 rounds |
| Effective range | ~3.2 km |
| Dispersion | Small, fixed cone plus a per-shooter error |

Rounds are fired at the **fixed simulation rate**, not per frame — 3,900 rpm is 65 rounds a
second, which a frame-rate-driven loop would never get right. If a frame is slow the gun
fires as many rounds as the elapsed time owes, bounded by the magazine.

Each round:

- leaves the muzzle at the barrel's position, not the aircraft's origin, so a wing-root gun
  shoots from the wing root;
- **inherits the shooter's velocity** and adds the muzzle velocity — which is why a shot
  from a 250 m/s jet does not behave like a shot from a standing one;
- has a small random dispersion and a tiny muzzle jump;
- is subject to **gravity** for its whole flight (9.81 m/s², like everything else);
- lives for a few seconds and is then removed, so a stray round does not fall forever.

### Tracers

The rounds are drawn as an instanced mesh, not as individual objects: one draw call for a
bright orange body and one for a white-hot core. Each tracer is a **12 m streak** aligned to
its own velocity with an 8 m core inside it — at 1,030 m/s a dot would be invisible, and
a uniformly-scaled cylinder reads as a row of identical sticks. The streak scales with the
round's actual speed, so the stream snaps and frays exactly like tracer does.

### Hit detection

Every step, each round is tested as a **swept segment** — from its last position to its
current one — against a sphere around each hostile aircraft. That matters: at 1 km/s a
round travels 8 m per simulation step, so a point test would pass straight through a
fuselage. The segment/sphere test catches it, reports the closest point as the impact
location, and spawns sparks there.

Rounds that hit terrain, leave the arena, or exceed their range are removed. Friendly fire
is filtered by team, not by name, which is the first brick of a multi-aircraft engagement.

---

## Damage

Each aircraft has 100 health. A round that connects does 4.4 damage from the player and
2.55 from a bandit, so roughly twenty hits ends a fight — long enough to reward a burst,
short enough that a good pass is decisive.

Damage is not just a number:

- **Below 56 health** the aircraft trails smoke, thickening as it gets worse.
- **Below 26 health** it intermittently catches fire — orange flashes riding the smoke.
- A hit shakes the camera and flashes the HUD; hits you land produce a hit marker.
- When health reaches zero the aircraft explodes, disappears, and the engagement resolves.

Damage accumulates on the *bandit* rather than instantly killing it, which is what makes
long tracking shots feel earned. A wing that is streaming smoke is still a wing that can
turn, and an AI with 20 health left is at its most dangerous.

---

## The bandit

The opponent is an F-22 flown by an **autopilot that only moves the stick and throttle**.

That sentence is the design. There is no spline, no scripted turn, no cheat: the bandit is
a full flight-model airframe with mass, thrust, lift, a stall, a G limit and an afterburner.
The controller sees the same telemetry a player would and produces a pitch/roll/yaw/throttle
input — the identical input structure the human's keyboard produces. If the AI pulls too
hard, it stalls. If it ignores its airspeed, it runs out of energy and dies.

The controller is built around a few ideas:

- **Bank to turn.** A fighter turns by rolling its lift vector, not by yawing its nose. The
  AI computes the heading error to the intercept, rolls to put the target in its turn
  plane, then pulls. A target behind the wing is handled by holding a hard bank and pulling
  through, which is what a pilot does — pointing the nose at a target on the six just makes
  the aircraft fly away from it.
- **Energy first.** Below a threshold airspeed it unloads, rolls out and rebuilds energy
  instead of holding a high-G pull into a stall — the mistake that kills new players.
- **G discipline.** Above its structural limit it stops pulling. It is not immune to
  over-G, it is trained not to do it.
- **Ground avoidance is not optional.** Inside a 500 m floor, pitch wins over tracking, and
  below 240 m it rolls wings level and climbs out. An AI that can pull is an AI that will
  fly into a field.
- **Burst discipline.** It fires in bursts of a few tenths of a second, only inside a
  narrow aim cone and inside 1.3 km, with a wider dispersion than the player. It misses
  because it is a bad shot, not because it is forbidden from hitting.
- **Skill variation.** Each spawn rolls a skill factor, so successive bandits are not
  identical.

### Spawns

The first bandit appears **head-on, 2.6 km ahead** and slightly low, so the fight starts
with both aircraft in sight rather than with a blind turn. Respawns appear ahead and to one
side, well above the floor, so you are never shot from behind by an aircraft that
materialised on your six. After a kill the next contact arrives in about eight seconds.

---

## The gunsight

The HUD does not draw a crosshair at the nose. It draws the **actual ballistic solution**:

- the pipper is the lead point the gun's own predictor computes — relative motion plus
  gravity drop, iterated until the time of flight is consistent — projected into screen
  space;
- the target box is projected from the real aircraft, sized by range, labelled with name,
  range, closure and a health bar;
- an off-screen arrow points to the target when it leaves the frame;
- the pipper turns green when the solution is inside the gun's cone and range.

Because the pipper and the bullets use the same solver, "put the green circle on the jet
and squeeze" is literally true. That is the difference between a game that draws a
crosshair and a simulator that hands you a fire-control system.

---

## Match flow

A dogfight is a *launch mode*, not a separate screen:

1. Choose **Dogfight** in the hangar (the airframe switches to the Raptor).
2. You start airborne over the Illinois farmland at a fighting altitude.
3. One bandit, guns only, 480 rounds each.
4. Kills and losses are tracked; the bandit respawns after each kill.
5. Being shot down ends the flight with a reason on the crash card.

---

## Built for more than one

The engagement is already a **list of combatants**, not a scripted rival:

- spawn, respawn, damage, smoke and kill logic all take a bandit argument, not a global;
- projectiles carry an owner and a team, and hit resolution filters by team;
- the HUD picks the nearest live target and represents a "no target" state;
- the AI controller is stateless per aircraft, so several can fly at once.

Adding a second, third or sixth bandit is a spawn loop and a little formation logic, not a
rewrite. That is the next combat milestone.

## After guns

The roadmap in [roadmap.md](roadmap.md) puts missiles next — which is a much bigger design
problem than a gun, because a missile forces you to model seekers, countermeasures,
notching and the whole geometry of a beyond-visual-range fight. A gun is a good place to
start because it cannot lie to you about the flight model.
