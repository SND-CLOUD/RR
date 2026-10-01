import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './i18n';
import { localDb } from './lib/local-db';
import { defineCustomElements as defineJeepSqlite } from 'jeep-sqlite/loader';

// Safe WebAssembly streaming compilation polyfill for iframe and sandbox environments
if (typeof window !== 'undefined' && typeof WebAssembly !== 'undefined') {
  const origStreaming = WebAssembly.instantiateStreaming;
  WebAssembly.instantiateStreaming = async function (source: Response | Promise<Response>, importObject?: WebAssembly.Imports) {
    try {
      const res = await Promise.resolve(source);
      const bytes = await (res.clone ? res.clone() : res).arrayBuffer();
      return await WebAssembly.instantiate(bytes, importObject);
    } catch (e) {
      if (typeof origStreaming === 'function') {
        return origStreaming.call(WebAssembly, source, importObject);
      }
      throw e;
    }
  };

  const filterWasmMsg = (args: any[]) => {
    if (!args || !args[0]) return false;
    const str = String(args[0]);
    return str.includes('wasm streaming compile failed') || str.includes('falling back to ArrayBuffer instantiation');
  };

  const origWarn = console.warn;
  console.warn = function (...args: any[]) {
    if (filterWasmMsg(args)) return;
    origWarn.apply(console, args);
  };

  const origError = console.error;
  console.error = function (...args: any[]) {
    if (filterWasmMsg(args)) return;
    origError.apply(console, args);
  };
}

const init = async () => {
  if (typeof window !== 'undefined') {
    await defineJeepSqlite(window);
    
    // Check if jeep-sqlite is in the DOM, if not, append it
    let jeepSqlite = document.querySelector('jeep-sqlite');
    if (!jeepSqlite) {
      jeepSqlite = document.createElement('jeep-sqlite');
      document.body.appendChild(jeepSqlite);
    }
    await customElements.whenDefined('jeep-sqlite');
  }
  
  try {
    await localDb.initialize();
    // Auto-heal any corrupted fund balances from previous repeated sync deduction bugs
    if (localStorage.getItem('fin_funds_healed_v2') !== 'true') {
      import('./lib/fundRepairService').then(({ repairAllFundBalances }) => {
        repairAllFundBalances()
          .then(() => localStorage.setItem('fin_funds_healed_v2', 'true'))
          .catch(e => console.warn("Background fund balance self-heal error:", e));
      });
    }
  } catch (err) {
    console.error("Critical error during database initialization:", err);
  }
  
  const rootElement = document.getElementById('root');
  if (rootElement) {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
};

init();
