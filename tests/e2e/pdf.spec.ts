import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, rgb, degrees, PDFName, PDFRawStream } from 'pdf-lib'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true,
    })
  })
})

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus)
    console.log(await page.locator('body').innerText())
})

async function fixture() {
  const pdf = await PDFDocument.create()
  const first = pdf.addPage([120, 80])
  first.drawRectangle({
    x: 10,
    y: 10,
    width: 50,
    height: 30,
    color: rgb(1, 0, 0),
  })
  const second = pdf.addPage([200, 100])
  second.setCropBox(20, 10, 160, 80)
  second.setRotation(degrees(90))
  second.drawRectangle({
    x: 20,
    y: 10,
    width: 160,
    height: 80,
    color: rgb(0, 0, 1),
  })
  return Buffer.from(await pdf.save())
}
async function open(page: Page, buffer: Buffer, name = 'sample.pdf') {
  await page
    .locator('input[type=file]')
    .setInputFiles({ name, mimeType: 'application/pdf', buffer })
  const dialog = page.getByRole('dialog', { name: 'Import PDF' })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: 'Import pages' }),
  ).toBeEnabled()
  return dialog
}
async function downloadPdf(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Export As PDF…' }).click()
  return page.getByRole('dialog', { name: 'Export PDF', exact: true })
}

test('imports selected rotated crop-box page and round-trips a lossless PDF at 72/150/300 DPI', async ({
  page,
}) => {
  await page.goto('/')
  const dialog = await open(page, await fixture())
  await expect(dialog.getByText('Page 2 · 80.0 × 160.0 pt')).toBeVisible()
  await expect(dialog.locator('img')).toHaveCount(2)
  await dialog.getByLabel('PDF pages', { exact: true }).fill('2')
  await dialog.getByLabel('PDF import DPI').fill('72')
  await dialog.getByRole('button', { name: 'Import pages' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByText('80 × 160', { exact: false }).last(),
  ).toBeVisible()
  for (const dpi of [72, 150, 300]) {
    const exportDialog = await downloadPdf(page)
    await exportDialog.getByLabel('PDF export DPI').fill(String(dpi))
    await exportDialog.getByRole('button', { name: 'Preview pages' }).click()
    await expect(
      exportDialog.getByAltText('PDF export page 1 preview'),
    ).toBeVisible()
    const download = page.waitForEvent('download')
    await exportDialog
      .getByRole('button', { name: 'Export PDF', exact: true })
      .click()
    const bytes = await readFile((await (await download).path())!)
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getSize()).toEqual({ width: 80, height: 160 })
    const xobjects = pdf
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of('XObject'))
    expect(xobjects.toString()).toContain('/Image')
    const imageWidths = pdf.context
      .enumerateIndirectObjects()
      .map(([, object]) => object)
      .filter(
        (object): object is PDFRawStream =>
          object instanceof PDFRawStream &&
          object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image',
      )
      .map((image) => Number(image.dict.get(PDFName.of('Width'))?.toString()))
    expect(imageWidths).toContain(Math.ceil((80 * dpi) / 72))
    if (dpi === 72) {
      const reimport = await open(page, bytes, 'roundtrip.pdf')
      await reimport.getByLabel('PDF import DPI').fill('72')
      await reimport.getByRole('button', { name: 'Import pages' }).click()
      await expect(reimport).toHaveCount(0)
      // Sample exported compositor pixels, avoiding GPU antialias differences.
      await page.getByRole('button', { name: 'File', exact: true }).click()
      const pngDownload = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Export PNG…' }).click()
      const png = await readFile((await (await pngDownload).path())!)
      const pixel = await page.evaluate(
        async (bytes) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
          )
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const context = canvas.getContext('2d')!
          context.drawImage(bitmap, 0, 0)
          bitmap.close()
          return [...context.getImageData(40, 80, 1, 1).data]
        },
        [...png],
      )
      expect(pixel).toEqual([0, 0, 255, 255])
    }
  }
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('imports all pages as independent tabs and exports selected projects in tab order', async ({
  page,
}) => {
  await page.goto('/')
  const dialog = await open(page, await fixture())
  await dialog.getByRole('button', { name: 'Select all pages' }).click()
  await dialog.getByLabel('PDF import DPI').fill('72')
  await dialog.getByRole('button', { name: 'Import pages' }).click()
  await expect(dialog).toHaveCount(0)
  const exportDialog = await downloadPdf(page)
  await exportDialog.getByLabel('sample — Page 1', { exact: false }).check()
  await exportDialog.getByRole('button', { name: 'Preview pages' }).click()
  await expect(exportDialog.locator('img')).toHaveCount(2)
  await page.screenshot({
    path: test.info().outputPath('pdf-export-preview.png'),
  })
  const download = page.waitForEvent('download')
  await exportDialog
    .getByRole('button', { name: 'Export PDF', exact: true })
    .click()
  const pdf = await PDFDocument.load(
    await readFile((await (await download).path())!),
  )
  expect(pdf.getPages().map((page) => page.getSize())).toEqual([
    { width: 120, height: 80 },
    { width: 80, height: 160 },
  ])
})

test('imports one raster layer with undo, rejects corrupt files, and cancels without opening tabs', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'New document…' }).click()
  await page.getByLabel('Width (px)').fill('160')
  await page.getByLabel('Height (px)').fill('120')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  let dialog = await open(page, await fixture())
  await dialog.getByLabel('PDF import DPI').fill('72')
  await dialog.getByLabel('PDF import target').selectOption('layers')
  await dialog.getByRole('button', { name: 'Import pages' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('sample — Page 1', { exact: true })).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(page.getByText('sample — Page 1', { exact: true })).toHaveCount(
    0,
  )
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByText('sample — Page 1', { exact: true })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({
    name: 'corrupt.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\ncorrupt'),
  })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/PDF|pdf/)
  await page.getByRole('button', { name: 'Dismiss error' }).click()
  dialog = await open(page, await fixture())
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('handles encrypted PDFs, retries an incorrect password, and cancels the password prompt', async ({
  page,
}) => {
  await page.goto('/')
  const bytes = await readFile('tests/fixtures/password.pdf')
  await page.locator('input[type=file]').setInputFiles({
    name: 'protected.pdf',
    mimeType: 'application/pdf',
    buffer: bytes,
  })
  let dialog = page.getByRole('dialog', { name: 'Import PDF' })
  await expect(dialog.getByLabel('PDF password')).toBeVisible()
  await dialog.getByLabel('PDF password').fill('wrong')
  await dialog.getByRole('button', { name: 'Unlock PDF' }).click()
  await expect(dialog.getByText('Incorrect password. Try again.')).toBeVisible()
  await dialog.getByLabel('PDF password').fill('photolisa-test')
  await dialog.getByRole('button', { name: 'Unlock PDF' }).click()
  await expect(
    dialog.getByRole('button', { name: 'Import pages' }),
  ).toBeEnabled()
  await dialog.getByLabel('PDF import DPI').fill('72')
  await dialog.getByRole('button', { name: 'Import pages' }).click()
  await expect(dialog).toHaveCount(0)
  await page.locator('input[type=file]').setInputFiles({
    name: 'protected.pdf',
    mimeType: 'application/pdf',
    buffer: bytes,
  })
  dialog = page.getByRole('dialog', { name: 'Import PDF' })
  await expect(dialog.getByLabel('PDF password')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

async function exportPngBytes(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG…' }).click()
  return readFile((await (await download).path())!)
}

async function exportPngPixels(page: Page, points: Array<[number, number]>) {
  const bytes = await exportPngBytes(page)
  return page.evaluate(
    async ({ bytes, points }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      )
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
    },
    { bytes: [...bytes], points },
  )
}

test('exports supported transformed shapes as real PDF drawing operations with matching pixels', async ({
  page,
}) => {
  await page.goto('/')
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect x="10" y="10" width="30" height="30" fill="#ff0000" transform="translate(5 0)"/><ellipse cx="80" cy="60" rx="20" ry="15" fill="#00ff00"/><circle cx="80" cy="20" r="10" fill="#0000ff"/><line x1="5" y1="85" x2="110" y2="85" stroke="#ff0000" stroke-width="2"/></svg>'
  await page.locator('input[type=file]').setInputFiles({
    name: 'shapes.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg),
  })
  await expect(page.getByText('120 × 100 px').first()).toBeVisible()
  const points: Array<[number, number]> = [
    [20, 20],
    [80, 60],
    [80, 20],
    [60, 85],
    [110, 10],
  ]
  const original = await exportPngPixels(page, points)
  const dialog = await downloadPdf(page)
  await dialog.getByLabel('PDF export mode').selectOption('vector')
  await dialog
    .getByLabel('PDF background', { exact: true })
    .selectOption('transparent')
  await dialog.getByLabel('PDF export DPI').fill('72')
  await expect(dialog.getByText(/page will be flattened/)).toHaveCount(0)
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const bytes = await readFile((await (await download).path())!)
  const pdf = await PDFDocument.load(bytes)
  expect(
    pdf.getPage(0).node.Resources()!.get(PDFName.of('XObject'))?.toString() ??
      '',
  ).not.toContain('Image')
  const imported = await open(page, bytes, 'vectors.pdf')
  await imported.getByLabel('PDF import DPI').fill('72')
  await imported.getByRole('button', { name: 'Import pages' }).click()
  await expect(imported).toHaveCount(0)
  expect(await exportPngPixels(page, points)).toEqual(original)
})

test('warns before vector fallback, exports only visible layers, and preserves PNG transparency', async ({
  page,
}) => {
  await page.goto('/')
  const imported = await open(page, await fixture())
  await imported.getByLabel('PDF import DPI').fill('72')
  await imported.getByRole('button', { name: 'Import pages' }).click()
  await expect(imported).toHaveCount(0)
  const dialog = await downloadPdf(page)
  await dialog.getByLabel('PDF export mode').selectOption('vector')
  await expect(
    dialog.getByText(
      /page will be flattened because it contains raster layers/,
    ),
  ).toBeVisible()
  await dialog
    .getByLabel('PDF background', { exact: true })
    .selectOption('transparent')
  await dialog.getByLabel('PDF export DPI').fill('72')
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const bytes = await readFile((await (await download).path())!)
  const roundtrip = await open(page, bytes, 'transparent.pdf')
  await roundtrip.getByLabel('PDF import DPI').fill('72')
  await roundtrip.getByRole('button', { name: 'Import pages' }).click()
  await expect(roundtrip).toHaveCount(0)
  expect(
    await exportPngPixels(page, [
      [0, 0],
      [30, 60],
    ]),
  ).toEqual([
    [0, 0, 0, 0],
    [255, 0, 0, 255],
  ])
})

test('accepts PDF drag-and-drop and cancels oversized imports without new tabs', async ({
  page,
}) => {
  await page.goto('/')
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([new Uint8Array(bytes)], 'dropped.pdf', {
          type: 'application/pdf',
        }),
      )
      return transfer
    },
    [...(await fixture())],
  )
  await page.locator('main').dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()
  const dialog = page.getByRole('dialog', { name: 'Import PDF' })
  await expect(
    dialog.getByRole('button', { name: 'Import pages' }),
  ).toBeEnabled()
  await dialog.getByLabel('PDF import DPI').fill('1201')
  await dialog.getByRole('button', { name: 'Import pages' }).click()
  await expect(page.getByRole('alert')).toContainText('between 1 and 1200')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /dropped/ })).toHaveCount(0)
})

test('supports custom/A4/JPEG output, margins, orientation, and hidden-layer exclusion', async ({
  page,
}) => {
  await page.goto('/')
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect id="red" x="0" y="0" width="120" height="100" fill="#ff0000"/><rect id="blue" x="0" y="0" width="120" height="100" fill="#0000ff"/></svg>'
  await page.locator('input[type=file]').setInputFiles({
    name: 'visibility.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg),
  })
  await page.getByRole('button', { name: 'Hide blue', exact: true }).click()
  const dialog = await downloadPdf(page)
  await dialog.getByLabel('PDF page size').selectOption('custom')
  await dialog.getByLabel('PDF width', { exact: true }).fill('50')
  await dialog.getByLabel('PDF height', { exact: true }).fill('40')
  await dialog.getByLabel('PDF orientation').selectOption('landscape')
  await dialog.getByLabel('PDF margins').fill('5')
  await dialog.getByLabel('PDF export DPI').fill('72')
  await dialog.getByLabel('PDF image encoding').selectOption('jpeg')
  await dialog.getByLabel('PDF JPEG quality').fill('0.9')
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const bytes = await readFile((await (await download).path())!)
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getPage(0).getWidth()).toBeCloseTo((50 * 72) / 25.4)
  expect(pdf.getPage(0).getHeight()).toBeCloseTo((40 * 72) / 25.4)
  expect(bytes.toString('latin1')).toContain('/DCTDecode')
  const roundtrip = await open(page, bytes, 'jpeg.pdf')
  await roundtrip.getByLabel('PDF import DPI').fill('72')
  await roundtrip.getByRole('button', { name: 'Import pages' }).click()
  await expect(roundtrip).toHaveCount(0)
  const pixels = await exportPngPixels(page, [
    [0, 0],
    [70, 55],
  ])
  expect(pixels[0]).toEqual([255, 255, 255, 255])
  expect(pixels[1]![0]).toBeGreaterThan(240)
  expect(pixels[1]![2]).toBeLessThan(15)
  const a4 = await downloadPdf(page)
  await a4.getByLabel('PDF page size').selectOption('a4')
  await a4.getByLabel('PDF orientation').selectOption('landscape')
  await a4.getByLabel('PDF export DPI').fill('72')
  const a4Download = page.waitForEvent('download')
  await a4.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const a4Pdf = await PDFDocument.load(
    await readFile((await (await a4Download).path())!),
  )
  expect(a4Pdf.getPage(0).getWidth()).toBeCloseTo((297 * 72) / 25.4)
  expect(a4Pdf.getPage(0).getHeight()).toBeCloseTo((210 * 72) / 25.4)
})

test('releases PDF raster assets after session eviction while retaining recently closed tabs', async ({
  page,
}) => {
  await page.goto('/')
  const dialog = await open(page, await fixture())
  await dialog.getByLabel('PDF import DPI').fill('72')
  await dialog.getByRole('button', { name: 'Import pages' }).click()
  await expect(dialog).toHaveCount(0)
  const result = await page.evaluate(async () => {
    const editorPath = '/src/composables/useEditor.ts',
      registryPath = '/src/raster/RasterSourceRegistry.ts'
    const { documentManager } = (await import(
      editorPath
    )) as typeof import('../../src/composables/useEditor')
    const { rasterSources } = (await import(
      registryPath
    )) as typeof import('../../src/raster/RasterSourceRegistry')
    const active = documentManager.active!,
      layer = active.editor.document!.layers[0]!
    if (layer.kind !== 'raster' || !layer.pixelSourceId)
      throw new Error('Missing PDF raster')
    const id = layer.pixelSourceId
    documentManager.close(active.id)
    const retained = Boolean(rasterSources.get(id))
    documentManager.destroy()
    return { retained, disposed: !rasterSources.get(id) }
  })
  expect(result).toEqual({ retained: true, disposed: true })
})

test('does not execute PDF actions or fetch their external URLs and enforces the page limit', async ({
  page,
}) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://pdf-action.invalid'))
      external.push(request.url())
  })
  await page.goto('/')
  const pdf = await PDFDocument.create()
  pdf.addPage([100, 100])
  pdf.addJavaScript(
    'untrusted',
    'this.getURL("https://pdf-action.invalid/script");',
  )
  const dialog = await open(page, Buffer.from(await pdf.save()))
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(external).toEqual([])
  const oversized = await PDFDocument.create()
  for (let index = 0; index < 101; index++) oversized.addPage([10, 10])
  await page.locator('input[type=file]').setInputFiles({
    name: 'too-many.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await oversized.save()),
  })
  await expect(page.getByRole('alert')).toContainText('limited to 100 pages')
  await expect(page.getByRole('dialog', { name: 'Import PDF' })).toHaveCount(0)
})

test('cancelling the native PDF save picker leaves the dialog and document intact', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: async () => {
        throw new DOMException('Cancelled', 'AbortError')
      },
      configurable: true,
    })
  })
  await page.goto('/')
  const imported = await open(page, await fixture())
  await imported.getByLabel('PDF import DPI').fill('72')
  await imported.getByRole('button', { name: 'Import pages' }).click()
  await expect(imported).toHaveCount(0)
  const dialog = await downloadPdf(page)
  const downloads: string[] = []
  page.on('download', (download) =>
    downloads.push(download.suggestedFilename()),
  )
  await dialog.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: 'Export PDF', exact: true }),
  ).toBeEnabled()
  await expect(dialog).toBeVisible()
  expect(downloads).toEqual([])
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    page.getByText('120 × 80', { exact: false }).last(),
  ).toBeVisible()
})

test('flattened PDF matches the entire composited image for transformed groups, opacity and blending', async ({
  page,
}) => {
  await page.goto('/')
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><g opacity="0.6" transform="translate(5 5)"><rect x="10" y="10" width="60" height="50" fill="#ff0000"/><circle cx="60" cy="50" r="25" fill="#0000ff"/></g><rect x="45" y="15" width="30" height="60" fill="#00ff00"/></svg>'
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'composition.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(svg),
    })
  await expect(page.getByText('120 × 100 px').first()).toBeVisible()
  await page.evaluate(async () => {
    const path = '/src/composables/useEditor.ts'
    const { documentManager } = (await import(
      path
    )) as typeof import('../../src/composables/useEditor')
    const editor = documentManager.active!.editor
    editor.document!.layers.at(-1)!.blendMode = 'multiply'
    editor.markDocumentChanged()
  })
  const source = await exportPngBytes(page)
  const dialog = await downloadPdf(page)
  await dialog.getByLabel('PDF export DPI').fill('72')
  await dialog
    .getByLabel('PDF background', { exact: true })
    .selectOption('custom')
  await dialog.getByLabel('PDF background color').fill('#808080')
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const imported = await open(
    page,
    await readFile((await (await download).path())!),
    'appearance.pdf',
  )
  await imported.getByLabel('PDF import DPI').fill('72')
  await imported.getByRole('button', { name: 'Import pages' }).click()
  await expect(imported).toHaveCount(0)
  const rendered = await exportPngBytes(page)
  const averageError = await page.evaluate(
    async ({ source, rendered }) => {
      async function pixels(bytes: number[], addBackground: boolean) {
        const image = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
        )
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        image.close()
        if (addBackground) {
          context.globalCompositeOperation = 'destination-over'
          context.fillStyle = '#808080'
          context.fillRect(0, 0, canvas.width, canvas.height)
        }
        return context.getImageData(0, 0, canvas.width, canvas.height).data
      }
      const expected = await pixels(source, true),
        actual = await pixels(rendered, false)
      if (expected.length !== actual.length)
        throw new Error('PDF changed image dimensions')
      let error = 0
      for (let index = 0; index < expected.length; index++)
        error += Math.abs(expected[index]! - actual[index]!)
      return error / expected.length
    },
    { source: [...source], rendered: [...rendered] },
  )
  expect(averageError).toBeLessThan(1)
})
