import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS ist Pflicht, damit das Handy im LAN die Kamera freigibt (getUserMedia braucht einen Secure Context).
export default defineConfig({
  base: './',
  plugins: [react(), basicSsl()],
  server: { host: true },
  preview: { host: true },
});
