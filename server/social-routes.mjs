import { join } from 'node:path';
import x from './platforms/x.mjs';
import threads from './platforms/threads.mjs';
import facebook from './platforms/facebook.mjs';
import youtube from './platforms/youtube.mjs';
import { SocialSimulation } from './social-simulation.mjs';

export async function registerSocialRoutes(app, dataDir, options = {}) {
  const managers = [];
  for (const platform of [x, threads, facebook, youtube]) {
    const manager = new SocialSimulation({ ...options, platform, statePath: join(dataDir, 'simulations', `${platform.id}.json`) });
    await manager.load(); managers.push(manager);
    const base = `/api/social/${platform.id}`;
    const route = handler => async (req, res) => { try { res.json(await handler(req)); } catch (error) { res.status(400).json({ error: error.message }); } };
    app.get(base, route(() => manager.snapshot()));
    app.put(`${base}/plan`, route(req => manager.savePlan(req.body)));
    app.post(`${base}/preview`, route(req => manager.preview(req.body)));
    app.post(`${base}/start`, route(req => manager.start(req.body)));
    app.post(`${base}/stop`, route(() => manager.stop()));
    app.post(`${base}/reset`, route(req => manager.reset(req.body)));
    app.get(`${base}/history/:id`, route(req => manager.history(req.params.id)));
  }
  return managers;
}
