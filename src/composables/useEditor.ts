import { shallowRef, onMounted, onUnmounted, ref, triggerRef } from 'vue'
import { DocumentManager, type DocumentTab } from '~/core/DocumentManager'
import { EditorCore } from '~/core/EditorCore'
import { EditorDocument } from '~/core/model/EditorDocument'
import type { ImportedDocumentOptions, NewDocumentOptions } from '~/core/model/types'

export const documentManager = new DocumentManager()
const idleEditor = new EditorCore()
export let editorCore: EditorCore = idleEditor

export function useEditor() {
  const currentDocument = shallowRef<EditorDocument | null>(editorCore.document)
  const canUndo = ref(editorCore.history.canUndo)
  const canRedo = ref(editorCore.history.canRedo)
  const isDirty = ref(editorCore.isDirty)
  const tabs = shallowRef<DocumentTab[]>(documentManager.tabs)
  const canReopen = ref(documentManager.canReopen)
  let stopDocument: (() => void) | undefined
  let stopHistory: (() => void) | undefined
  let stopDirty: (() => void) | undefined
  let stopManager: (() => void) | undefined

  function sync(): void {
    const nextEditor = documentManager.active?.editor ?? idleEditor
    if (editorCore !== nextEditor) {
      stopDocument?.(); stopHistory?.(); stopDirty?.()
      editorCore = nextEditor
      bindEditor()
    }
    currentDocument.value = editorCore.document
    triggerRef(currentDocument)
    canUndo.value = editorCore.history.canUndo
    canRedo.value = editorCore.history.canRedo
    isDirty.value = editorCore.isDirty
    tabs.value = documentManager.tabs
    canReopen.value = documentManager.canReopen
  }

  function bindEditor(): void {
    stopDocument = editorCore.events.on('document:changed', (document) => { currentDocument.value = document; triggerRef(currentDocument) })
    stopHistory = editorCore.events.on('history:changed', (state) => {
      canUndo.value = state.canUndo
      canRedo.value = state.canRedo
    })
    stopDirty = editorCore.events.on('dirty:changed', (value) => { isDirty.value = value })
  }

  onMounted(() => {
    bindEditor()
    stopManager = documentManager.subscribe(sync)
    sync()
  })

  onUnmounted(() => {
    stopDocument?.()
    stopHistory?.()
    stopDirty?.()
    stopManager?.()
  })

  return {
    manager: documentManager,
    currentDocument,
    canUndo,
    canRedo,
    isDirty,
    tabs,
    canReopen,
    createDocument: (options: NewDocumentOptions) => documentManager.open(EditorDocument.create(options)),
    importDocument: (options: ImportedDocumentOptions) => documentManager.open(EditorDocument.createFromImage(options)),
    openDocument: (document: EditorDocument, saved = true) => documentManager.open(document, { dirty: !saved }),
    undo: () => editorCore.undo(),
    redo: () => editorCore.redo(),
  }
}
