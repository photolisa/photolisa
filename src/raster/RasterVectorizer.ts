import type { VectorLayer } from '../core/model/types'
import type { RasterSource } from './RasterSourceRegistry'

export interface RasterTraceResult { layers: VectorLayer[]; width: number; height: number }

/** A small, bounded color trace. The source bitmap is sampled, never modified. */
export async function traceRasterSource(source: RasterSource, signal?: AbortSignal): Promise<RasterTraceResult> {
  if (signal?.aborted) throw new DOMException('Tracing was cancelled.', 'AbortError')
  const scale = Math.min(1, 256 / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable for image tracing.')
  context.drawImage(source.image, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const svg = await runTraceWorker(width, height, pixels.buffer, signal)
  if (svg.length > 2_000_000) throw new Error('The traced image has too many paths. Use a simpler image or reduce detail first.')
  if (signal?.aborted) throw new DOMException('Tracing was cancelled.', 'AbortError')
  const { SvgImporter } = await import('../adapters/SvgImporter')
  if (signal?.aborted) throw new DOMException('Tracing was cancelled.', 'AbortError')
  const imported = new SvgImporter().parse(svg, 'Traced image')
  const paths = imported.document.layers.filter((layer): layer is VectorLayer => layer.kind === 'vector' && layer.opacity > 0 && (layer.style.fillOpacity ?? 1) > 0)
  if (!paths.length) throw new Error('No visible vector shapes were found. Try an image with clearer color boundaries.')
  if (paths.length > 500) throw new Error('The traced image has too many shapes. Use a simpler image or reduce detail first.')
  const combined = new Map<string, VectorLayer>()
  for (const path of paths) {
    if (path.geometry.type !== 'path') throw new Error('Unexpected traced geometry.')
    const key = `${JSON.stringify(path.style)}:${path.opacity}`
    const prior = combined.get(key)
    if (prior) {
      if (prior.geometry.type !== 'path') throw new Error('Unexpected traced geometry.')
      prior.geometry.d += ` ${path.geometry.d}`
      if (prior.geometry.d.length > 1_000_000) throw new Error('The traced path exceeds the vector geometry limit.')
    } else combined.set(key, path)
  }
  return { layers: [...combined.values()], width, height }
}

function runTraceWorker(width: number, height: number, pixels: ArrayBufferLike, signal?: AbortSignal): Promise<string> {
  if (!(pixels instanceof ArrayBuffer)) throw new Error('Image tracing requires a transferable pixel buffer.')
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./vectorize.worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (error: Error | null, svg?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else if (svg) resolve(svg)
      else reject(new Error('Image tracing returned no vector data.'))
    }
    const abort = () => finish(new DOMException('Tracing was cancelled.', 'AbortError'))
    const timeout = setTimeout(() => finish(new Error('Image tracing exceeded the 15 second limit. Try a simpler image.')), 15_000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = () => finish(new Error('The image tracing worker failed.'))
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const result = event.data
      if (!result || typeof result !== 'object') { finish(new Error('Invalid image tracing result.')); return }
      if ('error' in result && typeof result.error === 'string') { finish(new Error(result.error)); return }
      if ('svg' in result && typeof result.svg === 'string') { finish(null, result.svg); return }
      finish(new Error('Invalid image tracing result.'))
    }
    if (signal?.aborted) { abort(); return }
    worker.postMessage({ width, height, pixels }, [pixels])
  })
}
