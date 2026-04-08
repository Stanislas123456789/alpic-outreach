import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3001 },
  define: {
    'process.env.VITE_SHEET_ID': JSON.stringify(process.env.VITE_SHEET_ID),
    'process.env.VITE_API_KEY': JSON.stringify(process.env.VITE_API_KEY),
  },
});
