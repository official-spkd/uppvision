import { createHash } from 'node:crypto';
import { decodeScreen } from './instagram-pins.mjs';

// Accessibility descriptions often only contain a date. Keep an exact sample of
// the thumbnail too; never use an occurrence number or a grid slot as identity.
// Exact matching deliberately skips an image that Instagram has changed/reloaded.
export function thumbnailIdentities(raw, tiles) {
  const { width, height, offset } = decodeScreen(raw), identities = new Map();
  for (const tile of tiles) {
    const b = tile.node.bounds?.match(/\d+/g)?.map(Number);
    if (!tile.complete || !b) continue;
    const [left, top, right, bottom] = b, w = right - left, h = bottom - top;
    if (left < 0 || top < 0 || right > width || bottom > height || h < w * .95) continue;
    const sample = Buffer.alloc(24 * 24 * 3), colors = new Set();
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      // Ignore the badge, borders and view counters around the thumbnail edges.
      const px = Math.floor(left + w * (.2 + (x + .5) / 24 * .6));
      const py = Math.floor(top + h * (.2 + (y + .5) / 24 * .6));
      const source = offset + (py * width + px) * 4, dest = (y * 24 + x) * 3;
      raw.copy(sample, dest, source, source + 3);
      colors.add(sample.readUIntBE(dest, 3));
    }
    // A flat placeholder is not evidence of a loaded post.
    if (colors.size < 8) continue;
    identities.set(tile.key, createHash('sha256').update(sample).digest('hex'));
  }
  return identities;
}

export const gridSignature = tiles => tiles.map(t => `${t.key}:${t.desc}:${t.node.bounds}`).join('|');
export const sameLockedPost = (ref, tile, visuals, identity) => Boolean(ref.visual &&
  ref.visual === visuals.get(tile.key) && ref.identity === identity);
