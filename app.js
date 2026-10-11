/* سندات الإنتاج — شركة النسيم إخوان
   يعمل في المتصفح، لكن السندات الآن تُخزَّن أونلاين في Firebase Firestore وتتزامن بين كل الأجهزة.
   الدخول عبر Firebase Authentication. كل مستخدم يرى سنداته فقط؛ حساب المدير يرى سندات الجميع. */
import { auth, db, firebaseConfig, EMAIL_DOMAIN } from './firebase-init.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  createUserWithEmailAndPassword, getAuth, signOut as signOutSecondary
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeApp as initializeSecondaryApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  collection, doc, setDoc, deleteDoc, getDoc, getDocs, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

(function(){
'use strict';
const BASE=window.QOU_CATALOG;
const COMPANY='شركة النسيم إخوان';
const vouchersCol=collection(db,'vouchers');
const usersCol=collection(db,'users');

/* ---------- أدوات عامة ---------- */
const $=(s,r)=>(r||document).querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const r2=n=>+(+n||0).toFixed(2);
const fmt=n=>String(r2(n));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const hhmm=()=>new Date().toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'});
const uniq=a=>[...new Set(a)];
/* يقبل الأرقام العربية ٠-٩ والفارسية والفاصلة العشرية العربية. يعيد null للفارغ وNaN لغير الصالح */
function parseNum(v){
  let s=String(v==null?'':v).trim();
  if(s==='')return null;
  s=s.replace(/[٠-٩]/g,d=>d.charCodeAt(0)-0x660).replace(/[۰-۹]/g,d=>d.charCodeAt(0)-0x6F0).replace(/[٫,،]/g,'.').replace(/\s/g,'');
  const n=Number(s);return isFinite(n)?n:NaN;
}
function jget(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function jset(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){toast('تعذّر الحفظ في المتصفح (المساحة ممتلئة أو الحفظ ممنوع)');return false}}
function sget(k){try{return sessionStorage.getItem(k)}catch(e){return null}}
function sset(k,v){try{v==null?sessionStorage.removeItem(k):sessionStorage.setItem(k,v)}catch(e){}}

/* ---------- الكتالوج (محلي على كل جهاز، كما كان) ---------- */
const CK='qou:v1:catalog';
let _cat=null,_byCode=null;
function catData(){const o=jget(CK,{});o.over=o.over||{};o.add=o.add||[];return o}
function catalog(){
  if(_cat)return _cat;
  const o=catData();
  const base=BASE.map((i,idx)=>Object.assign({},i,o.over[i.c]||{},{o:idx}));
  const add=o.add.map((i,idx)=>Object.assign({},i,o.over[i.c]||{},{o:1000+idx,added:1}));
  _cat=base.concat(add);_byCode=new Map(_cat.map(i=>[i.c,i]));return _cat;
}
function catReset(){_cat=null;_byCode=null}
const byCode=c=>{catalog();return _byCode.get(c)};
const kindU=u=>u==='قطعة'?'p':(u==='متر مربع'||u==='كغم')?'a':'m';
const snapOf=i=>({n:i.n,s:i.s||'',u:i.u,g:i.g||''});
const labelOf=x=>x.n+(x.s?' / '+x.s:'');

/* ---------- بيانات السطر ----------
   السند المسودة يتبع الكتالوج الحالي (فتنعكس تصحيحات الوحدات عليه).
   عند تعليم السند «مكتمل» تُثبَّت بيانات كل سطر (الاسم والوحدة) فلا يغيّرها أي تعديل لاحق للكتالوج. */
function info(r,v){
  v=v||V;
  if(v&&v.status==='done'&&r.x)return r.x;
  const i=byCode(r.c);
  if(i)return Object.assign(snapOf(i),{sg:i.sg});
  if(r.x)return r.x;
  return {n:'(صنف غير موجود في الكتالوج)',s:'',u:'قطعة',g:'',missing:1};
}
const isLenR=(r,v)=>kindU(info(r,v).u)==='m';
const qtyOf=(r,v)=>isLenR(r,v)?r2((+r.n||0)*(+r.l||0)):r2(r.n);
const missingLen=(r,v)=>isLenR(r,v)&&!(+r.l>0);
const numbered=rows=>rows.map((r,idx)=>({r,idx,n:idx+1}));

/* ---------- المستخدم (Firebase Authentication + Firestore /users/{uid}) ---------- */
let USER=null;           // {u:uid, email, name, prefix, role}
let AUTH_READY=false;
let unsubVouchers=null;
let VOUCHERS=[];          // ذاكرة محلية مُزامَنة لحظياً مع Firestore عبر onSnapshot

function toIdentifier(v){
  v=(v||'').trim();
  if(!v)return '';
  return v.includes('@')?v.toLowerCase():(v.toLowerCase()+'@'+EMAIL_DOMAIN);
}
const BK=u=>'qou:v1:lastBackup:'+u;      // وقت آخر نسخة احتياطية (محلي لكل جهاز، لا يحتاج تزامناً)

function myVouchers(uidv){return VOUCHERS.filter(v=>v.ownerUid===(uidv||USER.u))}
function loadV(){return VOUCHERS.slice()}      // كل ما يراه المستخدم الحالي (مفلتَر مسبقاً حسب الدور عبر الاستعلام)
function prefixOf(u){return (u.prefix||'A').toUpperCase()}
function nextNo(vs){
  const p=prefixOf(USER)+'-';
  const mx=vs.reduce((m,v)=>String(v.no||'').startsWith(p)?Math.max(m,parseInt(String(v.no).slice(p.length))||0):m,0);
  return p+String(mx+1).padStart(4,'0');
}

function startVouchersListener(){
  if(unsubVouchers){unsubVouchers();unsubVouchers=null}
  VOUCHERS=[];
  const qy=USER.role==='admin'?query(vouchersCol):query(vouchersCol,where('ownerUid','==',USER.u));
  unsubVouchers=onSnapshot(qy,snap=>{
    VOUCHERS=snap.docs.map(d=>d.data());
    /* لا نُعيد رسم شاشة سند مفتوح حالياً حتى لا نقطع تعديلاً قيد الكتابة؛
       فقط نحدّث قائمة السندات وشاشة المستخدمين إن كانتا الشاشة الحالية */
    if(location.hash==='#/list'&&!V)viewList();
    /* المدير يعرض سند موظف للقراءة فقط: نحدّث العرض لحظياً بآخر نسخة */
    else if(V&&VIEWONLY&&location.hash==='#/v/'+V.id){
      const f=VOUCHERS.find(x=>x.id===V.id);
      if(f&&f.updated!==V.updated&&!$('dialog[open]')){V=f;VOWNERUID=f.ownerUid;viewVoucher(f.id)}
    }
  },err=>{toast('تعذّر مزامنة السندات: '+(err&&err.message||''))});
}
function stopVouchersListener(){if(unsubVouchers){unsubVouchers();unsubVouchers=null}VOUCHERS=[]}

/* ---------- واجهة عامة ---------- */
let toastT=null;
function toast(msg,undo,ms){
  const t=$('#toast');if(!t)return;t.innerHTML=esc(msg)+(undo?' <button id="undoB">تراجع</button>':'');
  t.classList.add('on');clearTimeout(toastT);
  if(undo)$('#undoB').onclick=()=>{t.classList.remove('on');undo()};
  toastT=setTimeout(()=>t.classList.remove('on'),ms||(undo?7000:2200));
}
function dlg(html){const d=$('#dlg');d.innerHTML=html;if(!d.open)d.showModal();return d}
function closeDlg(){const d=$('#dlg');if(d.open)d.close()}
function opts(arr,sel){return arr.map(x=>`<option ${x===sel?'selected':''}>${esc(x)}</option>`).join('')}
function header(){
  const isAdmin=USER.role==='admin';
  return `<div class="top"><img src="img/logo-word.png" alt="النسيم إخوان"><h1>سندات الإنتاج</h1><div class="sp"></div>
  <button class="btn" onclick="QA.go('#/list')">السندات</button>
  ${isAdmin?`<button class="btn" onclick="QA.go('#/catalog')">الكتالوج</button>
  <button class="btn" onclick="QA.go('#/users')">المستخدمون</button>
  <button class="btn" onclick="QA.backup()">نسخة احتياطية</button>`:''}
  <span class="chip">${esc(USER.name||USER.email)}${isAdmin?' · مدير':''}</span>
  <button class="btn" onclick="QA.changePw()">كلمة المرور</button>
  <button class="btn" onclick="QA.logout()">خروج</button></div>`;
}

/* ---------- الدخول والخروج ---------- */
function viewLogin(busy,err){
  document.title='سندات الإنتاج — '+COMPANY;
  $('#app').innerHTML=`<div class="login"><form class="card box" id="lf">
  <img src="img/logo-full.png" alt="شعار ${COMPANY}">
  <h2 style="color:var(--brand-t);margin:8px 0 2px">سندات الإنتاج</h2>
  <div style="color:var(--mut);font-size:13px;margin-bottom:10px">سجّل الدخول للمتابعة</div>
  <input id="lu" placeholder="اسم المستخدم أو البريد" autocomplete="username" autofocus>
  <input id="lp" type="password" placeholder="كلمة المرور" autocomplete="current-password">
  <div class="err" id="le">${esc(err||'')}</div>
  <button class="btn pri" style="width:100%" ${busy?'disabled':''}>${busy?'جارٍ الدخول…':'دخول'}</button></form></div>`;
  $('#lf').onsubmit=async e=>{
    e.preventDefault();
    const email=toIdentifier($('#lu').value),p=$('#lp').value;
    if(!email||!p){viewLogin(false,'أدخل اسم المستخدم وكلمة المرور');return}
    viewLogin(true);
    try{
      await signInWithEmailAndPassword(auth,email,p);
      /* onAuthStateChanged سيتولى تحميل بيانات المستخدم والتوجيه */
    }catch(err){
      viewLogin(false,loginErr(err));
    }
  };
}
function loginErr(err){
  const c=err&&err.code||'';
  if(c==='auth/invalid-credential'||c==='auth/wrong-password'||c==='auth/user-not-found')return 'اسم المستخدم أو كلمة المرور غير صحيحة';
  if(c==='auth/user-disabled')return 'هذا الحساب موقوف. تواصل مع المدير.';
  if(c==='auth/too-many-requests')return 'محاولات كثيرة متتالية — انتظر قليلاً ثم أعد المحاولة';
  if(c==='auth/network-request-failed')return 'تعذّر الاتصال بالإنترنت';
  return 'تعذّر تسجيل الدخول: '+(err&&err.message||'');
}
async function logout(){
  if(V&&dirty)await Promise.race([persist(),sleep(4000)]);   // نحفظ آخر تعديل قبل الخروج
  closeVoucher();
  stopVouchersListener();
  try{await signOut(auth)}catch(e){}
  listQ='';
  /* onAuthStateChanged سيتولى عرض شاشة الدخول */
}
function changePw(){
  dlg(`<h3>تغيير كلمة المرور</h3><form id="pf" class="grid2">
   <div class="full"><label class="l">كلمة المرور الحالية</label><input id="p_old" type="password" required autocomplete="current-password"></div>
   <div class="full"><label class="l">كلمة المرور الجديدة (٦ أحرف على الأقل)</label><input id="p_new" type="password" required minlength="6" autocomplete="new-password"></div>
   <div class="err" id="p_err"></div>
   <div class="full" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" onclick="QA.closeDlg()">إلغاء</button><button class="btn pri">حفظ</button></div></form>`);
  $('#pf').onsubmit=async e=>{
    e.preventDefault();
    const oldP=$('#p_old').value,newP=$('#p_new').value;
    try{
      const cred=EmailAuthProvider.credential(auth.currentUser.email,oldP);
      await reauthenticateWithCredential(auth.currentUser,cred);
      await updatePassword(auth.currentUser,newP);
      closeDlg();toast('تم تغيير كلمة المرور');
    }catch(err){$('#p_err').textContent=loginErr(err)}
  };
}

/* ---------- قائمة السندات ---------- */
let listQ='';
function viewList(){
  document.title='السندات — سندات الإنتاج';
  const isAdmin=USER.role==='admin';
  const vs=loadV().sort((a,b)=>(b.updated||0)-(a.updated||0));
  const q=listQ.trim().toLowerCase();
  const rows=vs.filter(v=>!q||(`${v.no} ${v.mo} ${v.customer} ${v.byName||''}`).toLowerCase().includes(q));
  const lb=jget(BK(USER.u),0),stale=isAdmin&&vs.length&&(Date.now()-lb>7*864e5);
  $('#app').innerHTML=header()+`<div class="wrap">
  ${stale?`<div class="note warnbox">${lb?'مرّ أكثر من أسبوع على آخر نسخة احتياطية.':'لم تُصدَّر أي نسخة احتياطية بعد.'} السندات محفوظة أونلاين، لكن النسخة الاحتياطية تبقى مفيدة كأرشيف خارجي. <button class="btn sm" onclick="QA.expBackup()">صدّر نسخة الآن</button></div>`:''}
  <div class="bar"><h2 style="margin:0">السندات</h2><span class="sp"></span>
  <input type="search" id="lq" placeholder="🔍 بحث برقم السند أو MO أو الزبون${isAdmin?' أو المستخدم':''}" style="max-width:320px" value="${esc(listQ)}">
  <button class="btn pri" onclick="QA.newV()">+ سند جديد</button></div>
  <div class="card" style="padding:6px 12px;overflow-x:auto"><table><thead><tr><th>رقم السند</th>${isAdmin?'<th>المستخدم</th>':''}<th>MO</th><th>التاريخ</th><th>الزبون</th><th>الأبواب</th><th>الأسطر</th><th>الحالة</th><th>آخر تعديل</th><th></th></tr></thead><tbody>
  ${rows.length?rows.map(v=>{const nl=v.doors.reduce((s,d)=>s+d.rows.length,0);return `<tr class="clk" onclick="QA.go('#/v/${v.id}')"><td><b class="code" style="color:var(--ink)">${esc(v.no)}</b></td>${isAdmin?`<td>${esc(v.byName||'')}</td>`:''}<td class="code">${esc(v.mo)}</td><td>${esc(v.date)}</td><td>${esc(v.customer)}</td><td>${v.doors.length}</td><td>${nl}</td>
  <td><span class="badge ${v.status==='done'?'ok':'d'}">${v.status==='done'?'معتمد 🔒':'مسودة'}</span></td><td>${v.updated?new Date(v.updated).toLocaleString('ar',{dateStyle:'short',timeStyle:'short'}):''}</td>
  <td style="white-space:nowrap"><button class="btn sm">فتح</button></td></tr>`}).join(''):`<tr><td colspan="${isAdmin?10:9}" class="empty">${vs.length?'لا نتائج مطابقة.':'لا توجد سندات بعد. اضغط «سند جديد» للبدء.'}</td></tr>`}
  </tbody></table></div></div>`;
  $('#lq').oninput=e=>{listQ=e.target.value;const p=e.target.selectionStart;viewList();const n=$('#lq');n.focus();n.setSelectionRange(p,p)};
}
/* ---------- إنشاء وحذف السند ----------
   «سند جديد» يفتح نموذجاً فارغاً في الذاكرة فقط؛ لا يُنشأ في قاعدة البيانات ولا يظهر في القائمة
   إلا بعد أول تعديل فعلي. ويُحدَّد رقمه لحظة أول حفظ (لا لحظة الضغط) حتى لا يتكرر. */
let NEWV=null;
const amAdmin=()=>!!USER&&USER.role==='admin';
const isNewV=()=>!!V&&V===NEWV;
const vHash=v=>v===NEWV?'#/v/new':'#/v/'+v.id;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function newV(){
  NEWV={id:uid(),no:'',mo:'',date:today(),customer:'',status:'draft',ownerUid:USER.u,by:USER.u,byName:USER.name||USER.email,doors:[{id:uid(),name:'باب 1',rows:[]}],created:Date.now(),updated:Date.now()};
  if(location.hash==='#/v/new')route();else location.hash='#/v/new';
}
/* الحذف من داخل السند فقط، وبتأكيد دائماً. السند المعتمد لا يحذفه إلا المدير. */
async function delV(){
  if(!V)return;
  const v=V;
  if(isNewV()){
    if(dirty&&!confirm('إلغاء هذا السند الجديد وما أدخلته فيه؟'))return;
    closeVoucher(true);location.hash='#/list';toast('أُلغي السند الجديد');return;
  }
  if(v.status==='done'&&!amAdmin()){toast('السند المعتمد لا يحذفه إلا المدير');return}
  if(!confirm('حذف السند '+v.no+(v.status==='done'?' (معتمد)':'')+' نهائياً؟'))return;
  closeVoucher(true);              // نُلغي أي حفظ معلّق حتى لا يُعاد إنشاء السند بعد حذفه
  const k=VOUCHERS.findIndex(x=>x.id===v.id);if(k>=0)VOUCHERS.splice(k,1);
  location.hash='#/list';
  try{await deleteDoc(doc(db,'vouchers',v.id))}catch(e){
    toast('تعذّر الحذف: '+(e&&e.message||''));
    if(!VOUCHERS.some(x=>x.id===v.id))VOUCHERS.push(v);if(location.hash==='#/list'&&!V)viewList();return;
  }
  toast('حُذف السند '+v.no,async()=>{
    if(!VOUCHERS.some(x=>x.id===v.id))VOUCHERS.push(v);if(location.hash==='#/list'&&!V)viewList();
    try{await setDoc(doc(db,'vouchers',v.id),v);toast('أُعيد السند')}catch(e){toast('تعذّر استرجاع السند: '+(e&&e.message||''))}
  },10000);
}

/* ---------- شاشة السند ---------- */
let V=null,VOWNERUID=null,T=0,SM='sum',saveTimer=null,retryT=null,dirty=false,VIEWONLY=false,SAWTOT=false;
const ES={cat:'',comp:'',code:'',q:''};
/* مقفل = معتمد، أو سند موظف يعرضه المدير للقراءة فقط */
const locked=()=>!!V&&(V.status==='done'||VIEWONLY);

/* الحفظ: dirty تعني «تعديل لم يُسلَّم بعد لـ Firebase». بعد التسليم يتكفّل Firebase بإيصاله
   حتى لو انقطع الاتصال مؤقتاً (ما دامت الصفحة مفتوحة)، لذلك نُظهر تنبيهاً إن طال الانتظار. */
async function persist(){
  clearTimeout(saveTimer);
  const v=V;
  if(!v||!VOWNERUID||VIEWONLY){dirty=false;return}
  if(v===NEWV){
    if(!dirty)return;                                   // سند جديد لم يُكتب فيه شيء: لا يُنشأ
    if(!String(v.no||'').trim())v.no=nextNo(myVouchers());
    NEWV=null;if(!VOUCHERS.includes(v))VOUCHERS.push(v);
    if(location.hash==='#/v/new'){
      history.replaceState(null,'','#/v/'+v.id);
      document.title='سند '+v.no+' — سندات الإنتاج';
      const ni=$('.meta [data-m="no"]');if(ni)ni.value=v.no;
      const st=$('#vstatus');if(st){st.textContent='مسودة';st.className='unit'}
    }
  }
  v.updated=Date.now();v.ownerUid=VOWNERUID;
  dirty=false;setSave('saving');
  const slow=setTimeout(()=>{if(V===v)setSave('slow')},6000);
  try{
    await setDoc(doc(db,'vouchers',v.id),v);
    clearTimeout(slow);
    if(V===v&&!dirty)setSave('ok');
  }catch(e){
    clearTimeout(slow);
    if(V===v){
      dirty=true;setSave('err',e);
      if(!(e&&e.code==='permission-denied')){clearTimeout(retryT);retryT=setTimeout(()=>{if(V===v&&dirty)persist()},8000)}
    }else toast('تعذّر حفظ آخر تعديل على السند '+(v.no||'')+': '+(e&&e.message||''));
  }
}
function autosave(){dirty=true;setSave('saving');clearTimeout(saveTimer);saveTimer=setTimeout(persist,400);drawSteps()}
async function flush(){if(dirty)await persist()}
/* إغلاق السند المفتوح: يبدأ حفظ أي تعديل معلّق ثم يُغلق فوراً.
   (سابقاً كان الإغلاق ينتظر الحفظ ثم يمسح السند — فيمسح السند الذي فُتح للتو،
   وهذا ما عطّل «إضافة» و«+ باب جديد» وحقول MO والزبون.) */
function closeVoucher(discard){
  if(!V)return;
  if(!discard&&dirty)persist();
  clearTimeout(saveTimer);clearTimeout(retryT);
  if(V===NEWV)NEWV=null;
  V=null;VOWNERUID=null;VIEWONLY=false;dirty=false;
}
function setSave(st,err){
  const s=$('#saved'),b=$('#savebar');
  if(s){
    s.className='saved '+st;
    s.textContent={saving:'جارٍ الحفظ…',ok:'✓ محفوظ '+hhmm(),new:'لم يُحفظ بعد',err:'⚠ لم يُحفظ',slow:'⚠ بانتظار الاتصال',ro:'👁 قراءة فقط',done:'✓ محفوظ'}[st]||'';
  }
  if(b){
    if(st==='err'){b.hidden=false;b.textContent=(err&&err.code==='permission-denied')?'⚠ لا تملك صلاحية حفظ هذا السند. تواصل مع المدير.':'⚠ تعذّر الحفظ — تحقق من الاتصال بالإنترنت. ستُعاد المحاولة تلقائياً، لا تغلق الصفحة.'}
    else if(st==='slow'){b.hidden=false;b.textContent='⚠ لا يوجد اتصال بالإنترنت. تعديلاتك محفوظة مؤقتاً على هذا الجهاز وستُرفع تلقائياً عند عودة الاتصال — لا تغلق الصفحة.'}
    else if(st==='ok')b.hidden=true;
  }
}
/* حفظ عند إغلاق الصفحة أو إخفائها (محاولة بأفضل جهد)، وعند عودة الاتصال */
window.addEventListener('pagehide',()=>{if(dirty)persist()});
window.addEventListener('beforeunload',()=>{if(dirty)persist()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&dirty)persist()});
window.addEventListener('online',()=>{if(dirty)persist()});

function viewVoucher(id){
  const target=id==='new'?NEWV:(V&&V.id===id?V:VOUCHERS.find(v=>v.id===id));
  if(!target){location.hash='#/list';return}
  if(V!==target){
    closeVoucher();
    V=target;VOWNERUID=V.ownerUid;T=0;ES.q='';SAWTOT=false;
    VIEWONLY=amAdmin()&&V.ownerUid!==USER.u;          // سند موظف: قراءة فقط حتى يضغط المدير «تعديل»
    if(!V.doors.length)V.doors.push({id:uid(),name:'باب 1',rows:[]});
    V.doors.forEach(d=>d.rows.forEach(r=>{if(!r.x){const i=byCode(r.c);if(i)r.x=snapOf(i)}}));
  }
  const NEW=isNewV(),ADM=amAdmin(),done=V.status==='done',L=locked();
  document.title=(NEW?'سند جديد':'سند '+V.no)+' — سندات الإنتاج';
  $('#app').innerHTML=header()+`<div class="wrap">
  <div class="bar"><button class="btn" onclick="QA.go('#/list')">→ السندات</button><span class="saved" id="saved"></span><span class="sp"></span>
   ${ADM&&V.byName?`<span class="chip">صاحب السند: ${esc(V.byName)}</span>`:''}
   <button class="btn" onclick="QA.print(false)">طباعة</button><button class="btn" onclick="QA.print(true)">PDF</button><button class="btn" onclick="QA.exportX()">تصدير Excel</button></div>
  <div class="savebar" id="savebar" hidden></div>
  ${done?`<div class="note lockbox">🔒 هذا السند <b>معتمد ومقفل</b>. بياناته ثابتة ولا تتأثر بتعديل الكتالوج. ${ADM?`<button class="btn sm" onclick="QA.reopen()">إعادة فتح للتعديل</button>`:'لتعديله تواصل مع المدير.'}</div>`
   :VIEWONLY?`<div class="note warnbox">👁 تعرض سند <b>${esc(V.byName||'')}</b> للقراءة فقط. <button class="btn sm" onclick="QA.editOther()">تعديل هذا السند</button></div>`:''}
  ${L?'':`<div class="steps" id="steps"></div>`}
  <div class="meta">
   <div><label class="l">رقم السند</label><input data-m="no" value="${esc(V.no)}" ${L||!ADM?'disabled':''} placeholder="يُحدَّد تلقائياً عند الحفظ" style="direction:ltr;text-align:right"></div>
   <div><label class="l">رقم أمر التصنيع MO <b class="req">*</b></label><input data-m="mo" value="${esc(V.mo)}" ${L?'disabled':''} style="direction:ltr;text-align:right" placeholder="MO21-00000"></div>
   <div><label class="l">التاريخ</label><input type="date" data-m="date" value="${esc(V.date)}" ${L?'disabled':''}></div>
   <div><label class="l">الزبون</label><input data-m="customer" value="${esc(V.customer)}" ${L?'disabled':''} placeholder="اختياري"></div>
   <div><label class="l">الحالة</label><div class="unit ${done?'st-done':NEW?'st-new':''}" id="vstatus">${done?'معتمد 🔒':NEW?'جديد — لم يُحفظ':'مسودة'}</div></div>
  </div>
  <div class="tabs" id="tabs"></div><div class="card panel" id="panel"></div>
  ${!L?`<div class="actions"><button class="btn danger" onclick="QA.delV()">${NEW?'إلغاء السند':'حذف السند'}</button><span class="sp"></span>
    <button class="btn" onclick="QA.saveDraft()">حفظ كمسودة والعودة</button><button class="btn pri" onclick="QA.markDone()">✓ حفظ واعتماد</button></div>`
   :ADM?`<div class="actions"><button class="btn danger" onclick="QA.delV()">حذف السند</button><span class="sp"></span><button class="btn" onclick="QA.go('#/list')">→ رجوع إلى السندات</button></div>`:''}
  </div>`;
  setSave(VIEWONLY?'ro':NEW&&!dirty?'new':done?'done':dirty?'saving':'ok');
  $('.meta').oninput=e=>{
    const k=e.target.dataset.m;if(!k||locked())return;
    V[k]=e.target.value;
    if(k==='no'){const dup=VOUCHERS.some(v=>v.id!==V.id&&String(v.no).trim()===V.no.trim());e.target.classList.toggle('bad',dup);if(dup)toast('رقم السند مستخدم في سند آخر')}
    autosave();
  };
  if(T!=='t'&&T>=V.doors.length)T=0;
  drawAll();
}
/* شريط الخطوات للموظف الجديد */
function drawSteps(){
  const el=$('#steps');if(!el||!V)return;
  const rows=V.doors.reduce((s,d)=>s+d.rows.length,0),miss=V.doors.reduce((s,d)=>s+d.rows.filter(r=>missingLen(r)).length,0);
  const st=[[!!String(V.mo||'').trim()&&!!V.date,'اكتب رقم MO والتاريخ'],[rows>0&&!miss,'أضف أصناف كل باب'],[SAWTOT,'راجع تبويب «الإجمالي»'],[V.status==='done','اضغط «حفظ واعتماد»']];
  el.innerHTML=st.map(([ok,t],k)=>`<span class="step ${ok?'ok':''}">${ok?'✓':'①②③④'[k]} ${t}</span>`).join('<span class="arr">←</span>');
}
function saveDraft(){
  if(!V)return;
  if(isNewV()&&!dirty){closeVoucher(true);location.hash='#/list';toast('لم يُحفظ شيء — السند كان فارغاً');return}
  if(dirty)persist();               // يحدد رقم السند الجديد فوراً ويبدأ الحفظ
  const no=V.no;
  toast('حُفظ السند '+no+' كمسودة');location.hash='#/list';
}
function editOther(){
  if(!V||!VIEWONLY)return;
  if(!confirm('فتح سند '+(V.byName||'')+' للتعديل؟\n\nتأكد أن صاحبه لا يعمل عليه الآن، وإلا قد يمسح حفظُ أحدكما تعديلاتِ الآخر.'))return;
  VIEWONLY=false;viewVoucher(V.id);
}
function drawAll(){drawTabs();drawPanel();drawSteps()}
function drawTabs(){
  $('#tabs').innerHTML=V.doors.map((d,i)=>{const m=d.rows.filter(r=>missingLen(r)).length;return `<button class="tab ${i===T?'on':''}" title="${esc(d.name)}" onclick="QA.tab(${i})">${esc(d.name||'باب '+(i+1))}${m?' <span class="dot" title="أسطر بلا طول">●</span>':''}</button>`}).join('')
   +(locked()?'':`<button class="tab add" onclick="QA.addDoor()">+ باب جديد</button>`)+`<button class="tab tot ${T==='t'?'on':''}" onclick="QA.tab('t')">الإجمالي</button>`;
}
function drawPanel(){
  const p=$('#panel');if(!p)return;
  if(T==='t'){SAWTOT=true;p.innerHTML=totalsHTML();return}
  const d=V.doors[T],L=locked();
  p.innerHTML=`<div class="doorname"><label class="l" style="margin:0">وصف الباب:</label><input id="dn" value="${esc(d.name)}" ${L?'disabled':''} placeholder="مثال: باب رول بطن (كريم 1013)">
   ${L?'':`<button class="btn danger" onclick="QA.delDoor()">حذف الباب</button>`}</div>
   ${L?'':`<div class="entry"><div class="srch"><input id="srch" type="search" placeholder="🔍 ابحث بالاسم أو الكود في كل الأصناف…" value="${esc(ES.q)}"></div><div id="entryRow"></div></div>`}
   <div id="dtable"></div>`;
  if(!L){
    $('#dn').oninput=e=>{d.name=e.target.value;drawTabs();autosave()};
    $('#srch').oninput=e=>{ES.q=e.target.value.trim();drawEntry()};
    drawEntry();
  }
  drawTable();
}
function activeItems(){return catalog().filter(i=>!i.off)}
const CAT_ORDER=['دنجل','الحلق','الوجه','أخرى'];
function cascade(items,S){
  const cats=CAT_ORDER.filter(c=>items.some(i=>i.cat===c)).concat(uniq(items.map(i=>i.cat)).filter(c=>!CAT_ORDER.includes(c)));
  if(!cats.includes(S.cat))S.cat=cats[0];
  const comps=uniq(items.filter(i=>i.cat===S.cat).map(i=>i.comp));
  if(!comps.includes(S.comp))S.comp=comps[0];
  const q=(S.q||'').toLowerCase();
  const dets=q?items.filter(i=>(labelOf(i)+' '+i.c).toLowerCase().includes(q)):items.filter(i=>i.cat===S.cat&&i.comp===S.comp);
  if(!dets.find(i=>i.c===S.code))S.code=dets[0]?dets[0].c:'';
  return {cats,comps,dets,it:byCode(S.code)};
}
function detOpts(dets,code){return dets.length?dets.map(i=>`<option value="${esc(i.c)}" ${i.c===code?'selected':''}>${esc(labelOf(i))} — ${esc(i.c)}</option>`).join(''):'<option value="">لا نتائج</option>'}
function drawEntry(){
  const {cats,comps,dets,it}=cascade(activeItems(),ES);
  const len=it&&kindU(it.u)==='m';
  $('#entryRow').innerHTML=`<div class="row">
   <div><label class="l">الفئة</label><select id="ec" ${ES.q?'disabled':''}>${opts(cats,ES.cat)}</select></div>
   <div><label class="l">المكوّن</label><select id="em" ${ES.q?'disabled':''}>${opts(comps,ES.comp)}</select></div>
   <div><label class="l">التفصيل ${ES.q?`(${dets.length} نتيجة)`:''}</label><select id="ed">${detOpts(dets,ES.code)}</select></div>
   <div><label class="l">الوحدة</label><div class="unit ${it&&it.sg&&amAdmin()?'sug':''}">${it?esc(it.u):'--'}${it&&it.sg&&amAdmin()?' *':''}</div></div>
   <div><label class="l">${it&&kindU(it.u)==='a'?'الكمية':'العدد'}</label><input id="en" inputmode="decimal" autocomplete="off" value="1"></div>
   <div><label class="l">الطول (م)${len?' <b class="req">*</b>':''}</label><input id="el" inputmode="decimal" autocomplete="off" ${len?'placeholder="مطلوب"':'disabled placeholder="—"'}></div>
   <div><button class="btn pri" id="eadd">إضافة ↵</button></div></div>`;
  $('#ec').onchange=e=>{ES.cat=e.target.value;ES.comp='';drawEntry()};
  $('#em').onchange=e=>{ES.comp=e.target.value;drawEntry()};
  $('#ed').onchange=e=>{ES.code=e.target.value;drawEntry()};
  $('#eadd').onclick=addRow;
}
function addRow(){
  if(locked())return;
  const it=byCode(ES.code);if(!it){toast('اختر صنفاً أولاً');return}
  const n=parseNum($('#en').value);
  if(!(n>0)){toast('أدخل عدداً صحيحاً أكبر من صفر');$('#en').focus();return}
  const len=kindU(it.u)==='m';
  let l=len?parseNum($('#el').value):0;
  if(len&&!(l>0)){toast(l===null?'أدخل الطول بالمتر — مطلوب لهذا الصنف':'الطول غير صالح');$('#el').focus();return}
  if(!len)l=0;
  const rows=V.doors[T].rows;
  const ex=rows.find(r=>r.c===it.c&&(!len||+r.l===l));
  if(ex)ex.n=r2(+ex.n+n);else rows.push({c:it.c,n:n,l:len?l:0,x:snapOf(it)});
  drawTable();drawTabs();autosave();
  toast(ex?'أُضيف العدد إلى السطر الموجود':'تمت الإضافة');
  $('#en').value='1';$('#el').value='';$('#en').focus();$('#en').select();
}
function drawTable(){
  const el=$('#dtable');if(!el||T==='t')return;
  const d=V.doors[T],L=locked(),rows=numbered(d.rows);
  const miss=d.rows.filter(r=>missingLen(r)).length;
  el.innerHTML=`<div style="overflow-x:auto"><table><thead><tr><th>م</th><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>العدد</th><th>الطول (م)</th><th>الكمية</th>${L?'':'<th></th>'}</tr></thead><tbody>
  ${rows.length?rows.map(({r,idx,n})=>{const x=info(r),len=kindU(x.u)==='m',ml=len&&!(+r.l>0);return `<tr data-i="${idx}" class="${ml?'warnrow':''}"><td>${n}</td><td class="code">${esc(r.c)}</td><td>${x.missing?'<span class="sug-star">'+esc(x.n)+'</span>':esc(labelOf(x))}</td><td>${esc(x.u)}${x.sg&&amAdmin()?' <span class="sug-star" title="وحدة مقترحة">*</span>':''}</td>
   <td><input inputmode="decimal" data-f="n" value="${r.n}" ${L?'disabled':''}></td>
   <td><input inputmode="decimal" data-f="l" value="${len&&+r.l?r.l:''}" ${len&&!L?'placeholder="أدخل الطول"':'disabled placeholder="—"'}></td>
   <td class="qty">${fmt(qtyOf(r))}</td>${L?'':`<td style="white-space:nowrap"><button class="x" style="color:var(--brand-t)" title="تعديل السطر" data-edit="${idx}">✎</button><button class="x" title="حذف" data-del="${idx}">✕</button></td>`}</tr>`}).join(''):`<tr><td colspan="8" class="empty">لا أصناف في هذا الباب بعد.${L?'':' اختر صنفاً من الأعلى.'}</td></tr>`}
  </tbody></table></div><div class="foot"><span>عدد الأسطر: <b>${d.rows.length}</b></span>${miss?`<span class="warntxt">⚠ ${miss} سطر بلا طول (كميته صفر)</span>`:''}${amAdmin()?'<span>* وحدة مقترحة تحتاج تأكيداً من «الكتالوج»</span>':''}</div>`;
}
/* تعديل العدد والطول مباشرة في الجدول */
document.addEventListener('input',e=>{
  const t=e.target,f=t.dataset&&t.dataset.f;if(!f||!V||T==='t'||locked())return;
  const tr=t.closest('tr'),r=V.doors[T]&&V.doors[T].rows[+tr.dataset.i];if(!r)return;
  const v=parseNum(t.value);
  const ok=f==='n'?v>0:(isLenR(r)?v>0:(v===null||v>=0));      // الطول إلزامي لأصناف المتر
  t.classList.toggle('bad',!ok);if(!ok)return;
  r[f]=v===null?0:v;
  tr.querySelector('.qty').textContent=fmt(qtyOf(r));
  tr.classList.toggle('warnrow',missingLen(r));
  autosave();
});
document.addEventListener('focusout',e=>{
  const t=e.target;if(!(t.dataset&&t.dataset.f)||!V||T==='t')return;
  if(t.classList.contains('bad')){t.classList.remove('bad');drawTable();toast('قيمة غير صالحة — أُعيدت القيمة السابقة')}
  else drawTabs(),refreshFoot();
});
function refreshFoot(){const d=V&&T!=='t'&&V.doors[T];if(!d)return;const f=$('#dtable .foot .warntxt'),m=d.rows.filter(r=>missingLen(r)).length;if(!!f!==!!m)drawTable();else if(f)f.textContent='⚠ '+m+' سطر بلا طول (كميته صفر)'}
document.addEventListener('click',e=>{
  if(!V||T==='t'||locked()||!e.target.closest)return;
  const eb=e.target.closest('[data-edit]');if(eb){editRow(+eb.dataset.edit);return}
  const b=e.target.closest('[data-del]');if(!b)return;
  const d=V.doors[T],idx=+b.dataset.del,r=d.rows.splice(idx,1)[0],vid=V.id;
  drawTable();drawTabs();autosave();
  toast('حُذف الصنف',()=>{
    if(!V||V.id!==vid){toast('تعذّر التراجع بعد إغلاق السند');return}
    d.rows.splice(Math.min(idx,d.rows.length),0,r);
    if(T!=='t'&&V.doors[T]===d)drawTable();
    drawTabs();autosave();toast('أُعيد الصنف');
  });
});
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.closest&&e.target.closest('.entry')&&e.target.tagName!=='BUTTON'&&e.target.id!=='srch'){e.preventDefault();addRow()}
});

/* تعديل سطر موجود (الصنف والعدد والطول) */
function editRow(idx){
  const d=V.doors[T],rows=d.rows,r=rows[idx];if(!r)return;
  const cur=byCode(r.c);
  const S={cat:cur?cur.cat:ES.cat,comp:cur?cur.comp:ES.comp,code:r.c,q:'',n:String(r.n),l:+r.l?String(r.l):''};
  const render=focusSearch=>{
    const {cats,comps,dets,it}=cascade(catalog().filter(i=>!i.off||i.c===r.c),S);
    const len=it&&kindU(it.u)==='m';
    dlg(`<h3>تعديل السطر</h3><form id="rf" class="grid2">
     <div class="full"><input id="r_q" type="search" placeholder="🔍 ابحث بالاسم أو الكود" value="${esc(S.q)}"></div>
     <div><label class="l">الفئة</label><select id="r_c" ${S.q?'disabled':''}>${opts(cats,S.cat)}</select></div>
     <div><label class="l">المكوّن</label><select id="r_m" ${S.q?'disabled':''}>${opts(comps,S.comp)}</select></div>
     <div class="full"><label class="l">التفصيل</label><select id="r_d">${detOpts(dets,S.code)}</select></div>
     <div><label class="l">الوحدة</label><div class="unit ${it&&it.sg&&amAdmin()?'sug':''}">${it?esc(it.u):'--'}${it&&it.sg&&amAdmin()?' *':''}</div></div><div></div>
     <div><label class="l">${it&&kindU(it.u)==='a'?'الكمية':'العدد'}</label><input id="r_n" inputmode="decimal" value="${esc(S.n)}"></div>
     <div><label class="l">الطول (م)${len?' <b class="req">*</b>':''}</label><input id="r_l" inputmode="decimal" value="${len?esc(S.l):''}" ${len?'':'disabled placeholder="—"'}></div>
     <div class="full" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" onclick="QA.closeDlg()">إلغاء</button><button class="btn pri">حفظ التعديل</button></div></form>`);
    const keep=()=>{S.n=$('#r_n').value;if(!$('#r_l').disabled)S.l=$('#r_l').value};
    $('#r_q').oninput=e=>{keep();S.q=e.target.value.trim();render(true)};
    $('#r_c').onchange=e=>{keep();S.cat=e.target.value;S.comp='';render()};
    $('#r_m').onchange=e=>{keep();S.comp=e.target.value;render()};
    $('#r_d').onchange=e=>{keep();S.code=e.target.value;render()};
    if(focusSearch){const s=$('#r_q');s.focus();s.setSelectionRange(s.value.length,s.value.length)}
    $('#rf').onsubmit=ev=>{
      ev.preventDefault();keep();
      const ni=byCode(S.code);if(!ni){toast('اختر صنفاً');return}
      const n=parseNum(S.n);if(!(n>0)){toast('أدخل عدداً أكبر من صفر');return}
      const nlen=kindU(ni.u)==='m';let l=nlen?parseNum(S.l):0;
      if(nlen&&!(l>0)){toast(l===null?'أدخل الطول بالمتر — مطلوب لهذا الصنف':'الطول غير صالح');return}
      if(!nlen)l=0;
      Object.assign(r,{c:ni.c,n:n,l:nlen?l:0,x:snapOf(ni)});
      const dup=rows.findIndex((x,k)=>k!==idx&&x.c===r.c&&(!nlen||+x.l===+r.l));
      if(dup>=0){rows[dup].n=r2(+rows[dup].n+n);rows.splice(idx,1)}
      closeDlg();drawTable();drawTabs();autosave();toast(dup>=0?'عُدّل السطر ودُمج مع سطر مماثل':'تم تعديل السطر');
    };
  };
  render();
}

/* ---------- الإجمالي ---------- */
function totals(v){
  v=v||V;const m=new Map();
  v.doors.forEach((d,di)=>d.rows.forEach(r=>{
    if(!m.has(r.c))m.set(r.c,{c:r.c,x:info(r,v),v:0,per:new Array(v.doors.length).fill(0)});
    const o=m.get(r.c),q=qtyOf(r,v);o.v+=q;o.per[di]+=q;
  }));
  return [...m.values()].map((o,k)=>Object.assign(o,{v:r2(o.v),per:o.per.map(r2),n:k+1}));
}
function issues(v){
  v=v||V;const out=[];
  const miss=v.doors.reduce((s,d)=>s+d.rows.filter(r=>missingLen(r,v)).length,0);
  if(miss)out.push(`${miss} سطر من أصناف المتر بلا طول (كميتها صفر)`);
  const empty=v.doors.filter(d=>!d.rows.length).map(d=>d.name);
  if(empty.length)out.push('أبواب بلا أصناف: '+empty.join('، '));
  const unk=v.doors.reduce((s,d)=>s+d.rows.filter(r=>info(r,v).missing).length,0);
  if(unk)out.push(`${unk} سطر لأصناف غير موجودة في الكتالوج`);
  if(!String(v.mo||'').trim())out.push('رقم أمر التصنيع (MO) فارغ');
  return out;
}
function totalsHTML(){
  const iss=issues();
  const head=`${iss.length?`<div class="note warnbox">⚠ ${iss.map(esc).join(' · ')}</div>`:''}<div class="bar"><span style="color:var(--mut)">مجموع كل كود عبر ${V.doors.length} ${V.doors.length>2&&V.doors.length<11?'أبواب':'باب'}. هذا ما يُدخل في برنامج الشركة.</span><span class="sp"></span>
   <button class="btn sm ${SM==='sum'?'on':''}" onclick="QA.sm('sum')">مجمّع</button><button class="btn sm ${SM==='door'?'on':''}" onclick="QA.sm('door')">حسب الباب</button>
   <button class="btn sm" onclick="QA.copyAll()">نسخ الكل</button></div>`;
  if(SM==='door'){
    return head+V.doors.map(d=>`<h3 style="margin:14px 0 6px;color:var(--brand-t)">${esc(d.name)}</h3><div style="overflow-x:auto"><table><thead><tr><th>م</th><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th></tr></thead><tbody>${numbered(d.rows).map(({r,n})=>{const x=info(r);return `<tr class="${missingLen(r)?'warnrow':''}"><td>${n}</td><td class="code">${esc(r.c)}</td><td>${esc(labelOf(x))}</td><td>${esc(x.u)}</td><td class="qty">${fmt(qtyOf(r))}</td></tr>`}).join('')||'<tr><td colspan="5" class="empty">فارغ</td></tr>'}</tbody></table></div>`).join('');
  }
  const t=totals();
  return head+`<div style="overflow-x:auto"><table><thead><tr><th>م</th><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>الكمية الإجمالية</th><th></th></tr></thead><tbody>
  ${t.length?t.map(o=>`<tr><td>${o.n}</td><td class="code">${esc(o.c)}</td><td>${esc(labelOf(o.x))}</td><td>${esc(o.x.u)}</td><td class="qty">${fmt(o.v)}</td><td><button class="btn sm" data-copy="${o.n-1}">نسخ</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">لا أصناف بعد.</td></tr>'}</tbody></table></div>`;
}
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('[data-copy]');if(!b||!V)return;
  const o=totals()[+b.dataset.copy];if(o)copyText(o.c+'\t'+fmt(o.v),'نُسخ: '+o.c+' — '+fmt(o.v));
});
function copyText(txt,msg){
  const done=()=>toast(msg);
  if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(txt).then(done,()=>fallbackCopy(txt,done));
  else fallbackCopy(txt,done);
}
function fallbackCopy(txt,done){const a=document.createElement('textarea');a.value=txt;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy');done()}catch(e){toast('تعذّر النسخ')}a.remove()}

/* ---------- الأبواب والحالة ---------- */
function addDoor(){if(locked())return;V.doors.push({id:uid(),name:'باب '+(V.doors.length+1),rows:[]});T=V.doors.length-1;drawAll();autosave()}
function delDoor(){
  if(locked())return;
  const d=V.doors[T];
  if(d.rows.length&&!confirm('حذف «'+d.name+'» وكل أصنافه؟'))return;
  V.doors.splice(T,1);if(!V.doors.length)V.doors.push({id:uid(),name:'باب 1',rows:[]});
  T=Math.min(T,V.doors.length-1);drawAll();autosave();
}
/* الاعتماد: شروط إلزامية تمنع الاعتماد، وتنبيهات يمكن تجاوزها، ثم تأكيد دائماً */
function markDone(){
  if(!V||locked())return;
  const hard=[],soft=[];
  const rows=V.doors.reduce((s,d)=>s+d.rows.length,0);
  const miss=V.doors.reduce((s,d)=>s+d.rows.filter(r=>missingLen(r)).length,0);
  if(!String(V.mo||'').trim())hard.push('رقم أمر التصنيع (MO) فارغ');
  if(!rows)hard.push('لا توجد أصناف في السند');
  if(miss)hard.push(`${miss} سطر من أصناف المتر بلا طول`);
  const empty=V.doors.filter(d=>!d.rows.length).map(d=>d.name);
  if(rows&&empty.length)soft.push('أبواب بلا أصناف: '+empty.join('، '));
  const unk=V.doors.reduce((s,d)=>s+d.rows.filter(r=>info(r).missing).length,0);
  if(unk)soft.push(`${unk} سطر لأصناف غير موجودة في الكتالوج`);
  if(hard.length){alert('لا يمكن اعتماد السند قبل إكمال ما يلي:\n\n• '+hard.join('\n• '));return}
  const msg=(soft.length?'تنبيه:\n• '+soft.join('\n• ')+'\n\n':'')+'الاعتماد يقفل السند'+(amAdmin()?' (يمكنك إعادة فتحه لاحقاً).':'، ولا يمكن تعديله بعدها إلا عن طريق المدير.')+'\n\nهل تريد اعتماد السند؟';
  if(!confirm(msg))return;
  V.doors.forEach(d=>d.rows.forEach(r=>{const i=byCode(r.c);if(i)r.x=snapOf(i)}));   // تثبيت بيانات الأصناف
  V.status='done';V.doneAt=Date.now();dirty=true;persist();
  toast('تم اعتماد السند '+V.no);location.hash='#/list';
}
/* إعادة فتح السند المعتمد — للمدير فقط */
function reopen(){
  if(!V||!amAdmin())return;
  if(!confirm('إعادة فتح السند للتعديل؟ سيعود «مسودة» ويتبع الكتالوج الحالي حتى يُعتمد مرة أخرى.'))return;
  VIEWONLY=false;V.status='draft';dirty=true;persist();viewVoucher(V.id);
}
function preflight(what){
  const iss=issues();
  return !iss.length||confirm('تنبيه قبل '+what+':\n\n• '+iss.join('\n• ')+'\n\nمتابعة؟');
}
const fileBase=v=>('سند إنتاج '+v.no+(v.mo?' - '+v.mo:'')).replace(/[\\/:*?"<>|]/g,'-');

/* ---------- التصدير إلى Excel ---------- */
const XC={brand:'FF721512',brandL:'FFF6E9E8',zebra:'FFFBF8F7',warn:'FFFFF2C7',line:'FFCDBFBB',mut:'FF6F6461',ink:'FF2A2220'};
const thin={style:'thin',color:{argb:XC.line}};
const BOX={top:thin,left:thin,bottom:thin,right:thin};
const FONT='Arial';
function safeName(s,used){
  let n=String(s||'باب').replace(/[\[\]\*\?\/\\:']/g,'-').trim().slice(0,28)||'باب';
  let k=n,c=2;while(used.has(k.toLowerCase()))k=n.slice(0,25)+' '+(c++);used.add(k.toLowerCase());return k;
}
const colL=n=>{let s='';n++;while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26)}return s};
/* ترويسة موحّدة لكل ورقة مطبوعة: الشعار + العنوان + بيانات السند */
function xHeader(wb,ws,v,ncols,logoId,title,info2){
  const last=ncols-1;
  ws.getRow(1).height=30;ws.getRow(2).height=20;ws.getRow(3).height=5;ws.getRow(4).height=8;
  if(logoId!=null)ws.addImage(logoId,{tl:{col:0.15,row:0.2},ext:{width:150,height:56},editAs:'oneCell'});
  ws.mergeCells(1,3,1,ncols);ws.mergeCells(2,3,2,ncols);
  const t=ws.getCell(1,3);t.value=title;t.font={name:FONT,size:18,bold:true,color:{argb:XC.brand}};t.alignment={horizontal:'left',vertical:'middle'};
  const s=ws.getCell(2,3);s.value=COMPANY+' — قسم الإنتاج';s.font={name:FONT,size:10,color:{argb:XC.mut}};s.alignment={horizontal:'left',vertical:'middle'};
  for(let c=1;c<=ncols;c++)ws.getCell(3,c).fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.brand}};
  const pairs=[['رقم السند',v.no,'رقم MO',v.mo||'—'],['التاريخ',v.date||'','الزبون',v.customer||'—'],info2];
  pairs.forEach((p,k)=>{
    const R=5+k;ws.getRow(R).height=19;
    ws.mergeCells(R,1,R,2);ws.mergeCells(R,5,R,ncols);
    [[1,p[0],1],[3,p[1],0],[4,p[2],1],[5,p[3],0]].forEach(([c,val,lab])=>{
      const cell=ws.getCell(R,c);cell.value=val;
      cell.font={name:FONT,size:10,bold:!!lab||c===3&&k===0,color:{argb:lab?XC.brand:XC.ink}};
      cell.alignment={horizontal:'right',vertical:'middle',indent:1};
      if(lab)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.brandL}};
    });
    for(let c=1;c<=ncols;c++)ws.getCell(R,c).border=BOX;
  });
  ws.getCell(5,3).numFmt='@';
}
function xTableHead(ws,R,labels){
  const row=ws.getRow(R);row.height=22;
  labels.forEach((h,k)=>{const c=row.getCell(k+1);c.value=h;c.font={name:FONT,size:10,bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.brand}};c.alignment={horizontal:'center',vertical:'middle',wrapText:true};c.border=BOX});
}
function xCellStyle(c,{align='center',fill,bold,fmt,color}={}){
  c.font={name:FONT,size:10,bold:!!bold,color:{argb:color||XC.ink}};
  c.alignment={horizontal:align,vertical:'middle',wrapText:align==='right',indent:align==='right'?1:0};
  c.border=BOX;if(fill)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};if(fmt)c.numFmt=fmt;
}
function xSignatures(ws,R,ncols,v){
  const who=v.byName||USER.name||USER.email||'';
  const third=Math.max(1,Math.floor(ncols/3));
  const spans=[[1,third],[third+1,third*2],[third*2+1,ncols]];
  [['أعدّه',who],['دقّقه',''],['اعتمده','']].forEach(([lab,name],k)=>{
    const [a,b]=spans[k];
    ws.mergeCells(R,a,R,b);ws.mergeCells(R+1,a,R+2,b);
    const c=ws.getCell(R,a);c.value=lab+(name?': '+name:'');c.font={name:FONT,size:10,bold:true,color:{argb:XC.brand}};c.alignment={horizontal:'center'};
    const s=ws.getCell(R+1,a);s.value='التوقيع: ..............................';s.font={name:FONT,size:9,color:{argb:XC.mut}};s.alignment={horizontal:'center',vertical:'bottom'};
  });
  ws.getRow(R+1).height=18;ws.getRow(R+2).height=18;
}
function xPage(ws,v,landscape,titleRow){
  ws.pageSetup={paperSize:9,orientation:landscape?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,horizontalCentered:true,
    margins:{left:0.4,right:0.4,top:0.45,bottom:0.6,header:0.2,footer:0.25},printTitlesRow:titleRow+':'+titleRow};
  ws.headerFooter={oddFooter:'&L&8'+COMPANY+'&C&8&P / &N&R&8'+String(v.no).replace(/&/g,'&&')};
  ws.views=[{rightToLeft:true,showGridLines:false}];
}
async function exportXlsx(){
  if(!window.ExcelJS){toast('مكتبة التصدير غير محمّلة');return}
  if(isNewV()&&!dirty){toast('السند فارغ — أدخل بياناته أولاً');return}
  if(!preflight('التصدير'))return;
  await Promise.race([flush(),sleep(1500)]);      // لا ننتظر طويلاً إن كان الاتصال مقطوعاً
  const v=V,wb=new ExcelJS.Workbook();
  wb.creator='سندات الإنتاج — '+COMPANY;wb.created=new Date();
  let logo=null;try{if(window.QOU_LOGO)logo=wb.addImage({base64:window.QOU_LOGO,extension:'png'})}catch(e){}
  const used=new Set(),who=v.byName||USER.name||USER.email;
  const tot=totals(v),ND=v.doors.length,showPer=ND>1&&ND<=8;
  const DR=v.status==='done'?'':' (مسودة — غير معتمد)';

  /* 1) الملخص */
  const sh=wb.addWorksheet(safeName('الملخص',used));
  const sCols=[6,13,44,11].concat(showPer?v.doors.map(()=>11):[]).concat([14]);
  sCols.forEach((w,k)=>sh.getColumn(k+1).width=w);
  const NS=sCols.length;
  xHeader(wb,sh,v,Math.max(NS,6),logo,'سند إنتاج — ملخص الكميات'+DR,['عدد الأبواب',ND,'أعدّه',who]);
  const sHead=['م','الكود','الصنف','الوحدة'].concat(showPer?v.doors.map((d,k)=>'باب '+(k+1)):[]).concat(['الإجمالي']);
  xTableHead(sh,9,sHead);
  tot.forEach((o,k)=>{
    const R=10+k,row=sh.getRow(R),z=k%2?XC.zebra:null;
    row.getCell(1).value=o.n;row.getCell(2).value=o.c;row.getCell(3).value=labelOf(o.x);row.getCell(4).value=o.x.u;
    [1,2,4].forEach(c=>xCellStyle(row.getCell(c),{fill:z}));xCellStyle(row.getCell(3),{align:'right',fill:z});row.getCell(2).numFmt='@';
    let c=5;
    if(showPer)o.per.forEach(q=>{const cl=row.getCell(c++);cl.value=q||null;xCellStyle(cl,{fill:z,fmt:'#,##0.00;-#,##0.00;"–"'})});
    const tc=row.getCell(c);
    tc.value=showPer?{formula:`SUM(${colL(4)}${R}:${colL(c-2)}${R})`,result:o.v}:o.v;
    xCellStyle(tc,{fill:XC.brandL,bold:true,fmt:'#,##0.00'});
  });
  let R=10+tot.length;
  if(!tot.length){sh.mergeCells(R,1,R,NS);sh.getCell(R,1).value='لا أصناف';R++}
  R+=1;sh.getCell(R,1).value=`عدد الأصناف: ${tot.length}   ·   عدد الأبواب: ${ND}`;sh.getCell(R,1).font={name:FONT,size:9,color:{argb:XC.mut}};
  if(showPer)v.doors.forEach((d,k)=>{R++;sh.mergeCells(R,1,R,NS);const c=sh.getCell(R,1);c.value=`باب ${k+1}: ${d.name||''}`;c.font={name:FONT,size:9,color:{argb:XC.mut}}});
  xSignatures(sh,R+2,NS,v);xPage(sh,v,NS>8,9);

  /* 2) ورقة لكل باب */
  const dCols=[6,13,30,24,10,9,10,11];
  const dHead=['م','الكود','اسم الصنف','ملحق الاسم','الوحدة','العدد','الطول (م)','الكمية'];
  v.doors.forEach((d,di)=>{
    const ws=wb.addWorksheet(safeName(d.name||'باب '+(di+1),used));
    dCols.forEach((w,k)=>ws.getColumn(k+1).width=w);
    xHeader(wb,ws,v,8,logo,'سند إنتاج — باب '+(di+1)+DR,['الباب',d.name||'باب '+(di+1),'أعدّه',who]);
    xTableHead(ws,9,dHead);
    let miss=0;
    numbered(d.rows).forEach(({r,n},k)=>{
      const R=10+k,row=ws.getRow(R),x=info(r,v),len=kindU(x.u)==='m',ml=len&&!(+r.l>0);if(ml)miss++;
      const z=ml?XC.warn:(k%2?XC.zebra:null);
      row.getCell(1).value=n;row.getCell(2).value=r.c;row.getCell(3).value=x.n;row.getCell(4).value=x.s||'';row.getCell(5).value=x.u;
      row.getCell(6).value=+r.n;
      row.getCell(7).value=len?(+r.l||null):'—';
      row.getCell(8).value=len?{formula:`F${R}*G${R}`,result:qtyOf(r,v)}:{formula:`F${R}`,result:qtyOf(r,v)};
      [1,2,5].forEach(c=>xCellStyle(row.getCell(c),{fill:z}));row.getCell(2).numFmt='@';
      xCellStyle(row.getCell(3),{align:'right',fill:z});xCellStyle(row.getCell(4),{align:'right',fill:z,color:XC.mut});
      xCellStyle(row.getCell(6),{fill:z,fmt:'#,##0.##'});xCellStyle(row.getCell(7),{fill:z,fmt:'#,##0.00',color:len?XC.ink:XC.mut});
      xCellStyle(row.getCell(8),{fill:ml?XC.warn:XC.brandL,bold:true,fmt:'#,##0.00'});
    });
    let R=10+d.rows.length;
    if(!d.rows.length){ws.mergeCells(R,1,R,8);ws.getCell(R,1).value='لا أصناف في هذا الباب';ws.getCell(R,1).alignment={horizontal:'center'};R++}
    R+=1;ws.getCell(R,1).value=`عدد الأسطر: ${d.rows.length}`+(miss?`   ·   ⚠ ${miss} سطر مظلل بالأصفر بلا طول`:'');
    ws.getCell(R,1).font={name:FONT,size:9,color:{argb:miss?'FF9A6B00':XC.mut},bold:!!miss};
    xSignatures(ws,R+2,8,v);xPage(ws,v,false,9);
  });

  /* 3) بيانات خام بتخطيط سنداتكم القديم — للنسخ أو الاستيراد إلى برنامج الشركة */
  const raw=wb.addWorksheet(safeName('بيانات',used),{views:[{rightToLeft:true,state:'frozen',ySplit:1}]});
  raw.addRow(['المجموعة','الرقم','اسم الصنف','ملحق الاسم','الوحدة','التسلسل','العدد','الطول','الكمية','الباب']);
  [30,13,30,26,10,8,8,8,10,26].forEach((w,k)=>raw.getColumn(k+1).width=w);
  raw.getRow(1).eachCell(c=>{c.font={name:FONT,bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.brand}};c.alignment={horizontal:'center'}});
  v.doors.forEach(d=>numbered(d.rows).forEach(({r,n})=>{
    const x=info(r,v),len=kindU(x.u)==='m';
    const row=raw.addRow([x.g||'',r.c,x.n,x.s||'',x.u,String(n),+r.n,len?+r.l:0,qtyOf(r,v),d.name]);
    row.getCell(2).numFmt='@';row.font={name:FONT,size:10};
  }));
  raw.autoFilter={from:'A1',to:'J1'};
  raw.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1',margins:{left:0.3,right:0.3,top:0.4,bottom:0.5,header:0.2,footer:0.25}};

  const buf=await wb.xlsx.writeBuffer();
  download(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),fileBase(v)+'.xlsx');
  toast('تم التصدير: '+fileBase(v)+'.xlsx');
}
function download(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
}

/* ---------- الطباعة و PDF ---------- */
function printHTML(v){
  const who=v.byName||USER.name||USER.email;
  const tot=totals(v),ND=v.doors.length,showPer=ND>1&&ND<=6;
  const sum=`<section class="psec"><h3>ملخص الكميات</h3><table class="ptab"><thead><tr><th class="c">م</th><th>الكود</th><th>الصنف</th><th class="c">الوحدة</th>${showPer?v.doors.map((d,k)=>`<th class="c n" title="${esc(d.name)}">باب ${k+1}</th>`).join(''):''}<th class="c n">الإجمالي</th></tr></thead><tbody>
    ${tot.map(o=>`<tr><td class="c">${o.n}</td><td class="code">${esc(o.c)}</td><td>${esc(labelOf(o.x))}</td><td class="c">${esc(o.x.u)}</td>${showPer?o.per.map(q=>`<td class="c n">${q?fmt(q):'–'}</td>`).join(''):''}<td class="c n tot">${fmt(o.v)}</td></tr>`).join('')||`<tr><td colspan="9" class="c">لا أصناف</td></tr>`}</tbody></table>${showPer?`<div class="plegend">${v.doors.map((d,k)=>`<span><b>باب ${k+1}:</b> ${esc(d.name||'باب '+(k+1))}</span>`).join('')}</div>`:''}</section>`;
  const doors=v.doors.map((d,di)=>{
    const miss=d.rows.filter(r=>missingLen(r,v)).length;
    return `<section class="psec"><h3>باب ${di+1}: ${esc(d.name||'')} <span>${d.rows.length} سطر${miss?` · ⚠ ${miss} بلا طول`:''}</span></h3><table class="ptab"><thead><tr><th class="c">م</th><th>الكود</th><th>اسم الصنف</th><th>ملحق الاسم</th><th class="c">الوحدة</th><th class="c n">العدد</th><th class="c n">الطول (م)</th><th class="c n">الكمية</th></tr></thead><tbody>
    ${numbered(d.rows).map(({r,n})=>{const x=info(r,v),len=kindU(x.u)==='m',ml=len&&!(+r.l>0);return `<tr class="${ml?'pw':''}"><td class="c">${n}</td><td class="code">${esc(r.c)}</td><td>${esc(x.n)}</td><td class="mut">${esc(x.s)}</td><td class="c">${esc(x.u)}</td><td class="c n">${fmt(r.n)}</td><td class="c n">${len?(ml?'—':fmt(r.l)):'<span class="mut">—</span>'}</td><td class="c n tot">${fmt(qtyOf(r,v))}</td></tr>`}).join('')||'<tr><td colspan="8" class="c">لا أصناف</td></tr>'}</tbody></table></section>`;
  }).join('');
  return `<div class="pv">
   <header class="ph"><img src="img/logo-word.png" alt=""><div class="pt"><div class="t1">سند إنتاج</div><div class="t2">${COMPANY} — قسم الإنتاج</div></div><div class="pno"><span>رقم السند</span><b>${esc(v.no)}</b></div></header>
   <table class="pinfo"><tr><th>رقم MO</th><td class="code">${esc(v.mo||'—')}</td><th>التاريخ</th><td>${esc(v.date||'')}</td><th>الزبون</th><td>${esc(v.customer||'—')}</td></tr>
   <tr><th>عدد الأبواب</th><td>${ND}</td><th>عدد الأصناف</th><td>${tot.length}</td><th>الحالة</th><td>${v.status==='done'?'معتمد':'مسودة — غير معتمد'}</td></tr></table>
   ${v.status==='done'?'':'<div class="pwm">مسودة — غير معتمد</div><div class="pdraft">مسودة — غير معتمد · لا تُستخدم للإنتاج قبل اعتماد السند</div>'}
   ${sum}${doors}
   <section class="pend"><div class="psig"><div><b>أعدّه</b><span>${esc(who)}</span><i>التوقيع</i></div><div><b>دقّقه</b><span>&nbsp;</span><i>التوقيع</i></div><div><b>اعتمده</b><span>&nbsp;</span><i>التوقيع</i></div></div>
   <div class="pf">طُبع من برنامج سندات الإنتاج — ${new Date().toLocaleString('ar',{dateStyle:'medium',timeStyle:'short'})}</div></section></div>`;
}
async function printV(asPdf){
  if(isNewV()&&!dirty){toast('السند فارغ — أدخل بياناته أولاً');return}
  if(!preflight(asPdf?'حفظ PDF':'الطباعة'))return;
  await Promise.race([flush(),sleep(1500)]);
  const pa=$('#printArea');pa.innerHTML=printHTML(V);
  await Promise.all([...pa.querySelectorAll('img')].map(i=>i.decode?i.decode().catch(()=>{}):Promise.resolve()));
  if(document.fonts&&document.fonts.ready)await document.fonts.ready;
  const old=document.title;document.title=fileBase(V);   // اسم ملف PDF المقترح
  if(asPdf)toast('في نافذة الطباعة اختر الوجهة «حفظ بتنسيق PDF» ثم «حفظ»',null,6000);
  const restore=()=>{document.title=old;window.removeEventListener('afterprint',restore)};
  window.addEventListener('afterprint',restore);
  setTimeout(()=>window.print(),asPdf?350:50);
}

/* ---------- الكتالوج ---------- */
let CQ='',CS=false;
const UNITS=['قطعة','متر طول','متر','م.ط','متر مربع','كغم'];
function viewCatalog(){
  document.title='الكتالوج — سندات الإنتاج';
  const all=catalog(),q=CQ.trim().toLowerCase();
  const rows=all.filter(i=>(!q||(labelOf(i)+' '+i.c).toLowerCase().includes(q))&&(!CS||i.sg));
  const nsg=all.filter(i=>i.sg).length;
  $('#app').innerHTML=header()+`<div class="wrap"><div class="bar"><h2 style="margin:0">الكتالوج</h2><span class="sp"></span>
   <button class="btn pri" onclick="QA.editItem('')">+ صنف جديد</button><button class="btn" onclick="QA.exportCat()">تصدير الكتالوج Excel</button><button class="btn danger" onclick="QA.resetCat()">إلغاء كل تعديلاتي</button></div>
  <div class="note">${all.length} صنف. ${nsg?`الأصناف ذات الخلفية الصفراء وحدتها <b>مقترحة</b> وتحتاج تأكيداً (${nsg} صنف): اضغط «تعديل» ثم «حفظ» لاعتمادها. `:''}تعديلات الكتالوج تُحفظ في هذا المتصفح فقط (الكتالوج غير متزامن أونلاين)؛ لتعميمها على كل الأجهزة صدّر الكتالوج وأرسله لتحديث ملف catalog-data.js.</div>
  <div class="tools"><input type="search" id="cq" placeholder="🔍 بحث بالاسم أو الكود" value="${esc(CQ)}"><label><input type="checkbox" id="cs" ${CS?'checked':''} style="width:auto"> الوحدات المقترحة فقط</label></div>
  <div class="card" style="padding:6px 12px;overflow-x:auto"><table><thead><tr><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>الفئة / المكوّن</th><th>الحالة</th><th></th></tr></thead><tbody>
  ${rows.map(i=>`<tr style="${i.sg?'background:var(--warn)':''}${i.off?';opacity:.55':''}"><td class="code">${esc(i.c)}</td><td>${esc(labelOf(i))}</td><td>${esc(i.u)}${i.sg?' <span class="sug-star">*</span>':''}</td><td>${esc(i.cat)} / ${esc(i.comp)}</td><td>${i.off?'موقوف':'فعّال'}${i.ex&&!i.added?' · من البرنامج السابق':''}${i.added?' · أضفته أنت':''}</td><td><button class="btn sm" data-item="${esc(i.c)}">تعديل</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">لا نتائج.</td></tr>'}
  </tbody></table></div></div>`;
  $('#cq').oninput=e=>{CQ=e.target.value;const p=e.target.selectionStart;viewCatalog();const n=$('#cq');n.focus();n.setSelectionRange(p,p)};
  $('#cs').onchange=e=>{CS=e.target.checked;viewCatalog()};
}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-item]');if(b)editItem(b.dataset.item)});
function editItem(code){
  const i=code?byCode(code):{c:'',g:'Rolling Shutter Doors Components',n:'',s:'',u:'قطعة',cat:'أخرى',comp:'قطع متفرقة'};
  if(!i)return;
  const isNew=!code;
  dlg(`<h3>${isNew?'صنف جديد':'تعديل صنف'}</h3><form id="cf" class="grid2">
   <div><label class="l">الكود</label><input id="f_c" value="${esc(i.c)}" ${isNew?'':'disabled'} required style="direction:ltr;text-align:right"></div>
   <div><label class="l">الوحدة</label><select id="f_u">${opts(UNITS.includes(i.u)?UNITS:UNITS.concat([i.u]),i.u)}</select></div>
   <div class="full"><label class="l">اسم الصنف</label><input id="f_n" value="${esc(i.n)}" required></div>
   <div class="full"><label class="l">ملحق الاسم</label><input id="f_s" value="${esc(i.s)}"></div>
   <div><label class="l">الفئة</label><input id="f_cat" value="${esc(i.cat)}" list="dl_cat"></div>
   <div><label class="l">المكوّن</label><input id="f_comp" value="${esc(i.comp)}"></div>
   <div class="full"><label class="l">المجموعة (كما في برنامج الشركة)</label><select id="f_g">${opts(['Rolling Shutter Doors Components','Slats and Curtains'],i.g)}</select></div>
   <div class="full"><label><input type="checkbox" id="f_off" style="width:auto" ${i.off?'checked':''}> إيقاف الصنف (لا يظهر في الإدخال)</label></div>
   <div class="full" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" onclick="QA.closeDlg()">إلغاء</button><button class="btn pri">حفظ</button></div>
   <datalist id="dl_cat"><option>دنجل</option><option>الحلق</option><option>الوجه</option><option>أخرى</option></datalist></form>`);
  $('#cf').onsubmit=e=>{
    e.preventDefault();
    const c=$('#f_c').value.trim();if(!c)return;
    if(isNew&&byCode(c)){alert('هذا الكود موجود مسبقاً.');return}
    const v={g:$('#f_g').value,n:$('#f_n').value.trim(),s:$('#f_s').value.trim(),u:$('#f_u').value,cat:$('#f_cat').value.trim()||'أخرى',comp:$('#f_comp').value.trim()||'قطع متفرقة',off:$('#f_off').checked,sg:0};
    const o=catData();
    if(isNew)o.add.push(Object.assign({c:c,ex:0},v));else o.over[c]=v;
    if(jset(CK,o)){catReset();closeDlg();viewCatalog();toast('تم حفظ الصنف')}
  };
}
async function exportCat(){
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('الأصناف',{views:[{rightToLeft:true,state:'frozen',ySplit:1}]});
  ws.addRow(['المجموعة','الرقم','اسم الصنف','ملحق الاسم','الوحدة','الفئة','المكوّن','وحدة مقترحة','موقوف']);
  [30,14,34,26,10,10,18,12,8].forEach((w,k)=>ws.getColumn(k+1).width=w);
  ws.getRow(1).eachCell(c=>{c.font={name:FONT,bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.brand}}});
  catalog().forEach(i=>{const r=ws.addRow([i.g,i.c,i.n,i.s||'',i.u,i.cat,i.comp,i.sg?'نعم':'',i.off?'نعم':'']);r.getCell(2).numFmt='@'});
  ws.autoFilter={from:'A1',to:'I1'};
  download(new Blob([await wb.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'كتالوج الأصناف.xlsx');
}
function resetCat(){if(!confirm('إلغاء كل تعديلاتك على الكتالوج في هذا المتصفح؟'))return;try{localStorage.removeItem(CK)}catch(e){}catReset();viewCatalog();toast('تمت إعادة الكتالوج الأساسي')}

/* ---------- لوحة المستخدمين (للمدير فقط) ---------- */
async function viewUsers(){
  if(USER.role!=='admin'){location.hash='#/list';return}
  document.title='المستخدمون — سندات الإنتاج';
  $('#app').innerHTML=header()+`<div class="wrap"><div class="bar"><h2 style="margin:0">المستخدمون</h2><span class="sp"></span>
   <button class="btn pri" onclick="QA.newUser()">+ مستخدم جديد</button></div>
   <div class="card" style="padding:6px 12px;overflow-x:auto" id="utbl">جارٍ التحميل…</div></div>`;
  let snap;
  try{snap=await getDocs(usersCol)}catch(e){$('#utbl').textContent='تعذّر تحميل المستخدمين: '+(e&&e.message||'');return}
  const rows=snap.docs.map(d=>Object.assign({uid:d.id},d.data()));
  $('#utbl').innerHTML=`<table><thead><tr><th>الاسم</th><th>الدور</th><th>بادئة رقم السند</th><th>البريد</th><th>الحالة</th><th></th></tr></thead><tbody>
  ${rows.map(u=>{
    const active=u.active!==false;
    const self=u.uid===USER.u;
    return `<tr><td>${esc(u.name||'')}</td><td><span class="badge ${u.role==='admin'?'ok':'d'}">${u.role==='admin'?'مدير':'مستخدم'}</span></td><td class="code">${esc(u.prefix||'')}</td><td class="code" style="direction:ltr;text-align:right">${esc(u.email||'—')}</td>
    <td><span class="badge ${active?'ok':'d'}">${active?'نشط':'موقوف'}</span></td>
    <td style="white-space:nowrap;display:flex;gap:6px">
     <button class="btn sm" onclick="QA.adminPwCmd('${u.uid}','${esc(u.email||'')}','${esc(u.name||u.email||'')}')">كلمة المرور</button>
     ${self?'':`<button class="btn sm" onclick="QA.toggleActive('${u.uid}','${esc(u.name||u.email||'')}',${active})">${active?'إيقاف':'تفعيل'}</button>`}
    </td></tr>`;
  }).join('')||'<tr><td colspan="6" class="empty">لا يوجد مستخدمون.</td></tr>'}
  </tbody></table>`;
}
/* تفعيل/إيقاف حساب مستخدم — تُحفَظ الحالة في Firestore مباشرة (بدون خادم)،
   وقواعد أمان Firestore هي من تمنع فعلياً أي قراءة/كتابة لسندات الحساب الموقوف،
   كما أن onAuthStateChanged يسجّل خروج أي حساب موقوف فور اكتشافه عند الدخول. */
async function toggleActive(targetUid,label,currentlyActive){
  const next=!currentlyActive;
  if(!confirm((next?'تفعيل':'إيقاف')+' حساب '+label+'؟'))return;
  try{
    await setDoc(doc(db,'users',targetUid),{active:next},{merge:true});
    toast(next?'تم تفعيل الحساب':'تم إيقاف الحساب');
    viewUsers();
  }catch(err){alert('تعذّر: '+(err&&err.message||''))}
}
/* تغيير كلمة مرور مستخدم آخر يحتاج صلاحيات Admin SDK، وهذه لا تتوفر من المتصفح بأمان
   بدون خادم (Vercel/Cloud Functions)، وقد تقرّر الاستغناء عن كليهما. البديل: أداة سطر أوامر
   صغيرة (admin-tools) تشغّلها من جهازك عند الحاجة فقط — مجانية تماماً ولا تحتاج استضافة.
   هذه النافذة تجهّز لك الأمر الجاهز للنسخ. */
function adminPwCmd(targetUid,email,label){
  dlg(`<h3>تغيير كلمة مرور: ${esc(label)}</h3>
   <div style="color:var(--mut);font-size:13px;margin-bottom:10px">هذا يتطلب تشغيل أمر من جهازك مرة واحدة (أداة <code>admin-tools</code> المرفقة مع المشروع) — لا يمكن تنفيذه من المتصفح مباشرة.</div>
   <form id="apf" class="grid2">
   <div class="full"><label class="l">كلمة المرور الجديدة (٦ أحرف على الأقل)</label><input id="ap_new" type="password" required minlength="6" autocomplete="new-password"></div>
   <div class="full"><label class="l">الأمر (انسخه وشغّله من مجلد المشروع)</label>
    <textarea id="ap_cmd" readonly style="width:100%;min-height:70px;direction:ltr;text-align:left;font-family:monospace;font-size:12px" placeholder="اكتب كلمة المرور أعلاه أولاً"></textarea></div>
   <div class="full" style="display:flex;gap:8px;justify-content:flex-end">
    <button type="button" class="btn" onclick="QA.closeDlg()">إغلاق</button>
    <button type="button" class="btn pri" id="ap_copy">نسخ الأمر</button></div></form>`);
  const upd=()=>{
    const pw=$('#ap_new').value;
    $('#ap_cmd').value=pw?`node admin-tools/manage-users.js set-password "${email}" "${pw.replace(/"/g,'\\"')}"`:'';
  };
  $('#ap_new').oninput=upd;upd();
  $('#ap_copy').onclick=()=>{const t=$('#ap_cmd');if(!t.value){toast('اكتب كلمة المرور أولاً');return}t.select();copyText(t.value,'نُسخ الأمر — شغّله من جهازك')};
}
function newUser(){
  dlg(`<h3>مستخدم جديد</h3><form id="uf" class="grid2">
   <div class="full"><label class="l">الاسم الظاهر</label><input id="u_name" required></div>
   <div><label class="l">اسم الدخول (بدون بريد)</label><input id="u_login" required placeholder="مثال: user3" style="direction:ltr;text-align:right"></div>
   <div><label class="l">بادئة رقم السند (حرف واحد)</label><input id="u_prefix" required maxlength="3" style="direction:ltr;text-align:right" placeholder="C"></div>
   <div><label class="l">الدور</label><select id="u_role"><option value="user">مستخدم عادي</option><option value="admin">مدير</option></select></div>
   <div><label class="l">كلمة المرور الابتدائية</label><input id="u_pw" required minlength="6" style="direction:ltr;text-align:right"></div>
   <div class="err full" id="u_err"></div>
   <div class="full" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" onclick="QA.closeDlg()">إلغاء</button><button class="btn pri">إنشاء</button></div></form>`);
  $('#uf').onsubmit=async e=>{
    e.preventDefault();
    const name=$('#u_name').value.trim(),login=$('#u_login').value.trim(),prefix=$('#u_prefix').value.trim().toUpperCase(),role=$('#u_role').value,pw=$('#u_pw').value;
    if(!name||!login||!prefix||pw.length<6){$('#u_err').textContent='الرجاء تعبئة كل الحقول (كلمة المرور ٦ أحرف على الأقل)';return}
    const email=toIdentifier(login);
    $('#u_err').textContent='جارٍ الإنشاء…';
    try{
      await adminCreateUser(email,pw,name,prefix,role);
      closeDlg();toast('تم إنشاء المستخدم: '+email);viewUsers();
    }catch(err){$('#u_err').textContent=loginErr(err)}
  };
}
/* ينشئ مستخدماً جديداً بدون تسجيل خروج المدير الحالي، عبر نسخة فرعية منفصلة من تطبيق Firebase */
async function adminCreateUser(email,password,name,prefix,role){
  const sec=initializeSecondaryApp(firebaseConfig,'secondary-'+Date.now());
  const secAuth=getAuth(sec);
  let newUid;
  try{
    const cred=await createUserWithEmailAndPassword(secAuth,email,password);
    newUid=cred.user.uid;
  }finally{
    try{await signOutSecondary(secAuth)}catch(e){}
    try{await deleteApp(sec)}catch(e){}
  }
  await setDoc(doc(db,'users',newUid),{role,name,prefix,email,active:true});
  return newUid;
}

/* ---------- النسخ الاحتياطي ---------- */
function backup(){
  if(!amAdmin())return;
  const lb=jget(BK(USER.u),0);
  dlg(`<h3>نسخة احتياطية</h3><p style="color:var(--mut);margin-top:0">سنداتك محفوظة أونلاين وتتزامن بين أجهزتك تلقائياً. هذه النسخة أرشيف خارجي إضافي (ملف JSON) يمكن الاحتفاظ به أو استخدامه لاستيراد سندات من ملف قديم.<br>آخر نسخة: <b>${lb?new Date(lb).toLocaleString('ar',{dateStyle:'medium',timeStyle:'short'}):'لا يوجد'}</b></p>
  <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" onclick="QA.expBackup()">تصدير نسخة (ملف JSON)</button>
  <label class="btn" style="cursor:pointer">استيراد نسخة<input type="file" accept=".json,application/json" id="bf" hidden></label><button class="btn" onclick="QA.closeDlg()">إغلاق</button></div>`);
  $('#bf').onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    try{
      const d=JSON.parse(await f.text());
      if(d.app!=='qou'||!Array.isArray(d.vouchers))throw new Error('x');
      const valid=d.vouchers.filter(v=>v&&v.id&&Array.isArray(v.doors)&&v.doors.every(x=>x&&Array.isArray(x.rows)));
      await flush();
      let add=0,upd=0;
      for(const v of valid){
        const cur=VOUCHERS.find(x=>x.id===v.id);
        v.ownerUid=USER.u;v.by=USER.u;v.byName=v.byName||USER.name||USER.email;
        if(!cur){add++}else if((v.updated||0)<=(cur.updated||0))continue;else upd++;
        try{await setDoc(doc(db,'vouchers',v.id),v)}catch(err){}
      }
      closeDlg();if(V){const id=V.id;V=null;VOWNERUID=null;if(location.hash==='#/v/'+id)route()}else route();
      toast(`تم الاستيراد: ${add} جديد، ${upd} محدَّث`+(valid.length<d.vouchers.length?`، تُجوهل ${d.vouchers.length-valid.length} تالف`:''));
    }catch(err){alert('الملف ليس نسخة احتياطية صالحة.')}
  };
}
function expBackup(){
  const d={app:'qou',v:3,user:USER.u,exported:new Date().toISOString(),vouchers:loadV(),catalog:catData()};
  download(new Blob([JSON.stringify(d)],{type:'application/json'}),'نسخة سندات الإنتاج '+(USER.name||USER.u)+' '+today()+'.json');
  jset(BK(USER.u),Date.now());
  if(location.hash==='#/list'||!location.hash)setTimeout(()=>{if(!V)viewList()},300);
}

/* ---------- التوجيه ---------- */
function route(){
  if(!AUTH_READY)return;              // ننتظر استجابة Firebase الأولى قبل أي توجيه
  if(!USER){closeVoucher();stopVouchersListener();viewLogin();return}
  const h=location.hash||'#/list';
  if(V&&h!==vHash(V))closeVoucher();
  closeDlg();window.scrollTo(0,0);
  if(h.startsWith('#/v/'))viewVoucher(h.slice(4));
  else if(h==='#/catalog'&&amAdmin())viewCatalog();
  else if(h==='#/users')viewUsers();
  else viewList();
}
window.addEventListener('hashchange',route);

window.QA={go:h=>{if(location.hash===h)route();else location.hash=h},logout,newV,delV,
  tab:i=>{T=i;drawAll()},addDoor,delDoor,markDone,reopen,
  saveDraft,editOther,print:printV,exportX:exportXlsx,
  sm:m=>{SM=m;drawPanel()},copyAll:()=>{const t=totals();if(!t.length)return toast('لا أصناف');copyText(t.map(o=>o.c+'\t'+fmt(o.v)).join('\n'),'نُسخ '+t.length+' صنف (الكود والكمية)')},
  editItem,exportCat,resetCat,backup,expBackup,closeDlg,changePw,newUser,adminPwCmd,toggleActive};

/* ---------- حالة الدخول (Firebase Auth) ---------- */
onAuthStateChanged(auth,async fbUser=>{
  if(!fbUser){USER=null;AUTH_READY=true;route();return}
  try{
    const udoc=await getDoc(doc(db,'users',fbUser.uid));
    if(!udoc.exists()){
      await signOut(auth);
      AUTH_READY=true;viewLogin(false,'هذا الحساب غير مُفعَّل في النظام. تواصل مع المدير.');return;
    }
    const ud=udoc.data();
    if(ud.active===false){
      await signOut(auth);
      AUTH_READY=true;viewLogin(false,'هذا الحساب موقوف. تواصل مع المدير.');return;
    }
    USER={u:fbUser.uid,email:fbUser.email,name:ud.name||fbUser.email,prefix:ud.prefix||'A',role:ud.role||'user'};
    startVouchersListener();
    AUTH_READY=true;
    if(!location.hash||location.hash==='#/list')route();else route();
  }catch(e){
    AUTH_READY=true;viewLogin(false,'تعذّر تحميل بيانات الحساب: '+(e&&e.message||''));
  }
});
})();
