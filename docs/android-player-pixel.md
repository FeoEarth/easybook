# Android player reference calibration — work in progress

Baseline: a483cfbd78f33b3f7248952612372cf67fa575fa (0.8.3/code 62). This branch has not passed pixel-equivalence acceptance and must not be described as a completed pixel-perfect reproduction.

## Reference and scope

The supplied landscape reference is a photograph/composite with phone bezel and unsupported TV app actions. Its effective display is approximately 1475×680 pixels, normalized to 874×402 logical units. Those bounds are measured from the supplied raster, not Apple's original design file. Portrait uses the supplied Photos transport and floating navigation reference. Original reference files and the user's attachment content are not committed to the repository.

The scoped Android UI uses the existing HTML5/WebView video element and native fullscreen host. It adds no Media3 migration, native video proxy or playback ownership change. Android first-frame posters use the existing private attachment URL with a poster query, after the same active-workspace reference authorization and original-file check; a scoped app-private JPEG cache never bypasses those checks. Android-only CSS is selected by the existing trusted native bridge. Shared SVG transport icons and bounded player sizing cleanup also apply to Web.

## Geometry model

| Item | 0.8.3 at 874×402 | Calibrated model |
| --- | --- | --- |
| Main play/pause circle | 68 logical px due short-height rule | 88 logical px |
| Skip circle | 52 logical px | 64 logical px |
| Skip-to-play center offset | About 113 logical px | 138 logical px |
| Close button left inset | 24 logical px | 62 logical px |
| Close button diameter | 44 logical px | 44 logical px |
| Volume capsule | Variable, 140px slider | 188×44 logical px |
| Timeline side insets | 32 logical px | 62 logical px |
| Timeline center from bottom | Near lower edge | 85 logical px |
| Timeline track | 4 logical px | 8 logical px |

Dimensions scale from the actual player width divided by 874 in fullscreen, so different Android viewports retain proportions. There is no height-based button shrink. Cutout safe insets take precedence. The video remains a separate absolute contain plane. Portrait gets a floating compact glass transport; Android attachment preview has floating back/title chrome and existing save/share/external-open controls rendered as optical icon buttons. Original controls and labels are restored for image/PDF previews.

The SVG pause bars use rounded corners, ten-second labels use vector strokes (no Android font substitution), and volume uses a filled speaker plus three wave strokes. Glass uses bounded 7px backdrop blur, restrained saturation, shared edge highlights and no full-frame blur. This remains Chromium's material, not Apple's proprietary refractive renderer.

## Verification and release gate

`node scripts/android-player-geometry.mjs` preflights the calibrated geometry at 874×402, 844×390 and 731×411, with a maximum one-physical-pixel deviation from the **model tokens** at DPR 3. This does not establish pixel equivalence to the raster reference, nor does desktop Chromium establish Android rendering.

The existing Native Glass Android workflow has a scoped video-player job for this branch. It builds the actual app and a test-only instrumentation APK on a fresh API35 emulator, imports test fixtures through the real private AttachmentStore, opens the real editor/preview/native fullscreen, captures actual Android PNGs, verifies decoded video frames, fullscreen continuity and native Back restoration, and records WebView version and geometry. The display is set to 1206×2622 at 480dpi (402×874 logical portrait). It creates no production account/workspace and does not publish or change the signing identity used by production.

The test records real geometry separately from screenshot evidence. It must fail on missing screenshots/playback/layout errors; no `environment_blocked` success bypass is accepted. Actual Android screenshots must be inspected before any acceptance claim or release. Physical-device behavior and exact Apple optical shading still require further evidence. Candidate 0.8.4/code 63 is prepared for the user-authorized release. The existing post-deploy listener is gated to that version; merge/publication remain blocked until the actual Android playback/capture sequence passes.

## Android findings during verification

API35/WebView 124 actual captures exposed the focusin-before-click visibility race after auto-hide; visibility is now sampled at pointerdown and the touch regression passes locally. A second Android run reached native fullscreen and recorded an exact 874×402 video/root, 88px main transport, 64px skips, close x=62px and 188×44px volume capsule. Its remaining input step was blocked by Android SystemUI's first-use immersive education dialog, so that run is not a pass. The fresh-emulator setup acknowledges only that system tutorial before the next run. Production behavior is unchanged. Captures also caught attachment icon markup being overwritten by a later label assignment and the chrome SVG rule overriding video icon fills; both are corrected. A decoded paused video no longer enters a false stalled/buffer-timeout error during native fullscreen surface changes. Actual Android final captures remain the acceptance gate.

## Follow-up verification on 2026-10-28

Run 40672828292 (f23ad7b) reached real fullscreen playback, decoded 83 frames, hid controls, and restored portrait through native Back. The measured root and video were both 874×402 with contain fitting; the recovery guard did not trigger. This run still failed to open the portrait attachment preview and is not a full pass. Its portrait capture exposed Android WebView's oversized generic video poster.

The follow-up replaces that poster with a bounded local first frame (longest decoded edge 1280px, JPEG quality 88), retaining the same video element. Unsupported thumbnail extraction falls back transparently to the custom controls without changing original bytes or playback. HTTP responses are no-store; authorization runs before cache access. The poster stays stable for the source lifetime; HTML5 hides it when playback starts, avoiding a poster mutation during the native decoder transition. The current native probe requires a decoded nontrivial poster and checks unreferenced poster requests return 404.

Run 40674979709 (07c5f2e) compiled and passed the signed APK identity, core workspace and media/security jobs, but the emulator stopped at attachment metadata resolution before any player was created. This does not validate the poster change. The next probe preconfigures paused automatic sync through the existing native policy API before launching the isolated test workspace and records worker stacks and pending bridge methods on failure. The UI-based attempt was rejected as busy during startup, with workers already idle; no conclusion about a network worker blockage is supported. No production sync behavior is modified.

The Android video preview no longer animates the entire dialog/video surface. Control fade/press animations remain; the viewer background is opaque black from its first frame. Browser screenshot/behavior regression passes after updating the reveal step to account for mouse-hover control revelation. Android capture remains pending.

The landscape fixture now contains H.264 video and AAC audio, both 32 seconds. Native reports include decoded audio bytes when exposed by WebView. The emulator uses no audio output device: sound quality and perceptual AV synchronization still require physical-device listening.

Run 40677192602 (1afea23) verifies the authorized first-frame poster in an actual Android capture. The preview reports an opaque black background, opacity 1, and no whole-dialog animation. The H.264/AAC sample then raised MEDIA_ERR_DECODE during inline playback; the resulting error layer prevented fullscreen. This is a release blocker. The next diagnostic run uses a continuously encoded Constrained Baseline H.264/AAC fixture, default 1× playback and an audio-enabled emulator, and records MediaError.message plus codec/audio logs. The original cause has not been established; these setup changes are not a production playback fix. Captures now wait two animation frames to avoid recording a prior compositor frame immediately after a DOM transition.

The diagnostic wrapper in run 40678378717 used eval and was rejected by CSP before media testing. It is removed; probe scripts again execute directly through WebView.evaluateJavascript under the unchanged CSP. No audiovisual conclusion is drawn from that run.

Candidate 9f5c60f passed signed Release APK, core workspace and media/security CI; the APK manifest independently confirms version 0.8.4/code 63 and its checksum matches the artifact. Its native probe reports FFmpeg audio-packet decode failure at timestamp 2026666µs. The next probe removes an unnecessary initial seek to zero and, on media failure, hashes the native response, compares three byte ranges, and tests the verified bytes as a raw Blob video. Publication is still blocked while this cause is unresolved.
