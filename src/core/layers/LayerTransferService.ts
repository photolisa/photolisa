import type { EditorCore } from '../EditorCore'
import { CopyLayersCommand } from '../commands/CopyLayersCommand'
import { MoveLayersCommand } from '../commands/MoveLayersCommand'
import { createEntityId } from '../model/EditorDocument'
import { cloneLayerTree } from '../model/EditorDocument'
import type { Layer } from '../model/types'

export type TransferMode = 'copy' | 'move' | 'duplicate'
export interface LayerAssetTransfer {
  /** Return a safe destination reference; immutable sources may be shared. */
  prepare(sourceId: string): string
  /** Discard a prepared reference if the transfer never commits. */
  rollback(sourceId: string): void
  /** Estimated private pixel allocation, used for aggregate preflight. */
  copyBytes?(sourceId: string): number
}
export interface LayerTransferRequest {
  source: EditorCore
  destination: EditorCore
  layerIds: readonly string[]
  mode: TransferMode
  centerInDestination?: boolean
  parentId?: string | null
}
export interface LayerTransferResult { sourceIds: string[]; destinationIds: string[] }

/** Coordinates two independent document histories without mutating source until destination insertion succeeds. */
export class LayerTransferService {
  constructor(private readonly assets: LayerAssetTransfer) {}

  transfer(request: LayerTransferRequest): LayerTransferResult {
    const { source, destination } = request
    const sourceDocument = source.document
    const targetDocument = destination.document
    if (!sourceDocument || !targetDocument) throw new Error('Both projects must be open')
    if (source === destination || sourceDocument.id === targetDocument.id) throw new Error('Choose a different destination project')
    if (!request.layerIds.length) throw new Error('Select at least one layer')
    const selected = new Set(request.layerIds)
    const roots: Layer[] = []
    const found = new Set<string>()
    collectRoots(sourceDocument.layers, selected, roots, found)
    if (found.size !== selected.size) throw new Error('One or more selected layers no longer exist')
    if (request.parentId !== undefined && request.parentId !== null && destination.layers.find(request.parentId)?.kind !== 'group') {
      throw new Error('Destination parent must be a group')
    }
    const rootIds = roots.map((layer) => layer.id)
    const assetIds = new Set<string>()
    roots.forEach((layer) => collectAssets(layer, assetIds))
    let allocationBytes = 0
    for (const id of assetIds) {
      allocationBytes += this.assets.copyBytes?.(id) ?? 0
      if (!Number.isSafeInteger(allocationBytes) || allocationBytes > 512 * 1024 * 1024) throw new Error('Transfer requires too much pixel memory')
    }
    const sourceBefore = snapshot(source)
    const destinationBefore = snapshot(destination)
    const newAssetIds: string[] = []
    const mappedAssets = new Map<string, string>()
    let sourceTransaction = false
    let destinationTransaction = false
    try {
      const dx = request.centerInDestination ? (targetDocument.dimensions.width - sourceDocument.dimensions.width) / 2 : 0
      const dy = request.centerInDestination ? (targetDocument.dimensions.height - sourceDocument.dimensions.height) / 2 : 0
      const prepared = cloneLayerTree(roots).map((layer) => remap(layer, true, dx, dy, (id) => {
        let mapped = mappedAssets.get(id)
        if (!mapped) {
          mapped = this.assets.prepare(id)
          mappedAssets.set(id, mapped)
          if (mapped !== id) newAssetIds.push(mapped)
        }
        return mapped
      }))
      if (request.mode === 'duplicate') prepared.forEach((layer) => { layer.name = `${layer.name} copy` })
      if (request.mode === 'move') { source.beginTransaction('Move Layers to Project'); sourceTransaction = true }
      destination.beginTransaction(request.mode === 'move' ? 'Receive Moved Layers' : request.mode === 'duplicate' ? 'Duplicate Layers to Project' : 'Copy Layers to Project')
      destinationTransaction = true
      destination.execute(new CopyLayersCommand(prepared, request.parentId ?? null))
      if (request.mode === 'move') source.execute(new MoveLayersCommand(rootIds))
      destination.commitTransaction(); destinationTransaction = false
      if (sourceTransaction) { source.commitTransaction(); sourceTransaction = false }
      return { sourceIds: rootIds, destinationIds: prepared.map((layer) => layer.id) }
    } catch (error) {
      if (sourceTransaction) source.cancelTransaction()
      if (destinationTransaction) destination.cancelTransaction()
      restoreSnapshot(source, sourceBefore)
      restoreSnapshot(destination, destinationBefore)
      // All inserted trees were rolled back before their prepared assets are discarded.
      for (const id of newAssetIds) this.assets.rollback(id)
      throw error
    }
  }
}

function collectAssets(layer: Layer, ids: Set<string>): void {
  if (layer.mask) ids.add(layer.mask.pixelSourceId)
  if (layer.kind === 'raster' && layer.pixelSourceId) ids.add(layer.pixelSourceId)
  if (layer.kind === 'group') layer.children.forEach((child) => collectAssets(child, ids))
}

function snapshot(editor: EditorCore): { revision: number; modifiedAt: string; dirty: boolean } {
  const document = editor.document!
  return { revision: document.revision, modifiedAt: document.metadata.modifiedAt, dirty: editor.isDirty }
}

function restoreSnapshot(editor: EditorCore, before: ReturnType<typeof snapshot>): void {
  const document = editor.document
  if (!document) return
  document.revision = before.revision
  document.metadata.modifiedAt = before.modifiedAt
  if (!before.dirty) editor.markSaved()
  editor.events.emit('document:changed', document)
}

function collectRoots(layers: readonly Layer[], selected: ReadonlySet<string>, roots: Layer[], found: Set<string>, insideSelected = false): void {
  for (const layer of layers) {
    const picked = selected.has(layer.id)
    if (picked) { found.add(layer.id); if (!insideSelected) roots.push(layer) }
    if (layer.kind === 'group') collectRoots(layer.children, selected, roots, found, insideSelected || picked)
  }
}

function remap(layer: Layer, root: boolean, dx: number, dy: number, asset: (id: string) => string): Layer {
  const base = {
    ...layer, id: createEntityId(),
    adjustments: layer.adjustments.map((adjustment) => ({ ...adjustment, id: createEntityId() })),
    transform: { ...layer.transform, x: layer.transform.x + (root ? dx : 0), y: layer.transform.y + (root ? dy : 0) },
    mask: layer.mask ? { ...layer.mask, pixelSourceId: asset(layer.mask.pixelSourceId) } : null,
  }
  if (layer.kind === 'group') return { ...base, kind: 'group', children: layer.children.map((child) => remap(child, false, 0, 0, asset)) }
  if (layer.kind === 'raster') return { ...base, kind: 'raster', pixelSourceId: layer.pixelSourceId ? asset(layer.pixelSourceId) : null }
  if (layer.kind === 'text') return { ...base, kind: 'text', text: layer.text, fontFamily: layer.fontFamily, fontSize: layer.fontSize,
    fontWeight: layer.fontWeight, fontStyle: layer.fontStyle, alignment: layer.alignment, color: layer.color, lineSpacing: layer.lineSpacing }
  return { ...base, kind: 'vector', geometry: layer.geometry, style: layer.style }
}
