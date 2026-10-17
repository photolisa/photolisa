import { EffectPipelineCache } from './EffectPipelineCache'
const pipeline = new EffectPipelineCache()
import type { LayerAdjustment, PixelBuffer } from '../core/filters/types'

interface WorkerRequest { id: number; pixels: PixelBuffer; adjustments: LayerAdjustment[] }

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const pixels = pipeline.process(event.data.pixels, event.data.adjustments)
    self.postMessage({ id: event.data.id, pixels }, { transfer: [pixels.data.buffer] })
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : 'Adjustment processing failed' })
  }
}
