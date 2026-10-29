# Face continuity research — historical pause

The user explicitly resumed on 2026-10-30. Continue with
[the complete-overlap evaluation](encoded-overlap-20261030.md); the following
records the earlier pause and rejected comparisons.

The user paused this task before putting the Mac to sleep. Do not resume compute,
download models or submit another paid comparison until they say to continue.
The active goal is unfinished. All four complete GPU comparisons below were
rejected by the user because the face still visibly cuts at the segment join.
No experimental blending, geometry warp or new face recipe was enabled in the app.

## Preserved baseline and evidence

The accepted nine-second parent is `a8ef4b97-7512-443d-b2b9-41321d6367ec`.
Its finished video had been moved to `/Users/lohit/Desktop/final.mp4`; an identical,
SHA256-verified copy was restored to its original Library output path. Neither
the Desktop original nor the raw animation was changed. See the sanitized
[validation receipt](validation/face-continuity-research-20261029.json).

The later-reference anchor is source frame 45. The forward branch's second
window starts at frame 51, discards 73 overlapping frames and adds 47 frames.
The visible parent handoff is frame 169, or 7.0417 seconds. This is about
5.17 seconds after the later-reference anchor, not parent time 5.17 seconds.

Private media, graphs, inputs, receipts and prototypes are saved under ignored
`backups/temporal-face-20261029/` and `.local/`. Do not publish them to Git.

## Completed comparisons

Thirteen local video variants covered six/twelve-frame propagation,
forward/backward-flow confidence, detail, color, Poisson and multiband blending.
Twelve-frame one-sided propagation visibly smeared eyes/mouth. Shorter gated
propagation looked less disruptive in samples but is not a quality pass.

GPU still probes compared dynamic target appearance, fixed appearance with
target/source pose, and fixed canonical geometry. Fixed appearance looked flatter
and is not selected. The separate GPU finishing experiments retained the existing
upstream checks, fixed prepared-frame donor, PerformRecast and 60% Hyperswap blend.

One new native window captured predictions normally discarded by trimming.
The original 169 accepted parent frames and the existing paid Imagen repaint were
reused explicitly. Original motion, seeds, context tensor payload and repaint
pixels were preserved; native phase-aligned YUV frame hashes were checked before
submission. OpenCV BGR hashes differ across these local/Linux decoder builds and
were not substituted for that native frame-hash contract.

The A100 40 GB native window took 262.837 seconds, or 264.297 seconds from request
to observed history. It generated 120 native frames and accepted 47 new frames;
this is not a new nine-second inference benchmark. The grouped four-way finishing
batch took 213.959 seconds with shared inference, not four independent production
latencies. All four final videos contain exactly 216 frames at 24 fps and passed
local output SHA256 checks:

- `cut-v1.mp4`: prior finishing, hard join.
- `cut-scene.mp4`: bounded color/detail correction, inward edge falloff and native
  residual compositing, hard join.
- `overlap6-scene.mp4`: matched overlap faces blended before facial correction.
- `overlap12-scene.mp4`: twelve-frame version.

The user reviewed these and said all still look like a hard cut. Six-frame raw
face morphing can also create a jaw/hair edge artifact. Do not ship this as fixed.
Three later CPU geometry previews (`geometry4/6/10-scene.mp4`) remain unreviewed;
their experimental TPS calculation emitted numerical warnings and needs finite
field / deformation checks before any use. They are not product defaults.

The private review page is `http://127.0.0.1:3010/final-review.html`. The local
Python HTTP server can be restarted with the private folder as its document root.
The first review harness was corrected to wait for seeking before playing ended
videos. Do not confuse that playback issue with the actual visible video cut.

## Next comparison and the latest user proposal

A previous-actual-frame continuation was prepared to test whether Imagen's new
head angle is redundant now that the final identity/expression pass exists. Its
plan/graph are `natural-plan.json` and `natural-workflow.json`; the exact prior
context payload would be rebound under a new comparison ID. The A100 could not
resume: Vast reported required resources unavailable. Compute was subsequently
confirmed stopped. `natural-staged.json` does not exist, no natural-continuation
prompt was submitted, and no inference from that comparison should be reported.

The user's latest proposal is more specific: repaint only the inner face from
the character reference during segment refresh, leaving the head outline, hair,
ears, neck and other pixels untouched. Standalone Imagen should keep its current
independent behavior. Current `segment_repaint.face_scope` is nominally facial,
but uses ellipse radii 0.78× face-box width and 0.85× face-box height, centered at
0.40× height. That includes generous hairline/jaw margins. Test a tighter scope,
explicit pose/expression retention and scene integration. Do not claim that a
smaller output mask alone forces Qwen to preserve internal pose/feature geometry.

Start by recompositing the already-paid repaint against `repaint_0001/target.png`
under a tighter mask, optionally registering its facial placement. This can expose
mask spill without a new image inference or model transfer. Preserve that paid
repaint and all original scope masks. Compare before paying for another video.

## Research leads

- [FaceFusion face masking](https://docs.facefusion.io/usage/cli-arguments/face-masker)
  distinguishes region, occlusion and edge controls. More sharpening is not a
  substitute for correct alignment/masks.
- [PerformRecast](https://github.com/youku-aigc/PerformRecast) separates expression
  from pose; our target-driven canonical anatomy/appearance can still carry a
  changed Viggle face into finishing. Fixed appearance probes were insufficient.
- [FastBlend](https://github.com/Artiprocher/sd-webui-fastblend) motivates aligned
  temporal blending and warns about excessive smoothing. Its examples/timing do
  not validate a drop-in solution for this footage.
- [Video Face Replacement](https://www.kalyans.org/research/2012/VideoFaceReplace_SIGA11.pdf)
  uses geometric alignment and spatiotemporal/gradient-domain compositing.
- [VK Vigglorious Studio](https://github.com/Tablaski/VK-Vigglorious-Studio) describes
  per-chunk reference/guidance experiments, not a guaranteed continuity fix.
- The upstream [Viggle loop implementation](https://github.com/Saganaki22/ComfyUI-Viggle-Animate-H3/blob/main/loop_nodes.py)
  distinguishes latent overlap from five decoded-frame anchors. Our current
  saved jobs retain their exact five-frame/version/range contracts.

## GPU and repository handoff

The empty 4090 rental failed Docker/OCI CDI device injection before installation;
its deletion was independently confirmed. `80f508a` adds that explicit failure to
the existing guarded empty-rental cleanup, with 96 cloud tests passing. It never
deletes an installed disk on a later failure.

`b28912e` refreshes Hugging Face resolver redirects while preserving pinned paths,
partials, Range checks and SHA256. One slow 358 MB transfer resumed its remaining
308 MB in roughly seven seconds after this resolver refresh; 25 offline tools
tests passed. Both fixes are pushed. The running compiled Studio server has not
yet been rebuilt/reloaded for the cloud TypeScript fix; do that safely when work
resumes. Python model downloads already used the updated helper.

The retained A100 rental `58262888` has the four Viggle files plus twelve facial
files, about 30.20 GB of weights. No Qwen stack was downloaded onto this disk in
this task. Fresh Qwen inference would need its explicit stack/space/transfer
preflight. Known model ingress at $0.004/GB is approximately 12.08 cents, excluding
packages, duplicated temporary transfers, media, compute and retained storage;
this is not an invoice or whole-task cost.

At handoff, all managed compute is independently confirmed stopped, there are no
queued/running Studio jobs or model transfers, and the five-minute idle preference
is restored. The retained disk remains billed; it was not destroyed. Full private
cloud/inventory snapshots are saved in `pause-state-private.json`.
