import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
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
const PROFILE_KEY = 'afp_cloud_profile';
const PROFILE_NAME_KEY = 'afp_cloud_profile_name';
const cfg = window.AFP_FIREBASE_CONFIG || {};
const configured = Boolean(cfg.apiKey && cfg.authDomain && cfg.databaseURL && cfg.projectId && cfg.appId);

let auth = null;
let db = null;
let currentUser = null;
let lastFingerprint = '';
let uploadTimer = null;
let busy = false;
let activeProfile = ensureProfileCode();
let profileName = localStorage.getItem(PROFILE_NAME_KEY) || '我的進度';

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
function clearProgress(){ KEYS.forEach(k=>localStorage.removeItem(k)); }
function fingerprint(s=localSnapshot()){ return JSON.stringify(s); }

function generateProfileCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>alphabet[b%alphabet.length]).join('');
}
function normalizeCode(v){ return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
function prettyCode(v){ return normalizeCode(v).match(/.{1,4}/g)?.join('-') || ''; }
function ensureProfileCode(){
  let code=normalizeCode(localStorage.getItem(PROFILE_KEY));
  if(code.length<12){
    code=generateProfileCode();
    localStorage.setItem(PROFILE_KEY,code);
  }
  return code;
}
function cacheKey(code){ return `afp_profile_cache_${normalizeCode(code)}`; }
function saveProfileCache(code=activeProfile){
  try{ localStorage.setItem(cacheKey(code), JSON.stringify(localSnapshot())); }catch{}
}
function restoreProfileCache(code){
  const cached=safeJSON(localStorage.getItem(cacheKey(code)),null);
  if(cached) writeLocal(cached); else clearProgress();
}
function profileRootRef(code=activeProfile){ return ref(db, `profiles/${normalizeCode(code)}`); }
function progressRef(code=activeProfile){ return ref(db, `profiles/${normalizeCode(code)}/progress`); }
function metaRef(code=activeProfile){ return ref(db, `profiles/${normalizeCode(code)}/meta`); }

function ensureUI(){
  if(document.getElementById('cloudSyncBox')) return;
  const top=document.querySelector('header .top') || document.querySelector('header .wrap') || document.querySelector('header');
  if(!top) return;

  const box=document.createElement('div');
  box.id='cloudSyncBox';
  box.style.position='relative';
  box.innerHTML=`
    <button id="cloudProfileBtn" type="button">☁️ ${escapeHTML(profileName)}</button>
    <span id="cloudSyncState">${configured?'準備同步':'Firebase 尚未設定'}</span>
    <div id="cloudProfileMenu" hidden>
      <div style="font-weight:900;margin-bottom:4px" id="cloudProfileName">${escapeHTML(profileName)}</div>
      <div style="font-size:11px;color:#9eacc8;margin-bottom:10px">同步碼：<b id="cloudProfileCode" style="color:#eef4ff">${prettyCode(activeProfile)}</b></div>
      <button type="button" data-cloud-action="copy">複製同步碼</button>
      <button type="button" data-cloud-action="switch">切換使用者</button>
      <button type="button" data-cloud-action="new">新增使用者</button>
      <button type="button" data-cloud-action="rename">重新命名</button>
    </div>`;
  Object.assign(box.style,{display:'flex',alignItems:'center',gap:'8px',marginLeft:'auto',fontSize:'12px'});
  const btn=box.querySelector('#cloudProfileBtn');
  Object.assign(btn.style,{border:'1px solid rgba(255,255,255,.14)',background:'#111b31',color:'#eef4ff',borderRadius:'10px',padding:'7px 10px',cursor:'pointer',fontWeight:'800'});
  const state=box.querySelector('#cloudSyncState');
  Object.assign(state.style,{color:'#9eacc8',whiteSpace:'nowrap'});
  const menu=box.querySelector('#cloudProfileMenu');
  Object.assign(menu.style,{position:'absolute',right:'0',top:'42px',zIndex:'99',minWidth:'220px',padding:'12px',border:'1px solid rgba(255,255,255,.14)',background:'#0f1930',borderRadius:'14px',boxShadow:'0 18px 45px rgba(0,0,0,.35)'});
  menu.querySelectorAll('button').forEach(b=>Object.assign(b.style,{display:'block',width:'100%',marginTop:'6px',border:'1px solid rgba(255,255,255,.12)',background:'#151f39',color:'#eef4ff',borderRadius:'9px',padding:'8px 10px',cursor:'pointer',textAlign:'left'}));
  top.appendChild(box);

  btn.addEventListener('click',()=>{ menu.hidden=!menu.hidden; });
  document.addEventListener('click',e=>{ if(!box.contains(e.target)) menu.hidden=true; });
  menu.addEventListener('click',async e=>{
    const action=e.target?.dataset?.cloudAction;
    if(!action) return;
    menu.hidden=true;
    if(action==='copy') await copyProfileCode();
    if(action==='switch') await switchProfile();
    if(action==='new') await createNewProfile();
    if(action==='rename') await renameProfile();
  });
  paintUI();
}
function escapeHTML(v){ return String(v||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function paintUI(message=''){
  const btn=document.getElementById('cloudProfileBtn');
  const label=document.getElementById('cloudSyncState');
  const nameEl=document.getElementById('cloudProfileName');
  const codeEl=document.getElementById('cloudProfileCode');
  if(btn) btn.textContent=`☁️ ${profileName}`;
  if(nameEl) nameEl.textContent=profileName;
  if(codeEl) codeEl.textContent=prettyCode(activeProfile);
  if(!label) return;
  if(!configured){ label.textContent='Firebase 尚未設定'; return; }
  if(!currentUser){ label.textContent=message || '連線中…'; return; }
  label.textContent=message || '✓ 已自動同步';
}

async function copyProfileCode(){
  const code=prettyCode(activeProfile);
  try{
    await navigator.clipboard.writeText(code);
    paintUI('✓ 同步碼已複製');
  }catch{
    prompt('請複製這組同步碼，在另一個瀏覽器輸入即可接續：',code);
  }
}
async function switchProfile(){
  await flushUpload();
  saveProfileCache();
  const input=prompt('輸入另一位使用者的同步碼：\n（例如 ABCD-EFGH-JKLM-NPQR）');
  if(input===null) return;
  const code=normalizeCode(input);
  if(code.length<12){ alert('同步碼格式不正確。'); return; }
  if(code===activeProfile){ paintUI('目前就是這位使用者'); return; }
  localStorage.setItem(PROFILE_KEY,code);
  localStorage.removeItem(PROFILE_NAME_KEY);
  restoreProfileCache(code);
  location.reload();
}
async function createNewProfile(){
  await flushUpload();
  saveProfileCache();
  const code=generateProfileCode();
  const name=(prompt('幫這位使用者取一個名稱：','使用者 '+prettyCode(code).slice(-4))||'我的進度').trim().slice(0,30) || '我的進度';
  localStorage.setItem(PROFILE_KEY,code);
  localStorage.setItem(PROFILE_NAME_KEY,name);
  clearProgress();
  location.reload();
}
async function renameProfile(){
  const name=(prompt('使用者名稱：',profileName)||'').trim().slice(0,30);
  if(!name) return;
  profileName=name;
  localStorage.setItem(PROFILE_NAME_KEY,name);
  if(currentUser && db){
    try{ await set(metaRef(),{name:profileName,updatedAt:Date.now()}); }catch(err){ console.error(err); }
  }
  paintUI('✓ 名稱已更新');
}

async function uploadNow(){
  if(!currentUser || !db || busy) return;
  busy=true;
  try{
    const data=localSnapshot();
    await set(progressRef(),{...data,updatedAt:Date.now()});
    lastFingerprint=fingerprint(data);
    saveProfileCache();
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
async function initialSync(){
  busy=true;
  try{
    const snap=await get(profileRootRef());
    const local=localSnapshot();
    const cloudRoot=snap.exists()?snap.val():null;
    const cloud=cloudRoot?.progress||null;
    if(cloudRoot?.meta?.name){
      profileName=String(cloudRoot.meta.name).slice(0,30);
      localStorage.setItem(PROFILE_NAME_KEY,profileName);
    }
    if(!cloud){
      await set(profileRootRef(),{
        meta:{name:profileName,createdAt:Date.now(),updatedAt:Date.now()},
        progress:{...local,updatedAt:Date.now()}
      });
      lastFingerprint=fingerprint(local);
      saveProfileCache();
      paintUI('✓ 已建立雲端進度');
      return;
    }
    const merged=mergeProgress(local,cloud);
    const before=fingerprint(local), after=fingerprint(merged);
    writeLocal(merged);
    saveProfileCache();
    await set(progressRef(),{...merged,updatedAt:Date.now()});
    await set(metaRef(),{name:profileName,updatedAt:Date.now()});
    lastFingerprint=after;
    paintUI('✓ 雲端進度已同步');
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
    onAuthStateChanged(auth, async user=>{
      if(user){
        currentUser=user;
        paintUI('同步中…');
        await initialSync();
      }else{
        currentUser=null;
        paintUI('建立雲端連線…');
        try{ await signInAnonymously(auth); }
        catch(err){
          console.error('Anonymous auth failed',err);
          paintUI('請在 Firebase 啟用匿名驗證');
        }
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
