# Shaders in this project

All verified against `node_modules/three/src`, three 0.186.

## A failed shader compile does not throw

three logs `getProgramInfoLog` and skips the draw. The `try/catch` around
the renderer will **not** catch it, so the symptom is a blank canvas with
no exception. After any shader edit, read the browser console.

## Reserved words that bite

`flat` is an interpolation qualifier in GLSL ES 3.00, so `bool flat = …`
is a syntax error. Cost one blank-canvas cycle.

## What three gives a ShaderMaterial for free

- `#version 300 es`. `fwidth`/`dFdx` are core — no extension directive.
- `precision highp int;`, so `uint` attributes are fine.
- `instanceColor` under `USE_INSTANCING_COLOR`, which `WebGLPrograms`
  keys off the **object**, not the material — but at program-compile
  time, so `setColorAt` must run before the first render.
- `linearToOutputTexel`, but you must call it: end the fragment shader
  with `#include <colorspace_fragment>`. Forgetting it ships everything
  visibly dark.

Prefer a plain `ShaderMaterial` over `MeshBasicMaterial` +
`onBeforeCompile`: the latter is string surgery against chunk layout
that shifts between three releases.

## Colour

Every pixel lands on a palette token by hard threshold, never `mix`, so
no in-between colour is produced. Anti-aliased line edges are the one
exception. Measured on the print material: 84.9% of opaque pixels
exactly on a token, the rest AA fringes, each under 0.6%.
