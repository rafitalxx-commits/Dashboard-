import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { HermesPreview } from './hermesPreview';
import './styles/app.css';

const isHermesPreview = window.location.pathname.startsWith('/hermes-real');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isHermesPreview ? <HermesPreview /> : <App />}
  </StrictMode>,
);
