import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Version affichée en bas de l'app : commit + heure de construction (pour savoir laquelle on a). */
function buildId(): string {
  let sha = 'dev';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    /* pas de dépôt git */
  }
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sha} · ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}h${pad(d.getMinutes())}`;
}

// base './' : l'app peut être servie depuis un sous-dossier (GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(buildId()) },
  server: { port: 5280, strictPort: true },
  preview: { port: 5281, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
});
