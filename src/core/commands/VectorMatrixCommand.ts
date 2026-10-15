import type { EditorCore } from '../EditorCore'
import type { Command } from './Command'
import type { AffineMatrix, LayerTransform } from '../model/types'
export interface MatrixState {
  transform: LayerTransform
  matrix: AffineMatrix | null
}
export class VectorMatrixCommand implements Command {
  readonly label = 'Transform Vector Selection'
  constructor(
    private id: string,
    private before: MatrixState,
    private after: MatrixState,
  ) {}
  execute(editor: EditorCore): void {
    this.apply(editor, this.after)
  }
  undo(editor: EditorCore): void {
    this.apply(editor, this.before)
  }
  private apply(editor: EditorCore, state: MatrixState): void {
    const layer = editor.layers.find(this.id)
    if (!layer) return
    layer.transform = { ...state.transform }
    if (state.matrix) layer.svgMatrix = [...state.matrix]
    else delete layer.svgMatrix
    editor.markDocumentChanged()
  }
}
