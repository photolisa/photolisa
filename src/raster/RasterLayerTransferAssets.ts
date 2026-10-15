import type { LayerAssetTransfer } from '../core/layers/LayerTransferService'
import { rasterSources, type RasterSourceRegistry } from './RasterSourceRegistry'

/** ImageBitmaps are immutable; editable canvases get a private copy for cross-document isolation. */
export class RasterLayerTransferAssets implements LayerAssetTransfer {
  constructor(private readonly sources: RasterSourceRegistry = rasterSources) {}

  copyBytes(sourceId: string): number {
    const source = this.sources.get(sourceId)
    if (!source) throw new Error(`Layer pixel asset ${sourceId} is unavailable`)
    return source.editable ? source.width * source.height * 4 : 0
  }

  prepare(sourceId: string): string {
    const source = this.sources.get(sourceId)
    if (!source) throw new Error(`Layer pixel asset ${sourceId} is unavailable`)
    if (!source.editable) return sourceId
    const bytes = this.copyBytes(sourceId)
    if (!Number.isSafeInteger(bytes) || bytes > 512 * 1024 * 1024) throw new Error('Layer pixel asset is too large to transfer safely')
    return this.sources.createEditableCopy(sourceId, source.width, source.height)
  }

  rollback(sourceId: string): void { this.sources.remove(sourceId) }
}
