import type { EditorDocument } from '../model/EditorDocument'
import type { SelectionMask } from '../selection/SelectionMask'

export interface EditorEventMap {
  'document:changed': EditorDocument | null
  'history:changed': { canUndo: boolean; canRedo: boolean }
  'dirty:changed': boolean
  'selection:changed': SelectionMask | null
}

export type EditorEvent = keyof EditorEventMap
