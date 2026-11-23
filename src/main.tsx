import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { useApp } from './state/store';
import * as controller from './state/controller';

// Accès de débogage, en développement seulement : window.__flane.state.getState()
if (import.meta.env.DEV) (window as unknown as { __flane: unknown }).__flane = { state: useApp, controller };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Hors-ligne une fois installée. Pas en local (pour ne jamais servir de vieux fichiers pendant le dev),
// sauf avec ?sw dans l'adresse pour le tester.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!local || new URLSearchParams(location.search).has('sw'))) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
