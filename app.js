const DATA=window.AFP_DATA;
const SUBJECT_KEYS=Object.keys(DATA.subjects);
const STORAGE_KEY='afp_state_v2';

function safeJSON(value,fallback){try{return value?JSON.parse(value):fallback}catch{return fallback}}
function questionById(id){return DATA.questions.find(q=>q.id===id)}

const saved=safeJSON(localStorage.getItem(STORAGE_KEY),null);
const state={
  xp:saved?.xp ?? (+localStorage.getItem('afp_xp')||0),
  total:saved?.total ?? (+localStorage.getItem('afp_total')||0),
  correct:saved?.correct ?? (+localStorage.getItem('afp_correct')||0),
  mastered:saved?.mastered ?? safeJSON(localStorage.getItem('afp_mastered'),{}),
  best:saved?.best ?? safeJSON(localStorage.getItem('afp_best'),{}),
  wrong:saved?.wrong ?? safeJSON(localStorage.getItem('afp_wrong'),{}),
  currentSubject:saved?.currentSubject||'home',
  examSubject:saved?.examSubject||'mix',
  examSize:saved?.examSize||10,
  queue:[],
  qIndex:saved?.qIndex||0,
  examCorrect:saved?.examCorrect||0,
  examWrong:[],
  answered:!!saved?.answered,
  streak:saved?.streak||0,
  examActive:!!saved?.examActive,
  updatedAt:saved?.updatedAt||null
};
if(saved?.queueIds?.length) state.queue=saved.queueIds.map(questionById).filter(Boolean);
if(saved?.examWrongIds?.length) state.examWrong=saved.examWrongIds.map(questionById).filter(Boolean);
if(state.qIndex>=state.queue.length&&state.queue.length) state.qIndex=state.queue.length-1;

let saveTimer=null;
function ensureSaveIndicator(){
  let el=document.querySelector('#autosaveIndicator');
  if(el)return el;
  el=document.createElement('div');
  el.id='autosaveIndicator';
  Object.assign(el.style,{position:'fixed',right:'12px',bottom:'12px',zIndex:'99',padding:'7px 10px',borderRadius:'999px',fontSize:'12px',fontWeight:'800',background:'rgba(8,16,31,.88)',color:'#86efac',border:'1px solid rgba(134,239,172,.3)',backdropFilter:'blur(10px)',boxShadow:'0 10px 28px rgba(0,0,0,.25)',transition:'opacity .25s ease',pointerEvents:'none'});
  el.textContent='✓ 自動儲存已開啟';
  document.body.appendChild(el);
  return el;
}
function paintSaveStatus(){
  const el=ensureSaveIndicator();
  const d=new Date();
  el.textContent=`✓ 已自動儲存 ${d.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
  el.style.opacity='1';
  clearTimeout(el._fadeTimer);
  el._fadeTimer=setTimeout(()=>{el.style.opacity='.58'},1800);
}
function saveNow(){
  try{
    const payload={
      version:2,xp:state.xp,total:state.total,correct:state.correct,
      mastered:state.mastered,best:state.best,wrong:state.wrong,
      currentSubject:state.currentSubject,examSubject:state.examSubject,examSize:state.examSize,
      queueIds:state.queue.map(q=>q.id),qIndex:state.qIndex,examCorrect:state.examCorrect,
      examWrongIds:state.examWrong.map(q=>q.id),answered:state.answered,streak:state.streak,
      examActive:state.examActive,updatedAt:new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY,JSON.stringify(payload));
    // 保留舊版鍵值，確保舊資料與未來版本仍可相容
    localStorage.setItem('afp_xp',state.xp);
    localStorage.setItem('afp_total',state.total);
    localStorage.setItem('afp_correct',state.correct);
    localStorage.setItem('afp_mastered',JSON.stringify(state.mastered));
    localStorage.setItem('afp_best',JSON.stringify(state.best));
    localStorage.setItem('afp_wrong',JSON.stringify(state.wrong));
    state.updatedAt=payload.updatedAt;
    paintSaveStatus();
  }catch(err){
    console.warn('自動儲存失敗',err);
    const el=ensureSaveIndicator();
    el.textContent='⚠ 自動儲存失敗';
    el.style.color='#fda4af';
    el.style.opacity='1';
  }
}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,350)}
function save(){saveNow()}

function shuffle(a){return [...a].sort(()=>Math.random()-.5)}
function levelInfo(){const level=Math.floor(state.xp/100)+1,inLevel=state.xp%100;return{level,inLevel,next:100-inLevel}}
function renderTop(){const li=levelInfo();document.querySelector('#level').textContent=`Lv.${li.level}`;document.querySelector('#xpnum').textContent=`${state.xp} XP`;document.querySelector('#xpbar').style.width=li.inLevel+'%';document.querySelector('#totalq').textContent=state.total;document.querySelector('#accuracy').textContent=state.total?Math.round(state.correct/state.total*100)+'%':'0%';document.querySelector('#wrongcount').textContent=Object.values(state.wrong).reduce((a,b)=>a+b,0);document.querySelector('#mastercount').textContent=Object.keys(state.mastered).length;}
function subjectMasteredCount(key){return Object.keys(state.mastered).filter(x=>x.startsWith(key+'-')).length}
function renderHome(){const root=document.querySelector('#homeCards');root.innerHTML=SUBJECT_KEYS.map(k=>{const s=DATA.subjects[k],m=subjectMasteredCount(k),n=s.sections.length,p=Math.round(m/n*100),q=DATA.questions.filter(x=>x.subject===k).length,b=state.best[k]||0;return `<article class="card subjectcard" onclick="showSubject('${k}')"><span class="tag">${k.toUpperCase()}</span><h3>${s.name.replace(k.toUpperCase()+' ','')}</h3><p class="small">${s.subtitle}</p><div class="progressline"><i style="width:${p}%;background:${s.color}"></i></div><p class="small">重點掌握 ${m}/${n} · 題庫 ${q} 題 · 最佳 ${b}%</p></article>`}).join('')}
function renderSubject(key,filter=''){const s=DATA.subjects[key],root=document.querySelector('#subjectContent');let html=`<div class="sectionhead"><div><span class="tag">${key.toUpperCase()}</span><h2>${s.name}</h2></div><p>${s.subtitle}</p></div><div class="actions"><button class="btn primary" onclick="openExam('${key}',10)">10 題快刷</button><button class="btn" onclick="openExam('${key}',20)">20 題模擬</button><button class="btn" onclick="openExam('${key}',999)">刷完整題庫</button></div><div class="searchbox"><input id="focusSearch" placeholder="搜尋本科技巧、公式、數字…" value="${filter}"></div><div class="focusgrid">`;
 const needle=filter.trim().toLowerCase();s.sections.forEach((sec,i)=>{const text=(sec.title+' '+sec.items.join(' ')+' '+sec.trap).toLowerCase();if(needle&&!text.includes(needle))return;const id=`${key}-${i}`,done=state.mastered[id];html+=`<article class="card"><span class="tag">${sec.level}</span><h3>${sec.title}</h3><ul>${sec.items.map(x=>`<li>${x}</li>`).join('')}</ul><div class="trap"><b>⚠ 易錯：</b>${sec.trap}</div><div class="masterrow"><span class="small">讀完後主動標記</span><button class="master ${done?'done':''}" onclick="toggleMaster('${id}','${key}')">${done?'✓ 已掌握':'+ 標記掌握'}</button></div></article>`});html+='</div>';root.innerHTML=html;document.querySelector('#focusSearch').addEventListener('input',e=>renderSubject(key,e.target.value));}
function toggleMaster(id,key){if(state.mastered[id])delete state.mastered[id];else{state.mastered[id]=1;state.xp+=5}save();renderTop();renderHome();renderSubject(key,document.querySelector('#focusSearch')?.value||'')}
function showSubject(key){state.currentSubject=key;document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));const view=document.querySelector(key==='home'?'#home':'#subject');view.classList.add('active');document.querySelector(`[data-subject="${key}"]`)?.classList.add('active');if(key!=='home')renderSubject(key);scheduleSave();window.scrollTo({top:0,behavior:'smooth'})}
function setExamSubject(k){state.examSubject=k;document.querySelectorAll('[data-examsub]').forEach(x=>x.classList.toggle('active',x.dataset.examsub===k));scheduleSave()}
function setExamSize(n){state.examSize=n;document.querySelectorAll('[data-size]').forEach(x=>x.classList.toggle('active',+x.dataset.size===n));scheduleSave()}
function openExam(subject='mix',size=10){showView('examSetup');setExamSubject(subject);setExamSize(size===999?999:size);window.scrollTo({top:0,behavior:'smooth'})}
function showView(id){document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.querySelector('#'+id).classList.add('active')}
function buildQueue(subject,size,wrongOnly=false){let pool=wrongOnly?DATA.questions.filter(q=>state.wrong[q.id]):DATA.questions.filter(q=>subject==='mix'||q.subject===subject);pool=shuffle(pool);return size===999?pool:pool.slice(0,Math.min(size,pool.length))}
function startExam(wrongOnly=false){state.queue=buildQueue(state.examSubject,state.examSize,wrongOnly);if(!state.queue.length){alert('目前沒有可刷的題目。');return}state.qIndex=0;state.examCorrect=0;state.examWrong=[];state.streak=0;state.answered=false;state.examActive=true;save();showView('quiz');renderQuestion()}
function renderQuestion(){const q=state.queue[state.qIndex],s=DATA.subjects[q.subject];document.querySelector('#qmeta').innerHTML=`<span>${s.name}</span><span>${state.qIndex+1}/${state.queue.length}</span>`;document.querySelector('#question').textContent=q.q;document.querySelector('#options').innerHTML=q.options.map((o,i)=>`<button class="opt" onclick="answer(${i})">${String.fromCharCode(65+i)}. ${o}</button>`).join('');document.querySelector('#explain').className='explain';document.querySelector('#explain').innerHTML='';document.querySelector('#nextbtn').style.display='none';state.answered=false;scheduleSave()}
function answer(i){if(state.answered)return;state.answered=true;const q=state.queue[state.qIndex],ok=i===q.answer,opts=[...document.querySelectorAll('.opt')];opts[q.answer].classList.add('correct');if(!ok)opts[i].classList.add('wrong');opts.forEach(x=>x.disabled=true);state.total++;if(ok){state.correct++;state.examCorrect++;state.streak++;const bonus=state.streak>=3?5:0;state.xp+=10+bonus;if(state.wrong[q.id])state.wrong[q.id]=Math.max(0,state.wrong[q.id]-1)}else{state.streak=0;state.examWrong.push(q);state.wrong[q.id]=(state.wrong[q.id]||0)+1}document.querySelector('#explain').classList.add('show');document.querySelector('#explain').innerHTML=`<b class="${ok?'good':'bad'}">${ok?'答對了 +'+(state.streak>=3?15:10)+' XP':'答錯了'}</b><br>${q.explain}`;document.querySelector('#nextbtn').style.display='inline-block';save();renderTop()}
function nextQuestion(){if(state.qIndex<state.queue.length-1){state.qIndex++;state.answered=false;save();renderQuestion()}else finishExam()}
function finishExam(){const pct=Math.round(state.examCorrect/state.queue.length*100),key=state.examSubject;if(key!=='mix')state.best[key]=Math.max(state.best[key]||0,pct);state.best.mix=Math.max(state.best.mix||0,pct);state.examActive=false;state.answered=false;save();renderTop();renderHome();removeResumeButton();showView('result');const wrongHtml=state.examWrong.length?state.examWrong.map(q=>`<div class="wrongitem"><b>${DATA.subjects[q.subject].name}</b><br>${q.q}<div class="small">${q.explain}</div></div>`).join(''):'<p class="good">本回合全對！</p>';document.querySelector('#resultBox').innerHTML=`<div class="result"><div class="badge">本回合完成</div><div class="score">${pct}%</div><p>${state.examCorrect}/${state.queue.length} 題正確</p><div class="resultgrid"><div class="metric"><b>${state.examCorrect}</b><span>答對</span></div><div class="metric"><b>${state.examWrong.length}</b><span>答錯</span></div><div class="metric"><b>${state.xp}</b><span>累積 XP</span></div></div><div class="actions" style="justify-content:center"><button class="btn primary" onclick="startExam(false)">同科再刷一次</button><button class="btn" onclick="startWrongBook()">只刷錯題</button><button class="btn" onclick="showSubject('home')">回總覽</button></div></div><div class="sectionhead"><h2>本回合錯題</h2><p>錯越多次，之後越值得重刷</p></div><div class="wronglist">${wrongHtml}</div>`}
function startWrongBook(){state.examSubject='mix';state.examSize=999;state.queue=buildQueue('mix',999,true);if(!state.queue.length){alert('目前沒有錯題紀錄。');return}state.qIndex=0;state.examCorrect=0;state.examWrong=[];state.streak=0;state.answered=false;state.examActive=true;save();showView('quiz');renderQuestion()}
function resetAll(){if(!confirm('確定要清除 XP、掌握度、成績、錯題與未完成測驗嗎？'))return;[STORAGE_KEY,'afp_xp','afp_total','afp_correct','afp_mastered','afp_best','afp_wrong'].forEach(k=>localStorage.removeItem(k));location.reload()}
function renderExamSetup(){document.querySelector('#examSubjects').innerHTML=`<button class="choice active" data-examsub="mix" onclick="setExamSubject('mix')">綜合七科</button>`+SUBJECT_KEYS.map(k=>`<button class="choice" data-examsub="${k}" onclick="setExamSubject('${k}')">${k.toUpperCase()}<br><span class="small">${DATA.subjects[k].name.split(' ')[1]}</span></button>`).join('')}
function wire(){document.querySelectorAll('[data-subject]').forEach(b=>b.addEventListener('click',()=>showSubject(b.dataset.subject)));document.querySelector('#nextbtn').addEventListener('click',nextQuestion);document.querySelector('#startExamBtn').addEventListener('click',()=>startExam(false));document.querySelector('#wrongBtn').addEventListener('click',startWrongBook)}

function removeResumeButton(){document.querySelector('#resumeExamBtn')?.remove()}
function offerResumeButton(){
  removeResumeButton();
  if(!state.examActive||!state.queue.length)return;
  const actions=document.querySelector('.hero .actions');
  if(!actions)return;
  const btn=document.createElement('button');
  btn.id='resumeExamBtn';btn.className='btn';
  btn.textContent=`繼續上次測驗 ${Math.min(state.qIndex+1,state.queue.length)}/${state.queue.length}`;
  btn.addEventListener('click',resumeLastExam);
  actions.insertBefore(btn,actions.firstChild);
}
function resumeLastExam(){
  if(!state.examActive||!state.queue.length)return;
  if(state.answered){
    if(state.qIndex<state.queue.length-1){state.qIndex++;state.answered=false;save();showView('quiz');renderQuestion();}
    else{finishExam();}
  }else{showView('quiz');renderQuestion();}
  window.scrollTo({top:0,behavior:'smooth'});
}

// 多層自動儲存：每次操作即存、閒置每 5 秒補存、切頁/關閉前再存一次。
setInterval(()=>saveNow(),5000);
window.addEventListener('pagehide',saveNow);
window.addEventListener('beforeunload',saveNow);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveNow()});

renderTop();renderHome();renderExamSetup();wire();ensureSaveIndicator();offerResumeButton();
// 第一次載入即建立新版整合存檔，舊版 localStorage 會自動升級，不會遺失既有進度。
scheduleSave();