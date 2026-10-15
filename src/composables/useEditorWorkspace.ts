import { usePdfWorkflow } from './usePdfWorkflow'
import { VectorClipboard } from '../core/vector/VectorClipboard'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useUiStore } from '../stores/ui'
import { useEditor } from '../composables/useEditor'
import { useImageImport } from '../composables/useImageImport'
import { useDocumentTabs } from '../composables/useDocumentTabs'
import type { NewDocumentOptions } from '~/core/model/types'
import type { ViewState } from '~/renderer/PixiViewportRenderer'
import type { ToolId } from '~/stores/ui'
import { ImageExportAdapter } from '~/adapters/ImageExportAdapter'
import { NativeProjectAdapter } from '~/adapters/NativeProjectAdapter'
import type { PsdAdapter } from '~/adapters/PsdAdapter'
import { IcoAdapter, type IcoEntry, type IcoSize } from '~/adapters/IcoAdapter'
import { rasterSources } from '~/raster/RasterSourceRegistry'
import { pickEditorFile, requestSaveDestination, saveEditorFile } from '~/adapters/BrowserFileAdapter'
import { BrowserProjectStorage, type ProjectSummary } from '~/persistence/ProjectStorage'
import { LayerTransferService, type TransferMode } from '~/core/layers/LayerTransferService'
import { RasterLayerTransferAssets } from '~/raster/RasterLayerTransferAssets'
import { SetSelectionCommand } from '~/core/commands/SelectionCommands'
import { SelectionEditing, type PixelClipboard } from '~/raster/SelectionEditing'
import { CanvasSizeCommand, RotateFlipCanvasCommand, type CanvasAnchor, type CanvasOperation } from '~/core/commands/DocumentGeometryCommands'
import { ImageResizeCommand, type ResizeQuality } from '../raster/commands/ImageResizeCommand'

export function useEditorWorkspace() {
  const ui = useUiStore()
  const { manager, currentDocument, canUndo, canRedo, isDirty, tabs, canReopen, createDocument, importDocument, openDocument, undo, redo } = useEditor()
  const { importing, importError, importFile, clearImportError } = useImageImport((options) => { tabControls.prepareOpen(); importDocument(options) })
  const showNewDialog = ref(false)
  const imageOperation = ref<'resize' | 'canvas' | null>(null)
  const pendingRasterExport = ref<'jpeg' | 'webp' | null>(null)
  const fileInput = ref<HTMLInputElement | null>(null)
  const exporter = new ImageExportAdapter()
  const nativeProjects = new NativeProjectAdapter()
  let psdAdapter: Promise<PsdAdapter> | null = null
  function getPsdAdapter(): Promise<PsdAdapter> {
    return psdAdapter ??= import('../adapters/PsdAdapter').then(({ PsdAdapter }) => new PsdAdapter())
  }
  const ico = new IcoAdapter()
  const pendingIco = ref<{ file: File; entries: IcoEntry[] } | null>(null)
  const showIcoExport = ref(false)
  const icoBusy = ref(false)
  const projectStorage = new BrowserProjectStorage()
  const layerTransfers = new LayerTransferService(new RasterLayerTransferAssets())
  const selectionEditing = new SelectionEditing()
  const recovery = ref<ProjectSummary | null>(null)
  const compatibilityWarnings = ref<string[]>([])
  const warningsByDocument = new Map<string, string[]>()
  const tabBar = ref<{ renameActive: () => void } | null>(null)
  const canvasWorkspace = ref<{
    prepareSwitch: () => void
    fitToScreen: () => void
    actualSize: () => void
    resetView: () => void
    zoomIn: () => void
    zoomOut: () => void
    setZoom: (zoom: number) => void
    closePenPath: () => void
    confirmTool: () => void
    cancelTool: () => void
  } | null>(null)
  const tabControls = useDocumentTabs({
    manager, tabs,
    prepareSwitch: () => canvasWorkspace.value?.prepareSwitch(),
    save: (id) => saveProject(id),
    onError: (message) => { importError.value = message },
  })
  const pdf = usePdfWorkflow(manager, () => tabControls.prepareOpen(), message => { importError.value = message })
  watch(tabs, () => { compatibilityWarnings.value = warningsByDocument.get(manager.active?.id ?? '') ?? [] })

  function openNewDocument(): void { showNewDialog.value = true }
  function create(options: NewDocumentOptions): void {
    tabControls.prepareOpen()
    createDocument(options)
    showNewDialog.value = false
    nextTick(() => canvasWorkspace.value?.fitToScreen())
  }
  function selectTool(tool: ToolId): void { ui.setTool(tool) }
  function applyImageOperation(options: { width: number; height: number; quality: ResizeQuality; anchor: CanvasAnchor }): void {
    const editor = manager.active?.editor
    if (!editor?.document || !imageOperation.value) return
    try {
      editor.execute(imageOperation.value === 'resize' ? new ImageResizeCommand(options.width, options.height, options.quality)
        : new CanvasSizeCommand(options.width, options.height, options.anchor))
      imageOperation.value = null
      canvasWorkspace.value?.fitToScreen()
    } catch (error) { importError.value = error instanceof Error ? error.message : 'Image operation failed.' }
  }

  function transformCanvas(operation: CanvasOperation): void {
    const editor = manager.active?.editor
    if (!editor?.document) return
    try { editor.execute(new RotateFlipCanvasCommand(operation)); canvasWorkspace.value?.fitToScreen() }
    catch (error) { importError.value = error instanceof Error ? error.message : 'Canvas transform failed.' }
  }
  function featherSelection(radius: number): void {
    const editor = manager.active?.editor
    if (!editor?.selection) return
    try { editor.execute(new SetSelectionCommand('Feather Selection', editor.selection, editor.selection.feather(radius))) }
    catch (error) { importError.value = error instanceof Error ? error.message : 'Selection could not be feathered.' }
  }
  const vectorClipboard = new VectorClipboard()
  function editSelection(action: 'copy' | 'cut' | 'fill' | 'delete'): void {
    const editor = manager.active?.editor
    if (!editor) return
    try {
      if ((action === 'copy' || action === 'cut') && vectorClipboard.copy(editor, action === 'cut')) return
      if (action === 'delete' && vectorClipboard.delete(editor)) return
      if (action === 'copy' || action === 'cut') {
        vectorClipboard.clear()
        const copied = action === 'copy' ? selectionEditing.copy(editor) : selectionEditing.cut(editor)
        void writeImageClipboard(copied)
      } else if (action === 'fill') {
        const color = ui.foregroundColor
        selectionEditing.fill(editor, [color.r, color.g, color.b, color.a])
      } else selectionEditing.delete(editor)
    } catch (error) { importError.value = error instanceof Error ? error.message : 'Selection edit failed.' }
  }

  async function pasteSelection(): Promise<void> {
    const editor = manager.active?.editor
    if (!editor) return
    try {
      if (vectorClipboard.paste(editor)) return
      const internal = selectionEditing.getClipboard()
      selectionEditing.paste(editor, internal ?? await readImageClipboard() ?? undefined)
    } catch (error) { importError.value = error instanceof Error ? error.message : 'Could not paste pixels.' }
  }

  async function pasteExternalImage(): Promise<void> {
    const editor = manager.active?.editor
    if (!editor) return
    try {
      const image = await readImageClipboard()
      if (!image) throw new Error('No PNG image is available from the system clipboard.')
      selectionEditing.paste(editor, image)
    } catch (error) { importError.value = error instanceof Error ? error.message : 'Could not paste external image.' }
  }

  async function writeImageClipboard(copied: PixelClipboard): Promise<void> {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return
    const canvas = document.createElement('canvas'); canvas.width = copied.image.width; canvas.height = copied.image.height
    canvas.getContext('2d')?.putImageData(copied.image, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]) } catch { /* Internal clipboard remains available. */ }
  }

  async function readImageClipboard(): Promise<PixelClipboard | null> {
    if (!navigator.clipboard?.read) return null
    try {
      const items = await navigator.clipboard.read()
      const item = items.find((entry) => entry.types.includes('image/png'))
      if (!item) return null
      const bitmap = await createImageBitmap(await item.getType('image/png'))
      try {
        if (bitmap.width * bitmap.height > 67_108_864) throw new Error('Clipboard image is too large')
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
        const context = canvas.getContext('2d'); if (!context) throw new Error('2D canvas is unavailable')
        context.drawImage(bitmap, 0, 0)
        return { x: 0, y: 0, image: context.getImageData(0, 0, bitmap.width, bitmap.height) }
      } finally { bitmap.close() }
    } catch { return null }
  }

  async function handleImport(file: File): Promise<void> {
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        await pdf.open(file); return
      } else if (/\.photolisa$/i.test(file.name) || file.type === 'application/x-photolisa') {
        const opened = await nativeProjects.open(file); tabControls.prepareOpen(); openDocument(opened.document); warningsByDocument.set(opened.document.id, opened.warnings)
      } else if (/\.psd$/i.test(file.name) || file.type === 'image/vnd.adobe.photoshop') {
      const opened = await (await getPsdAdapter()).import(file, file.name); tabControls.prepareOpen(); openDocument(opened.value); warningsByDocument.set(opened.value.id, opened.warnings)
      } else if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
        const { SvgImporter } = await import('../adapters/SvgImporter')
        const opened = await new SvgImporter().import(file); tabControls.prepareOpen(); openDocument(opened.document); warningsByDocument.set(opened.document.id, opened.warnings)
      } else if (/\.ico$/i.test(file.name) || file.type === 'image/x-icon' || file.type === 'image/vnd.microsoft.icon') {
        const entries = await ico.inspect(file)
        pendingIco.value = { file, entries }
        return
      } else if (!(await importFile(file))) return
      compatibilityWarnings.value = warningsByDocument.get(manager.active?.id ?? '') ?? []
    } catch (error) { importError.value = error instanceof Error ? error.message : 'The file could not be opened.' }
  }

  async function openIcoResolution(index: number): Promise<void> {
    const pending = pendingIco.value
    if (!pending || icoBusy.value) return
    icoBusy.value = true
    try {
      const decoded = await ico.decode(pending.file, index)
      const pixelSourceId = rasterSources.register(decoded.bitmap)
      try {
        tabControls.prepareOpen()
        importDocument({ name: decoded.name, width: decoded.width, height: decoded.height, resolution: 72, pixelSourceId })
      } catch (error) { rasterSources.remove(pixelSourceId); throw error }
      pendingIco.value = null
      nextTick(() => canvasWorkspace.value?.fitToScreen())
    } catch (error) { importError.value = error instanceof Error ? error.message : 'The icon could not be opened.' }
    finally { icoBusy.value = false }
  }

  async function exportIco(sizes: IcoSize[]): Promise<void> {
    const document = currentDocument.value
    if (!document || icoBusy.value) return
    icoBusy.value = true
    try {
      const blob = await ico.export(document, sizes, exporter)
      await saveEditorFile(blob, `${safeName(document.name)}.ico`)
      showIcoExport.value = false
    } catch (error) { importError.value = error instanceof Error ? error.message : 'The icon could not be exported.' }
    finally { icoBusy.value = false }
  }

  async function chooseFile(): Promise<void> {
    if (!fileInput.value) return
    const file = await pickEditorFile(fileInput.value)
    if (file) await handleImport(file)
  }

  function requestExportImage(format: 'png' | 'jpeg' | 'webp'): void {
    if (format === 'png') void exportImage('png')
    else pendingRasterExport.value = format
  }

  async function exportImage(format: 'png' | 'jpeg' | 'webp', quality = 0.92, name?: string): Promise<void> {
    const document = currentDocument.value
    if (!document) return
    try {
      const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp'
      const blob = await exporter.documentToBlob(document, mime, quality)
      await saveEditorFile(blob, `${safeName(name ?? document.name)}.${format === 'jpeg' ? 'jpg' : format}`)
      pendingRasterExport.value = null
    } catch (error) {
      importError.value = error instanceof Error ? error.message : 'The document could not be exported.'
    }
  }

  async function saveProject(id = manager.active?.id ?? ''): Promise<boolean> {
    const session = manager.find(id)
    const document = session?.editor.document; if (!document || !session) return false
    try {
      const name = `${safeName(document.name)}.photolisa`
      const destination = await requestSaveDestination(name, 'Photolisa project', '.photolisa', 'application/x-photolisa')
      if (destination.kind === 'cancelled') return false
      const revision = document.revision
      const blob = await nativeProjects.save(document)
      const saved = await saveEditorFile(blob, name, destination)
      if (saved && session.editor.document === document && document.revision === revision) { session.editor.markSaved(); await tabControls.autosaves.get(document.id)?.discard(document.id) }
      return saved
    }
    catch (error) { importError.value = error instanceof Error ? error.message : 'The project could not be saved.'; return false }
  }

  async function exportPsd(): Promise<void> {
    const document = currentDocument.value; if (!document) return
    try { const result = await (await getPsdAdapter()).export(document); warningsByDocument.set(document.id, result.warnings); compatibilityWarnings.value = result.warnings; await saveEditorFile(result.value, `${safeName(document.name)}.psd`) }
    catch (error) { importError.value = error instanceof Error ? error.message : 'The PSD could not be exported.' }
  }

  async function exportSvg(): Promise<void> {
    const document = currentDocument.value; if (!document) return
    try { const { SvgExporter } = await import('../adapters/SvgExporter'); const result = await new SvgExporter().export(document); warningsByDocument.set(document.id, result.warnings); compatibilityWarnings.value = result.warnings; await saveEditorFile(result.blob, `${safeName(document.name)}.svg`) }
    catch (error) { importError.value = error instanceof Error ? error.message : 'The SVG could not be exported.' }
  }

  async function recoverAutosave(): Promise<void> {
    if (!recovery.value) return
    try {
      const stored = await projectStorage.load(recovery.value.id)
      if (!stored) throw new Error('Recovery project no longer exists')
      const opened = await nativeProjects.restore({ manifest: stored.manifest, assets: new Map(stored.assets.map((asset) => [asset.id, asset.bytes])) })
      tabControls.prepareOpen()
      openDocument(opened.document, false)
      warningsByDocument.set(opened.document.id, opened.warnings)
      recovery.value = null
    }
    catch (error) { importError.value = error instanceof Error ? error.message : 'Recovery failed.' }
  }

  function safeName(name: string): string { return name.replace(/[^a-z0-9._-]+/gi, '-') || 'photolisa' }

  function onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.item(0)
    if (file) void handleImport(file)
    input.value = ''
  }

  function onViewChange(state: ViewState): void { tabControls.onViewChange(state) }

  function transferLayers(payload: { layerIds: string[]; targetId: string; mode: TransferMode; centerInDestination: boolean }): void {
    const source = manager.active
    const destination = manager.find(payload.targetId)
    if (!source || !destination) return
    try {
      layerTransfers.transfer({ source: source.editor, destination: destination.editor, layerIds: payload.layerIds, mode: payload.mode, centerInDestination: payload.centerInDestination })
      tabControls.activate(destination.id)
    } catch (error) { importError.value = error instanceof Error ? error.message : 'Layers could not be transferred.' }
  }

  function onTransferDrop(payload: { targetId: string; layerId: string; mode: 'copy' | 'move' }): void {
    const document = manager.active?.editor.document
    if (!document) return
    const layerIds = document.selectedLayerIds.includes(payload.layerId) ? [...document.selectedLayerIds] : [payload.layerId]
    transferLayers({ layerIds, targetId: payload.targetId, mode: payload.mode, centerInDestination: false })
  }

  function onKeydown(event: KeyboardEvent): void {
    if (ui.colorPickerTarget) return
    const modifier = event.ctrlKey || event.metaKey
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
    if (modifier && event.key === 'Tab') { event.preventDefault(); tabControls.cycle(event.shiftKey ? -1 : 1); return }
    if (modifier && event.key.toLowerCase() === 'w') { event.preventDefault(); const id = manager.active?.id; if (id) tabControls.requestClose(id); return }
    if (modifier && event.key.toLowerCase() === 'n') { event.preventDefault(); openNewDocument() }
    if (modifier && event.key.toLowerCase() === 'o') { event.preventDefault(); void chooseFile() }
    if (modifier && event.key.toLowerCase() === 's' && !event.altKey) { event.preventDefault(); void saveProject() }
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    if (modifier && event.key === '0') { event.preventDefault(); canvasWorkspace.value?.fitToScreen() }
    if (modifier && event.key === '1') { event.preventDefault(); canvasWorkspace.value?.actualSize() }
    if (modifier && event.key.toLowerCase() === 't' && !typing) { event.preventDefault(); ui.setTool('transform') }
    if (modifier && !typing && manager.active?.editor.document) {
      const key = event.key.toLowerCase()
      if (key === 'c') { event.preventDefault(); editSelection('copy') }
      if (key === 'x') { event.preventDefault(); editSelection('cut') }
      if (key === 'v') { event.preventDefault(); void pasteSelection() }
    }
    if (!['path-selection', 'direct-selection'].includes(ui.activeTool) && !modifier && !typing && (event.key === 'Delete' || event.key === 'Backspace') && (manager.active?.editor.selection || manager.active && vectorClipboard.canCopy(manager.active.editor))) { event.preventDefault(); editSelection('delete') }
    if (!modifier && !event.altKey && !typing) {
      if (event.key.toLowerCase() === 'x') { ui.swapColors(); return }
      if (event.key.toLowerCase() === 'd') { ui.resetColors(); return }
      const shortcuts: Partial<Record<string, ToolId>> = { u: 'rectangle', p: 'pen', a: 'direct-selection', v: 'move', b: 'brush', n: 'pencil', e: 'eraser', g: 'paint-bucket', s: 'clone-stamp', j: 'spot-repair', t: 'text', i: 'eyedropper', c: 'crop', m: 'marquee', l: 'lasso', h: 'hand', z: 'zoom' }
      const tool = shortcuts[event.key.toLowerCase()]
      if (tool) ui.setTool(tool)
    }
  }

  function onBeforeUnload(event: BeforeUnloadEvent): void { if (manager.hasDirty) event.preventDefault() }
  let disconnectColors: (() => void) | null = null
  useEventListener(window, 'keydown', onKeydown)
  useEventListener(window, 'beforeunload', onBeforeUnload)
  onMounted(() => {
    disconnectColors = ui.connectColors()
    void projectStorage.list().then((items) => { recovery.value = items.find((item) => item.autosave) ?? null }).catch(() => undefined)
  })
  onUnmounted(() => { disconnectColors?.(); exporter.destroy() })

  return {
    pdf, ui, manager, currentDocument, canUndo, canRedo, isDirty,
    tabs, canReopen, importing, importError, clearImportError, showNewDialog,
    imageOperation, pendingRasterExport, fileInput, pendingIco, showIcoExport, icoBusy,
    recovery, compatibilityWarnings, tabBar, canvasWorkspace, tabControls, openNewDocument,
    create, selectTool, applyImageOperation, transformCanvas, featherSelection, editSelection,
    pasteSelection, pasteExternalImage, handleImport, openIcoResolution, exportIco, chooseFile,
    requestExportImage, exportImage, saveProject, exportPsd, exportSvg, recoverAutosave,
    onFileSelected, onViewChange, transferLayers, onTransferDrop, undo, redo,
  }
}
