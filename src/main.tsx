import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dauerhaften Speicher anfordern, damit der Browser Sammlung, Decks und Kartendatenbank nicht bei Platzmangel räumt.
navigator.storage?.persist?.().catch(() => {});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service Worker nicht registriert', err));
  });
}
