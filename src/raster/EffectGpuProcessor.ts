import { blurEffect } from '../core/filters/BlurEffects'
import { GaussianBlurFilter } from '../core/filters/FilterRegistry'
import type { ExtendedEffectKind } from '../core/filters/EffectCatalog'
import { EffectGpuBlur } from './EffectGpuBlur'
import type { LayerAdjustment, PixelBuffer } from '../core/filters/types'
/** Optional worker-owned WebGL2 path for large point adjustments. Spatial filters use CPU. */
export class EffectGpuProcessor {
  private readonly blur = new EffectGpuBlur()
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private texture: WebGLTexture | null = null
  private unavailable = false
  process(input: PixelBuffer, effect: LayerAdjustment): PixelBuffer | null {
    if (input.width * input.height >= 262144 && ['glow', 'soft-focus', 'clarity', 'unsharp-mask', 'tilt-shift'].includes(effect.kind)) return blurEffect(effect.kind as ExtendedEffectKind, input, effect.parameters as unknown as Record<string, number>, (p, radius) => this.blur.process(p, radius) ?? new GaussianBlurFilter().apply(p, { radius }))
    if (effect.kind === 'gaussian-blur') return this.blur.process(input, effect.parameters.radius)
    if (input.width * input.height < 262_144 || this.unavailable) return null
    const kinds = ['brightness-contrast', 'exposure', 'saturation', 'temperature', 'grayscale', 'sepia', 'invert', 'levels']
    const kind = kinds.indexOf(effect.kind)
    if (kind < 0) return null
    try {
      this.initialize()
      const gl = this.gl, program = this.program
      if (!gl || !program) return null
      if (gl.isContextLost()) { this.unavailable = true; return null }
      const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
      if (input.width > maxSize || input.height > maxSize) return null
      const canvas = gl.canvas as OffscreenCanvas
      canvas.width = input.width; canvas.height = input.height
      gl.viewport(0, 0, input.width, input.height)
      gl.useProgram(program); gl.disable(gl.DITHER); gl.disable(gl.BLEND)
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, input.width, input.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, input.data)
      gl.uniform1i(gl.getUniformLocation(program, 'uKind'), kind)
      const p = effect.parameters as unknown as Record<string, number>
      gl.uniform4f(gl.getUniformLocation(program, 'uParams'), p.brightness ?? p.stops ?? p.amount ?? p.inputBlack ?? 0, p.contrast ?? p.inputWhite ?? 0, p.gamma ?? 1, p.outputBlack ?? 0)
      gl.uniform1f(gl.getUniformLocation(program, 'uWhite'), p.outputWhite ?? 255)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const data = new Uint8ClampedArray(input.data.length)
      gl.readPixels(0, 0, input.width, input.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
      if (gl.getError() !== gl.NO_ERROR) return null
      return { data, width: input.width, height: input.height }
    } catch { this.unavailable = true; return null }
  }
  destroy(): void {
    this.blur.destroy()
    if (this.gl) { this.gl.deleteTexture(this.texture); this.gl.deleteProgram(this.program); this.gl.getExtension('WEBGL_lose_context')?.loseContext() }
    this.gl = null; this.program = null; this.texture = null
  }
  private initialize(): void {
    if (this.program || this.unavailable) return
    if (typeof OffscreenCanvas === 'undefined') { this.unavailable = true; return }
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })
    if (!gl) { this.unavailable = true; return }
    this.gl = gl
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Cannot allocate effect shader')
      gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Effect shader compilation failed') }
      return shader
    }
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
    precision highp float;
    void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`)
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform sampler2D uImage;
    uniform int uKind;
    uniform vec4 uParams;
    uniform float uWhite;
    out vec4 result;
    void main() {
      vec4 c = texelFetch(uImage, ivec2(gl_FragCoord.xy), 0); vec3 r = c.rgb;
      float a = uParams.x;
      if (uKind == 0) r = (r - 0.5) * (1.0 + uParams.y) + 0.5 + a;
      else if (uKind == 1) r *= exp2(a);
      else if (uKind == 2) { float l = dot(r, vec3(0.2126, 0.7152, 0.0722)); r = vec3(l) + (r - l) * (1.0 + a); }
      else if (uKind == 3) r += a * vec3(0.12, 0.02, -0.12);
      else if (uKind == 4) r = mix(r, vec3(dot(r, vec3(0.2126, 0.7152, 0.0722))), a);
      else if (uKind == 5) r = mix(r, vec3(dot(r, vec3(0.393, 0.769, 0.189)), dot(r, vec3(0.349, 0.686, 0.168)), dot(r, vec3(0.272, 0.534, 0.131))), a);
      else if (uKind == 6) r = mix(r, 1.0 - r, a);
      else if (uKind == 7) r = vec3(uParams.w / 255.0) + pow(clamp((r - a / 255.0) / ((uParams.y - a) / 255.0), 0.0, 1.0), vec3(1.0 / uParams.z)) * ((uWhite - uParams.w) / 255.0);
      result = vec4(clamp(r, 0.0, 1.0), c.a);
    }`)
    const program = gl.createProgram()
    if (!program) throw new Error('Cannot allocate effect program')
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
    gl.deleteShader(vertex); gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error('Cannot link effect program') }
    this.program = program; this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }
}
