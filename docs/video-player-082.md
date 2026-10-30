# Video playback 0.8.2

## Findings and scope

Baseline: a29b5580af1df6781e9112dea592f7b750e78d6f. Android's `media-src blob:` rejects its HTTPS appassets attachment URLs. The old Range implementation maps unsatisfiable ranges to 404 and incorrectly accepts a zero-byte suffix. Release WebView has no custom fullscreen handler. The Web player reports a successful attachment read even when decoding fails, with no error, stalled or waiting feedback. Downloaded Web attachment Blobs have no MIME type; generic MIME video imports are not recognized inline. These are verified code defects; no user's original failing video has been supplied, so the codec responsible for any particular Web black screen remains unknown.

The existing WebView media engine is retained in this focused release. A new native Media3 bridge, permissions path and dual presentation lifecycle cannot be device-validated here. Media3 container support can help some files, but hardware/platform codecs still determine decoding support. This release fixes the known resource blockers and reports unsupported codecs. It does not claim universal HEVC, MOV, MKV or AVI support. HLS.js is not useful for these original local files.

## Implementation

- `editor/video-player.js`: single HTML5 video element for inline and Fullscreen API, custom Photos-inspired controls, seek, elapsed/remaining time, fullscreen skip controls, speed, volume, auto-hide, accessible labels, decode/network errors, bounded loading and explicit retry/fallback.
- `editor/media-view.js`: lazy video-only controls; image and generic attachment paths remain intact.
- `index.html`: trusted attachment CSP path, typed Blob views, workspace cleanup, shared preview player, PDF-to-video mode cleanup.
- `MainActivity.java`: validated file-backed range streaming (200/206/416), strict reference checks, custom fullscreen view, landscape and restored system UI, back-to-exit and lifecycle pause.
- `AttachmentRange.java`: independent range parsing, no file-sized memory buffer.
- Original bytes, SHA-256 IDs, sync protocol, D1 schema, R2 visibility and application ID unchanged. Existing signing configuration and pinned signing fingerprint remain enforced by release CI.

Visual reference: Apple iOS 26 Photos guide, https://support.apple.com/en-sg/guide/iphone/iph3d267610/26/ios/26 . This is an Easybook approximation, not Apple's proprietary renderer. No invented iOS 27 appearance is claimed.

## Verification

Passed locally in Chromium: synthetic MP4/H.264 and WebM/VP9 decoded video frames, play/pause/resume, seeking, fullscreen enter/exit preserving paused state and position, invalid video decode error and retry, disposal. Fixtures are generated test patterns without private content. Attachment protocol tests cover round-trip integrity, authentication, workspace isolation, idempotent retry and limits. Existing media regression covers image, PDF fallback, text and sync states.

Android unit/build/signature results and production checks must be read from the release workflows. Real Android hardware playback, manufacturer WebView variations, HEVC/HDR/MOV decoding, device rotation/system bars, and physical-device install/upgrade are not verified by desktop Chromium or compilation. Existing file streaming supports the 1 GB local cap; real-device 1 GB seek and memory behavior remain unverified.

The one-time release publisher was retired after the authorized release completed. Current releases are created only through an explicit manual dispatch of the Android release workflow.
