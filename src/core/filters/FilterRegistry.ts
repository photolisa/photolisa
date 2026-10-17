import { convolve } from './EffectPixels'
import { extendedFilters } from './ExtendedFilters'
import { applyLut, compositeEffect, defaultLut, EFFECT_BLEND_MODES, normalizeLut, normalizeSelection } from './EffectPipeline'
import type {
  AdjustmentKind,
  AdjustmentParametersByKind,
  FilterDefinition,
  LayerAdjustment,
  PixelBuffer,
} from './types'

abstract class PointFilter<K extends AdjustmentKind> implements FilterDefinition<K> {
  abstract readonly kind: K
  abstract readonly label: string
  abstract readonly defaults: Readonly<AdjustmentParametersByKind[K]>
  abstract normalize(parameters: Partial<AdjustmentParametersByKind[K]>): AdjustmentParametersByKind[K]
  protected abstract transform(red: number, green: number, blue: number, parameters: AdjustmentParametersByKind[K]): [number, number, number]

  apply(input: PixelBuffer, parameters: AdjustmentParametersByKind[K]): PixelBuffer {
    const output = new Uint8ClampedArray(input.data)
    for (let index = 0; index < output.length; index += 4) {
      const [red, green, blue] = this.transform(
        (output[index] ?? 0) / 255,
        (output[index + 1] ?? 0) / 255,
        (output[index + 2] ?? 0) / 255,
        parameters,
      )
      output[index] = byte(red * 255)
      output[index + 1] = byte(green * 255)
      output[index + 2] = byte(blue * 255)
    }
    return { data: output, width: input.width, height: input.height }
  }
}

export class BrightnessContrastFilter extends PointFilter<'brightness-contrast'> {
  readonly kind = 'brightness-contrast' as const
  readonly label = 'Brightness / Contrast'
  readonly defaults = { brightness: 0, contrast: 0 }
  normalize(parameters: Partial<typeof this.defaults>) {
    return { brightness: clamp(parameters.brightness ?? 0, -1, 1), contrast: clamp(parameters.contrast ?? 0, -1, 1) }
  }
  protected transform(red: number, green: number, blue: number, parameters: typeof this.defaults): [number, number, number] {
    const factor = 1 + parameters.contrast
    const channel = (value: number) => (value - 0.5) * factor + 0.5 + parameters.brightness
    return [channel(red), channel(green), channel(blue)]
  }
}

export class ExposureFilter extends PointFilter<'exposure'> {
  readonly kind = 'exposure' as const
  readonly label = 'Exposure'
  readonly defaults = { stops: 0 }
  normalize(parameters: Partial<typeof this.defaults>) { return { stops: clamp(parameters.stops ?? 0, -5, 5) } }
  protected transform(red: number, green: number, blue: number, parameters: typeof this.defaults): [number, number, number] {
    const factor = 2 ** parameters.stops
    return [red * factor, green * factor, blue * factor]
  }
}

export class SaturationFilter extends PointFilter<'saturation'> {
  readonly kind = 'saturation' as const
  readonly label = 'Saturation'
  readonly defaults = { amount: 0 }
  normalize(parameters: Partial<typeof this.defaults>) { return { amount: clamp(parameters.amount ?? 0, -1, 1) } }
  protected transform(red: number, green: number, blue: number, parameters: typeof this.defaults): [number, number, number] {
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    const factor = 1 + parameters.amount
    return [luminance + (red - luminance) * factor, luminance + (green - luminance) * factor, luminance + (blue - luminance) * factor]
  }
}

export class HueFilter extends PointFilter<'hue'> {
  readonly kind = 'hue' as const
  readonly label = 'Hue'
  readonly defaults = { degrees: 0 }
  normalize(parameters: Partial<typeof this.defaults>) { return { degrees: clamp(parameters.degrees ?? 0, -180, 180) } }
  protected transform(red: number, green: number, blue: number, parameters: typeof this.defaults): [number, number, number] {
    const angle = parameters.degrees * Math.PI / 180
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    return [
      red * (0.213 + cosine * 0.787 - sine * 0.213) + green * (0.715 - cosine * 0.715 - sine * 0.715) + blue * (0.072 - cosine * 0.072 + sine * 0.928),
      red * (0.213 - cosine * 0.213 + sine * 0.143) + green * (0.715 + cosine * 0.285 + sine * 0.140) + blue * (0.072 - cosine * 0.072 - sine * 0.283),
      red * (0.213 - cosine * 0.213 - sine * 0.787) + green * (0.715 - cosine * 0.715 + sine * 0.715) + blue * (0.072 + cosine * 0.928 + sine * 0.072),
    ]
  }
}

export class TemperatureFilter extends PointFilter<'temperature'> {
  readonly kind = 'temperature' as const
  readonly label = 'Temperature'
  readonly defaults = { amount: 0 }
  normalize(parameters: Partial<typeof this.defaults>) { return { amount: clamp(parameters.amount ?? 0, -1, 1) } }
  protected transform(red: number, green: number, blue: number, parameters: typeof this.defaults): [number, number, number] {
    return [red + parameters.amount * 0.12, green + parameters.amount * 0.02, blue - parameters.amount * 0.12]
  }
}

export class GrayscaleFilter extends PointFilter<'grayscale'> {
  readonly kind = 'grayscale' as const
  readonly label = 'Grayscale'
  readonly defaults = { amount: 1 }
  normalize(parameters: Partial<typeof this.defaults>) { return { amount: clamp(parameters.amount ?? 1, 0, 1) } }
  protected transform(red: number, green: number, blue: number, parameters: typeof this.defaults): [number, number, number] {
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    return [mix(red, luminance, parameters.amount), mix(green, luminance, parameters.amount), mix(blue, luminance, parameters.amount)]
  }
}

export class SepiaFilter extends PointFilter<'sepia'> {
  readonly kind = 'sepia' as const
  readonly label = 'Sepia'
  readonly defaults = { amount: 1 }
  normalize(parameters: Partial<typeof this.defaults>) { return { amount: clamp(parameters.amount ?? 1, 0, 1) } }
  protected transform(red: number, green: number, blue: number, parameters: typeof this.defaults): [number, number, number] {
    const amount = parameters.amount
    return [
      mix(red, 0.393 * red + 0.769 * green + 0.189 * blue, amount),
      mix(green, 0.349 * red + 0.686 * green + 0.168 * blue, amount),
      mix(blue, 0.272 * red + 0.534 * green + 0.131 * blue, amount),
    ]
  }
}

export class InvertFilter extends PointFilter<'invert'> {
  readonly kind = 'invert' as const
  readonly label = 'Invert'
  readonly defaults = { amount: 1 }
  normalize(parameters: Partial<typeof this.defaults>) { return { amount: clamp(parameters.amount ?? 1, 0, 1) } }
  protected transform(red: number, green: number, blue: number, parameters: typeof this.defaults): [number, number, number] {
    return [mix(red, 1 - red, parameters.amount), mix(green, 1 - green, parameters.amount), mix(blue, 1 - blue, parameters.amount)]
  }
}

export class LevelsFilter extends PointFilter<'levels'> {
  readonly kind = 'levels' as const
  readonly label = 'Levels'
  readonly defaults = { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 }
  normalize(parameters: Partial<typeof this.defaults>) {
    const inputBlack = Math.round(clamp(parameters.inputBlack ?? 0, 0, 254))
    const inputWhite = Math.round(clamp(parameters.inputWhite ?? 255, inputBlack + 1, 255))
    const outputBlack = Math.round(clamp(parameters.outputBlack ?? 0, 0, 255))
    const outputWhite = Math.round(clamp(parameters.outputWhite ?? 255, outputBlack, 255))
    return { inputBlack, inputWhite, gamma: clamp(parameters.gamma ?? 1, 0.1, 10), outputBlack, outputWhite }
  }
  protected transform(red: number, green: number, blue: number, parameters: typeof this.defaults): [number, number, number] {
    const inputBlack = parameters.inputBlack / 255
    const inputRange = (parameters.inputWhite - parameters.inputBlack) / 255
    const outputBlack = parameters.outputBlack / 255
    const outputRange = (parameters.outputWhite - parameters.outputBlack) / 255
    const channel = (value: number) => outputBlack + Math.pow(clamp((value - inputBlack) / inputRange, 0, 1), 1 / parameters.gamma) * outputRange
    return [channel(red), channel(green), channel(blue)]
  }
}

export class GaussianBlurFilter implements FilterDefinition<'gaussian-blur'> {
  readonly kind = 'gaussian-blur' as const
  readonly label = 'Gaussian Blur'
  readonly defaults = { radius: 5 }
  normalize(parameters: Partial<typeof this.defaults>) { return { radius: clamp(parameters.radius ?? 5, 0, 50) } }
  apply(input: PixelBuffer, parameters: typeof this.defaults): PixelBuffer {
    const radius = Math.ceil(parameters.radius)
    if (radius === 0) return cloneBuffer(input)
    const kernel = gaussianKernel(radius)
    return convolve(input, kernel)
  }
}

export class SharpenFilter implements FilterDefinition<'sharpen'> {
  readonly kind = 'sharpen' as const
  readonly label = 'Sharpen'
  readonly defaults = { amount: 0.5 }
  normalize(parameters: Partial<typeof this.defaults>) { return { amount: clamp(parameters.amount ?? 0.5, 0, 2) } }
  apply(input: PixelBuffer, parameters: typeof this.defaults): PixelBuffer {
    if (parameters.amount === 0) return cloneBuffer(input)
    const output = new Uint8ClampedArray(input.data.length)
    for (let y = 0; y < input.height; y += 1) for (let x = 0; x < input.width; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        const center = sample(input, x, y, channel)
        if (channel === 3) output[(y * input.width + x) * 4 + channel] = byte(center)
        else {
          const alpha = sample(input, x, y, 3) / 255
          const premultiplied = premultipliedSample(input, x, y, channel) * (1 + 4 * parameters.amount)
            - parameters.amount * (premultipliedSample(input, x - 1, y, channel) + premultipliedSample(input, x + 1, y, channel)
              + premultipliedSample(input, x, y - 1, channel) + premultipliedSample(input, x, y + 1, channel))
          output[(y * input.width + x) * 4 + channel] = alpha > 0 ? byte(clamp(premultiplied, 0, 255 * alpha) / alpha) : 0
        }
      }
    }
    return { data: output, width: input.width, height: input.height }
  }
}

export class FilterRegistry {
  private readonly definitions = new Map<AdjustmentKind, FilterDefinition>()

  constructor(definitions: readonly FilterDefinition[] = DEFAULT_FILTERS) {
    definitions.forEach((definition) => this.register(definition))
  }

  register(definition: FilterDefinition): void {
    if (this.definitions.has(definition.kind)) throw new Error(`Filter ${definition.kind} is already registered`)
    this.definitions.set(definition.kind, definition)
  }

  list(): readonly FilterDefinition[] { return [...this.definitions.values()] }

  get<K extends AdjustmentKind>(kind: K): FilterDefinition<K> {
    const definition = this.definitions.get(kind)
    if (!definition) throw new Error(`Unknown filter kind: ${kind}`)
    return definition as FilterDefinition<K>
  }

  create<K extends AdjustmentKind>(kind: K, parameters: Partial<AdjustmentParametersByKind[K]> = {}): LayerAdjustment<K> {
    return { id: entityId(), kind, enabled: true, parameters: this.get(kind).normalize(parameters), ...(kind === 'color-lookup' ? { lut: defaultLut() } : {}) } as LayerAdjustment<K>
  }

  normalize(adjustment: LayerAdjustment): LayerAdjustment {
    const definition = this.get(adjustment.kind)
    return {
      id: adjustment.id || entityId(),
      kind: adjustment.kind,
      enabled: adjustment.enabled !== false,
      parameters: definition.normalize(adjustment.parameters),
      ...(adjustment.opacity !== undefined ? { opacity: clamp(adjustment.opacity, 0, 1) } : {}),
      ...(adjustment.blendMode !== undefined ? { blendMode: EFFECT_BLEND_MODES.includes(adjustment.blendMode) ? adjustment.blendMode : 'normal' } : {}),
      ...(adjustment.selection ? { selection: normalizeSelection(adjustment.selection) } : {}),
      ...(adjustment.kind === 'color-lookup' ? { lut: normalizeLut(adjustment.lut ?? defaultLut()) } : {}),
    } as LayerAdjustment
  }

  apply(input: PixelBuffer, adjustments: readonly LayerAdjustment[], accelerated?: (pixels: PixelBuffer, effect: LayerAdjustment) => PixelBuffer | null): PixelBuffer {
    if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width < 1 || input.height < 1 || input.width * input.height > 67_108_864 || input.data.length !== input.width * input.height * 4) throw new Error('Invalid or oversized effect pixel buffer')
    let pixels = input
    for (const adjustment of adjustments) {
      if (!adjustment.enabled || adjustment.opacity === 0) continue
      const processed = adjustment.kind === 'color-lookup'
        ? applyLut(pixels, adjustment.lut ?? defaultLut(), adjustment.parameters.amount ?? 1)
        : accelerated?.(pixels, adjustment) ?? this.get(adjustment.kind).apply(pixels, adjustment.parameters as never)
      pixels = compositeEffect(pixels, processed, adjustment)
    }
    return pixels === input ? cloneBuffer(input) : pixels
  }
}

const DEFAULT_FILTERS: readonly FilterDefinition[] = [
  new BrightnessContrastFilter(), new ExposureFilter(), new SaturationFilter(), new HueFilter(),
  new TemperatureFilter(), new GrayscaleFilter(), new SepiaFilter(), new InvertFilter(), new GaussianBlurFilter(),
  new SharpenFilter(), new LevelsFilter(),
  ...extendedFilters((input, radius) => new GaussianBlurFilter().apply(input, { radius })),
]

export const filterRegistry = new FilterRegistry()

export function cloneAdjustment(adjustment: LayerAdjustment): LayerAdjustment {
  return { ...adjustment, parameters: { ...adjustment.parameters },
    ...(adjustment.selection ? { selection: { ...adjustment.selection, runs: [...adjustment.selection.runs] } } : {}),
    ...(adjustment.lut ? { lut: { ...adjustment.lut, data: [...adjustment.lut.data] } } : {}),
  } as LayerAdjustment
}

function gaussianKernel(radius: number): Float32Array {
  const sigma = Math.max(0.5, radius / 3)
  const kernel = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let index = -radius; index <= radius; index += 1) {
    const value = Math.exp(-(index * index) / (2 * sigma * sigma))
    kernel[index + radius] = value
    sum += value
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] = (kernel[index] ?? 0) / sum
  return kernel
}

function sample(input: PixelBuffer, x: number, y: number, channel: number): number {
  const safeX = Math.max(0, Math.min(input.width - 1, x))
  const safeY = Math.max(0, Math.min(input.height - 1, y))
  return input.data[(safeY * input.width + safeX) * 4 + channel] ?? 0
}

function premultipliedSample(input: PixelBuffer, x: number, y: number, channel: number): number {
  return sample(input, x, y, channel) * sample(input, x, y, 3) / 255
}

function cloneBuffer(input: PixelBuffer): PixelBuffer { return { data: new Uint8ClampedArray(input.data), width: input.width, height: input.height } }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum)) }
function mix(from: number, to: number, amount: number): number { return from + (to - from) * amount }
function byte(value: number): number { return Math.round(clamp(value, 0, 255)) }
function entityId(): string { return globalThis.crypto?.randomUUID?.() ?? `adjustment-${Date.now()}-${Math.random()}` }
