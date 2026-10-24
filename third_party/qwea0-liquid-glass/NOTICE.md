# QWEA0 Liquid Glass Android

Source: https://github.com/QWEA0/Liquid-Glass-Android
Pinned revision: 16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d (MIT).

`native-glass/liquid-glass.agsl` ports the LENS_AGSL in GlassLensRenderer.kt.
GlassSurface adapts its RenderNode → GPU blur → lens pipeline, safe sample bounds,
press/touch uniforms and cached RenderEffect lifecycle to Easybook Java Views.
The press animation follows LiquidGlassView.kt. No upstream CPU/bitmap fallback,
NDK, Compose or Android 16-only RuntimeColorFilter is shipped.

The former Apache shader has been replaced, rather than kept as a parallel renderer.
Historical attribution for the initial integration remains in third_party/liquidglass.
