#!/usr/bin/env node
// Reports what Vercel is actually doing with a commit.
//
// The trap this exists for: GitHub returns state "pending" for a commit
// that has NO checks at all, which is indistinguishable at a glance from
// a build in progress. A dropped push and a slow build look identical
// unless you read total_count. Builds here have taken anywhere from one
// to twenty minutes, so slowness alone proves nothing.
//
//   npm run deploy:status            # HEAD
//   npm run deploy:status -- <sha>
//   npm run deploy:status -- --wait  # poll until the build settles
//
// Exit codes: 0 deployed, 1 build failed, 2 never received by Vercel
// (re-trigger; waiting will not help), 3 still building.

import { execFileSync } from "node:child_process";

const POLL_INTERVAL_MS = 15000;
const WAIT_TIMEOUT_MS = 30 * 60 * 1000;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function gh(path) {
  const out = execFileSync("gh", ["api", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

function repoSlug() {
  const url = git("remote", "get-url", "origin");
  const match = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`cannot read owner/repo from origin: ${url}`);
  return match[1];
}

function describe(slug, sha) {
  const status = gh(`repos/${slug}/commits/${sha}/status`);
  const vercel = status.statuses.find((s) => /vercel/i.test(s.context)) ?? status.statuses[0];

  if (status.total_count === 0) {
    return {
      code: 2,
      settled: true,
      line:
        "NOT RECEIVED - no checks exist on this commit. Vercel never saw the " +
        "push; GitHub reports 'pending' for any commit without checks, so this " +
        "is not a slow build. Re-trigger with: git commit --allow-empty",
    };
  }
  if (status.state === "success") {
    return { code: 0, settled: true, line: `DEPLOYED - ${vercel?.target_url ?? ""}` };
  }
  if (status.state === "failure" || status.state === "error") {
    return { code: 1, settled: true, line: `FAILED - ${vercel?.target_url ?? ""}` };
  }
  return {
    code: 3,
    settled: false,
    line: `BUILDING - ${status.total_count} check(s) registered. ${vercel?.target_url ?? ""}`,
  };
}

const args = process.argv.slice(2);
const wait = args.includes("--wait");
const sha = args.find((a) => !a.startsWith("--")) ?? git("rev-parse", "HEAD");
const slug = repoSlug();
const shortSha = sha.slice(0, 8);

let result = describe(slug, sha);
if (wait && !result.settled) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!result.settled && Date.now() < deadline) {
    console.log(`${shortSha}: ${result.line}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    result = describe(slug, sha);
  }
}

console.log(`${shortSha}: ${result.line}`);
process.exit(result.code);
