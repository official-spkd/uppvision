export function updateProgress(manager, entry) {
  const progress = entry.progress ||= {};
  for (const p of Object.values(progress)) {
    if (!p.key) continue;
    const ownPending = manager.state.history.filter(r => r.key === p.key && ['sending', 'posting', 'uncertain', 'blocked'].includes(r.status)).length;
    p.pending = ownPending;
    p.confirmed = Math.max(0, manager.countFor(p.key) - ownPending);
    p.remaining = Math.max(0, p.requested - p.confirmed - ownPending);
    p.held = manager.pendingRecords(p.key).length;
    const waiting = 'Menunggu pemeriksaan hasil kiriman.';
    if (p.held) {
      if (p.reason !== waiting) p.resumeReason = p.reason || 'Belum dikerjakan.';
      p.reason = waiting;
    } else {
      if (p.reason === waiting) p.reason = p.resumeReason || 'Belum dikerjakan.';
      delete p.resumeReason;
      if (!p.remaining) p.reason = '';
    }
  }
  const values = Object.values(progress);
  entry.requested = entry.posts * entry.comments;
  entry.confirmed = values.reduce((n, p) => n + (p.confirmed || 0), 0);
  entry.pending = values.reduce((n, p) => n + (p.held || p.pending || 0), 0);
  const ownPending = values.reduce((n, p) => n + (p.pending || 0), 0);
  entry.remaining = Math.max(0, entry.requested - entry.confirmed - ownPending);
  return entry;
}
