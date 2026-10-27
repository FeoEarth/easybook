# Android predictive back — 0.8.1 / versionCode 58

Baseline: main c82e904e73e2f1e998000eb222401f56e9f5bf4f. The existing v0.8.1 Release is published and must not be replaced. Future manual publication retains the workflow's v0.8.1-build<RUN_NUMBER> convention; versionCode is the independent Android upgrade counter.

## Implementation and boundary

MainActivity remains android.app.Activity. A single PRIORITY_DEFAULT callback is registered only while application back navigation is available or unknown/pending. At the folders root it is removed ahead of time, allowing Android's back-to-home/cross-task animation. System IME and dialog windows retain priority. No edge touch recognizer, WebView.canGoBack, Activity.finish fallback, screenshot cache, or Navigation Compose is introduced.

API 26–32 use onBackPressed with the same navigation coordinator. API 33 uses OnBackInvokedCallback (no application progress API). API 34+ uses OnBackAnimationCallback: current content scales and moves slightly with BackEvent progress; cancel restores original transforms; completion executes exactly one frozen target. This is custom progress feedback driven by the official platform API, not a system-provided WebView destination transition. No prior note/workspace snapshot is displayed. Root system previews require the developer option on Android 13–14; Android 15–16 provide system animations without that option. compile/target SDK remain 35; no API 36-only references are used.

The Android-only res/raw/predictive_back.js adapter is injected at the checked startup anchor inside the existing application closure. It sends only a monotonic revision and a canGoBack boolean through the existing origin-scoped, main-frame WebMessageListener. It is UI metadata and cannot invoke a navigation command or grant data access. Key, note ID and dialog identity remain inside JS. No shared HTML, worker source, D1/R2 or production deployment changes are required.

A gesture freezes layer/revision/view identity. Navigation changes invalidate its commit. JS rechecks its local signature before and after saving; workspace and security operations block return. Editor completion flushes rich input and awaits the existing native save pump; save failure leaves the editor open. Cancellation does not invoke JS or save. The existing switchTab persistence check finds no dirty native mutations after that flush. Pending completion tokens prevent rapid duplicate returns, and timeout cancels the old JS navigation without exiting the Activity. Nested folder navigation resolves a current parent in the active workspace. Existing WebView handleBack owns all other internal navigation.

Liquid Glass uses the existing live surface, with its original transform restored before closing. Its shield remains attached during gesture/cancel, preventing touch-through. ConnectionSheet remains FLAG_SECURE and retains busy approval protection. Credential/OAuth/account implementations are unchanged. This establishes compatibility by design and code review, not device acceptance.

## Validation evidence and required device acceptance

Local: `node scripts/predictive-back-test.mjs`, `node scripts/folder-navigation-test.mjs`, `git diff --check` (the container has a Java runtime but no javac/Gradle/Android SDK). Android CI additionally runs BackNavigationStateTest with existing table/account/transport tests and assembles the signed release APK. See the linked PR/run for actual CI result; a successful build is not gesture validation.

No emulator or attached Android device was available in the development container. The user subsequently requested minimal testing; no emulator matrix is scheduled. Do not mark these manual cases passed until observed on devices/emulators:

| Platform | Required checks |
| --- | --- |
| Android 12 or older | Hardware/three-button back, keyboard first, editor save failure, folders root |
| Android 13 | Invoked callback, root system preview with developer option, three-button navigation |
| Android 14 | Progress in both directions, cancel at 25/75%, root preview with developer option |
| Android 15 | Progress/cancel/commit, system root preview, native menus and secure sheets |
| Android 16 | Gesture and three-button navigation, root preview, no legacy callback dependency |

On each applicable platform test rich text/table/attachment edit preservation; folder parent and search/selection; workspace switch/leave/revocation during gesture/save; account/AI/MCP approval busy state; IME showing; rapid repeated back; cancel then touch; background/resume; OAuth return; animation scale zero; light/dark and fast mode. Record screenshots/video only on nonsensitive pages; never disable FLAG_SECURE for verification.

Official references:
- https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
- https://developer.android.com/about/versions/14/features
- https://developer.android.com/about/versions/16/behavior-changes-16
