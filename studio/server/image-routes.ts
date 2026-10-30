import type { Express } from 'express';
import multer from 'multer';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Store } from './store';
import { publicJob } from './store';
import type { ConnectionManager } from './comfy';
import type { Runner } from './runner';
import type { CloudManager } from './cloud';
import type { ModelManager } from './models';
import { command, ingest, probe } from './media';
import { bodyOnlyConditioningPrompt, sourceHeadBodyConditioningPrompt, imageDraftSchema, imageGeometry, isImageJob, referenceViewIssue } from '../shared/image-replacement';
import { imageFilesForSettings } from '../shared/models';
import { defaults, type Asset, type Job } from '../shared/types';
import { characterForImage } from './characters';
import { bodyOnlyStagedPrompts } from './qwen-body-only-staged-workflow';
import { bodyOnlyDetailBodyPrompt, bodyOnlyHeadPrompt } from './qwen-head-detail-workflow';

const publicAsset = (asset: Asset) => ({ ...asset, path: '', poster: 'ready' });
export function registerImageRoutes(app: Express, store: Store, connection: ConnectionManager, runner: Runner, cloud: CloudManager, models: ModelManager, repo: string) {
  const identityStatus = async () => JSON.parse(await command('python3', [path.join(repo, 'scripts/local_identity.py'), 'status'], undefined, 10000)) as { ready: boolean; setup: string };
  app.get('/api/images/local-identity', async (_req, res) => { res.json(await identityStatus()); });
  const inputs = (ids: (string | null)[]) => { for (const id of ids) if (id && store.asset(id)?.kind !== 'image') throw new Error('Choose readable image inputs for image replacement.'); };
  app.post('/api/images/draft', (req, res) => {
    const value = imageDraftSchema.parse(req.body); inputs([value.sourceId, value.referenceId, value.faceId, value.maskId]);
    if (value.maskId && store.asset(value.maskId)?.maskFor !== value.sourceId) throw new Error('The edit mask belongs to another target. Paint the replacement area again.');
    store.set('image-draft', value); res.json(value);
  });
  const upload = multer({ dest: path.join(store.root, 'uploads'), limits: { files: 1, fileSize: 8 * 1024 ** 2, fields: 0 } });
  app.post('/api/images/mask/:sourceId', upload.single('file'), async (req, res) => {
    if (!req.file) return void res.status(400).json({ error: 'Paint a replacement area first.' });
    try {
      const source = store.asset(String(req.params.sourceId)); if (!source || source.kind !== 'image') throw new Error('Choose a target photo before painting.');
      const info = await probe(req.file.path);
      if (Math.abs((info.width / info.height) / (source.width / source.height) - 1) > .02) throw new Error('The painted area does not match the target dimensions.');
      const mask = await ingest(store, req.file.path, 'image', 'Replacement area.png');
      mask.maskFor = source.id; store.addAsset(mask); res.status(201).json(publicAsset(mask));
    } finally { await rm(req.file.path, { force: true }); }
  });
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
      asset.sourceFrame = { videoId: source.id, time }; store.addAsset(asset); res.status(201).json(publicAsset(asset));
    } finally { await rm(temporary, { force: true }); }
  });
  app.post('/api/images/jobs', async (req, res) => {
    const value = imageDraftSchema.parse(req.body), key = req.get('Idempotency-Key');
    if (!key || key.length > 120) return void res.status(400).json({ error: 'An image request ID is required.' });
    const previous = store.byKey(key); if (previous) return void res.status(isImageJob(previous) ? 200 : 409).json(isImageJob(previous) ? publicJob(previous) : { error: 'This request ID was used for another workflow.' });
    if (!value.sourceId || !value.referenceId) throw new Error('Add a target image and an identity reference.');
    const bodyOnly = value.settings.model === 'qwen21' && value.settings.qwenRecipe === 'body-only';
    const character = characterForImage(store, value);
    if (character && (!bodyOnly || value.settings.bodyOnlyStrategy !== 'native')) throw new Error('Saved characters currently use the native source-clothing recipe.');
    let reusedBody: { jobId: string; sha256: string } | undefined;
    if (value.settings.bodyOnlyReuseId) {
      const parent = store.job(value.settings.bodyOnlyReuseId);
      if (!bodyOnly || value.settings.bodyOnlyStrategy !== 'detail' || !parent || parent.deleted || parent.status !== 'completed' || !parent.output || !parent.image?.version?.startsWith('body-only-')) throw new Error('Face-only correction needs a completed body-only photo.');
      if (parent.sourceId !== value.sourceId || parent.referenceId !== value.referenceId || parent.image.maskId !== value.maskId || JSON.stringify(parent.image.settings.bodyReferenceView || null) !== JSON.stringify(value.settings.bodyReferenceView)) throw new Error('The saved body belongs to different source, body or mask inputs. Start a new body edit instead.');
      if (['maskExpand', 'maskFillHoles', 'feather', 'protectBackground'].some(name => parent.image!.settings[name as keyof typeof value.settings] !== value.settings[name as keyof typeof value.settings])) throw new Error('Keep the saved body edit permission unchanged for a face-only correction.');
      reusedBody = { jobId: parent.id, sha256: createHash('sha256').update(await readFile(parent.output)).digest('hex') };
    }
    if (bodyOnly) {
      if (!value.faceId && value.settings.bodyOnlyStrategy !== 'native') throw new Error('Add the facial identity reference for this head refinement recipe.');
      if (!value.settings.protectBackground) throw new Error('Paint an edit area to protect the source scene.');
      for (const [view, id] of [[value.settings.bodyReferenceView, value.referenceId], [value.settings.faceReferenceView, value.faceId]] as const) {
        const issue = referenceViewIssue(view, id ? store.asset(id) : null); if (issue) throw new Error(issue);
      }
      Object.assign(value.settings, { qwenHeadRefine: false, structureStrength: 0, localIdentity: false, qwenIdentityGuide: false, qwenBodyPose: false, qwenNormalizeReference: false, qwenRelight: false, qwenSceneIntegration: false, qwenLayoutOnly: false, qwenEdgeOnly: false });
      if (value.settings.bodyOnlyStrategy === 'staged') value.settings.qwenQuality = 'quality';
    }
    if (value.settings.model === 'qwen21') { value.settings.faceDetail = false; value.settings.identityRefine = false; }
    const native = value.settings.model === 'qwen21' && ['native-masked', 'native-scene', 'identity-first', 'body-identity'].includes(value.settings.qwenRecipe);
    if (native) {
      value.settings.qwenQuality = 'quality'; value.settings.structureStrength = 0;
      if (!value.settings.protectBackground) throw new Error('Native masked replacement requires a painted edit area and background protection.');
    }
    if (value.settings.model === 'qwen21' && ['identity-first', 'body-identity'].includes(value.settings.qwenRecipe)) value.settings.qwenHeadRefine = true;
    const scene = value.settings.model === 'qwen21' && value.settings.qwenRecipe === 'source-anchored';
    if (scene && !value.settings.protectBackground) throw new Error('Source-anchored replacement requires a painted edit area. Keep background protection on.');
    inputs([value.sourceId, value.referenceId, bodyOnly || value.settings.faceDetail || value.settings.identityRefine || (scene || native) && value.settings.qwenHeadRefine ? value.faceId : null, value.settings.protectBackground ? value.maskId : null]);
    if (value.settings.protectBackground && (!value.maskId || store.asset(value.maskId)?.maskFor !== value.sourceId)) throw new Error('Paint the replacement area on this target, or turn off background protection.');
    if (value.settings.qwenRecipe === 'body-identity' && value.settings.qwenBodyPose || bodyOnly && value.settings.bodyOnlyStrategy === 'staged' && value.settings.bodyOnlyPose) {
      const pose = JSON.parse(await command('python3', [path.join(repo, 'scripts/local_pose.py'), 'status'], undefined, 10000));
      if (!pose.ready) throw new Error('Install local pose preparation first: ' + pose.setup + '. Nothing was queued.');
    }
    const source = store.asset(value.sourceId)!, geometry = imageGeometry(source, value.settings.megapixels, value.settings.model);
    if (value.settings.qwenIdentityGuide && (!scene || !value.settings.localIdentity)) throw new Error('The identity placement guide requires source-anchored Qwen and the local identity stage.');
    if (value.settings.localIdentity) {
      if (!scene && !['identity-first', 'body-identity'].includes(value.settings.qwenRecipe)) throw new Error('Local identity anchoring supports source-anchored or identity-first Qwen editing.');
      const identity = await identityStatus();
      if (!identity.ready) throw new Error('Install the optional local identity runtime first: ' + identity.setup + '. Nothing was queued.');
    }
    if (cloud.state.busy || cloud.state.launches.some(l => ['stopping', 'destroying'].includes(l.phase) || (l.instanceId && l.safetyStatus === 'unconfirmed'))) return void res.status(503).json({ error: 'Wait for GPU setup or instance actions to settle before generating.' });
    if (connection.status.state !== 'online') return void res.status(503).json({ error: 'Connect the GPU before generating. Your image draft stays local.' });
    if (models.state.busy || runner.externalGpuBusy()) return void res.status(409).json({ error: 'Finish model downloads or GPU face refinement before generating.' });
    await models.refresh();
    const accepted = store.byKey(key); if (accepted) return void res.json(publicJob(accepted));
    if (models.state.busy || cloud.state.busy || runner.externalGpuBusy() || connection.status.state !== 'online') return void res.status(409).json({ error: 'GPU readiness changed during the check. Nothing was queued.' });
    if (models.state.error) return void res.status(503).json({ error: models.state.error });
    const missing = imageFilesForSettings(value.settings).filter(id => models.state.files.find(file => file.id === id)?.status !== 'installed');
    if (missing.length) return void res.status(409).json({ error: 'Download the selected image files first. No video models are needed.', missingModels: missing });
    const settings = { ...value.settings }; if (settings.randomSeed) settings.seed = randomInt(0, 0xffffffff);
    const title = source.sourceFrame ? `Frame ${source.sourceFrame.time.toFixed(2)}s / Imagen` : source.name.replace(/\.[^.]+$/, '').slice(0, 80) + ' / Imagen';
    const job: Job = { id: randomUUID(), title, status: 'queued', mediaType: 'image',
      sourceId: value.sourceId, referenceId: value.referenceId, settings: { ...defaults, prompt: settings.prompt, seed: settings.seed, randomSeed: settings.randomSeed },
      image: { version: bodyOnly ? settings.bodyOnlyStrategy === 'detail' ? 'body-only-v6' : settings.bodyOnlyStrategy === 'staged' ? 'body-only-v4' : !value.faceId ? 'body-only-single-v3' : 'body-only-v8' : settings.model === 'qwen21' && settings.qwenRecipe === 'body-identity' ? (settings.qwenBodyPose ? 'body-identity-v2' : 'body-identity-v1') : native ? (settings.qwenRecipe === 'identity-first' ? (settings.localIdentity ? 'identity-first-v2' : 'identity-first-v1') : settings.qwenRecipe === 'native-scene' ? 'native-scene-v1' : 'native-mask-v1') : scene ? (settings.qwenIdentityGuide ? 'scene-anchor-v8' : settings.qwenLayoutOnly || settings.localIdentity ? 'scene-anchor-v7' : settings.qwenEdgeOnly ? 'scene-anchor-v6' : settings.qwenRelight ? 'scene-anchor-v5' : settings.qwenNormalizeReference ? 'scene-anchor-v4' : 'scene-anchor-v3') : 'masked-latent-v4', ...(bodyOnly ? { ...(character ? { character } : {}), conditioningPrompt: !value.faceId ? sourceHeadBodyConditioningPrompt(settings.prompt, true) : settings.bodyOnlyStrategy === 'detail' ? bodyOnlyDetailBodyPrompt(settings.prompt) : settings.bodyOnlyStrategy === 'native' ? sourceHeadBodyConditioningPrompt(settings.prompt) : bodyOnlyConditioningPrompt(settings.prompt), ...(settings.bodyOnlyStrategy === 'staged' ? { stagedPrompts: bodyOnlyStagedPrompts(settings.prompt) } : {}), ...(settings.bodyOnlyStrategy === 'detail' ? { headPrompt: bodyOnlyHeadPrompt, ...(reusedBody ? { reusedBody } : {}) } : {}) } : {}), settings, faceId: value.faceId, maskId: value.maskId, geometry }, width: geometry.width, height: geometry.height, outputSize: { width: source.width, height: source.height },
      createdAt: new Date().toISOString(), favorite: false, deleted: false, progress: { stage: 'Queued for Imagen', node: null, value: null, max: null, unit: 'steps', segment: 1, segments: 1, completedFrames: 0, targetFrames: 1, updatedAt: Date.now() },
      segments: [], context: '', pendingPrompt: null, uploads: null, error: null, output: null, poster: null, cancelRequested: false, elapsedSeconds: null, origin: 'render', workflow: null };
    store.addJob(job, key); res.status(201).json(publicJob(job)); void runner.kick();
  });
  app.post('/api/images/jobs/:id/use', async (req, res) => {
    const job = store.job(String(req.params.id));
    if (!job || !isImageJob(job) || !job.image || job.deleted || job.status !== 'completed' || !job.output) throw new Error('Choose a completed image replacement.');
    let asset = job.image.resultAssetId ? store.asset(job.image.resultAssetId) : null;
    if (!asset) { asset = await ingest(store, job.output, 'image', job.title + '.png', true); job.image.resultAssetId = asset.id; store.saveJob(job); }
    const source = store.asset(job.sourceId), frame = source?.sourceFrame, video = frame ? store.asset(frame.videoId) : null;
    const draft = store.draft(); draft.referenceId = asset.id;
    const character = job.image.character;
    const sameVideo = !!frame && draft.sourceId === video?.id;
    const withinTrim = !!frame && sameVideo && frame.time >= draft.settings.start - 1 / 48 && frame.time < draft.settings.start + draft.settings.seconds;
    const selectedStart = frame && !withinTrim ? Math.max(0, Math.round((frame.time - 2) * 24) / 24) : draft.settings.start;
    const selectedDuration = withinTrim ? draft.settings.seconds : 5;
    draft.settings = { ...draft.settings, engine: 'viggle', mode: 'swap', fps: 24, orientation: 'source', loraA: 'None', loraB: 'None', referencePreparation: frame && video?.kind === 'video' ? 'prepared' : 'auto', referenceTime: frame && video?.kind === 'video' ? frame.time : null, seconds: selectedDuration,
      imagenRepaint: character?.bodyView && character.faceView && frame && video?.kind === 'video' ? { characterId: character.id, revision: character.revision, bodyView: character.bodyView, faceView: character.faceView, sourceImageJobId: job.id } : null,
      imagenRepaintEnabled: !!(character?.bodyView && character.faceView && frame && video?.kind === 'video'),
      ...(character ? { viggleReferenceMode: 'previous' as const } : {}) };
    if (frame && video?.kind === 'video') {
      asset.sourceFrame = frame; store.addAsset(asset); draft.sourceId = video.id; draft.settings.start = selectedStart;
      draft.settings.seconds = Math.min(30, selectedDuration, Math.floor((video.duration - selectedStart) * 24) / 24);
    }
    store.set('draft', draft); res.json({ asset: publicAsset(asset), draft });
  });
}
