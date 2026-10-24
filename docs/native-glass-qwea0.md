# Android Liquid Glass: QWEA0 delivery

This release replaces the production AGSL shader with QWEA0/Liquid-Glass-Android
MIT LENS_AGSL at 16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d. The Java adapter
keeps the existing GlassBackdrop/GlassSurface/GlassMaterial architecture. There
is one production lens pipeline, not two competing renderers.

## Shipped UI

- List More menu and sort submenu: QWEA0 native material.
- Note long-press context actions and editor More actions: shared native rows.
- Attachment insertion menu: existing image/file picker, link and checklist actions.
- Aa paragraph/character/list/indent controls, expandable extras, highlight/text
  palettes: native three-column panel, selected/disabled states and color swatches.
- Add-link dialog: native bounded URL input, existing URL validation and editor action.
- Folder operation/destination menus and note batch-move sheet: shared native rows;
  existing destination navigation, busy state and persistence handlers are reused.

The Android-injected semantic adapter retains the original dialog/selection
lifetime, maps opaque per-panel tokens to existing DOM controls and executes those
handlers after native dismissal. It does not expose arbitrary JS evaluation over
the bridge. Origin, main-frame, generation and input bounds remain enforced.
No JSON, editor, sync, attachment-storage or Worker changes are required.

## QWEA0 technology adopted

RenderNode backdrop recording → GPU RenderEffect blur → SDF lens shader. The
ported shader includes inverse-power bevel refraction, normal-directed RGB
sampling, safe sample clamps, nonlinear vibrancy, paired specular rim/glow,
press-enhanced refraction and local touch bulge. Unified material uses 6dp blur,
18dp bevel, 14dp refraction, restrained .075 dispersion and low-alpha theme tint.
The shader retains QWEA0's second-shape/smooth-union support; cross-control fusion
is not connected in this release. Press/release and opening/closing use Android
animator duration settings. No periodic screenshots, PixelCopy, CPU image pipeline,
Kotlin/Compose migration or NDK dependency is introduced.

## Limits and remaining UI

API33+ and hardware acceleration are required. Power saver, unavailable shader,
unsupported geometry and panels above 96 actions retain the existing Web UI.
The attachment full-screen image viewer, Markdown/data/credential dialogs, top
navigation, bottom formatting toolbar and selection bar keep their existing Web
rendering; their underlying business functions are unchanged. Ordinary notes and
lists remain opaque. The native Aa panel uses a compact grid rather than copying
every DOM layout detail. Actions rebuild an open semantic panel after the close
animation; complex per-frame canvas/video backgrounds are not specially tracked.
GPU model/driver behavior, IME behavior, accessibility and user-perceived visual
quality have not been validated in this phase. URL input is repositioned when the
safe area changes; native menu bounds use the existing Android inset container.

## Delivery policy

User explicitly requested direct merge and APK delivery. No A/B comparison,
prototype, UI automation, instrumentation, emulator, screenshot comparison,
performance benchmark or regression suite was executed. Only APK compilation,
packaging and signature verification are to run through the existing Android
release workflow. Do not interpret historical release-template test wording as
results for this change. The user installs and accepts actual visuals/behavior.
VersionName stays 0.8.0; versionCode advances from 25 to 27 (including the closing-sheet guard follow-up). No Cloudflare deploy.
