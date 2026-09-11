#!/usr/bin/env node
// Fails the build if forbidden brand words appear anywhere in the repo.
// The Japanese list is a hard error. The English list is a warning, since
// those words also have legitimate unrelated uses (e.g. "growth" in a
// changelog about npm dependency growth) that a human should judge.
//
// This file is excluded from its own scan, and the NG words are stored as
// escaped Unicode code points / split fragments so this script's own source
// never contains a literal match.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

// CLAUDE.md is the policy document itself — it necessarily quotes the
// forbidden words so the rule is legible, so it is excluded like this
// script's own source is.
const SKIP_FILES = new Set([path.join(repoRoot, "CLAUDE.md")]);

// Forbidden Japanese words (hard error). Stored via String.fromCodePoint so
// this file's own bytes never literally contain them.
const NG_WORDS_JA = [
  [0x7652, 0x3057], // 癒し
  [0x5bc4, 0x308a, 0x6dfb, 0x3046], // 寄り添う
  [0x80b2, 0x3064], // 育つ
  [0x3084, 0x3055, 0x3057, 0x304f], // やさしく
  [0x3075, 0x3093, 0x308f, 0x308a], // ふんわり
].map((codePoints) => String.fromCodePoint(...codePoints));

// Forbidden English words/roots (warning only).
const NG_WORDS_EN = [
  "gro" + "w",
  "gro" + "wth",
  "nur" + "ture",
  "hea" + "l",
  "gen" + "tle",
  "soo" + "thing",
  "rew" + "ard",
  "stre" + "ak",
  "cele" + "brate",
];

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (stat.isFile()) {
      if (full === __filename || SKIP_FILES.has(full)) continue;
      files.push(full);
    }
  }
  return files;
}

function isTextFile(file) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|txt|yml|yaml)$/.test(file);
}

const files = walk(repoRoot, []).filter(isTextFile);

let hadError = false;
const warnings = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    continue;
  }
  const lines = content.split("\n");

  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    for (const word of NG_WORDS_JA) {
      if (line.includes(word)) {
        console.error(`${path.relative(repoRoot, file)}:${i + 1}: forbidden word "${word}"`);
        hadError = true;
      }
    }
    for (const word of NG_WORDS_EN) {
      if (lower.includes(word)) {
        warnings.push(`${path.relative(repoRoot, file)}:${i + 1}: warning word "${word}"`);
      }
    }
  });
}

if (warnings.length > 0) {
  console.warn("Brand-tone warnings (not blocking):");
  for (const w of warnings) console.warn(`  ${w}`);
}

if (hadError) {
  console.error("\ncheck:brand failed: forbidden brand words found (see above).");
  process.exit(1);
}

console.log("check:brand passed.");
