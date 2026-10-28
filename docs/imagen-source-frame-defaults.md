# Imagen and source-frame preset

The 2026-10-29 default is the user's accepted native result `545ff68d-173f-4acd-98bf-c805f57cea90`. The preset lives in `studio/shared/image-replacement.ts` as `sourceFramePreset`; `sourceFrameImageSettings()` applies it while retaining only the current character's asset-bound body/face view selections.

| Setting | Default |
| --- | --- |
| Model / recipe | Qwen Image 2.1 INT8, native body-only / keep source clothes and accessories |
| Sampling | Official Turbo adapter, 8 steps, Euler / simple, CFG 1 |
| Detail | 1 MP, final dimensions match the original source |
| Mask | Background protected, 64px expansion, 12px feather, fill interior gaps |
| Seed | `1583893113`, randomization off |
| Additional stages | Head/body/outfit adapters, Union, relighting and local identity off |

The default prompt gives the source control of pose, composition, lighting, clothing and accessories; the body reference controls physique, and the face reference controls identity/hair. One clear front body view and front facial view were used in the accepted run. Those selections remain in the user's local draft. Another character must select views from its own assets: a global preset never copies the accepted character's private asset IDs or crops onto unrelated references.

New Imagen drafts and selecting **Body only · keep source clothes** use this preset. Opening/extracting a known video source frame in Imagen also applies it, so frames prepared from different segment timestamps use the same recipe and fixed seed. The new target clears its old mask; a previous frame's mask is never silently applied to another frame. Reusing a historical run explicitly retains its recorded settings instead of migrating paid conditioning. Switching to another recipe does not carry over the default body-only clothing instructions.

Automatic Qwen repainting within Remotion's segment execution is not implemented by this default change. The existing video runner still follows its recorded previous-frame/reference and motion-anchor contract; the old automatic preparation option remains Klein and is disabled when its weights are missing. The user was asked whether to implement automatic Qwen segment repainting now or retain the preset for that later integration. Do not claim per-segment photo inference is running until that integration exists.

No models download on selection, refresh or Generate. This native preset requires the three Qwen core files and official Turbo adapter only. Same settings/seed reduce unnecessary variation; they do not guarantee identical appearance for different poses, lighting, occlusion or hardware.

Validation: 72 focused Studio tests passed after the default change; the 33 image/progress/variant checks were repeated after recipe-specific default-prompt normalization. The production build passed, and all 15 compared paid photo graphs remain unchanged. Offline browser inspection confirmed selected body/face views, the accepted native method, standard resolution, disabled generation without a GPU and no horizontal overflow. Browser draft writes were intercepted during that inspection. No GPU inference or model transfer was required for this change. See the earlier [head comparison and accepted result](validation/body-only-head-detail-20261029.md).
