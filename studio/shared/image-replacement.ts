import { z } from 'zod';
import type { Asset, Job } from './types';

export const legacyImagePrompt = `Replace the main person in IMAGE 1 (target photograph) with the person from IMAGE 2 (identity reference). Produce one photorealistic photograph, with no changes beyond the replacement.

IDENTITY — IMAGE 2 is authoritative. Preserve the person's recognizable facial geometry: bone structure, eye shape and spacing, nose, lips, jaw, cheeks, forehead and distinguishing features. Keep their natural skin tone, hairline, hairstyle, outfit and accessories. Do not blend faces, beautify, idealize, age, reshape or invent a different person. Adapt their face to the target viewpoint without changing identity.

POSE AND CAMERA — IMAGE 1 is authoritative. Match the original subject's screen position, apparent height and head size, camera distance, head tilt, gaze, expression, shoulder alignment, arms, hands, torso, legs and contact points. Keep the same camera viewpoint, perspective, framing and subject-to-background relationship. Retain the replacement person's own anatomy and body proportions while fitting the target pose and apparent scale. Adapt clothing folds to that pose; preserve the outfit's design. Do not move the person forward, backward or sideways.

PHOTOGRAPHIC INTEGRATION — Preserve IMAGE 1's background, architecture, furniture, objects and foreground occlusions. Match its light direction, exposure, color temperature, reflections, ambient light and contact shadows. Keep the original depth of field, grain, sharpness, lens rendering and ordinary camera texture. Use natural skin detail and believable hands. Avoid waxy skin, artificial sharpening, pasted-on faces, halos and altered backgrounds.

Priority: facial identity from IMAGE 2; placement, pose, distance and framing from IMAGE 1; clothing and appearance from IMAGE 2; lighting and environment from IMAGE 1. The result should look like the same photograph taken at the same moment, with the replacement person occupying the original subject's exact location.`;

export const defaultImagePrompt = `Replace the entire person in IMAGE 1 with the person from IMAGE 2, including their recognizable face, hair, body appearance, complete outfit and accessories. Dress them entirely in IMAGE 2's garments, preserving the neckline, sleeves, fabric, colors and garment length, fitted naturally to the target pose. Replace every original garment and accessory rather than combining the two outfits. Match IMAGE 1's exact pose, head size, screen position, camera distance, expression and framing. Preserve its room, objects and occlusions. Illuminate the replacement with the target scene's light direction, exposure, color temperature, reflected light and contact shadows. Match the photograph's focus, grain and natural skin texture.`;

export const imageSettingsSchema = z.object({
  model: z.enum(['klein4b', 'qwen21']).default('klein4b'),
  qwenRecipe: z.enum(['whole-person', 'source-anchored', 'native-masked', 'native-scene', 'identity-first', 'body-identity']).default('whole-person'),
  qwenQuality: z.enum(['fast', 'quality']).default('fast'),
  qwenHeadRefine: z.boolean().default(false),
  structureStrength: z.number().finite().min(0).max(2).default(0.8),
  repairMaskGaps: z.boolean().default(false),
  prompt: z.string().trim().max(8000).default(defaultImagePrompt),
  megapixels: z.union([z.literal(1), z.literal(2)]).default(1),
  protectBackground: z.boolean().default(true),
  feather: z.number().int().min(0).max(24).default(4),
  maskExpand: z.number().int().min(0).max(64).default(0),
  maskFillHoles: z.boolean().default(false),
  qwenRelight: z.boolean().default(false),
  qwenNormalizeReference: z.boolean().default(false),
  qwenEdgeOnly: z.boolean().default(false),
  qwenSceneIntegration: z.boolean().default(false),
  qwenLayoutOnly: z.boolean().default(false),
  localIdentity: z.boolean().default(false),
  qwenIdentityGuide: z.boolean().default(false),
  faceDetail: z.boolean().default(true),
  identityRefine: z.boolean().default(false),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(20261027),
  randomSeed: z.boolean().default(false),
});
export type ImageSettings = z.infer<typeof imageSettingsSchema>;
export const imageDefaults = imageSettingsSchema.parse({});
export const imageDraftSchema = z.object({
  sourceId: z.string().nullable().default(null), referenceId: z.string().nullable().default(null),
  faceId: z.string().nullable().default(null), maskId: z.string().nullable().default(null),
  settings: imageSettingsSchema.default(imageDefaults),
});
export type ImageDraft = z.infer<typeof imageDraftSchema>;
export const emptyImageDraft = (): ImageDraft => imageDraftSchema.parse({});
export interface ImageGeometry { width: number; height: number; contentWidth: number; contentHeight: number; x: number; y: number; outputWidth: number; outputHeight: number; }
export interface ImageReview { status: 'review' | 'warning'; warnings: string[]; backgroundProtected: boolean; outsideMaskMaxDifference: number | null; sourceFace: boolean; referenceFace: boolean; outputFace: boolean; }
export interface ImageRun {
  version?: 'masked-latent-v2' | 'masked-latent-v3' | 'masked-latent-v4' | 'scene-anchor-v1' | 'scene-anchor-v2' | 'scene-anchor-v3' | 'scene-anchor-v4' | 'scene-anchor-v5' | 'scene-anchor-v6' | 'scene-anchor-v7' | 'scene-anchor-v8' | 'native-mask-v1' | 'native-scene-v1' | 'identity-first-v1' | 'identity-first-v2' | 'body-identity-v1';
  settings: ImageSettings; faceId: string | null; maskId: string | null; geometry: ImageGeometry;
  prepared?: { hasFace: boolean; warnings: string[] }; review?: ImageReview; resultAssetId?: string;
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
