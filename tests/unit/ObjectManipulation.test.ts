import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorCore } from '../../src/core/EditorCore'
import { CreateDocumentCommand } from '../../src/core/commands/CreateDocumentCommand'
import {
  createLayerBase,
  type GroupLayer,
  type VectorLayer,
} from '../../src/core/model/types'
import { ObjectManipulation } from '../../src/tools/ObjectManipulation'
import type { PixiViewportRenderer } from '../../src/renderer/PixiViewportRenderer'
import type { InteractionOverlay } from '../../src/renderer/InteractionOverlay'
import type { ToolControllerOptions } from '../../src/tools/EditorToolController'

function shape(id: string, x: number, y: number): VectorLayer {
  return {
    ...createLayerBase(id, 'vector', id),
    kind: 'vector',
    transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
    geometry: { type: 'rect', x: 0, y: 0, width: 80, height: 60, rx: 0, ry: 0 },
    style: { fill: '#f00', stroke: null, strokeWidth: 0, fillRule: 'nonzero' },
  }
}
function pointer(properties: Partial<PointerEvent> = {}): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    detail: 1,
    preventDefault: vi.fn(),
    ...properties,
  } as PointerEvent
}
function keyboard(key: string, shiftKey = false): KeyboardEvent {
  return {
    key,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent
}
function setup() {
  const editor = new EditorCore()
  editor.execute(
    new CreateDocumentCommand({
      name: 'Test',
      width: 400,
      height: 300,
      resolution: 72,
      background: 'transparent',
    }),
  )
  editor.document!.layers.splice(0)
  const a = shape('a', 40, 40),
    b = shape('b', 180, 40)
  editor.layers.insert(a)
  editor.layers.insert(b)
  editor.layers.select(a.id, 'replace')
  const canvas = { clientWidth: 800, clientHeight: 600, style: { cursor: '' } }
  const renderer = {
    getZoom: () => 1,
    documentToScreen: (p: { x: number; y: number }) => p,
    getCanvas: () => canvas,
    scheduleRefreshDocument: vi.fn(),
  } as unknown as PixiViewportRenderer
  const overlay = { setState: vi.fn() } as unknown as InteractionOverlay
  const options = {
    getTool: () => 'move',
    getAutoSelect: () => true,
    getSnapToCanvas: () => false,
    getTransformOrigin: () => ({ x: 0.5, y: 0.5 }),
    onError: vi.fn(),
    onToolChange: vi.fn(),
    onCanvasControls: vi.fn(),
  } as unknown as ToolControllerOptions
  const controller = new ObjectManipulation(
    () => editor,
    renderer,
    overlay,
    options,
  )
  return { editor, controller, a, b, overlay, options }
}
let frames: FrameRequestCallback[] = []
beforeEach(() => {
  frames = []
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((fn: FrameRequestCallback) => {
      frames.push(fn)
      return frames.length
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())
describe('on-canvas interactions', () => {
  it('moves a mixed selection once per gesture and ignores another pointer', () => {
    const { editor, controller, a, b } = setup()
    editor.layers.select(b.id, 'add')
    const count = editor.history.retainedEntries
    controller.pointerDown(pointer(), { x: 80, y: 70 })
    controller.pointerMove(pointer({ pointerId: 2 }), { x: 1000, y: 1000 })
    expect(a.transform.x).toBe(40)
    controller.pointerMove(pointer(), { x: 100, y: 85 })
    controller.pointerUp(pointer())
    expect(a.transform).toMatchObject({ x: 60, y: 55 })
    expect(b.transform).toMatchObject({ x: 200, y: 55 })
    expect(editor.history.retainedEntries).toBe(count + 1)
    editor.undo()
    expect(a.transform.x).toBe(40)
    expect(b.transform.x).toBe(180)
    editor.redo()
    expect(b.transform.x).toBe(200)
  })
  it('restores previews on cancellation and does not add history', () => {
    const { editor, controller, a } = setup()
    const count = editor.history.retainedEntries
    controller.pointerDown(pointer(), { x: 80, y: 70 })
    controller.pointerMove(pointer(), { x: 110, y: 80 })
    frames.shift()?.(0)
    expect(a.transform.x).toBe(70)
    controller.cancel()
    expect(a.transform.x).toBe(40)
    expect(editor.history.retainedEntries).toBe(count)
  })
  it('duplicates lazily and records duplicate plus movement in one transaction', () => {
    const { editor, controller, a } = setup()
    const count = editor.history.retainedEntries
    controller.pointerDown(pointer({ altKey: true }), { x: 80, y: 70 })
    controller.pointerMove(pointer({ altKey: true }), { x: 110, y: 90 })
    controller.pointerUp(pointer())
    expect(editor.document!.layers).toHaveLength(3)
    expect(a.transform.x).toBe(40)
    expect(editor.history.retainedEntries).toBe(count + 1)
    editor.undo()
    expect(editor.document!.layers).toHaveLength(2)
    editor.redo()
    expect(editor.document!.layers).toHaveLength(3)
  })
  it('cancels an already-previewed Alt duplicate and restores original selection', () => {
    const { editor, controller, a } = setup()
    const count = editor.history.retainedEntries
    controller.pointerDown(pointer({ altKey: true }), { x: 80, y: 70 })
    controller.pointerMove(pointer({ altKey: true }), { x: 110, y: 90 })
    frames.shift()?.(0)
    expect(editor.document!.layers).toHaveLength(3)
    controller.cancel()
    expect(editor.document!.layers).toHaveLength(2)
    expect(editor.document!.selectedLayerIds).toEqual([a.id])
    expect(editor.history.retainedEntries).toBe(count)
  })
  it('Shift toggles objects and empty-canvas marquee selects intersecting unlocked objects', () => {
    const { editor, controller, a, b } = setup()
    controller.pointerDown(pointer({ shiftKey: true }), { x: 220, y: 70 })
    expect(editor.document!.selectedLayerIds).toEqual([a.id, b.id])
    b.locked = true
    controller.pointerDown(pointer(), { x: 10, y: 10 })
    controller.pointerMove(pointer(), { x: 290, y: 120 })
    controller.pointerUp(pointer())
    expect(editor.document!.selectedLayerIds).toEqual([a.id])
  })
  it('nudges in document pixels through a rotated, scaled parent', () => {
    const { editor, controller, a } = setup()
    editor.document!.layers.splice(0)
    const group: GroupLayer = {
      ...createLayerBase('g', 'group', 'G'),
      kind: 'group',
      children: [a],
      transform: { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: Math.PI / 2 },
    }
    editor.layers.insert(group)
    editor.layers.select(a.id, 'replace')
    controller.keyDown(keyboard('ArrowRight', true))
    expect(a.transform.x).toBeCloseTo(40)
    expect(a.transform.y).toBeCloseTo(35)
    group.locked = true
    expect(controller.keyDown(keyboard('ArrowDown'))).toBe(false)
  })
  it('cycles overlapping layers with Ctrl-click', () => {
    const { editor, controller, a, b } = setup()
    b.transform.x = 40
    controller.pointerDown(pointer({ ctrlKey: true }), { x: 80, y: 70 })
    controller.pointerUp(pointer())
    expect(editor.document!.activeLayerId).toBe(b.id)
    controller.pointerDown(pointer({ ctrlKey: true }), { x: 80, y: 70 })
    controller.pointerUp(pointer())
    expect(editor.document!.activeLayerId).toBe(a.id)
  })
})
