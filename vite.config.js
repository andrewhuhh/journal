import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      legacy({
        targets: ['defaults', 'not IE 11'],
      }),
    ],
    server: {
      port: 3000,
      open: true,
      fs: {
        allow: ['..']
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      assetsDir: 'assets',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage']
          },
          assetFileNames: (assetInfo) => {
            if (assetInfo.names.endsWith('.svg')) {
              return 'assets/[name][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          }
        }
      }
    },
    root: 'src',
    envDir: '..',
    base: '/journal/',
  };
}); 