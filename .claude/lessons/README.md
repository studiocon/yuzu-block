# lessons

Findings from earlier sessions that would otherwise be paid for twice.

Read this directory before starting work. It is short on purpose.

## What belongs here

A lesson earns a file when it is **non-obvious, load-bearing, and not
already enforced by the code**. Anything enforceable should be a check,
a test or a script instead — prose is the fallback, not the default.

- Yes: a trap in a dependency, a measurement that overturned an
  assumption, an approach that was tried and measured worse.
- No: how the code works (read the code), what a commit did (read the
  log), anything `npm run check` already catches.

## How to write one

One file per topic, kebab-case. State the trap first and the reasoning
second, so a reader who only skims the first line still avoids it. Record
what was **measured**, with the numbers — a lesson without evidence is an
opinion, and the next session cannot tell whether it still holds.

Record failures too. "This was tried and made it worse, here is the
number" saves the same afternoon twice.

Prune anything the code has since made untrue.
