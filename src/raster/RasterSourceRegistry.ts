export interface RasterSource {
  readonly width: number
  readonly height: number
  readonly image: ImageBitmap | HTMLCanvasElement
  readonly editable: boolean
  revision: number
  dirty: SourceRect | null
  fullDirty: boolean
}

export interface SourceRect { x: number; y: number; width: number; height: number }

export class RasterSourceRegistry {
  private readonly sources = new Map<string, RasterSource>()

  register(image: ImageBitmap): string { return this.store({ width: image.width, height: image.height, image, editable: false, revision: 0, dirty: null, fullDirty: false }) }

  registerCanvas(canvas: HTMLCanvasElement): string {
    return this.store({ width: canvas.width, height: canvas.height, image: canvas, editable: true, revision: 0, dirty: null, fullDirty: false })
  }

  createTransparent(width: number, height: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return this.registerCanvas(canvas)
  }

  createEditableCopy(sourceId: string | null, width: number, height: number): string {
    const source = sourceId ? this.get(sourceId) : undefined
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas is unavailable')
    if (source) context.drawImage(source.image, 0, 0)
    return this.registerCanvas(canvas)
  }

  get(id: string): RasterSource | undefined { return this.sources.get(id) }
  touch(id: string, region?: SourceRect): void {
    const source = this.sources.get(id)
    if (!source) return
    source.revision += 1
    if (!region) { source.dirty = null; source.fullDirty = true; return }
    if (source.fullDirty) return
    const previous = source.dirty
    if (!previous) { source.dirty = { ...region }; return }
    const x = Math.min(previous.x, region.x), y = Math.min(previous.y, region.y)
    source.dirty = { x, y, width: Math.max(previous.x + previous.width, region.x + region.width) - x, height: Math.max(previous.y + previous.height, region.y + region.height) - y }
  }

  takeDirty(id: string): SourceRect | null {
    const source = this.sources.get(id)
    if (!source) return null
    const dirty = source.fullDirty ? null : source.dirty
    source.dirty = null; source.fullDirty = false; return dirty
  }

  getEditableCanvas(id: string): HTMLCanvasElement | null {
    const source = this.sources.get(id)
    return source?.editable && source.image instanceof HTMLCanvasElement ? source.image : null
  }

  remove(id: string): void {
    const source = this.sources.get(id)
    if (source?.image instanceof ImageBitmap) source.image.close()
    this.sources.delete(id)
  }

  clear(): void {
    this.sources.forEach((source) => { if (source.image instanceof ImageBitmap) source.image.close() })
    this.sources.clear()
  }

  private store(source: RasterSource): string {
    const id = globalThis.crypto?.randomUUID?.() ?? `source-${Date.now()}-${Math.random()}`
    this.sources.set(id, source)
    return id
  }
}

export const rasterSources = new RasterSourceRegistry()
