import { describe, expect, it } from 'vitest'
import { SelectionMask } from '../../src/core/selection/SelectionMask'
import { SetSelectionCommand } from '../../src/core/commands/SelectionCommands'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { CropDocumentCommand } from '../../src/core/commands/EditingCommands'

describe('SelectionMask', () => {
  it('rasterizes curved and lasso edges with fractional alpha', () => {
    const ellipse = SelectionMask.ellipse(16, 16, { x: 2, y: 2, width: 10, height: 10 })
    expect(ellipse.coverageAt(7, 7)).toBe(255)
    expect(ellipse.coverageAt(2, 2)).toBe(0)
    expect(ellipse.coverageAt(4, 3)).toBeGreaterThan(0)
    const triangle = SelectionMask.polygon(16, 16, [{ x: 1, y: 1 }, { x: 13, y: 1 }, { x: 1, y: 13 }])
    expect(triangle.coverageAt(3, 3)).toBe(255)
    expect(triangle.coverageAt(12, 12)).toBe(0)
    expect(triangle.coverageAt(6, 6)).toBeGreaterThan(0)
  })

  it('handles a long freehand contour without a call-stack overflow', () => {
    const points = Array.from({ length: 20_000 }, (_, index) => {
      const angle = index * Math.PI * 2 / 20_000
      return { x: 64 + 40 * Math.cos(angle), y: 64 + 40 * Math.sin(angle) }
    })
    const mask = SelectionMask.polygon(128, 128, points)
    expect(mask.coverageAt(64, 64)).toBe(255)
    expect(mask.coverageAt(0, 0)).toBe(0)
  })

  it('feathers an edge without changing its document dimensions', () => {
    const hard = SelectionMask.rectangle(12, 12, { x: 4, y: 4, width: 4, height: 4 })
    const soft = hard.feather(2)
    expect(soft.documentWidth).toBe(12)
    expect(soft.coverageAt(3, 5)).toBeGreaterThan(0)
    expect(soft.coverageAt(5, 5)).toBeLessThan(255)
    expect(soft.coverageAt(0, 0)).toBe(0)
  })
  it('stores document-space coverage with antialiased fractional rectangle edges', () => {
    const mask = SelectionMask.rectangle(20, 20, { x: 2.5, y: 3, width: 2, height: 2 })
    expect(mask.outlineBounds).toEqual({ x: 2, y: 3, width: 3, height: 2 })
    expect(mask.coverageAt(2, 3)).toBe(128)
    expect(mask.coverageAt(3, 3)).toBe(255)
    expect(mask.coverageAt(4, 3)).toBe(128)
    expect(mask.coverageAt(5, 3)).toBe(0)
  })

  it('combines, subtracts, intersects and inverts masks', () => {
    const left = SelectionMask.rectangle(8, 8, { x: 1, y: 1, width: 3, height: 3 })
    const right = SelectionMask.rectangle(8, 8, { x: 3, y: 1, width: 3, height: 3 })
    expect(left.combine(right, 'add').coverageAt(5, 2)).toBe(255)
    expect(left.combine(right, 'subtract').coverageAt(3, 2)).toBe(0)
    expect(left.combine(right, 'subtract').coverageAt(2, 2)).toBe(255)
    expect(left.combine(right, 'intersect').coverageAt(3, 2)).toBe(255)
    expect(left.combine(right, 'intersect').coverageAt(2, 2)).toBe(0)
    expect(left.invert().coverageAt(0, 0)).toBe(255)
    expect(left.invert().coverageAt(2, 2)).toBe(0)
    expect(SelectionMask.all(8, 8).memoryCost).toBeLessThan(1024)
  })

  it('keeps selection history per editor without dirtying the document', () => {
    const editor = new EditorCore()
    editor.setDocument(EditorDocument.create({ name: 'Test', width: 8, height: 8, resolution: 72, background: 'transparent' }))
    const mask = SelectionMask.rectangle(8, 8, { x: 1, y: 1, width: 2, height: 2 })
    editor.execute(new SetSelectionCommand('Select Rectangle', null, mask))
    expect(editor.selection?.coverageAt(1, 1)).toBe(255)
    expect(editor.isDirty).toBe(false)
    editor.undo()
    expect(editor.selection).toBeNull()
    expect(editor.isDirty).toBe(false)
    editor.redo()
    expect(editor.selection?.coverageAt(1, 1)).toBe(255)
    expect(editor.isDirty).toBe(false)
  })

  it('clears a document-space selection for crop and restores it on undo', () => {
    const editor = new EditorCore()
    editor.setDocument(EditorDocument.create({ name: 'Crop', width: 8, height: 8, resolution: 72, background: 'transparent' }))
    const mask = SelectionMask.rectangle(8, 8, { x: 1, y: 1, width: 3, height: 3 })
    editor.setSelection(mask)
    editor.execute(new CropDocumentCommand({ x: 2, y: 2, width: 4, height: 4 }))
    expect(editor.selection).toBeNull()
    editor.undo()
    expect(editor.selection).toBe(mask)
    editor.redo()
    expect(editor.selection).toBeNull()
  })
})
