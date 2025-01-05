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
      outDir: '../dist',
      sourcemap: true,
      assetsDir: 'assets',
    },
    root: 'src',
    envDir: '..',
    base: '/journal/',
  };
}); 