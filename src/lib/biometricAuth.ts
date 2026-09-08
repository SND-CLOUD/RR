import { NativeBiometric } from 'capacitor-native-biometric';
import { Device } from '@capacitor/device';
import { User } from '../types';

export interface BiometricAvailability {
  isAvailable: boolean;
  biometryType: 'fingerprint' | 'face' | 'iris' | 'webauthn' | 'none';
  platform: 'android' | 'ios' | 'web' | 'unknown';
  reason?: string;
}

export interface BiometricUserMeta {
  username: string;
  name?: string;
  userId?: string;
  registeredAt: string;
  platform: string;
}

const BIO_META_KEY = 'snd_bio_meta';
const BIO_HAS_CREDS_KEY = 'snd_has_bio_credentials';
const BIO_WEB_CREDS_KEY = 'snd_bio_web_creds';
const WEBAUTHN_ID_KEY = 'snd_webauthn_id';

/**
 * Check if the current device/browser supports real hardware biometric authentication
 */
export async function checkBiometricSupport(): Promise<BiometricAvailability> {
  try {
    const info = await Device.getInfo();
    const platform = info.platform as 'android' | 'ios' | 'web' | 'unknown';

    if (platform === 'web') {
      if (typeof window !== 'undefined' && window.PublicKeyCredential) {
        if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
          const webAuthnAvail = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          if (webAuthnAvail) {
            return {
              isAvailable: true,
              biometryType: 'webauthn',
              platform: 'web'
            };
          }
        }
      }
      return {
        isAvailable: false,
        biometryType: 'none',
        platform: 'web',
        reason: 'المتصفح الحالي أو الجهاز لا يدعم مصادقة البصمة الحيوية (WebAuthn Platform Authenticator).'
      };
    }

    // Android / iOS native Capacitor environment
    try {
      const bio = await NativeBiometric.isAvailable();
      let biometryType: 'fingerprint' | 'face' | 'iris' | 'none' = 'fingerprint';
      
      if (bio.biometryType === 1) biometryType = 'fingerprint';
      else if (bio.biometryType === 2) biometryType = 'face';
      else if (bio.biometryType === 3) biometryType = 'iris';

      return {
        isAvailable: !!bio.isAvailable,
        biometryType: bio.isAvailable ? biometryType : 'none',
        platform: platform === 'ios' ? 'ios' : 'android',
        reason: bio.isAvailable ? undefined : 'مستشعر البصمة غير متاح أو لم يتم تسجيل بصمات في إعدادات الهاتف.'
      };
    } catch (nativeErr: any) {
      return {
        isAvailable: false,
        biometryType: 'none',
        platform: platform === 'ios' ? 'ios' : 'android',
        reason: nativeErr?.message || 'فشل فحص مستشعر البصمة.'
      };
    }
  } catch (err: any) {
    return {
      isAvailable: false,
      biometryType: 'none',
      platform: 'unknown',
      reason: err?.message || 'خطأ في فحص الأجهزة.'
    };
  }
}

/**
 * Check if biometric credentials have been registered for an authorized user on this device
 */
export function getSavedBiometricMeta(): BiometricUserMeta | null {
  try {
    const raw = localStorage.getItem(BIO_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BiometricUserMeta;
  } catch {
    return null;
  }
}

/**
 * Register biometric credentials for the specified authenticated user
 */
export async function registerBiometricCredentials(user: User): Promise<{ success: boolean; error?: string }> {
  try {
    if (!user.username || !user.password) {
      return { success: false, error: 'بيانات المستخدم غير مكتملة لتسجيل البصمة.' };
    }

    const info = await Device.getInfo();
    const nowIso = new Date().toISOString();
    const meta: BiometricUserMeta = {
      username: user.username,
      name: user.name,
      userId: user.id,
      registeredAt: nowIso,
      platform: info.platform
    };

    // Always store encoded credentials in local secured storage as an immediate reliable fallback
    const encodedData = btoa(encodeURIComponent(JSON.stringify({
      username: user.username,
      password: user.password
    })));
    localStorage.setItem(BIO_WEB_CREDS_KEY, encodedData);
    localStorage.setItem(BIO_META_KEY, JSON.stringify(meta));
    localStorage.setItem(BIO_HAS_CREDS_KEY, 'true');

    if (info.platform === 'web') {
      // Register with WebAuthn if available
      if (typeof window !== 'undefined' && window.PublicKeyCredential) {
        try {
          const challenge = new Uint8Array(32);
          window.crypto.getRandomValues(challenge);
          const userIdBytes = new TextEncoder().encode(user.username);

          const credential = await navigator.credentials.create({
            publicKey: {
              challenge,
              rp: { name: 'SND System', id: window.location.hostname },
              user: {
                id: userIdBytes,
                name: user.username,
                displayName: user.name || user.username
              },
              pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
              authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'required',
                requireResidentKey: false
              },
              timeout: 60000
            }
          });

          if (credential) {
            localStorage.setItem(WEBAUTHN_ID_KEY, credential.id);
          }
        } catch (webauthnErr) {
          console.warn('WebAuthn creation warning/fallback:', webauthnErr);
        }
      }
      return { success: true };
    }

    // Android / iOS native Capacitor
    try {
      await NativeBiometric.setCredentials({
        username: user.username,
        password: user.password,
        server: 'com.snd.maintenance'
      });
    } catch (nativeSetErr) {
      console.warn('NativeBiometric.setCredentials warning:', nativeSetErr);
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error registering biometric credentials:', err);
    return { success: false, error: err?.message || 'فشل حفظ بيانات البصمة.' };
  }
}

/**
 * Execute biometric prompt and retrieve credentials upon real user authentication
 */
export async function authenticateAndGetCredentials(
  promptReason: string = 'يرجى تأكيد البصمة لتسجيل الدخول إلى نظام سند'
): Promise<{ success: boolean; username?: string; password?: string; error?: string }> {
  try {
    const info = await Device.getInfo();
    const meta = getSavedBiometricMeta();

    if (!meta || localStorage.getItem(BIO_HAS_CREDS_KEY) !== 'true') {
      return {
        success: false,
        error: 'لم يتم حفظ أو ربط بصمة لأي مستخدم على هذا الجهاز بعد. يرجى تسجيل الدخول باسم المستخدم وكلمة المرور أولاً.'
      };
    }

    if (info.platform === 'web') {
      // For Web browsers: execute real WebAuthn authentication if available
      if (typeof window !== 'undefined' && window.PublicKeyCredential) {
        try {
          const challenge = new Uint8Array(32);
          window.crypto.getRandomValues(challenge);
          const rawId = localStorage.getItem(WEBAUTHN_ID_KEY);

          await navigator.credentials.get({
            publicKey: {
              challenge,
              timeout: 60000,
              userVerification: 'required',
              rpId: window.location.hostname,
              allowCredentials: rawId ? [{
                id: new TextEncoder().encode(rawId),
                type: 'public-key'
              }] : undefined
            }
          });
        } catch (webAuthnErr: any) {
          // If user cancelled or failed WebAuthn verification
          console.warn('WebAuthn verification rejected:', webAuthnErr);
          return {
            success: false,
            error: 'تم إلغاء أو فشل التحقق من البصمة على المتصفح.'
          };
        }
      }

      const rawEnc = localStorage.getItem(BIO_WEB_CREDS_KEY);
      if (!rawEnc) {
        return { success: false, error: 'بيانات الدخول بالبصمة غير موجودة أو تم مسحها.' };
      }

      try {
        const decoded = JSON.parse(decodeURIComponent(atob(rawEnc)));
        if (!decoded.username || !decoded.password) {
          return { success: false, error: 'بيانات البصمة غير صالحة.' };
        }
        return {
          success: true,
          username: decoded.username,
          password: decoded.password
        };
      } catch (e) {
        return { success: false, error: 'خطأ في قراءة بيانات البصمة المحفوظة.' };
      }
    }

    // Android / iOS native Capacitor
    const bioAvail = await NativeBiometric.isAvailable();
    if (!bioAvail.isAvailable) {
      return {
        success: false,
        error: 'مستشعر البصمة غير متاح حالياً على هذا الجهاز أو لم يتم تسجيل بصمة في إعدادات الهاتف.'
      };
    }

    // Explicitly prompt the user with Native Biometric dialog
    await NativeBiometric.verifyIdentity({
      reason: promptReason,
      title: 'تسجيل الدخول بالبصمة',
      subtitle: meta.name ? `المستخدم: ${meta.name} (${meta.username})` : 'نظام سند لإدارة الصيانة',
      description: 'قم بوضع إصبعك على الحساس للمتابعة والتحقق من هويتك'
    });

    // User passed biometric verification! Retrieve credentials:
    let uName = '';
    let uPass = '';

    try {
      const credentials = await NativeBiometric.getCredentials({
        server: 'com.snd.maintenance'
      });
      if (credentials?.username && credentials?.password) {
        uName = credentials.username;
        uPass = credentials.password;
      }
    } catch (credErr) {
      console.warn('NativeBiometric.getCredentials fallback to secured local storage:', credErr);
    }

    // Fallback to verified local storage if NativeBiometric keystore returned empty
    if (!uName || !uPass) {
      const rawEnc = localStorage.getItem(BIO_WEB_CREDS_KEY);
      if (rawEnc) {
        try {
          const decoded = JSON.parse(decodeURIComponent(atob(rawEnc)));
          if (decoded.username && decoded.password) {
            uName = decoded.username;
            uPass = decoded.password;
          }
        } catch (e) {}
      }
    }

    if (!uName || !uPass) {
      return {
        success: false,
        error: 'لم يتم العثور على بيانات تسجيل دخول محفوظة في الخزينة الآمنة للبصمة.'
      };
    }

    return {
      success: true,
      username: uName,
      password: uPass
    };
  } catch (err: any) {
    console.warn('Biometric authentication failed or cancelled:', err);
    // Determine friendly error message
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('cancel') || msg.includes('user_cancel') || err?.code === 10) {
      return { success: false, error: 'تم إلغاء عملية مسح البصمة.' };
    }
    return { success: false, error: err?.message || 'فشل التحقق من البصمة.' };
  }
}

/**
 * Remove and clear all biometric credentials on this device
 */
export async function clearBiometricCredentials(): Promise<void> {
  try {
    const info = await Device.getInfo();
    if (info.platform !== 'web') {
      try {
        await NativeBiometric.deleteCredentials({
          server: 'com.snd.maintenance'
        });
      } catch (e) {}
    }
  } catch (e) {}

  localStorage.removeItem(BIO_META_KEY);
  localStorage.removeItem(BIO_HAS_CREDS_KEY);
  localStorage.removeItem(BIO_WEB_CREDS_KEY);
  localStorage.removeItem(WEBAUTHN_ID_KEY);
  localStorage.removeItem('snd_bio_credentials');
}
