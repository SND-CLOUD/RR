# وثيقة التوثيق التقني الشاملة للنظام (System Technical Documentation)

**اسم المشروع:** نظام إدارة الصيانة والحسابات والمخزون المتقدم (Maintenance, Accounting & Inventory System)  
**إصدار الوثيقة:** 2.0.0 (المحدث والمطابق لكامل النظام)  
**تاريخ التوثيق:** سبتمبر 2026  
**نطاق الوثيقة:** التوثيق التقني الشامل للهندسة المعمارية، المكونات، قواعد البيانات (25 جدولاً)، الدورات المستندية، العمليات المالية، محركات التدقيق والإصلاح، وحوكمة الصلاحيات والأمان.

---

## 1. مكونات المشروع (Project Components)

### 1.1 التقنيات الأساسية (Core Technologies)
* **واجهة المستخدم (Frontend Framework):** React 19.0.0 مع TypeScript 5.8.2 لتطوير واجهات تفاعلية عالية الأداء ومعتمدة على الأنماط الصارمة للأنواع (Strict Typing).
* **أداة البناء (Build Tool & Bundler):** Vite 6.2.0 لسرعة التجميع وتجهيز حزم الإنتاج المتقدمة.
* **إطار التطبيق الهجين / الهاتف المحمول (Mobile & Cross-Platform Runtime):** Capacitor 8.0.0 (تشمل `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/filesystem`).
* **المصادقة البيومترية للأجهزة الذكية (Biometrics):** `capacitor-native-biometric` 8.0.0 للمصادقة عبر بصمة الإصبع وبصمة الوجه.
* **محرك قواعد البيانات المحلي (Local SQLite Database):** `@capacitor-community/sqlite` 7.0.0 مع دعم `sql.js` 1.12.0 للعمل على البيئة المتصفحية (Web/PWA).
* **محرك قواعد البيانات السحابي (Cloud Database):** Firebase Firestore Web SDK 12.0.0.
* **التصميم والأنماط (Styling):** Tailwind CSS 4.0.9 لتصميم واجهات عصرية ومتجاوبة بالكامل.
* **الخادم البرمجي وخادم التطوير (Server & Runtime):** Express 4.21.2 مع `tsx` للتشغيل المحلي المدمج للباك إند و `esbuild` لتجميع الإنتاج.
* **محرك اللغات والتدويل (Internationalization):** `i18next` 24.2.2 و `react-i18next` 15.4.0 ودعم كامل للغة العربية والإنجليزية والترجمة الفورية.

---

### 1.2 المكتبات المساعدة (Libraries & Utilities)
* **الأيقونات والتصاميم (Icons):** `lucide-react` 0.475.0.
* **الحركات والمؤثرات (Animations):** `motion` 12.4.7 (مستوردة من `motion/react`).
* **الرسوم البيانية والتقارير (Charts & Analytics):** `recharts` 2.15.1.
* **معالجة وتصدير المستندات (PDF & Canvas Export):** `jspdf` 3.0.0, `html2canvas` 1.4.1, `html-to-image` 1.11.11.
* **التفقيت المالي باللغة العربية (Arabic Currency Words):** `tafqeet` 1.1.2.
* **مساعدة التشارك والتواصل (Sharing Helpers):** Web Share API integration, WhatsApp Web/API messaging.

---

### 1.3 هيكل المجلدات والملفات (Folder & File Structure)

```
├── .env.example                     # نموذج متغيرات البيئة
├── firestore.rules                  # قواعد أمان وسماحيات Firebase Firestore
├── index.html                       # الملف الرئيسي للمتصفح (Single Page App Entry)
├── metadata.json                    # وصف ومعلومات وصلاحيات الإطار (App Metadata)
├── package.json                     # قائمة المكتبات والبرامج وسكريبتات البناء
├── server.ts                        # خادم Express ومُشغّل الخادم المدمج
├── vite.config.ts                   # إعدادات أداة التجميع Vite
│
├── public/                          # الملفات والأصول العامة (الصور، الأيقونات)
│
└── src/                             # شفرة المصدر البرمجية
    ├── App.tsx                      # المكون الرئيسي للتوجه وإدارة الحالة العالمية والروابط
    ├── main.tsx                     # نقطة الانطلاق الرئيسية لتطبيق React
    ├── index.css                    # استيراد أنماط Tailwind CSS العامة
    ├── types.ts                     # الأنواع والواجهات الشاملة (Interfaces & Types)
    │
    ├── components/                  # الواجهات والمكونات التشغيلية
    │   ├── AccountingInputs.tsx     # مدخلات البيانات المالية الرئيسية (العملات، الصناديق، طرق الدفع)
    │   ├── AddCustomerModal.tsx     # نافذة إضافة عميل جديد
    │   ├── BankAccountsFooter.tsx   # شريط عرض واستعلام أرصدة الحسابات والصناديق
    │   ├── CategoriesTable.tsx      # جدول إدارة تصنيفات الأجهزة
    │   ├── CustomerAutocomplete.tsx  # الإكمال التلقائي للبحث عن العملاء
    │   ├── Customers.tsx            # صفحة إدارة العملاء وكشوفات الحساب
    │   ├── Dashboard.tsx            # لوحة المؤشرات والإحصاءات التشغيلية السريعة
    │   ├── DataAuditModal.tsx       # مركز تدقيق ومطابقة سلامة البيانات المالية وإصلاح الفروقات
    │   ├── DeviceManagement.tsx     # حوكمة وتصحيح وإدارة مسارات الأجهزة والتسليم
    │   ├── DeviceStatisticalSummaryModal.tsx # نافذة الإحصائيات الشاملة ومؤشرات أداء الأجهزة
    │   ├── EngineersTable.tsx       # جدول إدارة بيانات وخبرات المهندسين
    │   ├── FinancialReportsTab.tsx  # تبويب التقارير المالية المتخصصة والمطابقات
    │   ├── Inventory.tsx            # إدارة قطع الغيار والمخزون الموحد
    │   ├── Login.tsx                # صفحة تسجيل الدخول والتحقق من المستخدمين والأجهزة والبيومترية
    │   ├── MaintenanceActionForm.tsx # نموذج تسجيل الإجراءات الفنية وقطع الغيار
    │   ├── OtherServiceInvoice.tsx  # فاتورة الخدمات الخارجية والمستقلة
    │   ├── PartsAutocomplete.tsx    # الإكمال التلقائي الذكي لقطع الغيار
    │   ├── PartsCatalogTable.tsx    # كتالوج قطع الغيار المرجعية المعتمدة
    │   ├── PrintPreviewOverlay.tsx  # شاشة طباعة وتصدير المستندات والسندات وأرشفة الـ PDF
    │   ├── ReportActions.tsx        # أزرار وإجراءات طباعة وتصدير التقارير
    │   ├── Reports.tsx              # صفحة التقارير المالية والإدارية الشاملة
    │   ├── SearchInvoice.tsx        # البحث المتقدم عن الفواتير واستكمال الدفع
    │   ├── SecurityGuard.tsx        # حارس الأمان اللحظي لمراقبة حالة الأجهزة والجلسات
    │   ├── Settings.tsx             # إعدادات النظام المتقدمة، الإدارة المتقدمة، والنسخ الاحتياطي
    │   ├── SetupWizard.tsx          # معالج الإعداد الأولي للنظام والشركات
    │   ├── ShopPartsStockView.tsx   # إدارة مخزون قطع ورشة الصيانة ولوطات التفكيك (التشليح)
    │   ├── UserManagement.tsx       # إدارة المستخدمين، الأدوار، والأجهزة المعتمدة
    │   ├── Vault.tsx                # صفحة الخزنة/الصندوق وسندات القبض والصرف والتحويل
    │   │
    │   ├── entry-exit/              # مكونات الدخول والخروج الخاصة
    │   │   ├── DeviceEntry.tsx      # صفحة استقبال وأمر دخول الأجهزة للصيانة
    │   │   ├── DeviceExit.tsx       # صفحة تسليم الأجهزة وخروجها والتحصيل المالي
    │   │   └── index.tsx            # المجمّع الموحد للدخول والخروج
    │   │
    │   └── movement/                # مسارات حركة الصيانة المتقدمة
    │       ├── ApprovalAndParts.tsx # مرحلة موافقات العملاء وقطع الغيار
    │       ├── Inspection.tsx       # مرحلة الفحص والتشخيص الفني
    │       ├── Maintenance.tsx      # مرحلة تنفيذ عمليات الصيانة
    │       └── index.tsx            # المجمّع الموحد لحركة الأجهزة
    │
    ├── data/                        # طبقة مزودي قواعد البيانات والمزامنة
    │   ├── IDataProvider.ts         # الواجهة البرمجية الموحدة لمزود البيانات
    │   ├── LocalProvider.ts         # مزود قواعد البيانات المحلية (SQLite)
    │   ├── FirebaseProvider.ts      # مزود قواعد البيانات السحابية (Firestore)
    │   ├── ProviderFactory.ts       # مصنع اختيار المزود النشط (Local / Cloud / Auto)
    │   └── SyncEngine.ts            # محرك المزامنة الخلفية ونمط الصندوق الصادر مع التحديث الصامت
    │
    ├── hooks/                       # الخُطافات البرمجية المخصصة (Custom Hooks)
    │   ├── useBackHandler.ts        # معالجة زر العودة للموبايل والأجهزة الذكية
    │   └── usePermissions.ts        # التحقق التلقائي من صلاحيات المستخدم الحالي
    │
    └── lib/                         # المكتبات والخدمات المساعدة (Utilities & Services)
        ├── backup.ts                # محرك النسخ الاحتياطي والتصدير والاسترجاع
        ├── biometricAuth.ts         # خدمة التحقق والمصادقة البيومترية (بصمة الإصبع/الوجه)
        ├── contactPicker.ts         # خدمة جلب جهات الاتصال مباشرة من هاتف العميل
        ├── dateUtils.ts             # معالجة وتنسيق التواريخ والوقت
        ├── db-bridge.ts             # الجسر الموحد للاتصال بقواعد البيانات
        ├── error-handler.ts         # معالج أخطاء Firestore والعمليات
        ├── fundRepairService.ts     # خدمة التدقيق والإصلاح التلقائي لأرصدة الخزائن والصناديق
        ├── fundUtils.ts             # أدوات معالجة وحساب أرصدة الصناديق
        ├── html2canvasHelper.ts     # تحسين أداء وتنسيقات طباعة أجزاء الشاشة
        ├── i18n.ts                  # تهيئة خيارات الترجمة واللغات
        ├── invoiceCascadeService.ts # خدمة المعالجة المتسلسلة لحذف وتعديل الفواتير والسندات
        ├── local-db.ts              # إنشاء وتهيئة وهيكلة جداول SQLite الـ 25
        ├── shareHelper.ts           # أدوات مشاركة الملفات وواتساب
        └── tafqeet.ts               # تحويل الأرقام المالية إلى كلمات عربية
```

---

### 1.4 طبقات التطبيق (Application Layers)

1. **طبقة العرض والواجهات (Presentation Layer):**
   تتكون من مكونات React مع Tailwind CSS و Motion. تعتمد على النمط التفاعلي المباشر وتدعم الإكمال التلقائي، النوافذ المنبثقة، ومعاينة الطباعة والأرشفة، وتتميز بالحماية ضد فقدان المدخلات (`Form Dirty State`) والتحديث الصامت في الخلفية.

2. **طبقة منطق الأعمال والخدمات المحاسبية (Business Logic & Core Services Layer):**
   تتضمن التحقق من الصلاحيات عبر `usePermissions`، ومحرك التدقيق المحاسبي `fundRepairService`، والخدمة المتسلسلة `invoiceCascadeService`، والمصادقة البيومترية `biometricAuth`، وقواعد الحسابات المالية والذمم.

3. **طبقة الجسر والمزودات (Data Access & Bridge Layer):**
   تستخدم `db-bridge.ts` للربط بـ `ProviderFactory.ts`. تضمن هذه الطبقة تجريد نوع قاعدة البيانات المستعملة وتدعم أنماط `LOCAL` و `CLOUD` و `AUTO`.

4. **طبقة التخزين المزدوجة والمزامنة الصامتة (Storage & Silent Sync Layer):**
   * **المحلي (Local):** قاعدة بيانات SQLite متكاملة تشتمل على 25 جدولاً تعمل هجينياً عبر المحاكي المباشر في المتصفح وأجهزة المحمول.
   * **السحابي (Cloud):** مجموعات Firestore Collections مع قواعد أمان متقدمة.
   * **محرك المزامنة (Sync Engine):** يعتمد على نمط الصندوق الصادر `outbox` لمعالجة التغييرات بالترتيب (FIFO) مع تحديث الواجهات بصمت (`Silent Refresh`) دون قطع تجربة المستخدم.

---

## 2. صفحات البرنامج وحصر الوظائف الشامل (System Pages Inventory)

| # | اسم الصفحة / المكون | المسار / الكود | الوظيفة التقنية والتفصيلية |
|---|---|---|---|
| 1 | **تسجيل الدخول والمصادقة** | `Login.tsx` | التحقق من المستخدم، المصادقة البيومترية (البصمة/الوجه عبر `biometricAuth.ts`)، والتحقق من حالة الجهاز المصرح به (Device UUID / IMEI). |
| 2 | **لوحة التحكم الموحدة** | `Dashboard.tsx` / `App.tsx` | ملخص مؤشرات الأداء (عدد الأجهزة، الإيرادات، الأجهزة الجاهزة، التنبيهات)، شريط الأرصدة البنكية والمشغلات السريعة. |
| 3 | **استقبال ودخول الأجهزة** | `entry-exit/DeviceEntry.tsx` | تسجيل دخول أجهزة جديدة، جلب العميل من دفتر الهاتف (`contactPicker.ts`)، تحديد العطل والملحقات، وتوليد الفاتورة التسلسلية. |
| 4 | **تسليم وخروج الأجهزة** | `entry-exit/DeviceExit.tsx` | استعراض الأجهزة الجاهزة، احتساب الحساب النهائي، سداد الدفعات وتحديث الصناديق ذرياً، وإصدار أوامر التسليم. |
| 5 | **إدارة وحركة الأجهزة** | `DeviceManagement.tsx` | المتابعة المركزية لمسار الصيانة، التعديل الاستثنائي للحالات، مع عكس القيود المالية تلقائياً عند إعادة فتح جهاز مسلّم. |
| 6 | **الإحصائيات الشاملة للأجهزة** | `DeviceStatisticalSummaryModal.tsx` | نافذة تحليلية متقدمة لعرض الإحصاءات التراكمية، ومؤشرات الأداء للمهندسين ونسب إنجاز الأجهزة. |
| 7 | **الفحص والتشخيص الفني** | `movement/Inspection.tsx` | تسجيل نتائج الفحص والتشخيص للمهندس، تحديد القطع التالفة، وتحديث الحالة إلى (20 - قيد الفحص). |
| 8 | **الموافقات وقطع الغيار** | `movement/ApprovalAndParts.tsx` | إدارة انتظار موافقة العميل (حالة 30) أو انتظار توفير قطع الغيار (حالة 35)، وطلب القطع من المخزن. |
| 9 | **تنفيذ الصيانة الفنية** | `movement/Maintenance.tsx` | تسجيل الإجراءات التنفيذية والقطع المستهلكة عبر `MaintenanceActionForm.tsx` ونقل الجهاز إلى (50 - جاهز للتسليم). |
| 10 | **إدارة العملاء والذمم** | `Customers.tsx` | إدارة بيانات العملاء، كشوفات الحساب التفصيلية بكل عملة، تتبع الذمم والديون، وتصدير ومشاركة الكشوفات. |
| 11 | **الحسابات والخزنة** | `Vault.tsx` | إدارة الخزائن والصناديق، تحرير سندات القبض والصرف والتحويل، معالجة فروق العملات، مع الحماية الكاملة للمدخلات من المسح التلقائي. |
| 12 | **مدخلات الحسابات والبيانات** | `AccountingInputs.tsx` | تعريف وتحديث بيانات الصناديق (`fin_funds`)، العملات (`fin_currencies`)، أنواع المعاملات (`fin_transaction_types`)، وطرق الدفع. |
| 13 | **مركز تدقيق ومطابقة البيانات** | `DataAuditModal.tsx` | الفحص الآلي والشامل لسلامة البيانات المحاسبية، كشف الفروقات بين الفواتير وسندات القبض، واستدعاء خدمة إصلاح الصناديق `fundRepairService`. |
| 14 | **المخزون العام وقطع الغيار** | `Inventory.tsx` | الشاشة الرئيسية للمخزون التي تضم تبويبات قطع الغيار، وكتالوج القطع، ومخزون الورشة ولوطات التفكيك. |
| 15 | **كتالوج قطع الغيار المعتمد** | `PartsCatalogTable.tsx` | إدارة الدليل المرجعي الموحد لقطع الغيار والتكلفة الافتراضية وسعر البيع المقترح. |
| 16 | **مخزون ورشة الصيانة والتشليح** | `ShopPartsStockView.tsx` | إدارة المخزون التفصيلي لقطع الصيانة، ونظام لوطات التفكيك (التشليح `disassembly_batches`) ومتابعة استرداد تكلفة اللوطات. |
| 17 | **التقارير الإدارية والمالية** | `Reports.tsx` | تقارير حركة الإيرادات، المصروفات، الأرباح، أرصدة الخزائن، والديون المعلقة. |
| 18 | **التقارير المالية المتخصصة** | `FinancialReportsTab.tsx` | تبويب مالي مخصص لعرض حركة النقدية، التدفقات اليومية، تفاصيل السندات، ومطابقة الصناديق. |
| 19 | **فواتير الخدمات الأخرى** | `OtherServiceInvoice.tsx` | إصدار فواتير بيع قطع غيار مباشرة أو خدمات برمجية خارجية دون الحاجة لاستلام جهاز صيانة. |
| 20 | **إصدار وأرشفة المستندات** | `PrintPreviewOverlay.tsx` | شاشة معاينة وطباعة الفواتير والسندات، التصدير لـ PDF وتخزين النسخ في جدول `saved_pdfs` ومشاركتها عبر الواتساب. |
| 21 | **البحث والاستعلام المالي** | `SearchInvoice.tsx` | محرك بحث مخصص برقم الفاتورة أو اسم العميل، عرض تفاصيل الفاتورة، واستكمال الدفع المالي وسداد المتبقي. |
| 22 | **تصنيفات الأجهزة** | `CategoriesTable.tsx` | إدارة أنواع وتصنيفات الأجهزة المعتمدة للنظام (هواتف، لابتوبات، شاشات، إلخ) وموديلاتها. |
| 23 | **بيانات المهندسين** | `EngineersTable.tsx` | إدارة قائمة الفنيين والمهندسين، التخصصات، وتوزيع المهام. |
| 24 | **إدارة المستخدمين والأجهزة** | `UserManagement.tsx` | إدارة حسابات الموظفين، تحديد الصلاحيات (`AppPermissions`)، وإدارة قائمة الأجهزة المصرح لها بالاتصال. |
| 25 | **حارس الأمان والجلسات** | `SecurityGuard.tsx` | مكون أمني نشط في الخلفية لمراقبة حالة الجهاز المصرح به لحظياً وفصل الجلسة فوراً عند التجميد أو الحظر. |
| 26 | **إعدادات النظام المتقدمة** | `Settings.tsx` | ضبط هوية الشركة، إدارة أوضاع قواعد البيانات، النسخ الاحتياطي، وفحص وتدقيق النظام. |

---

## 3. قواعد البيانات والمخطط الشامل للـ 25 جدولاً (Database & 25-Table Schema Specification)

### 3.1 أوضاع قاعدة البيانات (Database Operating Modes)
يدعم النظام ثلاثة أوضاع حصرية عبر `ProviderFactory.ts`:
1. **`LOCAL` (محلي):** الاعتماد الكلي على محرك SQLite الداخلي.
2. **`CLOUD` (سحابي):** الاتصال المباشر بمجموعات Firebase Firestore.
3. **`AUTO` (تلقائي هجين - الافتراضي):** القراءة والكتابة محلياً بسرعة فائقة، مع تسجيل التغييرات في جدول `outbox` ليقوم محرك المزامنة `SyncEngine` بمزامنتها سحابياً تلقائياً مع تحديث الواجهات بصمت.

---

### 3.2 الحصر الشامل لجميع الجداول الـ 25 (Full 25-Table Breakdown)

يتم تعريف وهيكلة الجداول بالكامل في ملف `/src/lib/local-db.ts`:

#### 1. جدول المسميات الوظيفية (`job_titles`)
* **الحقول:** `id` (PK, TEXT), `name` (TEXT, UNIQUE), `description` (TEXT), `createdAt` (TEXT).

#### 2. جدول المستخدمين (`users`)
* **الحقول:** `id` (PK, TEXT), `username` (TEXT, UNIQUE), `password` (TEXT), `name` (TEXT), `role` (TEXT), `userNumber` (INTEGER), `permissions` (TEXT - JSON), `jobTitleId` (TEXT), `isPrimary` (INTEGER, DEFAULT 0), `createdAt` (TEXT), `updatedAt` (TEXT).

#### 3. جدول إعدادات النظام (`settings`)
* **الحقول:** `id` (PK, TEXT), `key` (TEXT, UNIQUE), `value` (TEXT), `updatedAt` (TEXT).

#### 4. جدول بيانات الشركة / الورشة (`company_details`)
* **الحقول:** `id` (PK, TEXT), `name` (TEXT), `logo` (TEXT), `phone1` (TEXT), `phone2` (TEXT), `address` (TEXT), `terms` (TEXT), `headerText` (TEXT), `footerText` (TEXT).

#### 5. جدول العملاء (`customers`)
* **الحقول:** `id` (PK, TEXT), `customerNumber` (INTEGER), `name` (TEXT), `companyName` (TEXT), `phone1` (TEXT), `phone2` (TEXT), `email` (TEXT), `address` (TEXT), `notes` (TEXT), `liabilityCurrency` (TEXT, DEFAULT 'USD'), `createdAt` (TEXT), `updatedAt` (TEXT).

#### 6. جدول الفواتير الرئيسية (`invoices`)
* **الحقول:** `id` (PK, TEXT), `invoiceNumber` (TEXT, UNIQUE), `customerId` (TEXT, FK -> customers.id), `customerName` (TEXT), `currency` (TEXT, DEFAULT 'USD'), `totalCost` (REAL, DEFAULT 0), `amountPaid` (REAL, DEFAULT 0), `discount` (REAL, DEFAULT 0), `tax` (REAL, DEFAULT 0), `status` (TEXT: 10, 20, 30, 35, 40, 50, 60, 70), `notes` (TEXT), `cancelReason` (TEXT), `deliveryDate` (TEXT), `createdAt` (TEXT), `updatedAt` (TEXT).

#### 7. جدول بنود الفواتير والأجهزة (`invoice_items`)
* **الحقول:** `id` (PK, TEXT), `invoiceId` (TEXT, FK -> invoices.id), `invoiceNumber` (TEXT), `customerId` (TEXT), `customerName` (TEXT), `deviceType` (TEXT), `deviceName` (TEXT), `serialNumber` (TEXT), `faultType` (TEXT), `technician` (TEXT), `quantity` (INTEGER, DEFAULT 1), `unitCost` (REAL, DEFAULT 0), `cost` (REAL, DEFAULT 0), `status` (TEXT), `subStatus` (TEXT), `engineerReport` (TEXT), `failureReason` (TEXT), `createdAt` (TEXT), `updatedAt` (TEXT).

#### 8. جدول حركة الحسابات والخزنة (`vault_transactions`)
* **الحقول:** `id` (PK, TEXT), `voucherNumber` (INTEGER), `type` (TEXT: receipt, payment), `transactionCategory` (TEXT), `amount` (REAL), `currency` (TEXT), `liabilityCurrency` (TEXT), `liabilityAmount` (REAL), `fundId` (TEXT, FK -> fin_funds.id), `fundName` (TEXT), `customerId` (TEXT), `customerName` (TEXT), `invoiceNumber` (TEXT), `linkedTxId` (TEXT), `userName` (TEXT), `userNumber` (INTEGER), `userId` (TEXT), `isReversed` (INTEGER, DEFAULT 0), `isReversal` (INTEGER, DEFAULT 0), `reversalOf` (TEXT), `bankDetails` (TEXT), `statementNote` (TEXT), `timestamp` (TEXT), `updatedAt` (TEXT).

#### 9. جدول الإجراءات الفنية للصيانة (`maintenance_actions`)
* **الحقول:** `id` (PK, TEXT), `itemId` (TEXT, FK -> invoice_items.id), `action` (TEXT), `technicianName` (TEXT), `cost` (REAL, DEFAULT 0), `createdAt` (TEXT).

#### 10. جدول عناصر قطع الغيار والمخزون العام (`inventory_items`)
* **الحقول:** `id` (PK, TEXT), `code` (TEXT, UNIQUE), `name` (TEXT), `category` (TEXT), `quantity` (INTEGER, DEFAULT 0), `minQuantity` (INTEGER, DEFAULT 5), `purchasePrice` (REAL), `sellingPrice` (REAL), `supplier` (TEXT), `createdAt` (TEXT), `updatedAt` (TEXT).

#### 11. جدول تصنيفات الأجهزة (`device_categories`)
* **الحقول:** `id` (PK, TEXT), `name` (TEXT, UNIQUE), `icon` (TEXT), `createdAt` (TEXT).

#### 12. جدول موديلات الأجهزة (`device_models`)
* **الحقول:** `id` (PK, TEXT), `categoryId` (TEXT, FK -> device_categories.id), `name` (TEXT), `createdAt` (TEXT).

#### 13. جدول بيانات المهندسين (`engineers`)
* **الحقول:** `id` (PK, TEXT), `name` (TEXT), `specialties` (TEXT), `phone` (TEXT), `createdAt` (TEXT).

#### 14. جدول إجراءات الموافقات والقطع (`approval_actions`)
* **الحقول:** `id` (PK, TEXT), `itemId` (TEXT, FK -> invoice_items.id), `approvalStatus` (TEXT), `notes` (TEXT), `createdAt` (TEXT).

#### 15. جدول أنواع المعاملات المالية (`fin_transaction_types`)
* **الحقول:** `id` (PK, TEXT), `name` (TEXT, UNIQUE), `type` (TEXT: receipt, payment).

#### 16. جدول الأجهزة المعتمدة والمصرح لها (`user_devices`)
* **الحقول:** `id` (PK, TEXT), `linkedUserId` (TEXT, FK -> users.id), `linkedUserName` (TEXT), `deviceName` (TEXT), `serialImei` (TEXT, UNIQUE), `status` (TEXT: active, frozen, blocked), `isFrozen` (INTEGER, DEFAULT 0), `lastLogin` (TEXT), `lastLogout` (TEXT), `createdAt` (TEXT), `updatedAt` (TEXT).

#### 17. جدول الصناديق والحسابات المالية (`fin_funds`)
* **الحقول:** `id` (PK, TEXT), `name` (TEXT, UNIQUE), `type` (TEXT: cash, bank), `currency` (TEXT), `balance` (REAL, DEFAULT 0), `status` (TEXT, DEFAULT 'active'), `createdAt` (TEXT).

#### 18. جدول العملات المتداولة (`fin_currencies`)
* **الحقول:** `id` (PK, TEXT), `name` (TEXT, UNIQUE), `symbol` (TEXT), `decimals` (INTEGER, DEFAULT 2), `status` (TEXT, DEFAULT 'active').

#### 19. جدول طرق الدفع (`fin_payment_methods`)
* **الحقول:** `id` (PK, TEXT), `name` (TEXT, UNIQUE), `status` (TEXT, DEFAULT 'active').

#### 20. جدول مخرجات المستندات والطباعة (`document_outputs`)
* **الحقول:** `id` (PK, TEXT), `document_id` (TEXT), `document_number` (TEXT), `output_type` (TEXT: print, share, whatsapp), `output_datetime` (TEXT), `user_id` (TEXT), `notes` (TEXT).

#### 21. جدول ملفات الـ PDF المحفوظة محلياً (`saved_pdfs`) [محدث]
* **الوظيفة:** التخزين والأرشفة المحلية المباشرة لملفات PDF المولدة لكشوفات الحساب والفواتير للرجوع إليها دون الحاجة لإعادة التوليد.
* **الحقول:** `id` (PK, TEXT), `customerId` (TEXT), `customerName` (TEXT), `filename` (TEXT), `createdAt` (TEXT), `fileSize` (INTEGER), `fileData` (TEXT - Base64).

#### 22. جدول كتالوج قطع الغيار المرجعي (`parts_catalog`) [محدث]
* **الوظيفة:** الدليل المرجعي والتعريف القياسي لقطع الغيار والتكلفة وسعر البيع المقترح لتوحيد مسميات القطع بالمخزن.
* **الحقول:** `id` (PK, TEXT), `name` (TEXT), `category` (TEXT), `defaultCost` (REAL), `defaultSalePrice` (REAL), `notes` (TEXT), `createdAt` (TEXT), `updatedAt` (TEXT).

#### 23. جدول مخزون قطع ورشة الصيانة (`shop_parts_inventory`) [محدث]
* **الوظيفة:** التتبع الدقيق لكميات قطع الغيار المتاحة بالورشة وتكلفتها الفعلية وربطها بفواتير الشراء أو لوطات التشليح.
* **الحقول:** `id` (PK, TEXT), `partId` (TEXT), `name` (TEXT), `category` (TEXT), `quantity` (INTEGER), `unitCost` (REAL), `salePrice` (REAL), `isDisassemblyBatch` (INTEGER, DEFAULT 0), `batchId` (TEXT), `batchName` (TEXT), `batchTotalCost` (REAL), `supplierName` (TEXT), `purchaseInvoiceId` (TEXT), `purchaseInvoiceNumber` (TEXT), `currency` (TEXT), `purchaseDate` (TEXT), `createdAt` (TEXT), `updatedAt` (TEXT).

#### 24. جدول لوطات التفكيك والتشليح (`disassembly_batches`) [محدث]
* **الوظيفة:** إدارة عمليات شراء أجهزة تالفة وتشليحها واستخراج القطع منها، مع تتبع استرداد التكلفة التراكمية للوط.
* **الحقول:** `id` (PK, TEXT), `batchNumber` (TEXT), `batchName` (TEXT), `supplierName` (TEXT), `currency` (TEXT), `totalBatchCost` (REAL), `recoveredAmount` (REAL, DEFAULT 0), `isCostFullyRecovered` (INTEGER, DEFAULT 0), `itemsCount` (INTEGER, DEFAULT 0), `fundId` (TEXT), `purchaseDate` (TEXT), `notes` (TEXT), `createdAt` (TEXT), `updatedAt` (TEXT).

#### 25. جدول صندوق الرسائل الصادرة للمزامنة (`outbox`)
* **الوظيفة:** طابور العمليات غير المتزامنة للمزامنة السحابية وفق نمط Outbox Pattern.
* **الحقول:** `id` (PK, TEXT), `collectionName` (TEXT), `recordId` (TEXT), `action` (TEXT), `payload` (TEXT), `status` (TEXT: PENDING, SYNCED, FAILED), `retryCount` (INTEGER, DEFAULT 0), `lastError` (TEXT), `createdAt` (TEXT), `updatedAt` (TEXT).

---

## 4. الخدمات المحاسبية المتقدمة وحماية البيانات (Advanced Architectural Services)

### 4.1 محرك التدقيق المحاسبي ومطابقة الصناديق (`fundRepairService.ts`)
* **المشكلة التي يعالجها:** أي عدم تطابق بين رصيد الصندوق المخزن وحاصل جمع سندات القبض والصرف الفعلية.
* **آلية العمل:**
  1. يقوم بقراءة حركات السندات بجدول `vault_transactions` المرتبطة بكل صندوق (`receipt` موجب، `payment` سالب).
  2. يقارن المجموع الفعلي برصيد `fin_funds.balance`.
  3. في حال وجود فارق، يتيح النظام خيارين: التعديل المباشر أو إنشاء سند تسوية تدقيقي تلقائي لمعالجة الفرق وتوثيق العملية في سجل التدقيق المالي.

---

### 4.2 محرك الحذف والتعديل المتسلسل الذري (`invoiceCascadeService.ts`)
* **المشكلة التي يعالجها:** منع ترك قيود يتيمة أو فواتير بدون سندات عند الحذف أو التعديل الاستثنائي.
* **آلية العمل:**
  1. عند طلب حذف أو تعديل فاتورة، تقوم الخدمة بحصر جميع البنود التابعة بـ `invoice_items` وحركات السندات بـ `vault_transactions`.
  2. تقوم بعكس وإعادة المبالغ المالية إلى الصناديق المعنية بجدول `fin_funds`.
  3. تنفيذ العملية داخل معاملة ذرية تضمن عدم فقدان أي بيانات مالية.

---

### 4.3 محرك المزامنة الصامتة وحماية النماذج النشطة (`Silent Background Sync & Form Protection`)
* **التحديث الصامت (`Silent Refresh`):** تم تعديل دالة جلب البيانات `loadDatabaseData(isBackground = true)` بحيث تحدث قواعد البيانات في الخلفية دون تفعيل مؤشر التحميل العام أو إعادة بناء الواجهة بالكامل.
* **حماية النماذج النشطة (`isFormDirty`):** يمتلك المكون رصداً ذكياً لحالة الإدخال؛ إذا كان المستخدم يكتب سنداً أو فاتورة، يُمنع محرك المزامنة من مسح الحقول أو استبدال الصناديق أو تغيير رقم السند المتوقع حتى ينتهي المستخدم من الحفظ.
* **عزل تصادم الحذف المتتالي:** حماية النوافذ المنبثقة من الإغلاق القسري عند وصول تحديثات متزامنة من أجهزة أخرى.

---

### 4.4 حوكمة الأمان المتقدم والمصادقة البيومترية (`Security & Biometrics`)
* **المصادقة البيومترية (`biometricAuth.ts`):** إمكانية تسجيل الدخول عبر مستشعر البصمة أو الوجه في الأجهزة المدعومة محلياً.
* **المراقبة اللحظية للأجهزة (`SecurityGuard.tsx`):** مكون حماية يعمل كحارس أمني في جذر التطبيق، يراقب حالة الجهاز المصرح به في جدول `user_devices`؛ إذا قام المدير العام بتجميد أو حظر الجهاز من الإدارة، يتم طرد المستخدم وإنهاء جلسته محلياً في نفس اللحظة.
* **اختيار جهات الاتصال (`contactPicker.ts`):** تسهيل إدخال بيانات العملاء دون أخطاء إملائية عبر قراءة دفتر هواتف الجهاز مباشرة.

---

## 5. العمليات المالية وآلية منع تكرار التسديد (Financial Governance)

### 5.1 معادلات الحسابات الرئيسية
* **التكلفة الإجمالية لفاتورة الصيانة (قاعدة القرار الفني ومطابقة الخروج المعتمدة):**  
  تعتمد التكلفة الإجمالية للفاتورة حصر الأجهزة المؤهلة للفوترة فقط (`isBillableMaintenanceItem`)؛ حيث **يتم استبعاد مبالغ الأجهزة التي كان قرارها الفني لا تصلح (`unrepairable` / `failed`)، أو عدم موافقة العميل (`refused`)، أو سليمة بدون صيانة (`intact`)، أو ملغاة (`cancelled`)**، ولا يتم احتساب سوى الأجهزة المنجزة بنجاح (`ready`)، مطابقة بنسبة 100% للآلية المتبعة في شاشة خروج الأجهزة (`DeviceExit.tsx`):
  $$\text{TotalCost} = \sum_{\text{Billable Devices}} (\text{quantity} \times \text{unitCost}) - \text{Discount} + \text{Tax}$$
* **المبلغ المتبقي على العميل:**  
  $$\text{RemainingAmount} = \text{TotalCost} - \text{AmountPaid}$$
* **معادلة التحويل بين العملات (سعر الصرف الافتراضي 3.8 للريال السعودي والدولار):**  
  $$\text{LiabilityAmount} = \frac{\text{ReceiptAmount}}{\text{ExchangeRate}}$$

### 5.2 حوكمة منع تكرار السداد
1. **الربط بالمعرف الفريد للفاتورة (`invoiceNumber` & `linkedTxId`):** ترتبط كل دفعة بسند قبض فريد مسجل في الخزينة.
2. **التحقق من المتبقي الفعلي:** النظام يمنع استلام مبالغ تزيد عن المتبقي المحسوب.
3. **التحديث الذري المتزامن:** ربط تحديث الفاتورة وسند الخزنة ورصيد الصندوق في معاملة موحدة.
4. **أمان الطباعة التام:** معاينة أو طباعة أو إعادة مشاركة الفواتير عبر الواتساب لا تُنشئ أي قيد مالي جديد مطلقاً، بل تُسجل كحركة إخراج في جدول `document_outputs`.

---

## 6. دورة المخزون ولوطات التفكيك (Inventory & Disassembly System)

1. **المخزون العام (`inventory_items`):** مراقبة قطع الغيار الجاهزة، وأسعار الشراء والبيع، وتنبيهات حد الطلب الأدنى.
2. **كتالوج القطع القياسي (`parts_catalog`):** مرجع موحد لمواصفات وتكاليف وأسعار القطع.
3. **مخزون ورشة الصيانة (`shop_parts_inventory`):** تتبع تفصيلي للقطع المتوفرة فعلياً للاستهلاك في أوامر الصيانة.
4. **نظام لوطات التفكيك والتشليح (`disassembly_batches`):**
   * شراء أجهزة تالفة وتشليحها إلى قطع غيار مفردة.
   * ربط تكلفة شراء الجهاز باللوط.
   * حساب قيمة القطع المستخرجة ومتابعة استرداد تكلفة اللوط (`recoveredAmount`) حتى تغطية التكلفة بالكامل (`isCostFullyRecovered = 1`).

---

## 7. الخلاصة والاعتمادية التقنية (System Reliability Summary)

* **الشمولية:** يشمل النظام **25 جدولاً** متكاملاً في قاعدة البيانات SQLite المحلية المتطابقة مع مجموعات Firestore السحابية.
* **الاعتمادية (Offline-First):** استقلالية تامة عن الاتصال بالإنترنت مع مزامنة خلفية صامتة فائقة الأمان.
* **الأمان المحاسبي:** فصل تام بين طبقة العرض والطباعة وبين الحسابات المالية، مع حماية المدخلات النشطة ونظام تدقيق ومطابقة آلي للأرصدة.

---
*تم تحديث وتوثيق هذه الوثيقة لتكون المرجع الشامل والنهائي والمطابق بنسبة 100% لكامل الهيكل البرمجي والتشغيلي للنظام.*
