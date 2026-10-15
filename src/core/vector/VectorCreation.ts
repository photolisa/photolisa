import type { EditorCore } from '../EditorCore'
import type { VectorGeometry, VectorStyle } from '../model/types'
import {
  AddShapeCommand,
  SetVectorGeometryCommand,
} from '../commands/VectorCommands'
import {
  invertAffine,
  layerWorldMatrix,
  multiplyAffine,
  IDENTITY_MATRIX,
} from '../geometry/LayerCoordinates'
import { toPathData, transformGeometryPath } from './PathGeometry'

export function createVectorArtwork(
  editor: EditorCore,
  name: string,
  x: number,
  y: number,
  geometry: VectorGeometry,
  style: VectorStyle,
  opacity: number,
  mode: 'layer' | 'compound',
): void {
  const document = editor.document
  if (!document) return
  const active = document.activeLayerId
    ? editor.layers.find(document.activeLayerId)
    : null
  if (mode === 'compound') {
    if (active?.kind !== 'vector' || active.locked || !active.visible)
      throw new Error(
        'Select a visible unlocked vector layer before adding a subpath',
      )
    const world =
      layerWorldMatrix(document.layers, active.id) ?? IDENTITY_MATRIX
    const matrix = multiplyAffine(invertAffine(world), [1, 0, 0, 1, x, y])
    editor.execute(
      new SetVectorGeometryCommand(active.id, {
        type: 'path',
        d: `${toPathData(active.geometry)} ${transformGeometryPath(geometry, matrix)}`,
      }),
    )
    return
  }
  if (
    active?.kind === 'group' &&
    !active.locked &&
    active.visible &&
    !active.booleanOperation
  ) {
    const world =
      layerWorldMatrix(document.layers, active.id) ?? IDENTITY_MATRIX
    const matrix = multiplyAffine(invertAffine(world), [1, 0, 0, 1, x, y])
    editor.execute(
      new AddShapeCommand(
        name,
        0,
        0,
        { type: 'path', d: transformGeometryPath(geometry, matrix) },
        style,
        opacity,
        active.id,
      ),
    )
  } else
    editor.execute(new AddShapeCommand(name, x, y, geometry, style, opacity))
}
