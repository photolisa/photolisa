import type { Command } from './Command'
import type { EditorCore } from '../EditorCore'
import { createEntityId } from '../model/EditorDocument'
import { createLayerBase, type TextLayer } from '../model/types'

export type TextProperties = Pick<TextLayer, 'text' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'alignment' | 'color' | 'lineSpacing'>

export const DEFAULT_TEXT: TextProperties = {
  text: 'Text', fontFamily: 'Arial', fontSize: 48, fontWeight: 400, fontStyle: 'normal', alignment: 'left', color: '#000000', lineSpacing: 1.2,
}

export class AddTextLayerCommand implements Command {
  readonly label = 'Add Text Layer'
  private layer: TextLayer | null = null
  private index: number | undefined
  constructor(private readonly x: number, private readonly y: number, private readonly properties: TextProperties = DEFAULT_TEXT) {}
  execute(editor: EditorCore): void {
    if (!this.layer) {
      this.layer = { ...createLayerBase(createEntityId(), 'text', 'Text'), kind: 'text', ...this.properties }
      this.layer.transform.x = this.x; this.layer.transform.y = this.y
    }
    this.index = editor.layers.insert(this.layer, null, this.index).index
  }
  undo(editor: EditorCore): void { if (this.layer) editor.layers.remove(this.layer.id) }
}

export class UpdateTextLayerCommand implements Command {
  readonly label = 'Edit Text'
  private before: TextProperties | null = null
  constructor(private readonly layerId: string, private readonly after: TextProperties) {}
  execute(editor: EditorCore): void {
    const layer = editor.layers.find(this.layerId)
    if (!layer || layer.kind !== 'text' || layer.locked) throw new Error('Select an unlocked text layer')
    this.before ??= propertiesOf(layer)
    Object.assign(layer, this.after)
    editor.markDocumentChanged()
  }
  undo(editor: EditorCore): void {
    const layer = editor.layers.find(this.layerId)
    if (!layer || layer.kind !== 'text' || !this.before) return
    Object.assign(layer, this.before)
    editor.markDocumentChanged()
  }
}

export function propertiesOf(layer: TextLayer): TextProperties {
  return { text: layer.text, fontFamily: layer.fontFamily, fontSize: layer.fontSize, fontWeight: layer.fontWeight,
    fontStyle: layer.fontStyle, alignment: layer.alignment, color: layer.color, lineSpacing: layer.lineSpacing }
}
