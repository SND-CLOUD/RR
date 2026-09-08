import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';

export interface PickedContactData {
  name: string;
  phone: string;
}

export interface ContactPickerResponse {
  success: boolean;
  supported: boolean;
  contact?: PickedContactData;
  cancelled?: boolean;
  message?: string;
}

/**
 * Checks if the current platform/device can open the contact picker.
 */
export async function checkContactPickerSupport(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // 1. Native Capacitor platform (Android APK / iOS)
  if (Capacitor.isNativePlatform()) {
    return true;
  }

  // 2. Web Contact Picker API (Chrome on Android / Edge on Android)
  if ('contacts' in navigator && 'ContactsManager' in window) {
    return true;
  }

  // 3. Android WebView custom bridge if present
  if (typeof (window as any).AndroidContactPicker !== 'undefined') {
    return true;
  }

  return false;
}

/**
 * Launches the native or web contact picker to select a customer's name and phone number.
 */
export async function pickCustomerContact(): Promise<ContactPickerResponse> {
  try {
    const isCapacitorNative = Capacitor.isNativePlatform() || 
      (typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.getPlatform?.() === 'android');

    // A. Native Capacitor APK (Android)
    if (isCapacitorNative) {
      try {
        // Check / request permissions if needed
        try {
          const perm = await Contacts.checkPermissions();
          if (perm.contacts !== 'granted') {
            const req = await Contacts.requestPermissions();
            if (req.contacts !== 'granted') {
              return {
                success: false,
                supported: true,
                message: 'لم يتم منح إذن الوصول إلى جهات الاتصال. يرجى تفعيل إذن "جهات الاتصال" (Contacts) للتطبيق من إعدادات الهاتف.'
              };
            }
          }
        } catch (permErr: any) {
          console.warn('Capacitor checkPermissions error, attempting pickContact directly:', permErr);
        }

        const result = await Contacts.pickContact({
          projection: {
            name: true,
            phones: true
          }
        });

        if (result && result.contact) {
          const c = result.contact;
          const name = c.name?.display || 
            [c.name?.given, c.name?.middle, c.name?.family].filter(Boolean).join(' ') || 
            '';
          
          let rawPhone = '';
          if (c.phones && c.phones.length > 0) {
            const primaryPhone = c.phones.find((p: any) => p.isPrimary && p.number) || c.phones[0];
            rawPhone = primaryPhone?.number || '';
          }
          const cleanPhone = rawPhone.replace(/[\s\-\(\)]/g, '');

          if (!name && !cleanPhone) {
            return {
              success: false,
              supported: true,
              cancelled: true,
              message: 'تم إغلاق جهات الاتصال أو لا توجد بيانات مسجلة في جهة الاتصال المحددة.'
            };
          }

          return {
            success: true,
            supported: true,
            contact: {
              name: name.trim(),
              phone: cleanPhone.trim()
            }
          };
        }

        return {
          success: false,
          supported: true,
          cancelled: true
        };
      } catch (nativeErr: any) {
        const msg = String(nativeErr?.message || nativeErr || '');
        const lower = msg.toLowerCase();

        if (
          lower.includes('cancel') || 
          lower.includes('closed') ||
          lower.includes('dismiss') ||
          lower.includes('aborted') ||
          lower.includes('canceled') ||
          nativeErr?.code === '1'
        ) {
          return { success: false, supported: true, cancelled: true };
        }

        if (lower.includes('permission') || lower.includes('denied')) {
          return {
            success: false,
            supported: true,
            message: 'تم رفض إذن الوصول لجهات الاتصال. يرجى تفعيل إذن "جهات الاتصال" (Contacts) من: إعدادات الهاتف > التطبيقات > أذونات التطبيق.'
          };
        }

        return {
          success: false,
          supported: true,
          message: `تعذر جلب جهة الاتصال: ${msg || 'يرجى التأكد من صلاحيات التطبيق في الهاتف.'}`
        };
      }
    }

    // B. Web Contact Picker API (Android Chrome / Edge / PWA)
    if ('contacts' in navigator && 'ContactsManager' in window) {
      try {
        const props = await (navigator as any).contacts.getProperties?.() || ['name', 'tel'];
        const requestProps = ['name', 'tel'].filter((p: string) => props.includes(p));
        const contacts = await (navigator as any).contacts.select(
          requestProps.length > 0 ? requestProps : ['name', 'tel'],
          { multiple: false }
        );

        if (contacts && contacts.length > 0) {
          const c = contacts[0];
          const name = (c.name && c.name[0]) ? String(c.name[0]).trim() : '';
          const rawPhone = (c.tel && c.tel[0]) ? String(c.tel[0]).trim() : '';
          const cleanPhone = rawPhone.replace(/[\s\-\(\)]/g, '');

          return {
            success: true,
            supported: true,
            contact: {
              name,
              phone: cleanPhone
            }
          };
        }

        return {
          success: false,
          supported: true,
          cancelled: true
        };
      } catch (webErr: any) {
        if (webErr?.name === 'AbortError' || webErr?.message?.includes('abort') || webErr?.message?.includes('cancel')) {
          return { success: false, supported: true, cancelled: true };
        }
        console.warn('Web Contact Picker error:', webErr);
      }
    }

    // C. Android WebView Javascript Interface (if packaged with custom Android wrapper)
    if (typeof (window as any).AndroidContactPicker?.pickContact === 'function') {
      try {
        const res = await (window as any).AndroidContactPicker.pickContact();
        const parsed = typeof res === 'string' ? JSON.parse(res) : res;
        return {
          success: true,
          supported: true,
          contact: {
            name: (parsed.name || '').trim(),
            phone: (parsed.phone || parsed.tel || '').replace(/[\s\-\(\)]/g, '').trim()
          }
        };
      } catch (bridgeErr: any) {
        return { success: false, supported: true, message: bridgeErr?.message };
      }
    }

    // D. Not supported on this environment / device
    return {
      success: false,
      supported: false,
      message: 'هذه الخاصية تعمل تلقائياً على هواتف الأندرويد المدعومة (عند تشغيل البرنامج كتطبيق APK أو عبر متصفح Chrome للهاتف). المتصفح أو الجهاز الحالي لا يوفر صلاحية الوصول المباشر لسجل الهاتف، يرجى كتابة البيانات يدوياً.'
    };
  } catch (error: any) {
    return {
      success: false,
      supported: false,
      message: error?.message || 'حدث خطأ أثناء محاولة فتح جهات الاتصال.'
    };
  }
}
