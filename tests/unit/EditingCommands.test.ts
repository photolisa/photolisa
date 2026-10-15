import { beforeEach, describe, expect, it } from 'vitest'
import { CreateDocumentCommand } from '../../src/core/commands/CreateDocumentCommand'
import { CropDocumentCommand, SetLayerTransformCommand } from '../../src/core/commands/EditingCommands'
import { EditorCore } from '../../src/core/EditorCore'

describe('editing commands', () => {
  let editor: EditorCore

  beforeEach(() => {
    editor = new EditorCore()
    editor.execute(new CreateDocumentCommand({ name: 'Edit', width: 320, height: 240, resolution: 72, background: 'transparent' }))
    editor.history.clear()
  })

  it('undoes and redoes a layer transform without replacing the layer', () => {
    const layer = editor.document?.layers[0]
    if (!layer) throw new Error('Expected a layer')
    const identity = { ...layer.transform }
    const transformed = { x: 18, y: -7, scaleX: 1.5, scaleY: 0.75, rotation: Math.PI / 4 }

    editor.execute(new SetLayerTransformCommand(layer.id, identity, transformed))
    expect(layer.transform).toEqual(transformed)
    editor.undo()
    expect(layer.transform).toEqual(identity)
    editor.redo()
    expect(layer.transform).toEqual(transformed)
  })

  it('crops at document resolution and restores dimensions and offsets on undo', () => {
    const document = editor.document
    const layer = document?.layers[0]
    if (!document || !layer) throw new Error('Expected a document')
    layer.transform.x = 30
    layer.transform.y = 20

    editor.execute(new CropDocumentCommand({ x: 10, y: 5, width: 101.6, height: 80.4 }))
    expect(document.dimensions).toMatchObject({ width: 102, height: 80 })
    expect(layer.transform).toMatchObject({ x: 20, y: 15 })

    editor.undo()
    expect(document.dimensions).toMatchObject({ width: 320, height: 240 })
    expect(layer.transform).toMatchObject({ x: 30, y: 20 })
    editor.redo()
    expect(document.dimensions).toMatchObject({ width: 102, height: 80 })
  })
})
