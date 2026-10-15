import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { JSON_BODY_LIMIT, JSON_BODY_LIMIT_BYTES } from '../server/body-limit.mjs';

// The largest plan the panel can build: 100 accounts, each carrying 20 Instagram links.
// This is what the API used to reject with 500 "request entity too large".
function largestPlan() {
  const links = Array.from({ length: 20 }, (_, i) => `https://www.instagram.com/p/${String(i).padStart(2, '0')}${'A'.repeat(62)}/`);
  const accounts = Array.from({ length: 100 }, (_, i) => ({
    serial: 'R5CT7076ZQP', username: `account.number.${String(i).padStart(3, '0')}`,
    target: links.join('\n'), posts: 20, comments: 100, tone: 'positif',
  }));
  return { startMode: 'serentak', accounts };
}

test('the configured body limit fits the largest plan the panel allows', () => {
  const size = Buffer.byteLength(JSON.stringify(largestPlan()));
  assert.ok(size < JSON_BODY_LIMIT_BYTES, `largest plan is ${size} bytes but the limit is only ${JSON_BODY_LIMIT_BYTES}`);
});

test('a server using that limit accepts the largest plan and still refuses an oversized body', async t => {
  const app = express();
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.post('/plan', (req, res) => res.json({ accounts: req.body.accounts.length }));
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  t.after(() => new Promise(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${server.address().port}/plan`;
  const post = body => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const accepted = await post(largestPlan());
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).accounts, 100);

  const refused = await post({ filler: 'x'.repeat(JSON_BODY_LIMIT_BYTES + 4096) });
  assert.equal(refused.status, 413, 'a body past the limit is still refused');
});
