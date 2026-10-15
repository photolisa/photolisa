import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

/** PDF.js fonts, CMaps and decoders are served locally, with a fixed allowlist. */
export function pdfAssets(): Plugin {
  const root = dirname(
    createRequire(import.meta.url).resolve('pdfjs-dist/package.json'),
  )
  const files = new Map<string, string>()
  for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const name of readdirSync(join(root, directory))) {
      if (
        (/\.(bcmap|pfb|ttf|wasm|js)$/.test(name) || /^LICENSE/.test(name)) &&
        !name.startsWith('quickjs')
      )
        files.set(`${directory}/${name}`, join(root, directory, name))
    }
  }
  let base = '/'
  return {
    name: 'photolisa-local-pdf-assets',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const prefix = `${base}pdf-assets/`
        const url = request.url?.split('?')[0] ?? ''
        const file = url.startsWith(prefix)
          ? files.get(url.slice(prefix.length))
          : undefined
        if (!file) return next()
        response.setHeader(
          'Content-Type',
          file.endsWith('.wasm')
            ? 'application/wasm'
            : file.endsWith('.js')
              ? 'text/javascript'
              : 'application/octet-stream',
        )
        response.end(readFileSync(file))
      })
    },
    generateBundle() {
      for (const [name, path] of files)
        this.emitFile({
          type: 'asset',
          fileName: `pdf-assets/${name}`,
          source: readFileSync(path),
        })
    },
  }
}
