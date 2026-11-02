import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  fixedExtension: false,
  platform: 'node',
  target: 'es2024',
  clean: true,
  deps: { neverBundle: ['vite'] },
  dts: false
})
