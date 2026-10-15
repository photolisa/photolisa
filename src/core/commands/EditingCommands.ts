import type { Command } from './Command'
import type { EditorCore } from '../EditorCore'
import type { LayerTransform } from '../model/types'
import type { SelectionMask } from '../selection/SelectionMask'

export interface CropRect { x: number; y: number; width: number; height: number }

export class SetLayerTransformCommand implements Command {
  readonly label = 'Transform Layer'
  constructor(
    private readonly layerId: string,
    private readonly before: LayerTransform,
    private readonly after: LayerTransform,
  ) {}
  execute(editor: EditorCore): void { this.apply(editor, this.after) }
  undo(editor: EditorCore): void { this.apply(editor, this.before) }
  private apply(editor: EditorCore, value: LayerTransform): void {
    const layer = editor.layers.find(this.layerId)
    if (!layer) return
    Object.assign(layer.transform, value)
    editor.markDocumentChanged()
  }
}

export class CropDocumentCommand implements Command {
  readonly label = 'Crop Document'
  private readonly beforeTransforms = new Map<string, LayerTransform>()
  private beforeWidth = 0
  private beforeHeight = 0
  private beforeSelection: SelectionMask | null = null
  private initialized = false

  constructor(private readonly crop: CropRect) {}

  execute(editor: EditorCore): void {
    const document = editor.document
    if (!document) return
    if (!this.initialized) {
      this.beforeWidth = document.dimensions.width
      this.beforeHeight = document.dimensions.height
      this.beforeSelection = editor.selection
      document.layers.forEach((layer) => this.beforeTransforms.set(layer.id, { ...layer.transform }))
      this.initialized = true
    }
    document.dimensions.width = Math.max(1, Math.round(this.crop.width))
    document.dimensions.height = Math.max(1, Math.round(this.crop.height))
    editor.setSelection(null)
    document.layers.forEach((layer) => {
      const before = this.beforeTransforms.get(layer.id)
      if (before) Object.assign(layer.transform, { ...before, x: before.x - this.crop.x, y: before.y - this.crop.y })
    })
    editor.markDocumentChanged()
  }

  undo(editor: EditorCore): void {
    const document = editor.document
    if (!document || !this.initialized) return
    document.dimensions.width = this.beforeWidth
    document.dimensions.height = this.beforeHeight
    editor.setSelection(this.beforeSelection)
    document.layers.forEach((layer) => {
      const before = this.beforeTransforms.get(layer.id)
      if (before) Object.assign(layer.transform, before)
    })
    editor.markDocumentChanged()
  }
}
