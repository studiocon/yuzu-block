# Tests

## Do not put an assertion inside the innermost loop

A frustum-containment test asserted on every block corner at every
sampled orientation: about 250,000 `expect()` calls, 2.9s on an idle
machine. Under load it pushed a sibling test past vitest's 5s default
and the suite failed for no real reason.

Accumulate the worst violation and assert **once**. Same coverage, 80ms.

## Machine load will lie to you

On 2026-09-19 a background `npm run check` took 3237 seconds and failed
two tests that pass in 1.5s; the cause was an unrelated VM holding the
CPU at 88% (load average 143). Before believing a timeout-shaped
failure, check `uptime` and re-run in the foreground.

## What is testable here

three-dependent code is not, in a node-env suite. Keep the maths in
`lib/` with no three import — `ortho-fit`, `carve-schedule` — and keep
`components/` thin enough that the untested part is only plumbing.

Where a GLSL constant mirrors a TypeScript one, generate the GLSL from
the TypeScript at module load so the tests cover the table the shader
actually runs on.
