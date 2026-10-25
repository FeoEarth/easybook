# Sync management UI

The full-screen sync page keeps existing configuration, scope and history operations. Native HTML option models remain hidden and supply every menu option; existing change handlers still persist settings. Setting rows, switches and menus are presentation adapters, not a second sync policy implementation.

History rows show name, operation, timestamp and status. Tapping opens a dedicated detail Sheet. Terminal-record deletion lives in its more menu; batch selection and select-all use the current filter. Running/queued observations are not deletable. Empty error strings never produce a synthetic failure message. Previous failure information is labelled as historical when the latest attempt succeeded.

Android API33+ selectors/actions reuse NativeGlassMenu. Folder scope and task details use a sync-specific FormatGlassFrame instance over the existing GlassBackdrop/GlassSurface, with inert foreground markup and validated click tokens. The foreground WebView blocks network/file/content access. One continuous outer surface uses the existing move material, full geometry and scroll synchronization. Shader, material constants and sampling algorithms are unchanged. Upstream attribution remains QWEA0/Liquid-Glass-Android at 16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d (MIT), as documented in third_party/qwea0-liquid-glass/NOTICE.md; Kyant0 is not substituted.

Web and unsupported/power-saving Android devices retain the same controls and layout with the existing CSS material fallback. This is not claimed as native refraction. Shared Web UI source is index.html; Worker code/generated mirrors are intentionally untouched and production Web is not deployed in this delivery. A future Web publish must regenerate the existing frontend mirrors using the normal build script.

Validation: JavaScript/HTML static parsing, unique IDs, option-model preservation, protected sync implementation comparison, Android compilation/signing/artifact checks. No UI automation, emulator, visual comparison or performance benchmarks. Device interaction, scrolling, theme and visual acceptance remain unverified.
