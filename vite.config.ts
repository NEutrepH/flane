import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : l'app peut être servie depuis un sous-dossier (GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5280, strictPort: true },
  preview: { port: 5281, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
});
