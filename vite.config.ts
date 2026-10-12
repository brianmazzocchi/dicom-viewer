import { defineConfig, loadEnv } from 'vite';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { libraryPlugin } from './server/library';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const libraryPath = env.LIBRARY_PATH?.trim();

  return {
    plugins: [
      nodePolyfills({
        include: ['events'],
        globals: { Buffer: false, global: false, process: false },
      }),
      viteCommonjs(),
      libraryPlugin(libraryPath),
    ],
    assetsInclude: ['**/*.wasm'],
    optimizeDeps: {
      exclude: ['@cornerstonejs/dicom-image-loader'],
      include: ['dicom-parser'],
    },
    worker: {
      format: 'es',
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  };
});
