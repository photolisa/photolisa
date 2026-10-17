import { EXTENDED_EFFECTS, type EffectControl, type ExtendedEffectKind } from '../core/filters/EffectCatalog'
import type { AdjustmentKind } from '../core/filters/types'
const n = (key: string, label: string, min: number, max: number, value: number, step = 0.01): EffectControl => ({ key, label, min, max, value, step })
const LEGACY: Partial<Record<AdjustmentKind, EffectControl[]>> = {
  'brightness-contrast': [n('brightness', 'Brightness', -1, 1, 0), n('contrast', 'Contrast', -1, 1, 0)],
  exposure: [n('stops', 'Exposure', -5, 5, 0, 0.05)],
  saturation: [n('amount', 'Saturation', -1, 1, 0)],
  hue: [n('degrees', 'Hue', -180, 180, 0, 1)],
  temperature: [n('amount', 'Temperature', -1, 1, 0)],
  grayscale: [n('amount', 'Amount', 0, 1, 1)], sepia: [n('amount', 'Amount', 0, 1, 1)], invert: [n('amount', 'Amount', 0, 1, 1)],
  'gaussian-blur': [n('radius', 'Radius (px)', 0, 50, 5, 0.5)], sharpen: [n('amount', 'Amount', 0, 2, 0.5)],
  levels: [n('inputBlack', 'Input black', 0, 254, 0, 1), n('inputWhite', 'Input white', 1, 255, 255, 1), n('gamma', 'Gamma', 0.1, 10, 1, 0.05), n('outputBlack', 'Output black', 0, 255, 0, 1), n('outputWhite', 'Output white', 0, 255, 255, 1)],
}
export function effectControls(kind: AdjustmentKind): EffectControl[] { return LEGACY[kind] ?? EXTENDED_EFFECTS[kind as ExtendedEffectKind].controls }
export function effectCategory(kind: AdjustmentKind): string { return kind in EXTENDED_EFFECTS ? EXTENDED_EFFECTS[kind as ExtendedEffectKind].category : kind === 'gaussian-blur' ? 'Blur Effects' : ['grayscale', 'sepia', 'invert'].includes(kind) ? 'Color Effects' : 'Basic Adjustments' }
