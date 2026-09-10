import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getDatabase,
  ref,
  get,
  set
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js';

const KEYS = ['afp_xp','afp_total','afp_correct','afp_mastered','afp_best','afp_wrong'];
const cfg = window.AFP_FIREBASE_CONFIG || {};
const configured = Boolean(cfg.apiKey && cfg.authDomain && cfg.databaseURL && cfg.projectId && cfg.appId);

let auth = null;
let db = null;
let currentUser = null;
let lastFingerprint = '';
let uploadTimer = null;
let busy = false;

function safeJSON(value, fallback={}) {
  try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; }
}
function num(key){ return Number(localStorage.getItem(key) || 0); }
function object(key){ return safeJSON(localStorage.getItem(key), {}); }
function localSnapshot(){
  return {
    xp:num('afp_xp'), total:num('afp_total'), correct:num('afp_correct'),
    mastered:object('afp_mastered'), best:object('afp_best'), wrong:object('afp_wrong')
  };
}
function meaningful(s){
  return s.xp>0 || s.total>0 || Object.keys(s.mastered||{}).length>0 || Object.keys(s.best||{}).length>0 || Object.keys(s.wrong||{}).length>0;
}
function mergedObjects(a={}, b={}, mode='max'){
  const out={...a};
  for(const [k,v] of Object.entries(b||{})){
    if(mode==='union') out[k]=1;
    else out[k]=Math.max(Number(out[k]||0), Number(v||0));
  }
  return out;
}
function mergeProgress(local, cloud){
  const l=local||{}, c=cloud||{};
  const useCloudStats = Number(c.total||0) > Number(l.total||0);
  return {
    xp: Math.max(Number(l.xp||0), Number(c.xp||0)),
    total: useCloudStats ? Number(c.total||0) : Number(l.total||0),
    correct: useCloudStats ? Number(c.correct||0) : Number(l.correct||0),
    mastered: mergedObjects(l.mastered,c.mastered,'union'),
    best: mergedObjects(l.best,c.best,'max'),
    wrong: mergedObjects(l.wrong,c.wrong,'max')
  };
}
function writeLocal(s){
  localStorage.setItem('afp_xp', String(s.xp||0));
  localStorage.setItem('afp_total', String(s.total||0));
  localStorage.setItem('afp_correct', String(s.correct||0));
  localStorage.setItem('afp_mastered', JSON.stringify(s.mastered||{}));
  localStorage.setItem('afp_best', JSON.stringify(s.best||{}));
  localStorage.setItem('afp_wrong', JSON.stringify(s.wrong||{}));
}
function fingerprint(s=localSnapshot()){ return JSON.stringify(s); }
function progressRef(uid){ return ref(db, `users/${uid}/progress`); }

function ensureUI(){
  if(document.getElementById('cloudSyncBox')) return;
  const top=document.querySelector('header .top') || document.querySelector('header .wrap') || document.querySelector('header');
  if(!top) return;
  const box=document.createElement('div');
  box.id='cloudSyncBox';
  box.innerHTML=`<button id="cloudSyncBtn" type="button">☁️ 雲端同步</button><span id="cloudSyncState">本機模式</span>`;
  Object.assign(box.style,{display:'flex',alignItems:'center',gap:'8px',marginLeft:'auto',fontSize:'12px'});
  const btn=box.querySelector('#cloudSyncBtn');
  Object.assign(btn.style,{border:'1px solid rgba(255,255,255,.14)',background:'#111b31',color:'#eef4ff',borderRadius:'10px',padding:'7px 10px',cursor:'pointer',fontWeight:'800'});
  const state=box.querySelector('#cloudSyncState');
  Object.assign(state.style,{color:'#9eacc8',whiteSpace:'nowrap'});
  top.appendChild(box);
  btn.addEventListener('click', async()=>{
    if(!configured){
      alert('Firebase 尚未設定。請先把 Firebase Web App 的 firebaseConfig 貼到 firebase-config.js。');
      return;
    }
    if(currentUser){
      await flushUpload();
      await signOut(auth);
    }else{
      try{
        const provider=new GoogleAuthProvider();
        provider.setCustomParameters({prompt:'select_account'});
        await signInWithPopup(auth,provider);
      }catch(err){
        console.error(err);
        alert('Google 登入失敗：'+(err?.message||err));
      }
    }
  });
  paintUI();
}
function paintUI(message=''){
  const btn=document.getElementById('cloudSyncBtn');
  const label=document.getElementById('cloudSyncState');
  if(!btn||!label) return;
  if(!configured){btn.textContent='⚙️ 設定 Firebase';label.textContent='尚未啟用';return;}
  if(currentUser){
    btn.textContent='登出同步';
    label.textContent=message || `✓ ${currentUser.displayName||currentUser.email||'已登入'} · 已同步`;
  }else{
    btn.textContent='☁️ Google 登入同步';
    label.textContent=message || '本機模式';
  }
}

async function uploadNow(){
  if(!currentUser || busy) return;
  busy=true;
  try{
    const data=localSnapshot();
    await set(progressRef(currentUser.uid),{...data,updatedAt:Date.now()});
    lastFingerprint=fingerprint(data);
    paintUI('✓ 已自動同步');
  }catch(err){
    console.error('Firebase upload failed',err);
    paintUI('同步失敗，保留本機進度');
  }finally{busy=false;}
}
function scheduleUpload(){
  if(!currentUser) return;
  clearTimeout(uploadTimer);
  uploadTimer=setTimeout(uploadNow,500);
}
async function flushUpload(){
  clearTimeout(uploadTimer);
  const fp=fingerprint();
  if(currentUser && fp!==lastFingerprint) await uploadNow();
}
async function initialSync(user){
  busy=true;
  try{
    const snap=await get(progressRef(user.uid));
    const local=localSnapshot();
    const cloud=snap.exists()?snap.val():null;
    if(!cloud){
      await set(progressRef(user.uid),{...local,updatedAt:Date.now()});
      lastFingerprint=fingerprint(local);
      paintUI('✓ 已建立雲端進度');
      return;
    }
    const merged=mergeProgress(local,cloud);
    const before=fingerprint(local), after=fingerprint(merged);
    writeLocal(merged);
    await set(progressRef(user.uid),{...merged,updatedAt:Date.now()});
    lastFingerprint=after;
    paintUI('✓ 雲端進度已合併');
    if(before!==after && sessionStorage.getItem('afp_cloud_reload')!=='1'){
      sessionStorage.setItem('afp_cloud_reload','1');
      location.reload();
    }else{
      sessionStorage.removeItem('afp_cloud_reload');
    }
  }catch(err){
    console.error('Firebase initial sync failed',err);
    paintUI('同步失敗，使用本機進度');
  }finally{busy=false;}
}

ensureUI();

if(configured){
  try{
    const app=initializeApp(cfg);
    auth=getAuth(app);
    db=getDatabase(app);
    await setPersistence(auth,browserLocalPersistence);
    onAuthStateChanged(auth, async(user)=>{
      currentUser=user||null;
      if(user){
        paintUI('同步中…');
        await initialSync(user);
      }else{
        lastFingerprint=fingerprint();
        paintUI();
      }
    });

    lastFingerprint=fingerprint();
    setInterval(()=>{
      const fp=fingerprint();
      if(currentUser && fp!==lastFingerprint) scheduleUpload();
    },1500);
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushUpload(); });
    window.addEventListener('pagehide',()=>{ flushUpload(); });
  }catch(err){
    console.error('Firebase init failed',err);
    paintUI('Firebase 初始化失敗');
  }
}
