import type { EditorDocument } from '../model/EditorDocument'
import type { Layer } from '../model/types'
import { cloneAdjustment, filterRegistry, type FilterRegistry } from './FilterRegistry'
import type { AdjustmentKind, AdjustmentParametersByKind, LayerAdjustment } from './types'

export class AdjustmentManager {
  constructor(
    private readonly getDocument: () => EditorDocument | null,
    private readonly onChange: (document: EditorDocument) => void,
    private readonly registry: FilterRegistry = filterRegistry,
  ) {}

  list(layerId: string): readonly LayerAdjustment[] { return this.requireLayer(layerId).adjustments }

  replace(layerId: string, adjustments: readonly LayerAdjustment[]): void {
    const layer = this.requireLayer(layerId)
    if (layer.locked) throw new Error('Unlock the layer before editing effects')
    if (adjustments.length > 64) throw new Error('A layer can contain at most 64 effects')
    const ids = new Set<string>()
    layer.adjustments = adjustments.map((adjustment) => {
      const normalized = this.registry.normalize(cloneAdjustment(adjustment))
      if (ids.has(normalized.id)) throw new Error(`Duplicate adjustment ID: ${normalized.id}`)
      ids.add(normalized.id)
      return normalized
    })
    this.changed()
  }

  add<K extends AdjustmentKind>(layerId: string, kind: K, parameters: Partial<AdjustmentParametersByKind[K]> = {}): LayerAdjustment<K> {
    const adjustment = this.registry.create(kind, parameters)
    this.replace(layerId, [...this.list(layerId), adjustment])
    return adjustment
  }

  update<K extends AdjustmentKind>(layerId: string, adjustmentId: string, parameters: Partial<AdjustmentParametersByKind[K]>): void {
    const adjustments = this.list(layerId).map((adjustment) => adjustment.id === adjustmentId
      ? this.registry.normalize({ ...adjustment, parameters: { ...adjustment.parameters, ...parameters } } as LayerAdjustment)
      : adjustment)
    if (!adjustments.some((adjustment) => adjustment.id === adjustmentId)) throw new Error(`Adjustment ${adjustmentId} does not exist`)
    this.replace(layerId, adjustments)
  }

  setEnabled(layerId: string, adjustmentId: string, enabled: boolean): void {
    this.replace(layerId, this.list(layerId).map((adjustment) => adjustment.id === adjustmentId ? { ...adjustment, enabled } : adjustment))
  }

  remove(layerId: string, adjustmentId: string): void {
    this.replace(layerId, this.list(layerId).filter((adjustment) => adjustment.id !== adjustmentId))
  }

  move(layerId: string, adjustmentId: string, toIndex: number): void {
    const next = [...this.list(layerId)]
    const fromIndex = next.findIndex((adjustment) => adjustment.id === adjustmentId)
    if (fromIndex < 0) throw new Error(`Adjustment ${adjustmentId} does not exist`)
    const [adjustment] = next.splice(fromIndex, 1)
    if (!adjustment) return
    next.splice(Math.max(0, Math.min(next.length, Math.trunc(toIndex))), 0, adjustment)
    this.replace(layerId, next)
  }

  reset(layerId: string, adjustmentId: string): void {
    const current = this.list(layerId).find((adjustment) => adjustment.id === adjustmentId)
    if (!current) throw new Error(`Adjustment ${adjustmentId} does not exist`)
    this.update(layerId, adjustmentId, this.registry.get(current.kind).defaults)
  }

  snapshot(layerId: string): LayerAdjustment[] { return this.list(layerId).map(cloneAdjustment) }

  private requireLayer(layerId: string): Layer {
    const document = this.getDocument()
    const layer = document ? findLayer(document.layers, layerId) : null
    if (!layer) throw new Error(`Layer ${layerId} does not exist`)
    if (layer.kind !== 'raster' && layer.kind !== 'group') throw new Error('Adjustments require a raster layer or group')
    return layer
  }

  private changed(): void {
    const document = this.getDocument()
    if (!document) throw new Error('No document is open')
    document.touch()
    this.onChange(document)
  }
}

function findLayer(layers: readonly Layer[], id: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer
    if (layer.kind === 'group') {
      const child = findLayer(layer.children, id)
      if (child) return child
    }
  }
  return null
}
