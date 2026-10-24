# Android native Liquid Glass prototype

Branch: `prototype-native-liquid-glass` (merged per explicit user instruction). Release versionCode25 enables the native More menu on API33+, retaining the Web menu fallback on lower APIs or failed shader setup. No Worker, schema, protocol, folder ordering or editor changes.

## Source inspection (2026-10-24)

| Candidate | Pinned revision / maintenance | Actual source findings | Decision |
| --- | --- | --- | --- |
| QWEA0/Liquid-Glass-Android | `16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d`, last commit 2026-09-29; MIT | `liquidglass/build.gradle.kts`: min24, compile36, NDK27, ARM32/64 filters. `GlassLensRenderer.kt` has API33 RuntimeShader/RenderNode sampling; other paths allocate/process Bitmaps. `LiquidGlassView.kt` explicitly warns that WebView needs a hardware layer to avoid a double-functor redraw loop. | Useful WebView-specific warning; importing the whole library adds API36/native build requirements outside this minimal experiment. |
| Abdullajon1881/LiquidGlass | `72ad05c49628ea2270116b2943629cd81c0cc496`, last commit 2026-06-13; Apache-2.0 | Independent View module: min21, compile35, JVM17. `BackdropRecorder.kt` records normal hardware dispatch into RenderNode. `GlassViewRenderer.kt`: API33 AGSL, API31 blur, API29 scrim. `LiquidGlassShaders.kt` samples displaced RGB coordinates; it implements actual refraction rather than tint alone. Source does not establish WebView compatibility. | Selected shader. Resolve Kotlin uniform interpolation into an attributed AGSL asset, with a small Java adapter; no new framework or binary dependency. |
| Kyant0/AndroidLiquidGlass | `65ab177e90e5c1d8c62e70cf7755841982da65f6`, kmp branch, last commit 2026-08-26; Apache-2.0 | Current `backdrop/build.gradle.kts`: Compose Multiplatform, compile37, min21. Android RuntimeShader effect is gated at API33. Content recording is Compose-based, not a drop-in classic View provider. | Not selected for an existing Java/WebView host. |

Source links: [QWEA](https://github.com/QWEA0/Liquid-Glass-Android/tree/16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d), [Abdullajon](https://github.com/Abdullajon1881/LiquidGlass/tree/72ad05c49628ea2270116b2943629cd81c0cc496), [Kyant](https://github.com/Kyant0/AndroidLiquidGlass/tree/65ab177e90e5c1d8c62e70cf7755841982da65f6).

The selected Apache license and source attribution live in `third_party/liquidglass/`. This is a scoped Java adaptation of the shader/provider technique, not an unmodified integration of every library tier. Licenses were read, not inferred from README badges.

## Prototype boundaries

- Enable with `gradle :app:assembleDebug -PnativeGlassPrototype`. The original prototype hard-coded release off; the user subsequently explicitly requested merge/release without more tests, so versionCode25 enables it. API<33, power saver, unsupported shader and unsuitable bounds use the existing Web menu.
- Only the list More menu is intercepted. Editor, long-press, Aa and bottom controls retain their existing implementation. No separate reading mode.
- Native UI is a sibling above a dedicated hardware WebView backdrop, not a child of the sampled subtree. WebView hardware-layer caching avoids executing its drawing functor twice with different transforms.
- A coalesced, menu-only DOM/load notification and native WebView scroll listener invalidate the GPU layer when content changes. This hybrid is necessary because the first emulator probe found a stale hardware-layer backdrop after DOM updates. There is no clock-driven refresh loop; arbitrary compositor-only video/canvas animation is not yet validated.
- The backdrop records only during normal invalidation while a menu is visible; it releases its display list on close. No polling capture loop, `PixelCopy`, software Canvas capture, Bitmap conversion, or GPU-to-CPU readback is used by rendering.
- The GPU chain blurs/saturates input, displaces samples within an SDF rim, splits RGB sample coordinates and adds specular edges. Tint alpha is kept low. One `GlassMaterial` holds parameters.
- The native bridge remains restricted to the exact local origin/main frame/document generation; it only accepts bounded geometry, theme, layout and sort enums. It never changes SQL, keys, document payloads or sync.
- Outside tap, Android back, page reload/pause and layout/IME changes dismiss the overlay. Native actions invoke existing allowlisted DOM controls. Shader setup failure returns to the Web menu.

## Evidence and acceptance gate

The targeted CI builds debug and instrumentation APKs only, then boots one fresh emulator for API26 and API35. It does not run the unrelated regression or release/deployment pipelines. Emulator boot failure is an environment block, not evidence that the rendering works.

API35 captures compare identical WebView stripes with zero and nonzero refraction, then change the HTML backdrop while the menu stays open. This detects stale/black sampling and proves that changing the refraction parameter changes real sampled pixels. A separate idle-recording counter checks for an obvious self-invalidating loop; programmatic scrolling checks provider refresh. Sorting, back, selection, checklist and a real IME are exercised. Screenshots are actual Android UI screenshots, not generated mockups. Test-only screenshot readback is not the material renderer.

API26 verifies the original Web menu still opens. It does not claim AGSL on older devices. API31/32 retain the same API<33 gate; runtime evidence for these exact versions is not yet available.

GPU driver diversity, physical-device battery/thermal impact and prolonged editing/selection sessions remain unverified even if both emulator jobs pass. Do not roll out beyond this menu or merge merely because Java compilation passes. Review the screenshots and metrics before deciding whether the prototype is acceptable.

First probe (`36675426`): both API builds compiled. API35 rendered a native refracting menu and passed the zero/nonzero edge difference and idle-recording checks, but live-background difference was only 1.096/255 and failed (threshold 8). Actual screenshots show both the WebView hardware layer and sampled material stayed on old red/blue bars after HTML changed to green/yellow. An event-driven invalidation fix is under validation. API26's bundled WebView lacks the app's required message-listener feature and shows its existing update prompt; the initial test harness wrongly assumed a WebView remained attached. Treat this as environment-blocked, not a passing fallback interaction test. No emulator boot retry is needed.

Final tested code: `d0ecc36ce0afd751abd3d0c8b2c9c43880ee5a80`. [API35 run](https://github.com/FeoEarth/easybook/actions/runs/40107482262), [actual screenshots and logs](https://github.com/FeoEarth/easybook/actions/runs/40107482262/artifacts/12564584251). The intermediate follow-up hit a 15-second cold WebView bootstrap timeout; the last run used a bounded 45-second wait and retained diagnostics. No blocked API26 emulator was re-booted.

| Check | Actual result |
| --- | --- |
| Debug and instrumentation Java compilation | Passed, initial API26/API35 jobs and final API35 job |
| Real WebView sampling / live content update | Passed after event-driven GPU invalidation; mean backdrop difference 103.100/255 after bars changed |
| Refraction vs no-refraction | Passed: edge mean difference 12.153/255; independent screenshot inspection found zero difference in an inner control region and outside the menu, while the rims changed |
| Idle feedback loop | 0 backdrop recordings during the 700ms static interval; not a battery benchmark |
| Scroll invalidation | Passed provider-update assertion while native overlay stayed visible |
| Native sorting / select / checklist / Android back | Passed before the final IME assertion |
| Light/dark material | Actual native screenshots captured and inspected; system-bar theme behavior was not part of this fixture |
| Soft keyboard | Failed `real IME visible`: editor had focus and caret, native overlay was closed, but the emulator screenshot showed no keyboard after programmatic focus/show request. Actual keyboard avoidance remains unverified; this is not counted as a pass. |
| API26 | Compilation passed, runtime fallback interaction blocked by the bundled old WebView requiring update. Initial instrumentation crashed when it looked for the replaced WebView; this was a harness error, not a native renderer running on API26. |
| Physical device / API31–33 diversity / thermal and battery | Not verified |

The raw final instrumentation result is retained in `docs/evidence/native-glass-api35-result.json`. The CI conclusion remains **failure**, because the required IME assertion failed. Do not present partial successes as complete validation. The screenshots are emulator UI captures; no image generation or postprocessing was used.

Visual follow-ups before rollout: native icon strokes remain heavier than the Web icons; submenu height/transition needs polish; the current scheme has no assurance for arbitrary compositor-only video/canvas animation. Do not introduce a frame-by-frame bitmap capture workaround.

Current decision: **keep draft, do not merge or expand rollout**. Main retains the current WebView UI. No Cloudflare deployment or formal APK was produced by this prototype phase. The validation job accepts an explicit environment-blocked report to retain diagnostics, but this must never be counted as a functional pass.


## User-directed release decision

After reviewing the partial results, the user explicitly requested merging to main and publishing without additional tests. PR13 was merged; versionCode25 enables the API33+ native menu in release builds. Existing failed/unverified items above are retained and are not reclassified as passes. Only the necessary release compilation, signing verification and deployed-version checks are performed. Future testing should remain minimal and limited to the affected scope; no automatic emulator/full-regression runs for routine UI changes.
