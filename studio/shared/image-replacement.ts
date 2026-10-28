import { z } from 'zod';
import type { Asset, Job } from './types';
import type { CharacterSnapshot } from './characters';

export const legacyImagePrompt = `Replace the main person in IMAGE 1 (target photograph) with the person from IMAGE 2 (identity reference). Produce one photorealistic photograph, with no changes beyond the replacement.

IDENTITY — IMAGE 2 is authoritative. Preserve the person's recognizable facial geometry: bone structure, eye shape and spacing, nose, lips, jaw, cheeks, forehead and distinguishing features. Keep their natural skin tone, hairline, hairstyle, outfit and accessories. Do not blend faces, beautify, idealize, age, reshape or invent a different person. Adapt their face to the target viewpoint without changing identity.

POSE AND CAMERA — IMAGE 1 is authoritative. Match the original subject's screen position, apparent height and head size, camera distance, head tilt, gaze, expression, shoulder alignment, arms, hands, torso, legs and contact points. Keep the same camera viewpoint, perspective, framing and subject-to-background relationship. Retain the replacement person's own anatomy and body proportions while fitting the target pose and apparent scale. Adapt clothing folds to that pose; preserve the outfit's design. Do not move the person forward, backward or sideways.

PHOTOGRAPHIC INTEGRATION — Preserve IMAGE 1's background, architecture, furniture, objects and foreground occlusions. Match its light direction, exposure, color temperature, reflections, ambient light and contact shadows. Keep the original depth of field, grain, sharpness, lens rendering and ordinary camera texture. Use natural skin detail and believable hands. Avoid waxy skin, artificial sharpening, pasted-on faces, halos and altered backgrounds.

Priority: facial identity from IMAGE 2; placement, pose, distance and framing from IMAGE 1; clothing and appearance from IMAGE 2; lighting and environment from IMAGE 1. The result should look like the same photograph taken at the same moment, with the replacement person occupying the original subject's exact location.`;

export const defaultImagePrompt = `Replace the entire person in IMAGE 1 with the person from IMAGE 2, including their recognizable face, hair, body appearance, complete outfit and accessories. Dress them entirely in IMAGE 2's garments, preserving the neckline, sleeves, fabric, colors and garment length, fitted naturally to the target pose. Replace every original garment and accessory rather than combining the two outfits. Match IMAGE 1's exact pose, head size, screen position, camera distance, expression and framing. Preserve its room, objects and occlusions. Illuminate the replacement with the target scene's light direction, exposure, color temperature, reflected light and contact shadows. Match the photograph's focus, grain and natural skin texture.`;

// Frozen for the first paid A–E comparisons. Preserve their original instructions.
export const bodyOnlyPromptV1 = `Edit <image1>, the original scene photograph. <image2> shows the replacement person's physique and body proportions. <image3> shows that same person's facial identity and hair. Reference sheets show multiple views of ONE person; do not render the sheet, extra people, labels or separate panels.

Replace the original person's facial identity, hair, skin tone and physique with this reference person. Use <image3> for recognizable facial geometry and <image2> for shoulder width, torso, waist, hips and limb proportions. Select the views appropriate to the target angle; preserve the target's expression, gaze and head rotation.

Keep ALL clothing and accessories from <image1>: the same garments, coverage, neckline, sleeves, colors, patterns and design. Fit those original garments naturally to the replacement physique, allowing realistic changes to folds, tension and silhouette. Ignore the clothes in <image2> and <image3>.

Keep <image1>'s exact camera viewpoint, framing, camera distance, subject placement, pose, contact points and hand positions. Preserve its background and foreground objects. Match its lighting, shadows, exposure, color temperature, photographic texture and focus. Reference lighting and backgrounds do not transfer. Return one opaque natural photograph at the original scene composition.`;

export const bodyOnlyPrompt = bodyOnlyPromptV1 + `\n\nKeep visible occluders and visibility from <image1>. If the face is covered, offscreen or facing away, keep it hidden: do not turn the head toward the camera or invent a visible frontal face. Preserve the original hand, object or foreground obstruction and its position.`;

// User-accepted native photo 545ff68d. Reference crops stay bound to the current
// character assets; a preset never carries another character's asset IDs.
export const sourceFramePreset = {
  model: 'qwen21', qwenRecipe: 'body-only', qwenQuality: 'fast', bodyOnlyStrategy: 'native', bodyOnlyReuseId: null, bodyOnlyPose: false,
  prompt: bodyOnlyPrompt, megapixels: 1, protectBackground: true, feather: 12, maskExpand: 64, maskFillHoles: true,
  qwenHeadRefine: false, structureStrength: 0, repairMaskGaps: false, qwenRelight: false, qwenNormalizeReference: false,
  qwenEdgeOnly: false, qwenSceneIntegration: false, qwenLayoutOnly: false, localIdentity: false, qwenIdentityGuide: false,
  qwenBodyPose: false, bodyPoseStrength: .65, faceDetail: false, identityRefine: false, seed: 1583893113, randomSeed: false,
} as const;

export function bodyOnlyConditioningPrompt(prompt: string, legacy = false): string {
  const base = legacy ? bodyOnlyPromptV1 : bodyOnlyPrompt, extra = prompt.trim();
  return base + (extra && ![bodyOnlyPrompt, bodyOnlyPromptV1, defaultImagePrompt, legacyImagePrompt].includes(extra) ? '\nAdditional edit requirements: ' + extra : '');
}
export function singleImageConditioningPrompt(prompt: string): string {
  return bodyOnlyConditioningPrompt(prompt).replace('Edit <image1>, the original scene photograph. <image2> shows the replacement person\'s physique and body proportions. <image3> shows that same person\'s facial identity and hair.', 'Edit <image1>, the original scene photograph. <image2> supplies the replacement person\'s facial identity, hair, physique and body proportions.').replaceAll('<image3>', '<image2>');
}

export const imageReferenceViewSchema = z.object({
  assetId: z.string().min(1), x: z.number().int().min(0).max(16384), y: z.number().int().min(0).max(16384),
  width: z.number().int().min(32).max(16384), height: z.number().int().min(32).max(16384),
});
export type ImageReferenceView = z.infer<typeof imageReferenceViewSchema>;
export function referenceViewIssue(view: ImageReferenceView | null | undefined, asset: Pick<Asset, 'id' | 'width' | 'height'> | null | undefined): string | null {
  if (!view) return null;
  if (!asset || view.assetId !== asset.id) return 'The selected view belongs to another reference. Choose the view again.';
  if (view.x + view.width > asset.width || view.y + view.height > asset.height) return 'The selected view extends outside its reference image.';
  return null;
}

export const imageSettingsSchema = z.object({
  model: z.enum(['klein4b', 'qwen21']).default(sourceFramePreset.model),
  qwenRecipe: z.enum(['whole-person', 'source-anchored', 'native-masked', 'native-scene', 'identity-first', 'body-identity', 'body-only']).default(sourceFramePreset.qwenRecipe),
  qwenQuality: z.enum(['fast', 'quality']).default('fast'),
  bodyOnlyStrategy: z.enum(['native', 'staged', 'detail']).default('native'),
  bodyOnlyReuseId: z.string().uuid().nullable().default(null),
  bodyOnlyPose: z.boolean().default(false),
  bodyReferenceView: imageReferenceViewSchema.nullable().default(null),
  faceReferenceView: imageReferenceViewSchema.nullable().default(null),
  qwenHeadRefine: z.boolean().default(false),
  structureStrength: z.number().finite().min(0).max(2).default(sourceFramePreset.structureStrength),
  repairMaskGaps: z.boolean().default(false),
  prompt: z.string().trim().max(8000).default(sourceFramePreset.prompt),
  megapixels: z.union([z.literal(1), z.literal(2)]).default(1),
  protectBackground: z.boolean().default(true),
  feather: z.number().int().min(0).max(24).default(sourceFramePreset.feather),
  maskExpand: z.number().int().min(0).max(64).default(sourceFramePreset.maskExpand),
  maskFillHoles: z.boolean().default(sourceFramePreset.maskFillHoles),
  qwenRelight: z.boolean().default(false),
  qwenNormalizeReference: z.boolean().default(false),
  qwenEdgeOnly: z.boolean().default(false),
  qwenSceneIntegration: z.boolean().default(false),
  qwenLayoutOnly: z.boolean().default(false),
  localIdentity: z.boolean().default(false),
  qwenIdentityGuide: z.boolean().default(false),
  qwenBodyPose: z.boolean().default(false),
  bodyPoseStrength: z.number().finite().min(0).max(1.5).default(.65),
  faceDetail: z.boolean().default(sourceFramePreset.faceDetail),
  identityRefine: z.boolean().default(false),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(sourceFramePreset.seed),
  randomSeed: z.boolean().default(false),
}).transform(settings => ({ ...settings, prompt: (settings.model !== 'qwen21' || settings.qwenRecipe !== 'body-only') && settings.prompt === bodyOnlyPrompt ? defaultImagePrompt : settings.prompt }));
export type ImageSettings = z.infer<typeof imageSettingsSchema>;
export const imageDefaults = imageSettingsSchema.parse({});
export function sourceFrameImageSettings(current?: ImageSettings): ImageSettings {
  return imageSettingsSchema.parse({ ...sourceFramePreset, bodyReferenceView: current?.bodyReferenceView || null, faceReferenceView: current?.faceReferenceView || null });
}
export const imageDraftSchema = z.object({
  referenceMode: z.enum(['images', 'character']).default('images'), characterId: z.string().nullable().default(null), characterRevision: z.number().int().positive().nullable().default(null),
  sourceId: z.string().nullable().default(null), referenceId: z.string().nullable().default(null),
  faceId: z.string().nullable().default(null), maskId: z.string().nullable().default(null),
  settings: imageSettingsSchema.default(imageDefaults),
});
export type ImageDraft = z.infer<typeof imageDraftSchema>;
export const emptyImageDraft = (): ImageDraft => imageDraftSchema.parse({});
export interface ImageGeometry { width: number; height: number; contentWidth: number; contentHeight: number; x: number; y: number; outputWidth: number; outputHeight: number; }
export interface ImageReview { status: 'review' | 'warning'; warnings: string[]; backgroundProtected: boolean; outsideMaskMaxDifference: number | null; sourceFace: boolean; referenceFace: boolean; outputFace: boolean; outsideHeadMaxDifference?: number; }
export const localFramingSchema = z.object({
  version: z.literal('foreground-scale-v1'), parentJobId: z.string().optional(),
  scale: z.number().finite().min(1).max(1.5), matrix: z.array(z.array(z.number().finite()).length(3)).length(2),
  width: z.number().int().positive(), height: z.number().int().positive(),
  parentSHA256: z.string().regex(/^[a-f0-9]{64}$/), sourceSHA256: z.string().regex(/^[a-f0-9]{64}$/),
  resultSHA256: z.string().regex(/^[a-f0-9]{64}$/), maskSHA256: z.string().regex(/^[a-f0-9]{64}$/), matteSHA256: z.string().regex(/^[a-f0-9]{64}$/),
  elapsedSeconds: z.number().finite().nonnegative(), paidInference: z.literal(false),
  geometry: z.object({ headSizeRatio: z.number().finite().positive(), faceCenterOffsetPixels: z.array(z.number().finite()).length(2) }).nullable(),
});
export interface ImageRun {
  version?: 'masked-latent-v2' | 'masked-latent-v3' | 'masked-latent-v4' | 'scene-anchor-v1' | 'scene-anchor-v2' | 'scene-anchor-v3' | 'scene-anchor-v4' | 'scene-anchor-v5' | 'scene-anchor-v6' | 'scene-anchor-v7' | 'scene-anchor-v8' | 'native-mask-v1' | 'native-scene-v1' | 'identity-first-v1' | 'identity-first-v2' | 'body-identity-v1' | 'body-identity-v2' | 'body-only-v1' | 'body-only-v2' | 'body-only-v3' | 'body-only-v4' | 'body-only-v5' | 'body-only-v6' | 'body-only-single-v1';
  character?: CharacterSnapshot;
  conditioningPrompt?: string;
  stagedPrompts?: { body: string; outfit: string; face: string };
  headPrompt?: string;
  reusedBody?: { jobId: string; sha256: string };
  settings: ImageSettings; faceId: string | null; maskId: string | null; geometry: ImageGeometry;
  prepared?: { hasFace: boolean; warnings: string[]; headEdit?: { x: number; y: number; size: number; resolution: number } }; review?: ImageReview; resultAssetId?: string;
  localFraming?: z.infer<typeof localFramingSchema> & { parentJobId: string };
}
export const isImageJob = (job: Pick<Job, 'mediaType'>): boolean => job.mediaType === 'image';
export const canFinishImageLocally = (job: Job): boolean => isImageJob(job) && job.progress.completedFrames >= job.progress.targetFrames && job.segments.length > 0 && !job.pendingPrompt && !job.submitting;

export function imageGeometry(source: Pick<Asset, 'width' | 'height'>, megapixels: ImageSettings['megapixels'], model: ImageSettings['model'] = 'klein4b'): ImageGeometry {
  const { width: w, height: h } = source;
  if (![w, h].every(v => Number.isSafeInteger(v) && v >= 32 && v <= 16384) || w * h > 32_000_000) throw new Error('Use a target image between 32 pixels and 32 megapixels.');
  if (w / h < .25 || w / h > 4) throw new Error('Choose a target photo with an aspect ratio between 1:4 and 4:1. The image will not be cropped.');
  const scale = model === 'qwen21' ? Math.sqrt(megapixels * 1_000_000 / (w * h)) : Math.min(1, Math.sqrt(megapixels * 1_000_000 / (w * h)));
  const contentWidth = Math.max(1, Math.round(w * scale)), contentHeight = Math.max(1, Math.round(h * scale));
  const grid = model === 'qwen21' ? 32 : 16;
  const width = Math.max(64, Math.ceil(contentWidth / grid) * grid), height = Math.max(64, Math.ceil(contentHeight / grid) * grid);
  return { width, height, contentWidth, contentHeight, x: Math.floor((width - contentWidth) / 2), y: Math.floor((height - contentHeight) / 2), outputWidth: w, outputHeight: h };
}

export function imagePrompt(settings: ImageSettings, hasFace: boolean, version?: ImageRun['version']): string {
  if (version === 'masked-latent-v3' || version === 'masked-latent-v4') return 'IMAGE 1 supplies the scene and pose; IMAGE 2 supplies the entire replacement person and outfit. '
    + (hasFace ? 'IMAGE 3 supplies only a clearer face of the same replacement person. ' : '')
    + (settings.prompt.trim() && settings.prompt !== legacyImagePrompt ? settings.prompt.trim() : defaultImagePrompt);
  return 'Edit IMAGE 1 only. IMAGE 1 defines the scene, pose, framing and camera distance. IMAGE 2 defines the replacement identity, hair and outfit. '
    + (version === 'masked-latent-v2' ? 'Replace the entire person, including every original garment and accessory, with the person and complete outfit from IMAGE 2. Match IMAGE 2\'s neckline, sleeves, fabric, colors and clothing design on the target pose. Preserve IMAGE 1\'s original room and background texture. ' : '')
    + (hasFace ? 'IMAGE 3 is a close-up of that same replacement person: use it to preserve facial features only, never its pose, lighting, framing or background. ' : '')
    + (settings.prompt.trim() || legacyImagePrompt);
}
