# Video UI 0.8.3 — Photos and system fullscreen

Baseline: cabb12069c8c73b92f7f7fe2bf49a4482c575607. All five supplied references were inspected: iOS landscape, Photos portrait, Easybook inline, attachment preview, and Easybook landscape.

## Changes

The player measures the decoded video's dimensions and uses that aspect ratio inline. The picture and controls no longer share normal-flow layout. Fullscreen explicitly clears every max-height, aspect-ratio and flex constraint, fills the dynamic viewport, and positions the video absolutely with object-fit: contain. In the checked 844×390 landscape viewport both root and video measure 844×390, with max-height: none. A 16:9 picture occupies 693×390 (the maximum uncropped fit); a 9:16 picture occupies 219×390. Bars required by the source ratio remain. No source cropping, scaling distortion or binary modification is performed.

Portrait uses a small bottom play/pause button, a 4px track with a narrow thumb and elapsed/total time; filename is a separate quiet attachment entry, with MIME/transfer text removed from the picture. Preview uses a black content stage without the previous nested card and keeps save/share/external-open outside the transport. Moving from inline into preview borrows the existing player and preserves position/rate/play state; closing returns the same player to its original node view and pauses it. State-preserving DOM movement is used where available, with append-and-resume fallback for older WebViews.

Fullscreen has top-left close, top-right volume capsule, centered −10/play/+10 and bottom elapsed/remaining timeline plus working speed selection. No unsupported casting, subtitle or audio-track controls are shown. Shared translucent gradients, moderate 12px blur, edge highlights, shadows and press feedback replace the solid gray button fills. Controls fade after inactivity and remain available to keyboard focus. Android retains its WebView playback engine and native custom view, restores orientation/system bars and exits on Back; explicit MATCH_PARENT FrameLayout parameters fill the native host. Predictive Back remains disabled.

## Actual browser evidence

The PNGs under [video-player-083/screenshots](video-player-083/screenshots) are actual Chromium captures of the real editor and attachment dialog using synthetic H.264 test clips, not generated mockups and not a replay of the user's private clip. Frames 01–07 cover inline/preview/fullscreen, paused/playing and visible/hidden controls. Frames 08–10 cover a real 9:16 clip in all three presentations. See [checks.json](video-player-083/checks.json).

Compared with the references, the nested black card and central large inline button are removed; full controls follow the reference's three-layer hierarchy. Fullscreen video now occupies its maximum contain area. Web blur approximates the reference material; Apple's proprietary optical renderer and Photos filmstrip/library actions are not reproduced. Desktop font availability in this capture environment does not verify Android's installed Chinese fonts.

## Validation and limits

Locally passed: H.264 MP4 and VP9 WebM decoded frames; play/pause/resume; seek; fullscreen continuity; single video node through preview/fullscreen; position/rate preserved; bounded skip; speed and volume; auto-hide and tap restore; invalid-codec error/retry; portrait/landscape geometry. Existing media integration and attachment protocol checks pass, including authentication, workspace isolation and byte integrity. Generated HTML/editor artifacts and inline JavaScript syntax pass verification.

Run `CHROME_PATH=<chromium> node scripts/video-player-visual.mjs` to reproduce the screenshots. The same checks run before the existing production deployment candidate is staged. Existing Android release CI builds and verifies the original signing identity. Version is 0.8.3 / code 61. The existing version-gated deployment-success dispatcher now authorizes only this 0.8.3 release through android.yml, with no new release mechanism.

No physical Android device was available. Device-specific WebView codecs, volume policy, cutout/system bars, rotation, gesture Back, installation/upgrade and HEVC/HDR/MOV need device validation. Browser screenshots and a signed build do not establish those results. The user-supplied failing original video was not available as a playable test fixture.
