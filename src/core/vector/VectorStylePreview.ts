import type { EditorCore } from '../EditorCore'
import type { VectorLayer, VectorStyle } from '../model/types'
import { validateVectorStyle } from '../model/VectorGeometry'
import { SetVectorStyleCommand } from '../commands/VectorCommands'
/** Owns a single reversible paint preview; UI never mutates its layer props. */
export class VectorStylePreview {
  private session: {
    editor: EditorCore
    layer: VectorLayer
    before: VectorStyle
  } | null = null
  update(
    editor: EditorCore,
    layerId: string,
    patch: Partial<VectorStyle>,
  ): void {
    const layer = editor.layers.find(layerId)
    if (layer?.kind !== 'vector' || layer.locked) return
    if (
      this.session &&
      (this.session.editor !== editor || this.session.layer !== layer)
    )
      this.cancel()
    const style = { ...layer.style, ...patch }
    validateVectorStyle(style)
    this.session ??= { editor, layer, before: structuredClone(layer.style) }
    layer.style = style
    if (editor.document) editor.document.revision++
    editor.events.emit('document:changed', editor.document)
  }
  commit(): void {
    if (!this.session) return
    const { editor, layer, before } = this.session,
      after = structuredClone(layer.style)
    this.session = null
    layer.style = before
    editor.execute(new SetVectorStyleCommand(layer.id, after))
  }
  cancel(): void {
    if (!this.session) return
    const { editor, layer, before } = this.session
    this.session = null
    layer.style = before
    editor.events.emit('document:changed', editor.document)
  }
}
