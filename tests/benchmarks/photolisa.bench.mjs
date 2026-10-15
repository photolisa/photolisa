import { chromium } from '@playwright/test'

const scenarios = [
  { width: 1920, height: 1080, layers: 10, source: 512 },
  { width: 4096, height: 4096, layers: 20, source: 1024 },
  { width: 8192, height: 8192, layers: 5, source: 2048 },
]
const referenceHashes = [
  'efcf40a7e8acc14b038bfcbc4acca2a810bda86af81205daec733e6f2a4ba958',
  'cd7d11dee800a4c25e1f1df4c85cfc1a866a6dd79cbffa20e06451340e692a05',
  'b2b937a3ee3dc68027ff85d2c7e2cc5d07eaf4ec2e5947d0c2ab168e8d2659ed',
]
const interactionProfile = process.env.PHOTOLISA_BENCH_PROFILE !== 'baseline-comparable'
const independentSources = process.env.PHOTOLISA_BENCH_SOURCE_MODE === 'independent'

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--enable-webgl'] })
console.log(JSON.stringify({ browser: browser.version(), viewport: '1280x800', mode: 'headless Chromium with SwiftShader', profile: interactionProfile ? 'continuous-pan' : 'baseline-comparable', sourceMode: independentSources ? 'independent' : 'shared', runsPerScenario: 1 }))
try {
  for (const [scenarioIndex, config] of scenarios.entries()) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' })
    const cdp = await page.context().newCDPSession(page)
    const beforeHeap = await cdp.send('Runtime.getHeapUsage')
    const result = await page.evaluate(async (scenario) => {
      const [{ EditorDocument }, { createLayerBase }, { rasterSources }, { PixiViewportRenderer }, { RasterStrokeService }, { ImageExportAdapter }] = await Promise.all([
        import('/src/core/model/EditorDocument.ts'), import('/src/core/model/types.ts'),
        import('/src/raster/RasterSourceRegistry.ts'), import('/src/renderer/PixiViewportRenderer.ts'),
        import('/src/raster/RasterStroke.ts'), import('/src/adapters/ImageExportAdapter.ts'),
      ])
      const canvas = document.createElement('canvas'); canvas.width = scenario.source; canvas.height = scenario.source
      const context = canvas.getContext('2d'); context.fillStyle = '#9149ca'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#24c9ad'; context.fillRect(20, 20, Math.max(1, canvas.width / 3), Math.max(1, canvas.height / 3))
      const sourceId = rasterSources.registerCanvas(canvas)
      const sourceIds = [sourceId]
      if (scenario.independentSources) for (let index = 1; index < scenario.layers; index++) {
        const copy = document.createElement('canvas'); copy.width = scenario.source; copy.height = scenario.source
        copy.getContext('2d').drawImage(canvas, 0, 0)
        sourceIds.push(rasterSources.registerCanvas(copy))
      }
      const editorDocument = EditorDocument.create({ name: 'Benchmark', width: scenario.width, height: scenario.height, resolution: 72, background: 'transparent' })
      editorDocument.layers.splice(0, 1)
      for (let index = 0; index < scenario.layers; index++) {
        editorDocument.layers.push({ ...createLayerBase(`bench-layer-${index}`, 'raster', `Layer ${index}`), kind: 'raster', pixelSourceId: sourceIds[scenario.independentSources ? index : 0],
          opacity: 0.65, transform: { x: (index * 113) % Math.max(1, scenario.width - scenario.source), y: (index * 71) % Math.max(1, scenario.height - scenario.source), scaleX: 1, scaleY: 1, rotation: 0 } })
      }
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:640px'; document.body.appendChild(host)
      const rendererErrors = []; const renderer = new PixiViewportRenderer({ sourceRegistry: rasterSources, onError: (message) => rendererErrors.push(message) }); await renderer.initialize(host)
      const openingStart = performance.now(); renderer.setDocument(editorDocument); renderer.fitToScreen(); const openMs = performance.now() - openingStart
      const gpuTextureEstimateBeforeStroke = renderer.getEstimatedGpuTextureBytes()
      if (scenario.interactionProfile) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      const firstPaintMs = scenario.interactionProfile ? performance.now() - openingStart : null
      const frameTimes = []
      let previous = performance.now()
      for (let index = 0; index < (scenario.interactionProfile ? 70 : 20); index++) {
        if (scenario.interactionProfile) renderer.panByScreen(index % 2 === 0 ? 1 : -1, 0)
        await new Promise((resolve) => requestAnimationFrame(() => { const now = performance.now(); if (!scenario.interactionProfile || index >= 10) frameTimes.push(now - previous); previous = now; resolve() }))
      }
      const layer = editorDocument.layers[0]
      const strokeService = new RasterStrokeService(rasterSources)
      const stroke = strokeService.begin(editorDocument, layer, { diameter: 28, hardness: 0.75, opacity: 0.9, color: '#ff9e25' }, 'brush', null)
      const strokeStart = performance.now()
      for (let index = 0; index < 240; index++) stroke.addPoint({ x: 20 + index * 3, y: 50 + 60 * Math.sin(index / 17) }, 0.7)
      const command = stroke.finish(); const strokeMs = performance.now() - strokeStart
      renderer.refreshDocument()
      const exporter = new ImageExportAdapter(rasterSources)
      const exportStart = performance.now(); const blob = await exporter.documentToPng(editorDocument); const exportMs = performance.now() - exportStart
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
      const pngSha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      const gpuTextureEstimateBytes = renderer.getEstimatedGpuTextureBytes()
      exporter.destroy(); renderer.destroy(); host.remove()
      return { openMs, firstPaintMs, strokeMs, strokeHistoryBytes: command?.memoryCost ?? 0, exportMs, pngBytes: blob.size, pngSha256,
        frameIntervalP50: frameTimes.slice().sort((a,b)=>a-b)[Math.floor(frameTimes.length/2)],
        frameIntervalP95: frameTimes.slice().sort((a,b)=>a-b)[Math.floor(frameTimes.length*0.95)],
        renderSubmitMs: renderer.getLastRenderDuration(), sourceBytesEstimate: scenario.source * scenario.source * 4, gpuTextureEstimateBeforeStroke, gpuTextureEstimateBytes, rendererErrors }
    }, { ...config, interactionProfile, independentSources })
    const afterHeap = await cdp.send('Runtime.getHeapUsage')
    if (result.rendererErrors.length) throw new Error(`Renderer errors: ${result.rendererErrors.join(', ')}`)
    const expectedTextureBytes = result.sourceBytesEstimate * (independentSources ? config.layers : 1)
    if (result.gpuTextureEstimateBeforeStroke !== expectedTextureBytes) throw new Error('Source texture allocation did not match the source-reference model')
    if (result.pngSha256 !== referenceHashes[scenarioIndex]) throw new Error(`Export pixels changed in ${config.width}x${config.height} benchmark`)
    console.log(JSON.stringify({ scenario: `${config.width}x${config.height}/${config.layers}`, sourceMode: independentSources ? 'independent' : 'shared', ...result,
      priorPerLayerTextureEstimateBytes: config.source * config.source * 4 * config.layers,
      jsHeapBeforeBytes: beforeHeap.usedSize, jsHeapAfterBytes: afterHeap.usedSize }))
    await page.close()
  }
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' })
  const tiled = await page.evaluate(async () => {
    const [{ RasterSourceRegistry }, { RasterTextureCache }] = await Promise.all([
      import('/src/raster/RasterSourceRegistry.ts'), import('/src/renderer/RasterTextureCache.ts'),
    ])
    const registry = new RasterSourceRegistry()
    const canvas = document.createElement('canvas'); canvas.width = 4096; canvas.height = 8
    const context = canvas.getContext('2d'); context.fillStyle = '#f00'; context.fillRect(0, 0, 2048, 8)
    context.fillStyle = '#00f'; context.fillRect(2048, 0, 2048, 8)
    const sourceId = registry.registerCanvas(canvas)
    const cache = new RasterTextureCache(registry)
    const first = cache.createDisplay(sourceId), second = cache.createDisplay(sourceId)
    const firstSprite = first.children[0], secondSprite = second.children[0]
    const shared = firstSprite.texture === secondSprite.texture
    const tileCount = first.children.length
    const untouchedTile = first.children[1]
    let untouchedUploads = 0
    const originalUpdate = untouchedTile.texture.source.update.bind(untouchedTile.texture.source)
    untouchedTile.texture.source.update = () => { untouchedUploads += 1; originalUpdate() }
    context.fillStyle = '#0f0'; context.fillRect(0, 0, 5, 5)
    registry.touch(sourceId, { x: 0, y: 0, width: 5, height: 5 }); cache.update(sourceId)
    const pixels = firstSprite.texture.source.resource.getContext('2d').getImageData(0, 0, 1, 1).data
    const result = { shared, tileCount, untouchedUploads, updatedPixel: Array.from(pixels), gpuEstimateBytes: cache.estimatedGpuBytes }
    first.destroy(); second.destroy(); cache.clear(); return result
  })
  if (!tiled.shared || tiled.tileCount !== 2 || tiled.untouchedUploads !== 0 || tiled.updatedPixel[1] !== 255 || tiled.gpuEstimateBytes !== 4096 * 8 * 4)
    throw new Error(`Tiled texture validation failed: ${JSON.stringify(tiled)}`)
  console.log(JSON.stringify({ tiledValidation: tiled }))
  await page.close()
  const recoveryPage = await browser.newPage()
  await recoveryPage.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' })
  const contextRecovery = await recoveryPage.evaluate(async () => {
    const [{ EditorDocument }, { rasterSources }, { PixiViewportRenderer }] = await Promise.all([
      import('/src/core/model/EditorDocument.ts'), import('/src/raster/RasterSourceRegistry.ts'), import('/src/renderer/PixiViewportRenderer.ts'),
    ])
    const host = document.createElement('div'); host.style.cssText = 'width:256px;height:256px'; document.body.appendChild(host)
    const errors = []; const renderer = new PixiViewportRenderer({ sourceRegistry: rasterSources, onError: (message) => errors.push(message) })
    await renderer.initialize(host)
    renderer.setDocument(EditorDocument.create({ name: 'Context recovery', width: 64, height: 64, resolution: 72, background: 'white' }))
    const gl = renderer.getCanvas().getContext('webgl2') ?? renderer.getCanvas().getContext('webgl')
    const extension = gl?.getExtension('WEBGL_lose_context')
    if (!extension) { renderer.destroy(); host.remove(); return { supported: false } }
    extension.loseContext()
    await new Promise((resolve) => setTimeout(resolve, 50))
    extension.restoreContext()
    await new Promise((resolve) => setTimeout(resolve, 100))
    renderer.requestRender()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const result = { supported: true, restored: !gl.isContextLost(), errors }
    renderer.destroy(); host.remove(); return result
  })
  if (contextRecovery.supported && (!contextRecovery.restored || contextRecovery.errors.length)) throw new Error(`GPU context recovery failed: ${JSON.stringify(contextRecovery)}`)
  console.log(JSON.stringify({ contextRecovery }))
  await recoveryPage.close()
} finally { await browser.close() }
