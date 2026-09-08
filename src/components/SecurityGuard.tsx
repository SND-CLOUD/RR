import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Fingerprint, Lock, ShieldAlert, RefreshCw } from 'lucide-react';
import { NativeBiometric } from 'capacitor-native-biometric';
import { Device } from '@capacitor/device';
import { App as CapacitorApp } from '@capacitor/app';

interface SecurityGuardProps {
  children: React.ReactNode;
}

export default function SecurityGuard({ children }: SecurityGuardProps) {
  const [locked, setLocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<any>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const isAuthenticatingRef = useRef(false);
  const isBiometricPromptOpenRef = useRef(false);
  const promptTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lockedRef = useRef(false);
  const lastActiveRef = useRef(Date.now());
  const screenOffOccurredRef = useRef(false);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  const authenticateBiometric = useCallback(async () => {
    if (isAuthenticatingRef.current) {
      return;
    }

    try {
      const info = await Device.getInfo();
      if (info.platform === 'web') {
        return;
      }

      isAuthenticatingRef.current = true;
      isBiometricPromptOpenRef.current = true;
      setIsVerifying(true);
      setError('');

      const result = await NativeBiometric.isAvailable();
      if (result.isAvailable) {
        await NativeBiometric.verifyIdentity({
          reason: "يرجى التحقق لفتح التطبيق",
          title: "تسجيل الدخول بالبصمة",
          subtitle: "نظام سند لإدارة الصيانة",
          description: "قم بوضع إصبعك على الحساس للمتابعة"
        });

        setLocked(false);
        lockedRef.current = false;
        setError('');
        sessionStorage.setItem('snd_security_unlocked', 'true');
        lastActiveRef.current = Date.now();
        screenOffOccurredRef.current = false;
      } else {
        setError('مستشعر البصمة غير متاح حالياً.');
      }
    } catch (e: any) {
      console.warn("Biometric failed or cancelled", e);
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('cancel') || msg.includes('user_cancel') || e?.code === 10) {
        setError("تم إلغاء التحقق. انقر على زر البصمة للمحاولة مجدداً.");
      } else {
        setError("فشل التحقق بالبصمة. انقر على أيقونة البصمة للمحاولة مجدداً.");
      }
    } finally {
      setIsVerifying(false);
      // Brief cooldown before releasing locks so Android window focus events stabilize
      setTimeout(() => {
        isBiometricPromptOpenRef.current = false;
        isAuthenticatingRef.current = false;
      }, 500);
    }
  }, []);

  const checkSecurity = useCallback(async (isResume = false) => {
    try {
      const savedSettings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
      setSettings(savedSettings);

      const isBio = savedSettings.biometricEnabled === true || savedSettings.biometricEnabled === 1;
      const isPin = savedSettings.pinEnabled === true || savedSettings.pinEnabled === 1;

      // If neither is enabled, ensure app is unlocked
      if (!isBio && !isPin) {
        setLocked(false);
        sessionStorage.setItem('snd_security_unlocked', 'true');
        return;
      }

      // Check if session is already unlocked (e.g. freshly logged in)
      const isAlreadyUnlocked = sessionStorage.getItem('snd_security_unlocked') === 'true';
      if (isAlreadyUnlocked && !isResume) {
        setLocked(false);
        return;
      }

      const info = await Device.getInfo();
      const isWeb = info.platform === 'web';

      // Fallback for web: only lock if PIN is enabled
      if (isWeb && !isPin) {
        setLocked(false);
        sessionStorage.setItem('snd_security_unlocked', 'true');
        return;
      }

      // If we reach here, lock the app
      setLocked(true);
      setError('');

      if (isBio && !isWeb) {
        // Clear any previous scheduled prompt
        if (promptTimeoutRef.current) {
          clearTimeout(promptTimeoutRef.current);
          promptTimeoutRef.current = null;
        }

        const bio = await NativeBiometric.isAvailable();
        if (bio.isAvailable) {
          // On Android resume: wait 650ms for window focus to be fully established before prompting
          const delay = isResume ? 650 : 200;
          promptTimeoutRef.current = setTimeout(() => {
            authenticateBiometric();
          }, delay);
        } else if (!isPin) {
          // Bio enabled but not available on device hardware, and no PIN fallback
          setLocked(false);
          sessionStorage.setItem('snd_security_unlocked', 'true');
        }
      }
    } catch (err) {
      console.error("Security check failed", err);
      // Default to unlocked on check failure to prevent locking out
      setLocked(false);
    }
  }, [authenticateBiometric]);

  useEffect(() => {
    checkSecurity(false);

    const onSettingsChanged = () => {
      const savedSettings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
      setSettings(savedSettings);
      const isBio = savedSettings.biometricEnabled === true || savedSettings.biometricEnabled === 1;
      const isPin = savedSettings.pinEnabled === true || savedSettings.pinEnabled === 1;
      if (!isBio && !isPin) {
        setLocked(false);
        lockedRef.current = false;
        sessionStorage.setItem('snd_security_unlocked', 'true');
      }
      lastActiveRef.current = Date.now();
    };
    window.addEventListener('snd_settings_changed', onSettingsChanged);

    // 1. Screen Off Listener (triggered natively from Android via MainActivity broadcast receiver)
    const onScreenOff = () => {
      console.log('[SecurityGuard] Native screen off detected');
      screenOffOccurredRef.current = true;
    };
    window.addEventListener('snd_screen_off', onScreenOff);

    // 2. User Activity Tracker (resets idle timer on user touch/keys/clicks)
    const updateActivity = () => {
      lastActiveRef.current = Date.now();
    };
    window.addEventListener('pointerdown', updateActivity, { passive: true });
    window.addEventListener('touchstart', updateActivity, { passive: true });
    window.addEventListener('keydown', updateActivity, { passive: true });
    window.addEventListener('click', updateActivity, { passive: true });
    window.addEventListener('input', updateActivity, { passive: true });

    // 3. Foreground Idle Checker (locks if inactive in foreground for selected session duration)
    const idleCheckInterval = setInterval(() => {
      if (lockedRef.current || isBiometricPromptOpenRef.current) {
        return;
      }

      const savedSettings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
      const isBio = savedSettings.biometricEnabled === true || savedSettings.biometricEnabled === 1;
      const isPin = savedSettings.pinEnabled === true || savedSettings.pinEnabled === 1;
      if (!isBio && !isPin) return;

      const timeoutMinutes = Number(savedSettings.sessionTimeout) || 5;
      const timeoutMs = timeoutMinutes * 60 * 1000;
      const inactiveDuration = Date.now() - lastActiveRef.current;

      if (inactiveDuration >= timeoutMs) {
        console.log(`[SecurityGuard] Foreground idle reached (${inactiveDuration}ms >= ${timeoutMs}ms). Locking.`);
        sessionStorage.removeItem('snd_security_unlocked');
        checkSecurity(true);
      }
    }, 10000);

    // 4. Background & Resume Handling
    let appStateHandle: any = null;
    let pauseTimestamp = 0;

    const handleAppBackground = () => {
      if (isBiometricPromptOpenRef.current) return;
      pauseTimestamp = Date.now();
    };

    const handleAppForeground = () => {
      if (isBiometricPromptOpenRef.current) return;
      if (lockedRef.current) return;

      const elapsed = pauseTimestamp > 0 ? (Date.now() - pauseTimestamp) : 0;
      pauseTimestamp = 0;

      const savedSettings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
      const isBio = savedSettings.biometricEnabled === true || savedSettings.biometricEnabled === 1;
      const isPin = savedSettings.pinEnabled === true || savedSettings.pinEnabled === 1;
      if (!isBio && !isPin) return;

      const timeoutMinutes = Number(savedSettings.sessionTimeout) || 5;
      const timeoutMs = timeoutMinutes * 60 * 1000;

      // Lock if screen was turned off OR if background duration exceeded session timeout
      if (screenOffOccurredRef.current || elapsed >= timeoutMs) {
        console.log(`[SecurityGuard] Resuming with lock trigger: screenOff=${screenOffOccurredRef.current}, elapsed=${elapsed}ms >= ${timeoutMs}ms`);
        screenOffOccurredRef.current = false;
        sessionStorage.removeItem('snd_security_unlocked');
        checkSecurity(true);
      } else {
        console.log(`[SecurityGuard] Resumed within session timeout (${elapsed}ms < ${timeoutMs}ms). App remains open.`);
        lastActiveRef.current = Date.now();
      }
    };

    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        handleAppBackground();
      } else {
        handleAppForeground();
      }
    }).then(h => {
      appStateHandle = h;
    }).catch(e => {
      console.warn("Could not attach appStateChange listener:", e);
    });

    const onVisibilityChange = () => {
      if (document.hidden) {
        handleAppBackground();
      } else {
        handleAppForeground();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('snd_settings_changed', onSettingsChanged);
      window.removeEventListener('snd_screen_off', onScreenOff);
      window.removeEventListener('pointerdown', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('input', updateActivity);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(idleCheckInterval);
      if (promptTimeoutRef.current) {
        clearTimeout(promptTimeoutRef.current);
      }
      if (appStateHandle && typeof appStateHandle.remove === 'function') {
        appStateHandle.remove();
      }
    };
  }, [checkSecurity]);

  const handlePinSubmit = () => {
    if (pinInput === settings?.pinCode) {
      setLocked(false);
      lockedRef.current = false;
      setError('');
      setPinInput('');
      sessionStorage.setItem('snd_security_unlocked', 'true');
      lastActiveRef.current = Date.now();
      screenOffOccurredRef.current = false;
    } else {
      setError('الرمز السري غير صحيح');
      setPinInput('');
    }
  };

  if (!locked) return <>{children}</>;

  const hasBiometric = settings?.biometricEnabled === true || settings?.biometricEnabled === 1;
  const hasPin = settings?.pinEnabled === true || settings?.pinEnabled === 1;

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] flex flex-col items-center justify-center p-6 text-white font-sans rtl">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xs w-full text-center space-y-6"
      >
        <div className="flex flex-col items-center space-y-4">
           <div className="w-20 h-20 bg-orange-600/10 rounded-3xl flex items-center justify-center text-orange-500 border border-orange-500/20 shadow-lg shadow-orange-950/20">
              <ShieldAlert size={40} />
           </div>
           <div className="space-y-1">
              <h2 className="text-xl font-black">التطبيق مغلق للأمان</h2>
              <p className="text-xs text-gray-400">يرجى التحقق لتتمكن من الوصول للبيانات</p>
           </div>
        </div>

        {hasPin && (
          <div className="space-y-5">
            <div className="grid grid-cols-4 gap-3 bg-white/5 p-4 rounded-2xl border border-white/5">
               {Array.from({ length: 4 }).map((_, i) => (
                 <div key={i} className={`h-12 rounded-xl flex items-center justify-center text-2xl font-black transition-all ${pinInput.length > i ? 'bg-orange-500 text-white' : 'bg-black/40 border border-white/10 text-gray-700'}`}>
                    {pinInput.length > i ? '●' : ''}
                 </div>
               ))}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button 
                  key={num}
                  type="button"
                  onClick={() => pinInput.length < 4 && setPinInput(p => p + num)}
                  className="h-14 bg-white/5 rounded-2xl hover:bg-white/10 border border-white/5 text-xl font-bold transition-all active:scale-95 cursor-pointer"
                >
                  {num}
                </button>
              ))}
              <div />
              <button 
                type="button"
                onClick={() => pinInput.length < 4 && setPinInput(p => p + '0')}
                className="h-14 bg-white/5 rounded-2xl hover:bg-white/10 border border-white/5 text-xl font-bold transition-all active:scale-95 cursor-pointer"
              >
                0
              </button>
              <button 
                type="button"
                onClick={() => setPinInput(p => p.slice(0, -1))}
                className="h-14 bg-red-600/10 rounded-2xl hover:bg-red-600/20 text-red-500 font-bold transition-all active:scale-95 cursor-pointer"
              >
                ←
              </button>
            </div>

            {pinInput.length === 4 && (
              <button 
                type="button"
                onClick={handlePinSubmit}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white py-3.5 rounded-2xl font-black shadow-lg shadow-orange-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
              >
                <Lock size={18} />
                تأكيد الرمز
              </button>
            )}
          </div>
        )}

        {hasBiometric && (
          <div className="pt-2 flex flex-col items-center gap-3">
            <button 
              type="button"
              disabled={isVerifying}
              onClick={() => authenticateBiometric()}
              className={`p-5 rounded-3xl bg-orange-600/10 border border-orange-500/30 text-orange-500 hover:bg-orange-600/20 transition-all shadow-lg active:scale-90 flex items-center justify-center cursor-pointer ${isVerifying ? 'animate-pulse opacity-70' : ''}`}
              title="انقر لتشغيل حساس البصمة"
            >
              {isVerifying ? (
                <RefreshCw size={44} className="animate-spin text-orange-400" />
              ) : (
                <Fingerprint size={44} />
              )}
            </button>
            <span className="text-xs font-bold text-gray-300">
              {isVerifying ? 'جاري التحقق من البصمة...' : 'انقر على البصمة لإعادة فتح الحساس'}
            </span>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 font-semibold bg-red-500/10 border border-red-500/20 rounded-xl p-3 leading-relaxed">
            {error}
          </p>
        )}
      </motion.div>
    </div>
  );
}

