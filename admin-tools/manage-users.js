#!/usr/bin/env node
/* أداة سطر أوامر صغيرة للمدير — تُشغَّل من جهازك عند الحاجة فقط (ليست مستضافة، لا تكلفة).
   تستخدم Firebase Admin SDK لتنفيذ عمليتين لا يمكن تنفيذهما بأمان من المتصفح:
   1) تغيير كلمة مرور أي مستخدم مباشرة.
   2) (اختياري) تعطيل تسجيل الدخول فعلياً على مستوى Firebase Authentication نفسه.

   الإعداد لمرة واحدة:
   1) npm install   (داخل هذا المجلد admin-tools)
   2) نزّل مفتاح حساب الخدمة من Firebase Console:
      Project Settings → Service accounts → Generate new private key
      واحفظه هنا باسم serviceAccountKey.json (هذا الملف مُستثنى من git ولا يُرفع أبداً).

   الاستخدام:
   node manage-users.js set-password "user1@naseem-vouchers.app" "كلمة-المرور-الجديدة"
   node manage-users.js disable "user1@naseem-vouchers.app"      (تعطيل فعلي على مستوى Auth)
   node manage-users.js enable  "user1@naseem-vouchers.app" */
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('لم أجد serviceAccountKey.json في هذا المجلد. راجع التعليمات أعلى هذا الملف.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });

async function main() {
  const [cmd, emailOrUid, arg2] = process.argv.slice(2);
  if (!cmd || !emailOrUid) {
    console.log('الاستخدام: node manage-users.js <set-password|disable|enable> <email> [كلمة المرور الجديدة]');
    process.exit(1);
  }
  const user = emailOrUid.includes('@')
    ? await admin.auth().getUserByEmail(emailOrUid)
    : await admin.auth().getUser(emailOrUid);

  if (cmd === 'set-password') {
    if (!arg2 || arg2.length < 6) { console.error('كلمة المرور يجب أن تكون ٦ أحرف على الأقل.'); process.exit(1); }
    await admin.auth().updateUser(user.uid, { password: arg2 });
    console.log('تم تغيير كلمة مرور', user.email, 'بنجاح.');
  } else if (cmd === 'disable' || cmd === 'enable') {
    const disabled = cmd === 'disable';
    await admin.auth().updateUser(user.uid, { disabled });
    await admin.firestore().collection('users').doc(user.uid).set({ active: !disabled }, { merge: true });
    console.log((disabled ? 'تم إيقاف' : 'تم تفعيل'), 'حساب', user.email);
  } else {
    console.error('أمر غير معروف:', cmd);
    process.exit(1);
  }
}
main().catch(e => { console.error('خطأ:', e.message || e); process.exit(1); });
