(()=>{
const SHEETS=window.AFP_CHEATSHEETS||{};
function h(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function table(rows,headers=['看到','立刻想到']){
  return `<div class="glance-table-wrap"><table class="glance-table"><thead><tr><th>${h(headers[0])}</th><th>${h(headers[1])}</th>${headers[2]?`<th>${h(headers[2])}</th>`:''}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${h(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderSheet(key){
  const s=SHEETS[key];if(!s)return '';
  const memory=`<section class="glance-hero"><div><span class="glance-kicker">考前 60 秒</span><h2>${h(s.title)}</h2><p>先掃過這一區，再往下看詳細章節；考前最後複習只看這裡也可以。</p></div><div class="memory-grid">${s.memory.map(x=>`<div class="memory-pill">${h(x)}</div>`).join('')}</div></section>`;
  const overview=`<section class="glance-section"><div class="glance-head"><h3>① 本科地圖</h3><span>先建立整體架構</span></div><div class="overview-grid">${s.overview.map(r=>`<article class="overview-row"><b>${h(r[0])}</b><span>${h(r[1])}</span></article>`).join('')}</div></section>`;
  const blocks=`<section class="glance-section"><div class="glance-head"><h3>② 必考重點</h3><span>依題目最常混淆的方式整理</span></div><div class="glance-blocks">${s.blocks.map(b=>`<article class="glance-card"><span class="tag">${h(b.tag)}</span><h3>${h(b.title)}</h3><p class="lead">${h(b.lead)}</p><ul>${b.items.map(x=>`<li>${h(x)}</li>`).join('')}</ul><div class="trap"><b>⚠ 易錯：</b>${h(b.trap)}</div></article>`).join('')}</div></section>`;
  const numbers=s.numbers?.length?`<section class="glance-section"><div class="glance-head"><h3>③ 必背公式／數字</h3><span>看到數字題先從這裡抓</span></div>${table(s.numbers,['項目','必背','提醒'])}</section>`:'';
  const reflex=s.reflex?.length?`<section class="glance-section"><div class="glance-head"><h3>④ 關鍵字反射</h3><span>把選擇題做成條件反射</span></div>${table(s.reflex,['看到題目關鍵字','立刻想到'])}</section>`:'';
  return `<div class="oneglance-root" data-glance-key="${h(key)}">${memory}${overview}${blocks}${numbers}${reflex}<div class="glance-divider"><span>以下保留原本的章節式詳細整理</span></div></div>`;
}
function activeKey(){const el=document.querySelector('.chip.active[data-subject]');return el?.dataset.subject||'';}
function inject(){
  const root=document.querySelector('#subjectContent');if(!root)return;
  const key=activeKey();if(!key||key==='home'||!SHEETS[key])return;
  if(root.querySelector(`.oneglance-root[data-glance-key="${key}"]`))return;
  root.querySelector('.oneglance-root')?.remove();
  const actions=root.querySelector('.actions');
  if(actions) actions.insertAdjacentHTML('afterend',renderSheet(key));
  else root.insertAdjacentHTML('afterbegin',renderSheet(key));
}
const target=document.querySelector('#subjectContent');
if(target){new MutationObserver(()=>queueMicrotask(inject)).observe(target,{childList:true,subtree:false});}
document.addEventListener('click',e=>{if(e.target.closest?.('[data-subject]'))setTimeout(inject,0)});
setTimeout(inject,0);
})();
