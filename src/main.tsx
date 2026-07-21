import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { HermesPreview } from './hermesPreview';
import './styles/app.css';

const isHermesPreview =
  window.location.pathname.startsWith('/hermes-dev') ||
  window.location.pathname.startsWith('/hermes-real') ||
  window.location.pathname.startsWith('/hermes-updated');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isHermesPreview ? <HermesPreview /> : <App />}
  </StrictMode>,
);
