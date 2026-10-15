// Shared by the panel and server. Never pass an unvalidated URL to Android.
// Server and panel must agree on this ceiling; an over-limit plan is rejected before any device work.
export const MAX_ACCOUNTS = 100;
// Satu pekerjaan Auto komen menerima paling banyak 20 link, jadi menu pengambil link
// memakai batas yang sama supaya hasil salinannya selalu bisa ditempel utuh.
export const MAX_LINKS = 20;
export function instagramTarget(value, { allowPostLinks = true } = {}) {
  const input = typeof value === 'string' ? value.trim() : '';
  const username = input.replace(/^@/, '').toLowerCase();
  if (/^[a-zA-Z0-9_](?:[a-zA-Z0-9_.]{0,28}[a-zA-Z0-9_])?$/.test(username)) return { kind: 'profile', target: username };
  if (allowPostLinks && /^https:\/\//i.test(input) && !/[\\\s]/.test(input)) {
    let url;
    try { url = new URL(input); } catch {}
    // Instagram hands out pasted links with the profile name in front of the post type
    // (…/tvrakyat.official/reel/Dee3DCPhqe-/) about as often as the short form (…/reel/…).
    // Both open the same post, so the optional name segment is accepted and dropped;
    // the stored target is always the short canonical form. The segment may not start
    // with a dot, so a bare ".." can never smuggle a different path.
    const match = url?.pathname.match(/^\/(?:[A-Za-z0-9_][A-Za-z0-9_.]{0,29}\/)?(p|reel)\/([A-Za-z0-9_-]{5,64})\/?$/);
    if (url && ['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(url.hostname) && !url.username && !url.password && !url.port && match) {
      return { kind: 'post', shortcode: match[2], target: `https://www.instagram.com/${match[1]}/${match[2]}/` };
    }
  }
  throw new Error(allowPostLinks ? 'Isi username atau link postingan Instagram yang valid (https://www.instagram.com/p/…/ atau /reel/…/).' : 'Isi satu username target yang valid.');
}
export function isInstagramPostTarget(value) {
  try { return instagramTargets(value).kind === 'posts'; } catch { return false; }
}
export function instagramTargets(value, { allowPostLinks = true } = {}) {
  const lines = (typeof value === 'string' ? value : '').split(/\r?\n/).map((text, i) => ({ text: text.trim(), line: i + 1 })).filter(row => row.text);
  if (!lines.length) throw new Error('Isi username atau link postingan Instagram.');
  const targets = [], seen = new Set();
  for (const { text, line } of lines) {
    let parsed;
    try { parsed = instagramTarget(text, { allowPostLinks }); }
    catch (error) { throw new Error(`Baris ${line}: ${error.message}`); }
    if (parsed.kind === 'profile') {
      if (lines.length === 1) return parsed;
      throw new Error(`Baris ${line}: gunakan satu link postingan per baris; username tidak boleh dicampur dengan link atau username lain.`);
    }
    if (!seen.has(parsed.shortcode)) { targets.push(parsed); seen.add(parsed.shortcode); }
  }
  if (targets.length > MAX_LINKS) throw new Error(`Maksimal ${MAX_LINKS} link postingan berbeda per akun.`);
  return { kind: 'posts', targets, target: targets.map(p => p.target).join('\n') };
}
export const targetLabel = value => {
  try { const parsed = instagramTargets(value); if (parsed.kind === 'posts') return parsed.targets.length === 1 ? parsed.target : `${parsed.targets.length} link postingan`; } catch {}
  return `@${value}`;
};
export const effectivePostCount = (settings, platform = 'ig') => {
  if (platform === 'ig') { try { const parsed = instagramTargets(settings.target); if (parsed.kind === 'posts') return parsed.targets.length; } catch {} }
  return Number(settings.posts || 0);
};
export function validCommentSettings(settings, platform = 'ig') {
  try { instagramTargets(settings.target, { allowPostLinks: platform === 'ig' }); } catch { return false; }
  const posts = effectivePostCount(settings, platform), comments = Number(settings.comments);
  return Number.isInteger(posts) && posts >= 1 && posts <= 50 && Number.isInteger(comments) && comments >= 1 && comments <= 100 && ['positif', 'netral', 'negatif'].includes(settings.tone);
}
