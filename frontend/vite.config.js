import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      minify: 'esbuild',
    },
    define: {
      // Feature flags - set via environment variables
      // VITE_SHOW_DONATION: Show donation/support links (official instance only)
      // VITE_BUILD_TIME: Cache busting for deployments
      'import.meta.env.VITE_SHOW_DONATION': JSON.stringify(env.VITE_SHOW_DONATION || 'false'),
      'import.meta.env.VITE_BUILD_TIME': JSON.stringify(env.VITE_BUILD_TIME || Date.now().toString()),
    },
  };
})
