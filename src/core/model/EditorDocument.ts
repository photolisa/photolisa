import type {
  DocumentDimensions,
  ImportedDocumentOptions,
  Layer,
  NewDocumentOptions,
  RasterLayer,
  SerializedEditorDocument,
  DocumentMetadata,
} from './types'
import type { LayerAdjustment } from '../filters/types'
import { createLayerBase } from './types'
import { cloneAdjustment, filterRegistry } from '../filters/FilterRegistry'
import { validateVectorGeometry, validateVectorStyle } from './VectorGeometry'

export const createEntityId = (): string => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random()}`

export class EditorDocument {
  readonly id: string
  name: string
  readonly dimensions: DocumentDimensions
  readonly background: NewDocumentOptions['background']
  readonly layers: Layer[]
  selectedLayerIds: string[]
  activeLayerId: string | null
  revision: number
  readonly previewOriginals = new Map<string, readonly LayerAdjustment[]>()
  readonly metadata: DocumentMetadata

  private constructor(
    options: NewDocumentOptions,
    layers: Layer[],
    state: { id?: string; selectedLayerIds?: string[]; activeLayerId?: string | null; revision?: number; metadata?: DocumentMetadata } = {},
  ) {
    this.id = state.id ?? createEntityId()
    this.name = options.name
    this.dimensions = { width: options.width, height: options.height, resolution: options.resolution }
    this.background = options.background
    this.layers = layers
    this.selectedLayerIds = state.selectedLayerIds ?? (layers[0] ? [layers[0].id] : [])
    this.activeLayerId = state.activeLayerId === undefined ? (layers[0]?.id ?? null) : state.activeLayerId
    this.revision = state.revision ?? 0
    const now = new Date().toISOString()
    this.metadata = state.metadata ? structuredClone(state.metadata) : { createdAt: now, modifiedAt: now }
  }

  static create(options: NewDocumentOptions): EditorDocument {
    validateOptions(options)
    const layer: RasterLayer = {
      ...createLayerBase(createEntityId(), 'raster', 'Layer 1'),
      kind: 'raster', pixelSourceId: null,
    }
    return new EditorDocument(options, [layer])
  }

  static createFromImage(options: ImportedDocumentOptions): EditorDocument {
    validateOptions({ ...options, background: 'transparent' })
    const layer: RasterLayer = {
      ...createLayerBase(createEntityId(), 'raster', options.name),
      kind: 'raster', pixelSourceId: options.pixelSourceId,
    }
    return new EditorDocument({ ...options, background: 'transparent' }, [layer])
  }

  static deserialize(value: SerializedEditorDocument): EditorDocument {
    if (value.version !== 1 && value.version !== 2 && value.version !== 3) throw new Error(`Unsupported document version: ${String(value.version)}`)
    validateOptions({ ...value.dimensions, name: value.name, background: value.background })
    validateLayerTree(value.layers)
    const ids = new Set(flattenLayerIds(value.layers))
    const selectedLayerIds = value.selectedLayerIds.filter((id) => ids.has(id))
    const activeLayerId = value.activeLayerId && ids.has(value.activeLayerId) ? value.activeLayerId : null
    return new EditorDocument(
      { ...value.dimensions, name: value.name, background: value.background },
      cloneLayerTree(value.layers),
      { id: value.id, selectedLayerIds, activeLayerId, revision: value.revision, ...(value.metadata ? { metadata: value.metadata } : {}) },
    )
  }

  serialize(): SerializedEditorDocument {
    return {
      version: 3,
      id: this.id,
      name: this.name,
      dimensions: { ...this.dimensions },
      background: this.background,
      layers: committedLayers(this.layers, this.previewOriginals),
      selectedLayerIds: [...this.selectedLayerIds],
      activeLayerId: this.activeLayerId,
      revision: this.revision,
      metadata: structuredClone(this.metadata),
    }
  }

  touch(): void { this.revision += 1; this.metadata.modifiedAt = new Date().toISOString() }
}

export function cloneLayerTree(layers: readonly Layer[]): Layer[] {
  return layers.map((layer): Layer => {
    if ((layer.adjustments?.length ?? 0) > 64) throw new Error('A layer can contain at most 64 effects')
    const adjustments = (layer.adjustments ?? []).map((adjustment) => filterRegistry.normalize(cloneAdjustment(adjustment)))
    const base = { ...layer, transform: { ...layer.transform }, ...(layer.svgMatrix ? { svgMatrix: [...layer.svgMatrix] as typeof layer.svgMatrix } : {}), adjustments, mask: layer.mask ? { ...layer.mask } : null }
    if (layer.kind === 'group') return { ...base, kind: 'group', children: cloneLayerTree(layer.children) }
    if (layer.kind === 'vector') return { ...base, kind: 'vector', geometry: structuredClone(layer.geometry), style: structuredClone(layer.style) }
    if (layer.kind === 'text') return { ...base, ...(layer.textBox ? { textBox: { ...layer.textBox } } : {}), kind: 'text', text: layer.text, fontFamily: layer.fontFamily, fontSize: layer.fontSize,
      fontWeight: layer.fontWeight, fontStyle: layer.fontStyle, alignment: layer.alignment, color: layer.color, lineSpacing: layer.lineSpacing }
    return { ...base, kind: 'raster', pixelSourceId: layer.pixelSourceId, ...(layer.crop ? { crop: { ...layer.crop } } : {}) }
  })
}

function flattenLayerIds(layers: readonly Layer[]): string[] {
  return layers.flatMap((layer) => layer.kind === 'group' ? [layer.id, ...flattenLayerIds(layer.children)] : [layer.id])
}

function validateLayerTree(layers: readonly Layer[], ids = new Set<string>()): void {
  for (const layer of layers) {
    if (ids.has(layer.id)) throw new Error(`Duplicate layer ID: ${layer.id}`)
    ids.add(layer.id)
    if (!layer.name.trim()) throw new Error('Layer names cannot be empty')
    if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) throw new Error('Layer opacity must be between 0 and 1')
    if (layer.aspectRatioLocked !== undefined && typeof layer.aspectRatioLocked !== 'boolean') throw new Error('Invalid aspect ratio lock')
    const transform = layer.transform
    if (!transform || [transform.x, transform.y, transform.rotation, transform.scaleX, transform.scaleY].some(n => !Number.isFinite(n)) || Math.abs(transform.x) > 1_000_000 || Math.abs(transform.y) > 1_000_000 || Math.abs(transform.scaleX) > 10_000 || Math.abs(transform.scaleY) > 10_000) throw new Error('Invalid layer transform')
    if (layer.svgMatrix && (layer.svgMatrix.length !== 6 || layer.svgMatrix.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000))) throw new Error('Invalid SVG transform')
    if (layer.kind === 'raster' && layer.crop) {
      const crop = layer.crop
      if (![crop.x, crop.y, crop.width, crop.height, crop.offsetX, crop.offsetY].every(Number.isFinite) || crop.width < 1 || crop.height < 1 || crop.width > 16384 || crop.height > 16384 || Math.abs(crop.x) > 1000000 || Math.abs(crop.y) > 1000000 || Math.abs(crop.offsetX) > 1000000 || Math.abs(crop.offsetY) > 1000000) throw new Error('Invalid image crop')
    }
    if (layer.kind === 'vector') {
      validateVectorGeometry(layer.geometry)
      validateVectorStyle(layer.style)
    }
    if (layer.kind === 'text') {
      if (layer.textBox && (![layer.textBox.width, layer.textBox.height].every(n => Number.isFinite(n) && n >= 1 && n <= 16384) || layer.textBox.width * layer.textBox.height > 67108864)) throw new Error('Invalid text box dimensions')
      if (layer.text.length > 10_000 || !layer.fontFamily.trim() || !Number.isFinite(layer.fontSize) || layer.fontSize < 1 || layer.fontSize > 2048
        || !Number.isFinite(layer.lineSpacing) || layer.lineSpacing < 0.5 || layer.lineSpacing > 4
        || !Number.isFinite(layer.fontWeight) || layer.fontWeight < 100 || layer.fontWeight > 900
        || !/^(#[0-9a-f]{6})$/i.test(layer.color)) throw new Error('Invalid text layer properties')
    }
    if (layer.kind === 'group') {
      if (layer.booleanOperation && (!['union', 'subtract', 'intersect', 'exclude', 'divide'].includes(layer.booleanOperation) || layer.children.length > 256 || layer.children.some(child => child.kind !== 'vector'))) throw new Error('Invalid boolean group')
      validateLayerTree(layer.children, ids)
    }
  }
}

function validateOptions(options: NewDocumentOptions): void {
  if (!options.name.trim()) throw new Error('Document name is required')
  if (!Number.isInteger(options.width) || options.width < 1 || options.width > 16_384) throw new Error('Width must be an integer between 1 and 16,384 pixels')
  if (!Number.isInteger(options.height) || options.height < 1 || options.height > 16_384) throw new Error('Height must be an integer between 1 and 16,384 pixels')
  if (!Number.isFinite(options.resolution) || options.resolution < 1 || options.resolution > 2_400) throw new Error('Resolution must be between 1 and 2,400 PPI')
}

function committedLayers(layers: readonly Layer[], originals: ReadonlyMap<string, readonly LayerAdjustment[]>): Layer[] {
  return cloneLayerTree(layers).map(layer => {
    const original = originals.get(layer.id)
    if (original) layer.adjustments = original.map(cloneAdjustment)
    if (layer.kind === 'group') layer.children = committedLayers(layer.children, originals)
    return layer
  })
}
