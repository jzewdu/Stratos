# The flight model

The part of the project that took the longest, broke the most, and is worth the most.

---

## Not a game about flying — a simulation of it

The flight model is a six-degree-of-freedom rigid body:

- position and velocity in world space;
- attitude as a quaternion with an angular rate in body axes;
- mass, wing area and a lift curve per airframe;
- thrust from a specified engine, with spool time and (for the Raptor) afterburner;
- drag built from parasite drag, induced drag, and the incremental drag of flaps and gear;
- density altitude, so a hot day at 140 m of field elevation flies differently from a cold
  day at 10,000 m.

The airframe never "moves forward and turns". Control inputs generate moments, moments
generate rates, rates rotate the body, the body's velocity is re-expressed in the new frame,
and lift and drag fall out of the angle of attack and the dynamic pressure. Everything else
— stall, wing drop, load factor, energy bleed — is a consequence, not an animation.

---

## Lift, stall and the shape of the envelope

Each aircraft carries a lift curve: a slope, a zero-alpha offset, a stall angle and a
maximum lift coefficient. The wing produces lift in proportion to angle of attack up to the
stall angle, then **falls off sharply past it** rather than clamping. That single decision
is why the simulation feels different from an arcade model: pull hard enough at low speed
and the aircraft *departs*. You get buffet, a dropping wing, a nose-down pitch tendency and
a sink rate — and recovering means unloading, not pulling harder.

Stall speed is not a constant. It is computed from the actual air density and the current
configuration, so:
- the HUD's stall call moves with altitude and temperature;
- flaps genuinely lower the speed at which the wing stops flying;
- a heavy, high, hot departure is a real thing you have to plan for.

Load factor is tracked continuously and surfaced in the HUD and telemetry. Exceed the
airframe's limit and the wings come off — the *Cadet* and *Pilot* levels give you more
margin than *Ace* does.

---

## Thrust, and why the afterburner is not a button that goes faster

Thrust is a function of throttle, air density and speed, with an engine spool that lags the
throttle lever. Slam the throttle forward and the jet accelerates over a second or two,
not instantly. Pull it back and the deceleration arrives late.

The Raptor adds an afterburner stage on top of dry thrust, and the extra thrust comes with
a matching fuel and drag penalty. Supercruise emerges from the numbers rather than being
scripted: at altitude, military thrust is enough to hold supersonic flight, so you can
cross the sound barrier without lighting the cans — exactly the F-22's party trick.

A **published-envelope check** is part of the verification suite. The harness flies each
airframe to its limit at multiple altitudes and reports achieved Mach and true airspeed
against the published figures: 320 km/h for the Skylane, Mach 0.95 for the Spirit, Mach 2.25
for the Raptor. A structural limit that tightens with altitude stops the fighter from
exceeding its placard in a dive, because Mach becomes the limiting factor before airspeed
does.

---

## Ground handling

Ground contact is a first-class part of the model, not a clamp at `y = 0`.

- **Surfaces are typed** — runway, taxiway, apron, grass — and each has its own rolling
  resistance and braking authority. Rolling onto the grass slows you down and steers worse.
- **Rotation attitude is per airframe.** The taildragger-style Skylane, the flying wing and
  the fighter all need different nose-up attitudes to unstick, and the take-off check uses
  the *actual* angle of attack and available lift rather than a speed threshold.
- **Liftoff leaves the ground with the nose up but the flight path still shallow** — the
  angle of attack that generated the lift is what keeps the wing flying after rotation.
  Naively snapping to the flight-path vector makes every take-off feel like a catapult.
- **Steering authority** comes from the nosewheel and the rudder, blended by speed, so
  taxiing is positive at 5 knots and does not turn into a shopping trolley at 100.
- **Brakes and parking.** Stop on the marked stand inside bay 01 with the gear down and the
  game will acknowledge the park.
- **Contact is a crash, not a bounce.** Gear-up, too much sink rate, or a wingtip on the
  concrete ends the flight with a reason — and the reason is shown, because a simulator
  that only says "you crashed" teaches nothing.

---

## Three levels of assistance

The same physics serves three audiences, and the difference is *how much of the aircraft
the pilot is flying*:

| | Cadet | Pilot | Ace |
| --- | --- | --- | --- |
| Attitude stability | Holds the horizon | Light pitch trim | None |
| Rudder | Fully coordinated | Assisted | Manual, with adverse yaw |
| Stall protection | Yes, with warning | Warning only | None |
| Turbulence | Gentle | Realistic | Strong |
| G limit | 11 g | 9 g | 7.5 g |
| Crash tolerance | Forgiving | Standard | Harsh |

Cadet is not a different flight model — it is the same model with a stability augmentation
layer and a protection envelope. That keeps the feel consistent and means a player can
graduate without relearning the aircraft.

---

## What is deliberately *not* simulated yet

Honesty is part of a good devlog:

- no fuel burn or weight change in flight;
- no hydraulic or electrical systems, no engine damage model;
- no per-surface control failure;
- wind is turbulence plus a small drift, not a layered weather model;
- no ground crew, ATC or radio.

These are listed in the [roadmap](roadmap.md) because they are the difference between "a
very good flight game" and "DCS". The architecture leaves room: the flight model already
consumes a typed input structure and emits a full telemetry block, which is exactly the
interface a systems layer would need.
