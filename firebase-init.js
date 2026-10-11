/* إعداد Firebase — مشروع naseem-production-vouchers
   هذه المفاتيح عامة (Public) بطبيعتها في تطبيقات الويب؛ الحماية الفعلية من قواعد أمان Firestore
   (Security Rules) المنشورة على المشروع، وليست من إخفاء هذا الملف. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCTMgHsx2nv1-WM2rfjUJgNZuEv3_4KVwM",
  authDomain: "naseem-production-vouchers.firebaseapp.com",
  projectId: "naseem-production-vouchers",
  storageBucket: "naseem-production-vouchers.firebasestorage.app",
  messagingSenderId: "212752731033",
  appId: "1:212752731033:web:f64f9b0f6d60d96c906108"
};

/* المجال المستخدم لتحويل "اسم مستخدم قصير" إلى بريد صالح لـ Firebase Auth،
   حتى يكتب المستخدم "user1" بدل البريد الكامل. */
export const EMAIL_DOMAIN = "naseem-vouchers.app";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
