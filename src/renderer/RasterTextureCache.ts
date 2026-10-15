import { Container, Sprite, Texture } from 'pixi.js'
import type { RasterSource, RasterSourceRegistry, SourceRect } from '../raster/RasterSourceRegistry'

const DEFAULT_TILE_EDGE = 2048

interface TextureTile {
  x: number
  y: number
  width: number
  height: number
  canvas: HTMLCanvasElement | null
  texture: Texture
}

interface TextureEntry { source: RasterSource; revision: number; tiles: TextureTile[] }

/** Shares GPU textures between every layer that references a raster source. */
export class RasterTextureCache {
  private readonly entries = new Map<string, TextureEntry>()
  private tileEdge = DEFAULT_TILE_EDGE
  constructor(private readonly sources: RasterSourceRegistry) {}

  configureMaxTextureSize(hardwareLimit: number): void {
    if (this.entries.size > 0 || !Number.isFinite(hardwareLimit) || hardwareLimit < 1) return
    this.tileEdge = Math.min(DEFAULT_TILE_EDGE, Math.floor(hardwareLimit))
  }

  createDisplay(sourceId: string): Container | null {
    const source = this.sources.get(sourceId)
    if (!source) return null
    const entry = this.entries.get(sourceId) ?? this.createEntry(sourceId, source)
    const container = new Container()
    for (const tile of entry.tiles) {
      const sprite = new Sprite(tile.texture)
      sprite.position.set(tile.x, tile.y)
      container.addChild(sprite)
    }
    return container
  }

  update(sourceId: string): boolean {
    const entry = this.entries.get(sourceId)
    const source = this.sources.get(sourceId)
    if (!entry || !source || entry.revision === source.revision) return false
    const dirty = this.sources.takeDirty(sourceId)
    for (const tile of entry.tiles) {
      if (dirty && !intersects(dirty, tile)) continue
      if (tile.canvas) {
        const context = tile.canvas.getContext('2d')
        if (!context) continue
        context.clearRect(0, 0, tile.width, tile.height)
        context.drawImage(source.image, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height)
      }
      tile.texture.source.update()
    }
    entry.revision = source.revision
    return true
  }

  updateChanged(): boolean {
    let changed = false
    for (const sourceId of this.entries.keys()) changed = this.update(sourceId) || changed
    return changed
  }

  get estimatedGpuBytes(): number {
    let bytes = 0
    for (const entry of this.entries.values()) for (const tile of entry.tiles) bytes += tile.width * tile.height * 4
    return bytes
  }

  clear(): void {
    for (const entry of this.entries.values()) for (const tile of entry.tiles) tile.texture.destroy(false)
    this.entries.clear()
  }

  private createEntry(sourceId: string, source: RasterSource): TextureEntry {
    const edge = this.tileEdge
    const tiled = source.width > edge || source.height > edge
    const tiles: TextureTile[] = []
    for (let y = 0; y < source.height; y += tiled ? edge : source.height) {
      for (let x = 0; x < source.width; x += tiled ? edge : source.width) {
        const width = Math.min(tiled ? edge : source.width, source.width - x)
        const height = Math.min(tiled ? edge : source.height, source.height - y)
        let canvas: HTMLCanvasElement | null = null
        if (tiled) {
          canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
          canvas.getContext('2d')?.drawImage(source.image, x, y, width, height, 0, 0, width, height)
        }
        tiles.push({ x, y, width, height, canvas, texture: Texture.from(canvas ?? source.image, true) })
      }
    }
    const entry = { source, revision: source.revision, tiles }
    this.entries.set(sourceId, entry)
    this.sources.takeDirty(sourceId)
    return entry
  }
}

function intersects(a: SourceRect, b: Pick<TextureTile, 'x' | 'y' | 'width' | 'height'>): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
