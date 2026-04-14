import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

const container = document.getElementById('root')!;
const root = createRoot(container);

// Error logging for Debug
window.addEventListener('error', (event) => {
  console.error('[SyncWatch Renderer Error]:', event.error);
  document.body.innerHTML = `
    <div style="background: #020617; color: #f87171; padding: 20px; font-family: sans-serif;">
      <h1 style="font-size: 20px; margin-bottom: 10px;">Render Crash Detected</h1>
      <pre style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; overflow: auto; max-height: 80vh;">${event.error?.stack || event.message}</pre>
    </div>
  `;
});

root.render(
  <StrictMode>
    <App />
  </StrictMode>
)
