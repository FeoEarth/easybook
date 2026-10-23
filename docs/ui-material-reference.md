# Folder presentation reference (0.6.2)

The previous 0.6.1 centered alert was an approximation, not a verified Notes replica.
This revision uses Apple's iOS 26 design principles and official presentation footage:

- Meet Liquid Glass, WWDC25 session 219: https://developer.apple.com/videos/play/wwdc2025/219/
- Build a UIKit app with the new design, WWDC25 session 284, Presentations at 13:31: https://developer.apple.com/videos/play/wwdc2025/284/?time=811
- Current material guidance: https://developer.apple.com/design/human-interface-guidelines/materials

Official footage was downloaded and visually inspected, including rounded form sheets with top cancel/commit controls. Regular material preserves readability with diffuse background color, bright edges and soft depth. Controls inside the sheet use fills rather than nested glass layers. Reduced transparency and reduced motion remain supported.

Scope: the new-folder surface only. Existing navigation fixes, data, native credentials, sync and Worker API are unchanged. Generated web UI stays aligned with Android assets; this commit does not deploy production Cloudflare resources.

Limit: WWDC25 footage establishes the iOS 26 design, but does not establish the exact Notes new-folder layout on the latest iOS 26 patch. Third-party screenshots without a verified OS build are not treated as evidence of that build. Android WebView implements a CSS material approximation; Apple's native adaptive lensing/refraction renderer is not available here. This release must not be described as a pixel-perfect reproduction of the latest Notes.

Validation: client/Worker checks plus Android emulator regression, including folder creation/cancellation/duplicate names, light/dark surfaces, reduced transparency, keyboard bounds, narrow editor navigation, persistence and native security/data checks. Live external sync may be skipped by the existing offline UI test option.
