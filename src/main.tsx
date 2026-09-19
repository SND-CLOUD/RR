import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './i18n';
import { localDb } from './lib/local-db';
import { defineCustomElements as defineJeepSqlite } from 'jeep-sqlite/loader';

const init = async () => {
  if (typeof window !== 'undefined') {
    await defineJeepSqlite(window);
    
    // Check if jeep-sqlite is in the DOM, if not, append it
    let jeepSqlite = document.querySelector('jeep-sqlite');
    if (!jeepSqlite) {
      jeepSqlite = document.createElement('jeep-sqlite');
      jeepSqlite.setAttribute('wasmPath', '/assets');
      document.body.appendChild(jeepSqlite);
    } else if (!jeepSqlite.getAttribute('wasmPath')) {
      jeepSqlite.setAttribute('wasmPath', '/assets');
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
