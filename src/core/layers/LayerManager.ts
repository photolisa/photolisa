import { cloneLayerTree } from '../model/EditorDocument'
import { layerLocalMatrix, multiplyAffine } from '../geometry/LayerCoordinates'
import { IDENTITY_TRANSFORM } from '../model/types'
import type { EditorDocument } from '../model/EditorDocument'
import { createEntityId } from '../model/EditorDocument'
import type { BlendMode, GroupLayer, Layer, LayerBase, RasterLayer, VectorGeometry, VectorStyle } from '../model/types'
import { createLayerBase } from '../model/types'
import { cloneAdjustment } from '../filters/FilterRegistry'
import { validateVectorGeometry, validateVectorStyle } from '../model/VectorGeometry'

export interface LayerLocation {
  parentId: string | null
  index: number
}

export interface RemovedLayer extends LayerLocation {
  layer: Layer
}

export type SelectionMode = 'replace' | 'add' | 'toggle'

export class LayerManager {
  constructor(
    private readonly getDocument: () => EditorDocument | null,
    private readonly onChange: (document: EditorDocument) => void,
    private readonly onSelectionChange: (document: EditorDocument) => void = onChange,
  ) {}

  find(layerId: string): Layer | null {
    const document = this.getDocument()
    return document ? findInTree(document.layers, layerId)?.layer ?? null : null
  }

  locationOf(layerId: string): LayerLocation | null {
    const document = this.requireDocument()
    const entry = findInTree(document.layers, layerId)
    return entry ? { parentId: entry.parentId, index: entry.index } : null
  }

  createEmptyLayer(name = 'Layer'): RasterLayer {
    return { ...createLayerBase(createEntityId(), 'raster', name), kind: 'raster', pixelSourceId: null }
  }

  insert(layer: Layer, parentId: string | null = null, index?: number): LayerLocation {
    const document = this.requireDocument()
    if (this.find(layer.id)) throw new Error(`Layer ${layer.id} already exists`)
    const siblings = this.childrenOf(parentId)
    const insertionIndex = clampIndex(index ?? siblings.length, siblings.length)
    siblings.splice(insertionIndex, 0, layer)
    document.selectedLayerIds = [layer.id]
    document.activeLayerId = layer.id
    this.changed(document)
    return { parentId, index: insertionIndex }
  }

  remove(layerId: string): RemovedLayer {
    const document = this.requireDocument()
    const entry = findInTree(document.layers, layerId)
    if (!entry) throw new Error(`Layer ${layerId} does not exist`)
    const [layer] = entry.siblings.splice(entry.index, 1)
    if (!layer) throw new Error(`Layer ${layerId} could not be removed`)
    const removedIds = new Set(flattenIds([layer]))
    document.selectedLayerIds = document.selectedLayerIds.filter((id) => !removedIds.has(id))
    if (document.activeLayerId && removedIds.has(document.activeLayerId)) {
      const fallback = entry.siblings[Math.min(entry.index, entry.siblings.length - 1)]
      document.activeLayerId = fallback?.id ?? null
      document.selectedLayerIds = fallback ? [fallback.id] : []
    }
    this.changed(document)
    return { layer, parentId: entry.parentId, index: entry.index }
  }

  move(layerId: string, parentId: string | null, index: number): LayerLocation {
    const document = this.requireDocument()
    const source = findInTree(document.layers, layerId)
    if (!source) throw new Error(`Layer ${layerId} does not exist`)
    if (parentId === layerId || (parentId && containsLayer(source.layer, parentId))) {
      throw new Error('A layer cannot be moved inside itself')
    }
    const previous = { parentId: source.parentId, index: source.index }
    const [layer] = source.siblings.splice(source.index, 1)
    if (!layer) throw new Error(`Layer ${layerId} could not be moved`)
    const target = this.childrenOf(parentId)
    const adjusted = source.siblings === target && source.index < index ? index - 1 : index
    target.splice(clampIndex(adjusted, target.length), 0, layer)
    this.changed(document)
    return previous
  }

  rename(layerId: string, name: string): string {
    const layer = this.requireLayer(layerId)
    const next = name.trim()
    if (!next) throw new Error('Layer name cannot be empty')
    const previous = layer.name
    layer.name = next
    this.changed(this.requireDocument())
    return previous
  }

  setVisibility(layerId: string, visible: boolean): boolean {
    return this.setProperty(layerId, 'visible', visible)
  }

  setLocked(layerId: string, locked: boolean): boolean {
    return this.setProperty(layerId, 'locked', locked)
  }

  setOpacity(layerId: string, opacity: number): number {
    return this.setProperty(layerId, 'opacity', Math.min(1, Math.max(0, opacity)))
  }

  setBlendMode(layerId: string, blendMode: BlendMode): BlendMode {
    return this.setProperty(layerId, 'blendMode', blendMode)
  }

  setVectorStyle(layerId: string, style: VectorStyle): VectorStyle {
    const layer = this.requireLayer(layerId)
    if (layer.kind !== 'vector') throw new Error('The selected layer is not vector artwork')
    validateVectorStyle(style)
    const previous = structuredClone(layer.style)
    layer.style = structuredClone(style)
    this.changed(this.requireDocument())
    return previous
  }

  setVectorGeometry(layerId: string, geometry: VectorGeometry): VectorGeometry {
    const layer = this.requireLayer(layerId)
    if (layer.kind !== 'vector') throw new Error('The selected layer is not vector artwork')
    validateVectorGeometry(geometry)
    const previous = structuredClone(layer.geometry)
    layer.geometry = structuredClone(geometry)
    this.changed(this.requireDocument())
    return previous
  }

  duplicate(layerId: string): RemovedLayer {
    const source = this.requireLayer(layerId)
    const location = this.locationOf(layerId)
    if (!location) throw new Error(`Layer ${layerId} has no location`)
    const copy = cloneWithNewIds(source)
    copy.name = `${source.name} copy`
    const inserted = this.insert(copy, location.parentId, location.index + 1)
    return { layer: copy, ...inserted }
  }

  group(layerIds: readonly string[], name = 'Group'): RemovedLayer {
    const document = this.requireDocument()
    const uniqueIds = [...new Set(layerIds)]
    if (uniqueIds.length === 0) throw new Error('Select at least one layer to group')
    const entries = uniqueIds.map((id) => findInTree(document.layers, id))
    if (entries.some((entry) => !entry)) throw new Error('A selected layer no longer exists')
    const valid = entries.filter((entry): entry is LayerEntry => Boolean(entry))
    const parentId = valid[0]?.parentId ?? null
    if (valid.some((entry) => entry.parentId !== parentId)) throw new Error('Grouped layers must share the same parent')
    const siblings = valid[0]?.siblings ?? document.layers
    const indices = valid.map((entry) => entry.index).sort((a, b) => a - b)
    const selected = indices.map((index) => siblings[index]).filter((layer): layer is Layer => Boolean(layer))
    for (const index of [...indices].sort((a, b) => b - a)) siblings.splice(index, 1)
    const group: GroupLayer = {
      ...createLayerBase(createEntityId(), 'group', name), kind: 'group', children: selected,
    }
    const index = indices[0] ?? siblings.length
    siblings.splice(index, 0, group)
    document.selectedLayerIds = [group.id]
    document.activeLayerId = group.id
    this.changed(document)
    return { layer: group, parentId, index }
  }

  ungroup(groupId: string): RemovedLayer {
    const document = this.requireDocument()
    const entry = findInTree(document.layers, groupId)
    if (!entry || entry.layer.kind !== 'group') throw new Error('The selected layer is not a group')
    const matrix = layerLocalMatrix(entry.layer)
    const identity = matrix.every((value, index) => value === [1, 0, 0, 1, 0, 0][index])
    const children = identity ? entry.layer.children : cloneLayerTree(entry.layer.children).map(child => ({ ...child, transform: { ...IDENTITY_TRANSFORM }, svgMatrix: multiplyAffine(matrix, layerLocalMatrix(child)) }))
    entry.siblings.splice(entry.index, 1, ...children)
    document.selectedLayerIds = entry.layer.children.map((layer) => layer.id)
    document.activeLayerId = entry.layer.children.at(-1)?.id ?? null
    this.changed(document)
    return { layer: entry.layer, parentId: entry.parentId, index: entry.index }
  }

  regroup(group: GroupLayer, parentId: string | null, index: number): void {
    const document = this.requireDocument()
    for (const child of group.children) {
      const entry = findInTree(document.layers, child.id)
      if (entry) entry.siblings.splice(entry.index, 1)
    }
    const siblings = this.childrenOf(parentId)
    siblings.splice(clampIndex(index, siblings.length), 0, group)
    document.selectedLayerIds = [group.id]
    document.activeLayerId = group.id
    this.changed(document)
  }

  select(layerId: string, mode: SelectionMode): void {
    const document = this.requireDocument()
    if (!this.find(layerId)) return
    if (mode === 'replace') document.selectedLayerIds = [layerId]
    if (mode === 'add' && !document.selectedLayerIds.includes(layerId)) document.selectedLayerIds = [...document.selectedLayerIds, layerId]
    if (mode === 'toggle') {
      document.selectedLayerIds = document.selectedLayerIds.includes(layerId)
        ? document.selectedLayerIds.filter((id) => id !== layerId)
        : [...document.selectedLayerIds, layerId]
    }
    document.activeLayerId = document.selectedLayerIds.includes(layerId)
      ? layerId
      : (document.selectedLayerIds.at(-1) ?? null)
    document.revision += 1
    this.onSelectionChange(document)
  }

  private setProperty<K extends 'visible' | 'locked' | 'opacity' | 'blendMode'>(layerId: string, key: K, value: LayerBase[K]): LayerBase[K] {
    const layer: LayerBase = this.requireLayer(layerId)
    const previous = layer[key]
    layer[key] = value
    this.changed(this.requireDocument())
    return previous
  }

  private childrenOf(parentId: string | null): Layer[] {
    if (parentId === null) return this.requireDocument().layers
    const parent = this.requireLayer(parentId)
    if (parent.kind !== 'group') throw new Error('Layers can only be nested inside groups')
    return parent.children
  }

  private requireLayer(layerId: string): Layer {
    const layer = this.find(layerId)
    if (!layer) throw new Error(`Layer ${layerId} does not exist`)
    return layer
  }

  private requireDocument(): EditorDocument {
    const document = this.getDocument()
    if (!document) throw new Error('No document is open')
    return document
  }

  private changed(document: EditorDocument): void {
    document.touch()
    this.onChange(document)
  }
}

interface LayerEntry {
  layer: Layer
  siblings: Layer[]
  parentId: string | null
  index: number
}

function findInTree(layers: Layer[], id: string, parentId: string | null = null): LayerEntry | null {
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index]
    if (!layer) continue
    if (layer.id === id) return { layer, siblings: layers, parentId, index }
    if (layer.kind === 'group') {
      const nested = findInTree(layer.children, id, layer.id)
      if (nested) return nested
    }
  }
  return null
}

function containsLayer(layer: Layer, id: string): boolean {
  return layer.kind === 'group' && layer.children.some((child) => child.id === id || containsLayer(child, id))
}

function cloneWithNewIds(layer: Layer): Layer {
  if (layer.kind === 'group') {
    return { ...layer, id: createEntityId(), transform: { ...layer.transform }, adjustments: layer.adjustments.map(cloneWithNewId), children: layer.children.map(cloneWithNewIds) }
  }
  return { ...layer, id: createEntityId(), transform: { ...layer.transform }, adjustments: layer.adjustments.map(cloneWithNewId) }
}

function cloneWithNewId(adjustment: Layer['adjustments'][number]): Layer['adjustments'][number] {
  return { ...cloneAdjustment(adjustment), id: createEntityId() }
}

function flattenIds(layers: readonly Layer[]): string[] {
  return layers.flatMap((layer) => layer.kind === 'group' ? [layer.id, ...flattenIds(layer.children)] : [layer.id])
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length, Math.trunc(index)))
}
