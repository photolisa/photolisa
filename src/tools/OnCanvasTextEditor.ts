import type { EditorCore } from '../core/EditorCore'
import {
  propertiesOf,
  UpdateTextLayerCommand,
} from '../core/commands/TextCommands'
import { layerWorldMatrix } from '../core/geometry/LayerCoordinates'
import { textPixelSize } from '../raster/TextPainter'
import type { PixiViewportRenderer } from '../renderer/PixiViewportRenderer'

/** An accessible native input positioned in document space, including ancestor transforms. */
export class OnCanvasTextEditor {
  private input: HTMLTextAreaElement | null = null
  private id: string | null = null
  private editorAtOpen: EditorCore | null = null
  constructor(
    private host: HTMLElement,
    private renderer: PixiViewportRenderer,
    private getEditor: () => EditorCore,
    private onError: (message: string) => void,
  ) {}
  open(id: string): void {
    this.close(true)
    const editor = this.getEditor(),
      layer = editor.layers.find(id)
    if (!layer || layer.kind !== 'text' || layer.locked || !editor.document)
      return
    this.id = id
    this.editorAtOpen = editor
    const input = document.createElement('textarea')
    input.setAttribute('aria-label', 'Edit text on canvas')
    input.value = layer.text
    input.maxLength = 10000
    input.spellcheck = false
    Object.assign(input.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      zIndex: '40',
      transformOrigin: '0 0',
      boxSizing: 'border-box',
      background: '#ffffffed',
      color: layer.color,
      border: '1px solid #4c9ffe',
      outline: 'none',
      resize: 'none',
      overflow: 'auto',
      fontFamily: layer.fontFamily,
      fontSize: `${layer.fontSize}px`,
      fontWeight: String(layer.fontWeight),
      fontStyle: layer.fontStyle,
      lineHeight: String(layer.lineSpacing),
      textAlign: layer.alignment,
    })
    this.input = input
    input.addEventListener('keydown', this.onKeyDown)
    input.addEventListener('blur', this.onBlur)
    this.host.append(input)
    this.refresh()
    input.focus({ preventScroll: true })
    input.select()
    editor.setTextEditing(id)
  }
  refresh(): void {
    const editor = this.editorAtOpen,
      input = this.input,
      layer = this.id ? editor?.layers.find(this.id) : null
    if (!input || layer?.kind !== 'text' || !editor?.document) return
    const matrix = layerWorldMatrix(editor.document.layers, layer.id)
    if (!matrix) return
    const position = this.renderer.documentToScreen({
        x: matrix[4],
        y: matrix[5],
      }),
      zoom = this.renderer.getZoom(),
      size = textPixelSize(layer)
    input.style.width = `${Math.max(80, size.width)}px`
    input.style.height = `${Math.max(layer.fontSize * 2, size.height)}px`
    input.style.padding = `${size.padding}px`
    input.style.transform = `matrix(${matrix[0] * zoom}, ${matrix[1] * zoom}, ${matrix[2] * zoom}, ${matrix[3] * zoom}, ${position.x}, ${position.y})`
  }
  close(commit: boolean): void {
    const input = this.input,
      editor = this.editorAtOpen,
      id = this.id
    if (!input) return
    this.input = null
    this.id = null
    this.editorAtOpen = null
    input.removeEventListener('keydown', this.onKeyDown)
    input.removeEventListener('blur', this.onBlur)
    const layer = id ? editor?.layers.find(id) : null
    if (
      commit &&
      editor &&
      layer?.kind === 'text' &&
      input.value !== layer.text &&
      !layer.locked
    ) {
      try {
        editor.execute(
          new UpdateTextLayerCommand(layer.id, {
            ...propertiesOf(layer),
            text: input.value,
          }),
        )
      } catch (error) {
        this.onError(
          error instanceof Error ? error.message : 'Text edit failed',
        )
      }
    }
    input.remove()
    editor?.setTextEditing(null)
    this.renderer.scheduleRefreshDocument()
  }
  destroy(): void {
    this.close(true)
  }
  private onBlur = (): void => {
    this.close(true)
  }
  private onKeyDown = (event: KeyboardEvent): void => {
    // Text editing owns shortcuts while its input is focused.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close(false)
      this.renderer.getCanvas().focus()
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      this.close(true)
      this.renderer.getCanvas().focus()
    }
  }
}
