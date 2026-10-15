import { OnCanvasTextEditor } from '~/tools/OnCanvasTextEditor'
import type { CanvasControls } from '~/tools/ObjectManipulation'
import { SetVectorStyleCommand } from '~/core/commands/VectorCommands'
import { colorRgbHex } from '~/raster/SampledColor'
import { computed, shallowRef, onMounted, onUnmounted, ref, watch } from 'vue'
import { useUiStore } from '../stores/ui'
import type { EditorDocument } from '~/core/model/EditorDocument'
import {
  PixiViewportRenderer,
  type ViewState,
} from '~/renderer/PixiViewportRenderer'
import {
  EditorToolController,
  type EyedropperSample,
} from '~/tools/EditorToolController'
import type { ToolId } from '~/stores/ui'
import { editorCore } from '~/composables/useEditor'

export type CanvasWorkspaceProps = {
  document: EditorDocument | null
  revision: number
  importing: boolean
  tool: ToolId
  viewState: ViewState | null
}

export interface CanvasWorkspaceEvents {
  openFile: []
  newDocument: []
  viewChange: [state: ViewState]
  importFile: [file: File]
  error: [message: string]
}
export type CanvasWorkspaceEmit = <K extends keyof CanvasWorkspaceEvents>(
  event: K,
  ...args: CanvasWorkspaceEvents[K]
) => void

export function useCanvasWorkspace(
  props: Readonly<CanvasWorkspaceProps>,
  emit: CanvasWorkspaceEmit,
) {
  const host = ref<HTMLElement | null>(null)
  const draggingFile = ref(false)
  const controls = shallowRef<CanvasControls | null>(null)
  const vectorPaint = computed(() => {
    void props.revision
    const layer = props.document?.activeLayerId
      ? editorCore.layers.find(props.document.activeLayerId)
      : null
    return layer?.kind === 'vector' &&
      props.document?.selectedLayerIds.length === 1
      ? {
          fill: layer.style.fill ?? '#000000',
          stroke: layer.style.stroke ?? '#000000',
        }
      : null
  })
  function setObjectPaint(target: 'fill' | 'stroke', value: string): void {
    const layer = props.document?.activeLayerId
      ? editorCore.layers.find(props.document.activeLayerId)
      : null
    if (layer?.kind !== 'vector' || layer.locked) return
    const style = structuredClone(layer.style)
    if (target === 'fill') {
      delete style.fillGradient
      style.fill = value
    } else {
      style.stroke = value
      if (!style.strokeWidth) style.strokeWidth = 1
    }
    editorCore.execute(new SetVectorStyleCommand(layer.id, style))
  }
  const samplePreview = shallowRef<EyedropperSample | null>(null)
  let renderer: PixiViewportRenderer | null = null
  let tools: EditorToolController | null = null
  let textEditor: OnCanvasTextEditor | null = null
  const ui = useUiStore()
  let dragDepth = 0
  let restoringView = false
  let stopSelectionEvents: (() => void) | null = null

  onMounted(async () => {
    if (!host.value) return
    try {
      renderer = new PixiViewportRenderer({
        workspaceBackground: '#141414',
        onViewChange: (state) => {
          if (!restoringView) emit('viewChange', state)
          tools?.refreshOverlay()
          textEditor?.refresh()
        },
        onError: (message) => emit('error', message),
      })
      await renderer.initialize(host.value)
      renderer.setDocument(props.document)
      if (props.viewState) renderer.setViewState(props.viewState)
      textEditor = new OnCanvasTextEditor(
        host.value,
        renderer,
        () => editorCore,
        (message) => emit('error', message),
      )
      tools = new EditorToolController(host.value, renderer, () => editorCore, {
        getTextResizeMode: () => ui.textResizeMode,
        onEditText: (id) => textEditor?.open(id),
        onCanvasControls: (state) => {
          controls.value = state
        },
        getObjectSnapping: () => ui.objectSnapping,
        getTool: () => ui.activeTool,
        getBrush: () => ({
          ...ui.brush,
          colorAlpha: ui.foregroundColor.a / 255,
        }),
        getPencil: () => ({
          diameter: ui.pencil.diameter,
          opacity: ui.pencil.opacity,
          color: ui.brush.color,
          colorAlpha: ui.foregroundColor.a / 255,
          pixelGrid: ui.pencil.pixelGrid,
        }),
        getBucket: () => ({
          tolerance: ui.bucket.tolerance,
          opacity: ui.bucket.opacity,
          color: [
            ui.foregroundColor.r,
            ui.foregroundColor.g,
            ui.foregroundColor.b,
            ui.foregroundColor.a,
          ],
        }),
        getTransformOrigin: () => ({ ...ui.transformOrigin }),
        getAutoSelect: () => ui.moveAutoSelect,
        getSnapToCanvas: () => ui.moveSnapToCanvas,
        getShape: () => ({
          ...ui.shape,
          customPath:
            ui.customShapes[ui.customShapeIndex]?.d ?? 'M.5 0L1 .5L.5 1L0 .5Z',
        }),
        onToolChange: (tool) => ui.setTool(tool),
        onError: (message) => emit('error', message),
        getSampleMode: () => ui.eyedropperSampleMode,
        onSamplePreview: (sample) => {
          samplePreview.value = sample
        },
        onSampleCommit: (color) => {
          ui.selectSampledColor(color)
          const target = ui.vectorPaintTarget
          if (target && editorCore.document?.id === target.documentId) {
            const layer = editorCore.layers.find(target.layerId)
            if (layer?.kind === 'vector' && !layer.locked) {
              const style = structuredClone(layer.style)
              if (target.target === 'fill') {
                delete style.fillGradient
                style.fill = colorRgbHex(color)
                style.fillOpacity = color.a / 255
              } else {
                style.stroke = colorRgbHex(color)
                style.strokeOpacity = color.a / 255
              }
              editorCore.execute(new SetVectorStyleCommand(layer.id, style))
            }
            ui.vectorPaintTarget = null
            ui.setTool(target.returnTool)
          }
        },
      })
      tools.setTool(props.tool)
      stopSelectionEvents = editorCore.events.on('selection:changed', () =>
        tools?.refreshOverlay(),
      )
    } catch {
      emit('error', 'GPU rendering could not be initialized in this browser.')
    }
  })

  watch(
    () => props.document,
    (editorDocument) => {
      textEditor?.close(true)
      stopSelectionEvents?.()
      stopSelectionEvents = editorCore.events.on('selection:changed', () =>
        tools?.refreshOverlay(),
      )
      samplePreview.value = null
      ui.vectorPaintTarget = null
      restoringView = true
      renderer?.setDocument(editorDocument)
      if (props.viewState) renderer?.setViewState(props.viewState)
      restoringView = false
      if (renderer) emit('viewChange', renderer.getViewState())
      tools?.restoreSelection()
      tools?.setTool(props.tool)
    },
  )
  watch(
    () => props.revision,
    () => {
      renderer?.scheduleRefreshDocument()
      tools?.refreshOverlay()
    },
  )
  watch(
    () => props.tool,
    (tool) => tools?.setTool(tool),
  )
  watch(
    () => [ui.brush.diameter, ui.pencil.diameter, ui.pencil.pixelGrid],
    () => tools?.refreshOverlay(),
  )
  onUnmounted(() => {
    stopSelectionEvents?.()
    textEditor?.destroy()
    tools?.destroy()
    renderer?.destroy()
  })

  function onDragEnter(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return
    dragDepth += 1
    draggingFile.value = true
  }

  function onDragLeave(): void {
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) draggingFile.value = false
  }

  function onDrop(event: DragEvent): void {
    dragDepth = 0
    draggingFile.value = false
    const file = event.dataTransfer?.files.item(0)
    if (file) emit('importFile', file)
  }

  const onCanvasAction = (
    action: Parameters<EditorToolController['canvasAction']>[0],
  ) => tools?.canvasAction(action)

  const actions = {
    closePenPath: () => tools?.closePenPath(),
    prepareSwitch: () => {
      textEditor?.close(true)
      tools?.suspend()
    },
    fitToScreen: () => renderer?.fitToScreen(),
    actualSize: () => renderer?.actualSize(),
    resetView: () => renderer?.resetView(),
    zoomIn: () => renderer?.zoomAtCenter(1.2),
    zoomOut: () => renderer?.zoomAtCenter(1 / 1.2),
    setZoom: (zoom: number) => renderer?.setZoomAtCenter(zoom),
    confirmTool: () => tools?.confirm(),
    cancelTool: () => tools?.cancel(),
  }

  return {
    host,
    draggingFile,
    controls,
    vectorPaint,
    setObjectPaint,
    samplePreview,
    onDragEnter,
    onDragLeave,
    onDrop,
    onCanvasAction,
    actions,
  }
}
