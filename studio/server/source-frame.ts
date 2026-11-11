import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Store } from './store';
import { command, ingest } from './media';

/** Shared video-frame extraction, independent of the retired image workflows. */
export function registerSourceFrameRoute(app: Express, store: Store) {
  app.post('/api/images/source-frame', async (req, res) => {
    const value = z.object({ sourceId: z.string(), time: z.number().finite().nonnegative() }).parse(req.body);
    const source = store.asset(value.sourceId);
    if (!source || source.kind !== 'video' || value.time >= source.duration) throw new Error('Choose a frame inside your motion video.');
    const folder = path.join(store.root, 'uploads'); await mkdir(folder, { recursive: true });
    const temporary = path.join(folder, randomUUID() + '.png');
    const time = Math.floor(value.time * 24) / 24;
    try {
      await command('ffmpeg', ['-v', 'error', '-y', '-ss', String(time), '-i', source.path, '-frames:v', '1', temporary]);
      const asset = await ingest(store, temporary, 'image', `${source.name.replace(/\.[^.]+$/, '')} · ${time.toFixed(2)}s.png`);
      asset.sourceFrame = { videoId: source.id, time }; store.addAsset(asset); res.status(201).json({ ...asset, path: '', poster: 'ready' });
    } finally { await rm(temporary, { force: true }); }
  });
}
