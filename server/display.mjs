import { adb } from './adb.mjs';

// Virtual displays may precede the real phone screen in dumpsys.
export function parseDisplay(output) {
  const block = output.split(/(?=^\s*Display: mDisplayId=)/m).find(part => /^\s*Display: mDisplayId=0(?:\s|$)/m.test(part));
  const size = block?.match(/\bcur=(\d+)x(\d+)/);
  const rotation = block?.match(/^\s*mRotation=(?:ROTATION_)?(\d+)\b/m);
  if (!size || !rotation || !Number(size[1]) || !Number(size[2])) throw new Error('Orientasi layar utama belum terbaca.');
  const value = Number(rotation[1]);
  const quarter = value > 3 ? value / 90 : value;
  if (![0, 1, 2, 3].includes(quarter)) throw new Error('Rotasi layar tidak dikenali.');
  return { width: Number(size[1]), height: Number(size[2]), rotation: quarter };
}

export async function getDisplay(serial, run = adb) {
  return parseDisplay(await run(['-s', serial, 'shell', 'dumpsys', 'window', 'displays']));
}

export async function rotateDisplay(serial, mode = 'clockwise', run = adb) {
  if (!['clockwise', 'auto'].includes(mode)) throw new Error('Mode rotasi tidak valid.');
  const shell = (...args) => run(['-s', serial, 'shell', 'wm', ...args]);
  const before = await getDisplay(serial, run);
  const user = (await shell('user-rotation')).trim().match(/^(free|lock)(?:\s+([0-3]))?$/);
  const fixed = (await shell('fixed-to-user-rotation')).trim();
  if (!user || !['default', 'enabled', 'disabled'].includes(fixed)) throw new Error('Pengaturan rotasi HP belum dikenali.');
  try {
    if (mode === 'auto') {
      await shell('fixed-to-user-rotation', 'default');
      await shell('user-rotation', 'free');
      return { ...await getDisplay(serial, run), rotationMode: 'auto' };
    }
    const target = (before.rotation + 1) % 4;
    await shell('user-rotation', 'lock', String(target));
    await shell('fixed-to-user-rotation', 'enabled');
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const display = await getDisplay(serial, run);
      if (display.rotation === target) return { ...display, rotationMode: 'locked' };
    }
    throw new Error('HP belum mengikuti rotasi yang diminta. Pengaturan sebelumnya dipulihkan.');
  } catch (error) {
    await shell('user-rotation', user[1], ...(user[1] === 'lock' ? [user[2] || '0'] : [])).catch(() => {});
    await shell('fixed-to-user-rotation', fixed).catch(() => {});
    throw error;
  }
}
