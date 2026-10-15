import type { EditorCore } from '../EditorCore'
import type { Command } from './Command'
import { CopyLayersCommand } from './CopyLayersCommand'
import { MoveLayersCommand } from './MoveLayersCommand'
import { createEntityId } from '../model/EditorDocument'
import { createLayerBase, type VectorLayer } from '../model/types'
import {
  joinOpenPaths,
  readSubpaths,
  transformGeometryPath,
  writeSubpaths,
} from '../vector/PathGeometry'
import { layerLocalMatrix } from '../geometry/LayerCoordinates'

export class JoinVectorLayersCommand implements Command {
  readonly label = 'Join Vector Paths'
  private copy: CopyLayersCommand | null = null
  private remove: MoveLayersCommand | null = null
  constructor(private ids: readonly string[]) {}
  execute(editor: EditorCore): void {
    if (!this.copy || !this.remove) {
      const layers = this.ids.map((id) => editor.layers.find(id))
      if (
        layers.length < 2 ||
        layers.some((layer) => layer?.kind !== 'vector' || layer.locked)
      )
        throw new Error('Select at least two unlocked vector paths')
      const vectors = layers as VectorLayer[],
        location = editor.layers.locationOf(vectors[0]!.id)!
      if (
        vectors.some(
          (layer) =>
            editor.layers.locationOf(layer.id)?.parentId !== location.parentId,
        )
      )
        throw new Error('Joined paths must share the same parent')
      const paths = vectors.flatMap((layer) =>
        readSubpaths({
          type: 'path',
          d: transformGeometryPath(layer.geometry, layerLocalMatrix(layer)),
        }),
      )
      const geometry = {
        type: 'path' as const,
        d: writeSubpaths(joinOpenPaths(paths)),
      }
      const joined: VectorLayer = {
        ...createLayerBase(createEntityId(), 'vector', 'Joined Path'),
        kind: 'vector',
        geometry,
        style: structuredClone(vectors[0]!.style),
        opacity: vectors[0]!.opacity,
      }
      this.copy = new CopyLayersCommand(
        [joined],
        location.parentId,
        location.index,
      )
      this.remove = new MoveLayersCommand(this.ids)
    }
    this.copy.execute(editor)
    try {
      this.remove.execute(editor)
    } catch (error) {
      this.copy.undo(editor)
      throw error
    }
  }
  undo(editor: EditorCore): void {
    this.remove?.undo(editor)
    this.copy?.undo(editor)
  }
}
