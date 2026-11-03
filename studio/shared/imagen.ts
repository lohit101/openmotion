import { imageSettingsSchema, defaultImagePrompt, legacyImagePrompt, bodyOnlyPrompt, bodyOnlyPromptV1, conciseBodyOnlyPrompt, sourceHeadBodyOnlyPrompt, clothingOnlyPrompt, type ImageDraft, type ImageSettings, type ImageGeometry } from './image-replacement';
import type { Asset } from './types';

export type ImagenWorkflow = NonNullable<ImageSettings['workflow']>;
export const imagenWorkflows: { id: ImagenWorkflow; label: string; description: string }[] = [
  { id: 'text-to-image', label: 'Prompt to image', description: 'Create from a description' },
  { id: 'body-only', label: 'Body only', description: 'Keep the target outfit' },
  { id: 'character-outfit', label: 'Character + outfit', description: 'Replace identity and wardrobe' },
  { id: 'clothing-only', label: 'Clothes only', description: 'Keep the target person' },
];
const boilerplate = [defaultImagePrompt, legacyImagePrompt, bodyOnlyPrompt, bodyOnlyPromptV1, conciseBodyOnlyPrompt, sourceHeadBodyOnlyPrompt, clothingOnlyPrompt];
export const imagenWorkflow = (settings: ImageSettings): ImagenWorkflow => settings.workflow || (settings.qwenRecipe === 'clothing-only' ? 'clothing-only' : settings.qwenRecipe === 'body-only' ? 'body-only' : 'character-outfit');

/** New requests use a separate recipe; historical graphs/settings are untouched. */
export function imagenSettings(current: ImageSettings, workflow = imagenWorkflow(current)): ImageSettings {
  return imageSettingsSchema.parse({ ...current, workflow, model: 'qwen21', qwenRecipe: workflow === 'body-only' ? 'body-only' : workflow === 'clothing-only' ? 'clothing-only' : 'whole-person',
    qwenQuality: current.workflow ? current.qwenQuality : 'quality', megapixels: current.workflow ? current.megapixels : 2, promptLanguage: current.promptLanguage || 'en', outputAspect: current.outputAspect || '1:1',
    prompt: boilerplate.includes(current.prompt) ? '' : current.prompt, protectBackground: false, maskExpand: 0, feather: 0, maskFillHoles: false,
    bodyOnlyStrategy: 'native', bodyOnlyReuseId: null, bodyOnlyPose: false, qwenHeadRefine: false, structureStrength: 0, repairMaskGaps: false,
    qwenRelight: false, qwenNormalizeReference: false, qwenEdgeOnly: false, qwenSceneIntegration: false, qwenLayoutOnly: false, localIdentity: false,
    qwenIdentityGuide: false, qwenBodyPose: false, faceDetail: false, identityRefine: false });
}
export function imagenDraft(current: ImageDraft, workflow = imagenWorkflow(current.settings)): ImageDraft {
  const legacyClothes = !current.settings.workflow && current.settings.qwenRecipe === 'clothing-only';
  return { ...current, settings: imagenSettings(current.settings, workflow), maskId: null,
    clothingId: current.clothingId || (legacyClothes ? current.referenceId : null),
    ...(legacyClothes ? { referenceId: null, faceId: null } : {}) };
}

export function imagenGeometry(settings: ImageSettings, source?: Pick<Asset, 'width' | 'height'>): ImageGeometry {
  const aspect = (settings.outputAspect || '1:1').split(':').map(Number);
  const w = source?.width || aspect[0], h = source?.height || aspect[1];
  if (!(w > 0 && h > 0) || w / h < .25 || w / h > 4 || source && (w * h > 32_000_000 || Math.max(w, h) > 16384)) throw new Error('Choose a photo with an aspect ratio between 1:4 and 4:1 and at most 32 megapixels.');
  const edge = settings.megapixels === 2 ? 2048 : 1024, scale = edge / Math.max(w, h);
  const contentWidth = Math.max(32, Math.round(w * scale)), contentHeight = Math.max(32, Math.round(h * scale));
  const width = Math.ceil(contentWidth / 32) * 32, height = Math.ceil(contentHeight / 32) * 32;
  return { width, height, contentWidth, contentHeight, x: Math.floor((width - contentWidth) / 2), y: Math.floor((height - contentHeight) / 2), outputWidth: contentWidth, outputHeight: contentHeight };
}

/** Slot indices are derived from actual inputs, never guessed from UI labels. */
export function imagenPrompt(settings: ImageSettings, hasFace: boolean, hasClothing: boolean): string {
  const workflow = imagenWorkflow(settings), zh = settings.promptLanguage === 'zh';
  const face = hasFace ? '<image3>' : '<image2>', outfit = hasClothing ? `<image${hasFace ? 4 : 3}>` : '<image2>';
  const texture = zh
    ? '输出一张自然的真实相机照片。保留自然不均匀的皮肤纹理、细微色差、发丝和真实织物细节。让人物与原场景的光线方向、曝光、色温、接触阴影、景深、清晰度、颗粒和压缩质感一致。避免磨皮、美颜、蜡质皮肤、过度锐化、绘画或三维渲染质感。'
    : 'Return one natural camera photograph. Retain subtle uneven skin texture, small tonal variations, individual hair strands and real fabric detail. Match the scene light direction, exposure, white balance, contact shadows, depth of field, sharpness, grain and compression texture. Avoid beauty retouching, waxy skin, artificial pore patterns, over-sharpening, illustration and CGI.';
  let task: string;
  if (workflow === 'text-to-image') return texture + '\n\n' + (zh ? '以下用户描述优先；如用户明确指定其他艺术风格，则遵循用户要求：\n' : 'The following user description takes priority, including any explicitly requested artistic style:\n') + settings.prompt.trim();
  const scene = zh
    ? '<image1>是唯一的场景和构图参考：严格保持姿势、头部转向与倾斜、视线、表情、身体位置、人物在画面中的大小、相机距离、透视、遮挡和背景。头、脸、耳朵与头发作为一个整体保持原画面的头部尺度。不要从其他参考图复制姿势、灯光或背景。'
    : '<image1> alone defines the scene: preserve its exact pose, head turn and tilt, gaze, expression, body position, subject scale, camera distance, perspective, occlusions and background. Keep the head, face, ears and hair at one coherent source-relative scale. Do not copy reference poses, lighting or backgrounds.';
  if (workflow === 'clothing-only') task = zh
    ? '只将<image2>中的服装换到<image1>的人物身上。<image2>可以是穿着展示或平铺服装；仅提取服装，不复制模特身份或体型。保留<image1>人物原本的脸、头发、肤色、体型和非服装配饰。准确保留参考服装的款式、颜色、图案、材料、领口、袖子和覆盖范围，按照目标人物的姿势自然调整褶皱与贴合。'
    : 'Transfer only the outfit from <image2> onto the person in <image1>. The reference may show a worn outfit or standalone garments; extract clothing only, never the wearer’s identity or anatomy. Keep the target person’s own face, hair, skin tone, physique and non-clothing accessories. Preserve garment design, colors, patterns, material, neckline, sleeves and coverage; adapt folds and fit naturally to the target pose.';
  else {
    task = zh
      ? `将<image1>中的人物替换成<image2>的人物。<image2>决定体型和真实身体比例，${face}决定准确的面部身份、脸型、骨骼结构、五官间距、发际线与头发。参考身份不能与原人物或服装模特混合。保留参考人物自然的肩、颈、胸、腰、臀和四肢比例，而不是把参考脸贴到原人物身体上。`
      : `Replace the person in <image1> with the person from <image2>. <image2> defines physique and natural anatomical proportions; ${face} defines exact facial identity, head shape, bone structure, feature spacing, hairline and hair. Do not blend with the original person or clothing model. Transfer natural shoulder, neck, chest, waist, hip and limb proportions rather than placing a new face on the old body.`;
    task += workflow === 'body-only'
      ? zh ? ' 服装和配饰只来自<image1>，保留原设计、领口、袖子、图案和首饰，按照新人物体型自然调整衣服贴合与褶皱，不复制身份参考的服装。' : ' Clothing and accessories come only from <image1>: retain the original design, neckline, sleeves, prints and jewelry, naturally refitted to the replacement physique. Do not copy clothing from identity references.'
      : zh ? ` 服装和服装配饰只来自${outfit}。准确保留款式、颜色、图案、材质、领口、袖子和覆盖范围，按<image2>的身体比例和<image1>的姿势自然穿着。不要复制服装模特的脸、体型、姿势或背景。` : ` Outfit and outfit accessories come only from ${outfit}. Preserve design, colors, patterns, fabrics, neckline, sleeves and coverage, fitted to <image2>’s physique in <image1>’s pose. Never copy a clothing model’s face, anatomy, pose or background.`;
  }
  const extra = settings.prompt.trim();
  return [task, scene, texture, zh ? '保持目标图像的纵横比与构图。不要输出拼贴、人物设定表或添加无关元素。' : 'Preserve the target aspect ratio and composition. Do not output a collage, character sheet or unrelated elements.', extra ? (zh ? '以下用户补充要求优先于上述默认要求，只覆盖明确冲突的部分：\n' : 'Additional user instructions take priority over conflicting defaults; preserve all unrelated requirements:\n') + extra : ''].filter(Boolean).join('\n\n');
}
