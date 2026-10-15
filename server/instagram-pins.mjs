// Instagram draws the white pin into grid thumbnails on some Android builds;
// UI Automator then exposes neither a label nor a badge node. Inspect the icon
// area of the actual screen as well as the accessibility tree.
// Shape sampled from the Android pin badge, excluding thumbnail/background art.
const PIN = [
  '............................', '.................#..........',
  '................###.........', '................####........',
  '...............######.......', '...............#######......',
  '..............#########.....', '.............###########....',
  '............#############...', '..........################..',
  '.........#################..', '....#####################...',
  '...###################......', '...##################.......',
  '...#################........', '....###############.........',
  '.....##############.........', '......############..........',
  '.......##########...........', '.......##########...........',
  '......##.########...........', '.....##...#######...........',
  '....##.....#####............', '...##.......####............',
  '..##.........##.............', '.##.........................',
  '##..........................', '............................',
];
const foreground = [], background = [];
for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
  if (PIN[y][x] === '#') foreground.push([x, y]);
  // Ignore antialiasing around the outline when testing negative space.
  else if (!PIN.slice(Math.max(0, y - 1), y + 2).some(row => row.slice(Math.max(0, x - 1), x + 2).includes('#'))) background.push([x, y]);
}

export function decodeScreen(raw) {
  if (!Buffer.isBuffer(raw) || raw.length < 16) throw new Error('Gambar layar tidak tersedia untuk memeriksa pin.');
  const width = raw.readUInt32LE(0), height = raw.readUInt32LE(4), format = raw.readUInt32LE(8);
  const offset = raw.length - width * height * 4;
  if (!width || !height || ![1, 2].includes(format) || ![12, 16].includes(offset)) throw new Error('Format gambar layar belum mendukung pemeriksaan pin.');
  return { width, height, raw, offset };
}

export function visualPinnedKeys(raw, tiles) {
  const screen = decodeScreen(raw), found = new Set();
  const scale = Math.min(screen.width, screen.height) / 1080;
  const white = (x, y) => {
    if (x < 0 || y < 0 || x >= screen.width || y >= screen.height) return false;
    const i = screen.offset + (Math.round(y) * screen.width + Math.round(x)) * 4;
    return screen.raw[i] >= 230 && screen.raw[i + 1] >= 230 && screen.raw[i + 2] >= 230;
  };
  for (const tile of tiles) {
    if (tile.pinned) { found.add(tile.key); continue; }
    const b = tile.node.bounds?.match(/\d+/g)?.map(Number);
    if (!b || !tile.complete) continue;
    const [, top, right, bottom] = b;
    // Search only the top-right badge area. The ratio and offset tolerate
    // display density changes; negative space distinguishes pins from Reels.
    outer: for (const factor of [1, .9, 1.1, .8, 1.2]) {
      const size = 56 * scale * factor;
      for (let gap = 10 * scale; gap <= 32 * scale; gap += 3 * scale) {
        for (let dy = 8 * scale; dy <= 38 * scale; dy += 3 * scale) {
          const left = right - gap - size, y0 = top + dy;
          if (left < b[0] || y0 + size >= bottom) continue;
          const sample = ([x, y]) => white(left + x * size / 28, y0 + y * size / 28);
          if (foreground.filter(sample).length / foreground.length < .91) continue;
          if (background.filter(sample).length / background.length > .3) continue;
          found.add(tile.key); break outer;
        }
      }
    }
  }
  return found;
}
