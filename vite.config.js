import { defineConfig } from 'vite';

export default defineConfig({
  envDir: '.',
  server: {
    port: 5173,
    allowedHosts: true, // *.trycloudflare.com などトンネル経由のHostを許可
    // トンネル(https)越しのHMR用: TUNNEL=1 npm run dev
    hmr: process.env.TUNNEL ? { clientPort: 443, protocol: 'wss' } : undefined,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
