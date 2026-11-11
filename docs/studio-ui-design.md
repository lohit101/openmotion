# Recast UI direction

Redesign of the existing React/Vite creator workspace. Preserve workflows, saved inputs/settings, media, downloads and GPU controls. The user's direction overrides the existing lime palette: black/white, compact controls, precise spacing and useful hints, with a full mobile layout.

Taste reading: DESIGN_VARIANCE 3 (stable product layouts), MOTION_INTENSITY 3 (responsive feedback), VISUAL_DENSITY 6 (compact controls with readable text). The taste skill explicitly excludes dense product UI; its audit, typography, color and motion principles are applicable, while product components follow shadcn/Radix patterns. No marketing-page, hero or scroll-animation patterns apply here.

## Audit

- Existing foundation: React/Vite, self-hosted Geist Variable, Phosphor icons, Radix Select/Switch/Dialog/Tooltip, Sonner and plain CSS. Preserve the framework, font, icons and accessible primitives.
- Current neutrals mix blue/green tints; lime colors are repeated in controls, status and selected states. Replace with semantic monochrome tokens and separate success/warning/error colors.
- Controls and module headings vary between modules. Some metadata is 9px while the Remotion title is 27px. Establish a shared type/size scale rather than shrinking everything.
- Repeated implementation labels, long helper paragraphs and redundant upload actions compete with the task. Move optional explanation to accessible hints; retain billing, errors and consequential action labels.
- Phone layout retains a 60px sidebar and stacks every editor before the preview. Replace this with bottom navigation, a tools sheet, and setup/preview view controls. Keep editor/preview components mounted during pane changes so uploads and processing survive.
- Existing responsive CSS still permits wide download tables, rental card metadata and editor controls to overflow. Reflow secondary content; keep intentional timeline/clip scrolling contained.
- Existing focus indicators, reduced-motion support, touch help, video fullscreen fitting, progress recovery and sidebar preference are functional and must be retained.

## Components and tokens

Use shadcn's owned-component model and semantic tokens with the existing Radix primitives. Adapt product conventions for button variants, ghost badges, fields, tooltips and sheets to the existing CSS stack. These are local CSS components, not an unmodified shadcn/Tailwind install. Sources: [shadcn introduction](https://ui.shadcn.com/docs), [theming](https://ui.shadcn.com/docs/theming), [buttons](https://ui.shadcn.com/docs/components/radix/button), [sheets](https://ui.shadcn.com/docs/components/radix/sheet).

- Neutrals: black canvas, near-black panels, subtle neutral borders, white primary actions; reverse consistently in light mode.
- Color: green for observed readiness/success, amber for attention, red for destructive/error states. No decorative accent fills.
- Shape: 4px controls/chips, 6px surfaces, 8px dialogs; circular switches and media playback controls retain their functional form.
- Type: 13px body/controls, 12px labels/hints, 18-20px workspace titles, weights400/500/600, tabular numeric values. Phone inputs use16px to avoid browser focus zoom.
- Spacing: 4/8/12/16/24px; desktop controls32-36px, phone primary actions44px and navigation52px. Compact secondary icons remain32-36px; fields expand to42px.
- Motion: 120-180ms hover/focus/press feedback and short sheet/menu transitions. Animate transform/opacity; honor reduced motion. No new animation library or continuous decorative motion.
- Layers: workspace0, sidebar10, mobile tabs20, header30, mobile nav35, menus40, overlay50, dialog/sheet51, hints300. Media fullscreen stays above app layers natively.

## Validation plan

Review the real built app with a read-only API fixture: desktop, narrow phone and both themes; navigation/tools sheet, setup/preview switching, fields/dropdowns, progress/empty/error states, Library, GPU/downloads and Clip editor. Check keyboard focus and reduced motion. Run the existing functional suite and type/build checks; compare unchanged workflow/backend files and guard live frontend publication against any backend change. Preserve old assets for open tabs. No GPU action, model download or inference is needed.

## Delivered and verified

- Shared semantic dark/light tokens, owned button/badge/sheet components over existing Radix, compact form controls, neutral selected states and semantic status colors. No dependency, icon-family, font or framework migration.
- Desktop navigation retains its saved collapse preference. Phones use bottom navigation and a Tools sheet. Split modules expose Setup/Preview without conditionally unmounting their panels. Result navigation distinguishes automatic FPS finishing from standalone post-processing.
- Upload replacement/removal controls keep accessible names and hints. Long selected filenames expose their full title. Compact trim summaries stack duration and timestamps. Preview close/reuse icons remain available at narrow widths.
- Library, rental cards, downloads, dialogs and clip-editor controls share the same scale. Downloads become cards on phones; the timeline retains its contained horizontal scrolling. Optional explanation is moved into help; billing, readiness, uncertainty and error information remain available.
- Native Chrome/Brave reviewed desktop1470px, phone393px dark, narrow320px light and tablet768px light layouts. Observed Remotion inputs/footer/empty preview, Imagen references, Library grid/search, GPU filters/retained-instance card, Settings/Downloads rows, the Tools sheet and Clip editor. Escape closed Tools and returned focus to its trigger. Narrow-screen review prompted trim, search, tab, download-heading and timeline-header fixes.
- This is browser device emulation, not a physical-phone/Safari certification. Existing fullscreen media rules remain unchanged; no new fullscreen playback or model-quality claim is made. Reduced-motion overrides are present and statically reviewed, not separately measured in a device run.
- All759 Studio tests pass, including nine result-navigation cases. Final51 focused checks, typecheck and isolated production builds pass. The backend rebuild is byte-identical to the live artifact. Vite retains its chunk-size advisory; no new package was added.
- Frontend-only publication retained all251 previous asset files. The server process remained unchanged;120jobs/124assets, all20 stored settings and both immutable checkpoints were preserved. No workflow, backend, sampler, model/download policy, GPU lifecycle or inference changes were made.

See [the validation receipt](validation/studio-ui-20261111.json). Raw snapshots and preview tooling remain ignored under `.local/studio-ui-20261111/`.
