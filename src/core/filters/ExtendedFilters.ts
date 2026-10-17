import { EXTENDED_EFFECTS, type ExtendedEffectKind } from './EffectCatalog'
import { colorEffect } from './ColorEffects'
import { blurEffect } from './BlurEffects'
import { artisticEffect } from './ArtisticEffects'
import { distortionEffect } from './DistortionEffects'
import type { FilterDefinition, PixelBuffer } from './types'

class ExtendedFilter implements FilterDefinition<ExtendedEffectKind> {
  readonly label: string
  readonly defaults: Record<string, number>
  constructor(readonly kind: ExtendedEffectKind, private readonly gaussian: (p: PixelBuffer, radius: number) => PixelBuffer) {
    const schema = EXTENDED_EFFECTS[kind]
    this.label = schema.label
    this.defaults = Object.fromEntries(schema.controls.map(control => [control.key, control.value]))
  }
  normalize(parameters: Partial<Record<string, number>>): Record<string, number> {
    return Object.fromEntries(EXTENDED_EFFECTS[this.kind].controls.map(c => {
      const value = parameters[c.key]
      const safe = typeof value === 'number' && Number.isFinite(value) ? Math.max(c.min, Math.min(c.max, value)) : c.value
      return [c.key, c.step === 1 ? Math.round(safe) : safe]
    }))
  }
  apply(input: PixelBuffer, parameters: Record<string, number>): PixelBuffer {
    const spec = EXTENDED_EFFECTS[this.kind], category = spec.category
    if (this.kind === 'color-lookup') throw new Error('Color Lookup requires a LUT table')
    if (category === 'Blur Effects' || ['unsharp-mask', 'clarity', 'glow', 'soft-focus'].includes(this.kind)) return blurEffect(this.kind, input, parameters, this.gaussian)
    if (category === 'Artistic Effects' && this.kind !== 'posterize') return artisticEffect(this.kind, input, parameters, this.gaussian)
    if (category === 'Distortion Effects' || this.kind === 'chromatic-aberration') return distortionEffect(this.kind, input, parameters)
    return colorEffect(this.kind, input, parameters)
  }
}
export function extendedFilters(gaussian: (p: PixelBuffer, radius: number) => PixelBuffer): FilterDefinition[] {
  return (Object.keys(EXTENDED_EFFECTS) as ExtendedEffectKind[]).map(kind => new ExtendedFilter(kind, gaussian))
}
