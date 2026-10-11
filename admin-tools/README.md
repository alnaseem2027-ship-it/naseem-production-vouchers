# أداة المدير (admin-tools)

أداة سطر أوامر صغيرة تُشغَّل من جهازك عند الحاجة فقط — **غير مستضافة ولا تكلفة أي شيء أبداً**،
لأن بعض عمليات Firebase (مثل تغيير كلمة مرور مستخدم آخر مباشرة) تتطلب صلاحيات Admin SDK
لا يمكن منحها بأمان لصفحة ويب عادية.

## الإعداد (مرة واحدة فقط)

1. ثبّت الاعتماديات داخل هذا المجلد:
   ```
   cd admin-tools
   npm install
   ```
2. حمّل مفتاح حساب خدمة Firebase:
   - افتح [Firebase Console](https://console.firebase.google.com) → مشروع `naseem-production-vouchers`
   - ⚙️ إعدادات المشروع → Service accounts → **Generate new private key**
   - احفظ الملف المُنزَّل هنا بالاسم **`serviceAccountKey.json`** بالضبط (هذا الملف مُستثنى من git في `.gitignore`، احتفظ به على جهازك فقط ولا تشاركه مع أحد).

## الاستخدام

تغيير كلمة مرور مستخدم (يمكنك نسخ الأمر جاهزاً من داخل لوحة «المستخدمون» في الموقع بعد كتابة كلمة المرور الجديدة):
```
node manage-users.js set-password "user1@naseem-vouchers.app" "كلمة-المرور-الجديدة"
```

تعطيل/تفعيل حساب فعلياً على مستوى تسجيل الدخول نفسه (إضافة لما يفعله زر «إيقاف/تفعيل» داخل الموقع من Firestore مباشرة):
```
node manage-users.js disable "user1@naseem-vouchers.app"
node manage-users.js enable  "user1@naseem-vouchers.app"
```

ملاحظة: زر «إيقاف/تفعيل» داخل لوحة المستخدمين في الموقع يعمل مباشرة بدون هذه الأداة (يحفظ الحالة في Firestore
وتمنع قواعد الأمان وصول الحساب الموقوف لأي بيانات). استخدم `disable`/`enable` هنا فقط إذا أردت تعطيل تسجيل الدخول
نفسه على مستوى Firebase Authentication كطبقة حماية إضافية.
