import type { EditorCore } from '../EditorCore'
import { multiplyAffine } from '../geometry/LayerCoordinates'
import { createEntityId } from '../model/EditorDocument'
import { createLayerBase, type AffineMatrix, type GroupLayer, type VectorLayer } from '../model/types'
import type { Command } from './Command'

export class VectorizeRasterCommand implements Command {
  readonly label = 'Vectorize Raster Layer'
  readonly memoryCost: number
  private group: GroupLayer | null = null
  private oldVisibility: boolean | null = null

  constructor(
    private readonly sourceId: string,
    private readonly children: VectorLayer[],
    private readonly traceWidth: number,
    private readonly traceHeight: number,
    private readonly sourceWidth: number,
    private readonly sourceHeight: number,
  ) { this.memoryCost = JSON.stringify(children).length * 2 }

  execute(editor: EditorCore): void {
    const source = editor.layers.find(this.sourceId)
    if (!source || source.kind !== 'raster' || source.locked || !source.visible) throw new Error('Select an unlocked, visible raster layer to vectorize.')
    const location = editor.layers.locationOf(this.sourceId)
    if (!location) throw new Error('The raster layer is no longer in the document.')
    this.oldVisibility ??= source.visible
    if (!this.group) {
      const scale: AffineMatrix = [this.sourceWidth / this.traceWidth, 0, 0, this.sourceHeight / this.traceHeight, 0, 0]
      this.group = {
        ...createLayerBase(createEntityId(), 'group', `${source.name} vector`),
        kind: 'group', children: this.children,
        transform: { ...source.transform },
        svgMatrix: source.svgMatrix ? multiplyAffine(source.svgMatrix, scale) : scale,
        opacity: source.opacity, blendMode: source.blendMode,
      }
    }
    editor.layers.insert(this.group, location.parentId, location.index + 1)
    editor.layers.setVisibility(this.sourceId, false)
  }

  undo(editor: EditorCore): void {
    if (!this.group) return
    if (this.oldVisibility !== null) editor.layers.setVisibility(this.sourceId, this.oldVisibility)
    editor.layers.remove(this.group.id)
  }
}
