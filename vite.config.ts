import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      sourcemap: false,
    },
    optimizeDeps: {
      exclude: [
        'pdfjs-dist',
        'pdfjs-dist/legacy/build/pdf.min.mjs',
        'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      ],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: false,
      watch: null,
    },
  };
});
