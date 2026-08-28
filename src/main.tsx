import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { HermesPreview } from './hermesPreview';
import { PublicTrackingPage } from './publicTracking';
import './styles/app.css';

const isHermesPreview =
  window.location.pathname.startsWith('/hermes-dev') ||
  window.location.pathname.startsWith('/hermes-real') ||
  window.location.pathname.startsWith('/hermes-updated');
const isPublicTracking = window.location.pathname.startsWith('/seguimiento');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPublicTracking ? <PublicTrackingPage /> : isHermesPreview ? <HermesPreview /> : <App />}
  </StrictMode>,
);
