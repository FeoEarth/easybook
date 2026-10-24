package com.feoearth.easybook.glass;

/** One deliberately restrained material, in dp. No production controls use it yet. */
public final class GlassMaterial {
    private GlassMaterial() {}
    public static final float CORNER=25f, BLUR=8f, EDGE=14f, REFRACTION=9f;
    public static final float DISPERSION=.18f, SATURATION=1.15f;
    public static final int LIGHT_TINT=0x1affffff, DARK_TINT=0x3016161c;
}
