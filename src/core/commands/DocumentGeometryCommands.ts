import type { Command } from './Command'
import type { EditorCore } from '../EditorCore'
import { IDENTITY_TRANSFORM, type AffineMatrix, type Layer, type LayerTransform } from '../model/types'
import type { SelectionMask } from '../selection/SelectionMask'
import { layerLocalMatrix, multiplyAffine } from '../geometry/LayerCoordinates'

export type CanvasAnchor = 'top-left' | 'center'
export type CanvasOperation = 'rotate-cw' | 'rotate-ccw' | 'flip-horizontal' | 'flip-vertical'

interface LayerState { transform: LayerTransform; svgMatrix?: AffineMatrix }

export class CanvasSizeCommand implements Command {
  readonly label = 'Canvas Size'
  private before: { width: number; height: number; selection: SelectionMask | null; layers: Map<string, LayerState> } | null = null
  constructor(private readonly width: number, private readonly height: number, private readonly anchor: CanvasAnchor) {}
  execute(editor: EditorCore): void {
    const doc = editor.document
    if (!doc) throw new Error('Open a document first')
    validateDimensions(this.width, this.height)
    this.before ??= capture(editor)
    const dx = this.anchor === 'center' ? Math.round((this.width - this.before.width) / 2) : 0
    const dy = this.anchor === 'center' ? Math.round((this.height - this.before.height) / 2) : 0
    doc.dimensions.width = this.width; doc.dimensions.height = this.height
    doc.layers.forEach((layer) => {
      const previous = this.before!.layers.get(layer.id)!
      layer.transform = { ...previous.transform, x: previous.transform.x + dx, y: previous.transform.y + dy }
      if (previous.svgMatrix) layer.svgMatrix = [...previous.svgMatrix]
      else delete layer.svgMatrix
    })
    editor.setSelection(null)
    editor.markDocumentChanged()
  }
  undo(editor: EditorCore): void { if (this.before) restore(editor, this.before) }
}

export class RotateFlipCanvasCommand implements Command {
  readonly label: string
  private before: ReturnType<typeof capture> | null = null
  constructor(private readonly operation: CanvasOperation) { this.label = operation.replaceAll('-', ' ') }
  execute(editor: EditorCore): void {
    const doc = editor.document
    if (!doc) throw new Error('Open a document first')
    this.before ??= capture(editor)
    const { width, height } = this.before
    const matrix: AffineMatrix = this.operation === 'rotate-cw' ? [0, 1, -1, 0, height, 0]
      : this.operation === 'rotate-ccw' ? [0, -1, 1, 0, 0, width]
        : this.operation === 'flip-horizontal' ? [-1, 0, 0, 1, width, 0]
          : [1, 0, 0, -1, 0, height]
    const rotated = this.operation === 'rotate-cw' || this.operation === 'rotate-ccw'
    doc.dimensions.width = rotated ? height : width
    doc.dimensions.height = rotated ? width : height
    doc.layers.forEach((layer) => {
      const previous = this.before!.layers.get(layer.id)!
      const original: Layer = { ...layer, transform: previous.transform }
      if (previous.svgMatrix) original.svgMatrix = previous.svgMatrix
      else delete original.svgMatrix
      layer.transform = { ...IDENTITY_TRANSFORM }
      layer.svgMatrix = multiplyAffine(matrix, layerLocalMatrix(original))
    })
    editor.setSelection(null)
    editor.markDocumentChanged()
  }
  undo(editor: EditorCore): void { if (this.before) restore(editor, this.before) }
}

function capture(editor: EditorCore) {
  const doc = editor.document!
  return { width: doc.dimensions.width, height: doc.dimensions.height, selection: editor.selection,
    layers: new Map(doc.layers.map((layer) => [layer.id, { transform: { ...layer.transform }, ...(layer.svgMatrix ? { svgMatrix: [...layer.svgMatrix] as AffineMatrix } : {}) }])) }
}

function restore(editor: EditorCore, before: ReturnType<typeof capture>): void {
  const doc = editor.document
  if (!doc) return
  doc.dimensions.width = before.width; doc.dimensions.height = before.height
  doc.layers.forEach((layer) => {
    const previous = before.layers.get(layer.id)
    if (!previous) return
    layer.transform = { ...previous.transform }
    if (previous.svgMatrix) layer.svgMatrix = [...previous.svgMatrix]
    else delete layer.svgMatrix
  })
  editor.setSelection(before.selection)
  editor.markDocumentChanged()
}

export function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16_384 || height > 16_384 || width * height > 67_108_864)
    throw new Error('Image dimensions must be 1–16,384 pixels on each side and at most 67 million pixels')
}
