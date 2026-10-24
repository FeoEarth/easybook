package com.feoearth.easybook.glass;

/** Shared QWEA0 lens material. Dimensions in dp; colors straight-alpha ARGB. */
public final class GlassMaterial {
    private GlassMaterial() {}
    public static final float CORNER=26f, BLUR=6f, EDGE=18f, REFRACTION=14f;
    public static final float DISPERSION=.075f, SATURATION=1.12f;
    public static final int LIGHT_TINT=0x10ffffff, DARK_TINT=0x2813131b;
    public static final int OPEN_MS=230, CLOSE_MS=160, PRESS_MS=180, RELEASE_MS=320;
}
