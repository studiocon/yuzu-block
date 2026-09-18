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
