import type { Graph } from '../shared/types';
import { suffixRunName } from '../vendor/openjutsu/lib/simple';

// Private evaluation profiles, frozen independently of prodv1. A missing
// profile never changes an existing graph. These guide generation; they do
// not claim exact-pixel preservation or paste source foreground into output.
export type InteractionGuide = 'reference-interactions-v1' | 'aligned-interactions-v1' | 'aligned-interactions-v2';

const interactionShots = '\nDescribe incoming hands, other people and moving objects, including where they enter and leave, what they touch, and when they cover or reveal <Subject 1>. Keep the subject assignments above even when another person becomes larger or crosses the camera. Describe back turns and off-screen intervals literally; never invent a visible face behind an occluder. Omit source clothing, identity and static scenery. Do not omit an interaction because it is absent from the picture.';

export function applySourceInteractions(graph: Graph, profile: InteractionGuide): Graph {
  if (profile !== 'reference-interactions-v1' && profile !== 'aligned-interactions-v1' && profile !== 'aligned-interactions-v2') throw new Error('Unknown interaction guide profile.');
  const out = structuredClone(graph);
  const required = { '11': 'H3PictureSwapPlan', '30': 'MiniMaxH3ReferenceToVideo', '34': 'ImageFromBatch', '43': 'H3ClipShots', '45': 'H3FillShots', '57': 'MiniMaxH3ChainContext', reference_scene_prompt: 'StringConcatenate' };
  for (const [id, type] of Object.entries(required)) if (out[id]?.class_type !== type) throw new Error('Interaction guidance needs the reference-scene OpenJutsu graph.');
  const link = (value: unknown, node: string, slot: number) => Array.isArray(value) && value.length === 2 && value[0] === node && value[1] === slot;
  if (!link(out['57'].inputs.latent, '30', 1) || !link(out['30'].inputs['ref_video_audios.ref_video_audio_0'], '29', 12)) throw new Error('Interaction guidance needs the original empty target and synchronized source audio.');
  if (out.recast_interaction_shots || out.recast_interaction_prompt || out.recast_interaction_guide) throw new Error('An interaction guide is already attached.');

  const continued = profile === 'aligned-interactions-v2';
  const aligned = profile !== 'reference-interactions-v1';
  if (continued && (out['58']?.class_type !== 'BasicGuider' || out['25']?.inputs.scene_continuity !== 'Hard picture + protected audio')) throw new Error('Long interaction guidance needs the protected native segment handoff.');
  const guide = aligned ? 'the aligned source guide' : '<Video 1>';
  // Keep the native planner's per-performer assignments. Replacing its entire
  // shot prompt with a generic "main person" instruction loses that binding.
  out.recast_interaction_shots = { class_type: 'StringConcatenate', inputs: {
    string_a: ['11', 4], string_b: interactionShots, delimiter: '\n',
  }, _meta: { title: 'Performance and incoming interactions' } };
  out['43'].inputs.shot_prompt = ['recast_interaction_shots', 0];
  out.recast_interaction_prompt = { class_type: 'StringConcatenate', inputs: {
    string_a: `motion_transfer:\nsubject_definitions:\n<Subject 1> is the person from <Picture 1>, replacing only the source performer assigned <Subject 1> in the shot list.\n<Picture 1> supplies their face, hair, body, exact outfit, background and lighting.\n${aligned ? 'The aligned source guide' : '<Video 1>'} supplies the complete performance, incoming interactions, camera and timing; it does not supply the replacement identity or static background.\nReference appearance and setting: `,
    string_b: ['4', 0], delimiter: '',
  }, _meta: { title: 'Interaction reference roles' } };
  out.reference_scene_prompt.inputs = { string_a: ['recast_interaction_prompt', 0], string_b:
    `summary:\nTransfer the performance to <Subject 1> in the setting of <Picture 1>.\nretention_analysis:\nKeep the reference identity, proportions, hair, outfit and setting. Keep other people, incoming hands and moving objects from ${guide}, with the same contact and front-to-back order. Do not replace bystanders with the reference character.\ndetailed_description:\n{SHOTS}\nMatch body motion, head turns, gaze, blinks, mouth motion and timing. The same character remains after occlusion or re-entry; a back view stays a back view. Hands and objects in front cover the face; do not draw eyes or lips over them. Replace the source performer's appearance and static scenery; retain the interactions.\noverall_soundscape:\nKeep the original synchronized soundtrack.\nnon_diegetic_music:\nNo additional music.`, delimiter: '\n' };

  if (aligned) {
    // The published Guide Latents route uses Add Guide, not simultaneous
    // native full-video reference tokens. The reference photo stays native.
    delete out['30'].inputs['ref_videos.ref_video_0'];
    delete out['30'].inputs['ref_video_audios.ref_video_audio_0'];
    out.recast_interaction_guide = { class_type: 'MiniMaxH3AddGuide', inputs: {
      positive: [continued ? '57' : '30', 0], latent: continued ? ['57', 3] : ['30', 1], vae: ['20', 0], audio_vae: ['21', 0],
      image: ['34', 0], audio: ['29', 12], frame_idx: 0,
    }, _meta: { title: 'Aligned complete performance guide' } };
    if (continued) {
      // Native context removes guides whose anchors lie in its preserved
      // prefix, including an entire frame-zero performance guide. Attach the
      // current source window AFTER context; its masked target remains the
      // sampler input, so the generated predecessor prefix stays protected.
      out['58'].inputs.conditioning = ['recast_interaction_guide', 0];
    } else out['57'].inputs.conditioning = ['recast_interaction_guide', 0];
  } else {
    // Complete native RGB guide: unlike the neutral mannequin, it does not
    // erase a new hand/object/person before the model can observe it.
    out['30'].inputs['ref_videos.ref_video_0'] = ['34', 0];
  }
  // Studio submissions already have an immutable UUID namespace. Standalone
  // exports also need different cache names for the two conditioning recipes.
  if (!out.recast_run_name) {
    suffixRunName(out, 'recast_interaction_run', continued ? '_interact_align_v2' : aligned ? '_interact_align_v1' : '_interact_ref_v1', 'Interaction comparison run');
    out['67'].inputs.filename = ['recast_interaction_run', 0];
  }
  return out;
}
