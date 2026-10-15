import type { EditorCore } from '../EditorCore'
import type { GroupLayer, Layer, BlendMode } from '../model/types'
import type { LayerLocation, RemovedLayer } from '../layers/LayerManager'
import type { Command } from './Command'

export class AddEmptyLayerCommand implements Command {
  readonly label = 'Add Layer'
  private layer: Layer | null = null
  private location: LayerLocation | null = null

  constructor(private readonly parentId: string | null = null, private readonly name = 'Layer') {}

  execute(editor: EditorCore): void {
    this.layer ??= editor.layers.createEmptyLayer(this.name)
    this.location = editor.layers.insert(this.layer, this.parentId, this.location?.index)
  }

  undo(editor: EditorCore): void {
    if (this.layer) editor.layers.remove(this.layer.id)
  }
}

export class RenameLayerCommand implements Command {
  readonly label = 'Rename Layer'
  private previousName: string | null = null
  constructor(private readonly layerId: string, private readonly name: string) {}
  execute(editor: EditorCore): void { this.previousName = editor.layers.rename(this.layerId, this.name) }
  undo(editor: EditorCore): void { if (this.previousName !== null) editor.layers.rename(this.layerId, this.previousName) }
}

export class SetLayerVisibilityCommand implements Command {
  readonly label = 'Toggle Layer Visibility'
  private previous: boolean | null = null
  constructor(private readonly layerId: string, private readonly visible: boolean) {}
  execute(editor: EditorCore): void { this.previous = editor.layers.setVisibility(this.layerId, this.visible) }
  undo(editor: EditorCore): void { if (this.previous !== null) editor.layers.setVisibility(this.layerId, this.previous) }
}

export class SetLayerLockedCommand implements Command {
  readonly label = 'Toggle Layer Lock'
  private previous: boolean | null = null
  constructor(private readonly layerId: string, private readonly locked: boolean) {}
  execute(editor: EditorCore): void { this.previous = editor.layers.setLocked(this.layerId, this.locked) }
  undo(editor: EditorCore): void { if (this.previous !== null) editor.layers.setLocked(this.layerId, this.previous) }
}

export class SetLayerOpacityCommand implements Command {
  readonly label = 'Layer Opacity'
  private previous: number | null = null
  constructor(private readonly layerId: string, private readonly opacity: number) {}
  execute(editor: EditorCore): void { this.previous = editor.layers.setOpacity(this.layerId, this.opacity) }
  undo(editor: EditorCore): void { if (this.previous !== null) editor.layers.setOpacity(this.layerId, this.previous) }
}

export class SetLayerBlendModeCommand implements Command {
  readonly label = 'Layer Blend Mode'
  private previous: BlendMode | null = null
  constructor(private readonly layerId: string, private readonly blendMode: BlendMode) {}
  execute(editor: EditorCore): void { this.previous = editor.layers.setBlendMode(this.layerId, this.blendMode) }
  undo(editor: EditorCore): void { if (this.previous !== null) editor.layers.setBlendMode(this.layerId, this.previous) }
}

export class DeleteLayerCommand implements Command {
  readonly label = 'Delete Layer'
  private removed: RemovedLayer | null = null
  constructor(private readonly layerId: string) {}
  execute(editor: EditorCore): void { this.removed = editor.layers.remove(this.layerId) }
  undo(editor: EditorCore): void {
    if (this.removed) editor.layers.insert(this.removed.layer, this.removed.parentId, this.removed.index)
  }
}

export class DuplicateLayerCommand implements Command {
  readonly label = 'Duplicate Layer'
  private duplicate: RemovedLayer | null = null
  constructor(private readonly sourceId: string) {}
  execute(editor: EditorCore): void {
    if (this.duplicate) editor.layers.insert(this.duplicate.layer, this.duplicate.parentId, this.duplicate.index)
    else this.duplicate = editor.layers.duplicate(this.sourceId)
  }
  undo(editor: EditorCore): void { if (this.duplicate) editor.layers.remove(this.duplicate.layer.id) }
}

export class MoveLayerCommand implements Command {
  readonly label = 'Move Layer'
  private previous: LayerLocation | null = null
  constructor(private readonly layerId: string, private readonly parentId: string | null, private readonly index: number) {}
  execute(editor: EditorCore): void {
    const location = editor.layers.move(this.layerId, this.parentId, this.index)
    this.previous ??= location
  }
  undo(editor: EditorCore): void {
    if (this.previous) editor.layers.move(this.layerId, this.previous.parentId, this.previous.index)
  }
}

export class GroupLayersCommand implements Command {
  readonly label = 'Group Layers'
  private grouped: RemovedLayer | null = null
  constructor(private readonly layerIds: readonly string[], private readonly name = 'Group') {}
  execute(editor: EditorCore): void {
    if (this.grouped) editor.layers.regroup(this.grouped.layer as GroupLayer, this.grouped.parentId, this.grouped.index)
    else this.grouped = editor.layers.group(this.layerIds, this.name)
  }
  undo(editor: EditorCore): void { if (this.grouped) editor.layers.ungroup(this.grouped.layer.id) }
}

export class UngroupLayerCommand implements Command {
  readonly label = 'Ungroup Layers'
  private group: RemovedLayer | null = null
  constructor(private readonly groupId: string) {}
  execute(editor: EditorCore): void { this.group = editor.layers.ungroup(this.groupId) }
  undo(editor: EditorCore): void {
    if (this.group) editor.layers.regroup(this.group.layer as GroupLayer, this.group.parentId, this.group.index)
  }
}
