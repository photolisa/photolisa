import type { EditorCore } from '../core/EditorCore'
import type { PixiViewportRenderer } from '../renderer/PixiViewportRenderer'
import type { InteractionOverlay } from '../renderer/InteractionOverlay'
import type { ToolControllerOptions } from './EditorToolController'
import { framePoints, worldBounds } from '../core/transform/ObjectTransform'
import { spacingMeasurements } from '../core/transform/SmartGuides'
import type { Point } from '../core/geometry/LayerCoordinates'
import { selectedObjects } from './ObjectBounds'
import {
  selectionFrame,
  rectangleRadiusHandle,
  rotationHandles,
} from './ObjectHandles'
import type { Drag } from './ObjectInteractionState'
import { marqueeRect } from './ObjectSelectionGeometry'

export function refreshObjectOverlay(
  editor: EditorCore,
  renderer: PixiViewportRenderer,
  overlay: InteractionOverlay,
  options: ToolControllerOptions,
  state: {
    cropId: string | null
    drag: Drag | null
    guides: { vertical: number | null; horizontal: number | null } | undefined
  },
): void {
  if (!['move', 'direct-selection'].includes(options.getTool())) {
    options.onCanvasControls?.(null)
    return
  }
  const drag = state.drag
  if (drag?.action === 'marquee') {
    overlay.setState({
      kind: 'selection-preview',
      rect: marqueeRect(drag.start, drag.last),
      shape: 'rectangle',
    })
    return
  }
  const doc = editor.document,
    entries = doc ? selectedObjects(doc.layers, doc.selectedLayerIds) : [],
    frame = selectionFrame(entries)
  if (!frame) {
    overlay.setState({ kind: 'none' })
    if (
      doc?.selectedLayerIds.length &&
      doc.selectedLayerIds.every((id) => editor.layers.find(id)?.locked)
    )
      options.onCanvasControls?.({
        x: 12,
        y: 12,
        count: doc.selectedLayerIds.length,
        groupable: false,
        locked: true,
        crop: false,
        aspectLocked: false,
      })
    else options.onCanvasControls?.(null)
    return
  }
  const points = framePoints(frame),
    corners = [points[0]!, points[2]!, points[4]!, points[6]!] as [
      Point,
      Point,
      Point,
      Point,
    ]
  const b = worldBounds(frame)
  const single = entries.length === 1 ? entries[0]! : null
  const radiusPoint =
    single?.layer.kind === 'vector' && single.layer.geometry.type === 'rect'
      ? rectangleRadiusHandle(single, renderer.getZoom())
      : undefined
  if (options.getTool() === 'direct-selection')
    overlay.setState(
      radiusPoint
        ? { kind: 'corner-radius', point: radiusPoint }
        : { kind: 'none' },
    )
  else
    overlay.setState({
      kind: 'transform',
      corners,
      radiusPoint,
      measurements:
        drag?.action === 'move'
          ? spacingMeasurements(b, drag.targets, 120 / renderer.getZoom())
          : [],
      crop: !!state.cropId,
      rotationHandle: rotationHandles(frame, renderer.getZoom())[0]!,
      rotationHandles: rotationHandles(frame, renderer.getZoom()),
      guides: state.guides,
      dimensions: doc?.dimensions,
      position: { x: b.x, y: b.y },
    })
  if (!drag) {
    const screen = corners.map((p) => renderer.documentToScreen(p)),
      canvas = renderer.getCanvas()
    const parent = entries[0]
      ? editor.layers.locationOf(entries[0].layer.id)?.parentId
      : null
    options.onCanvasControls?.({
      x: Math.max(
        8,
        Math.min(canvas.clientWidth - 320, Math.min(...screen.map((p) => p.x))),
      ),
      y: Math.max(
        8,
        Math.min(
          canvas.clientHeight - 40,
          Math.max(...screen.map((p) => p.y)) + 34,
        ),
      ),
      count: entries.length,
      crop: !!state.cropId,
      aspectLocked: entries.every((e) => e.layer.aspectRatioLocked === true),
      groupable:
        entries.length > 1 &&
        entries.every(
          (e) => editor.layers.locationOf(e.layer.id)?.parentId === parent,
        ),
      locked: false,
    })
  }
}
