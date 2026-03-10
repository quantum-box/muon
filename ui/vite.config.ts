import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tauri expects a fixed port for the dev server
const isTauri = !!process.env.TAURI_ENV_PLATFORM

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Prevent Vite from obscuring Rust errors in Tauri
  clearScreen: false,

  server: {
    // Fixed port for Tauri dev server
    port: 1420,
    strictPort: isTauri,
    proxy: isTauri
      ? undefined
      : {
          '/api': {
            target: 'http://localhost:9800',
            changeOrigin: true,
          },
        },
  },

  // Environment variables prefixed with TAURI_ are exposed to the frontend
  envPrefix: ['VITE_', 'TAURI_ENV_'],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: isTauri ? 'esnext' : 'modules',
    // Prevent minification issues for Tauri debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    // Produce source maps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['@monaco-editor/react'],
          xyflow: ['@xyflow/react'],
        },
      },
    },
  },
})
