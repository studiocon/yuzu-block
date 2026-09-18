// Colour audit. Paste into the page's console, or evaluate it through a
// browser tool, against http://localhost:3000 or the deployed page.
//
// This cannot run in node: what a viewer sees is weighted by which faces
// are turned toward the camera, not by how many blocks carry a tone, so
// the shares have to be counted off rendered pixels. The pipeline-side
// numbers are guarded by tests/aggregate-to-blocks.test.ts instead.
//
// REQUIRES `preserveDrawingBuffer: true` on the renderer in
// components/BlockScene.tsx. It is off in production, so switch it on
// for the run and switch it back before committing.
//
// Two things it reports, because either alone has misled before:
//
//  - Shares by FAMILY, not by token. Reading the last token alone once
//    said 4.2% while the three muted inks together were 13.3% of the
//    surface, which is what actually reads as grey.
//  - The SPREAD across tiles, not just the total. 5% spread evenly and
//    5% pooled in one corner are the same number and a different
//    picture entirely.
//
// Keep the hexes in step with INK_RAMP in lib/palette.ts.

(() => {
  const RAMP = {
    "#FCEE8A": "pale",
    "#F8E262": "lemon",
    "#F5D84A": "yellow",
    "#EBCB4A": "gold",
    "#E2C652": "straw",
    "#CCBB6B": "linen",
    "#BEB47D": "stone",
    "#B3AC8E": "ash",
  };
  const LIGHT = ["pale", "lemon", "yellow", "gold"];
  const MUTED = ["linen", "stone", "ash"];
  const TILES = 8;
  /** Tiles thinner than this are mostly background; their share is noise. */
  const MIN_TILE_PIXELS = 2000;

  const canvas = document.querySelector("canvas");
  const gl = canvas && canvas.getContext("webgl2");
  if (!gl) return "no webgl2 canvas on this page";

  const { width, height } = canvas;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  if (pixels.every((v) => v === 0)) {
    return "read back an empty buffer — set preserveDrawingBuffer, and front the tab (rAF is paused while it is hidden)";
  }

  const hits = Object.fromEntries(Object.values(RAMP).map((name) => [name, 0]));
  const tiles = Array.from({ length: TILES * TILES }, () => ({ ink: 0, muted: 0 }));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 250) continue;
      const hex =
        "#" +
        [pixels[i], pixels[i + 1], pixels[i + 2]]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase();
      const name = RAMP[hex];
      if (!name) continue; // stock, page, and anti-aliased edges
      hits[name]++;
      const tile = Math.floor((y * TILES) / height) * TILES + Math.floor((x * TILES) / width);
      tiles[tile].ink++;
      if (MUTED.includes(name)) tiles[tile].muted++;
    }
  }

  const total = Object.values(hits).reduce((n, v) => n + v, 0);
  if (total === 0) return "no ramp colours found — are the hexes above still in step with lib/palette.ts?";

  const pct = (n) => Number(((100 * n) / total).toFixed(1));
  const family = (names) => pct(names.reduce((n, k) => n + hits[k], 0));

  const shares = tiles
    .filter((t) => t.ink > MIN_TILE_PIXELS)
    .map((t) => (100 * t.muted) / t.ink);
  const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  const sd = Math.sqrt(shares.reduce((a, b) => a + (b - mean) ** 2, 0) / shares.length);

  return {
    byInk: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, pct(v)])),
    lightFamily: family(LIGHT),
    mutedFamily: family(MUTED),
    spread: {
      tiles: shares.length,
      min: Number(Math.min(...shares).toFixed(1)),
      max: Number(Math.max(...shares).toFixed(1)),
      // Binomial noise alone floors this near 1.5 at a ~5% share and
      // this tile size, so anything close to that is as even as it gets.
      sd: Number(sd.toFixed(2)),
    },
  };
})();
