# Android runtime licensing

`runtime-dependencies.json` is generated from the **resolved** Android Gradle
`releaseRuntimeClasspath`. It is not an approximation based on declared direct
dependencies. Generate it with:

```sh
gradle -I scripts/android-runtime-artifacts.gradle :app:exportLicenseRuntimeArtifacts --no-daemon
node scripts/generate-android-license-manifest.mjs
node scripts/generate-third-party-licenses.mjs
```

AndroidX, Kotlin, and other Apache-2.0 modules use the canonical Apache 2.0
license text already retained in `third_party/pdfjs/LICENSE`. Google Play
Services modules reference the proprietary Android SDK License terms at the
official URL published in their Maven POMs. Those terms are **not** an
open-source license and are not misrepresented as Apache-2.0.

The checked-in manifest preserves the exact resolved versions. The generated
third-party inventory includes the relevant full open-source licenses and the
official terms link for proprietary SDK modules.
