import type { EditorCore } from '../EditorCore'
import { cloneLayerTree, createEntityId } from '../model/EditorDocument'
import {
  IDENTITY_TRANSFORM,
  type Layer,
  type AffineMatrix,
} from '../model/types'
import {
  IDENTITY_MATRIX,
  layerLocalMatrix,
  multiplyAffine,
} from '../geometry/LayerCoordinates'
import { CopyLayersCommand } from '../commands/CopyLayersCommand'
import { MoveLayersCommand } from '../commands/MoveLayersCommand'

/** Application clipboard keeps original vector data across independent document tabs. */
export class VectorClipboard {
  private contents: Layer[] = []
  get hasContents(): boolean {
    return this.contents.length > 0
  }
  clear(): void {
    this.contents = []
  }
  canCopy(editor: EditorCore): boolean {
    return this.selectedRoots(editor).length > 0
  }
  copy(editor: EditorCore, cut = false): boolean {
    const roots = this.selectedRoots(editor)
    if (!roots.length) return false
    const copied = roots.map(({ layer, world }) => {
      const copy = cloneLayerTree([layer])[0]!
      copy.transform = { ...IDENTITY_TRANSFORM }
      copy.svgMatrix = [...world]
      return copy
    })
    if (JSON.stringify(copied).length > 8_000_000)
      throw new Error('Vector clipboard exceeds the 8 MiB geometry budget')
    if (cut && roots.some((root) => root.layer.locked))
      throw new Error('Locked vector layers cannot be cut')
    this.contents = copied
    if (cut)
      editor.execute(new MoveLayersCommand(roots.map((root) => root.layer.id)))
    return true
  }
  paste(editor: EditorCore): boolean {
    if (!this.contents.length || !editor.document) return false
    const copied = cloneLayerTree(this.contents).map(remapIds)
    editor.execute(new CopyLayersCommand(copied))
    return true
  }
  delete(editor: EditorCore): boolean {
    const roots = this.selectedRoots(editor)
    if (!roots.length || roots.some((root) => root.layer.locked)) return false
    editor.execute(new MoveLayersCommand(roots.map((root) => root.layer.id)))
    return true
  }
  private selectedRoots(
    editor: EditorCore,
  ): Array<{ layer: Layer; world: AffineMatrix }> {
    const doc = editor.document
    if (!doc || editor.selection || !doc.selectedLayerIds.length) return []
    let invalid = false
    const selected = new Set(doc.selectedLayerIds),
      result: Array<{ layer: Layer; world: AffineMatrix }> = []
    const visit = (layers: readonly Layer[], parent: AffineMatrix): void => {
      for (const layer of layers) {
        const world = multiplyAffine(parent, layerLocalMatrix(layer))
        if (selected.has(layer.id)) {
          if (vectorTree(layer)) result.push({ layer, world })
          else invalid = true
          continue
        }
        if (layer.kind === 'group') visit(layer.children, world)
      }
    }
    visit(doc.layers, IDENTITY_MATRIX)
    return invalid ? [] : result
  }
}
function vectorTree(layer: Layer): boolean {
  return (
    !layer.mask &&
    (layer.kind === 'vector' ||
      (layer.kind === 'group' && layer.children.every(vectorTree)))
  )
}
function remapIds(layer: Layer): Layer {
  return layer.kind === 'group'
    ? { ...layer, id: createEntityId(), children: layer.children.map(remapIds) }
    : { ...layer, id: createEntityId() }
}
