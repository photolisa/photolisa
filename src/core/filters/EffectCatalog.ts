/** Shared UI and processor schema. Numeric color values use packed 24-bit sRGB. */
export interface EffectControl { key: string; label: string; min: number; max: number; step: number; value: number; color?: boolean }
const n = (key: string, label: string, min: number, max: number, value: number, step = 0.01): EffectControl => ({ key, label, min, max, value, step })
const color = (key: string, label: string, value: number): EffectControl => ({ ...n(key, label, 0, 0xffffff, value, 1), color: true })
const amount = (value = 0.5) => n('amount', 'Amount', 0, 1, value)
const radius = (value = 5) => n('radius', 'Radius (px)', 0, 50, value, 0.5)
const center = [n('centerX', 'Center X', 0, 1, 0.5), n('centerY', 'Center Y', 0, 1, 0.5)]
export const EXTENDED_EFFECTS = {
  'gamma': { label: 'Gamma', category: 'Basic Adjustments', controls: [n('gamma', 'Gamma', 0.1, 5, 1)] },
  'tone-range': { label: 'Highlights / Shadows', category: 'Basic Adjustments', controls: [n('highlights', 'Highlights', -1, 1, 0), n('shadows', 'Shadows', -1, 1, 0)] },
  'whites-blacks': { label: 'Whites / Blacks', category: 'Basic Adjustments', controls: [n('whites', 'Whites', -1, 1, 0), n('blacks', 'Blacks', -1, 1, 0)] },
  'tint': { label: 'Tint', category: 'Basic Adjustments', controls: [n('amount', 'Green / Magenta', -1, 1, 0)] },
  'vibrance': { label: 'Vibrance', category: 'Basic Adjustments', controls: [n('amount', 'Vibrance', -1, 1, 0)] },
  'color-balance': { label: 'Color Balance', category: 'Basic Adjustments', controls: [n('red', 'Cyan / Red', -1, 1, 0), n('green', 'Magenta / Green', -1, 1, 0), n('blue', 'Yellow / Blue', -1, 1, 0)] },
  'clarity': { label: 'Clarity / Texture', category: 'Basic Adjustments', controls: [n('clarity', 'Clarity', -1, 1, 0.25), n('texture', 'Texture', -1, 1, 0.1)] },
  'unsharp-mask': { label: 'Unsharp Mask', category: 'Basic Adjustments', controls: [n('amount', 'Amount', 0, 3, 1), radius(3), n('threshold', 'Threshold', 0, 100, 2, 1)] },
  'box-blur': { label: 'Box Blur', category: 'Blur Effects', controls: [radius()] },
  'motion-blur': { label: 'Motion Blur', category: 'Blur Effects', controls: [n('distance', 'Distance (px)', 0, 100, 15, 1), n('angle', 'Angle', -180, 180, 0, 1)] },
  'radial-blur': { label: 'Radial Blur', category: 'Blur Effects', controls: [n('angle', 'Spin angle', 0, 45, 8, 0.5), ...center] },
  'zoom-blur': { label: 'Zoom Blur', category: 'Blur Effects', controls: [amount(0.15), ...center] },
  'lens-blur': { label: 'Lens Blur', category: 'Blur Effects', controls: [radius(8), n('blades', 'Aperture blades', 3, 9, 6, 1)] },
  'tilt-shift': { label: 'Tilt-Shift', category: 'Blur Effects', controls: [radius(12), n('position', 'Focus position', 0, 1, 0.5), n('width', 'Focus width', 0, 1, 0.2), n('angle', 'Angle', -180, 180, 0, 1)] },
  'surface-blur': { label: 'Surface Blur', category: 'Blur Effects', controls: [n('radius', 'Radius (px)', 0, 10, 3, 1), n('threshold', 'Edge threshold', 1, 100, 20, 1)] },
  'oil-painting': { label: 'Oil Painting', category: 'Artistic Effects', controls: [n('radius', 'Brush size', 1, 8, 3, 1), n('levels', 'Intensity levels', 4, 32, 12, 1)] },
  'watercolor': { label: 'Watercolor', category: 'Artistic Effects', controls: [n('radius', 'Wash radius', 1, 10, 3, 1), n('levels', 'Pigment levels', 3, 32, 12, 1)] },
  'pencil-sketch': { label: 'Pencil Sketch', category: 'Artistic Effects', controls: [radius(6), n('contrast', 'Contrast', 0.5, 3, 1.2)] },
  'cartoon': { label: 'Cartoon', category: 'Artistic Effects', controls: [n('levels', 'Color levels', 2, 16, 6, 1), n('edges', 'Ink strength', 0, 4, 1.5)] },
  'posterize': { label: 'Posterize', category: 'Artistic Effects', controls: [n('levels', 'Levels', 2, 32, 6, 1)] },
  'pixelate': { label: 'Pixelate / Mosaic', category: 'Artistic Effects', controls: [n('size', 'Cell size (px)', 1, 128, 12, 1)] },
  'emboss': { label: 'Emboss', category: 'Artistic Effects', controls: [n('amount', 'Depth', 0, 5, 1), n('angle', 'Light angle', -180, 180, 45, 1)] },
  'halftone': { label: 'Halftone', category: 'Artistic Effects', controls: [n('size', 'Dot spacing', 2, 32, 8, 1), n('angle', 'Angle', -180, 180, 30, 1)] },
  'comic-book': { label: 'Comic Book', category: 'Artistic Effects', controls: [n('levels', 'Color levels', 2, 16, 5, 1), n('edges', 'Ink strength', 0, 4, 2), n('size', 'Dot spacing', 2, 20, 5, 1)] },
  'glitch': { label: 'Glitch', category: 'Artistic Effects', controls: [n('amount', 'Displacement (px)', 0, 100, 15, 1), n('seed', 'Seed', 1, 9999, 42, 1)] },
  'vintage': { label: 'Vintage', category: 'Color Effects', controls: [amount(0.7)] },
  'duotone': { label: 'Duotone', category: 'Color Effects', controls: [color('dark', 'Shadows', 0x19204e), color('light', 'Highlights', 0xffc779)] },
  'gradient-map': { label: 'Gradient Map', category: 'Color Effects', controls: [color('dark', 'Shadows', 0x301060), color('mid', 'Midtones', 0xde6262), color('light', 'Highlights', 0xfff0b0)] },
  'color-lookup': { label: 'Color Lookup (LUT)', category: 'Color Effects', controls: [amount(1)] },
  'threshold': { label: 'Threshold', category: 'Color Effects', controls: [n('level', 'Threshold', 0, 255, 128, 1)] },
  'solarize': { label: 'Solarize', category: 'Color Effects', controls: [n('level', 'Threshold', 0, 255, 128, 1)] },
  'selective-color': { label: 'Selective Color', category: 'Color Effects', controls: [n('hue', 'Target hue', 0, 360, 0, 1), n('range', 'Hue range', 5, 180, 45, 1), n('cyan', 'Cyan', -1, 1, 0), n('magenta', 'Magenta', -1, 1, 0), n('yellow', 'Yellow', -1, 1, 0), n('black', 'Black', -1, 1, 0)] },
  'liquify': { label: 'Liquify', category: 'Distortion Effects', controls: [...center, n('radius', 'Brush radius', 0.02, 1, 0.3), n('dx', 'Horizontal push', -0.5, 0.5, 0.1), n('dy', 'Vertical push', -0.5, 0.5, 0)] },
  'wave': { label: 'Wave', category: 'Distortion Effects', controls: [n('amount', 'Amplitude (px)', 0, 100, 10, 1), n('length', 'Wavelength (px)', 2, 500, 80, 1)] },
  'ripple': { label: 'Ripple', category: 'Distortion Effects', controls: [n('amount', 'Amplitude (px)', 0, 50, 8, 0.5), n('length', 'Wavelength (px)', 2, 300, 40, 1), ...center] },
  'twirl': { label: 'Twirl', category: 'Distortion Effects', controls: [n('angle', 'Angle', -360, 360, 90, 1), ...center] },
  'spherize': { label: 'Spherize', category: 'Distortion Effects', controls: [n('amount', 'Amount', -1, 1, 0.5), ...center] },
  'pinch': { label: 'Pinch', category: 'Distortion Effects', controls: [n('amount', 'Amount', -1, 1, 0.5), ...center] },
  'perspective-warp': { label: 'Perspective Warp', category: 'Distortion Effects', controls: [n('horizontal', 'Horizontal', -0.8, 0.8, 0.1), n('vertical', 'Vertical', -0.8, 0.8, 0)] },
  'lens-distortion': { label: 'Lens Distortion', category: 'Distortion Effects', controls: [n('amount', 'Barrel / Pincushion', -0.8, 0.8, 0.2), ...center] },
  'vignette': { label: 'Vignette', category: 'Lighting & Film', controls: [n('amount', 'Amount', -1, 1, 0.5), n('roundness', 'Roundness', 0.2, 2, 1), n('feather', 'Feather', 0.05, 1, 0.6), ...center] },
  'film-grain': { label: 'Film Grain', category: 'Lighting & Film', controls: [n('amount', 'Amount', 0, 1, 0.12), n('size', 'Grain size (px)', 1, 8, 1, 1), n('seed', 'Seed', 1, 9999, 42, 1)] },
  'noise': { label: 'Noise', category: 'Lighting & Film', controls: [amount(0.1), n('colored', 'Color noise', 0, 1, 1, 1), n('seed', 'Seed', 1, 9999, 42, 1)] },
  'glow': { label: 'Glow / Bloom', category: 'Lighting & Film', controls: [radius(12), n('threshold', 'Highlight threshold', 0, 1, 0.65), n('amount', 'Intensity', 0, 2, 0.6)] },
  'soft-focus': { label: 'Soft Focus', category: 'Lighting & Film', controls: [radius(8), amount(0.4)] },
  'chromatic-aberration': { label: 'Chromatic Aberration', category: 'Lighting & Film', controls: [n('amount', 'Fringing (px)', 0, 30, 3, 0.5)] },
  'light-leaks': { label: 'Light Leaks', category: 'Lighting & Film', controls: [amount(0.6), color('color', 'Light color', 0xff7020), n('position', 'Position', 0, 1, 0.1)] },
  'lens-flare': { label: 'Lens Flare', category: 'Lighting & Film', controls: [amount(0.7), ...center, n('radius', 'Flare size', 0.01, 0.5, 0.12)] },
  'film-fade': { label: 'Film Fade', category: 'Lighting & Film', controls: [amount(0.3)] },
} satisfies Record<string, { label: string; category: string; controls: EffectControl[] }>
export type ExtendedEffectKind = keyof typeof EXTENDED_EFFECTS
export type ExtendedParameters = Record<ExtendedEffectKind, Record<string, number>>
export const EFFECT_CATEGORIES = ['Basic Adjustments', 'Blur Effects', 'Artistic Effects', 'Color Effects', 'Distortion Effects', 'Lighting & Film'] as const
