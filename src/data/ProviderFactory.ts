import { IDataProvider } from './IDataProvider';
import { LocalProviderInstance } from './LocalProvider';
import { FirebaseProviderInstance } from './FirebaseProvider';

export type DatabaseMode = 'LOCAL' | 'CLOUD' | 'AUTO';

export class ProviderFactory {
  private static isInitialized = false;
  private static networkListenerAttached = false;
  private static isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  static init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (typeof window !== 'undefined' && !this.networkListenerAttached) {
      this.networkListenerAttached = true;
      window.addEventListener('online', async () => {
        this.isOnline = true;
        console.log('App connection changed: ONLINE. Running in cloud mode if AUTO is selected.');
        if (this.getMode() === 'AUTO') {
          try {
            const { SyncEngine } = await import('./SyncEngine');
            console.log('Starting background auto-sync...');
            await SyncEngine.syncAll();
            SyncEngine.startCloudListener();
          } catch (e) {
            console.error('Failed to run background auto-sync:', e);
          }
        }
      });
      window.addEventListener('offline', () => {
        this.isOnline = false;
        console.log('App connection changed: OFFLINE. Running in local mode if AUTO is selected.');
        if (this.getMode() === 'AUTO') {
          import('./SyncEngine').then(({ SyncEngine }) => {
            SyncEngine.stopCloudListener();
          }).catch(e => console.error('Failed to stop cloud listener on offline:', e));
        }
      });

      // Trigger full cloud sync and restore on startup if online
      if (this.isOnline) {
        setTimeout(async () => {
          try {
            // Automatic clean recovery: clear stale local tombstones
            try {
              const { localDb } = await import('../lib/local-db');
              await localDb.run("DELETE FROM deleted_records").catch(() => {});
              await localDb.run("DELETE FROM outbox WHERE action = 'DELETE'").catch(() => {});
            } catch (_) {}

            // Ensure inventory_items exists in Firestore
            try {
              const { FirebaseProviderInstance } = await import('./FirebaseProvider');
              await FirebaseProviderInstance.ensureInventoryCollection();
            } catch (_) {}

            const { SyncEngine } = await import('./SyncEngine');
            console.log('Starting startup auto-sync and full cloud download...');
            await SyncEngine.syncAll(true);
            if (this.getMode() === 'AUTO') {
              SyncEngine.startCloudListener();
            }
          } catch (e) {
            console.error('Failed to run startup auto-sync:', e);
          }
        }, 800);
      }

      // Periodic background auto-sync every 30 seconds if AUTO mode is selected
      setInterval(async () => {
        if (this.getMode() === 'AUTO') {
          try {
            const { SyncEngine } = await import('./SyncEngine');
            if (!SyncEngine.isSyncing()) {
              console.log('Starting periodic background auto-sync...');
              await SyncEngine.syncAll();
            }
          } catch (e) {
            console.error('Failed to run periodic background auto-sync:', e);
          }
        }
      }, 30000); // 30 seconds
    }
  }

  static getMode(): DatabaseMode {
    const stored = localStorage.getItem('snd_db_provider_mode');
    if (stored === 'LOCAL' || stored === 'CLOUD' || stored === 'AUTO') {
      return stored as DatabaseMode;
    }
    // Fallback to build-time environment variable if configured
    const meta = import.meta as any;
    const envMode = meta && meta.env ? meta.env.VITE_APP_MODE : undefined;
    if (envMode === 'LOCAL' || envMode === 'CLOUD' || envMode === 'AUTO') {
      return envMode as DatabaseMode;
    }
    return 'AUTO'; // Default fallback
  }

  static setMode(mode: DatabaseMode) {
    localStorage.setItem('snd_db_provider_mode', mode);
    // Reload to apply database context cleanly
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  static getActiveProviderType(): 'LOCAL' | 'CLOUD' {
    this.init();
    // Force LOCAL provider for all modes because the UI heavily relies on localDb.query (SQLite).
    // SyncEngine will replicate changes to Firebase in the background.
    return 'LOCAL';
  }

  static getProvider(): IDataProvider {
    const type = this.getActiveProviderType();
    
    // Proactively start real-time cloud listeners if we are online and in AUTO (hybrid) mode
    if (this.getMode() === 'AUTO') {
      import('./SyncEngine').then(({ SyncEngine }) => {
        SyncEngine.startCloudListener();
      }).catch(e => console.error('Failed to start cloud listener in getProvider:', e));
    }

    if (type === 'CLOUD') {
      return FirebaseProviderInstance;
    }
    return LocalProviderInstance;
  }
}
