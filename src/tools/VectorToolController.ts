import { isObjectEditable } from './ObjectBounds'
import { VectorClipboard } from '../core/vector/VectorClipboard'
import { createVectorArtwork } from '../core/vector/VectorCreation'
import { snapMove } from './MoveSnapping'
import type { EditorCore } from '../core/EditorCore'
import type {
  VectorGeometry,
  VectorLayer,
  VectorStyle,
} from '../core/model/types'
import {
  SetVectorGeometryCommand,
} from '../core/commands/VectorCommands'
import {
  DuplicateLayerCommand,
  GroupLayersCommand,
  UngroupLayerCommand,
} from '../core/commands/LayerCommands'
import { SetLayerTransformCommand } from '../core/commands/EditingCommands'
import {
  corner,
  moveAnchor,
  readSubpaths,
  writeSubpaths,
  geometryBounds,
  splitSegment,
  nearestSegment,
  type Subpath,
} from '../core/vector/PathGeometry'
import {
  IDENTITY_MATRIX,
  layerLocalMatrix,
  multiplyAffine,
  transformPoint,
  invertAffine,
  type Point,
} from '../core/geometry/LayerCoordinates'
import type { AffineMatrix, Layer } from '../core/model/types'
import type { PixiViewportRenderer } from '../renderer/PixiViewportRenderer'
import { VectorEditingOverlay } from '../renderer/VectorEditingOverlay'
import { layerAtPoint, layersAtPoint } from './LayerHitTest'
import type { ToolControllerOptions } from './EditorToolController'

const penTools = ['pen', 'curvature-pen', 'freeform-pen']
const selectionTools = ['path-selection', 'direct-selection']
interface AnchorDrag {
  layer: VectorLayer
  before: VectorGeometry
  paths: Subpath[]
  subpath: number
  index: number
  part: 'point' | 'incoming' | 'outgoing'
  inverse: AffineMatrix
  world: AffineMatrix
}
export class VectorToolController {
  private overlay: VectorEditingOverlay
  private draft: Subpath | null = null
  private segmentDrag: {
    layer: VectorLayer
    before: VectorGeometry
    paths: Subpath[]
    subpath: number
    index: number
    start: Point
    inverse: AffineMatrix
    weight: number
  } | null = null
  private anchorDrag: AnchorDrag | null = null
  private selectionMove: {
    start: Point
    entries: Array<{
      layer: VectorLayer
      before: import('../core/model/types').LayerTransform
      inverse: AffineMatrix
    }>
    duplicated: boolean
  } | null = null
  private pointer: number | null = null
  private down: Point | null = null
  private marquee: { start: Point; end: Point; additive: boolean } | null = null
  private get selectedAnchor() {
    return this.editor.vectorAnchor
  }
  private set selectedAnchor(
    value: { layerId: string; subpath: number; index: number } | null,
  ) {
    this.editor.vectorAnchor = value
  }
  private guides: {
    vertical: number | null
    horizontal: number | null
    width: number
    height: number
  } | null = null
  private tool = 'move'
  constructor(
    host: HTMLElement,
    private renderer: PixiViewportRenderer,
    private getEditor: () => EditorCore,
    private options: ToolControllerOptions,
  ) {
    this.overlay = new VectorEditingOverlay(host, renderer)
  }
  get dragging(): boolean { return this.pointer !== null }
  private get editor(): EditorCore {
    return this.getEditor()
  }
  setTool(tool: string): void {
    if (tool !== this.tool) this.cancel()
    this.tool = tool
    this.refresh()
  }
  suspend(): void {
    this.cancel()
    this.overlay.set([])
    this.selectedAnchor = null
  }
  destroy(): void {
    this.cancel()
    this.overlay.destroy()
  }
  cancel(): void {
    if (this.segmentDrag) {
      this.segmentDrag.layer.geometry = this.segmentDrag.before
      this.renderer.scheduleRefreshDocument()
      this.segmentDrag = null
    }
    if (this.anchorDrag) {
      this.anchorDrag.layer.geometry = this.anchorDrag.before
      this.renderer.scheduleRefreshDocument()
    }
    if (this.selectionMove) {
      this.selectionMove.entries.forEach((e) => {
        Object.assign(e.layer.transform, e.before)
      })
      if (this.selectionMove.duplicated) this.editor.cancelTransaction()
      this.selectionMove = null
      this.renderer.scheduleRefreshDocument()
    }
    this.guides = null
    this.anchorDrag = null
    this.draft = null
    this.pointer = null
    this.down = null
    this.marquee = null
    this.refresh()
  }
  closePath(): void {
    if (this.draft) {
      this.draft.closed = true
      this.finish()
    } else {
      const layer = this.activeVector()
      if (layer) {
        const paths = readSubpaths(layer.geometry)
        paths.forEach((path) => {
          path.closed = true
        })
        this.editor.execute(
          new SetVectorGeometryCommand(layer.id, {
            type: 'path',
            d: writeSubpaths(paths),
          }),
        )
        this.refresh()
      }
    }
  }
  finish(): void {
    const draft = this.draft
    if (draft && draft.anchors.length >= 2) {
      const s = this.options.getShape()
      const style: VectorStyle = {
        fill: draft.closed ? s.fill : null,
        stroke: s.stroke ?? s.fill ?? '#000000',
        strokeWidth: Math.max(1, s.strokeWidth),
        fillRule: 'nonzero',
        fillOpacity: s.fillOpacity,
        strokeOpacity: s.strokeOpacity,
      }
      try { createVectorArtwork(this.editor, 'Pen Path', 0, 0, { type: 'path', d: writeSubpaths([draft]) }, style, s.opacity, s.creationMode) } catch (error) { this.options.onError(error instanceof Error ? error.message : 'Path creation failed'); return }
    }
    this.draft = null
    this.pointer = null
    this.down = null
    this.refresh()
  }
  pointerDown(event: PointerEvent, point: Point): boolean {
    this.tool = this.options.getTool()
    if (
      !this.editor.document ||
      event.button !== 0 ||
      (!penTools.includes(this.tool) && !selectionTools.includes(this.tool))
    )
      return false
    event.preventDefault()
    this.pointer = event.pointerId
    this.down = point
    if (penTools.includes(this.tool)) {
      if (
        this.draft &&
        this.draft.anchors.length > 2 &&
        this.distance(point, this.draft.anchors[0]!.point) <
          8 / this.renderer.getZoom()
      ) {
        this.draft.closed = true
        this.finish()
        return true
      }
      this.draft ??= { anchors: [], closed: false }
      if (
        this.tool === 'curvature-pen' &&
        event.detail === 2 &&
        this.draft.anchors.length
      ) {
        const anchor = this.draft.anchors.at(-1)!
        anchor.smooth = false
        anchor.incoming = { ...anchor.point }
        anchor.outgoing = { ...anchor.point }
        this.refresh()
        return true
      }
      const anchor = corner(point)
      anchor.smooth = this.tool !== 'pen'
      this.draft.anchors.push(anchor)
      if (this.tool === 'curvature-pen') this.smoothDraft()
    } else {
      const active = this.activeVector()
      if (this.tool === 'direct-selection' && active) {
        const world = worldMatrix(this.editor.document.layers, active.id)
        if (world) {
          const paths = readSubpaths(active.geometry),
            inverse = invertAffine(world)
          for (let s = 0; s < paths.length; s++)
            for (let i = 0; i < paths[s]!.anchors.length; i++) {
              const anchor = paths[s]!.anchors[i]!
              for (const part of ['incoming', 'outgoing', 'point'] as const) {
                if (
                  part !== 'point' &&
                  this.distance(anchor[part], anchor.point) < 0.001
                )
                  continue
                if (
                  this.distance(transformPoint(world, anchor[part]), point) <
                  8 / this.renderer.getZoom()
                ) {
                  this.editor.vectorSegment = null
                  this.selectedAnchor = {
                    layerId: active.id,
                    subpath: s,
                    index: i,
                  }
                  this.anchorDrag = {
                    layer: active,
                    before: structuredClone(active.geometry),
                    paths,
                    subpath: s,
                    index: i,
                    part,
                    inverse,
                    world,
                  }
                  if (event.detail === 2 && part === 'point') {
                    anchor.incoming = { ...anchor.point }
                    anchor.outgoing = { ...anchor.point }
                    active.geometry = { type: 'path', d: writeSubpaths(paths) }
                    this.renderer.scheduleRefreshDocument()
                  }
                  this.editor.document.revision++
                  this.editor.events.emit(
                    'document:changed',
                    this.editor.document,
                  )
                  this.refresh()
                  return true
                }
              }
            }
          const hit = nearestSegment(active.geometry, world, point)
          if (hit && hit.distance < 8 / this.renderer.getZoom()) {
            if (event.altKey) {
              splitSegment(
                paths[hit.subpath]!,
                hit.index,
                Math.max(0.001, Math.min(0.999, hit.t)),
              )
              this.editor.execute(
                new SetVectorGeometryCommand(active.id, {
                  type: 'path',
                  d: writeSubpaths(paths),
                }),
              )
              this.selectedAnchor = {
                layerId: active.id,
                subpath: hit.subpath,
                index: hit.index + 1,
              }
            } else {
              const t = Math.max(0.1, Math.min(0.9, hit.t))
              this.editor.vectorSegment = {
                layerId: active.id,
                subpath: hit.subpath,
                index: hit.index,
              }
              this.selectedAnchor = null
              this.segmentDrag = {
                layer: active,
                before: structuredClone(active.geometry),
                paths,
                subpath: hit.subpath,
                index: hit.index,
                start: transformPoint(inverse, point),
                inverse,
                weight: 3 * t * (1 - t),
              }
            }
            this.editor.document.revision++
            this.editor.events.emit('document:changed', this.editor.document)
            this.refresh()
            return true
          }
        }
      }
      let hit = layerAtPoint(
        this.editor.document.layers,
        point,
        this.renderer.getZoom(),
      )
      if (event.ctrlKey || event.metaKey) {
        const hits = layersAtPoint(
          this.editor.document.layers,
          point,
          this.renderer.getZoom(),
        ).filter((layer) => layer.kind === 'vector')
        const index = hits.findIndex(
          (layer) => layer.id === this.editor.document!.activeLayerId,
        )
        hit = hits[(index + 1) % hits.length] ?? hit
      }
      if (hit?.kind === 'vector') {
        if (
          !this.editor.document.selectedLayerIds.includes(hit.id) ||
          event.shiftKey
        )
          this.editor.layers.select(
            hit.id,
            event.shiftKey ? 'toggle' : 'replace',
          )
        if (this.tool === 'path-selection' && !event.shiftKey) {
          let ids = [...this.editor.document.selectedLayerIds]
          if (event.altKey) {
            this.editor.beginTransaction('Duplicate and Move Shapes')
            ids = ids.map((id) => {
              this.editor.execute(new DuplicateLayerCommand(id))
              return this.editor.document!.activeLayerId!
            })
            this.editor.document.selectedLayerIds = ids
          }
          const entries = ids.flatMap((id) => {
            const layer = this.editor.layers.find(id),
              parentId = this.editor.layers.locationOf(id)?.parentId
            if (layer?.kind !== 'vector') return []
            const parent = parentId
              ? (worldMatrix(this.editor.document!.layers, parentId) ??
                IDENTITY_MATRIX)
              : IDENTITY_MATRIX
            return [
              {
                layer,
                before: { ...layer.transform },
                inverse: invertAffine(parent),
              },
            ]
          })
          this.selectionMove = {
            start: point,
            entries,
            duplicated: event.altKey,
          }
        }
        if (event.detail === 2) this.options.onToolChange('direct-selection')
      } else
        this.marquee = { start: point, end: point, additive: event.shiftKey }
    }
    this.refresh()
    return true
  }
  pointerMove(event: PointerEvent, point: Point): boolean {
    if (!penTools.includes(this.tool) && !selectionTools.includes(this.tool))
      return false
    if (this.pointer !== event.pointerId) {
      if (this.draft) {
        const preview = structuredClone(this.draft)
        preview.anchors.push(corner(point))
        this.overlay.set([preview])
      }
      return true
    }
    if (this.segmentDrag) {
      const drag = this.segmentDrag,
        paths = readSubpaths(drag.before),
        path = paths[drag.subpath]!,
        a = path.anchors[drag.index]!,
        b = path.anchors[(drag.index + 1) % path.anchors.length]!,
        local = transformPoint(drag.inverse, point)
      const dx = (local.x - drag.start.x) / drag.weight,
        dy = (local.y - drag.start.y) / drag.weight
      a.outgoing.x += dx
      a.outgoing.y += dy
      b.incoming.x += dx
      b.incoming.y += dy
      drag.layer.geometry = { type: 'path', d: writeSubpaths(paths) }
      this.renderer.scheduleRefreshDocument()
    } else if (this.selectionMove) {
      const move = this.selectionMove
      let dx = point.x - move.start.x,
        dy = point.y - move.start.y
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      move.entries.forEach((e) => {
        const origin = transformPoint(e.inverse, { x: 0, y: 0 }),
          delta = transformPoint(e.inverse, { x: dx, y: dy })
        e.layer.transform.x = e.before.x + delta.x - origin.x
        e.layer.transform.y = e.before.y + delta.y - origin.y
      })
      if (
        this.options.getSnapToCanvas() &&
        this.editor.document &&
        move.entries.length
      ) {
        const first = move.entries[0]!,
          doc = this.editor.document,
          snapped = snapMove(
            doc.layers,
            first.layer,
            doc.dimensions.width,
            doc.dimensions.height,
            this.renderer.getZoom(),
            move.entries.map((e) => e.layer.id),
          )
        const parent = invertAffine(first.inverse),
          origin = transformPoint(parent, { x: 0, y: 0 }),
          delta = transformPoint(parent, {
            x: snapped.transform.x - first.layer.transform.x,
            y: snapped.transform.y - first.layer.transform.y,
          })
        move.entries.forEach((e) => {
          const zero = transformPoint(e.inverse, { x: 0, y: 0 }),
            local = transformPoint(e.inverse, {
              x: delta.x - origin.x,
              y: delta.y - origin.y,
            })
          e.layer.transform.x += local.x - zero.x
          e.layer.transform.y += local.y - zero.y
        })
        this.guides = {
          vertical: snapped.vertical,
          horizontal: snapped.horizontal,
          width: doc.dimensions.width,
          height: doc.dimensions.height,
        }
      }
      this.renderer.scheduleRefreshDocument()
    } else if (this.anchorDrag) {
      const drag = this.anchorDrag,
        anchor = drag.paths[drag.subpath]!.anchors[drag.index]!,
        p = transformPoint(drag.inverse, point)
      if (drag.part === 'point')
        drag.paths[drag.subpath]!.anchors[drag.index] = moveAnchor(anchor, p)
      else {
        anchor[drag.part] = p
        if (!event.altKey)
          anchor[drag.part === 'incoming' ? 'outgoing' : 'incoming'] = {
            x: 2 * anchor.point.x - p.x,
            y: 2 * anchor.point.y - p.y,
          }
      }
      drag.layer.geometry = { type: 'path', d: writeSubpaths(drag.paths) }
      this.renderer.scheduleRefreshDocument()
    } else if (this.draft && this.down) {
      if (this.tool === 'freeform-pen') {
        if (
          this.distance(point, this.draft.anchors.at(-1)!.point) >
            3 / this.renderer.getZoom() &&
          this.draft.anchors.length < 4096
        ) {
          this.draft.anchors.push({ ...corner(point), smooth: true })
          this.smoothDraft()
        }
      } else if (this.tool === 'pen') {
        const anchor = this.draft.anchors.at(-1)!
        anchor.outgoing = point
        anchor.incoming = {
          x: 2 * anchor.point.x - point.x,
          y: 2 * anchor.point.y - point.y,
        }
      }
    } else if (this.marquee) this.marquee.end = point
    this.refresh()
    return true
  }
  pointerUp(event: PointerEvent): boolean {
    if (this.pointer !== event.pointerId) return false
    if (this.segmentDrag) {
      const drag = this.segmentDrag,
        after = structuredClone(drag.layer.geometry)
      drag.layer.geometry = drag.before
      this.segmentDrag = null
      if (JSON.stringify(after) !== JSON.stringify(drag.before))
        this.editor.execute(new SetVectorGeometryCommand(drag.layer.id, after))
    } else if (this.selectionMove) {
      const move = this.selectionMove
      if (!move.duplicated) this.editor.beginTransaction('Move Shapes')
      move.entries.forEach((e) => {
        if (JSON.stringify(e.before) !== JSON.stringify(e.layer.transform))
          this.editor.commitExecuted(
            new SetLayerTransformCommand(e.layer.id, e.before, {
              ...e.layer.transform,
            }),
          )
      })
      this.editor.commitTransaction()
      this.selectionMove = null
    } else if (this.anchorDrag) {
      const drag = this.anchorDrag,
        after = structuredClone(drag.layer.geometry)
      drag.layer.geometry = drag.before
      if (JSON.stringify(after) !== JSON.stringify(drag.before))
        this.editor.execute(new SetVectorGeometryCommand(drag.layer.id, after))
      this.anchorDrag = null
    } else if (this.marquee && this.editor.document) {
      const m = this.marquee,
        left = Math.min(m.start.x, m.end.x),
        top = Math.min(m.start.y, m.end.y),
        right = Math.max(m.start.x, m.end.x),
        bottom = Math.max(m.start.y, m.end.y)
      if (!m.additive) {
        this.editor.document.selectedLayerIds = []
        this.editor.document.activeLayerId = null
      }
      for (const entry of vectorEntries(this.editor.document.layers)) {
        const b = geometryBounds(entry.layer.geometry)
        const corners = [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
          { x: b.x, y: b.y + b.height },
        ].map((p) => transformPoint(entry.world, p))
        if (
          corners.every(
            (p) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom,
          )
        )
          this.editor.layers.select(entry.layer.id, 'add')
      }
      this.marquee = null
      this.editor.document.revision++
      this.editor.events.emit('document:changed', this.editor.document)
    }
    if (this.tool === 'freeform-pen') this.finish()
    this.pointer = null
    this.down = null
    this.guides = null
    this.renderer.getCanvas().style.cursor = penTools.includes(this.tool)
      ? 'crosshair'
      : this.tool === 'path-selection'
        ? 'move'
        : 'default'
    this.refresh()
    return true
  }
  keyDown(event: KeyboardEvent): boolean {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    )
      return false
    const active = this.activeVector(),
      modifier = event.ctrlKey || event.metaKey
    if (penTools.includes(this.tool) && event.key === 'Enter') {
      event.preventDefault()
      this.finish()
      return true
    }
    if (
      (penTools.includes(this.tool) || selectionTools.includes(this.tool)) &&
      event.key === 'Escape'
    ) {
      this.cancel()
      return true
    }
    if (modifier && event.key.toLowerCase() === 'g' && this.editor.document) {
      event.preventDefault()
      if (event.shiftKey) {
        const id = this.editor.document.activeLayerId
        if (id && this.editor.layers.find(id)?.kind === 'group')
          this.editor.execute(new UngroupLayerCommand(id))
      } else if (this.editor.document.selectedLayerIds.length > 1)
        this.editor.execute(
          new GroupLayersCommand(this.editor.document.selectedLayerIds),
        )
      return true
    }
    if (
      modifier &&
      event.key.toLowerCase() === 'd' &&
      (selectionTools.includes(this.tool) ||
        (active && !this.editor.selection)) &&
      this.editor.document
    ) {
      event.preventDefault()
      this.editor.document.selectedLayerIds = []
      this.editor.document.activeLayerId = null
      this.selectedAnchor = null
      this.editor.document.revision++
      this.editor.events.emit('document:changed', this.editor.document)
      this.refresh()
      return true
    }
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      active &&
      selectionTools.includes(this.tool)
    ) {
      event.preventDefault()
      if (
        this.tool === 'direct-selection' &&
        this.selectedAnchor?.layerId === active.id
      ) {
        const paths = readSubpaths(active.geometry),
          selected = this.selectedAnchor
        paths[selected.subpath]?.anchors.splice(selected.index, 1)
        this.editor.execute(
          new SetVectorGeometryCommand(active.id, {
            type: 'path',
            d: writeSubpaths(paths.filter((p) => p.anchors.length >= 2)),
          }),
        )
        this.selectedAnchor = null
      } else new VectorClipboard().delete(this.editor)
      this.refresh()
      return true
    }
    if (
      active &&
      !modifier &&
      event.key.startsWith('Arrow') &&
      ['move', ...selectionTools].includes(this.tool)
    ) {
      event.preventDefault()
      const delta = event.shiftKey ? 10 : 1,
        before = { ...active.transform },
        after = { ...before }
      if (event.key === 'ArrowLeft') after.x -= delta
      if (event.key === 'ArrowRight') after.x += delta
      if (event.key === 'ArrowUp') after.y -= delta
      if (event.key === 'ArrowDown') after.y += delta
      this.editor.execute(
        new SetLayerTransformCommand(active.id, before, after),
      )
      this.refresh()
      return true
    }
    return false
  }
  refresh(): void {
    if (this.draft) {
      this.overlay.set([this.draft])
      return
    }
    const doc = this.editor.document
    if (!doc || !selectionTools.includes(this.tool)) {
      this.overlay.set([])
      return
    }
    const paths = vectorEntries(doc.layers)
      .filter((e) => doc.selectedLayerIds.includes(e.layer.id))
      .flatMap((e) =>
        readSubpaths(e.layer.geometry).map((path) => ({
          ...path,
          anchors: path.anchors.map((a) => ({
            point: transformPoint(e.world, a.point),
            incoming: transformPoint(e.world, a.incoming),
            outgoing: transformPoint(e.world, a.outgoing),
          })),
        })),
      )
    this.overlay.set(paths, this.marquee, this.guides)
  }
  private activeVector(): VectorLayer | null {
    const id = this.editor.document?.activeLayerId,
      layer = id ? this.editor.layers.find(id) : null
    return layer?.kind === 'vector' && this.editor.document && isObjectEditable(this.editor.document.layers, layer.id)
      ? layer
      : null
  }
  private distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  private smoothDraft(): void {
    const anchors = this.draft?.anchors
    if (!anchors) return
    anchors.forEach((a, i) => {
      if (a.smooth === false) return
      const previous = anchors[Math.max(0, i - 1)]!.point,
        next = anchors[Math.min(anchors.length - 1, i + 1)]!.point
      const dx = (next.x - previous.x) / 6,
        dy = (next.y - previous.y) / 6
      a.incoming = { x: a.point.x - dx, y: a.point.y - dy }
      a.outgoing = { x: a.point.x + dx, y: a.point.y + dy }
    })
  }
}
export function vectorEntries(
  layers: readonly Layer[],
  parent: AffineMatrix = IDENTITY_MATRIX,
): Array<{ layer: VectorLayer; world: AffineMatrix }> {
  return layers.flatMap((layer) => {
    if (!layer.visible || layer.locked) return []
    const world = multiplyAffine(parent, layerLocalMatrix(layer))
    return layer.kind === 'vector'
      ? [{ layer, world }]
      : layer.kind === 'group'
        ? vectorEntries(layer.children, world)
        : []
  })
}
export function worldMatrix(
  layers: readonly Layer[],
  id: string,
  parent: AffineMatrix = IDENTITY_MATRIX,
): AffineMatrix | null {
  for (const layer of layers) {
    const world = multiplyAffine(parent, layerLocalMatrix(layer))
    if (layer.id === id) return world
    if (layer.kind === 'group') {
      const child = worldMatrix(layer.children, id, world)
      if (child) return child
    }
  }
  return null
}
