export type AdjustmentKind =
  | 'brightness-contrast'
  | 'exposure'
  | 'saturation'
  | 'hue'
  | 'temperature'
  | 'grayscale'
  | 'sepia'
  | 'invert'
  | 'gaussian-blur'
  | 'sharpen'
  | 'levels'

export interface BrightnessContrastParameters { brightness: number; contrast: number }
export interface ExposureParameters { stops: number }
export interface SaturationParameters { amount: number }
export interface HueParameters { degrees: number }
export interface TemperatureParameters { amount: number }
export interface GrayscaleParameters { amount: number }
export interface SepiaParameters { amount: number }
export interface InvertParameters { amount: number }
export interface GaussianBlurParameters { radius: number }
export interface SharpenParameters { amount: number }
export interface LevelsParameters {
  inputBlack: number
  inputWhite: number
  gamma: number
  outputBlack: number
  outputWhite: number
}

export interface AdjustmentParametersByKind {
  'brightness-contrast': BrightnessContrastParameters
  exposure: ExposureParameters
  saturation: SaturationParameters
  hue: HueParameters
  temperature: TemperatureParameters
  grayscale: GrayscaleParameters
  sepia: SepiaParameters
  invert: InvertParameters
  'gaussian-blur': GaussianBlurParameters
  sharpen: SharpenParameters
  levels: LevelsParameters
}

export type LayerAdjustment<K extends AdjustmentKind = AdjustmentKind> = K extends AdjustmentKind ? {
  id: string
  kind: K
  enabled: boolean
  parameters: AdjustmentParametersByKind[K]
} : never

export interface PixelBuffer { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }

export interface FilterDefinition<K extends AdjustmentKind = AdjustmentKind> {
  readonly kind: K
  readonly label: string
  readonly defaults: Readonly<AdjustmentParametersByKind[K]>
  normalize(parameters: Partial<AdjustmentParametersByKind[K]>): AdjustmentParametersByKind[K]
  apply(input: PixelBuffer, parameters: AdjustmentParametersByKind[K]): PixelBuffer
}
