import { applyImageCrop } from '../raster/ImageCrop'
import { booleanGroupResult } from '../core/vector/BooleanGroup'
import type { RasterSurface } from '../raster/RasterSurface'
import { RasterSurface as Surface } from '../raster/RasterSurface'
import type { EditorDocument } from '../core/model/EditorDocument'
import type { GroupLayer, Layer, RasterLayer } from '../core/model/types'
import { filterRegistry, type FilterRegistry } from '../core/filters/FilterRegistry'
import { rasterSources, type RasterSourceRegistry } from '../raster/RasterSourceRegistry'
import { AdjustmentWorkerClient } from '../raster/AdjustmentWorkerClient'
import { applySvgMatrix, paintVector } from '../raster/VectorPainter'
import { maskAlphaCanvas } from '../raster/MaskPixels'
import { loadTextFont, paintTextLayer, textPixelSize } from '../raster/TextPainter'

export class ImageExportAdapter {
  private readonly cache = new Map<string, HTMLCanvasElement>()
  private cacheBytes = 0
  private readonly maxCacheBytes = 64 * 1024 * 1024
  private lastDurationMs = 0
  private maxTemporaryPixels = Infinity
  private documentWidth = 0
  private documentHeight = 0
  private readonly worker = new AdjustmentWorkerClient()

  constructor(
    private readonly sources: RasterSourceRegistry = rasterSources,
    private readonly filters: FilterRegistry = filterRegistry,
  ) {}

  /** Full-resolution local content for the canvas preview, sharing the export pipeline. */
  async renderEffectLayer(layer: Layer, width: number, height: number): Promise<HTMLCanvasElement> {
    this.documentWidth = width; this.documentHeight = height
    const source = layer.kind === 'raster' && layer.pixelSourceId ? this.sources.get(layer.pixelSourceId) : null
    const canvas = document.createElement('canvas')
    canvas.width = source?.width ?? width; canvas.height = source?.height ?? height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable for effect preview')
    if (layer.kind === 'raster') {
      const local = { ...layer }; delete local.crop
      await this.drawRasterLayer(context, local)
    } else if (layer.kind === 'group') await this.drawGroupLayer(context, layer)
    return canvas
  }

  async toPng(surface: RasterSurface): Promise<Blob> {
    return this.toBlob(surface, 'image/png')
  }

  async toBlob(surface: RasterSurface, type: 'image/png' | 'image/jpeg' | 'image/webp', quality = 0.92): Promise<Blob> {
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) throw new Error('Export quality must be between 0 and 1')
    let canvas = surface.canvas
    if (type === 'image/jpeg') {
      canvas = document.createElement('canvas'); canvas.width = surface.canvas.width; canvas.height = surface.canvas.height
      const context = canvas.getContext('2d'); if (!context) throw new Error('2D canvas is unavailable for export')
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(surface.canvas, 0, 0)
    }
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`${type} export is not supported by this browser`)), type, quality))
  }

  async renderDocument(document: EditorDocument, scale = 1): Promise<RasterSurface> {
    const started = performance.now()
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid render scale')
    const surface = Surface.create({ width: Math.max(1, Math.ceil(document.dimensions.width * scale)), height: Math.max(1, Math.ceil(document.dimensions.height * scale)), background: document.background })
    surface.context.scale(scale, scale)
    this.documentWidth = document.dimensions.width
    this.documentHeight = document.dimensions.height
    await this.drawLayers(surface.context, document.layers)
    this.lastDurationMs = performance.now() - started
    return surface
  }

  /** Paint into an existing bounded target; callers own its page transform and background. */
  async paintDocument(document: EditorDocument, context: CanvasRenderingContext2D, maxTemporaryPixels = Infinity): Promise<void> {
    const previousLimit = this.maxTemporaryPixels
    this.maxTemporaryPixels = maxTemporaryPixels
    this.documentWidth = document.dimensions.width
    this.documentHeight = document.dimensions.height
    context.save()
    try {
      context.beginPath(); context.rect(0, 0, this.documentWidth, this.documentHeight); context.clip()
      if (document.background === 'white') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, this.documentWidth, this.documentHeight) }
      await this.drawLayers(context, document.layers)
    } finally { context.restore(); this.maxTemporaryPixels = previousLimit }
  }

  private checkTemporaryPixels(width: number, height: number): void {
    if (width * height > this.maxTemporaryPixels || Number.isFinite(this.maxTemporaryPixels) && (width > 8192 || height > 8192)) throw new Error('A PDF effect, mask or text layer exceeds the temporary rendering limit (8192 pixels per side / 16 megapixels). Resize the source or disable the effect.')
  }

  async documentToPng(document: EditorDocument): Promise<Blob> {
    return this.toPng(await this.renderDocument(document))
  }

  async documentToBlob(document: EditorDocument, type: 'image/png' | 'image/jpeg' | 'image/webp', quality = 0.92): Promise<Blob> {
    return this.toBlob(await this.renderDocument(document), type, quality)
  }

  getLastRenderDuration(): number { return this.lastDurationMs }

  clearCache(): void { this.cache.clear(); this.cacheBytes = 0 }
  destroy(): void { this.worker.destroy(); this.clearCache() }

  private async drawLayers(context: CanvasRenderingContext2D, layers: readonly Layer[]): Promise<void> {
    for (const layer of layers) {
      if (!layer.visible) continue
      context.save()
      try {
        context.translate(layer.transform.x, layer.transform.y)
        context.rotate(layer.transform.rotation)
        context.scale(layer.transform.scaleX, layer.transform.scaleY)
        applySvgMatrix(context, layer.svgMatrix)
        context.globalAlpha *= layer.opacity
        context.globalCompositeOperation = layer.blendMode === 'normal' ? 'source-over' : layer.blendMode
        if (layer.kind === 'group' && layer.booleanOperation) paintVector(context, booleanGroupResult(layer))
        else if (layer.kind === 'group') await this.drawGroupLayer(context, layer)
        else if (layer.kind === 'vector') paintVector(context, layer)
        else if (layer.kind === 'text') {
          await loadTextFont(layer)
          if (Number.isFinite(this.maxTemporaryPixels)) { const size = textPixelSize(layer); this.checkTemporaryPixels(size.width, size.height) }
          context.drawImage(paintTextLayer(layer), 0, 0)
        }
        else await this.drawRasterLayer(context, layer)
      } finally { context.restore() }
    }
  }

  private async drawGroupLayer(context: CanvasRenderingContext2D, layer: GroupLayer): Promise<void> {
    const enabled = layer.adjustments.filter((adjustment) => adjustment.enabled)
    if (!enabled.length) { await this.drawLayers(context, layer.children); return }
    this.checkTemporaryPixels(this.documentWidth, this.documentHeight)
    const canvas = document.createElement('canvas'); canvas.width = this.documentWidth; canvas.height = this.documentHeight
    const offscreen = canvas.getContext('2d', { willReadFrequently: true })
    if (!offscreen) throw new Error('2D canvas is unavailable for group adjustments')
    await this.drawLayers(offscreen, layer.children)
    const input = offscreen.getImageData(0, 0, canvas.width, canvas.height)
    let result
    try { result = await this.worker.process({ data: input.data, width: input.width, height: input.height }, enabled) }
    catch { result = this.filters.apply({ data: input.data, width: input.width, height: input.height }, enabled) }
    offscreen.putImageData(new ImageData(result.data, result.width, result.height), 0, 0)
    context.drawImage(canvas, 0, 0)
  }

  private async drawRasterLayer(context: CanvasRenderingContext2D, layer: RasterLayer): Promise<void> {
    const source = layer.pixelSourceId ? this.sources.get(layer.pixelSourceId) : null
    if (!source) return
    applyImageCrop(context, layer)
    const enabled = layer.adjustments.filter((adjustment) => adjustment.enabled)
    if (enabled.length === 0 && !layer.mask?.enabled) {
      context.drawImage(source.image, 0, 0)
      return
    }
    this.checkTemporaryPixels(source.width, source.height)
    const key = `${layer.pixelSourceId}:${source.revision}:${JSON.stringify(enabled)}`
    let adjusted: HTMLCanvasElement | ImageBitmap = source.image
    if (enabled.length) {
      let cached = this.cache.get(key)
      if (cached) { this.cache.delete(key); this.cache.set(key, cached) }
      if (!cached) {
        const sourceCanvas = document.createElement('canvas')
        sourceCanvas.width = source.width
        sourceCanvas.height = source.height
        const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
        if (!sourceContext) throw new Error('2D canvas is unavailable for export')
        sourceContext.drawImage(source.image, 0, 0)
        const image = sourceContext.getImageData(0, 0, source.width, source.height)
        let result
        try {
          result = await this.worker.process({ data: image.data, width: image.width, height: image.height }, enabled)
        } catch {
          result = this.filters.apply({ data: image.data, width: image.width, height: image.height }, enabled)
        }
        cached = document.createElement('canvas')
        cached.width = source.width
        cached.height = source.height
        const adjustedContext = cached.getContext('2d')
        if (!adjustedContext) throw new Error('2D canvas is unavailable for export')
        adjustedContext.putImageData(new ImageData(result.data, result.width, result.height), 0, 0)
        const bytes = source.width * source.height * 4
        if (bytes <= this.maxCacheBytes / 2) {
          while (this.cacheBytes + bytes > this.maxCacheBytes) {
            const oldest = this.cache.keys().next().value as string | undefined
            if (!oldest) break
            const evicted = this.cache.get(oldest)
            if (evicted) this.cacheBytes -= evicted.width * evicted.height * 4
            this.cache.delete(oldest)
          }
          this.cache.set(key, cached); this.cacheBytes += bytes
        }
      }
      adjusted = cached
    }
    if (!layer.mask?.enabled) { context.drawImage(adjusted, 0, 0); return }
    const mask = this.sources.get(layer.mask.pixelSourceId)
    if (!mask) { context.drawImage(adjusted, 0, 0); return }
    this.checkTemporaryPixels(mask.width, mask.height)
    const masked = document.createElement('canvas'); masked.width = source.width; masked.height = source.height
    const maskedContext = masked.getContext('2d'); if (!maskedContext) throw new Error('2D canvas is unavailable for export')
    maskedContext.drawImage(adjusted, 0, 0)
    maskedContext.globalCompositeOperation = 'destination-in'
    maskedContext.drawImage(maskAlphaCanvas(mask, layer.mask.inverted), 0, 0)
    context.drawImage(masked, 0, 0)
  }
}
