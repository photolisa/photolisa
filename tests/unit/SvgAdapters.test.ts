// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { SvgImporter } from '../../src/adapters/SvgImporter'
import { SvgExporter } from '../../src/adapters/SvgExporter'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { packNativeProject, unpackNativeProject } from '../../src/adapters/NativeProjectFormat'
import { EditorCore } from '../../src/core/EditorCore'
import { SetVectorGeometryCommand, SetVectorStyleCommand } from '../../src/core/commands/VectorCommands'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="10 20 100 50"><g id="art" transform="translate(5 6)" opacity="0.5"><rect id="box" x="1" y="2" width="40" height="20" fill="#ff0000"/><path id="curve" d="M 0 0 L 10 10 Z" stroke="#00ff00" fill="none"/></g><circle cx="30" cy="30" r="10"/><ellipse cx="50" cy="25" rx="8" ry="5"/><polygon points="0,0 10,0 5,5"/><line x1="0" y1="0" x2="20" y2="20"/></svg>`

describe('SVG supported subset', () => {
  it('imports editable geometry, hierarchy, transforms and viewBox, then serializes native and SVG', async () => {
    const { document, warnings } = new SvgImporter().parse(svg)
    expect(warnings).toEqual([])
    expect(document.dimensions).toMatchObject({ width: 200, height: 100 })
    expect(document.metadata.svgViewBox).toEqual({ x: 10, y: 20, width: 100, height: 50 })
    const viewBoxGroup = document.layers[0]
    expect(viewBoxGroup?.kind).toBe('group')
    if (viewBoxGroup?.kind !== 'group') throw new Error('Expected viewBox group')
    expect(viewBoxGroup.children.map((layer) => layer.kind)).toEqual(['group', 'vector', 'vector', 'vector', 'vector'])
    const art = viewBoxGroup.children[0]
    if (art?.kind !== 'group') throw new Error('Expected art group')
    expect(art.svgMatrix).toEqual([1, 0, 0, 1, 5, 6])
    expect(art.children.map((layer) => layer.kind)).toEqual(['vector', 'vector'])
    expect(art.children[0]?.kind === 'vector' && art.children[0].geometry).toMatchObject({ type: 'rect', x: 1, width: 40 })
    const restored = EditorDocument.deserialize(unpackNativeProject(packNativeProject(document.serialize(), [])).manifest.document)
    expect(restored.layers).toEqual(document.layers)
    const result = await new SvgExporter().export(restored)
    const text = await result.blob.text()
    expect(text).toContain('<path d="M 0 0 L 10 10 Z"')
    expect(text).toContain('<rect x="1" y="2" width="40"')
    expect(text).toContain('matrix(2 0 0 2')
  })

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect onload="alert(1)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://evil.test/a.png"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "https://evil.test">]><svg xmlns="http://www.w3.org/2000/svg"/>',
  ])('rejects unsafe content: %s', (input) => {
    expect(() => new SvgImporter().parse(input)).toThrow()
  })

  it('reports unsupported elements rather than pretending to preserve them', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>Hi</text><rect width="10" height="10"/></svg>'
    const result = new SvgImporter().parse(input)
    expect(result.warnings.some((warning) => warning.includes('<text> was skipped'))).toBe(true)
    expect(result.document.layers).toHaveLength(1)
  })

  it('supports safe inline paint styles and undoable vector edits', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" style="fill:#ff0000;stroke:#0000ff;stroke-width:2;fill-opacity:0.5"/></svg>'
    const { document } = new SvgImporter().parse(input)
    const layer = document.layers[0]
    if (layer?.kind !== 'vector') throw new Error('Expected vector layer')
    expect(layer.style).toMatchObject({ fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2, fillOpacity: 0.5 })
    const editor = new EditorCore(); editor.setDocument(document)
    editor.execute(new SetVectorStyleCommand(layer.id, { ...layer.style, fill: '#00ff00' }))
    expect(layer.style.fill).toBe('#00ff00')
    editor.undo()
    expect(layer.style.fill).toBe('#ff0000')
    editor.redo()
    expect(layer.style.fill).toBe('#00ff00')
    editor.execute(new SetVectorGeometryCommand(layer.id, { type: 'rect', x: 2, y: 0, width: 8, height: 10, rx: 0, ry: 0 }))
    expect(layer.geometry).toMatchObject({ x: 2, width: 8 })
    editor.undo()
    expect(layer.geometry).toMatchObject({ x: 0, width: 10 })
    expect(() => editor.execute(new SetVectorGeometryCommand(layer.id, { type: 'circle', cx: 0, cy: 0, r: -2 }))).toThrow(/radius/)
  })

  it('resolves simple SVG class styles into editable path layers without compatibility warnings', async () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><style type="text/css">.ink { fill: #ff0000; stroke: #0000ff; stroke-width: 2 } path.dim { opacity: .5; fill-opacity: .25 } .ink { stroke: #00ff00 }</style><path id="first" class="ink dim" d="M 0 0 L 10 0 L 10 10 Z" fill="#ffffff"/><path id="second" class="ink" d="M 0 10 L 10 10 Z" style="fill:#112233"/></svg>'
    const { document, warnings } = new SvgImporter().parse(input)
    expect(warnings).toEqual([])
    expect(document.layers).toHaveLength(2)
    const [first, second] = document.layers
    expect(first?.kind).toBe('vector')
    expect(second?.kind).toBe('vector')
    if (first?.kind !== 'vector' || second?.kind !== 'vector') throw new Error('Expected vector paths')
    expect(first).toMatchObject({ opacity: 0.5, style: { fill: '#ff0000', stroke: '#00ff00', strokeWidth: 2, fillOpacity: 0.25 } })
    expect(second.style.fill).toBe('#112233')
    const restored = EditorDocument.deserialize(document.serialize())
    expect(restored.layers).toEqual(document.layers)
    const exported = await new SvgExporter().export(restored)
    const xml = await exported.blob.text()
    expect(xml).toContain('opacity="0.5"')
    expect(xml).toContain('fill="#ff0000" stroke="#00ff00"')
  })

  it.each([
    '<style>.ink{fill:url(https://evil.test/x.svg)}</style>',
    '<style>@import "https://evil.test/x.css"; .ink{fill:red}</style>',
    '<style>.ink{fill:red;stroke:expression(alert(1))}</style>',
  ])('rejects unsafe stylesheet content: %s', (css) => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${css}<path class="ink" d="M 0 0 L 5 5"/></svg>`
    expect(() => new SvgImporter().parse(input)).toThrow(/Unsafe/)
  })

  it('reports unsupported complex selectors without applying them', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>g .ink{fill:red}.ink{stroke:blue}</style><path class="ink" d="M 0 0 L 5 5"/></svg>'
    const { document, warnings } = new SvgImporter().parse(input)
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('g .ink')]))
    const layer = document.layers[0]
    if (layer?.kind !== 'vector') throw new Error('Expected vector path')
    expect(layer.style.fill).toBe('#000000')
    expect(layer.style.stroke).toBe('blue')
  })

  it('applies a class on a group to descendant paint and ignores safe CSS comments', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>/* url(https://example.test/unused) */ .paint{fill:#123456}</style><g class="paint"><path d="M 0 0 L 5 5"/></g></svg>'
    const { document, warnings } = new SvgImporter().parse(input)
    expect(warnings).toEqual([])
    const group = document.layers[0]
    if (group?.kind !== 'group' || group.children[0]?.kind !== 'vector') throw new Error('Expected group with vector path')
    expect(group.children[0].style.fill).toBe('#123456')
  })

  it('rejects unsafe vector style values in native project data', () => {
    const { document } = new SvgImporter().parse('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
    const serialized = document.serialize()
    const layer = serialized.layers[0]
    if (layer?.kind !== 'vector') throw new Error('Expected vector layer')
    layer.style.fillRule = 'nonzero" onload="alert(1)' as typeof layer.style.fillRule
    expect(() => EditorDocument.deserialize(serialized)).toThrow(/fill rule/)
  })
})

it('imports gradients, polyline and nested pivot transforms and exports paint without rasterization', async () => {
  const input = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><defs><linearGradient id="paint"><stop offset="0" stop-color="#f00"/><stop offset="100%" stop-color="#00f"/></linearGradient></defs><g transform="rotate(30 50 50) skewX(10)"><rect width="100" height="60" fill="url(#paint)" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="8 4"/><polyline points="0,0 20,30 40,0" fill="none" stroke="#000"/></g></svg>'
  const { document, warnings } = new SvgImporter().parse(input)
  expect(warnings).toEqual([])
  const group = document.layers[0]; if (group?.kind !== 'group') throw new Error('Expected group')
  const rect = group.children[0]; if (rect?.kind !== 'vector') throw new Error('Expected vector')
  expect(rect.style.fillGradient?.stops).toHaveLength(2)
  expect(rect.style.strokeDash).toEqual([8, 4]); expect(rect.style.strokeCap).toBe('round')
  const exported = await (await new SvgExporter().export(document)).blob.text()
  expect(exported).toContain('<linearGradient'); expect(exported).toContain('stroke-dasharray="8 4"'); expect(exported).not.toContain('<image')
  const reopened = new SvgImporter().parse(exported).document
  expect(reopened.layers.length).toBeGreaterThan(0)
})

it.each([
  '<defs><linearGradient id="a"><stop offset="0" stop-color="#f00"/><stop offset="9" stop-color="#00f"/></linearGradient></defs><rect width="10" height="10" fill="url(#a)"/>',
  '<rect width="10" height="10" fill="url(https://evil.test/a)"/>',
  '<rect width="10" height="10" fill="url(#missing)"/>',
  '<path d="M1e999 0 L10 10"/>',
])('rejects invalid gradients, paths and external paint resources', body => {
  expect(() => new SvgImporter().parse(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`)).toThrow()
})

it('roundtrips exported stroke alignment and gradient transforms as editable vectors', async () => {
  const source = new SvgImporter().parse('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><radialGradient id="g" gradientTransform="rotate(30 .5 .5)" fx=".3" fy=".4"><stop offset="0" style="stop-color:#f00;stop-opacity:.5"/><stop offset="1" stop-color="#00f"/></radialGradient></defs><rect width="80" height="60" style="fill:url(#g)" stroke="#000" stroke-width="4"/></svg>').document
  const layer = source.layers[0]; if (layer?.kind !== 'vector') throw new Error('Expected vector')
  layer.style.strokeAlignment = 'outside'
  expect(layer.style.fillGradient?.focus).toEqual({ x: .3, y: .4 })
  expect(layer.style.fillGradient?.stops[0]?.opacity).toBe(.5)
  const svg = await (await new SvgExporter().export(source)).blob.text()
  expect(svg).toContain('gradientTransform="matrix(')
  const restored = new SvgImporter().parse(svg).document
  const group = restored.layers[0]; if (group?.kind !== 'group') throw new Error('Expected exported layer group')
  const stroke = group.children.find(child => child.kind === 'vector' && child.style.strokeAlignment === 'outside')
  expect(stroke?.kind === 'vector' && stroke.style.strokeWidth).toBe(4)
})
