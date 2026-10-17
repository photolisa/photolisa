import type { PixelBuffer } from '../core/filters/types'
/** Full-resolution separable Gaussian blur, tiled into bounded strips with a source halo. */
export class EffectGpuBlur {
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private source: WebGLTexture | null = null
  private scratch: WebGLTexture | null = null
  private framebuffer: WebGLFramebuffer | null = null
  private unavailable = false
  process(input: PixelBuffer, value: number): PixelBuffer | null {
    if (this.unavailable || input.width * input.height < 262144 || value <= 0) return null
    try {
      this.initialize()
      const gl = this.gl, program = this.program
      if (!gl || !program || gl.isContextLost()) return null
      const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, radius = Math.ceil(value)
      if (input.width > limit) return null
      const kernel = new Float32Array(101), sigma = Math.max(0.5, radius / 3)
      let sum = 0
      for (let x = -radius; x <= radius; x++) { const weight = Math.exp(-(x * x) / (2 * sigma * sigma)); kernel[x + radius] = weight; sum += weight }
      for (let x = 0; x < radius * 2 + 1; x++) kernel[x] = (kernel[x] ?? 0) / sum
      const stripHeight = Math.max(1, Math.min(limit - 2 * radius, Math.floor(2_000_000 / input.width) - 2 * radius))
      const result = new Uint8ClampedArray(input.data.length)
      gl.useProgram(program); gl.disable(gl.DITHER); gl.disable(gl.BLEND)
      gl.uniform1i(gl.getUniformLocation(program, 'uRadius'), radius)
      gl.uniform1fv(gl.getUniformLocation(program, 'uKernel'), kernel)
      for (let top = 0; top < input.height; top += stripHeight) {
        const bottom = Math.min(input.height, top + stripHeight), start = Math.max(0, top - radius), end = Math.min(input.height, bottom + radius), height = end - start
        const canvas = gl.canvas as OffscreenCanvas; canvas.width = input.width; canvas.height = height
        gl.viewport(0, 0, input.width, height)
        gl.bindTexture(gl.TEXTURE_2D, this.source)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, input.width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, input.data.subarray(start * input.width * 4, end * input.width * 4))
        gl.bindTexture(gl.TEXTURE_2D, this.scratch)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, input.width, height, 0, gl.RGBA, gl.FLOAT, null)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.scratch, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null
        gl.bindTexture(gl.TEXTURE_2D, this.source)
        gl.uniform1i(gl.getUniformLocation(program, 'uVertical'), 0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.bindTexture(gl.TEXTURE_2D, this.scratch)
        gl.uniform1i(gl.getUniformLocation(program, 'uVertical'), 1)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        const data = new Uint8ClampedArray((bottom - top) * input.width * 4)
        gl.readPixels(0, top - start, input.width, bottom - top, gl.RGBA, gl.UNSIGNED_BYTE, data)
        if (gl.getError() !== gl.NO_ERROR) return null
        result.set(data, top * input.width * 4)
      }
      return { ...input, data: result }
    } catch { this.unavailable = true; this.destroy(); return null }
  }
  destroy(): void {
    const gl = this.gl
    if (gl) { gl.deleteTexture(this.source); gl.deleteTexture(this.scratch); gl.deleteFramebuffer(this.framebuffer); gl.deleteProgram(this.program); gl.getExtension('WEBGL_lose_context')?.loseContext() }
    this.gl = null; this.program = null; this.source = null; this.scratch = null; this.framebuffer = null
  }
  private initialize(): void {
    if (this.program || this.unavailable) return
    if (typeof OffscreenCanvas === 'undefined') { this.unavailable = true; return }
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) { gl?.getExtension('WEBGL_lose_context')?.loseContext(); this.unavailable = true; return }
    this.gl = gl
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type); if (!shader) throw new Error('Cannot allocate blur shader')
      gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Blur shader compilation failed') }
      return shader
    }
    const vs = compile(gl.VERTEX_SHADER, `#version 300 es
    void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`)
    const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform sampler2D uImage;
    uniform int uRadius;
    uniform int uVertical;
    uniform float uKernel[101];
    out vec4 result;
    void main() {
      ivec2 position = ivec2(gl_FragCoord.xy), size = textureSize(uImage, 0); vec4 sum = vec4(0.0);
      for (int i = 0; i < 101; i++) {
        if (i > uRadius * 2) break;
        int offset = i - uRadius;
        ivec2 p = clamp(position + (uVertical == 0 ? ivec2(offset, 0) : ivec2(0, offset)), ivec2(0), size - 1);
        vec4 sampleColor = texelFetch(uImage, p, 0);
        if (uVertical == 0) sampleColor.rgb *= sampleColor.a;
        sum += sampleColor * uKernel[i];
      }
      if (uVertical == 1 && sum.a > 0.0) sum.rgb /= sum.a;
      result = sum;
    }`)
    const program = gl.createProgram(); if (!program) throw new Error('Cannot allocate blur program')
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error('Cannot link blur program') }
    this.program = program; this.source = gl.createTexture(); this.scratch = gl.createTexture(); this.framebuffer = gl.createFramebuffer()
    for (const texture of [this.source, this.scratch]) {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
  }
}
