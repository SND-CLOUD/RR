import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import fs from 'fs';

// Automatically copy correct WASM files from node_modules to public and public/assets on dev/build
try {
  const publicDir = path.resolve('public');
  const assetsDir = path.resolve('public/assets');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const filesToCopy = [
    { file: 'sql-wasm.wasm', srcName: 'sql-wasm.wasm' },
    { file: 'sql-wasm-browser.wasm', srcName: 'sql-wasm.wasm' },
    { file: 'sql-wasm-debug.wasm', srcName: 'sql-wasm-debug.wasm' },
    { file: 'sql-wasm-browser-debug.wasm', srcName: 'sql-wasm-debug.wasm' },
  ];

  filesToCopy.forEach(({ file, srcName }) => {
    const possibleSources = [
      path.resolve('node_modules/sql.js/dist', srcName),
      path.resolve('node_modules/jeep-sqlite/dist/jeep-sqlite', srcName),
      path.resolve('node_modules/jeep-sqlite/dist', srcName),
    ];

    for (const source of possibleSources) {
      if (fs.existsSync(source)) {
        const srcSize = fs.statSync(source).size;
        
        // Copy to public/assets/
        const destAssets = path.resolve(assetsDir, file);
        if (!fs.existsSync(destAssets) || fs.statSync(destAssets).size !== srcSize) {
          fs.copyFileSync(source, destAssets);
        }

        // Copy main wasm to root public/ as well for direct relative requests
        if (file === 'sql-wasm.wasm') {
          const destPublic = path.resolve(publicDir, file);
          if (!fs.existsSync(destPublic) || fs.statSync(destPublic).size !== srcSize) {
            fs.copyFileSync(source, destPublic);
          }
        }
        break;
      }
    }
  });
} catch (err) {
  console.error('[WASM Safe-Restore] Error during file synchronization:', err);
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
    ],
    optimizeDeps: {
      exclude: ['@capacitor-community/sqlite', 'jeep-sqlite', 'sql.js'],
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-icons': ['lucide-react'],
            'vendor-firebase': ['firebase/app', 'firebase/firestore', 'firebase/auth'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
