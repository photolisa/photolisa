import { filterRegistry } from './FilterRegistry'
import type { LayerAdjustment } from './types'

export type AdjustmentPreset = 'brighten' | 'black-and-white' | 'funky' | 'vintage'

export const ADJUSTMENT_PRESETS: ReadonlyArray<{ id: AdjustmentPreset; label: string }> = [
  { id: 'brighten', label: 'Brighten' },
  { id: 'black-and-white', label: 'Black and White' },
  { id: 'funky', label: 'Funky' },
  { id: 'vintage', label: 'Vintage' },
]

/** Each preset is a stack of editable adjustments; one command adds the entire look. */
export function createAdjustmentPreset(preset: AdjustmentPreset, random: () => number = Math.random): LayerAdjustment[] {
  switch (preset) {
    case 'brighten': return [
      filterRegistry.create('brightness-contrast', { brightness: 0.15, contrast: 0.2 }),
      filterRegistry.create('saturation', { amount: 0.2 }),
    ]
    case 'black-and-white': return [
      filterRegistry.create('grayscale', { amount: 1 }),
      filterRegistry.create('brightness-contrast', { brightness: 0.1, contrast: 0.2 }),
    ]
    case 'funky': return [
      filterRegistry.create('hue', { degrees: Math.round((random() * 360) - 180) }),
      filterRegistry.create('brightness-contrast', { contrast: 0.2 }),
    ]
    case 'vintage': return [
      filterRegistry.create('brightness-contrast', { brightness: 0.1 }),
      filterRegistry.create('saturation', { amount: 0.2 }),
      filterRegistry.create('sepia', { amount: 1 }),
    ]
  }
}
