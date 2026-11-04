# Android minimum compatible version

Easybook publishes `GET /android/version-policy.json` from `easybook-sync`.
The endpoint is public, returns `schema: 1`, and uses `Cache-Control: no-store`.

Cloudflare Worker environment variables:

- `EASYBOOK_ANDROID_MIN_SUPPORTED_CODE`: optional integer `versionCode` floor.
  Unset, invalid, or `0` means no required update. A normal feature/UI update
  must not raise this value.
- `EASYBOOK_ANDROID_MIN_VERSION_REASON`: optional short plain-text reason,
  limited to 200 characters.

The Android app compares `minSupportedVersionCode` with **BuildConfig.VERSION_CODE**,
not the displayed semantic version or Web OTA revision. At launch it checks the
policy without blocking the local app. When the installed build is older, it
opens the native update dialog, shows the requirement, and checks the published
GitHub Release. Users can still access locally stored notes and export backups.
An unavailable or invalid policy never triggers a false required-update dialog.

Safe rollout order:

1. Publish an officially signed APK that supports this policy.
2. Confirm a compatible, higher-`versionCode` signed Release exists and its
   Android upgrade path works on the old signer/new signer configuration.
3. Only then raise the Cloudflare version floor. Avoid setting a floor higher
   than the latest available signed APK.
4. Verify the public endpoint and Android prompt. A Worker configuration change
   may require deployment to apply it.

This release implements **version detection and the user-facing upgrade prompt**.
It does not itself deny old clients at the server API boundary; that requires a
separately coordinated protocol migration, with explicit Web/Android client
identification, safe offline access, and rollback planning. Do not describe the
prompt alone as server-side enforcement.
