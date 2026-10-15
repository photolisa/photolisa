import { BlurFilter, ColorMatrixFilter, Filter, GlProgram, UniformGroup, type ColorMatrix } from 'pixi.js'
import type { LayerAdjustment } from '../../core/filters/types'

const VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform highp vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`

export function createPixiFilter(adjustment: LayerAdjustment): Filter {
  switch (adjustment.kind) {
    case 'gaussian-blur':
      return new BlurFilter({ strength: adjustment.parameters.radius, quality: adjustment.parameters.radius > 12 ? 2 : 1 })
    case 'sharpen':
      return new SharpenPixiFilter(adjustment.parameters.amount)
    case 'levels':
      return new LevelsPixiFilter(adjustment.parameters)
    default: {
      const filter = new ColorMatrixFilter()
      filter.matrix = matrixFor(adjustment)
      return filter
    }
  }
}

class LevelsPixiFilter extends Filter {
  constructor(parameters: Extract<LayerAdjustment, { kind: 'levels' }>['parameters']) {
    const uniforms = new UniformGroup({
      uInputBlack: { value: parameters.inputBlack / 255, type: 'f32' },
      uInputWhite: { value: parameters.inputWhite / 255, type: 'f32' },
      uGamma: { value: parameters.gamma, type: 'f32' },
      uOutputBlack: { value: parameters.outputBlack / 255, type: 'f32' },
      uOutputWhite: { value: parameters.outputWhite / 255, type: 'f32' },
    })
    super({
      glProgram: GlProgram.from({ name: 'photolisa-levels', vertex: VERTEX, fragment: LEVELS_FRAGMENT }),
      resources: { adjustmentUniforms: uniforms },
    })
  }
}

class SharpenPixiFilter extends Filter {
  constructor(amount: number) {
    super({
      glProgram: GlProgram.from({ name: 'photolisa-sharpen', vertex: VERTEX, fragment: SHARPEN_FRAGMENT }),
      resources: { adjustmentUniforms: new UniformGroup({ uAmount: { value: amount, type: 'f32' } }) },
      padding: 1,
    })
  }
}

function matrixFor(adjustment: Exclude<LayerAdjustment, { kind: 'gaussian-blur' | 'sharpen' | 'levels' }>): ColorMatrix {
  const identity = (): ColorMatrix => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]
  switch (adjustment.kind) {
    case 'brightness-contrast': {
      const factor = 1 + adjustment.parameters.contrast
      const offset = (0.5 - 0.5 * factor + adjustment.parameters.brightness) * 255
      return [factor, 0, 0, 0, offset, 0, factor, 0, 0, offset, 0, 0, factor, 0, offset, 0, 0, 0, 1, 0]
    }
    case 'exposure': {
      const factor = 2 ** adjustment.parameters.stops
      return [factor, 0, 0, 0, 0, 0, factor, 0, 0, 0, 0, 0, factor, 0, 0, 0, 0, 0, 1, 0]
    }
    case 'saturation': {
      const factor = 1 + adjustment.parameters.amount
      const inverse = 1 - factor
      const red = 0.2126 * inverse; const green = 0.7152 * inverse; const blue = 0.0722 * inverse
      return [red + factor, green, blue, 0, 0, red, green + factor, blue, 0, 0, red, green, blue + factor, 0, 0, 0, 0, 0, 1, 0]
    }
    case 'hue': {
      const angle = adjustment.parameters.degrees * Math.PI / 180
      const cosine = Math.cos(angle); const sine = Math.sin(angle)
      return [
        0.213 + cosine * 0.787 - sine * 0.213, 0.715 - cosine * 0.715 - sine * 0.715, 0.072 - cosine * 0.072 + sine * 0.928, 0, 0,
        0.213 - cosine * 0.213 + sine * 0.143, 0.715 + cosine * 0.285 + sine * 0.140, 0.072 - cosine * 0.072 - sine * 0.283, 0, 0,
        0.213 - cosine * 0.213 - sine * 0.787, 0.715 - cosine * 0.715 + sine * 0.715, 0.072 + cosine * 0.928 + sine * 0.072, 0, 0,
        0, 0, 0, 1, 0,
      ]
    }
    case 'temperature': {
      const amount = adjustment.parameters.amount
      return [1, 0, 0, 0, amount * 0.12 * 255, 0, 1, 0, 0, amount * 0.02 * 255, 0, 0, 1, 0, -amount * 0.12 * 255, 0, 0, 0, 1, 0]
    }
    case 'grayscale': {
      const amount = adjustment.parameters.amount; const keep = 1 - amount
      return [keep + 0.2126 * amount, 0.7152 * amount, 0.0722 * amount, 0, 0, 0.2126 * amount, keep + 0.7152 * amount, 0.0722 * amount, 0, 0, 0.2126 * amount, 0.7152 * amount, keep + 0.0722 * amount, 0, 0, 0, 0, 0, 1, 0]
    }
    case 'sepia': {
      const amount = adjustment.parameters.amount; const keep = 1 - amount
      return [
        keep + 0.393 * amount, 0.769 * amount, 0.189 * amount, 0, 0,
        0.349 * amount, keep + 0.686 * amount, 0.168 * amount, 0, 0,
        0.272 * amount, 0.534 * amount, keep + 0.131 * amount, 0, 0,
        0, 0, 0, 1, 0,
      ]
    }
    case 'invert': {
      const amount = adjustment.parameters.amount; const factor = 1 - 2 * amount; const offset = amount * 255
      return [factor, 0, 0, 0, offset, 0, factor, 0, 0, offset, 0, 0, factor, 0, offset, 0, 0, 0, 1, 0]
    }
    default: return identity()
  }
}

const LEVELS_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uInputBlack;
uniform float uInputWhite;
uniform float uGamma;
uniform float uOutputBlack;
uniform float uOutputWhite;
void main(void) {
  vec4 color = texture(uTexture, vTextureCoord);
  if (color.a > 0.0) color.rgb /= color.a;
  vec3 normalized = clamp((color.rgb - vec3(uInputBlack)) / max(uInputWhite - uInputBlack, 0.0001), 0.0, 1.0);
  vec3 result = vec3(uOutputBlack) + pow(normalized, vec3(1.0 / uGamma)) * (uOutputWhite - uOutputBlack);
  finalColor = vec4(result * color.a, color.a);
}`

const SHARPEN_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uAmount;
void main(void) {
  vec2 pixel = uInputSize.zw;
  vec4 center = texture(uTexture, vTextureCoord);
  vec3 rgb = center.rgb * (1.0 + 4.0 * uAmount);
  rgb -= texture(uTexture, clamp(vTextureCoord + vec2(pixel.x, 0.0), uInputClamp.xy, uInputClamp.zw)).rgb * uAmount;
  rgb -= texture(uTexture, clamp(vTextureCoord - vec2(pixel.x, 0.0), uInputClamp.xy, uInputClamp.zw)).rgb * uAmount;
  rgb -= texture(uTexture, clamp(vTextureCoord + vec2(0.0, pixel.y), uInputClamp.xy, uInputClamp.zw)).rgb * uAmount;
  rgb -= texture(uTexture, clamp(vTextureCoord - vec2(0.0, pixel.y), uInputClamp.xy, uInputClamp.zw)).rgb * uAmount;
  finalColor = vec4(clamp(rgb, 0.0, center.a), center.a);
}`
