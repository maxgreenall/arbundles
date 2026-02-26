import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'process', 'util', 'string_decoder', 'events'],
      globals: { Buffer: true, global: true, process: true },
      overrides: {
        crypto: 'crypto-browserify',
      },
    }),
  ],
  resolve: {
    alias: {
      crypto: 'crypto-browserify',
    },
  },
})
