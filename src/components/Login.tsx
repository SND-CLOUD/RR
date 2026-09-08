import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from '../firebase';
import { db } from '../firebase';
import { localDb } from '../lib/local-db';
import { Router, ShieldCheck, Zap, Lock, User as UserIcon, Loader2, Eye, EyeOff, Fingerprint } from 'lucide-react';
import { User } from '../types';
import { useTranslation } from 'react-i18next';
import { Device } from '@capacitor/device';
import { 
  checkBiometricSupport, 
  getSavedBiometricMeta, 
  registerBiometricCredentials, 
  authenticateAndGetCredentials, 
  clearBiometricCredentials,
  BiometricUserMeta 
} from '../lib/biometricAuth';

export default function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const { t, i18n } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isBiometricEnabled, setIsBiometricEnabled] = useState(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [biometricMeta, setBiometricMeta] = useState<BiometricUserMeta | null>(null);

  const checkBiometrics = async () => {
    try {
      let savedSettings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
      let isEnabled = savedSettings.biometricEnabled === true || savedSettings.biometricEnabled === 1;

      if (!isEnabled && Object.keys(savedSettings).length === 0) {
        try {
          const localSettingsRes = await localDb.query('SELECT data FROM settings WHERE id = ?', ['app']);
          if (localSettingsRes?.values?.[0]?.data) {
            const parsed = JSON.parse(localSettingsRes.values[0].data);
            if (parsed.biometricEnabled || parsed.appSettings?.biometricEnabled) {
              isEnabled = true;
              savedSettings = { ...savedSettings, ...parsed, biometricEnabled: true };
              localStorage.setItem('snd_settings', JSON.stringify(savedSettings));
            }
          }
        } catch (dbErr) {}
      }

      // Check Firestore settings if still not enabled
      if (!isEnabled) {
        try {
          const snap = await getDocs(query(collection(db, 'settings')));
          const appDoc = snap.docs.find(d => d.id === 'app');
          if (appDoc?.exists()) {
            const appData = appDoc.data();
            const bioVal = appData?.appSettings?.biometricEnabled ?? appData?.biometricEnabled;
            if (bioVal === true || bioVal === 1) {
              isEnabled = true;
              savedSettings.biometricEnabled = true;
              localStorage.setItem('snd_settings', JSON.stringify(savedSettings));
            }
          }
        } catch (fsErr) {}
      }

      // Check hardware biometric support
      const support = await checkBiometricSupport();

      // If hardware supports biometrics and not explicitly disabled, enable it by default
      if (support.isAvailable && savedSettings.biometricEnabled !== false) {
        isEnabled = true;
        savedSettings.biometricEnabled = true;
        localStorage.setItem('snd_settings', JSON.stringify(savedSettings));
      }

      setIsBiometricEnabled(isEnabled);
      setIsBiometricSupported(support.isAvailable);

      const meta = getSavedBiometricMeta();
      setBiometricMeta(meta);
    } catch (e) {
      console.warn("Biometric support check failed:", e);
    }
  };

  useEffect(() => {
    checkBiometrics();
    window.addEventListener('snd_settings_changed', checkBiometrics);
    return () => window.removeEventListener('snd_settings_changed', checkBiometrics);
  }, []);

  const checkDeviceRestriction = async (user: User): Promise<{ allowed: boolean; reason?: string }> => {
    if (user.role === 'admin' || user.isPrimary || user.username === 'admin') {
      return { allowed: true };
    }

    try {
      let currentDeviceId = '';
      try {
        const devIdObj = await Device.getId();
        currentDeviceId = (devIdObj?.identifier || '').trim();
      } catch (e) {
        console.warn('Could not read device ID:', e);
      }

      const accessType = user.device_access_type || 'عام';

      // Fetch all devices from cloud and local DB
      let allDevices: any[] = [];
      try {
        const devSnap = await getDocs(collection(db, 'user_devices'));
        allDevices = devSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (cloudErr) {
        try {
          const localRes = await localDb.query(`SELECT * FROM user_devices`);
          allDevices = Array.isArray(localRes) ? localRes : [];
        } catch (localErr) {}
      }

      const uUsername = (user.username || '').toLowerCase().trim();
      const uName = (user.name || '').toLowerCase().trim();
      const uId = (user.id || '').toLowerCase().trim();

      // Find user devices matching username, full display name, or user ID
      const userDevicesList = allDevices.filter((d) => {
        const dLinkedName = (d.linkedUserName || '').toLowerCase().trim();
        const dLinkedId = (d.linkedUserId || '').toLowerCase().trim();
        return (
          (uUsername && dLinkedName === uUsername) ||
          (uName && dLinkedName === uName) ||
          (uId && dLinkedId === uId) ||
          (uUsername && dLinkedId === uUsername) ||
          (user.linked_device_id && (d.id === user.linked_device_id || d.serialImei === user.linked_device_id))
        );
      });

      // Check if any device assigned to this user is blocked or frozen
      const blockedDev = userDevicesList.find(
        (d) => d.status === 'محظور' || d.status === 'معطل' || d.isFrozen === 1 || d.isFrozen === true
      );
      if (blockedDev) {
        return {
          allowed: false,
          reason: `هذا الحساب مرتبط بجهاز محظور أو مجمد حالياً في نظام الإدارة (${blockedDev.deviceName || 'جهاز النظام'}). يرجى مراجعة المسؤول.`,
        };
      }

      // Check for general access users
      if (accessType === 'عام') {
        if (currentDeviceId) {
          const blockedById = allDevices.find(
            (d) =>
              (d.status === 'محظور' || d.status === 'معطل' || d.isFrozen === 1 || d.isFrozen === true) &&
              (d.serialImei === currentDeviceId || d.id === currentDeviceId)
          );
          if (blockedById) {
            return {
              allowed: false,
              reason: 'هذا الجهاز محظور أو مجمد من استخدام النظام. يرجى مراجعة المسؤول.',
            };
          }
        }
        return { allowed: true };
      }

      // Check for restricted / dedicated access users ('مخصص')
      if (accessType === 'مخصص') {
        if (userDevicesList.length === 0) {
          return {
            allowed: false,
            reason: `حسابك (${user.name}) مخصص للاستخدام من جهاز محدد فقط، ولكن لم يتم إضافة أي جهاز مرتبط بحسابك في صفحة [أجهزة النظام] بعد. يرجى من المسؤول إضافته.`,
          };
        }

        let matchedDev = userDevicesList.find((d) => {
          if (!currentDeviceId) return false;
          const s = (d.serialImei || '').trim().toLowerCase();
          const devIdClean = (d.id || '').trim().toLowerCase();
          const cur = String(currentDeviceId || '').toLowerCase();

          return (
            s === cur ||
            devIdClean === cur ||
            (s.length >= 6 && cur.includes(s)) ||
            (cur.length >= 6 && s.includes(cur))
          );
        });

        // AUTO-BINDING: If device serial is placeholder or empty, bind currentDeviceId to it automatically on first login
        if (!matchedDev && currentDeviceId) {
          const unboundDev = userDevicesList.find((d) => {
            const s = (d.serialImei || '').trim();
            return !s || s === '869402051234567' || s === '0000' || s === 'غير مسجل' || s.length < 5;
          });

          if (unboundDev) {
            matchedDev = unboundDev;
            try {
              await updateDoc(doc(db, 'user_devices', unboundDev.id), {
                serialImei: currentDeviceId,
                updatedAt: new Date().toISOString()
              });
              await localDb.run(
                `UPDATE user_devices SET serialImei = ? WHERE id = ?`,
                [currentDeviceId, unboundDev.id]
              );
              console.log(`Auto-bound device ${unboundDev.id} to current hardware ID ${currentDeviceId}`);
            } catch (bErr) {
              console.warn('Auto-binding failed:', bErr);
            }
          }
        }

        if (!matchedDev) {
          return {
            allowed: false,
            reason: `عذراً، حسابك (${user.name}) مخصص للاستخدام من جهاز محدد آخر فقط. هذا الجهاز غير مصرح له (معرف الجهاز الحالي: ${currentDeviceId || 'غير معروف'}).`,
          };
        }
      }

      // Update lastLogin and networkStatus on linked user devices
      if (userDevicesList.length > 0) {
        const nowIso = new Date().toISOString();
        for (const targetDev of userDevicesList) {
          try {
            await updateDoc(doc(db, 'user_devices', targetDev.id), {
              lastLogin: nowIso,
              networkStatus: 'متصل'
            });
            await localDb.run(
              `UPDATE user_devices SET lastLogin = ?, networkStatus = 'متصل' WHERE id = ?`,
              [nowIso, targetDev.id]
            );
          } catch (uErr) {}
        }
      }

      return { allowed: true };
    } catch (err) {
      console.warn('Device check error:', err);
      return { allowed: true };
    }
  };

  const authenticateUserAndVerifyAll = async (
    targetUsername: string,
    targetPass: string,
    isBiometric: boolean = false
  ) => {
    setError(null);
    setLoading(true);

    try {
      const cleanUsername = targetUsername.trim();
      const q = query(collection(db, 'users'), where('username', '==', cleanUsername));
      let snap = await getDocs(q);

      let authenticatedUser: User | null = null;

      if (!snap.empty) {
        const userData = snap.docs[0].data() as User;
        const isActiveVal = userData.isActive as any;
        if (
          isActiveVal === false ||
          isActiveVal === 0 ||
          isActiveVal === 'false' ||
          userData.account_status === 'معطل' ||
          userData.account_status === 'موقوف'
        ) {
          setError("هذا الحساب معطل أو موقوف حالياً من قبل الإدارة. يرجى مراجعة المسؤول.");
          setLoading(false);
          return;
        }

        if (userData.password === targetPass) {
          authenticatedUser = { ...userData, id: snap.docs[0].id };
        }
      } else if (cleanUsername === 'admin' && targetPass === 'admin') {
        // Emergency fallback: Create and login if it's the default admin and not found
        const adminData: User = {
          username: 'admin',
          password: 'admin',
          name: 'المدير العام',
          role: 'admin',
          isPrimary: true,
          isActive: true
        };
        const docRef = doc(db, 'users', 'primary-admin');
        await setDoc(docRef, adminData);
        authenticatedUser = { ...adminData, id: 'primary-admin' };
      }

      if (!authenticatedUser) {
        if (isBiometric) {
          await clearBiometricCredentials();
          setError("بيانات البصمة المحفوظة غير متطابقة مع كلمة مرور الحساب الحالية (ربما تم تغييرها). يرجى تسجيل الدخول يدوياً أولاً.");
        } else {
          setError(t('login.invalid'));
        }
        setLoading(false);
        return;
      }

      // Strict Device Restriction Check for both manual and biometric logins
      const devCheck = await checkDeviceRestriction(authenticatedUser);
      if (!devCheck.allowed) {
        setError(devCheck.reason || "لا يمكنك تسجيل الدخول من هذا الجهاز.");
        setLoading(false);
        return;
      }

      // Auto-register biometric credentials on successful manual/biometric login if hardware is available
      try {
        const support = await checkBiometricSupport();
        let savedSettings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
        const isNotExplicitlyDisabled = savedSettings.biometricEnabled !== false;

        if (support.isAvailable && isNotExplicitlyDisabled) {
          savedSettings.biometricEnabled = true;
          localStorage.setItem('snd_settings', JSON.stringify(savedSettings));
          const regRes = await registerBiometricCredentials(authenticatedUser);
          if (regRes.success) {
            console.log("Biometric credentials successfully registered on this device for:", authenticatedUser.username);
            try {
              await localDb.run(
                `INSERT OR REPLACE INTO settings (id, data, updatedAt) VALUES (?, ?, ?)`,
                ['app', JSON.stringify(savedSettings), new Date().toISOString()]
              );
            } catch (dbErr) {}
          }
        }
      } catch (bioErr) {
        console.warn("Auto biometric registration warning:", bioErr);
      }

      onLogin(authenticatedUser);
    } catch (err: any) {
      console.error(err);
      setError(t('login.connError') + (err.message ? ` (${err.message})` : ''));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError(t('login.invalid'));
      return;
    }
    await authenticateUserAndVerifyAll(username, password, false);
  };

  const handleBiometricLogin = async () => {
    setError(null);
    
    // 1. Check if hardware / platform supports biometric
    const support = await checkBiometricSupport();
    if (!support.isAvailable) {
      setError(support.reason || "جهازك أو المتصفح لا يدعم التحقق بالبصمة الحيوية.");
      return;
    }

    let savedSettings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
    if (savedSettings.biometricEnabled === false) {
      setError("تسجيل الدخول بالبصمة معطّل في إعدادات الأمان.");
      return;
    }

    // 2. Check if biometric credentials have been registered for a user on this device
    const meta = getSavedBiometricMeta();
    if (!meta) {
      setError("لم يتم حفظ بصمة لأي حساب على هذا الهاتف بعد. يرجى كتابة اسم المستخدم وكلمة المرور والضغط على تسجيل الدخول مرة واحدة ليتم حفظ وتفعيل بصمتك على هذا الهاتف تلقائياً.");
      return;
    }

    setLoading(true);
    try {
      // 3. Prompt real hardware biometric verification (Native biometric prompt / WebAuthn)
      const authResult = await authenticateAndGetCredentials(
        `يرجى تأكيد بصمتك لتسجيل الدخول بحساب (${meta.name || meta.username})`
      );

      if (!authResult.success || !authResult.username || !authResult.password) {
        setError(authResult.error || "فشل التحقق من البصمة.");
        setLoading(false);
        return;
      }

      // 4. Pass credentials through unified strict security & device validation pipeline
      await authenticateUserAndVerifyAll(authResult.username, authResult.password, true);
    } catch (err: any) {
      console.error("Biometric login exception:", err);
      setError(err?.message || "فشل تسجيل الدخول بالبصمة.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      
      <div className="absolute top-6 right-6 z-20">
        <button 
          onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
          className="px-4 py-2 bg-[#1a1a1a] border border-white/5 rounded-xl font-bold hover:bg-white/5 transition-colors"
        >
          {i18n.language === 'ar' ? 'English' : 'العربية'}
        </button>
      </div>
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-[#1a1a1a] border border-white/5 rounded-3xl p-8 shadow-2xl relative z-10"
      >
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center shadow-xl shadow-orange-900/40">
             <Router className="text-white w-8 h-8" />
          </div>
          
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">SND System</h1>
            <p className="text-gray-400 text-sm">{t('login.prompt')}</p>
          </div>

          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <div className="text-left rtl:text-right space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase ml-1 rtl:ml-0 rtl:mr-1">{t('login.username')}</label>
              <div className="relative">
                <UserIcon className="absolute left-4 rtl:left-auto rtl:right-4 top-1/2 -translate-y-1/2 text-gray-600" size={18} />
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-4 rtl:pl-4 rtl:pr-12 py-3.5 focus:border-orange-500 outline-none transition-all"
                  placeholder="admin"
                />
              </div>
            </div>

            <div className="text-left rtl:text-right space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase ml-1 rtl:ml-0 rtl:mr-1">{t('login.password')}</label>
              <div className="relative">
                <Lock className="absolute left-4 rtl:left-auto rtl:right-4 top-1/2 -translate-y-1/2 text-gray-600" size={18} />
                <input 
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-12 rtl:pl-12 rtl:pr-12 py-3.5 focus:border-orange-500 outline-none transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 rtl:right-auto rtl:left-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 bg-red-600/10 border border-red-500/20 rounded-xl text-red-500 text-xs font-bold font-cairo text-right leading-relaxed"
                dir="rtl"
              >
                {error}
              </motion.div>
            )}

            {isBiometricEnabled && biometricMeta && isBiometricSupported && (
              <div className="p-2.5 bg-orange-600/5 border border-orange-500/10 rounded-xl flex items-center justify-between text-xs text-gray-400 font-cairo" dir="rtl">
                <span className="flex items-center gap-1.5 text-orange-400 font-bold">
                  <Fingerprint size={16} />
                  بصمة مسجلة:
                </span>
                <span className="text-white font-bold">{biometricMeta.name || biometricMeta.username}</span>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button 
                type="submit" 
                disabled={loading}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-orange-900/20 flex items-center justify-center gap-2 group disabled:opacity-50"
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : t('login.title')}
              </button>
              
              {isBiometricEnabled && isBiometricSupported && (
                <button 
                  type="button"
                  disabled={loading}
                  onClick={handleBiometricLogin}
                  className="px-5 bg-black/40 hover:bg-orange-600/10 border border-white/10 hover:border-orange-500/30 text-orange-500 rounded-2xl transition-all flex items-center justify-center shadow-lg active:scale-95 group disabled:opacity-50"
                  title={biometricMeta ? `تسجيل الدخول بالبصمة (${biometricMeta.name || biometricMeta.username})` : t('login.biometricLogin')}
                >
                  <Fingerprint size={24} className="group-hover:scale-110 transition-transform" />
                </button>
              )}
            </div>
          </form>

          <div className="pt-4 flex items-center gap-4 text-gray-600">
             <div className="w-8 h-[1px] bg-white/5"></div>
             <p className="text-[10px] font-bold uppercase tracking-widest">{t('login.authorized')}</p>
             <div className="w-8 h-[1px] bg-white/5"></div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
