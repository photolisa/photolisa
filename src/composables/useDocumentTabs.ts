import { ref, computed, onUnmounted, watch, type Ref } from 'vue'
import { useUiStore } from '../stores/ui'
import { AutosaveController } from '~/persistence/AutosaveController'
import { RenameDocumentCommand } from '~/core/commands/RenameDocumentCommand'
import type { DocumentManager, DocumentTab, DocumentView } from '~/core/DocumentManager'
import type { ToolId } from '~/stores/ui'

export function useDocumentTabs(options: {
  manager: DocumentManager
  tabs: Readonly<Ref<readonly DocumentTab[]>>
  prepareSwitch: () => void
  save: (id: string) => Promise<boolean>
  onError: (message: string) => void
}) {
  const ui = useUiStore()
  const autosaves = new Map<string, AutosaveController>()
  const pendingCloseId = ref<string | null>(null)
  const pendingCloseName = computed(() => options.tabs.value.find((tab) => tab.id === pendingCloseId.value)?.name ?? '')
  const viewState = computed(() => { void options.tabs.value; return options.manager.active?.view ?? null })

  watch(options.tabs, (tabs) => {
    const openIds = new Set(tabs.map((tab) => tab.id))
    for (const [id, controller] of autosaves) if (!openIds.has(id)) { controller.destroy(); autosaves.delete(id) }
    for (const tab of tabs) if (!autosaves.has(tab.id)) {
      const session = options.manager.find(tab.id)
      if (!session) continue
      const controller = new AutosaveController(session.editor, undefined, undefined, 2_000, (error) => options.onError(`Autosave failed for “${session.editor.document?.name ?? 'project'}”: ${error.message}`))
      controller.start()
      autosaves.set(tab.id, controller)
      if (session.editor.isDirty) controller.schedule()
    }
  }, { immediate: true })

  watch(() => ui.activeTool, (tool) => {
    const id = options.manager.active?.id
    if (id) options.manager.setTool(id, tool)
  })

  onUnmounted(() => { for (const controller of autosaves.values()) controller.destroy(); autosaves.clear() })

  function prepare(): void {
    options.prepareSwitch()
  }

  function syncActiveTool(): void { ui.setTool((options.manager.active?.tool ?? 'move') as ToolId) }

  function activate(id: string): void {
    if (options.manager.active?.id === id || !options.manager.find(id)) return
    prepare()
    options.manager.activate(id)
    syncActiveTool()
  }

  function cycle(direction: 1 | -1): void {
    if (options.manager.count < 2) return
    prepare()
    options.manager.cycle(direction)
    syncActiveTool()
  }

  function prepareOpen(): void { prepare() }

  function rename(id: string, name: string): void {
    const session = options.manager.find(id)
    if (!session || !name.trim() || session.editor.document?.name === name.trim()) return
    session.editor.execute(new RenameDocumentCommand(name))
  }

  function requestClose(id: string): void {
    const session = options.manager.find(id)
    if (!session) return
    if (session.editor.isDirty) pendingCloseId.value = id
    else void finishClose(id)
  }

  async function finishClose(id: string): Promise<void> {
    const session = options.manager.find(id)
    if (!session) return
    if (options.manager.active?.id === id) prepare()
    try { await autosaves.get(id)?.saveNow() }
    catch (error) { options.onError(error instanceof Error ? error.message : 'Autosave failed while closing the project.') }
    autosaves.get(id)?.destroy(); autosaves.delete(id)
    options.manager.close(id)
    pendingCloseId.value = null
    syncActiveTool()
  }

  async function saveAndClose(): Promise<void> {
    const id = pendingCloseId.value
    if (id && await options.save(id)) await finishClose(id)
  }

  function closeWithoutSaving(): void { const id = pendingCloseId.value; if (id) void finishClose(id) }

  function reopen(): void {
    if (!options.manager.canReopen) return
    prepare()
    options.manager.reopenLastClosed()
    syncActiveTool()
  }

  function onViewChange(view: DocumentView): void {
    ui.setZoom(view.zoom)
    const id = options.manager.active?.id
    if (id) options.manager.setView(id, view)
  }

  return {
    autosaves, pendingCloseId, pendingCloseName, viewState, activate, cycle, prepareOpen,
    rename, requestClose, finishClose, saveAndClose, closeWithoutSaving, reopen, onViewChange,
  }
}
