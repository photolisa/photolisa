import { imageTracer } from 'imagetracer'

interface TraceRequest { width: number; height: number; pixels: ArrayBuffer }

self.onmessage = (event: MessageEvent<TraceRequest>) => {
  try {
    const { width, height, pixels } = event.data
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 65_536 || pixels.byteLength !== width * height * 4)
      throw new Error('Invalid tracing image dimensions.')
    const data = new ImageData(new Uint8ClampedArray(pixels), width, height)
    const svg = imageTracer.imageDataToSVG(data, {
      numberofcolors: 8, pathomit: 4, strokewidth: 0,
      ltres: 1, qtres: 1, blurradius: 1, blurdelta: 20,
      viewbox: true, desc: false, scale: 1,
    })
    self.postMessage({ svg })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Image tracing failed.' })
  }
}
