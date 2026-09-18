# Rendering the sculpture

## Anything at the resolution limit flickers

At the framing the page uses, one cell is four or five pixels. Detail at
that pitch re-samples differently every frame of the turn, and the whole
surface scintillates. Two features were removed for this:

- Per-cell outlines (a 1px line around a 4px cell).
- The ground's weekly rings (pitch of one cell).

Quarter rings, at thirteen cells, are fine and stayed.

Before adding any new per-cell detail, work out its pitch in **pixels**
at the live framing, not in world units.

## Judge motion by measurement, not by stills

Screenshots cannot show flicker. Measure the share of pixels that change
between consecutive frames, over a fixed window, while the camera moves:

```js
// preserveDrawingBuffer: true on the renderer, temporarily.
// Grab ~12 consecutive rAF frames, readPixels a 320x320 centre window,
// count pixels differing by more than 12/255 on any channel.
```

Numbers from 2026-09-19, same motion, centre 320x320:

| build | pixels changed per frame |
|---|---|
| outlines + viewport-anchored screen | 5.71% |
| no outlines, solid-anchored screen, no weekly rings | **2.43%** |
| above, with coverage snapped to the screen's sixteenths | 3.60% |

Two traps when measuring: `preserveDrawingBuffer` is off in production
so it has to be switched on for the run, and **rAF is paused while the
browser pane is hidden** — front the tab or every frame reads identical.

## The screen is anchored to the solid, not the viewport

Anchoring the halftone to `gl_FragCoord` is truer to how ink meets paper
and a still frame is genuinely still. It was wrong here anyway: the
solid turns continuously, so every face slides across a fixed grid of
dots and the surface crawls. The reasoning that talked us into it — "the
coverage is constant per face, so the interior is static" — holds only
for a **stationary** face.

It is anchored to the faces' own plane, from world position rather than
per-face UV, at a deliberately fractional number of cells per block
(3.0) so no two cubes carry the same stamp.

## Shape a distribution by rank, not by scaling

The ink ramp wants a known share per stop. The first attempt raised
field-plus-noise to a power, on the assumption the input was roughly
flat. It is not: a smooth field summed with uniform noise piles up
around the middle, nothing reached the 0.787 the third stop needs, and
the third ink came out at **exactly 0% of rendered pixels** while the
share maths said 10%.

Ranking the columns first makes the input flat by construction, so the
gamma acts on the distribution it was designed against. Measured ink
areas afterwards: 57.7 / 34.6 / 7.7 per cent, against 52 / 38 / 10
predicted.

Measure rendered ink shares directly rather than reasoning about them —
count exact token colours in a `readPixels` histogram. Any assumption
about the shape of a generated distribution is worth one measurement
before it is worth an argument.

## Shape the ramp with stop positions, not with a gamma

Tone is a flat rank and the ink ramp's stops are unevenly spaced, so a
stop's position IS its share of the surface: the gaps either side of it
are the only places its ink can be drawn.

This replaced a gamma applied to the rank, which fought itself at both
ends. Measured, tuning gamma alone: 2.35 put the last ink at 1.9% of
rendered pixels, 1.3 at 3.8%, and the cost of 1.3 was the light family
dropping 68% to 48%. Pushing the other way to get the light family to
83% piled 42% of the whole surface onto the single palest ink. A
position moves one stop and leaves the rest alone.

Predicting a stop's share: the two gaps around it, halved and summed.
Measured shares run a little under that, because what is on screen is
weighted by which faces are visible, not by block count — so tune
against a measurement, never against the arithmetic alone.

Current measured ink areas, mock data: pale 10.6, lemon 25.8, yellow
27.5, gold 17.4, straw 5.5, linen 2.0, stone 7.1, ash 4.2.

## Measure the family, and measure the spread

Two ways a colour audit lies.

**Reading one token when the eye reads a family.** The last ink was
reported at 4.2% and called done; what actually looked grey was the
last THREE inks together, at 13.3%. Group the inks the way a viewer
groups them before counting.

**Reporting a total when the complaint is about placement.** A total of
5% spread evenly and 5% pooled in one corner are the same number and a
completely different picture. Split the canvas into tiles and report
the spread across them, not just the mean:

| | muted total | per-tile min-max | sd |
|---|---|---|---|
| field 0.50 of a block's tone | 13.3% | — | — |
| field 0.22 | 5.0% | 0 - 19.5% | 4.57 |
| field 0.08 | 4.5% | 0.2 - 9.9% | 2.42 |

Binomial noise alone puts a floor near 1.5 on that sd at this share and
tile size, so 2.42 is close to as even as it can get.

Note the trade: the smooth field across the footprint is what makes the
colour sweep, and it is also what pools it. Evenness and sweep are the
same dial turned opposite ways.

## Tried and measured worse

Snapping face coverage to the screen's sixteenths, so surviving dots
fall in a regular pattern rather than scattering. It measured 3.60%
against 2.43% and made the faces lighter and harder. Reverted.

## Framing

The fit **covers** the viewport rather than fitting inside it, and
reserves nothing for page chrome — the copy sits on top of the solid on
purpose.

A square footprint is sqrt(2) narrower face-on than corner-on, and a
cover fit has to zoom in to keep a narrower silhouette covering the
frame. Fitting the live silhouette alone therefore swings the framing by
1.41x per revolution, which crops past the point where the solid reads
as a solid — face-on became an untextured field. `dampedExtents` pulls
the live silhouette toward the worst case over the orbit; 0.65 keeps the
form at every yaw.
