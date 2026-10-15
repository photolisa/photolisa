import { vectorPdfWarnings } from '../adapters/pdf/PdfVectorSupport'
import { ref, shallowRef, onUnmounted } from 'vue'
import type { DocumentManager } from '../core/DocumentManager'
import { EditorDocument } from '../core/model/EditorDocument'
import { CopyLayersCommand } from '../core/commands/CopyLayersCommand'
import { rasterSources } from '../raster/RasterSourceRegistry'
import { ImageExportAdapter } from '../adapters/ImageExportAdapter'
import {
  saveEditorFile,
  requestSaveDestination,
} from '../adapters/BrowserFileAdapter'
import {
  aborted,
  checkPixels,
  checkDpi,
  PDF_LIMITS,
  pdfLayout,
  selectedPages,
  type PdfExportOptions,
} from '../adapters/pdf/PdfOptions'
import type {
  PdfImportSession,
  PdfPageInfo,
} from '../adapters/pdf/PdfImportSession'

export function usePdfWorkflow(
  manager: DocumentManager,
  prepare: () => void,
  error: (message: string) => void,
) {
  const pending = ref(false),
    busy = ref(false),
    progress = ref(''),
    pages = ref<PdfPageInfo[]>([]),
    name = ref('')
  const passwordNeeded = ref(false),
    passwordIncorrect = ref(false),
    showExport = ref(false),
    previews = ref<string[]>([])
  let submitPassword: ((value: string) => void) | undefined
  let session: PdfImportSession | undefined
  let operation: AbortController | undefined
  const exportRenderer = new ImageExportAdapter()
  const exportWarnings = ref<string[]>([])
  const exportSelection = shallowRef<string[]>([])
  function report(cause: unknown) {
    if (
      cause instanceof Error &&
      cause.name !== 'AbortError' &&
      cause.name !== 'RenderingCancelledException'
    )
      error(cause.message)
  }
  function clearPreviews() {
    for (const url of previews.value) URL.revokeObjectURL(url)
    previews.value = []
  }
  async function closeImport() {
    operation?.abort()
    submitPassword = undefined
    passwordNeeded.value = false
    pending.value = false
    const old = session
    session = undefined
    await old?.destroy()
    pages.value = []
  }
  async function open(file: File) {
    if (busy.value || pending.value || showExport.value) return
    pending.value = true
    busy.value = true
    name.value = file.name
    pages.value = []
    progress.value = 'Reading PDF…'
    const controller = new AbortController()
    operation = controller
    try {
      const { PdfImportSession } =
        await import('../adapters/pdf/PdfImportSession')
      const loaded = await PdfImportSession.open(
        file,
        controller.signal,
        (submit, incorrect) => {
          submitPassword = submit
          passwordNeeded.value = true
          passwordIncorrect.value = incorrect
        },
      )
      aborted(controller.signal)
      session = loaded
      for (let number = 1; number <= loaded.count; number++) {
        aborted(controller.signal)
        const info = await loaded.info(number)
        pages.value.push(info)
        progress.value = `Previewing page ${number} of ${loaded.count}…`
        const canvas = await loaded.render(
          number,
          Math.min(72, (160 * 72) / Math.max(info.width, info.height)),
          controller.signal,
          true,
        )
        try {
          info.preview = canvas.toDataURL('image/png')
          pages.value = [...pages.value]
        } finally {
          canvas.width = 0
          canvas.height = 0
        }
      }
      progress.value = ''
    } catch (cause) {
      if (!controller.signal.aborted) report(cause)
      if (operation === controller) await closeImport()
    } finally {
      if (operation === controller) busy.value = false
    }
  }
  function unlock(value: string) {
    if (!submitPassword) return
    passwordNeeded.value = false
    submitPassword(value)
    submitPassword = undefined
  }
  async function importPages(
    selection: string,
    dpi: number,
    target: 'tabs' | 'layers',
  ) {
    if (!session || busy.value) return
    const loaded = session,
      destination = manager.active
    const controller = new AbortController()
    operation = controller
    busy.value = true
    const canvases: Array<{ page: number; canvas: HTMLCanvasElement }> = []
    const sourceIds: string[] = []
    let committed = false
    try {
      checkDpi(dpi)
      const numbers = selectedPages(selection, loaded.count)
      if (target === 'layers' && !destination?.editor.document)
        throw new Error('Open a project before importing PDF pages as layers.')
      let pixels = 0
      for (const number of numbers) {
        const info = pages.value.find((page) => page.number === number)!
        const width = Math.ceil((info.width * dpi) / 72),
          height = Math.ceil((info.height * dpi) / 72)
        checkPixels(width, height)
        pixels += width * height
      }
      if (pixels > PDF_LIMITS.batchPixels)
        throw new Error(
          'Selected pages exceed the 64 megapixel import budget. Import fewer pages or lower the DPI.',
        )
      for (const [index, number] of numbers.entries()) {
        progress.value = `Rendering page ${index + 1} of ${numbers.length}…`
        canvases.push({
          page: number,
          canvas: await loaded.render(number, dpi, controller.signal),
        })
      }
      aborted(controller.signal)
      const documents = canvases.map(({ page, canvas }) => {
        const id = rasterSources.registerCanvas(canvas)
        sourceIds.push(id)
        const doc = EditorDocument.createFromImage({
          name: `${name.value.replace(/\.pdf$/i, '')} — Page ${page}`,
          width: canvas.width,
          height: canvas.height,
          resolution: dpi,
          pixelSourceId: id,
        })
        doc.metadata.sourceFormat = 'pdf'
        doc.metadata.pdfPage = {
          number: page,
          widthPoints: pages.value[page - 1]!.width,
          heightPoints: pages.value[page - 1]!.height,
          rotation: pages.value[page - 1]!.rotation,
        }
        return doc
      })
      prepare()
      if (target === 'layers') {
        if (manager.find(destination!.id) !== destination)
          throw new Error('Destination project was closed during import.')
        destination!.editor.execute(
          new CopyLayersCommand(documents.flatMap((doc) => doc.layers)),
        )
        for (const id of sourceIds)
          destination!.editor.retainResource(() => rasterSources.remove(id))
      } else
        for (const [index, doc] of documents.entries()) {
          const editor = manager.open(doc, { dirty: true }).editor
          const id = sourceIds[index]!
          editor.retainResource(() => rasterSources.remove(id))
        }
      committed = true
      await closeImport()
    } catch (cause) {
      if (!controller.signal.aborted) report(cause)
    } finally {
      if (!committed) {
        sourceIds.forEach((id) => rasterSources.remove(id))
        canvases.forEach(({ canvas }) => {
          canvas.width = 0
          canvas.height = 0
        })
      }
      busy.value = false
      progress.value = ''
    }
  }
  function requestExport() {
    exportSelection.value = manager.active ? [manager.active.id] : []
    clearPreviews()
    exportWarnings.value = []
    showExport.value = true
  }
  function cancelExport() {
    operation?.abort()
    clearPreviews()
    showExport.value = false
  }
  function documents(ids: string[]) {
    const docs = manager.tabs
      .filter((tab) => ids.includes(tab.id))
      .map((tab) => manager.find(tab.id)?.editor.document)
      .filter((doc): doc is EditorDocument => Boolean(doc))
    if (!docs.length) throw new Error('Select at least one open project.')
    return docs
  }
  function inspectExport(ids: string[], mode: string) {
    exportWarnings.value =
      mode === 'vector' && ids.length
        ? documents(ids).flatMap(vectorPdfWarnings)
        : []
  }
  async function exportPdf(
    ids: string[],
    options: PdfExportOptions,
    preview = false,
  ) {
    if (busy.value) return
    busy.value = true
    clearPreviews()
    const controller = new AbortController()
    operation = controller
    try {
      const docs = documents(ids)
      exportWarnings.value =
        options.mode === 'vector' ? docs.flatMap(vectorPdfWarnings) : []
      for (const doc of docs) pdfLayout(doc.dimensions, options)
      const filename = `${docs[0]!.name.replace(/[^a-z0-9._-]+/gi, '-')}.pdf`
      const destination = preview
        ? undefined
        : await requestSaveDestination(
            filename,
            'PDF document',
            '.pdf',
            'application/pdf',
          )
      if (destination?.kind === 'cancelled') return
      const { PdfExportAdapter } =
        await import('../adapters/pdf/PdfExportAdapter')
      const adapter = new PdfExportAdapter(exportRenderer)
      if (preview) {
        for (const [index, doc] of docs.entries()) {
          progress.value = `Previewing page ${index + 1} of ${docs.length}…`
          const blob = await adapter.preview(doc, options, controller.signal)
          aborted(controller.signal)
          previews.value.push(URL.createObjectURL(blob))
        }
      } else {
        progress.value = 'Preparing PDF…'
        const blob = await adapter.export(
          docs,
          options,
          controller.signal,
          (done, total) => {
            progress.value = `Exported page ${done} of ${total}…`
          },
        )
        aborted(controller.signal)
        await saveEditorFile(blob, filename, destination)
        cancelExport()
      }
    } catch (cause) {
      if (!controller.signal.aborted) report(cause)
    } finally {
      busy.value = false
      progress.value = ''
      exportRenderer.clearCache()
    }
  }
  onUnmounted(() => {
    void closeImport()
    clearPreviews()
    exportRenderer.destroy()
  })
  return {
    pending,
    busy,
    progress,
    pages,
    name,
    passwordNeeded,
    passwordIncorrect,
    showExport,
    previews,
    exportSelection,
    open,
    closeImport,
    unlock,
    importPages,
    requestExport,
    cancelExport,
    exportPdf,
    clearPreviews,
    exportWarnings,
    inspectExport,
  }
}
