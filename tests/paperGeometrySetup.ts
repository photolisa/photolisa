import { createRequire } from 'node:module'
// happy-dom has no Canvas implementation. Load Paper's geometry-only Node mode
// before its browser environment can attempt blend-mode canvas capability probes.
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'self')
try {
  Object.defineProperty(globalThis, 'self', {
    value: undefined,
    configurable: true,
  })
  createRequire(import.meta.url)('paper/dist/paper-core')
} finally {
  if (descriptor) Object.defineProperty(globalThis, 'self', descriptor)
  else Reflect.deleteProperty(globalThis, 'self')
}
