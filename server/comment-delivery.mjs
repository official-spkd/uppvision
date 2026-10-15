// Evidence is supplied by the platform UI adapter. Absence is never proof of failure.
export function deliveryEvidence({ blocked, offline, failed, posting, visible, accountMatches = true, scopedFailure = false }, { recovery = false } = {}) {
  if (blocked) return 'blocked';
  if (!accountMatches) return 'uncertain';
  if (failed) return !recovery || scopedFailure ? 'failed' : 'uncertain';
  if (offline) return 'uncertain';
  if (posting) return 'posting';
  return visible ? 'visible' : 'uncertain';
}

export async function verifyDelivery({ observe, online, pause, recovery = false, attempts = 20, timeoutMs = 30000, now = Date.now }) {
  const deadline = now() + timeoutMs;
  let stable = 0, last = 'uncertain';
  for (let i = 0; i < attempts && now() < deadline; i++) {
    let observation;
    try { observation = await observe(); } catch { return 'uncertain'; }
    last = deliveryEvidence(observation, { recovery });
    if (last === 'blocked' || last === 'failed') return last;
    if (last === 'visible') {
      let connected = false;
      try { connected = await online(); } catch {}
      stable = connected ? stable + 1 : 0;
      // Require matching author and text on two separate online observations.
      if (stable >= 2) return 'sent';
      if (!connected) last = 'uncertain';
    } else stable = 0;
    if (i + 1 < attempts && now() < deadline) await pause(1500);
  }
  return last === 'posting' ? 'posting' : 'uncertain';
}

// A recovery failure must be attached to the same comment row, never a page-wide banner.
export function associatedFailure(nodes, matchesComment, hasFailure) {
  for (const node of nodes.filter(matchesComment)) {
    if (hasFailure([node])) return true;
    const parent = node.parent;
    if (!parent || !/comment.*(?:row|cell|container)|row.*comment/i.test(parent['resource-id'] || '')) continue;
    const row = nodes.filter(n => { for (let p = n; p; p = p.parent) { if (p === parent) return true; } return false; });
    if (hasFailure(row)) return true;
  }
  return false;
}
