import {
  AddEmptyLayerCommand,
  DeleteLayerCommand,
  DuplicateLayerCommand,
  GroupLayersCommand,
  MoveLayerCommand,
  RenameLayerCommand,
  SetLayerBlendModeCommand,
  SetLayerLockedCommand,
  SetLayerOpacityCommand,
  SetLayerVisibilityCommand,
  UngroupLayerCommand,
} from '~/core/commands/LayerCommands'
import type { BlendMode } from '~/core/model/types'
import { editorCore } from './useEditor'

export function useLayerCommands() {
  return {
    select: (id: string, mode: 'replace' | 'add' | 'toggle') => editorCore.layers.select(id, mode),
    add: (parentId: string | null = null) => editorCore.execute(new AddEmptyLayerCommand(parentId)),
    rename: (id: string, name: string) => editorCore.execute(new RenameLayerCommand(id, name)),
    setVisibility: (id: string, visible: boolean) => editorCore.execute(new SetLayerVisibilityCommand(id, visible)),
    setLocked: (id: string, locked: boolean) => editorCore.execute(new SetLayerLockedCommand(id, locked)),
    setOpacity: (id: string, opacity: number) => editorCore.execute(new SetLayerOpacityCommand(id, opacity)),
    setBlendMode: (id: string, blendMode: BlendMode) => editorCore.execute(new SetLayerBlendModeCommand(id, blendMode)),
    duplicate: (id: string) => editorCore.execute(new DuplicateLayerCommand(id)),
    remove: (id: string) => editorCore.execute(new DeleteLayerCommand(id)),
    move: (id: string, parentId: string | null, index: number) => editorCore.execute(new MoveLayerCommand(id, parentId, index)),
    group: (ids: readonly string[]) => editorCore.execute(new GroupLayersCommand(ids)),
    ungroup: (id: string) => editorCore.execute(new UngroupLayerCommand(id)),
  }
}
