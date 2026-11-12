# Android runtime licensing

`runtime-dependencies.json` is generated from the **resolved** Android Gradle
`releaseRuntimeClasspath`. It is not an approximation based on declared direct
dependencies. The checked-in snapshot records the most recently resolved
coordinates and POM metadata. Updating attribution text alone does not re-resolve
the dependency graph. To refresh the graph and its POM metadata, run:

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

LiteRT-LM `0.18.0` has two distributed parts. Its Java API is included in the
APK. `app/build.gradle` excludes `liblitertlm_jni.so` from the base APK; the
release workflow extracts the unchanged ARM64 binary from
`litertlm-android-0.18.0.aar` at `jni/arm64-v8a/liblitertlm_jni.so` and publishes
it separately as `Easybook-LiteRT-LM-arm64-v8a.so`. The application downloads
this optional runtime only on user request and verifies the pinned SHA-256:

```text
4a94a3f955ad7c58cbcdfc5cb4ff566187bb9e8c5bc2c4056b4e226646c7e8fd
```

Model weights are separate downloads with their own license terms. The native
runtime asset remains a distributed third-party component even though it is
excluded from the base APK. The license-manifest generator retains this
distribution note for the pinned `0.18.0` artifact.

The pinned [Google Maven POM](https://dl.google.com/dl/android/maven2/com/google/ai/edge/litertlm/litertlm-android/0.18.0/litertlm-android-0.18.0.pom)
declares Apache-2.0. The complete text is retained in
[`../pdfjs/LICENSE`](../pdfjs/LICENSE) and reproduced in `THIRD_PARTY_LICENSES.md`.

The manifest records resolved Maven artifacts and their POM-declared license
metadata. That scope does not establish a complete inventory of libraries
compiled into the native binary or an audit of their individual license and
NOTICE requirements. Embedded native components and upstream NOTICE files must
be reviewed separately when changing the native artifact.
