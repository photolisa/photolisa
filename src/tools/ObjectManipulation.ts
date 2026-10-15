import type { EditorCore } from '../core/EditorCore'
import { ObjectTransformCommand } from '../core/commands/ObjectTransformCommand'
import { DuplicateLayerCommand } from '../core/commands/LayerCommands'
import { SetVectorGeometryCommand } from '../core/commands/VectorCommands'
import {
  captureTransform,
  framePoints,
  restoreTransform,
  HANDLES,
  worldBounds,
  type Rect,
  type TransformFrame,
} from '../core/transform/ObjectTransform'
import {
  invertAffine,
  transformPoint,
  type Point,
} from '../core/geometry/LayerCoordinates'
import type { PixiViewportRenderer } from '../renderer/PixiViewportRenderer'
import type { InteractionOverlay } from '../renderer/InteractionOverlay'
import type { ToolControllerOptions } from './EditorToolController'
import { layerAtPoint, layersAtPoint } from './LayerHitTest'
import {
  objectEntries,
  selectedObjects,
  type ObjectEntry,
} from './ObjectBounds'
import {
  selectionFrame,
  rotationHandles,
  rectangleRadiusHandle,
} from './ObjectHandles'
import { performObjectAction } from './ObjectContextActions'
import { refreshObjectOverlay } from './ObjectManipulationOverlay'
import { previewObjectGesture } from './ObjectGesturePreview'
import { marqueeRect, intersects } from './ObjectSelectionGeometry'
import type { CanvasAction, Drag } from './ObjectInteractionState'
export type { CanvasAction, CanvasControls } from './ObjectInteractionState'

/** Browser adapter only: geometry and affine operations live in the reusable transform engine. */
export class ObjectManipulation {
  private cropId: string | null = null
  private drag: Drag | null = null
  private pending: { event: PointerEvent; point: Point } | null = null
  private frameId: number | null = null
  private guides:
    { vertical: number | null; horizontal: number | null } | undefined
  private overlap: { point: Point; ids: string[]; index: number } | null = null
  get dragging(): boolean {
    return this.drag !== null
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
  private selected(): ObjectEntry[] {
    const doc = this.editor.document
    return doc ? selectedObjects(doc.layers, doc.selectedLayerIds) : []
  }
  private frame(entries = this.selected()): TransformFrame | null {
    return selectionFrame(entries)
  }
  pointerDown(event: PointerEvent, point: Point): boolean {
    if (
      !['move', 'direct-selection'].includes(this.options.getTool()) ||
      !this.editor.document
    )
      return false
    if (this.drag) return true
    const activeLayer = this.editor.document.activeLayerId
      ? this.editor.layers.find(this.editor.document.activeLayerId)
      : null
    if (
      activeLayer?.kind === 'raster' &&
      !activeLayer.pixelSourceId &&
      this.editor.document.selectedLayerIds.length === 1 &&
      objectEntries(this.editor.document.layers).length === 0
    )
      return false
    const doc = this.editor.document,
      frame = this.frame(),
      radius = 8 / this.renderer.getZoom()
    let action: Drag['action'] = 'move',
      handle = { x: 0.5, y: 0.5 },
      handleHit = false
    if (frame && !event.shiftKey) {
      const i = framePoints(frame).findIndex(
        (p) => Math.hypot(p.x - point.x, p.y - point.y) <= radius,
      )
      if (i >= 0) {
        action =
          event.ctrlKey || event.metaKey
            ? event.altKey && i % 2 === 0
              ? 'free'
              : 'skew'
            : 'resize'
        handle = HANDLES[i]!
        handleHit = true
      } else if (
        !this.cropId &&
        rotationHandles(frame, this.renderer.getZoom()).some(
          (p) => Math.hypot(p.x - point.x, p.y - point.y) <= radius,
        )
      ) {
        action = 'rotate'
        handleHit = true
      }
    } else if (frame) {
      // Shift remains an aspect-ratio modifier even when held before pressing a handle.
      const i = framePoints(frame).findIndex(
        (p) => Math.hypot(p.x - point.x, p.y - point.y) <= radius,
      )
      if (i >= 0) {
        action = 'resize'
        handle = HANDLES[i]!
        handleHit = true
      } else if (
        !this.cropId &&
        rotationHandles(frame, this.renderer.getZoom()).some(
          (p) => Math.hypot(p.x - point.x, p.y - point.y) <= radius,
        )
      ) {
        action = 'rotate'
        handleHit = true
      }
    }
    const selected = this.selected(),
      single = selected.length === 1 ? selected[0]! : null
    if (
      single &&
      frame &&
      single.layer.kind === 'vector' &&
      single.layer.geometry.type === 'rect'
    ) {
      const p = rectangleRadiusHandle(single, this.renderer.getZoom())
      if (Math.hypot(p.x - point.x, p.y - point.y) <= radius) {
        action = 'radius'
        handleHit = true
      }
    }
    if (this.options.getTool() === 'direct-selection' && action !== 'radius')
      return false
    if (this.cropId && single?.layer.id === this.cropId) {
      action = handleHit ? 'crop-resize' : 'crop-move'
    }
    const selection = [...doc.selectedLayerIds],
      active = doc.activeLayerId
    if (!handleHit && this.options.getAutoSelect()) {
      const topHit = layerAtPoint(doc.layers, point, this.renderer.getZoom())
      const hits =
        event.ctrlKey || event.metaKey
          ? layersAtPoint(doc.layers, point, this.renderer.getZoom())
          : topHit
            ? [topHit]
            : []
      let hit = hits[0]
      if ((event.ctrlKey || event.metaKey) && hits.length) {
        const ids = hits.map((h) => h.id)
        if (
          this.overlap &&
          Math.hypot(
            this.overlap.point.x - point.x,
            this.overlap.point.y - point.y,
          ) <= radius &&
          this.overlap.ids.join() === ids.join()
        )
          this.overlap.index = (this.overlap.index + 1) % ids.length
        else
          this.overlap = {
            point,
            ids,
            index: Math.max(
              0,
              (ids.indexOf(doc.activeLayerId ?? '') + 1) % ids.length,
            ),
          }
        hit = hits[this.overlap.index]
      } else this.overlap = null
      if (hit) {
        if (event.shiftKey) {
          this.editor.layers.select(hit.id, 'toggle')
          this.refresh()
          return true
        }
        // Clicking a member of a selected group preserves the group selection.
        const selectedHit = this.selected().some(
          (e) =>
            e.layer.id === hit!.id ||
            (e.layer.kind === 'group' &&
              objectEntries(e.layer.children).some(
                (c) => c.layer.id === hit!.id,
              )),
        )
        if (!selectedHit) this.editor.layers.select(hit.id, 'replace')
        if (this.cropId && this.cropId !== hit.id) this.cropId = null
        if (event.detail === 2) {
          if (hit.kind === 'vector') {
            this.options.onToolChange('direct-selection')
            return true
          }
          if (hit.kind === 'raster') {
            this.cropId = hit.id
            this.refresh()
            return true
          }
          if (hit.kind === 'text') {
            this.options.onEditText?.(hit.id)
            return true
          }
        }
      } else {
        this.cropId = null
        action = 'marquee'
      }
    }
    const entries = this.selected().map((e) => ({
        ...e,
        before: captureTransform(e.layer),
      })),
      currentFrame = this.frame(entries)
    if (action !== 'marquee' && !currentFrame) {
      this.refresh()
      return true
    }
    const origin = this.options.getTransformOrigin(),
      b = currentFrame?.bounds
    const pivot =
      b && currentFrame
        ? transformPoint(currentFrame.matrix, {
            x: b.x + b.width * origin.x,
            y: b.y + b.height * origin.y,
          })
        : point
    this.drag = {
      pointer: event.pointerId,
      action,
      start: point,
      last: point,
      frame: currentFrame,
      entries,
      handle,
      pivot,
      selection,
      active,
      additive: event.shiftKey,
      duplicated: false,
      changed: false,
      geometryBefore:
        single?.layer.kind === 'vector'
          ? structuredClone(single.layer.geometry)
          : null,
      targets: this.snapTargets(entries),
    }
    event.preventDefault()
    this.options.onCanvasControls?.(null)
    this.refresh()
    return true
  }
  pointerMove(event: PointerEvent, point: Point): boolean {
    if (!['move', 'direct-selection'].includes(this.options.getTool()))
      return false
    if (this.options.getTool() === 'direct-selection' && !this.drag)
      return false
    if (this.drag?.pointer === event.pointerId) {
      this.pending = { event, point }
      if (this.frameId === null)
        this.frameId = requestAnimationFrame(() => {
          this.frameId = null
          this.flush()
        })
    } else if (!this.drag) {
      const frame = this.frame(),
        radius = 8 / this.renderer.getZoom()
      let cursor = 'default'
      if (frame) {
        const i = framePoints(frame).findIndex(
          (p) => Math.hypot(p.x - point.x, p.y - point.y) <= radius,
        )
        if (i >= 0) {
          const center = transformPoint(frame.matrix, {
              x: frame.bounds.x + frame.bounds.width / 2,
              y: frame.bounds.y + frame.bounds.height / 2,
            }),
            p = framePoints(frame)[i]!,
            direction =
              ((Math.round(
                Math.atan2(p.y - center.y, p.x - center.x) / (Math.PI / 4),
              ) %
                4) +
                4) %
              4
          cursor =
            event.ctrlKey || event.metaKey
              ? 'alias'
              : ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][
                  direction
                ]!
        } else if (
          !this.cropId &&
          rotationHandles(frame, this.renderer.getZoom()).some(
            (p) => Math.hypot(p.x - point.x, p.y - point.y) <= radius,
          )
        )
          cursor = 'grab'
        else if (
          this.editor.document &&
          layerAtPoint(
            this.editor.document.layers,
            point,
            this.renderer.getZoom(),
          )
        )
          cursor = 'move'
      }
      this.renderer.getCanvas().style.cursor = cursor
    }
    return true
  }
  private flush(): void {
    const pending = this.pending,
      drag = this.drag,
      doc = this.editor.document
    this.pending = null
    if (!pending || !drag || !doc) return
    const { event, point } = pending
    drag.last = point
    if (
      !drag.changed &&
      Math.hypot(point.x - drag.start.x, point.y - drag.start.y) *
        this.renderer.getZoom() <
        2
    )
      return
    if (drag.action === 'marquee') {
      drag.changed = true
      this.refresh()
      return
    }
    if (drag.action === 'move' && event.altKey && !drag.changed) {
      this.editor.beginTransaction('Duplicate and Move Objects')
      drag.duplicated = true
      const ids: string[] = []
      try {
        for (const entry of drag.entries) {
          this.editor.execute(new DuplicateLayerCommand(entry.layer.id))
          if (doc.activeLayerId) ids.push(doc.activeLayerId)
        }
        doc.selectedLayerIds = ids
        doc.activeLayerId = ids.at(-1) ?? null
        drag.entries = this.selected().map((e) => ({
          ...e,
          before: captureTransform(e.layer),
        }))
      } catch (error) {
        this.cancel()
        throw error
      }
    }
    drag.changed = true
    this.guides = previewObjectGesture(drag, point, event, doc.dimensions, {
      zoom: this.renderer.getZoom(),
      textResizeMode: this.options.getTextResizeMode?.() ?? 'scale',
      snapping: this.options.getSnapToCanvas()
        ? (this.options.getObjectSnapping?.() ?? {
            tolerance: 6,
            grid: 0,
            guidesX: [],
            guidesY: [],
          })
        : null,
    })
    this.renderer.scheduleRefreshDocument()
    this.refresh()
  }
  pointerUp(event: PointerEvent): boolean {
    if (!this.drag || this.drag.pointer !== event.pointerId) return false
    this.flush()
    const drag = this.drag,
      doc = this.editor.document
    this.drag = null
    this.guides = undefined
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.frameId = null
    if (drag.action === 'marquee' && doc) {
      const r = marqueeRect(drag.start, drag.last)
      const hits = drag.changed
        ? objectEntries(doc.layers)
            .filter(
              (e) =>
                e.editable &&
                e.layer.kind !== 'group' &&
                intersects(
                  r,
                  worldBounds({ bounds: e.bounds, matrix: e.world }),
                ),
            )
            .map((e) => e.layer.id)
        : []
      this.select(
        drag.additive ? [...new Set([...drag.selection, ...hits])] : hits,
      )
    } else if (drag.changed && drag.action === 'radius') {
      const entry = drag.entries[0]!
      if (entry.layer.kind === 'vector' && drag.geometryBefore) {
        const after = entry.layer.geometry
        entry.layer.geometry = drag.geometryBefore
        if (JSON.stringify(after) !== JSON.stringify(drag.geometryBefore))
          this.editor.execute(
            new SetVectorGeometryCommand(entry.layer.id, after),
          )
      }
    } else if (drag.changed) {
      const changes = drag.entries
        .map((e) => ({
          id: e.layer.id,
          before: e.before,
          after: captureTransform(e.layer),
        }))
        .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after))
      if (changes.length)
        this.editor.commitExecuted(
          new ObjectTransformCommand('Transform Objects', changes),
        )
      if (drag.duplicated) this.editor.commitTransaction()
    }
    this.refresh()
    return true
  }
  cancel(exitMode = false): void {
    if (exitMode) this.cropId = null
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.frameId = null
    this.pending = null
    this.guides = undefined
    const drag = this.drag
    this.drag = null
    if (!drag) return
    drag.entries.forEach((e) => restoreTransform(e.layer, e.before))
    if (
      drag.action === 'radius' &&
      drag.entries[0]?.layer.kind === 'vector' &&
      drag.geometryBefore
    )
      drag.entries[0].layer.geometry = drag.geometryBefore
    if (drag.duplicated) this.editor.cancelTransaction()
    this.select(drag.selection, drag.active)
    this.renderer.scheduleRefreshDocument()
  }
  private select(ids: string[], active = ids.at(-1) ?? null): void {
    const doc = this.editor.document
    if (!doc) return
    doc.selectedLayerIds = ids
    doc.activeLayerId = active
    doc.revision += 1
    this.editor.events.emit('document:changed', doc)
  }
  keyDown(event: KeyboardEvent): boolean {
    if (this.options.getTool() !== 'move') return false
    if (
      this.cropId &&
      !this.drag &&
      (event.key === 'Escape' || event.key === 'Enter')
    ) {
      event.preventDefault()
      this.cropId = null
      this.refresh()
      return true
    }
    if (this.drag) {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancel()
        this.refresh()
      }
      return true
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    const distance = event.shiftKey ? 10 : 1
    const x =
        event.key === 'ArrowLeft'
          ? -distance
          : event.key === 'ArrowRight'
            ? distance
            : 0,
      y =
        event.key === 'ArrowUp'
          ? -distance
          : event.key === 'ArrowDown'
            ? distance
            : 0
    if (!x && !y) return false
    const entries = this.selected()
    if (!entries.length) return false
    event.preventDefault()
    const changes = entries.map((e) => {
      const before = captureTransform(e.layer),
        inverse = invertAffine(e.parent),
        a = transformPoint(inverse, { x: 0, y: 0 }),
        b = transformPoint(inverse, { x, y })
      e.layer.transform.x += b.x - a.x
      e.layer.transform.y += b.y - a.y
      return { id: e.layer.id, before, after: captureTransform(e.layer) }
    })
    this.editor.commitExecuted(
      new ObjectTransformCommand('Nudge Objects', changes),
    )
    this.renderer.scheduleRefreshDocument()
    this.refresh()
    return true
  }
  editImage(id: string): void {
    this.cancel()
    this.cropId = id
    this.refresh()
  }
  action(action: CanvasAction): void {
    if (this.drag) return
    if (action === 'finish-crop') {
      this.cropId = null
      this.refresh()
      return
    }
    performObjectAction(
      this.editor,
      action,
      (ids) => this.select(ids),
      this.options.onError,
    )
    this.renderer.scheduleRefreshDocument()
    this.refresh()
  }
  private snapTargets(entries: readonly ObjectEntry[]): Rect[] {
    const excluded = new Set<string>()
    for (const e of entries) {
      excluded.add(e.layer.id)
      if (e.layer.kind === 'group')
        objectEntries(e.layer.children).forEach((c) => excluded.add(c.layer.id))
    }
    return this.editor.document
      ? objectEntries(this.editor.document.layers)
          .filter((e) => e.layer.kind !== 'group' && !excluded.has(e.layer.id))
          .map((e) => worldBounds({ bounds: e.bounds, matrix: e.world }))
      : []
  }
  refresh(): void {
    refreshObjectOverlay(
      this.editor,
      this.renderer,
      this.overlay,
      this.options,
      { cropId: this.cropId, drag: this.drag, guides: this.guides },
    )
  }
}
