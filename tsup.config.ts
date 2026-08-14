import { defineConfig } from 'tsup'

// Dual CJS/ESM: ADO task hosts are CommonJS, so `require` must resolve to real CJS.
// The peers are external so a consumer's single vendored copy is used — a bundled
// second azure-pipelines-task-lib would ship in every .vsix and could drift from
// the one the agent actually configured.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'node20',
  platform: 'node',
  external: ['azure-pipelines-task-lib', 'undici', '@4cloudguru/pipeline-task-core'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' }
  },
})
