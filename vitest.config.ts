import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/paperGeometrySetup.ts'],
    include: ['tests/unit/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] },
  },
})
