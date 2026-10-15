import { isObjectEditable } from './ObjectBounds'
import type { EditorCore } from '../core/EditorCore'
import type { AffineMatrix, VectorLayer } from '../core/model/types'
import { IDENTITY_TRANSFORM } from '../core/model/types'
import {
  VectorMatrixCommand,
  type MatrixState,
} from '../core/commands/VectorMatrixCommand'
import {
  geometryBounds,
  transformGeometryPath,
  type Bounds,
} from '../core/vector/PathGeometry'
import { resizeHandles, resizeTransform } from '../core/vector/Transform'
import {
  IDENTITY_MATRIX,
  invertAffine,
  layerWorldMatrix,
  multiplyAffine,
  type Point,
} from '../core/geometry/LayerCoordinates'
import type { InteractionOverlay } from '../renderer/InteractionOverlay'
import type { PixiViewportRenderer } from '../renderer/PixiViewportRenderer'
import type { ToolControllerOptions } from './EditorToolController'
interface Entry {
  layer: VectorLayer
  before: MatrixState
  parent: AffineMatrix
}
interface Drag {
  action: 'move' | 'resize' | 'rotate'
  start: Point
  handle: Point
  bounds: Bounds
  pivot: Point
  startAngle: number
  worlds: Map<string, AffineMatrix>
}
/** Applies shared transforms as affine matrices, preserving all source curves and strokes. */
export class MultiVectorTransform {
  private entries: Entry[] = []
  private drag: Drag | null = null
  private pointerId: number | null = null
  get dragging(): boolean { return this.drag !== null }
  get active(): boolean {
    return this.entries.length > 1
  }
  constructor(
    private getEditor: () => EditorCore,
    private renderer: PixiViewportRenderer,
    private overlay: InteractionOverlay,
    private options: ToolControllerOptions,
  ) {}
  private get editor(): EditorCore {
    return this.getEditor()
  }
  activate(): boolean {
    this.cancel()
    const doc = this.editor.document
    if (!doc) return false
    const layers = doc.selectedLayerIds.map((id) => this.editor.layers.find(id))
    if (
      layers.length < 2 ||
      layers.some(
        (layer) => layer?.kind !== 'vector' || !isObjectEditable(doc.layers, layer.id),
      )
    )
      return false
    this.entries = (layers as VectorLayer[]).map((layer) => {
      const parentId = this.editor.layers.locationOf(layer.id)?.parentId
      const parent = parentId
        ? (layerWorldMatrix(doc.layers, parentId) ?? IDENTITY_MATRIX)
        : IDENTITY_MATRIX
      return {
        layer,
        parent,
        before: {
          transform: { ...layer.transform },
          matrix: layer.svgMatrix ? [...layer.svgMatrix] : null,
        },
      }
    })
    this.refresh()
    return true
  }
  pointerDown(event: PointerEvent, point: Point): boolean {
    if (!this.active) return false
    const bounds = this.bounds(),
      handles = resizeHandles.map((p) => ({
        x: bounds.x + bounds.width * p.x,
        y: bounds.y + bounds.height * p.y,
      })),
      rotation = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y - 30 / this.renderer.getZoom(),
      },
      threshold = 10 / this.renderer.getZoom()
    const distance = (p: Point): number =>
        Math.hypot(p.x - point.x, p.y - point.y),
      handleIndex = handles.findIndex((p) => distance(p) <= threshold)
    const action =
      distance(rotation) <= threshold
        ? 'rotate'
        : handleIndex >= 0
          ? 'resize'
          : point.x >= bounds.x &&
              point.x <= bounds.x + bounds.width &&
              point.y >= bounds.y &&
              point.y <= bounds.y + bounds.height
            ? 'move'
            : null
    if (!action) return true
    const origin = this.options.getTransformOrigin(),
      pivot = {
        x: bounds.x + bounds.width * origin.x,
        y: bounds.y + bounds.height * origin.y,
      }
    this.drag = {
      action,
      start: point,
      bounds,
      handle: resizeHandles[Math.max(0, handleIndex)]!,
      pivot,
      startAngle: Math.atan2(point.y - pivot.y, point.x - pivot.x),
      worlds: new Map(
        this.entries.map((e) => [
          e.layer.id,
          layerWorldMatrix(this.editor.document!.layers, e.layer.id)!,
        ]),
      ),
    }
    this.pointerId = event.pointerId
    event.preventDefault()
    return true
  }
  pointerMove(event: PointerEvent, point: Point): boolean {
    if (!this.active) return false
    const drag = this.drag
    if (!drag || this.pointerId !== event.pointerId) return true
    let matrix: AffineMatrix
    if (drag.action === 'move')
      matrix = [1, 0, 0, 1, point.x - drag.start.x, point.y - drag.start.y]
    else if (drag.action === 'resize') {
      const t = resizeTransform(
        { ...IDENTITY_TRANSFORM },
        drag.bounds,
        drag.handle,
        point,
        event.altKey,
        event.shiftKey,
      )
      matrix = [t.scaleX, 0, 0, t.scaleY, t.x, t.y]
    } else {
      let angle =
        Math.atan2(point.y - drag.pivot.y, point.x - drag.pivot.x) -
        drag.startAngle
      if (event.shiftKey)
        angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12)
      const c = Math.cos(angle),
        s = Math.sin(angle),
        p = drag.pivot
      matrix = [c, s, -s, c, p.x - c * p.x + s * p.y, p.y - s * p.x - c * p.y]
    }
    for (const entry of this.entries) {
      entry.layer.transform = { ...IDENTITY_TRANSFORM }
      entry.layer.svgMatrix = multiplyAffine(
        invertAffine(entry.parent),
        multiplyAffine(matrix, drag.worlds.get(entry.layer.id)!),
      )
    }
    this.renderer.scheduleRefreshDocument()
    this.refresh()
    return true
  }
  pointerUp(event: PointerEvent): boolean {
    if (!this.active) return false
    if (event.pointerId === this.pointerId) {
      this.drag = null
      this.pointerId = null
    }
    return true
  }
  confirm(): boolean {
    if (!this.active) return false
    this.editor.beginTransaction('Transform Vector Selection')
    try {
      for (const entry of this.entries)
        this.editor.commitExecuted(
          new VectorMatrixCommand(entry.layer.id, entry.before, {
            transform: { ...entry.layer.transform },
            matrix: entry.layer.svgMatrix ? [...entry.layer.svgMatrix] : null,
          }),
        )
      this.editor.commitTransaction()
    } catch (error) {
      this.editor.cancelTransaction()
      throw error
    }
    this.entries = []
    this.drag = null
    this.pointerId = null
    return true
  }
  cancel(): void {
    for (const entry of this.entries) {
      entry.layer.transform = { ...entry.before.transform }
      if (entry.before.matrix) entry.layer.svgMatrix = [...entry.before.matrix]
      else delete entry.layer.svgMatrix
    }
    const hadEntries = this.entries.length > 0
    this.entries = []
    this.drag = null
    this.pointerId = null
    if (hadEntries) this.renderer.scheduleRefreshDocument()
  }
  refresh(): void {
    if (!this.active) return
    const b = this.bounds(),
      corners: [Point, Point, Point, Point] = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ]
    this.overlay.setState({
      kind: 'transform',
      corners,
      rotationHandle: {
        x: b.x + b.width / 2,
        y: b.y - 30 / this.renderer.getZoom(),
      },
    })
  }
  private bounds(): Bounds {
    const bounds = this.entries.map((e) =>
      geometryBounds({
        type: 'path',
        d: transformGeometryPath(
          e.layer.geometry,
          layerWorldMatrix(this.editor.document!.layers, e.layer.id)!,
        ),
      }),
    )
    const x = Math.min(...bounds.map((b) => b.x)),
      y = Math.min(...bounds.map((b) => b.y))
    return {
      x,
      y,
      width: Math.max(...bounds.map((b) => b.x + b.width)) - x,
      height: Math.max(...bounds.map((b) => b.y + b.height)) - y,
    }
  }
}
