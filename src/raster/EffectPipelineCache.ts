import { filterRegistry } from '../core/filters/FilterRegistry'
import type { LayerAdjustment, PixelBuffer } from '../core/filters/types'
import { EffectGpuProcessor } from './EffectGpuProcessor'
interface Stage { signature: string; pixels: PixelBuffer; bytes: number }
/** Retains an unchanged stack prefix; never exposes or transfers retained buffers. */
export class EffectPipelineCache {
  private input: PixelBuffer | null = null
  private readonly stages: Stage[] = []
  private bytes = 0
  private readonly budget = 64 * 1024 * 1024
  private readonly gpu = new EffectGpuProcessor()
  process(input: PixelBuffer, effects: readonly LayerAdjustment[]): PixelBuffer {
    const same = this.input?.width === input.width && this.input.height === input.height && this.input.data.every((value, index) => value === input.data[index])
    if (!same) {
      this.stages.length = 0; this.bytes = input.data.byteLength
      this.input = this.bytes * 3 <= this.budget ? { ...input, data: new Uint8ClampedArray(input.data) } : null
    }
    let pixels = input, index = 0
    for (const effect of effects) {
      if (!effect.enabled || effect.opacity === 0) continue
      const signature = JSON.stringify(effect), cached = this.stages[index]
      if (cached?.signature === signature) { pixels = cached.pixels; index++; continue }
      for (const stage of this.stages.splice(index)) this.bytes -= stage.bytes
      pixels = filterRegistry.apply(pixels, [effect], (p, e) => this.gpu.process(p, e))
      const bytes = pixels.data.byteLength + signature.length * 2
      if (this.input && bytes + this.bytes <= this.budget && this.stages.length === index) { this.stages.push({ signature, pixels, bytes }); this.bytes += bytes }
      index++
    }
    for (const stage of this.stages.splice(index)) this.bytes -= stage.bytes
    return { ...pixels, data: new Uint8ClampedArray(pixels.data) }
  }
}
