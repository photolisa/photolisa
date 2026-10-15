import { filterRegistry } from '../core/filters/FilterRegistry'
import type { LayerAdjustment, PixelBuffer } from '../core/filters/types'

interface WorkerRequest { id: number; pixels: PixelBuffer; adjustments: LayerAdjustment[] }
interface WorkerResponse { id: number; pixels?: PixelBuffer; error?: string }

export class AdjustmentWorkerClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (pixels: PixelBuffer) => void; reject: (error: Error) => void }>()

  async process(input: PixelBuffer, adjustments: readonly LayerAdjustment[]): Promise<PixelBuffer> {
    if (typeof Worker === 'undefined') return filterRegistry.apply(input, adjustments)
    const worker = this.getWorker()
    const id = this.nextId++
    const request: WorkerRequest = {
      id,
      pixels: { data: new Uint8ClampedArray(input.data), width: input.width, height: input.height },
      adjustments: adjustments.map((adjustment) => ({ ...adjustment, parameters: { ...adjustment.parameters } } as LayerAdjustment)),
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage(request, [request.pixels.data.buffer])
    })
  }

  destroy(): void {
    this.worker?.terminate()
    this.worker = null
    this.rejectPending(new Error('Adjustment worker was stopped'))
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('./adjustment.worker.ts', import.meta.url), { type: 'module', name: 'photolisa-adjustments' })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      this.pending.delete(event.data.id)
      if (event.data.error || !event.data.pixels) pending.reject(new Error(event.data.error ?? 'Adjustment worker returned no pixels'))
      else pending.resolve(event.data.pixels)
    }
    this.worker.onerror = () => {
      this.worker?.terminate()
      this.worker = null
      this.rejectPending(new Error('Adjustment worker failed'))
    }
    return this.worker
  }

  private rejectPending(error: Error): void {
    this.pending.forEach(({ reject }) => reject(error))
    this.pending.clear()
  }
}
