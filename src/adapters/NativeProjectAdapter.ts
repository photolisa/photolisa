import { EditorDocument } from '../core/model/EditorDocument'
import type { Layer, SerializedEditorDocument } from '../core/model/types'
import { rasterSources, type RasterSourceRegistry } from '../raster/RasterSourceRegistry'
import { validateFileSize, validateRasterBudget } from './FileSafety'
import { packNativeProject, unpackNativeProject, type NativeAsset } from './NativeProjectFormat'

export interface NativeProjectSnapshot { document: SerializedEditorDocument; assets: NativeAsset[] }
export class StaleProjectSnapshotError extends Error {
  constructor() { super('Pixels changed during project capture; save again after the stroke finishes') }
}

export class NativeProjectAdapter {
  constructor(private readonly sources: RasterSourceRegistry = rasterSources) {}

  async capture(editorDocument: EditorDocument): Promise<NativeProjectSnapshot> {
    const serialized = editorDocument.serialize()
    const documentRevision = editorDocument.revision
    const assets: NativeAsset[] = []
    for (const id of collectPixelSourceIds(serialized.layers)) {
      const source = this.sources.get(id)
      if (!source) throw new Error(`Pixel asset ${id} is unavailable`)
      validateRasterBudget(source.width, source.height, 'Project asset')
      const revision = source.revision
      const blob = source.image instanceof HTMLCanvasElement
        ? await canvasToBlob(source.image)
        : await encodeBitmap(source.image, source.width, source.height)
      if (source.revision !== revision) throw new StaleProjectSnapshotError()
      assets.push({ id, mimeType: 'image/png', width: source.width, height: source.height, bytes: new Uint8Array(await blob.arrayBuffer()) })
      if (editorDocument.revision !== documentRevision) throw new StaleProjectSnapshotError()
    }
    return { document: serialized, assets }
  }

  encode(snapshot: NativeProjectSnapshot): Blob {
    return new Blob([packNativeProject(snapshot.document, snapshot.assets) as BlobPart], { type: 'application/x-photolisa' })
  }
  async save(document: EditorDocument): Promise<Blob> { return this.encode(await this.capture(document)) }
  async open(file: Blob): Promise<{ document: EditorDocument; warnings: string[] }> {
    validateFileSize(file, 'Project')
    return this.restore(unpackNativeProject(await file.arrayBuffer()))
  }
  async restore(container: ReturnType<typeof unpackNativeProject>): Promise<{ document: EditorDocument; warnings: string[] }> {
    const serialized = structuredClone(container.manifest.document)
    const idMap = new Map<string, string>(); const registered: string[] = []
    try {
      for (const descriptor of container.manifest.assets) {
        validateRasterBudget(descriptor.width, descriptor.height, 'Project asset')
        const bytes = container.assets.get(descriptor.id)
        if (!bytes) throw new Error(`Missing project asset: ${descriptor.id}`)
        const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: descriptor.mimeType }))
        if (bitmap.width !== descriptor.width || bitmap.height !== descriptor.height) { bitmap.close(); throw new Error(`Asset ${descriptor.id} dimensions do not match its manifest`) }
        const newId = this.sources.register(bitmap); registered.push(newId); idMap.set(descriptor.id, newId)
      }
      remapSources(serialized.layers, idMap)
      const restored = EditorDocument.deserialize(serialized); restored.metadata.sourceFormat = 'photolisa'
      return { document: restored, warnings: [...(restored.metadata.compatibilityWarnings ?? [])] }
    } catch (error) { registered.forEach((id) => this.sources.remove(id)); throw error }
  }
}

function collectPixelSourceIds(layers: readonly Layer[], result = new Set<string>()): Set<string> {
  for (const layer of layers) {
    if (layer.mask) result.add(layer.mask.pixelSourceId)
    if (layer.kind === 'group') collectPixelSourceIds(layer.children, result)
    else if (layer.kind === 'raster' && layer.pixelSourceId) result.add(layer.pixelSourceId)
  }
  return result
}
function remapSources(layers: Layer[], ids: ReadonlyMap<string, string>): void {
  for (const layer of layers) {
    if (layer.mask) layer.mask.pixelSourceId = requireMapping(ids, layer.mask.pixelSourceId)
    if (layer.kind === 'group') remapSources(layer.children, ids)
    else if (layer.kind === 'raster' && layer.pixelSourceId) layer.pixelSourceId = requireMapping(ids, layer.pixelSourceId)
  }
}
function requireMapping(ids: ReadonlyMap<string, string>, id: string): string {
  const mapped = ids.get(id); if (!mapped) throw new Error(`Project references missing pixel asset: ${id}`); return mapped
}
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Pixel asset encoding failed')), 'image/png'))
}

async function encodeBitmap(image: ImageBitmap, width: number, height: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Offscreen canvas is unavailable for project saving')
    context.drawImage(image, 0, 0)
    return canvas.convertToBlob({ type: 'image/png' })
  }
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) throw new Error('2D canvas is unavailable for project saving')
  context.drawImage(image, 0, 0)
  return canvasToBlob(canvas)
}
