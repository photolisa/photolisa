import type { EditorCore } from '../EditorCore'
import type { Command } from './Command'
import type { VectorGeometry, VectorStyle, VectorLayer } from '../model/types'
import type { LayerLocation } from '../layers/LayerManager'
import { createEntityId } from '../model/EditorDocument'
import { createLayerBase } from '../model/types'

export class AddShapeCommand implements Command {
  readonly label = 'Create Shape'
  private layer: VectorLayer | null = null
  private location: LayerLocation | null = null
  constructor(private readonly name: string, private readonly x: number, private readonly y: number, private readonly geometry: VectorGeometry, private readonly style: VectorStyle, private readonly opacity: number, private readonly parentId: string | null = null) {}
  execute(editor: EditorCore): void {
    this.layer ??= { ...createLayerBase(createEntityId(), 'vector', this.name), kind: 'vector', transform: { x: this.x, y: this.y, scaleX: 1, scaleY: 1, rotation: 0 }, geometry: structuredClone(this.geometry), style: structuredClone(this.style), opacity: this.opacity }
    this.location = editor.layers.insert(this.layer, this.location?.parentId ?? this.parentId, this.location?.index)
  }
  undo(editor: EditorCore): void { if (this.layer) editor.layers.remove(this.layer.id) }
}

export class SetVectorStyleCommand implements Command {
  readonly label = 'Vector Style'
  private previous: VectorStyle | null = null
  constructor(private readonly layerId: string, private readonly style: VectorStyle) {}
  execute(editor: EditorCore): void { this.previous = editor.layers.setVectorStyle(this.layerId, this.style) }
  undo(editor: EditorCore): void { if (this.previous) editor.layers.setVectorStyle(this.layerId, this.previous) }
}

export class SetVectorGeometryCommand implements Command {
  readonly label = 'Vector Geometry'
  private previous: VectorGeometry | null = null
  constructor(private readonly layerId: string, private readonly geometry: VectorGeometry) {}
  execute(editor: EditorCore): void { this.previous = editor.layers.setVectorGeometry(this.layerId, this.geometry) }
  undo(editor: EditorCore): void { if (this.previous) editor.layers.setVectorGeometry(this.layerId, this.previous) }
}
