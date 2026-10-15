import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url))
const engineLayers = [
  'core',
  'raster',
  'renderer',
  'tools',
  'adapters',
  'persistence',
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(path)
      : path.endsWith('.ts')
        ? [path]
        : []
  })
}

function imports(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const result: string[] = []
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteral(argument)) result.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

const dependencies = engineLayers.flatMap((layer) =>
  sourceFiles(resolve(sourceRoot, layer)).flatMap((file) =>
    imports(file).map((specifier) => ({ file, layer, specifier })),
  ),
)

describe('architecture boundaries', () => {
  it('keeps the domain inside core with Paper as its only external dependency', () => {
    const violations = dependencies.filter(({ file, layer, specifier }) => {
      if (layer !== 'core') return false
      if (!specifier.startsWith('.'))
        return !specifier.startsWith('paper/') && specifier !== 'paper'
      return (
        relative(sourceRoot, resolve(dirname(file), specifier)).split(
          '/',
        )[0] !== 'core'
      )
    })
    expect(violations).toEqual([])
  })

  it('keeps engine modules independent of UI state and bundler aliases', () => {
    const uiLayers = new Set([
      'app',
      'components',
      'composables',
      'stores',
      'ui',
      'views',
    ])
    const violations = dependencies.filter(({ file, specifier }) => {
      if (specifier.startsWith('~/') || specifier.startsWith('@/')) return true
      if (!specifier.startsWith('.'))
        return /^(vue|pinia|vite|@vue\/|@vueuse\/)/.test(specifier)
      const target = relative(
        sourceRoot,
        resolve(dirname(file), specifier),
      ).split('/')[0]!
      return uiLayers.has(target)
    })
    expect(violations).toEqual([])
  })
})
