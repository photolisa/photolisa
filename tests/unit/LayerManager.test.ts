import { beforeEach, describe, expect, it } from 'vitest'
import { CreateDocumentCommand } from '../../src/core/commands/CreateDocumentCommand'
import {
  AddEmptyLayerCommand,
  GroupLayersCommand,
  MoveLayerCommand,
  RenameLayerCommand,
  SetLayerOpacityCommand,
  SetLayerVisibilityCommand,
  UngroupLayerCommand,
} from '../../src/core/commands/LayerCommands'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'

const options = { name: 'Layers', width: 800, height: 600, resolution: 72, background: 'transparent' as const }

describe('LayerManager', () => {
  let editor: EditorCore

  beforeEach(() => {
    editor = new EditorCore()
    editor.execute(new CreateDocumentCommand(options))
  })

  it('creates at least ten independent layers and reorders them', () => {
    for (let index = 2; index <= 10; index += 1) editor.execute(new AddEmptyLayerCommand(null, `Layer ${index}`))
    const document = editor.document
    expect(document?.layers).toHaveLength(10)
    expect(new Set(document?.layers.map((layer) => layer.id)).size).toBe(10)

    const firstId = document?.layers[0]?.id
    if (!firstId || !document) throw new Error('Expected a first layer')
    editor.execute(new MoveLayerCommand(firstId, null, document.layers.length))
    expect(document.layers.at(-1)?.id).toBe(firstId)
    editor.undo()
    expect(document.layers[0]?.id).toBe(firstId)
    editor.redo()
    expect(document.layers.at(-1)?.id).toBe(firstId)
  })

  it('changes metadata without replacing the layer or its pixel reference', () => {
    const layer = editor.document?.layers[0]
    if (!layer || layer.kind !== 'raster') throw new Error('Expected a raster layer')
    const originalReference = layer
    const pixelSourceId = layer.pixelSourceId

    editor.execute(new RenameLayerCommand(layer.id, 'Retouched'))
    editor.execute(new SetLayerVisibilityCommand(layer.id, false))
    editor.execute(new SetLayerOpacityCommand(layer.id, 0.35))

    expect(editor.layers.find(layer.id)).toBe(originalReference)
    expect(layer.pixelSourceId).toBe(pixelSourceId)
    expect(layer).toMatchObject({ name: 'Retouched', visible: false, opacity: 0.35 })
    editor.undo()
    expect(layer.opacity).toBe(1)
    editor.redo()
    expect(layer.opacity).toBe(0.35)
  })

  it('groups and ungroups sibling layers while preserving order', () => {
    editor.execute(new AddEmptyLayerCommand(null, 'Middle'))
    editor.execute(new AddEmptyLayerCommand(null, 'Top'))
    const document = editor.document
    if (!document) throw new Error('Expected a document')
    const originalIds = document.layers.map((layer) => layer.id)

    editor.execute(new GroupLayersCommand(originalIds.slice(0, 2), 'Pair'))
    const group = document.layers[0]
    expect(group?.kind).toBe('group')
    if (!group || group.kind !== 'group') throw new Error('Expected a group')
    expect(group.children.map((layer) => layer.id)).toEqual(originalIds.slice(0, 2))
    expect(document.layers[1]?.id).toBe(originalIds[2])

    editor.execute(new UngroupLayerCommand(group.id))
    expect(document.layers.map((layer) => layer.id)).toEqual(originalIds)
    editor.undo()
    expect(document.layers[0]?.id).toBe(group.id)
  })

  it('serializes and restores stable IDs, hierarchy, and ordering', () => {
    editor.execute(new AddEmptyLayerCommand(null, 'Second'))
    editor.execute(new AddEmptyLayerCommand(null, 'Third'))
    const document = editor.document
    if (!document) throw new Error('Expected a document')
    editor.execute(new GroupLayersCommand(document.layers.slice(1).map((layer) => layer.id), 'Nested'))

    const serialized = document.serialize()
    const restored = EditorDocument.deserialize(JSON.parse(JSON.stringify(serialized)))

    expect(restored.id).toBe(document.id)
    expect(restored.layers.map((layer) => layer.id)).toEqual(document.layers.map((layer) => layer.id))
    expect(restored.serialize().layers).toEqual(serialized.layers)
    expect(restored.selectedLayerIds).toEqual(document.selectedLayerIds)
  })
})
