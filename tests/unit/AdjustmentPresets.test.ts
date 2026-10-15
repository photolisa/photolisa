import { describe, expect, it } from 'vitest'
import { ADJUSTMENT_PRESETS, createAdjustmentPreset } from '../../src/core/filters/AdjustmentPresets'

describe('legacy filter looks', () => {
  it('creates editable adjustments with unique IDs', () => {
    for (const preset of ADJUSTMENT_PRESETS) {
      const adjustments = createAdjustmentPreset(preset.id, () => 0.75)
      expect(adjustments.length).toBeGreaterThan(0)
      expect(new Set(adjustments.map((item) => item.id)).size).toBe(adjustments.length)
      expect(adjustments.every((item) => item.enabled)).toBe(true)
    }
    expect(createAdjustmentPreset('vintage').map((item) => item.kind)).toEqual(['brightness-contrast', 'saturation', 'sepia'])
    expect(createAdjustmentPreset('funky', () => 0.75)[0]).toMatchObject({ kind: 'hue', parameters: { degrees: 90 } })
  })
})
