'use strict';
/* ============================================================
 * Charlotte Decision Challenge
 * Core engine: data wiring, stats helpers, state, router, tray
 * Data: window.RLDATA (analytic) + window geo globals (NPAS, BIZ, ALLPSLIM, ...)
 * ============================================================ */
const D = window.RLDATA;
if(!D){ document.getElementById('main').innerHTML =
  '<div class="card"><h2>Data files missing</h2><p>This page needs <code>data/rl_data.js</code> and <code>data/rl_geo.js</code> beside it. Open the folder and launch <code>charlotte_lab.html</code> with the <code>data/</code> and <code>vendor/</code> folders intact.</p></div>'; }

/* ---------- column index maps ---------- */
const NPAI={}; D.npaCols.forEach((c,i)=>NPAI[c]=i);
const BZI={};  D.bizCols.forEach((c,i)=>BZI[c]=i);
const CUR = D.meta.currentYear;
const catByKey={}; D.catalog.forEach(c=>catByKey[c.key]=c);

/* sector labels (NAICS groups, codes 0..7) */
const SECTORS=["Services","Retail trade","Finance / real estate","Wholesale","Construction","Manufacturing","Transportation / utilities","Other / unspecified"];
const LINEHEX={Blue:'#1f6feb',blue:'#1f6feb',Silver:'#6b7280',silver:'#6b7280',Gold:'#b08a2e',gold:'#b08a2e',Red:'#b3203a',red:'#b3203a'};

/* ---------- accessors ---------- */
const isNum = v => typeof v==='number' && !isNaN(v);
function npaVal(row,key){ return row[NPAI[key]]; }
/* Train rows (Blue/Silver) have all 23 columns incl. displacement_index.
   Test rows (Red) have 22 columns: NO observed displacement_index, npa last.
   Columns 0–20 align in both; only the tail differs. */
const _BIZLEN=D.bizCols.length, _NPA_I=BZI['npa'], _DISP_I=BZI['displacement_index'];
function bzVal(row,key){
  if(row.length===_BIZLEN) return row[BZI[key]];      // train (Blue/Silver)
  if(key==='displacement_index') return null;          // Red has no answer key
  if(key==='npa') return row[row.length-1];            // npa is the final field
  const i=BZI[key]; return i<_DISP_I ? row[i] : null;  // 0–20 align; nothing past it
}
function isNpaVar(key){ const c=catByKey[key]; return c && c.level==='Neighborhood' && (key in NPAI); }
const LABEL_ALIAS={disp:'Displacement index (City)',displacement_index:'Displacement index',employees_known:'Employees known?',parcel_commercial:'Commercial parcel',parcel_building_to_land:'Parcel building-to-land',parcel_recent_sale:'Recent sale (2020-25)',parcel_underutilized:'Parcel underutilized',parcel_out_of_state_owner:'Out-of-state owner',net_building_value:'Net building value',nbhd_income:'Neighborhood income',nbhd_pct_own:'Neighborhood % owner',nbhd_rent:'Neighborhood rent',leases_building:'Leases building',lot_acres:'Lot acres',building_to_land:'Building-to-land ratio',building_age:'Building age',dist_station_mi:'Distance to station (mi)',land_value:'Land value',total_value:'Total value',employees:'Employees',sector:'Business sector',line:'Transit line'};
function catLabel(key){ if(LABEL_ALIAS[key])return LABEL_ALIAS[key]; const c=catByKey[key]; return c?c.title:key; }
const ALLBIZ = D.train.concat(D.test);

/* dedup stations (data-integrity: raw list has duplicates) */
const ST_RAW = window.STATIONS||[];
const ST_UNIQ = (()=>{const seen=new Set(),out=[];ST_RAW.forEach(s=>{const k=s[0].toFixed(4)+','+s[1].toFixed(4);if(!seen.has(k)){seen.add(k);out.push(s);}});return out;})();

/* ============================================================
 * Stats helpers (offline, proven)
 * ============================================================ */
function mean(a){a=a.filter(isNum);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
function median(a){a=a.filter(isNum).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null;}
function pearson(a,b){const n=Math.min(a.length,b.length);if(n<3)return null;
  let ma=0,mb=0,k=0;for(let i=0;i<n;i++){if(isNum(a[i])&&isNum(b[i])){ma+=a[i];mb+=b[i];k++;}}
  if(k<3)return null;ma/=k;mb/=k;let num=0,da=0,db=0;
  for(let i=0;i<n;i++){if(isNum(a[i])&&isNum(b[i])){num+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}}
  return num/(Math.sqrt(da*db)||1);}
function linreg(xs,ys){let n=0,sx=0,sy=0,sxy=0,sxx=0;
  for(let i=0;i<xs.length;i++){if(isNum(xs[i])&&isNum(ys[i])){n++;sx+=xs[i];sy+=ys[i];sxy+=xs[i]*ys[i];sxx+=xs[i]*xs[i];}}
  const m=(n*sxy-sx*sy)/((n*sxx-sx*sx)||1);return {m,b:(sy-m*sx)/n,n};}
function rWord(r){if(r==null)return 'no clear relationship';const a=Math.abs(r);
  const s=a<0.1?'essentially no':a<0.25?'a weak':a<0.45?'a moderate':a<0.65?'a strong':'a very strong';
  return s+' '+(r>0?'positive':'negative')+' relationship';}
function ranks(a){const idx=a.map((v,i)=>[v,i]).sort((x,y)=>x[0]-y[0]);const r=Array(a.length);idx.forEach((p,i)=>r[p[1]]=i);return r;}
function quantile(a,q){a=a.filter(isNum).sort((x,y)=>x-y);if(!a.length)return null;const pos=(a.length-1)*q,b=Math.floor(pos);return a[b]+(a[b+1]-a[b]||0)*(pos-b);}
function fmt(v){ if(!isNum(v))return '—'; const a=Math.abs(v);
  if(a>=1e6)return (v<0?'-':'')+(a/1e6).toFixed(a>=1e7?0:1)+'M';
  if(a>=1e3)return (v<0?'-':'')+(a/1e3).toFixed(a>=1e4?0:1)+'k';
  if(a<1&&a>0)return v.toFixed(2); return (Math.round(v*10)/10).toString();}
function fmt$(v){return isNum(v)?'$'+Math.round(v).toLocaleString():'—';}
function pct(n,d){return d?Math.round(100*n/d):0;}
function esc(s){return (s+'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function colorScale(t){t=Math.max(0,Math.min(1,t));const st=[[237,245,233],[176,217,175],[95,179,138],[33,122,99],[11,71,60]];
  const x=t*(st.length-1),i=Math.min(st.length-2,Math.floor(x)),fr=x-i;
  return 'rgb('+[0,1,2].map(j=>Math.round(st[i][j]+(st[i+1][j]-st[i][j])*fr)).join(',')+')';}

/* ============================================================
 * Regression: standardized ridge OLS, train/test split
 * ============================================================ */
function matInv(A){const n=A.length;const M=A.map((r,i)=>r.concat(Array.from({length:n},(_,j)=>i===j?1:0)));
  for(let i=0;i<n;i++){let p=M[i][i]||1e-9;if(Math.abs(p)<1e-9){for(let k=i+1;k<n;k++)if(Math.abs(M[k][i])>1e-9){[M[i],M[k]]=[M[k],M[i]];break;}p=M[i][i]||1e-9;}
    for(let j=0;j<2*n;j++)M[i][j]/=p;
    for(let k=0;k<n;k++)if(k!==i){const f=M[k][i];for(let j=0;j<2*n;j++)M[k][j]-=f*M[i][j];}}
  return M.map(r=>r.slice(n));}
function matMulVec(M,v){return M.map(r=>r.reduce((s,x,i)=>s+x*v[i],0));}
let _incCut={};
function incomeCut(p){if(_incCut[p]!=null)return _incCut[p];
  const v=D.train.map(r=>bzVal(r,'nbhd_income')).filter(isNum).sort((a,b)=>a-b);
  return _incCut[p]=(v[Math.floor(v.length*p/100)]||0);}
function featRaw(r,k,thr){thr=thr||S.thresholds;
  if(k==='__small'){const e=bzVal(r,'employees');return isNum(e)?(e<=thr.small_emp?1:0):null;}
  if(k==='__near'){const d=bzVal(r,'dist_station_mi');return isNum(d)?(d<=thr.near_mi?1:0):null;}
  if(k==='__lowinc'){const v=bzVal(r,'nbhd_income');return isNum(v)?(v<=incomeCut(thr.income_pct)?1:0):null;}
  return bzVal(r,k);}
function fitOLS(rows,featKeys,thr){
  const stats={},imp={};
  featKeys.forEach(k=>{const vals=rows.map(r=>featRaw(r,k,thr)).filter(isNum);
    const m=vals.reduce((a,b)=>a+b,0)/(vals.length||1);
    const sd=Math.sqrt(vals.reduce((a,b)=>a+(b-m)**2,0)/(vals.length||1))||1;
    stats[k]={m,sd};imp[k]=Math.round(100*(1-vals.length/rows.length));});
  const y=rows.map(r=>bzVal(r,'displacement_index'));
  const ym=y.reduce((a,b)=>a+b,0)/y.length;
  const X=rows.map(r=>featKeys.map(k=>{let v=featRaw(r,k,thr);if(!isNum(v))v=stats[k].m;return (v-stats[k].m)/stats[k].sd;}));
  const p=featKeys.length;const XtX=Array.from({length:p},()=>Array(p).fill(0));const Xty=Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){Xty[a]+=X[i][a]*(y[i]-ym);for(let b=0;b<p;b++)XtX[a][b]+=X[i][a]*X[i][b];}}
  for(let a=0;a<p;a++)XtX[a][a]+=1.0;
  const beta=matMulVec(matInv(XtX),Xty);
  return {beta,stats,ym,imp,featKeys:featKeys.slice(),thr:Object.assign({},thr)};}
function predict(model,r){let s=model.ym;model.featKeys.forEach((k,i)=>{let v=featRaw(r,k,model.thr);if(!isNum(v))v=model.stats[k].m;s+=model.beta[i]*((v-model.stats[k].m)/model.stats[k].sd);});return s;}
function r2(model,rows){const y=rows.map(r=>bzVal(r,'displacement_index'));const ym=y.reduce((a,b)=>a+b,0)/y.length;
  let ss=0,st=0;rows.forEach((r,i)=>{const p=predict(model,r);ss+=(y[i]-p)**2;st+=(y[i]-ym)**2;});return 1-ss/(st||1);}
function rankCorr(model,rows){const arr=rows.map(r=>({p:predict(model,r),y:bzVal(r,'displacement_index')}));
  return pearson(ranks(arr.map(a=>a.p)),ranks(arr.map(a=>a.y)));}

const FIT_FEATURES=[
  {g:'Neighborhood',items:[['nbhd_income','neighborhood income'],['nbhd_rent','neighborhood rent'],['nbhd_pct_own','neighborhood % owner-occupied'],['__lowinc','low-income flag (editable cutoff)']]},
  {g:'Parcel / land',items:[['land_value','land value'],['building_to_land','building-to-land ratio'],['building_age','building age'],['parcel_underutilized','parcel underutilized'],['parcel_out_of_state_owner','out-of-state owner'],['parcel_recent_sale','recent sale (2020 to 2025)']]},
  {g:'Building / business',items:[['employees','employees'],['leases_building','leases vs owns'],['__small','small-business flag (editable cutoff)']]},
  {g:'Geography',items:[['dist_station_mi','distance to nearest station'],['__near','near-station flag (editable cutoff)']]}
];
const LEAK_FEATS=new Set(['nbhd_pct_own','parcel_underutilized','parcel_out_of_state_owner','__lowinc']);
function featLabel(k){for(const g of FIT_FEATURES)for(const it of g.items)if(it[0]===k)return it[1];return catLabel(k);}

/* ============================================================
 * Data-quality readout
 * ============================================================ */
const DQ=(()=>{
  const feats=['land_value','building_age','building_to_land','employees','parcel_underutilized','parcel_out_of_state_owner','parcel_recent_sale','nbhd_income','nbhd_rent'];
  const rows=ALLBIZ;let tot=0,have=0;const per={};
  feats.forEach(f=>{let h=0;rows.forEach(r=>{if(isNum(bzVal(r,f)))h++;});per[f]=Math.round(100*h/rows.length);tot++;have+=per[f];});
  const dispN=D.npa.filter(r=>isNum(npaVal(r,'disp'))).length;
  return {overall:Math.round(have/tot),per,dispN,nNpa:D.npa.length,stationsRaw:ST_RAW.length,stationsUniq:ST_UNIQ.length};
})();

/* ============================================================
 * Persistent state (localStorage)
 * ============================================================ */
const SKEY='cot_lab_v1';
const DEFAULT_STATE={
  view:'brief', hypothesis:'',
  pins:[], missions:{}, notes:{},
  thresholds:{small_emp:9, near_mi:0.5, income_pct:33},
  savedModels:[],
  similarity:{income:'',ownership:'',demolitions:''},
  adapt:{},
  argument:{claim:[],evidence:[],counter:[],who:[],transfers:[],caveat:[]},
  argumentText:{claim:'',transfers:''}
};
let S;
try{ S=Object.assign({},DEFAULT_STATE,JSON.parse(localStorage.getItem(SKEY)||'{}')); }
catch(e){ S=Object.assign({},DEFAULT_STATE); }
S.thresholds=Object.assign({},DEFAULT_STATE.thresholds,S.thresholds||{});
S.argument=Object.assign({},DEFAULT_STATE.argument,S.argument||{});
window.S=S;
let _saveT;
function save(){clearTimeout(_saveT);document.getElementById('saveState').textContent='saving…';
  _saveT=setTimeout(()=>{try{localStorage.setItem(SKEY,JSON.stringify(S));}catch(e){}
    document.getElementById('saveState').textContent='saved ✓';},250);}
function resetAll(){if(confirm('Clear all your work (pins, notes, models, argument)? This cannot be undone.')){localStorage.removeItem(SKEY);location.reload();}}

/* ============================================================
 * Evidence tray
 * ============================================================ */
function clip(src,text){S.pins.push({id:'p'+Date.now()+Math.floor(Math.random()*99),src,text,t:Date.now()});renderPins();save();toast('Clipped to evidence');flashPill();}
function unpin(id){S.pins=S.pins.filter(p=>p.id!==id);
  // also remove from argument slots
  Object.keys(S.argument).forEach(k=>S.argument[k]=S.argument[k].filter(x=>x!==id));
  renderPins();save();if(S.view==='argument')renderArgument();}
function renderPins(){
  document.getElementById('evCount').textContent=S.pins.length;
  document.getElementById('trayN').textContent=S.pins.length;
  const h=document.getElementById('pinlist');
  h.innerHTML=S.pins.length?S.pins.slice().reverse().map(p=>
    `<div class="pin" draggable="true" data-id="${p.id}"><button class="x" onclick="unpin('${p.id}')">✕</button>`+
    `<div>${esc(p.text)}</div><div class="src">${esc(p.src)}</div></div>`).join('')
    :'<div class="note">Nothing clipped yet. Use the <span style="color:#6b4ea0">Clip</span> buttons in any tool to collect evidence here.</div>';
  bindPinDrag();
}
function flashPill(){const p=document.getElementById('evPill');p.style.background='#e8f0fe';setTimeout(()=>p.style.background='',350);}
function toggleTray(){const t=document.getElementById('tray'),b=document.getElementById('trayBack');const open=t.classList.toggle('open');if(b)b.classList.toggle('show',open);}
function bindPinDrag(){document.querySelectorAll('#pinlist .pin').forEach(el=>{
  el.ondragstart=e=>{e.dataTransfer.setData('text/plain',el.dataset.id);el.classList.add('dragging');};
  el.ondragend=()=>el.classList.remove('dragging');});}

/* ============================================================
 * Modal + toast
 * ============================================================ */
function openModal(t,b){document.getElementById('modalTitle').textContent=t;document.getElementById('modalBody').innerHTML=b;document.getElementById('modal').classList.remove('hidden');}
function closeModal(){document.getElementById('modal').classList.add('hidden');}
document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal();});
let _toastT;function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(_toastT);_toastT=setTimeout(()=>t.classList.remove('show'),1600);}

/* ============================================================
 * Navigation / router
 * ============================================================ */
const NAV=[
  {grp:'Orient',items:[
    {id:'brief',ic:'◎',t:'The brief'},
    {id:'guide',ic:'📖',t:'Field guide & data'},
  ]},
  {grp:'Investigate',items:[
    {id:'map',ic:'🗺',t:'Map studio'},
    {id:'chart',ic:'📈',t:'Chart studio'},
    {id:'corr',ic:'▦',t:'Correlations'},
    {id:'regress',ic:'📈',t:'Regression'},
    {id:'pop',ic:'⛃',t:'Population builder'},
    {id:'time',ic:'⏳',t:'Time machine'},
    {id:'dig',ic:'🔬',t:'Dig into one area'},
    {id:'table',ic:'▦',t:'Data table'},
  ]},
  {grp:'Reason',items:[
    {id:'missions',ic:'🎯',t:'Missions'},
    {id:'index',ic:'🧮',t:'Build your own index'},
    {id:'red',ic:'🚇',t:'Carry to the Red Line'},
  ]},
  {grp:'Conclude',items:[
    {id:'argument',ic:'⚖',t:'Argument board'},
  ]},
];
const VIEWS={}; // id -> render fn (filled by modules)
const ICON={
 brief:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="3.5" width="11" height="13" rx="2"/><path d="M7.5 7h5M7.5 10h5M7.5 13h3"/></svg>',
 guide:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5.5C8.8 4.6 7 4.3 5 4.5v9c2-.2 3.8.1 5 1 1.2-.9 3-1.2 5-1v-9c-2-.2-3.8.1-5 1z"/><path d="M10 5.5v9"/></svg>',
 map:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16.5s5-4.3 5-8.5a5 5 0 0 0-10 0c0 4.2 5 8.5 5 8.5z"/><circle cx="10" cy="8" r="1.7"/></svg>',
 chart:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 4v11.5H16"/><path d="M7 12l2.5-3.5 2 2L16 6"/></svg>',
 corr:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4.5" width="11" height="11" rx="1.5"/><path d="M8.2 4.5v11M11.8 4.5v11M4.5 8.2h11M4.5 11.8h11"/></svg>',
 pop:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 5.5h11l-4.2 5.4v3.6l-2.6 1.3v-4.9z"/></svg>',
 time:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6"/><path d="M10 6.5V10l2.4 1.5"/></svg>',
 dig:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="4.6"/><path d="M12.6 12.6L16 16"/></svg>',
 table:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4.5" width="11" height="11" rx="1.5"/><path d="M4.5 8.3h11M4.5 12h11M9 4.5v11"/></svg>',
 missions:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6.7l1.4 1.4L9 5.6"/><path d="M5 12.7l1.4 1.4L9 11.6"/><path d="M11 7h4.2M11 13.2h4.2"/></svg>',
 index:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4.5" y1="6.2" x2="15.5" y2="6.2"/><circle cx="12.5" cy="6.2" r="1.9"/><line x1="4.5" y1="10" x2="15.5" y2="10"/><circle cx="7.5" cy="10" r="1.9"/><line x1="4.5" y1="13.8" x2="15.5" y2="13.8"/><circle cx="11.5" cy="13.8" r="1.9"/></svg>',
 model:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.5h2.5l1.6-4 2.6 8 1.6-5 1 1h3.2"/></svg>',
 red:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16V5.5"/><path d="M6.5 9L10 5.5 13.5 9"/></svg>',
 argument:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4.2v11.6"/><path d="M5.5 15.8h9"/><path d="M4 7.2h12"/><path d="M4 7.2l-1.7 3.4h3.4z"/><path d="M16 7.2l-1.7 3.4h3.4z"/></svg>'
};
ICON.regress='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l4-3 3 2 5-7"/><circle cx="4" cy="16" r="1"/><circle cx="16" cy="8" r="1"/></svg>';
function navIcon(id){return ICON[id]||'';}
function renderRail(){
  const done=k=>S.missions[k]&&S.missions[k].done;
  const missionsDone=MISSIONS?MISSIONS.filter(m=>done(m.id)).length:0;
  let h='';
  NAV.forEach(g=>{
    h+=`<div class="navgrp"><div class="lbl">${g.grp}</div>`;
    g.items.forEach(it=>{
      const extra=it.id==='missions'&&missionsDone?`<span class="badge">${missionsDone}/${MISSIONS.length}</span>`:
        (it.id==='argument'&&argScore().filled?`<span class="ck">${argScore().filled}/6</span>`:'');
      h+=`<div class="navitem ${S.view===it.id?'active':''}" onclick="go('${it.id}')"><span class="ic">${navIcon(it.id)||it.ic}</span>${it.t}${extra}</div>`;
    });
    h+='</div>';
  });
  h+=`<div class="navgrp" style="margin-top:8px;border-top:1px solid var(--line2);padding-top:10px">
    <div class="railnote">Your work auto-saves to this browser. ~10 hours of investigation lives here.</div>
    <div class="navitem" onclick="resetAll()" style="color:var(--mut);font-size:12px"><span class="ic"><svg viewBox=\"0 0 20 20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M15 7a6 6 0 1 0 1 5\"/><path d=\"M15.5 4v3h-3\"/></svg></span>Reset everything</div></div>`;
  document.getElementById('rail').innerHTML=h;
}
let _mapObj=null;
function go(id){
  // teardown leaflet map if leaving map view
  if(_mapObj){try{_mapObj.remove();}catch(e){}_mapObj=null;}
  S.view=id;save();renderRail();
  const fn=VIEWS[id];
  document.getElementById('main').innerHTML='';
  if(fn)fn(); else document.getElementById('main').innerHTML='<div class="card"><p>Coming soon.</p></div>';
  window.scrollTo(0,0);
}
function clipBtn(src,textFn,label){
  const id='cb'+Math.random().toString(36).slice(2,8);
  setTimeout(()=>{const b=document.getElementById(id);if(b)b.onclick=()=>{clip(src,textFn());b.classList.add('done');b.textContent='Clipped';setTimeout(()=>{b.classList.remove('done');b.textContent=label||'Clip this';},1200);};},0);
  return `<button class="clip" id="${id}">${label||'Clip this'}</button>`;
}

/* DQ pill value + modal (defined in guide module too) */

function boot(){ renderPins(); renderRail(); go(S.view||'brief'); }

/* ============================================================
 * VIEW MODULES
 * ============================================================ */
/* ---------------- BRIEF ---------------- */
VIEWS.brief=function(){
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--blue)">The Charlotte Decision Challenge</div>
    <h2>Which businesses should the City support?</h2>
    <p class="lede">Charlotte is planning the LYNX <b style="color:var(--red)">Red Line</b> north through Huntersville, Cornelius, and Davidson. Using real data, find which local businesses and areas are most affected, tell risk apart from resilience, and recommend who the City should prioritize for outreach and support. No coding required.</p>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
    ${statTile(ALLBIZ.length.toLocaleString(),'businesses in the study','blue')}
    ${statTile(DIG_NPAS.size,'neighborhoods with businesses','silver')}
    ${statTile(SECTORS.length,'business sectors','gold')}
    ${statTile(D.catalog.length,'variables to explore','red')}
  </div>

  <div>
    <div class="card">
      <h3>Questions to carry with you</h3>
      <ul style="margin:0;padding-left:20px;font-size:14px;color:var(--ink2);line-height:1.6">
        <li>When the train arrives, what changes for nearby shops, and how fast?</li>
        <li>What does an at-risk business look like in the data? What does a resilient one look like?</li>
        <li>Which signals live at the neighborhood, parcel, and business scale?</li>
        <li>Is a pattern the train, or the citywide boom that would have happened anyway?</li>
      </ul>
    </div>
    <div class="card">
      <h3>Your one-sentence hypothesis</h3>
      <p class="small mut">Write a first hunch. You will revisit it at the end and see how the evidence changed it.</p>
      <textarea id="hypo" placeholder="The businesses that will need the most support along the Red Line are…">${esc(S.hypothesis)}</textarea>
      <div class="small mut" style="margin-top:6px">Saved automatically.</div>
    </div>
  </div>

  <div class="card">
    <h3>How to spend the day</h3>
    <p class="small mut">Missions give you a path through the data. The sandbox tools are yours to explore freely.</p>
    <div class="bars" style="margin-top:6px">
      ${[['Orient: the brief, field guide and data dictionary','','guide'],
         ['Missions 1 to 4: read the corridor at three scales and over time','','missions'],
         ['Free exploration with Map, Chart, Population and Time machine','','map'],
         ['Missions 5 and 6: does more data help, and does being near a station matter','','missions'],
         ['Build your own index: weight the signals, score it against the City','','index'],
         ['Carry to the Red Line: transfer, adapt, permit reality check','','red'],
         ['Argument board: assemble and export your case','','argument']
       ].map(r=>`<div class="spread" style="padding:7px 0;border-bottom:1px solid var(--line2)">
         <div><b style="font-weight:600">${r[0]}</b></div>
         <button class="btn ghost sm" onclick="go('${r[2]}')">open</button></div>`).join('')}
    </div>
  </div>

  <div class="card tight">
    <div class="spread"><div class="small mut">Scope: Mecklenburg County. Learn on the Blue and Silver corridors, then apply to the Red Line.</div>
    <button class="btn" onclick="go('guide')">Start with the field guide →</button></div>
  </div>`;
  document.getElementById('hypo').oninput=function(){S.hypothesis=this.value;save();};
};

/* ---------------- FIELD GUIDE + DATA DICTIONARY + DQ ---------------- */
function provTag(p){return p==='derived'?'<span class="tag derived">derived</span>':
  p.indexOf('QoL')>=0?'<span class="tag npa">QoL survey</span>':
  p.indexOf('assessor')>=0?'<span class="tag biz">assessor</span>':
  '<span class="tag derived">'+esc(p)+'</span>';}
VIEWS.guide=function(){
  const m=document.getElementById('main');
  const cats=Array.from(new Set(D.catalog.map(c=>c.category))).sort();
  m.innerHTML=`
  <div class="card">
    <div class="kick">Field guide</div>
    <h2>Field guide</h2>
    <p class="lede">Every variable, where it comes from, and what it can and cannot tell you. Knowing which numbers are real measurements and which are derived is half the skill.</p>
    <div class="row">
      <button class="btn ghost sm" onclick="document.getElementById('gloss').scrollIntoView({behavior:'smooth'})">Key concepts</button>
      <button class="btn ghost sm" onclick="document.getElementById('breaks').scrollIntoView({behavior:'smooth'})">Measurement breaks ⚠</button>
    </div>
  </div>

  <div class="card">
    <div class="spread" style="margin-bottom:10px">
      <h3 style="margin:0">Data dictionary · ${D.catalog.length} variables</h3>
      <input type="text" id="dictSearch" placeholder="search variables…" style="min-width:220px">
    </div>
    <div class="chips" id="dictCats">
      <span class="chip on" data-c="">all</span>
      <span class="chip" data-c="Neighborhood">Neighborhood</span>
      <span class="chip" data-c="Parcel">Parcel</span>
      <span class="chip" data-c="Business">Business</span>
      ${cats.map(c=>`<span class="chip" data-c="cat:${esc(c)}">${esc(c)}</span>`).join('')}
    </div>
    <div class="scrollx"><table class="t" id="dictTable"></table></div>
    <div class="small mut" id="dictCount" style="margin-top:6px"></div>
  </div>

  <div class="card" id="gloss">
    <h3>Key concepts</h3>
    <div class="grid2">
      <div>
        ${gloss('Displacement index','A constructed City vulnerability score, 0 to 5, defined at the <b>neighborhood</b> level. Every business in a neighborhood shares it. It is the target you will model, but it is a label the City built, not an observed eviction or relocation.')}
        ${gloss('il_ratio / building-to-land','Building value ÷ land value. Low ratio = the land is worth far more than what sits on it → ripe for redevelopment. Undefined when land value = 0.')}
        ${gloss('Underutilized','A derived flag: il_ratio &lt; 1.5, or building value &lt; $5,000 (vacant). A redevelopment signal, but also one of the things the index is built from.')}
      </div>
      <div>
        ${gloss('Out-of-state owner','Owner\'s mailing address is outside NC. A proxy for absentee or investor ownership. It is also one of the ingredients the City used to build its displacement index.')}
        ${gloss('Circular evidence','Using a variable to predict an outcome that was partly <b>built from</b> that same variable. It makes the fit look better than it is. The displacement index was built from several variables in this dataset, so part of your job is noticing which ones.')}
        ${gloss('Out-of-sample','Testing a rule on data it never saw while being built. Here: learn on Blue+Silver, test on the Red Line. In-sample accuracy always flatters; out-of-sample is the honest number.')}
      </div>
    </div>
  </div>

  <div class="card" id="breaks">
    <h3>⚠ Things that will fool you</h3>
    <div class="warnbox"><b>Measurement breaks.</b> Business counts come from the Census CBP, whose methodology shifts around <b>2012</b>; building-permit coverage firms up around <b>2016</b>. A jump across those years can be a <i>recording</i> change, not a real-world change. The Time machine shades these years.</div>
    <div class="warnbox"><b>The target is sparse.</b> The neighborhood displacement index is populated for only <b>${DQ.dispN} of ${DQ.nNpa}</b> neighborhoods. Businesses inherit it, so the table looks more complete than it is.</div>
    <div class="warnbox"><b>The station list is dirty.</b> The raw transit-stop list has <b>${DQ.stationsRaw}</b> entries but only <b>${DQ.stationsUniq}</b> unique locations. This tool de-duplicates before measuring distances.</div>
    <div class="warnbox"><b>Imputation.</b> Neighborhood income and rent are missing for about 85% of businesses; models fill gaps with the column average, so lean on them lightly.</div>
  </div>`;
  // wire dictionary
  let dq='',dcat='';
  function drawDict(){
    let rows=D.catalog.filter(c=>{
      if(dcat==='Neighborhood'||dcat==='Parcel'||dcat==='Business'){if(c.level!==dcat)return false;}
      else if(dcat==='__leak'){if(!c.leak)return false;}
      else if(dcat.startsWith('cat:')){if(c.category!==dcat.slice(4))return false;}
      if(dq){const s=(c.title+' '+c.key+' '+c.category).toLowerCase();if(s.indexOf(dq)<0)return false;}
      return true;});
    document.getElementById('dictTable').innerHTML=
      '<thead><tr><th>Variable</th><th>Level</th><th>Category</th><th>Unit</th><th>Source</th></tr></thead><tbody>'+
      rows.map(c=>`<tr><td><b style="font-weight:600">${esc(c.title)}</b><div class="tiny mut">${esc(c.key)}</div></td>`+
        `<td><span class="tag ${c.level==='Neighborhood'?'npa':c.level==='Business'?'biz':'derived'}">${esc(c.level)}</span></td>`+
        `<td>${esc(c.category)}</td><td>${esc(c.unit||'—')}</td><td>${provTag(c.prov)}</td></tr>`).join('')+'</tbody>';
    document.getElementById('dictCount').textContent=rows.length+' variables shown';
  }
  document.getElementById('dictSearch').oninput=function(){dq=this.value.toLowerCase();drawDict();};
  document.querySelectorAll('#dictCats .chip').forEach(ch=>ch.onclick=function(){
    document.querySelectorAll('#dictCats .chip').forEach(x=>x.classList.remove('on'));this.classList.add('on');dcat=this.dataset.c;drawDict();});
  drawDict();
};
function gloss(t,b){return `<div style="margin-bottom:12px"><div style="font-weight:650;font-size:14px">${t}</div><div class="small mut" style="line-height:1.5">${b}</div></div>`;}

function openDQ(){
  const per=DQ.per;
  const rows=Object.keys(per).map(k=>{const v=per[k];const col=v>=90?'var(--good)':v>=60?'var(--warn)':'var(--bad)';
    return `<div class="barrow"><div>${esc(catLabel(k)||k)}</div><div class="bar" style="width:${v}%;background:${col}"></div><div>${v}%</div></div>`;}).join('');
  openModal('Data-quality readout',
    `<p class="small mut">Share of the ${ALLBIZ.length.toLocaleString()} businesses that carry a real measured value for each modelling feature. Below ~60% (red), a model is mostly working off the column average.</p>
     <div class="bars">${rows}</div>
     <div class="note" style="margin-top:12px"><b>Overall measured:</b> ${DQ.overall}% across these features. <b>Target coverage:</b> the neighborhood displacement index exists for ${DQ.dispN}/${DQ.nNpa} neighborhoods. <b>Stations:</b> ${DQ.stationsRaw} raw → ${DQ.stationsUniq} unique (de-duplicated here).</div>
     <p class="small mut" style="margin-top:10px">Honesty layer: imputed values are filled with the column mean and counted, never hidden. The Model lab shows the imputation % for every feature you pick.</p>`);
}
/* ---------------- MAP STUDIO ---------------- */
const NPA_BY_ID={}; D.npa.forEach(r=>NPA_BY_ID[npaVal(r,'npa')]=r);
// NPA-level variables grouped by category for selectors
const NPA_COV={};(function(){D.catalog.forEach(c=>{if(c.level==='Neighborhood'&&(c.key in NPAI)){let n=0;D.npa.forEach(r=>{if(isNum(npaVal(r,c.key)))n++;});NPA_COV[c.key]=Math.round(100*n/D.npa.length);}});})();
const COV_MIN=70; // hide neighborhood variables with heavy missing data from the map
function npaVarGroups(coveredOnly){
  const groups={};
  D.catalog.forEach(c=>{ if(c.level==='Neighborhood' && (c.key in NPAI) && c.key!=='npa'){ if(coveredOnly && NPA_COV[c.key]<COV_MIN) return; (groups[c.category]=groups[c.category]||[]).push(c); }});
  return groups;
}
function npaVarSelect(id,sel,coveredOnly){
  const g=npaVarGroups(coveredOnly);
  return `<select id="${id}">`+Object.keys(g).sort().map(cat=>
    `<optgroup label="${esc(cat)}">`+g[cat].map(c=>`<option value="${c.key}" ${c.key===sel?'selected':''}>${esc(c.title)}</option>`).join('')+`</optgroup>`).join('')+`</select>`;
}
let _mapState={key:'HOUSEHOLD INCOME',rev:false,lines:true,stations:true,zoomLine:'',zoomNpa:''};
function npaLineToken(id){const f=window.NPAS.features.find(x=>x.properties.id==id);return f?(f.properties.lns||''):'';}
function npaLineLabel(id){const t=npaLineToken(id).split(';')[0];return t?t.charAt(0).toUpperCase()+t.slice(1):'Off-corridor';}
VIEWS.map=function(){
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--blue)">Investigate · map studio</div>
    <h2>Neighborhood map</h2>
    <p class="small mut">Shade all ${D.npa.length} Mecklenburg neighborhoods by a chosen variable, then use <b>Zoom to</b> to drop into any neighborhood on a line and read its profile.</p>
    <div class="row" style="margin:6px 0 2px">
      <label class="fld">Shade by ${npaVarSelect('mapKey',_mapState.key,true)}</label>
      <label class="chip ${_mapState.lines?'on':''}" id="mapLines">Transit lines</label>
      <label class="chip ${_mapState.stations?'on':''}" id="mapStations">Stations</label>
      <label class="chip ${_mapState.rev?'on':''}" id="mapRev">Reverse scale</label>
      <span id="mapClip"></span>
    </div>
    <div class="row" style="margin:2px 0 2px;padding:8px 10px;background:var(--panel2);border:1px solid var(--line);border-radius:9px">
      <label class="fld">Zoom to · line <select id="mapZL"><option value="">all corridors</option><option value="blue">Blue</option><option value="silver">Silver</option><option value="gold">Gold</option><option value="red">Red</option></select></label>
      <label class="fld">neighborhood <select id="mapZN"></select></label>
      <button class="btn ghost sm" id="mapReset" style="align-self:flex-end">Reset view</button>
    </div>
    <div class="legend" id="mapLegend"></div>
    <div class="mapbox" id="mapHost" style="height:520px;margin-top:8px"></div>
    <div class="small mut" id="mapDesc" style="margin-top:6px"></div>
  </div>
  <div class="grid2">
    <div class="card"><h3 style="margin-bottom:8px">Highest 12</h3><div class="scrollx" style="max-height:340px"><table class="t" id="mapTop"></table></div></div>
    <div class="card"><h3 style="margin-bottom:8px">Lowest 12</h3><div class="scrollx" style="max-height:340px"><table class="t" id="mapBot"></table></div></div>
  </div>`;
  document.getElementById('mapClip').innerHTML=clipBtn('Map studio',()=>mapClipText(),'Clip this map');
  const map=L.map('mapHost',{scrollWheelZoom:true,zoomControl:true}).setView([35.32,-80.82],10);
  _mapObj=map;
  map.createPane('choro');map.getPane('choro').style.zIndex=350;
  map.createPane('lnpane');map.getPane('lnpane').style.zIndex=450;map.getPane('lnpane').style.pointerEvents='none';
  map.createPane('stpane');map.getPane('stpane').style.zIndex=460;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:18,attribution:'© OpenStreetMap © CARTO',subdomains:'abcd'}).addTo(map);
  let geoLayer=null, lineLayer=null, stLayer=null; const layerById={};
  function vals(key){return D.npa.map(r=>npaVal(r,key)).filter(isNum);}
  function draw(){
    const key=_mapState.key;
    const vs=vals(key); const lo=quantile(vs,0.05), hi=quantile(vs,0.95);
    if(geoLayer)map.removeLayer(geoLayer);
    geoLayer=L.geoJSON(window.NPAS,{pane:'choro',style:f=>{
        const row=NPA_BY_ID[f.properties.id]; const v=row?npaVal(row,key):null;
        let t=isNum(v)?(v-lo)/((hi-lo)||1):null; if(_mapState.rev&&t!=null)t=1-t;
        return {color:'#dfe3ea',weight:.6,fillColor:t==null?'#eef0f4':colorScale(t),fillOpacity:t==null?.3:.86};
      },
      onEachFeature:(f,layer)=>{const row=NPA_BY_ID[f.properties.id];layerById[f.properties.id]=layer;
        layer.on('click',()=>{ if(row) layer.bindPopup(npaPopup(row,key)).openPopup(); });
        layer.on('mouseover',()=>layer.setStyle({weight:2.4,color:'#1f6feb'}));
        layer.on('mouseout',()=>geoLayer.resetStyle(layer));
      }}).addTo(map);
    const c=catByKey[key];
    document.getElementById('mapLegend').innerHTML=
      `<b style="color:var(--ink)">${esc(catLabel(key))}</b>`+
      `<span style="margin-left:10px">${fmt(_mapState.rev?hi:lo)}</span><div class="grad" style="${_mapState.rev?'transform:scaleX(-1)':''}"></div><span>${fmt(_mapState.rev?lo:hi)}</span>`+
      `<span class="mut">· ${c?c.unit||'':''} · ${vs.length}/${D.npa.length} measured</span>`;
    document.getElementById('mapDesc').innerHTML=`Median across neighborhoods: <b>${fmt(median(vs))}</b>. Red Line neighborhoods: `+
      D.npa.filter(r=>npaVal(r,'is_red')===1).map(r=>`${esc(npaVal(r,'town')||'NPA '+npaVal(r,'npa'))} ${fmt(npaVal(r,key))}`).join(' · ');
    rankTables(key);
  }
  function rankTables(key){
    const rows=D.npa.filter(r=>isNum(npaVal(r,key)))
      .map(r=>({npa:npaVal(r,'npa'),town:npaVal(r,'town')||'',red:npaVal(r,'is_red')===1,v:npaVal(r,key)}))
      .sort((a,b)=>b.v-a.v);
    const tbl=arr=>'<thead><tr><th>NPA</th><th>Area</th><th>'+esc(catLabel(key))+'</th></tr></thead><tbody>'+
      arr.map(x=>`<tr onclick="window._mapZoom&&window._mapZoom(${x.npa})" style="cursor:pointer"><td>${x.npa}${x.red?' <span class="tag npa" style="background:#fdeef2;color:#a01f3c">Red</span>':''}</td><td>${esc(x.town||'—')}</td><td>${fmt(x.v)}</td></tr>`).join('')+'</tbody>';
    document.getElementById('mapTop').innerHTML=tbl(rows.slice(0,12));
    document.getElementById('mapBot').innerHTML=tbl(rows.slice(-12).reverse());
  }
  function drawLines(){
    if(lineLayer){map.removeLayer(lineLayer);lineLayer=null;}
    if(_mapState.lines&&window.LINESG)lineLayer=L.geoJSON(window.LINESG,{pane:'lnpane',style:f=>{const ln=(f.properties.line||'').toLowerCase();
      return {color:LINEHEX[ln]||'#444',weight:4,opacity:.95,dashArray:f.properties.dash?'7,6':null};}}).addTo(map);
  }
  function drawStations(){
    if(stLayer){map.removeLayer(stLayer);stLayer=null;}
    if(_mapState.stations){stLayer=L.layerGroup();
      ST_UNIQ.forEach(s=>{const col=LINEHEX[(s[3]||'').toLowerCase()]||'#333';
        L.circleMarker([s[1],s[0]],{pane:'stpane',radius:4,color:'#fff',weight:1,fillColor:col,fillOpacity:1}).bindTooltip(s[2]||'').addTo(stLayer);});
      (window.RED_STATIONS||[]).forEach(s=>L.circleMarker([s.lat,s.lon],{pane:'stpane',radius:6,color:'#111',weight:1.5,fillColor:'#b3203a',fillOpacity:1}).bindTooltip('Red · '+s.name).addTo(stLayer));
      stLayer.addTo(map);}
  }
  function fillNpaPicker(){
    const ln=_mapState.zoomLine;
    const list=D.npa.filter(r=>{const id=npaVal(r,'npa');if(!DIG_NPAS.has(id))return false;const tok=npaLineToken(id);if(!ln)return true;return tok.split(';').indexOf(ln)>=0;})
      .map(r=>({id:npaVal(r,'npa'),town:npaVal(r,'town')||''})).sort((a,b)=>(a.town||'zzz').localeCompare(b.town||'zzz')||a.id-b.id);
    document.getElementById('mapZN').innerHTML='<option value="">pick a neighborhood</option>'+list.map(x=>`<option value="${x.id}">${esc(x.town||('NPA '+x.id))} · NPA ${x.id}</option>`).join('');
  }
  window._mapZoom=function(id){const lyr=layerById[id];if(!lyr)return;try{map.fitBounds(lyr.getBounds(),{maxZoom:14,padding:[20,20]});const row=NPA_BY_ID[id];if(row)lyr.bindPopup(npaPopup(row,_mapState.key)).openPopup();}catch(e){}};
  draw();drawLines();drawStations();fillNpaPicker();
  document.getElementById('mapKey').onchange=function(){_mapState.key=this.value;draw();};
  document.getElementById('mapLines').onclick=function(){_mapState.lines=!_mapState.lines;this.classList.toggle('on');drawLines();};
  document.getElementById('mapStations').onclick=function(){_mapState.stations=!_mapState.stations;this.classList.toggle('on');drawStations();};
  document.getElementById('mapRev').onclick=function(){_mapState.rev=!_mapState.rev;this.classList.toggle('on');draw();};
  document.getElementById('mapZL').onchange=function(){_mapState.zoomLine=this.value;fillNpaPicker();};
  document.getElementById('mapZN').onchange=function(){if(this.value)window._mapZoom(+this.value);};
  document.getElementById('mapReset').onclick=function(){map.setView([35.32,-80.82],10);};
  setTimeout(()=>map.invalidateSize(),60);
};

function npaPopup(row,key){
  const f=k=>fmt(npaVal(row,k));
  return `<b>${esc(npaVal(row,'town')||'NPA '+npaVal(row,'npa'))}</b> · NPA ${npaVal(row,'npa')}${npaVal(row,'is_red')===1?' <span style="color:#b3203a">(Red Line)</span>':''}<br>`+
    `<b>${esc(catLabel(key))}: ${f(key)}</b><hr style="margin:5px 0;border:none;border-top:1px solid #eee">`+
    `Income ${fmt$(npaVal(row,'HOUSEHOLD INCOME'))} · Own ${f('HOME OWNERSHIP')}% · Rent ${fmt$(npaVal(row,'RENTAL COSTS'))}<br>`+
    `Res. demolitions ${f('RESIDENTIAL DEMOLITIONS')} · Businesses ${f('n_businesses')} · % small ${f('pct_small_le9')}%`;
}
function mapClipText(){const key=_mapState.key;const vs=D.npa.map(r=>npaVal(r,key)).filter(isNum);
  const reds=D.npa.filter(r=>npaVal(r,'is_red')===1);
  return `Map of "${catLabel(key)}": median ${fmt(median(vs))} across neighborhoods. Red Line areas: ${reds.map(r=>(npaVal(r,'town')||'NPA'+npaVal(r,'npa'))+' '+fmt(npaVal(r,key))).join(', ')}.`;}
/* ---------------- CHART STUDIO ---------------- */
const BIZ_NUM=D.bizCols.filter(c=>['business_id','line','sector','npa'].indexOf(c)<0);
let _chart=null,_cs={level:'npa',x:'HOUSEHOLD INCOME',y:'RESIDENTIAL DEMOLITIONS',group:'none',kind:'scatter'};
function csVarSelect(id,sel){
  if(_cs.level==='npa')return npaVarSelect(id,sel);
  return `<select id="${id}">`+BIZ_NUM.map(k=>`<option value="${k}" ${k===sel?'selected':''}>${esc(catLabel(k))}</option>`).join('')+`</select>`;
}
VIEWS.chart=function(){
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--blue)">Investigate · chart studio</div>
    <h2>Compare two measures</h2>
    <p class="small mut">Pick any two measures. Correlation is not cause: ask what a control would show, and whether a third factor drives both.</p>
    <div class="chips">
      <span class="chip ${_cs.level==='npa'?'on':''}" data-lv="npa">Neighborhood level (${D.npa.length})</span>
      <span class="chip ${_cs.level==='biz'?'on':''}" data-lv="biz">Business level (${ALLBIZ.length.toLocaleString()})</span>
    </div>
    <div class="row" style="margin:6px 0">
      <label class="fld">X axis <span id="cxWrap"></span></label>
      <label class="fld">Y axis <span id="cyWrap"></span></label>
      <label class="fld">Color by <select id="cgrp"></select></label>
      <label class="fld">Chart <select id="ckind"><option value="scatter">scatter + fit line</option><option value="box">box plot (Y by group)</option></select></label>
      <span id="chartClip" style="align-self:flex-end"></span>
    </div>
    <div class="chartwrap"><canvas id="csCanvas"></canvas></div>
    <div class="note" id="csNote"></div>
  </div>
  <div class="card tight"><div class="small mut">At business level each dot is one shop. Color by line or sector to check whether a relationship holds inside each group or only across them.</div></div>`;
  function fillGroup(){
    const g=document.getElementById('cgrp');
    if(_cs.level==='npa')g.innerHTML=`<option value="none">none</option><option value="line">Transit line</option>`;
    else g.innerHTML=`<option value="none">none</option><option value="line">Transit line</option><option value="sector">Business sector</option>`;
    g.value=_cs.group;
  }
  document.getElementById('cxWrap').innerHTML=csVarSelect('cx',_cs.x);
  document.getElementById('cyWrap').innerHTML=csVarSelect('cy',_cs.y);
  fillGroup();
  document.getElementById('ckind').value=_cs.kind;
  document.getElementById('chartClip').innerHTML=clipBtn('Chart studio',()=>csClipText(),'Clip finding');
  document.querySelectorAll('[data-lv]').forEach(ch=>ch.onclick=function(){
    _cs.level=this.dataset.lv;
    if(_cs.level==='npa'){_cs.x='HOUSEHOLD INCOME';_cs.y='RESIDENTIAL DEMOLITIONS';}else{_cs.x='dist_station_mi';_cs.y='displacement_index';}
    _cs.group='none';VIEWS.chart();});
  ['cx','cy'].forEach(id=>document.getElementById(id).onchange=function(){_cs[id[1]]=this.value;drawCS();});
  document.getElementById('cgrp').onchange=function(){_cs.group=this.value;drawCS();};
  document.getElementById('ckind').onchange=function(){_cs.kind=this.value;drawCS();};
  drawCS();
};
function csData(){
  const rows=_cs.level==='npa'?D.npa:ALLBIZ;
  const getX=_cs.level==='npa'?(r=>npaVal(r,_cs.x)):(r=>bzVal(r,_cs.x));
  const getY=_cs.level==='npa'?(r=>npaVal(r,_cs.y)):(r=>bzVal(r,_cs.y));
  const grpOf=r=>{
    if(_cs.group==='none')return '';
    if(_cs.group==='line')return _cs.level==='npa'?npaLineLabel(npaVal(r,'npa')):bzVal(r,'line');
    if(_cs.group==='sector')return SECTORS[bzVal(r,'sector')]||'—';
    return '';
  };
  let pts=[];rows.forEach(r=>{const x=getX(r),y=getY(r);if(isNum(x)&&isNum(y))pts.push({x,y,g:grpOf(r)});});
  // sample for performance at biz level
  if(_cs.level==='biz'&&pts.length>4000){const step=pts.length/4000;const s=[];for(let i=0;i<pts.length;i+=step)s.push(pts[Math.floor(i)]);pts=s;}
  return pts;
}
const GROUP_COLORS={'Red Line':'#b3203a','Rest':'#9bb0c9','Blue':'#1f6feb','Silver':'#6b7280','Gold':'#b08a2e','Red':'#b3203a'};
function gColor(g,i){return GROUP_COLORS[g]||['#1f6feb','#b3203a','#b08a2e','#127a4b','#6b4ea0','#0e8a8a','#c2570c','#6b7280'][i%8];}
function drawCS(){
  const pts=csData();
  if(_chart){_chart.destroy();_chart=null;}
  const ctx=document.getElementById('csCanvas').getContext('2d');
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),r=pearson(xs,ys);
  if(_cs.kind==='box'&&_cs.group!=='none'){ drawBox(ctx,pts); }
  else{
    const groups=Array.from(new Set(pts.map(p=>p.g)));
    const ds=groups.map((g,i)=>({label:g||'points',data:pts.filter(p=>p.g===g).map(p=>({x:p.x,y:p.y})),
      backgroundColor:_cs.level==='biz'?gColor(g,i)+'33':gColor(g,i),pointRadius:_cs.level==='biz'?2:4.5,pointHoverRadius:6}));
    // fit line
    const lr=linreg(xs,ys);const xmin=Math.min(...xs),xmax=Math.max(...xs);
    ds.push({type:'line',label:'fit',data:[{x:xmin,y:lr.m*xmin+lr.b},{x:xmax,y:lr.m*xmax+lr.b}],borderColor:'#16202e',borderWidth:2,borderDash:[6,4],pointRadius:0,fill:false});
    _chart=new Chart(ctx,{type:'scatter',data:{datasets:ds},options:{animation:false,maintainAspectRatio:false,
      plugins:{legend:{display:groups.length>1||_cs.group!=='none',position:'top'},tooltip:{enabled:true}},
      scales:{x:{title:{display:true,text:catLabel(_cs.x)},grid:{color:'#eef2f7'}},y:{title:{display:true,text:catLabel(_cs.y)},grid:{color:'#eef2f7'}}}}});
  }
  document.getElementById('csNote').innerHTML=
    `<b>n = ${pts.length.toLocaleString()}</b> points with both values. `+
    (r!=null?`Correlation r = <b>${r.toFixed(2)}</b>, ${rWord(r)} between <b>${esc(catLabel(_cs.x))}</b> and <b>${esc(catLabel(_cs.y))}</b>.`:'Too few points to correlate.')+
    ` <span class="mut">Correlation ≠ causation. A control group or a third variable could explain it.</span>`;
}
function drawBox(ctx,pts){
  const groups=Array.from(new Set(pts.map(p=>p.g))).filter(x=>x).sort();
  const data=groups.map(g=>{const ys=pts.filter(p=>p.g===g).map(p=>p.y).sort((a,b)=>a-b);
    return {g,q1:quantile(ys,.25),med:quantile(ys,.5),q3:quantile(ys,.75),lo:quantile(ys,.05),hi:quantile(ys,.95),n:ys.length};});
  // emulate box with floating bars via Chart.js bar (q1..q3) + median point
  _chart=new Chart(ctx,{type:'bar',data:{labels:groups,datasets:[
    {label:'IQR (25 to 75%)',data:data.map(d=>[d.q1,d.q3]),backgroundColor:groups.map((g,i)=>gColor(g,i)+'55'),borderColor:groups.map((g,i)=>gColor(g,i)),borderWidth:1},
    {label:'median',type:'scatter',data:data.map((d,i)=>({x:i,y:d.med})),backgroundColor:'#16202e',pointRadius:5}
  ]},options:{animation:false,maintainAspectRatio:false,plugins:{legend:{position:'top'},tooltip:{callbacks:{label:c=>{const d=data[c.dataIndex];return d?`median ${fmt(d.med)} · IQR ${fmt(d.q1)} to ${fmt(d.q3)} · n=${d.n}`:'';}}}},
    scales:{y:{title:{display:true,text:catLabel(_cs.y)},grid:{color:'#eef2f7'}},x:{grid:{display:false}}}}});
}
function csClipText(){const pts=csData();const r=pearson(pts.map(p=>p.x),pts.map(p=>p.y));
  return `${_cs.level==='npa'?'Neighborhood':'Business'} level: ${catLabel(_cs.x)} vs ${catLabel(_cs.y)}, r=${r!=null?r.toFixed(2):'n/a'} (${rWord(r)}), n=${pts.length}.`;}
/* ---------------- POPULATION BUILDER ---------------- */
let _pf={line:'',sectors:[],distMax:5,empMax:9999,ageMax:9999,landMax:0,leases:'',ofs:'',underutil:'',recent:''};
VIEWS.pop=function(){
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--blue)">Investigate · population builder</div>
    <h2>Build a population</h2>
    <p class="small mut">Stack filters to define a group of businesses. Counts, sector mix, and average risk update live. Export the set.</p>
    <div class="row" style="margin-bottom:8px">
      <label class="fld">Line <select id="pfLine"><option value="">all lines</option><option value="Blue">Blue</option><option value="Silver">Silver</option><option value="Red">Red</option></select></label>
      <label class="fld">Within ___ mi of a station <input type="number" id="pfDist" step="0.25" min="0" value="${_pf.distMax}" style="width:90px"></label>
      <label class="fld">Max employees <input type="number" id="pfEmp" min="0" value="${_pf.empMax}" style="width:90px"></label>
      <label class="fld">Tenure <select id="pfLease"><option value="">own or lease</option><option value="1">leases building</option><option value="0">owns building</option></select></label>
      <label class="fld">Out-of-state owner <select id="pfOfs"><option value="">either</option><option value="1">yes</option><option value="0">no</option></select></label>
      <label class="fld">Underutilized parcel <select id="pfUnder"><option value="">either</option><option value="1">yes</option><option value="0">no</option></select></label>
      <label class="fld">Recent sale <select id="pfRecent"><option value="">either</option><option value="1">2020 to 2025</option><option value="0">no</option></select></label>
      <label class="fld">Max building age <input type="number" id="pfAge" min="0" value="${_pf.ageMax>=9999?'':_pf.ageMax}" placeholder="any" style="width:84px"></label>
      <label class="fld">Max land value ($) <input type="number" id="pfLand" min="0" value="${_pf.landMax>0?_pf.landMax:''}" placeholder="any" style="width:120px"></label>
      <button class="btn ghost sm" id="pfReset" style="align-self:flex-end">Reset filters</button>
    </div>
    <div><div class="small mut" style="margin-bottom:4px">Sectors (none = all):</div><div class="chips" id="pfSectors"></div></div>
  </div>
  <div id="popStats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px"></div>
  <div class="grid2">
    <div class="card"><div class="spread"><h3 style="margin:0">Sector mix</h3></div><div class="small mut" style="margin-bottom:6px">Share of the selected businesses in each sector.</div><div id="popMix" style="margin-top:8px"></div></div>
    <div class="card"><div class="spread"><h3 style="margin:0">Distance to station</h3></div><div class="small mut" style="margin-bottom:6px">Split by distance to the nearest station.</div><div id="popDist" style="margin-top:8px"></div>
      <div style="margin-top:12px" id="popClip"></div>
      <button class="btn sec sm" id="popCsv" style="margin-top:8px">Export this population (CSV)</button></div>
  </div>
  <div class="card"><h3 style="margin:0 0 8px">By transit line</h3><div id="popLines"></div></div>`;
  document.getElementById('pfSectors').innerHTML=SECTORS.map((s,i)=>`<span class="chip ${_pf.sectors.includes(i)?'on':''}" data-s="${i}">${esc(s)}</span>`).join('');
  document.getElementById('popClip').innerHTML=clipBtn('Population builder',()=>popClipText(),'Clip this population');
  document.getElementById('pfLine').value=_pf.line;
  document.getElementById('pfLease').value=_pf.leases;document.getElementById('pfOfs').value=_pf.ofs;
  document.getElementById('pfUnder').value=_pf.underutil;document.getElementById('pfRecent').value=_pf.recent;
  const re=()=>drawPop();
  document.getElementById('pfLine').onchange=function(){_pf.line=this.value;re();};
  document.getElementById('pfDist').oninput=function(){_pf.distMax=parseFloat(this.value)||999;re();};
  document.getElementById('pfEmp').oninput=function(){_pf.empMax=parseFloat(this.value)||9999;re();};
  document.getElementById('pfLease').onchange=function(){_pf.leases=this.value;re();};
  document.getElementById('pfOfs').onchange=function(){_pf.ofs=this.value;re();};
  document.getElementById('pfUnder').onchange=function(){_pf.underutil=this.value;re();};
  document.getElementById('pfRecent').onchange=function(){_pf.recent=this.value;re();};
  document.getElementById('pfAge').oninput=function(){_pf.ageMax=this.value===''?9999:(parseFloat(this.value)||9999);re();};
  document.getElementById('pfLand').oninput=function(){_pf.landMax=this.value===''?0:(parseFloat(this.value)||0);re();};
  document.getElementById('pfReset').onclick=function(){_pf={line:'',sectors:[],distMax:5,empMax:9999,ageMax:9999,landMax:0,leases:'',ofs:'',underutil:'',recent:''};VIEWS.pop();};
  document.querySelectorAll('#pfSectors .chip').forEach(ch=>ch.onclick=function(){
    const i=+this.dataset.s;if(_pf.sectors.includes(i))_pf.sectors=_pf.sectors.filter(x=>x!==i);else _pf.sectors.push(i);
    this.classList.toggle('on');re();});
  drawPop();
};
function popFilter(){
  return ALLBIZ.filter(r=>{
    if(_pf.line&&bzVal(r,'line')!==_pf.line)return false;
    const d=bzVal(r,'dist_station_mi');if(isNum(d)&&d>_pf.distMax)return false;
    const e=bzVal(r,'employees');if(isNum(e)&&e>_pf.empMax)return false;
    if(_pf.sectors.length&&!_pf.sectors.includes(bzVal(r,'sector')))return false;
    if(_pf.leases!==''&&bzVal(r,'leases_building')!=+_pf.leases)return false;
    if(_pf.ofs!==''&&bzVal(r,'parcel_out_of_state_owner')!=+_pf.ofs)return false;
    if(_pf.underutil!==''&&bzVal(r,'parcel_underutilized')!=+_pf.underutil)return false;
    if(_pf.recent!==''&&bzVal(r,'parcel_recent_sale')!=+_pf.recent)return false;
    const ag=bzVal(r,'building_age');if(_pf.ageMax<9999&&isNum(ag)&&ag>_pf.ageMax)return false;
    const lv=bzVal(r,'land_value');if(_pf.landMax>0&&isNum(lv)&&lv>_pf.landMax)return false;
    return true;
  });
}
function drawPop(){
  const set=popFilter();
  const leasePct=pct(set.filter(r=>bzVal(r,'leases_building')===1).length,set.filter(r=>isNum(bzVal(r,'leases_building'))).length);
  document.getElementById('popStats').innerHTML=
    statTile(set.length.toLocaleString(),'businesses ('+pct(set.length,ALLBIZ.length)+'% of all)','blue')+
    statTile(leasePct+'%','leases rather than owns, so easier to move','gold')+
    statTile(fmt(median(set.map(r=>bzVal(r,'building_age')))),'median building age (yrs)','silver')+
    statTile(fmt$(median(set.map(r=>bzVal(r,'land_value')))),'median land value','blue');
  // sector mix of the selected set, sorted
  const mixSet=sectorMix(set);
  const mixOrder=SECTORS.map((s,i)=>({s,a:mixSet[i]||0})).sort((x,y)=>y.a-x.a);
  document.getElementById('popMix').innerHTML=mixOrder.map(o=>
    `<div class="barrow"><div>${esc(o.s)}</div>
      <div style="position:relative;height:14px;background:var(--line2);border-radius:4px"><i style="position:absolute;left:0;top:0;height:100%;width:${o.a}%;background:var(--blue);border-radius:4px"></i></div>
      <div class="num">${o.a.toFixed(1)}%</div></div>`).join('');
  // distance bands
  const bands=[[0,.25],[.25,.5],[.5,1],[1,2],[2,99]],lab=['≤¼','¼ to ½','½ to 1','1 to 2','2+ mi'];
  const dd=bands.map(b=>set.filter(r=>{const d=bzVal(r,'dist_station_mi');return isNum(d)&&d>=b[0]&&d<b[1];}).length);
  const dm=Math.max(1,...dd);
  document.getElementById('popDist').innerHTML=dd.map((n,i)=>
    `<div class="barrow"><div>${lab[i]}</div><div class="bar" style="width:${pct(n,dm)}%;background:var(--maroon)"></div><div>${n}</div></div>`).join('');
  // by line
  const lines=['Blue','Silver','Red'];const lc=lines.map(ln=>set.filter(r=>bzVal(r,'line')===ln).length);const lm=Math.max(1,...lc);
  document.getElementById('popLines').innerHTML=lines.map((ln,i)=>`<div class="barrow"><div>${ln}</div><div class="bar" style="width:${pct(lc[i],lm)}%;background:${LINEHEX[ln]}"></div><div class="num">${lc[i].toLocaleString()}</div></div>`).join('');
  document.getElementById('popCsv').onclick=()=>exportPop(set);
}
function statTile(big,lab,cls){return `<div class="stat ${cls||''}"><div class="big">${big}</div><div class="lab">${lab}</div></div>`;}
function sectorMix(rows){const c={},n=rows.filter(r=>isNum(bzVal(r,'sector'))).length;rows.forEach(r=>{const s=bzVal(r,'sector');if(isNum(s))c[s]=(c[s]||0)+1;});const o={};Object.keys(c).forEach(k=>o[k]=100*c[k]/(n||1));return o;}
function popClipText(){const set=popFilter();const mix=sectorMix(set);
  const top=Object.keys(mix).sort((a,b)=>mix[b]-mix[a]).slice(0,2).map(i=>SECTORS[i]+' '+mix[i].toFixed(0)+'%');
  const f=[];if(_pf.line)f.push(_pf.line);if(_pf.distMax<5)f.push('≤'+_pf.distMax+'mi');if(_pf.empMax<9999)f.push('≤'+_pf.empMax+'emp');if(_pf.leases==='1')f.push('leasing');if(_pf.ofs==='1')f.push('out-of-state owner');if(_pf.underutil==='1')f.push('underutilized');
  return `Population [${f.join(', ')||'all'}]: ${set.length} businesses. Top sectors: ${top.join(', ')}.`;}
function exportPop(set){
  const cols=['business_id','line','sector','dist_station_mi','employees','leases_building','land_value','total_value','building_to_land','building_age','parcel_underutilized','parcel_out_of_state_owner','parcel_recent_sale','displacement_index'];
  const head=cols.map(c=>c==='sector'?'sector':c);
  const rows=set.map(r=>cols.map(c=>c==='sector'?'"'+SECTORS[bzVal(r,'sector')]+'"':bzVal(r,c)).join(','));
  download('population.csv',[head.join(',')].concat(rows).join('\n'));toast('CSV downloaded');
}
function download(name,txt){const b=new Blob([txt],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();a.remove();}
/* ---------------- TIME MACHINE ---------------- */
let _tmChart=null,_tm='corridor';
let _tmLines={blue:true,silver:true,gold:true,red:true};
let _tmIndex=false;
const railPlugin={id:'rail',afterDraw(chart){const sc=chart.scales.x;if(!sc)return;const ctx=chart.ctx;[['2007','Blue Line opens'],['2018','Blue extension']].forEach(function(p){const i=chart.data.labels.indexOf(p[0]);if(i<0)return;const x=sc.getPixelForValue(p[0]);ctx.save();ctx.strokeStyle='rgba(18,122,75,.55)';ctx.setLineDash([5,3]);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,chart.chartArea.top);ctx.lineTo(x,chart.chartArea.bottom);ctx.stroke();ctx.fillStyle='rgba(18,122,75,.95)';ctx.font='10px Inter';ctx.fillText(p[1],x+3,chart.chartArea.bottom-5);ctx.restore();});}};
const breakPlugin={id:'breaks',afterDraw(chart){const sc=chart.scales.x;if(!sc)return;const ctx=chart.ctx;
  [['2012','CBP method shift'],['2016','permit coverage']].forEach(([yr,lab])=>{
    const i=chart.data.labels.indexOf(yr);if(i<0)return;const x=sc.getPixelForValue(yr);
    ctx.save();ctx.strokeStyle='rgba(154,91,0,.5)';ctx.setLineDash([4,4]);ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(x,chart.chartArea.top);ctx.lineTo(x,chart.chartArea.bottom);ctx.stroke();
    ctx.fillStyle='rgba(154,91,0,.8)';ctx.font='10px Inter';ctx.fillText('⚠ '+yr,x+3,chart.chartArea.top+11);ctx.restore();});}};
VIEWS.time=function(){
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--blue)">Investigate · time machine</div>
    <h2>Change over time</h2>
    <p class="small mut">Change over time helps separate the train's effect from the citywide boom. A jump at a year marked <span style="color:var(--warn)">⚠</span> can be a recording change, not a real one (business counts shift around 2012; permit coverage firms up around 2016).</p>
    <div class="chips">
      <span class="chip ${_tm==='corridor'?'on':''}" data-tm="corridor">Corridor demolitions & new build</span>
      <span class="chip ${_tm==='demos'?'on':''}" data-tm="demos">Demolitions by line</span>
      <span class="chip ${_tm==='mix'?'on':''}" data-tm="mix">Sector mix shift</span>
      <span class="chip ${_tm==='sales'?'on':''}" data-tm="sales">Home-sale volume by line</span>
      <span class="chip ${_tm==='teardown'?'on':''}" data-tm="teardown">Teardown rate</span>
    </div>
    <div id="tmLineChips" class="chips" style="margin-top:0"></div>
    <div class="chartwrap" style="height:360px"><canvas id="tmCanvas"></canvas></div>
    <div class="note" id="tmNote"></div>
    <div style="margin-top:10px" id="tmClip"></div>
  </div>`;
  document.querySelectorAll('[data-tm]').forEach(ch=>ch.onclick=function(){_tm=this.dataset.tm;document.querySelectorAll('[data-tm]').forEach(x=>x.classList.remove('on'));this.classList.add('on');renderTmLineChips();drawTM();});
  renderTmLineChips();
  document.getElementById('tmClip').innerHTML=clipBtn('Time machine',()=>tmClipText(),'Clip this trend');
  drawTM();
};
function renderTmLineChips(){
  const host=document.getElementById('tmLineChips');if(!host)return;
  if(_tm!=='demos'&&_tm!=='sales'){host.innerHTML='';return;}
  const avail=_tm==='sales'?Object.keys(window.HOMESALES.lines):Object.keys(window.DEMOS.lines);
  host.innerHTML='<span class="small mut" style="align-self:center;margin-right:4px">compare lines:</span>'+avail.map(ln=>`<span class="chip ${_tmLines[ln]?'on':''}" data-tl="${ln}" style="border-color:${LINEHEX[ln]}">${ln[0].toUpperCase()+ln.slice(1)}</span>`).join('')+`<span class="chip ${_tmIndex?'on':''}" id="tmIdx" style="margin-left:8px">Index to base = 100</span>`;
  host.querySelectorAll('[data-tl]').forEach(c=>c.onclick=function(){_tmLines[this.dataset.tl]=!_tmLines[this.dataset.tl];this.classList.toggle('on');drawTM();});
  const _idx=document.getElementById('tmIdx');if(_idx)_idx.onclick=function(){_tmIndex=!_tmIndex;this.classList.toggle('on');drawTM();};
}
function drawTM(){
  if(_tmChart){_tmChart.destroy();_tmChart=null;}
  const ctx=document.getElementById('tmCanvas').getContext('2d');
  let labels,ds,note;
  if(_tm==='corridor'){
    const cy=D.corridorYearly||{};labels=Object.keys(cy).sort();
    ds=[{label:'Demolitions',data:labels.map(y=>cy[y][0]),borderColor:'#b3203a',backgroundColor:'#b3203a22',tension:.25,fill:true},
        {label:'New construction',data:labels.map(y=>cy[y][1]),borderColor:'#1f6feb',backgroundColor:'#1f6feb18',tension:.25,fill:true}];
    {const pre=mean(labels.filter(y=>+y<2007).map(y=>cy[y][0])),post=mean(labels.filter(y=>+y>=2007&&+y<=2017).map(y=>cy[y][0]));note='Permits along the built corridors, 1995 to 2024. New construction dwarfs demolition in raw counts, but teardowns are the sharper displacement signal.'+(isNum(pre)&&isNum(post)?' Demolitions averaged '+pre.toFixed(0)+'/yr before the Blue Line opened in 2007 and '+post.toFixed(0)+'/yr in the decade after.':'');}
  }else if(_tm==='demos'){
    const dm=window.DEMOS;labels=dm.years;
    ds=Object.keys(dm.lines).filter(ln=>_tmLines[ln]).map(ln=>({label:ln[0].toUpperCase()+ln.slice(1),data:dm.lines[ln],borderColor:LINEHEX[ln],backgroundColor:'transparent',tension:.25}));
    note='Residential demolitions indexed by corridor. The Red corridor in the north county starts low, since it is sparser, newer and owner occupied. That gap is exactly what you must judge when you carry a rule north.';
  }else if(_tm==='mix'){
    const mx=window.MIXSE;labels=mx.years;
    ds=[['retail','Retail trade','#b3203a'],['realestate','Real estate','#1f6feb'],['finance','Finance','#b08a2e'],['food','Food service','#127a4b']]
      .map(([k,l,c])=>({label:l,data:mx[k],borderColor:c,backgroundColor:'transparent',tension:.25}));
    note='Share of corridor businesses by sector. Retail trade falls steadily while real estate and food service rises. That mix shift signals who is being replaced, even when total counts look stable.';
  }else if(_tm==='teardown'){
    const cy=D.corridorYearly||{};labels=Object.keys(cy).sort();
    ds=[{label:'Demolition share of permits (%)',data:labels.map(y=>{const d=cy[y][0],n=cy[y][1];return (d+n)>0?100*d/(d+n):null;}),borderColor:'#8b1e3f',backgroundColor:'#8b1e3f18',tension:.25,fill:true}];
    note='Share of permit activity that is demolition rather than new build. A rising share means existing buildings are being replaced, not just added to. The green marks show when the Blue Line opened.';
  }else{
    const hs=window.HOMESALES;labels=hs.years;
    ds=Object.keys(hs.lines).filter(ln=>_tmLines[ln]).map(ln=>({label:ln[0].toUpperCase()+ln.slice(1),data:hs.lines[ln],borderColor:LINEHEX[ln],backgroundColor:'transparent',tension:.25}));
    note='Home-sale counts near each corridor. Volume and turnover often precede commercial change. When homes start trading hands, shops follow.';
  }
  if(_tmIndex&&(_tm==='demos'||_tm==='sales')){ds=ds.map(d=>{const base=d.data.find(v=>isNum(v)&&v>0);return Object.assign({},d,{data:d.data.map(v=>isNum(v)&&base?Math.round(100*v/base):null)});});note+=" Each line is indexed to its first year = 100, so corridors of different sizes compare on equal footing.";}
  _tmChart=new Chart(ctx,{type:'line',data:{labels,datasets:ds},plugins:[breakPlugin,railPlugin],
    options:{animation:false,maintainAspectRatio:false,plugins:{legend:{position:'top'}},
      scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:'#eef2f7'}}}}});
  document.getElementById('tmNote').innerHTML=note;
}
function tmClipText(){
  if(_tm==='mix'){const mx=window.MIXSE;return `Sector mix over time: retail fell from ${mx.retail[0]}% to ${mx.retail[mx.retail.length-1]}% while food service rose to ${mx.food[mx.food.length-1]}%, a replacement signal, not just shrinkage.`;}
  if(_tm==='demos'){const dm=window.DEMOS;return `Demolition trend by line ${dm.years[0]} to ${dm.years[dm.years.length-1]}; Red corridor starts lowest, reflecting a newer owner-occupied north county.`;}
  if(_tm==='sales'){return `Home-sale volume by corridor over time (Red far highest in raw count, far more parcels north).`;}
  if(_tm==='teardown'){const cy=D.corridorYearly||{};const ys=Object.keys(cy).sort();const L=ys[ys.length-1],d=cy[L][0],n=cy[L][1];return `Demolition made up ${((d+n)>0?100*d/(d+n):0).toFixed(0)}% of corridor permit activity by ${L}.`;}
  const cy=D.corridorYearly||{};const ys=Object.keys(cy).sort();return `Corridor permits: demolitions ${cy[ys[0]][0]}→${cy[ys[ys.length-1]][0]}, new build ${cy[ys[0]][1]} to ${cy[ys[ys.length-1]][1]} (1995 to 2024). Mind the ⚠2012/2016 recording breaks.`;
}
/* ---------------- DATA TABLE ---------------- */
let _dt={which:'biz',line:'',sort:null,desc:true,q:''};
VIEWS.table=function(){
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--blue)">Investigate · data table</div>
    <h2>Data table</h2>
    <div class="row">
      <span class="chip ${_dt.which==='biz'?'on':''}" data-w="biz">Businesses (${ALLBIZ.length.toLocaleString()})</span>
      <span class="chip ${_dt.which==='npa'?'on':''}" data-w="npa">Neighborhoods (${D.npa.length})</span>
      <span id="dtLineWrap"></span>
      <input type="text" id="dtSearch" placeholder="filter rows…" style="min-width:160px">
      <button class="btn sec sm" id="dtCsv">Export view (CSV)</button>
    </div>
    <div class="small mut" id="dtCount" style="margin:6px 0"></div>
    <div class="scrollx"><table class="t" id="dtTable"></table></div>
    <div class="small mut" style="margin-top:6px">Click a column header to sort. Showing up to 500 rows; export gives the full filtered set.</div>
  </div>`;
  document.querySelectorAll('[data-w]').forEach(ch=>ch.onclick=function(){_dt.which=this.dataset.w;_dt.sort=null;VIEWS.table();});
  document.getElementById('dtLineWrap').innerHTML=_dt.which==='biz'?
    `<label class="fld">Line <select id="dtLine"><option value="">all</option><option value="Blue">Blue</option><option value="Silver">Silver</option><option value="Red">Red</option></select></label>`:'';
  if(_dt.which==='biz'){document.getElementById('dtLine').value=_dt.line;document.getElementById('dtLine').onchange=function(){_dt.line=this.value;drawDT();};}
  document.getElementById('dtSearch').value=_dt.q;
  document.getElementById('dtSearch').oninput=function(){_dt.q=this.value.toLowerCase();drawDT();};
  document.getElementById('dtCsv').onclick=()=>{const {cols,rows}=dtData();download((_dt.which)+'_table.csv',[cols.join(',')].concat(rows.map(r=>r.map(c=>typeof c==='string'&&c.indexOf(',')>=0?'"'+c+'"':c).join(','))).join('\n'));toast('CSV downloaded');};
  drawDT();
};
function dtData(){
  if(_dt.which==='biz'){
    const cols=D.bizCols.filter(c=>c!=="displacement_index");
    let rows=ALLBIZ.filter(r=>!_dt.line||bzVal(r,'line')===_dt.line)
      .map(r=>cols.map(c=>c==='sector'?(SECTORS[bzVal(r,'sector')]||''):bzVal(r,c)));
    if(_dt.q)rows=rows.filter(r=>r.join(' ').toLowerCase().indexOf(_dt.q)>=0);
    return {cols,rows};
  }else{
    const cols=D.npaCols.filter(c=>c!=="disp");
    let rows=D.npa.map(r=>cols.map(c=>npaVal(r,c)));
    if(_dt.q)rows=rows.filter(r=>r.join(' ').toLowerCase().indexOf(_dt.q)>=0);
    return {cols,rows};
  }
}
function drawDT(){
  const {cols,rows}=dtData();
  if(_dt.sort!=null){const i=_dt.sort;rows.sort((a,b)=>{const x=a[i],y=b[i];if(x==null)return 1;if(y==null)return -1;
    return (typeof x==='number'&&typeof y==='number')?(_dt.desc?y-x:x-y):(_dt.desc?(''+y).localeCompare(''+x):(''+x).localeCompare(''+y));});}
  document.getElementById('dtCount').textContent=rows.length.toLocaleString()+' rows';
  const show=rows.slice(0,500);
  document.getElementById('dtTable').innerHTML='<thead><tr>'+cols.map((c,i)=>`<th data-i="${i}">${esc(c)}${_dt.sort===i?(_dt.desc?' ▾':' ▴'):''}</th>`).join('')+'</tr></thead><tbody>'+
    show.map(r=>'<tr>'+r.map(c=>`<td>${c==null?'<span class="mut">—</span>':typeof c==='number'?fmt(c):esc(c)}</td>`).join('')+'</tr>').join('')+'</tbody>';
  document.querySelectorAll('#dtTable th').forEach(th=>th.onclick=function(){const i=+this.dataset.i;if(_dt.sort===i)_dt.desc=!_dt.desc;else{_dt.sort=i;_dt.desc=true;}drawDT();});
}
/* ---------------- MODEL LAB ---------------- */
// deterministic 80/20 holdout within TRAIN (Blue/Silver)
const TRAIN_FIT=D.train.filter((r,i)=>i%5!==0);
const TRAIN_HOLD=D.train.filter((r,i)=>i%5===0);
let _selFeats = (S.savedModels[0]&&S.savedModels[0].feats)||['__near','land_value','building_to_land','employees','nbhd_rent'];
function featImp(k){const vals=D.train.map(r=>featRaw(r,k)).filter(isNum);return Math.round(100*(1-vals.length/D.train.length));}
VIEWS.model=function(){
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick">Reason · model lab</div>
    <h2>Build and test a rule</h2>
    <p class="small mut">Pick the signals you think mark a business at risk. The lab fits a rule on <b>${TRAIN_FIT.length.toLocaleString()}</b> Blue and Silver businesses, then checks it on <b>${TRAIN_HOLD.length.toLocaleString()}</b> it never saw. The gap between those two scores is the point.</p>
  </div>
  <div class="grid2">
    <div class="card">
      <h3>1 · Pick your factors</h3>
      <div class="small mut" style="margin-bottom:6px">% = share of businesses missing that value, filled with the average.</div>
      <div id="featPick" style="max-height:330px;overflow:auto"></div>
    </div>
    <div class="card">
      <h3>2 · Editable cut-offs</h3>
      <p class="small mut">These are <i>your</i> choices, not the tool's. Move them and the flags above change.</p>
      <div id="thrBox"></div>
      <div class="note" style="margin-top:10px">These cut-offs are your call. Defend them.</div>
    </div>
  </div>
  <div id="modelOut"></div>`;
  drawFeatPick();drawThr();fitAndShow();
};
function drawFeatPick(){
  let h='';
  FIT_FEATURES.forEach(g=>{
    h+=`<div style="margin:6px 0 2px;font-size:11px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--mut)">${g.g}</div>`;
    g.items.forEach(([k,lab])=>{const on=_selFeats.includes(k);const leak=LEAK_FEATS.has(k);const imp=featImp(k);
      h+=`<label class="chip ${on?'on':''}" data-f="${k}" style="margin:3px 4px 3px 0;display:inline-flex">
        ${esc(lab)}${imp>=40?` <span class="tag biz" style="margin-left:4px">${imp}% filled in</span>`:''}</label>`;});
  });
  document.getElementById('featPick').innerHTML=h;
  document.querySelectorAll('#featPick [data-f]').forEach(el=>el.onclick=function(){const k=this.dataset.f;
    if(_selFeats.includes(k))_selFeats=_selFeats.filter(x=>x!==k);else _selFeats.push(k);this.classList.toggle('on');fitAndShow();});
}
function drawThr(){
  const t=S.thresholds;
  document.getElementById('thrBox').innerHTML=
    thrRow('small_emp','Small business ≤ N employees',1,30,1,t.small_emp)+
    thrRow('near_mi','Near a station ≤ N miles',0.1,2,0.1,t.near_mi)+
    thrRow('income_pct','Low income = bottom N%',10,50,5,t.income_pct);
  ['small_emp','near_mi','income_pct'].forEach(k=>{document.getElementById('thr_'+k).oninput=function(){
    S.thresholds[k]=parseFloat(this.value);document.getElementById('thrv_'+k).textContent=this.value;_incCut={};save();drawFeatPick();fitAndShow();};});
}
function thrRow(k,lab,mn,mx,st,v){return `<div style="margin:10px 0"><div class="spread"><label class="small" style="font-weight:600">${lab}</label><span class="small" id="thrv_${k}"><b>${v}</b></span></div>
  <input type="range" id="thr_${k}" min="${mn}" max="${mx}" step="${st}" value="${v}" style="width:100%"></div>`;}
function fitAndShow(){
  const out=document.getElementById('modelOut');
  if(!_selFeats.length){out.innerHTML='<div class="card"><div class="warnbox">Pick at least one factor to fit a rule.</div></div>';return;}
  const model=fitOLS(TRAIN_FIT,_selFeats,S.thresholds);
  const inR2=r2(model,TRAIN_FIT),outR2=r2(model,TRAIN_HOLD);
  const inRC=rankCorr(model,TRAIN_FIT),outRC=rankCorr(model,TRAIN_HOLD);
  const hasLeak=_selFeats.some(k=>LEAK_FEATS.has(k));
  // coefficients plain language
  const coefs=model.featKeys.map((k,i)=>({k,b:model.beta[i],imp:model.imp[k],leak:LEAK_FEATS.has(k)})).sort((a,b)=>Math.abs(b.b)-Math.abs(a.b));
  const maxB=Math.max(0.001,...coefs.map(c=>Math.abs(c.b)));
  const coefRows=coefs.map(c=>{const mag=Math.abs(c.b);const word=mag<0.04?'barely':mag<0.12?'weakly':mag<0.25?'moderately':'strongly';
    const up=c.b>=0;const col=up?'var(--red)':'var(--good)';const w=Math.min(50,mag/maxB*50);
    return `<div class="coefrow"><div>${esc(featLabel(c.k))}</div>
      <div class="coefbar"><div class="zero"></div><div class="fill" style="background:${col};${up?'left:50%':'right:50%'};width:${w}%"></div></div>
      <div class="coefval" style="color:${col}">${word} ${up?'increases':'lowers'} risk${c.imp>=40?` <span class="mut">(${c.imp}% filled in)</span>`:''}</div></div>`;}).join('');
  // sector deliverable (business-type level)
  const sec={};TRAIN_FIT.forEach(r=>{const s=bzVal(r,'sector');if(!isNum(s))return;(sec[s]=sec[s]||[]).push(predict(model,r));});
  const secRank=Object.keys(sec).map(s=>({s:SECTORS[s],v:mean(sec[s]),n:sec[s].length})).sort((a,b)=>b.v-a.v);
  const inflate=(inR2-outR2);
  out.innerHTML=`
  <div class="card">
    <h3>3 · How well does it work?</h3>
    <div class="grid2">
      <div>
        <div class="spread"><span class="small mut">In-sample (data it learned on)</span><b>R² ${inR2.toFixed(2)} · rank r ${fmtRC(inRC)}</b></div>
        <div class="meter" style="margin:4px 0 10px"><i style="width:${Math.max(0,inR2*100)}%;background:#9bb0c9"></i></div>
        <div class="spread"><span class="small mut">Out-of-sample (held-out shops)</span><b style="color:${outR2<inR2-0.05?'var(--warn)':'var(--good)'}">R² ${outR2.toFixed(2)} · rank r ${fmtRC(outRC)}</b></div>
        <div class="meter" style="margin:4px 0"><i style="width:${Math.max(0,outR2*100)}%;background:var(--blue)"></i></div>
      </div>
      <div>
        <div class="${inflate>0.06?'warnbox':'okbox'}" style="margin:0">${inflate>0.06?
          `<b>The honest number is the lower one.</b> Your rule explains ${(outR2*100).toFixed(0)}% of the variation on shops it never saw, ${(inflate*100).toFixed(0)} points less than it claimed in-sample. That gap is over-fitting.`:
          `<b>Stable rule.</b> In- and out-of-sample agree closely (${(inflate*100).toFixed(0)} pt gap), so it is not just memorizing. Whether it is <i>meaningful</i> is a separate question, see the caveats.`}</div>
        <div class="note" style="margin-top:8px">You are predicting the City's index, not an observed eviction.</div>
      </div>
    </div>
    <div style="margin-top:12px"><h4>What each factor does (standardized weight)</h4>${coefRows}</div>
    <div style="margin-top:12px"><h4>Which business <i>types</i> your rule flags (the defensible unit)</h4>
      <div class="bars">${secRank.map(x=>`<div class="barrow"><div>${esc(x.s)}</div><div class="bar" style="width:${pct(x.v-secRank[secRank.length-1].v,(secRank[0].v-secRank[secRank.length-1].v)||1)}%"></div><div class="small">${x.v.toFixed(2)}</div></div>`).join('')}</div>
      <div class="small mut" style="margin-top:6px">Rank business types, not individual shops.</div>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="saveModel">💾 Save this rule (for the Red Line)</button>
      ${clipBtn('Model lab',()=>`Rule [${_selFeats.map(featLabel).join(', ')}]: out-of-sample R²=${outR2.toFixed(2)} (in-sample ${inR2.toFixed(2)}).`,'Clip this result')}
    </div>
  </div>`;
  document.getElementById('saveModel').onclick=()=>{
    S.savedModels=[{feats:_selFeats.slice(),thresholds:Object.assign({},S.thresholds),outR2:+outR2.toFixed(3),inR2:+inR2.toFixed(3),hasLeak,t:Date.now()}];
    S.fit={feats:_selFeats.slice()};save();toast('Rule saved. Carry it to the Red Line');renderRail();};
}
function fmtRC(r){return r==null?'—':r.toFixed(2);}
/* ---------------- CARRY TO THE RED LINE ---------------- */
let _redModel=null,_triage=[];
function redGateOpen(){return S.similarity.income&&S.similarity.ownership&&S.similarity.demolitions;}
VIEWS.red=function(){
  const m=document.getElementById('main');
  if(!S.indexDef)S.indexDef={weights:{}};
  if(!S.indexDef.seeded){IDX_FACTORS.forEach(ff=>{if(S.indexDef.weights[ff.key]==null)S.indexDef.weights[ff.key]=ff.dir;});S.indexDef.seeded=true;save();}
  const _activeK=Object.keys(S.indexDef.weights).filter(k=>S.indexDef.weights[k]);
  if(!_activeK.length){
    m.innerHTML=`<div class="card"><div class="kick" style="color:var(--red)">Phase 2 · the Red Line</div>
      <h2>Carry it to the Red Line</h2>
      <div class="warnbox">First build an index. Go to <b>Build your own index</b>, set some weights, then come back to carry it north.</div>
      <button class="btn" onclick="go('index')">→ Build your own index</button></div>`;return;
  }
  _activeK.forEach(k=>{if(S.adapt[k]==null)S.adapt[k]=1;});
  const P=window.PROFILES;
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--red)">Phase 2 · the Red Line</div>
    <h2>Carry it to the Red Line</h2>
    <p class="small mut">You learned on Blue and Silver. The Red corridor is different. See where it differs, decide what still transfers, and produce a priority list that carries its uncertainty.</p>
  </div>
  <div class="card">
    <h3>1 · The Red corridor vs the lines you trained on</h3>
    <div class="scrollx" style="max-height:none"><table class="t"><thead><tr><th>Measure</th><th>Blue</th><th>Silver</th><th style="color:var(--red)">Red</th><th>Read</th></tr></thead><tbody>
      ${profRow('Median income','income',P,true)}
      ${profRow('% owner-occupied','own',P,false,'%')}
      ${profRow('Median rent','rent',P,true)}
      ${profRow('Residential demolitions (index)','demo',P,false)}
      ${profRow('% out-of-state owners','oos',P,false,'%')}
    </tbody></table></div>
    <div class="note">The Red corridor is wealthier and more owner-occupied. A rule tuned on renter-heavy Blue may <i>over</i>predict here.</div>
  </div>
  <div class="card">
    <h3>2 · Your similarity verdict <span class="tag biz" style="margin-left:6px">the gate</span></h3>
    <p class="small mut">For each dimension, judge how well the Red Line matches what you trained on. You cannot publish a triage list until you have ruled on all three.</p>
    ${simRow('income','Income level')}
    ${simRow('ownership','Ownership (own vs lease)')}
    ${simRow('demolitions','Demolition / teardown pressure')}
    <div id="gateMsg" style="margin-top:8px"></div>
  </div>
  <div class="card">
    <h3>3 · Adapt your rule for the gaps</h3>
    <p class="small mut">Down-weight (toward 0) any factor the Red Line is too different to trust unchanged. Keep at 1 what still holds.</p>
    <div id="adaptBox"></div>
  </div>
  <div class="card">
    <h3>4 · Final priority list: neighborhoods, with their caveat <span class="tag npa" style="margin-left:6px">deliverable</span></h3>
    <div id="triageGate"></div>
    <div id="triageOut"></div>
  </div>`;
  ['income','ownership','demolitions'].forEach(k=>document.getElementById('sim_'+k).value=S.similarity[k]||'');
  ['income','ownership','demolitions'].forEach(k=>document.getElementById('sim_'+k).onchange=function(){S.similarity[k]=this.value;save();checkGate();renderTriageGate();});
  renderAdapt();checkGate();renderTriageGate();
};
function profRow(lab,k,P,money,suf){
  const v=l=>money?fmt$(P[l][k]):fmt(P[l][k])+(suf||'');
  const red=P.red[k],blue=P.blue[k];const diff=blue?Math.round(100*(red-blue)/blue):0;
  return `<tr><td>${lab}</td><td>${v('blue')}</td><td>${v('silver')}</td><td style="color:var(--red);font-weight:600">${v('red')}</td><td class="small mut">${diff>0?'+':''}${diff}% vs Blue</td></tr>`;
}
function simRow(k,lab){return `<div class="spread" style="padding:7px 0;border-bottom:1px solid var(--line2)"><div>${lab}</div>
  <select id="sim_${k}"><option value="">judge it</option><option value="good">good match, carry it</option><option value="partial">partial — adapt it</option><option value="poor">poor — drop / heavily down-weight</option></select></div>`;}
function checkGate(){const g=document.getElementById('gateMsg');if(!g)return;
  g.innerHTML=redGateOpen()?'<div class="okbox">✓ Verdict recorded on all three dimensions. You may produce an honest triage list that carries these caveats with it.</div>'
    :'<div class="warnbox">Record a verdict on all three dimensions to unlock the final list.</div>';}
function renderAdapt(){
  document.getElementById('adaptBox').innerHTML=Object.keys(S.indexDef.weights).filter(k=>S.indexDef.weights[k]).map(k=>{
    const v=S.adapt[k]==null?1:S.adapt[k];
    return `<div class="spread" style="padding:6px 0"><label class="small" style="min-width:200px;font-weight:600">${esc(catLabel(k))}</label>
      <input type="range" min="0" max="1" step="0.1" value="${v}" oninput="S.adapt['${k}']=parseFloat(this.value);this.nextElementSibling.textContent=this.value;save()" style="flex:1">
      <span class="small" style="width:30px;text-align:right">${v}</span></div>`;}).join('');
}
function renderTriageGate(){
  const box=document.getElementById('triageGate');if(!box)return;
  if(!redGateOpen()){box.innerHTML='<div class="warnbox">Locked. Record your three similarity verdicts above first.</div>';document.getElementById('triageOut').innerHTML='';return;}
  box.innerHTML=`<button class="btn red" id="runTriage">Build the priority list</button>`;
  document.getElementById('runTriage').onclick=runTriage;
}
function redIndexScore(row){const w=S.indexDef.weights;let s=0,any=false;
  Object.keys(w).forEach(k=>{const wt=w[k];if(!wt)return;const v=npaVal(row,k);if(!isNum(v))return;const st=idxStats(k);s+=wt*(S.adapt[k]==null?1:S.adapt[k])*((v-st.m)/st.sd);any=true;});
  return any?s:null;}
function runTriage(){
  const conf=(S.similarity.income==='good')+(S.similarity.ownership==='good')+(S.similarity.demolitions==='good');
  const confLab=['low','low','medium','high'][conf];
  _triage=D.npa.filter(r=>npaVal(r,'is_red')===1).map(r=>{const id=npaVal(r,'npa');const pp=(D.permitsPrePost||{})[id];
    return {npa:id,town:npaVal(r,'town')||'',score:redIndexScore(r),demoPost:pp?pp[1]:null};}).filter(x=>isNum(x.score)).sort((a,b)=>b.score-a.score);
  const top=_triage.slice(0,10);const demos=_triage.map(t=>t.demoPost).filter(isNum).sort((a,b)=>a-b);
  const med=demos.length?demos[Math.floor(demos.length/2)]:0;
  const hit=top.filter(t=>isNum(t.demoPost)&&t.demoPost>med).length;
  document.getElementById('triageOut').innerHTML=`
    <div class="okbox">Carrying <b>${confLab} confidence</b> (${conf}/3 dimensions a good match). Every row inherits this caveat.</div>
    <div class="${hit>=5?'okbox':'warnbox'}"><b>Permit reality check.</b> Of your top 10 flagged Red Line neighborhoods, <b>${hit}/10</b> actually saw above-median demolition permits afterward. ${hit>=5?'Your index has real predictive traction against an observed outcome, not just the City\'s score.':'Weak overlap. Your index may be flagging traits that did not (yet) translate into teardowns. Say so.'}</div>
    <div class="scrollx" style="margin-top:8px"><table class="t"><thead><tr><th>#</th><th>NPA</th><th>Town</th><th>Index score</th><th>Demolitions after</th></tr></thead><tbody>
      ${_triage.slice(0,15).map((t,i)=>`<tr><td>${i+1}</td><td>${t.npa}</td><td>${esc(t.town||'—')}</td><td><b>${t.score.toFixed(2)}</b></td><td>${isNum(t.demoPost)?t.demoPost:'<span class="mut">—</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row" style="margin-top:10px">
      <button class="btn sec sm" id="triageCsv">Export priority list (CSV)</button>
      ${clipBtn('Red Line triage',()=>`Red triage (${confLab} confidence): top areas ${_triage.slice(0,3).map(t=>(t.town||'NPA'+t.npa)+' '+t.score.toFixed(2)).join(', ')}. Permit reality check ${hit}/10.`,'Clip the triage')}
    </div>
    <div class="note">The honest unit is the neighborhood, not a named shop.</div>`;
  document.getElementById('triageCsv').onclick=()=>{const conf=['low','low','medium','high'][(S.similarity.income==='good')+(S.similarity.ownership==='good')+(S.similarity.demolitions==='good')];
    download('red_line_priority.csv',[['npa','town','index_score','demolitions_after','confidence']].concat(_triage.map(t=>[t.npa,t.town,t.score.toFixed(3),t.demoPost,conf])).map(r=>r.join(',')).join('\n'));toast('CSV downloaded');};
}
/* ---------------- MISSIONS ---------------- */
const MISSIONS=[
  {id:'m1',t:'Lay of the land',time:'25 min',phase:1,
   q:'Before any model: what kind of places do these trains run through? Read the corridor with your eyes.',
   steps:['Open the Map studio. Shade by <b>household income</b>, then <b>% owner-occupied</b>, then <b>residential demolitions</b>.',
     'Find the three Red Line neighborhoods (outlined in black, far north). How do they compare to the inner Blue/Silver areas?',
     'Clip one map that surprised you.'],
   tool:'map',
   checks:['Which two or three neighborhoods look <i>most</i> exposed, with low income, many renters and active demolition, and which look insulated?']},
  {id:'m2',t:'Is the Red corridor really different?',time:'25 min',phase:1,
   q:'The brief warns the Red Line is wealthier. Is that true, and does "wealthier" mean "safer" for local shops?',
   steps:['In Chart studio (Neighborhood level), plot <b>income</b> (X) vs <b>residential demolitions</b> (Y). Color by "Red Line vs rest".',
     'Switch to the "Carry to the Red Line" view and read the Blue/Silver/Red comparison table.',
     'Clip the comparison.'],
   tool:'chart',
   checks:['Name three concrete ways the Red corridor differs from the Blue. For each, say whether it makes local businesses <i>safer</i>, <i>more exposed</i>, or <i>just different</i>.']},
  {id:'m3',t:'Where is the land turning over?',time:'30 min',phase:1,
   q:'Displacement starts with land. Where is the building worth little next to the dirt it sits on?',
   steps:['Map studio: shade by <b>% parcels underutilized</b> and <b>% out-of-state owners</b>.',
     'Chart studio (Neighborhood): plot <b>% underutilized</b> vs <b>demolitions</b>. Is the signal real?',
     'Both of these are ingredients the City used to build its own index. Hold that thought for the Model lab.'],
   tool:'map',
   checks:['Where is redevelopment pressure highest? Does it line up with the train, or with something else (downtown, the river, the airport)?']},
  {id:'m4',t:'What happened to retail?',time:'30 min',phase:1,
   q:'A corridor can keep the same number of businesses while completely changing who they are. Look for replacement, not just shrinkage.',
   steps:['Time machine → "Sector mix shift". Watch retail vs real estate vs food service.',
     'Mind the ⚠2012/2016 recording breaks before you call a jump "real".',
     'Population builder: filter to <b>Retail trade</b>, ≤½ mi of a station. How big is that vulnerable set?'],
   tool:'time',
   checks:['Who is being replaced by whom along the built corridors? What evidence separates a real shift from a measurement artefact?']},
  {id:'m5',t:'Does more always mean better?',time:'25 min',phase:1,
   q:'A model with more predictors usually scores higher. Is it actually a better model?',
   steps:['Open Regression. Predict the displacement score from a few plain factors such as distance, land value and employees. Note the R².',
     'Now add the variables the City itself used to build that score, such as out-of-state ownership and parcel underutilization. Watch R² climb.',
     'Decide whether the model learned something real, or just started repeating part of its own answer.'],
   tool:'regress',
   checks:['How much did those extra predictors raise R²? Why can a higher R² still be a worse analysis?']},
  {id:'m6',t:'Does "near a station" even matter?',time:'25 min',phase:1,
   q:'The whole premise is that the train changes things nearby. Test it instead of assuming it.',
   steps:['Chart studio (Business level): plot <b>distance to station</b> (X) vs <b>displacement index</b> (Y). Color by line.',
     'Population builder: compare under a quarter mile against one to two miles. Does the average index really differ?',
     'Remember the index is neighborhood-level, so "distance" is blunt here.'],
   tool:'chart',
   checks:['Does proximity to a station actually track higher displacement risk in this data? How strong is the effect, and could a third factor explain it?']},
  {id:'m7',t:'Build your own index',time:'40 min',phase:1,
   q:'Commit to a definition of at-risk by weighting the signals you trust.',
   steps:['Open Build your own index. Set a weight for each signal and watch the rankings and the live match score.',
     'Tune the weights to shrink the average miss against the City score, but keep a version you can defend, not just the lowest number.',
     'Your index is ready to carry to the Red Line.'],
   tool:'index',
   checks:['Write your index in one sentence. What is your best miss against the City score, and which signals did you weight most?']},
  {id:'m8',t:'Carry it north and reality check it',time:'35 min',phase:2,
   q:'Your rule learned on Blue/Silver. Does it survive contact with the Red Line, and with actual demolition permits?',
   steps:['"Carry to the Red Line": record your similarity verdicts (the gate), adapt the weights, and run the triage.',
     'Read the <b>permit reality check</b>: of your top 10 areas, how many actually saw teardowns afterward?',
     'Export the triage and clip the result.'],
   tool:'red',
   checks:['What did you down-weight or drop for the Red Line, and why? What did the permit reality check tell you about whether your rule found something real?']},
  {id:'m9',t:'Argue against yourself',time:'20 min',phase:2,
   q:'The strongest analyst states the best case <i>against</i> their own conclusion.',
   steps:['Revisit anything you clipped. Find the evidence that complicates your story.',
     'In the Argument board, make the case for who is affected and how far it transfers to the Red Line.',
     'It is fully legitimate to conclude the displacement frame partly does <i>not</i> transfer to the wealthy Red corridor.'],
   tool:'argument',
   checks:['What is the single best argument that your at-risk story is wrong or overstated? How would you check it with more data?']},
  {id:'m10',t:'Make your case',time:'25 min',phase:2,
   q:'Assemble everything into one defensible recommendation for the City.',
   steps:['Argument board: drag your clipped evidence into Claim, Evidence, Who, and Transfers.',
     'Watch the rubric and fill the weak slots.',
     'Export your case.'],
   tool:'argument',
   checks:['If the City could act on only three of your flagged areas or business types, which three and why?']},
];
VIEWS.missions=function(){
  const m=document.getElementById('main');
  const done=MISSIONS.filter(x=>S.missions[x.id]&&S.missions[x.id].done).length;
  m.innerHTML=`
  <div class="card">
    <div class="kick">Reason · missions</div>
    <h2>Missions</h2>
    <p class="small mut">Each mission points you to a tool and asks what you concluded. Your answers build your final case. Do them in order or jump around.</p>
    <div class="spread"><div class="meter" style="flex:1;margin-right:12px"><i style="width:${pct(done,MISSIONS.length)}%"></i></div><b>${done}/${MISSIONS.length} complete</b></div>
  </div>
  <div id="missionList"></div>`;
  drawMissions();
};
function drawMissions(){
  const host=document.getElementById('missionList');
  host.innerHTML=MISSIONS.map((m,i)=>{
    const st=S.missions[m.id]||{};const open=st.open;
    return `<div class="mcard ${st.done?'done':''} ${open?'open':''}" data-m="${m.id}">
      <div class="mhead" onclick="toggleMission('${m.id}')">
        <div class="mnum">${st.done?'✓':i+1}</div>
        <div style="flex:1"><div class="mtitle">${esc(m.t)}</div><div class="mmeta">${m.phase===2?'Phase 2 · Red Line':'Phase 1 · learn from Blue & Silver'}</div></div>
        <div class="small mut">${open?'▾':'▸'}</div>
      </div>
      <div class="mbody">
        <p style="font-size:14px;color:var(--ink2)">${m.q}</p>
        <div style="margin:6px 0">${m.steps.map((s,j)=>`<div class="step"><span class="sn">${j+1}</span><div>${s}</div></div>`).join('')}</div>
        <button class="btn ghost sm" onclick="go('${m.tool}')">Open ${NAV.flatMap(g=>g.items).find(x=>x.id===m.tool).t} →</button>
        <div style="margin-top:12px">${m.checks.map((c,j)=>`<div style="margin-bottom:8px"><div class="small" style="font-weight:600;margin-bottom:4px">${c}</div>
          <textarea data-mc="${m.id}:${j}" placeholder="Your answer…">${esc((st.answers&&st.answers[j])||'')}</textarea></div>`).join('')}</div>
        <button class="btn sm" onclick="completeMission('${m.id}')">${st.done?'✓ Completed (tap to reopen)':'Mark mission complete'}</button>
      </div></div>`;
  }).join('');
  document.querySelectorAll('[data-mc]').forEach(t=>t.oninput=function(){const [id,j]=this.dataset.mc.split(':');
    S.missions[id]=S.missions[id]||{answers:{}};S.missions[id].answers=S.missions[id].answers||{};S.missions[id].answers[j]=this.value;save();});
}
function toggleMission(id){S.missions[id]=S.missions[id]||{};S.missions[id].open=!S.missions[id].open;save();drawMissions();}
function completeMission(id){S.missions[id]=S.missions[id]||{};S.missions[id].done=!S.missions[id].done;save();drawMissions();renderRail();toast(S.missions[id].done?'Mission complete ✓':'Reopened');}
/* ---------------- ARGUMENT BOARD ---------------- */
const SLOTS=[
  {k:'claim',t:'Claim',hint:'Your one-sentence answer. "The businesses most at risk along the Red Line are… / the displacement frame does not transfer because…"'},
  {k:'evidence',t:'Evidence',hint:'The findings that support the claim. Drag clips here.'},
  {k:'who',t:'Who is affected',hint:'Which businesses / people, concretely. Sectors, owners vs renters, neighborhoods.'},
  {k:'transfers',t:'Transfers to the Red Line?',hint:'How far does the Blue and Silver story carry north, and where does it break?'},
];
if(!S.argumentText)S.argumentText={};
SLOTS.forEach(s=>{if(!S.argument[s.k])S.argument[s.k]=[];if(S.argumentText[s.k]==null)S.argumentText[s.k]='';});
function argScore(){let filled=0;SLOTS.forEach(s=>{if((S.argumentText[s.k]&&S.argumentText[s.k].trim())||S.argument[s.k].length)filled++;});return {filled,total:SLOTS.length};}
VIEWS.argument=function(){
  const m=document.getElementById('main');
  const sc=argScore();
  m.innerHTML=`
  <div class="card">
    <div class="kick">Conclude · argument board</div>
    <h2>Build your case</h2>
    <p class="small mut">Write each slot and drag in clipped evidence. A strong case includes a counterfactual and a caveat.</p>
    <div class="spread"><div class="meter" style="flex:1;margin-right:12px"><i style="width:${pct(sc.filled,sc.total)}%;background:${sc.filled===sc.total?'var(--good)':'var(--blue)'}"></i></div><b>${sc.filled}/${sc.total} slots</b></div>
  </div>
  ${S.pins.length?'':'<div class="card"><div class="warnbox">Your evidence tray is empty. Go explore and use the Clip buttons. You can still write the slots, but a case needs evidence.</div></div>'}
  <div id="slots"></div>
  <div class="card">
    <h3>Closing questions for your write-up</h3>
    <ul style="font-size:13px;color:var(--ink2);line-height:1.6;margin:0;padding-left:20px">
      <li>In your own words, what makes a business at risk, and what makes one resilient?</li>
      <li>Which scale told you the most: neighborhood, parcel, or business, and why?</li>
      <li>Where does the Blue Line story carry to the Red Line, and where does it break down?</li>
      <li>If the City could support only three areas or business types first, which three, and why?</li>
    </ul>
    <div class="row" style="margin-top:12px">
      <button class="btn" onclick="exportCase()">Export my case (HTML)</button>
      <button class="btn sec" onclick="go('brief')">Revisit my original hypothesis</button>
    </div>
  </div>`;
  renderArgument();
};
function renderArgument(){
  const host=document.getElementById('slots');if(!host)return;
  host.innerHTML=SLOTS.map(s=>{
    const ev=S.argument[s.k].map(id=>{const p=S.pins.find(x=>x.id===id);return p?`<div class="ev">${esc(p.text)}<button class="x" onclick="argRemove('${s.k}','${id}')">✕</button></div>`:'';}).join('');
    return `<div class="slot" data-slot="${s.k}">
      <h4>${s.t} <span class="pillct">${(S.argumentText[s.k]&&S.argumentText[s.k].trim()?1:0)+S.argument[s.k].length} item${((S.argumentText[s.k]&&S.argumentText[s.k].trim()?1:0)+S.argument[s.k].length)===1?'':'s'}</span></h4>
      <div class="small mut" style="margin-bottom:6px">${s.hint}</div>
      <textarea data-at="${s.k}" placeholder="In your own words…">${esc(S.argumentText[s.k]||'')}</textarea>
      <div class="dropzone" data-drop="${s.k}">${ev||'drag evidence here ↓'}</div>
    </div>`;}).join('');
  host.querySelectorAll('[data-at]').forEach(t=>t.oninput=function(){S.argumentText[this.dataset.at]=this.value;save();});
  host.querySelectorAll('[data-drop]').forEach(z=>{
    z.ondragover=e=>{e.preventDefault();z.parentElement.classList.add('over');};
    z.ondragleave=()=>z.parentElement.classList.remove('over');
    z.ondrop=e=>{e.preventDefault();z.parentElement.classList.remove('over');const id=e.dataTransfer.getData('text/plain');
      const slot=z.dataset.drop;if(id&&!S.argument[slot].includes(id)){S.argument[slot].push(id);save();renderArgument();renderRail();}};
  });
}
function argRemove(slot,id){S.argument[slot]=S.argument[slot].filter(x=>x!==id);save();renderArgument();renderRail();}
function exportCase(){
  const sm=(S.indexDef&&Object.values(S.indexDef.weights||{}).some(w=>w))?S.indexDef:null;
  const evList=id=>{const p=S.pins.find(x=>x.id===id);return p?`<li>${esc(p.text)} <i style="color:#888">(${esc(p.src)})</i></li>`:'';};
  const slotHtml=SLOTS.map(s=>`<h3>${s.t}</h3><p>${esc(S.argumentText[s.k]||'<em>(not written)</em>').replace(/&lt;em&gt;/g,'<em>').replace(/&lt;\/em&gt;/g,'</em>')}</p>${S.argument[s.k].length?'<ul>'+S.argument[s.k].map(evList).join('')+'</ul>':''}`).join('');
  const allPins=S.pins.map(p=>`<li>${esc(p.text)} <i style="color:#888">(${esc(p.src)})</i></li>`).join('');
  const triage=_triage.length?`<h3>Red Line priority list (top 10)</h3><ol>${_triage.slice(0,10).map(t=>`<li>${t.town||'NPA '+t.npa}: score ${t.score.toFixed(2)}, demolitions after: ${isNum(t.demoPost)?t.demoPost:'—'}</li>`).join('')}</ol>`:'';
  const model=sm?`<h3>My index</h3><p>Weighted signals: <b>${Object.keys(sm.weights).filter(k=>sm.weights[k]).map(k=>catLabel(k)+' ('+(sm.weights[k]>0?'+':'')+sm.weights[k]+')').join(', ')}</b>.${S.indexBestMae!=null?` Best miss vs the City score: ${S.indexBestMae.toFixed(2)} points (0 to 5 scale).`:''}</p>`:'';
  const html=`<!doctype html><meta charset=utf-8><title>Charlotte Decision Challenge, my case</title>
  <body style="font-family:Inter,Arial,sans-serif;max-width:740px;margin:32px auto;padding:0 18px;line-height:1.6;color:#16202e">
  <h1 style="color:#8b1e3f">Charlotte Decision Challenge</h1>
  <p style="color:#666">Generated ${new Date().toLocaleString()} · ${S.pins.length} pieces of evidence · ${MISSIONS.filter(x=>S.missions[x.id]&&S.missions[x.id].done).length}/${MISSIONS.length} missions complete</p>
  <h3>My original hypothesis</h3><p>${esc(S.hypothesis||'(none recorded)')}</p>
  <hr>${slotHtml}${model}${triage}
  <hr><h3>All clipped evidence</h3><ul>${allPins||'<li>(none)</li>'}</ul>
  </body>`;
  download('my_charlotte_case.html',html);toast('Case exported');
}

/* ============================================================
 * DIG IN — neighborhood deep-dive  (re-added "follow one area all the way down")
 * ============================================================ */
const BIZc={}; if(window.BIZ){BIZ.cols.forEach((c,i)=>BIZc[c]=i);}
const DIG_NPAS=new Set(window.BIZ?BIZ.rows.map(r=>r[BIZc.npa]).filter(n=>n!=null):[]);
const SECTOR_COLORS=['#1f6feb','#b3203a','#b08a2e','#127a4b','#6b4ea0','#0e8a8a','#c2570c','#9aa3af'];
let _dig={line:'',npa:null};
function npaFeature(id){return window.NPAS.features.find(f=>f.properties.id==id);}
function featRings(f){const gm=f&&f.geometry;if(!gm)return[];return gm.type==='Polygon'?gm.coordinates:gm.coordinates.flat();}
function pointInRings(lon,lat,rgs){let inside=false;for(const poly of rgs){let in2=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];if(((yi>lat)!=(yj>lat))&&(lon<(xj-xi)*(lat-yi)/(yj-yi)+xi))in2=!in2;}if(in2)inside=!inside;}return inside;}
VIEWS.dig=function(){
  const m=document.getElementById('main');
  if(_dig.npa==null){const cnt={};(window.BIZ?BIZ.rows:[]).forEach(r=>{const n=r[BIZc.npa];if(n!=null)cnt[n]=(cnt[n]||0)+1;});const reds=D.npa.filter(x=>npaVal(x,'is_red')===1).map(x=>npaVal(x,'npa')).sort((x,y)=>(cnt[y]||0)-(cnt[x]||0));_dig.npa=(reds[0]&&cnt[reds[0]])?reds[0]:(reds[0]||npaVal(D.npa[0],'npa'));}
  m.innerHTML=`
  <div class="card">
    <div class="kick">Investigate · dig into one area</div>
    <h2>Explore one neighborhood</h2>
    <p class="small mut">Pick a place and read it at every scale: the neighborhood, its land, and its businesses.</p>
    <div class="row">
      <label class="fld">Line <select id="digLine"><option value="">all corridors</option><option value="blue">Blue</option><option value="silver">Silver</option><option value="gold">Gold</option><option value="red">Red</option></select></label>
      <label class="fld">Neighborhood <select id="digNpa"></select></label>
      <span id="digClip" style="align-self:flex-end"></span>
    </div>
  </div>
  <div id="digBody"></div>`;
  document.getElementById('digClip').innerHTML=clipBtn('Dig in',()=>digClipText(),'Clip this area');
  function fillNpa(){
    const ln=_dig.line;
    const list=D.npa.filter(r=>{const id=npaVal(r,'npa');if(!DIG_NPAS.has(id))return false;const tok=npaLineToken(id);if(!ln)return true;return tok.split(';').indexOf(ln)>=0;})
      .map(r=>({id:npaVal(r,'npa'),town:npaVal(r,'town')||''})).sort((a,b)=>(a.town||'zzz').localeCompare(b.town||'zzz')||a.id-b.id);
    if(!list.find(x=>x.id===_dig.npa)&&list.length)_dig.npa=list[0].id;
    document.getElementById('digNpa').innerHTML=list.map(x=>`<option value="${x.id}" ${x.id===_dig.npa?'selected':''}>${esc(x.town||('NPA '+x.id))} · NPA ${x.id}</option>`).join('');
  }
  document.getElementById('digLine').value=_dig.line;
  fillNpa();
  document.getElementById('digLine').onchange=function(){_dig.line=this.value;fillNpa();drawDig();};
  document.getElementById('digNpa').onchange=function(){_dig.npa=+this.value;drawDig();};
  drawDig();
};
let _digMap=null;
function drawDig(){
  const id=_dig.npa, row=NPA_BY_ID[id]; if(!row){document.getElementById('digBody').innerHTML='<div class="card"><div class="note">No data for this area.</div></div>';return;}
  const red=npaVal(row,'is_red')===1;
  const feat=npaFeature(id);const rgs=feat?featRings(feat):null;
  let biz=window.BIZ?BIZ.rows.filter(r=>r[BIZc.npa]==id):[];
  if(rgs&&rgs.length)biz=biz.filter(r=>isNum(r[BIZc.lat])&&isNum(r[BIZc.lon])&&pointInRings(r[BIZc.lon],r[BIZc.lat],rgs));
  const dispV=npaVal(row,'disp');
  // business composition
  const secCount={};biz.forEach(r=>{const s=r[BIZc.sector];if(s!=null)secCount[s]=(secCount[s]||0)+1;});
  const secRank=Object.keys(secCount).map(s=>({s:+s,n:secCount[s]})).sort((a,b)=>b.n-a.n);
  const emps=biz.map(r=>r[BIZc.emp]).filter(isNum);
  const small=pct(emps.filter(e=>e<=S.thresholds.small_emp).length,emps.length);
  const dists=biz.map(r=>Math.min(...[r[BIZc.dred],r[BIZc.dblue],r[BIZc.dsilver]].filter(isNum))).filter(isNum);
  // index rank if defined
  let idxBlock='';
  if(S.indexDef&&Object.values(S.indexDef.weights||{}).some(w=>w)){
    const scored=D.npa.filter(r=>npaLineToken(npaVal(r,'npa'))!=='').map(r=>({id:npaVal(r,'npa'),v:npaIndexScore(r)})).filter(x=>isNum(x.v)).sort((a,b)=>b.v-a.v);
    const pos=scored.findIndex(x=>x.id===id);
    idxBlock=pos>=0?`<div class="okbox"><b>Your custom index</b> ranks this neighborhood <b>#${pos+1} of ${scored.length}</b> corridor areas for displacement risk (score ${scored[pos].v.toFixed(2)}). <span class="mut">Build/adjust it in “Build your own index”.</span></div>`:'';
  } else {
    idxBlock=`<div class="note">Build a weighted index in <b>“Build your own index”</b> and this area will show its rank here.</div>`;
  }
  const tile=(b,l,c)=>statTile(b,l,c);
  document.getElementById('digBody').innerHTML=`
  <div class="card">
    <div class="spread"><h3 style="margin:0">${esc(npaVal(row,'town')||('NPA '+id))} <span class="small mut">· NPA ${id}</span> ${red?'<span class="tag npa" style="background:#fdeef2;color:#a01f3c">Red Line</span>':'<span class="tag npa">'+esc(npaLineLabel(id))+'</span>'}</h3>
      <span class="small mut">City displacement index: ${isNum(dispV)?'<b>'+dispV+'</b> / 5':'<i>not scored by the City</i>'}</span></div>
    ${idxBlock}
    <div class="grid3" style="margin-top:10px">
      ${tile(fmt$(npaVal(row,'HOUSEHOLD INCOME')),'median income','blue')}
      ${tile(fmt(npaVal(row,'HOME OWNERSHIP'))+'%','owner-occupied','gold')}
      ${tile(fmt$(npaVal(row,'RENTAL COSTS')),'median rent','silver')}
    </div>
  </div>
  <div class="grid2">
    <div class="card"><h3 style="margin-bottom:6px">On the map</h3>
      <div class="mapbox" id="digMap" style="height:360px"></div>
      <div class="diglegend">${[...new Set(biz.map(r=>r[BIZc.sector]).filter(x=>x!=null))].sort((a,b)=>a-b).map(si=>'<span class="legitem"><i style="background:'+SECTOR_COLORS[si]+'"></i>'+esc(SECTORS[si])+'</span>').join('')||'<span class="small mut">No businesses mapped in this area.</span>'}</div>
      <div class="small mut" style="margin-top:4px">${biz.length} businesses inside this neighborhood, colored by sector. Lighter lines are the other neighborhoods.</div></div>
    <div class="card"><h3>Read it at three scales</h3>
      <div style="margin-top:6px"><div class="kick" style="color:var(--blue)">Neighborhood</div>
        <table class="t"><tbody>
          ${digRow(row,'RESIDENTIAL DEMOLITIONS','residential demolitions')}
          ${digRow(row,'RESIDENTIAL NEW CONST','residential new construction')}
          ${digRow(row,'RESIDENTIAL FORECLOSURES','foreclosures')}
          ${digRow(row,'EDU LEVEL BACH DEGREE','bachelor degree %')}
          ${digRow(row,'RACEETH WHITE','% white')}
        </tbody></table></div>
      <div style="margin-top:10px"><div class="kick" style="color:var(--blue)">Land / parcels</div>
        <table class="t"><tbody>
          ${digRow(row,'pct_parcel_underutilized','% parcels underutilized')}
          ${digRow(row,'pct_parcel_out_of_state','% out-of-state owners')}
          ${digRow(row,'HOUSING AGE','median housing age')}
          ${digRow(row,'VACANT LAND','% vacant land')}
        </tbody></table></div>
      <div style="margin-top:10px"><div class="kick" style="color:var(--blue)">Businesses (${biz.length})</div>
        <table class="t"><tbody>
          <tr><td>top sectors</td><td>${secRank.slice(0,3).map(x=>esc(SECTORS[x.s])+' '+pct(x.n,biz.length)+'%').join(', ')||'—'}</td></tr>
          <tr><td>median employees</td><td>${fmt(median(emps))}</td></tr>
          <tr><td>small (≤${S.thresholds.small_emp} emp)</td><td>${small}%</td></tr>
          <tr><td>avg distance to a station</td><td>${dists.length?mean(dists).toFixed(2)+' mi':'—'}</td></tr>
        </tbody></table></div>
    </div>
  </div>`;
  // map
  if(_digMap){try{_digMap.remove();}catch(e){}_digMap=null;}
  const dm=L.map('digMap',{scrollWheelZoom:true}).setView([npaVal(row,'lat'),npaVal(row,'lon')],13);
  _mapObj=dm;_digMap=dm;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:18,subdomains:'abcd',attribution:'© OSM © CARTO'}).addTo(dm);
  L.geoJSON(window.NPAS,{interactive:false,style:{color:'#cfd6e0',weight:.7,fill:false}}).addTo(dm);
  if(feat){const gj=L.geoJSON(feat,{style:{color:red?'#b3203a':'#1f6feb',weight:2.4,fill:true,fillColor:red?'#b3203a':'#1f6feb',fillOpacity:.07}}).addTo(dm);try{dm.fitBounds(gj.getBounds(),{maxZoom:14,padding:[24,24]});}catch(e){}}
  if(window.LINESG)L.geoJSON(window.LINESG,{style:f=>{const ln=(f.properties.line||'').toLowerCase();return{color:LINEHEX[ln]||'#444',weight:3.5,opacity:.9,dashArray:f.properties.dash?'7,6':null};}}).addTo(dm);
  biz.forEach(r=>{const la=r[BIZc.lat],lo=r[BIZc.lon];if(!isNum(la)||!isNum(lo))return;const s=r[BIZc.sector];
    L.circleMarker([la,lo],{radius:3.5,color:'#fff',weight:.6,fillColor:SECTOR_COLORS[s]||'#888',fillOpacity:.85}).bindTooltip(SECTORS[s]||'business').addTo(dm);});
  ST_UNIQ.forEach(s=>{L.circleMarker([s[1],s[0]],{radius:4,color:'#111',weight:1,fillColor:LINEHEX[(s[3]||'').toLowerCase()]||'#333',fillOpacity:1}).bindTooltip(s[2]||'').addTo(dm);});
  (window.RED_STATIONS||[]).forEach(s=>L.circleMarker([s.lat,s.lon],{radius:5,color:'#111',weight:1.2,fillColor:'#b3203a',fillOpacity:1}).bindTooltip('Red · '+s.name).addTo(dm));
  setTimeout(()=>dm.invalidateSize(),60);
}
function digRow(row,key,lab){const v=npaVal(row,key);return `<tr><td>${lab}</td><td>${key.indexOf('income')>=0||key.indexOf('RENT')>=0?fmt$(v):fmt(v)}</td></tr>`;}
function digClipText(){const row=NPA_BY_ID[_dig.npa];const biz=window.BIZ?BIZ.rows.filter(r=>r[BIZc.npa]==_dig.npa):[];
  return `${npaVal(row,'town')||'NPA '+_dig.npa}: income ${fmt$(npaVal(row,'HOUSEHOLD INCOME'))}, ${fmt(npaVal(row,'HOME OWNERSHIP'))}% own, ${biz.length} businesses, demolitions ${fmt(npaVal(row,'RESIDENTIAL DEMOLITIONS'))}.`;}

/* ============================================================
 * BUILD YOUR OWN INDEX — weighted NPA-level index, learn on Blue/Silver, apply to Red
 * ============================================================ */
const IDX_FACTORS=[
  {key:'HOUSEHOLD INCOME',dir:-1},
  {key:'HOME OWNERSHIP',dir:-1},
  {key:'RENTAL COSTS',dir:1},
  {key:'RESIDENTIAL DEMOLITIONS',dir:1},
  {key:'RESIDENTIAL NEW CONST',dir:1},
  {key:'pct_parcel_underutilized',dir:1},
  {key:'pct_parcel_out_of_state',dir:1},
  {key:'pct_small_le9',dir:1},
];
const IDX_DIR={};IDX_FACTORS.forEach(f=>IDX_DIR[f.key]=f.dir);
let _idxStatsCache=null, idxGeo=null;
function idxTrainRows(){return D.npa.filter(r=>npaVal(r,'is_red')!==1 && npaLineToken(npaVal(r,'npa'))!=='');}
function idxStats(key){_idxStatsCache=_idxStatsCache||{};if(_idxStatsCache[key])return _idxStatsCache[key];
  const v=idxTrainRows().map(r=>npaVal(r,key)).filter(isNum);const m=mean(v)||0;const sd=Math.sqrt((v.reduce((a,b)=>a+(b-m)**2,0)/(v.length||1)))||1;
  return _idxStatsCache[key]={m,sd};}
function npaIndexScore(row){const w=(S.indexDef&&S.indexDef.weights)||{};let s=0,any=false;
  Object.keys(w).forEach(k=>{const wt=w[k];if(!wt)return;const v=npaVal(row,k);if(!isNum(v))return;const st=idxStats(k);s+=wt*((v-st.m)/st.sd);any=true;});
  return any?s:null;}
const NPA_DISP={};(function(){if(!window.BIZ)return;BIZ.rows.forEach(r=>{const n=r[BIZc.npa],d=r[BIZc.disp];if(n!=null&&isNum(d)&&NPA_DISP[n]==null)NPA_DISP[n]=d;});})();
VIEWS.index=function(){
  if(!S.indexDef)S.indexDef={weights:{}};
  if(!S.indexDef.seeded){IDX_FACTORS.forEach(f=>{if(S.indexDef.weights[f.key]==null)S.indexDef.weights[f.key]=f.dir;});S.indexDef.seeded=true;save();}
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick">Reason · build your own index</div>
    <h2>Build your own index</h2>
    <p class="small mut">Choose the neighborhood signals you think mark risk, then weight each one: negative protects, positive adds risk. The index is standardized on the Blue and Silver corridors and can be carried to the <b style="color:var(--red)">Red Line</b>.</p>
  </div>
  <div class="card">
    <h3>1 · Choose your signals</h3>
    <p class="small mut">Pick any measures to include. They cover the neighborhood, its land, and its businesses.</p>
    <div id="idxPicker" style="max-height:210px;overflow:auto;border:1px solid var(--line);border-radius:9px;padding:8px 10px"></div>
    <div class="row" style="margin-top:8px"><button class="btn ghost sm" id="idxReset">Use the recommended set</button><button class="btn ghost sm" id="idxClear">Clear all</button></div>
    <h4 style="margin-top:14px">2 · Weight them</h4>
    <div id="idxWeights"></div>
  </div>
  <div class="card">
    <h3>Your index on the Blue / Silver corridors</h3>
    <div class="mapbox" id="idxMap" style="height:440px"></div>
    <div class="legend"><span>lower</span><div class="grad"></div><span>higher risk</span><span class="mut">· click an area to see its score</span></div>
    <div id="idxFeedback" style="margin-top:12px"></div>
  </div>
  <div class="card">
    <div class="spread"><h3 style="margin:0">Applied to the Red Line <span class="tag npa" style="background:#fdeef2;color:#a01f3c">transfer</span></h3>
      <span id="idxClip"></span></div>
    <div class="warnbox" style="margin:8px 0">Same weights and scale, applied to a wealthier, owner-occupied corridor. Read the result skeptically.</div>
    <div class="scrollx"><table class="t" id="idxRed"></table></div>
  </div>`;
  document.getElementById('idxClip').innerHTML=clipBtn('Build your own index',()=>idxClipText(),'Clip the Red ranking');
  setupIdxMap();
  drawIdxFactors();drawIdxRankings();
  document.getElementById('idxReset').onclick=function(){S.indexDef.weights={};IDX_FACTORS.forEach(f=>S.indexDef.weights[f.key]=f.dir);save();drawIdxFactors();drawIdxRankings();};
  document.getElementById('idxClear').onclick=function(){S.indexDef.weights={};save();drawIdxFactors();drawIdxRankings();};
};
function setupIdxMap(){
  const feats={type:'FeatureCollection',features:window.NPAS.features.filter(f=>{const row=NPA_BY_ID[f.properties.id];return row&&npaVal(row,'is_red')!==1&&npaLineToken(f.properties.id)!=='';})};
  const map=L.map('idxMap',{scrollWheelZoom:true}).setView([35.22,-80.84],11);_mapObj=map;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:18,subdomains:'abcd',attribution:'© OSM © CARTO'}).addTo(map);
  idxGeo=L.geoJSON(feats,{style:{color:'#dfe3ea',weight:.6,fillColor:'#eef0f4',fillOpacity:.4},
    onEachFeature:(f,l)=>{l.on('click',()=>{const row=NPA_BY_ID[f.properties.id];const v=row?npaIndexScore(row):null;
      l.bindPopup('<b>'+esc(row?(npaVal(row,'town')||'NPA '+f.properties.id):'')+'</b><br>Index score: '+(isNum(v)?v.toFixed(2):'—')).openPopup();});}}).addTo(map);
  if(window.LINESG)L.geoJSON(window.LINESG,{style:f=>{const ln=(f.properties.line||'').toLowerCase();if(ln==='red')return{opacity:0};return{color:LINEHEX[ln]||'#444',weight:3.5,opacity:.9,dashArray:f.properties.dash?'7,6':null};}}).addTo(map);
  try{map.fitBounds(idxGeo.getBounds(),{padding:[12,12]});}catch(e){}
  setTimeout(()=>map.invalidateSize(),60);
}
function updateIdxMap(){
  if(!idxGeo||!idxGeo.eachLayer)return;
  const sc=idxTrainRows().map(r=>npaIndexScore(r)).filter(isNum);
  const lo=quantile(sc,0.05),hi=quantile(sc,0.95);
  idxGeo.eachLayer(l=>{const row=NPA_BY_ID[l.feature.properties.id];const v=row?npaIndexScore(row):null;
    let t=isNum(v)?(v-lo)/((hi-lo)||1):null;
    l.setStyle({color:'#dfe3ea',weight:.6,fillColor:t==null?'#eef0f4':colorScale(Math.max(0,Math.min(1,t))),fillOpacity:t==null?.3:.86});});
}
function drawIdxFactors(){
  const groups=npaVarGroups(true);let ph='';
  Object.keys(groups).sort().forEach(cat=>{
    ph+=`<div style="margin:6px 0 2px;font-size:11px;font-weight:750;letter-spacing:.04em;text-transform:uppercase;color:var(--mut)">${esc(cat)}</div><div class="chips" style="margin:2px 0">`;
    groups[cat].forEach(c=>{const on=!!S.indexDef.weights[c.key];
      ph+=`<span class="chip ${on?'on':''}" data-pick="${esc(c.key)}">${esc(c.title)}</span>`;});
    ph+='</div>';});
  document.getElementById('idxPicker').innerHTML=ph;
  document.querySelectorAll('#idxPicker [data-pick]').forEach(ch=>ch.onclick=function(){const k=this.dataset.pick;
    if(S.indexDef.weights[k])delete S.indexDef.weights[k];else S.indexDef.weights[k]=IDX_DIR[k]||1;
    save();drawIdxFactors();drawIdxRankings();});
  const sel=Object.keys(S.indexDef.weights).filter(k=>S.indexDef.weights[k]);
  document.getElementById('idxWeights').innerHTML=sel.length?sel.map(k=>{const w=S.indexDef.weights[k];
    return `<div style="margin:8px 0"><div class="spread"><label class="small" style="font-weight:600">${esc(catLabel(k))}</label><span class="small"><b id="idxw_${cssId(k)}">${w>0?'+':''}${w}</b> <span data-rm="${esc(k)}" style="cursor:pointer;color:var(--mut);margin-left:6px">remove</span></span></div>
      <input type="range" min="-2" max="2" step="0.1" value="${w}" data-k="${esc(k)}" style="width:100%"></div>`;}).join('')
    :'<div class="note">Pick one or more signals above to weight them.</div>';
  document.querySelectorAll('#idxWeights input[data-k]').forEach(inp=>inp.oninput=function(){
    S.indexDef.weights[this.dataset.k]=parseFloat(this.value);document.getElementById('idxw_'+cssId(this.dataset.k)).innerHTML=(this.value>0?'+':'')+this.value;save();drawIdxRankings();});
  document.querySelectorAll('#idxWeights [data-rm]').forEach(b=>b.onclick=function(){delete S.indexDef.weights[this.dataset.rm];save();drawIdxFactors();drawIdxRankings();});
}
function cssId(k){return k.replace(/[^a-z0-9]/gi,'_');}
function idxEvalPairs(){const p=[];D.npa.forEach(r=>{const d=NPA_DISP[npaVal(r,'npa')];if(!isNum(d))return;const x=npaIndexScore(r);if(!isNum(x))return;p.push({x,d});});return p;}
function idxFeedback(){const p=idxEvalPairs();if(p.length<5)return null;
  const xs=p.map(o=>o.x),ds=p.map(o=>o.d),n=p.length;
  const rc=pearson(ranks(xs),ranks(ds));
  let sx=0,sd=0,sxd=0,sxx=0;p.forEach(o=>{sx+=o.x;sd+=o.d;sxd+=o.x*o.d;sxx+=o.x*o.x;});
  const a=(n*sxd-sx*sd)/((n*sxx-sx*sx)||1),b=(sd-a*sx)/n;
  let mae=0;p.forEach(o=>{mae+=Math.abs(o.d-(a*o.x+b));});
  return {n,rc:rc||0,mae:mae/n};}
function renderIdxFeedback(){const host=document.getElementById('idxFeedback');if(!host)return;
  const fb=idxFeedback();
  if(!fb){host.innerHTML='<div class="note">Pick and weight some signals to see how close your index gets to the City score.</div>';return;}
  if(S.indexBestMae==null||fb.mae<S.indexBestMae){S.indexBestMae=+fb.mae.toFixed(3);save();}
  const good=fb.mae<=0.8&&fb.rc>=0.5;
  const word=Math.abs(fb.rc)<0.25?'weak':Math.abs(fb.rc)<0.5?'moderate':Math.abs(fb.rc)<0.7?'strong':'very strong';
  host.innerHTML='<div class="'+(good?'okbox':'warnbox')+'" style="margin:0">'+
    '<div class="small" style="text-transform:uppercase;letter-spacing:.05em;font-weight:700">Match with the City score</div>'+
    '<div style="font-size:26px;font-weight:750;line-height:1.1;margin:2px 0">'+word+' agreement · r = '+fb.rc.toFixed(2)+'</div>'+
    '<div class="small">Average miss <b>'+fb.mae.toFixed(2)+'</b> points on the 0 to 5 scale (lower is better) · best so far '+(S.indexBestMae!=null?S.indexBestMae:fb.mae).toFixed(2)+'</div>'+
    '<div class="small mut" style="margin-top:4px">Across '+fb.n+' neighborhoods with a City score. The index is rescaled to 0 to 5 first, so only the pattern matters. Tune the weights to raise the match and shrink the miss.</div></div>';
}
function drawIdxRankings(){
  renderIdxFeedback();updateIdxMap();
  const red=D.npa.filter(r=>npaVal(r,'is_red')===1).map(r=>({id:npaVal(r,'npa'),town:npaVal(r,'town')||'',v:npaIndexScore(r)})).filter(x=>isNum(x.v)).sort((a,b)=>b.v-a.v);
  document.getElementById('idxRed').innerHTML='<thead><tr><th>#</th><th>Area</th><th>NPA</th><th>index</th></tr></thead><tbody>'+
    red.map((x,i)=>`<tr onclick="_dig.npa=${x.id};go('dig')" style="cursor:pointer"><td>${i+1}</td><td>${esc(x.town||'—')}</td><td>${x.id}</td><td><b>${x.v.toFixed(2)}</b></td></tr>`).join('')+'</tbody>';
}
function idxClipText(){const red=D.npa.filter(r=>npaVal(r,'is_red')===1).map(r=>({town:npaVal(r,'town')||('NPA'+npaVal(r,'npa')),v:npaIndexScore(r)})).filter(x=>isNum(x.v)).sort((a,b)=>b.v-a.v);
  const on=Object.keys(S.indexDef.weights).filter(k=>S.indexDef.weights[k]).map(k=>catLabel(k)+'('+(S.indexDef.weights[k]>0?'+':'')+S.indexDef.weights[k]+')');
  return `My index [${on.join(', ')}] ranks Red areas: ${red.slice(0,3).map(x=>x.town+' '+x.v.toFixed(2)).join(', ')}.`;}



/* ============================================================
 * CORRELATION MATRIX
 * ============================================================ */
let _corr={level:'npa',vars:null,line:''};
function corrRows(){let rows=_corr.level==='biz'?ALLBIZ:D.npa;if(_corr.line){if(_corr.level==='biz')rows=rows.filter(r=>bzVal(r,'line')===_corr.line);else{const ln=_corr.line.toLowerCase();rows=rows.filter(r=>npaLineToken(npaVal(r,'npa')).split(';').indexOf(ln)>=0);}}return rows;}
function corrVal(r,k){return _corr.level==='biz'?bzVal(r,k):npaVal(r,k);}
function corrVarList(){
  if(_corr.level==='biz') return BIZ_NUM.slice();
  return ['disp'].concat(D.catalog.filter(c=>c.level==='Neighborhood'&&(c.key in NPAI)&&c.key!=='npa'&&NPA_COV[c.key]>=COV_MIN).map(c=>c.key));
}
function corrDefault(){
  return _corr.level==='biz'
    ? ['displacement_index','dist_station_mi','employees','land_value','building_to_land','building_age','nbhd_income','nbhd_rent']
    : ['disp','HOUSEHOLD INCOME','HOME OWNERSHIP','RENTAL COSTS','RESIDENTIAL DEMOLITIONS','RESIDENTIAL NEW CONST','HOUSING AGE','RESIDENTIAL FORECLOSURES'];
}
function corrColor(r){if(r==null)return '#f4f6fa';const t=(r+1)/2;const c1=[31,111,235],c2=[255,255,255],c3=[179,32,58];
  let a,b,fr;if(t<.5){a=c1;b=c2;fr=t/.5;}else{a=c2;b=c3;fr=(t-.5)/.5;}
  return 'rgb('+a.map((v,i)=>Math.round(v+(b[i]-v)*fr)).join(',')+')';}
VIEWS.corr=function(){
  if(!_corr.vars)_corr.vars=corrDefault();
  const avail=corrVarList();
  _corr.vars=_corr.vars.filter(k=>avail.indexOf(k)>=0); if(!_corr.vars.length)_corr.vars=corrDefault();
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--blue)">Investigate · correlations</div>
    <h2>Correlations</h2>
    <p class="small mut">Each cell is the correlation between two measures, from -1 (blue) to +1 (red). Click a cell to open that pair in the chart studio.</p>
    <div class="row" style="align-items:center">
      <div class="chips" style="margin:0">
        <span class="chip ${_corr.level==='npa'?'on':''}" data-cl="npa">Neighborhood level</span>
        <span class="chip ${_corr.level==='biz'?'on':''}" data-cl="biz">Business level</span>
      </div>
      <label class="fld">Line <select id="corrLine"><option value="">all corridors</option><option value="Blue">Blue</option><option value="Silver">Silver</option><option value="Red">Red</option></select></label>
    </div>
    <div class="small mut" style="margin:4px 0">Variables (${_corr.vars.length} chosen, up to 14):</div>
    <div class="chips" id="corrPick" style="max-height:120px;overflow:auto"></div>
  </div>
  <div class="card">
    <div class="scrollx" style="max-height:none"><div id="corrMatrix"></div></div>
    <div class="legend" style="margin-top:10px"><span>−1</span><div class="grad" style="background:linear-gradient(90deg,#1f6feb,#fff,#b3203a)"></div><span>+1</span><span class="mut">correlation</span><span id="corrClip" style="margin-left:auto"></span></div>
  </div>`;
  document.getElementById('corrClip').innerHTML=clipBtn('Correlations',()=>corrClipText(),'Clip the strongest link');
  document.querySelectorAll('[data-cl]').forEach(c=>c.onclick=function(){_corr.level=this.dataset.cl;_corr.vars=corrDefault();VIEWS.corr();});
  document.getElementById('corrLine').value=_corr.line;
  document.getElementById('corrLine').onchange=function(){_corr.line=this.value;drawCorr();};
  const pick=document.getElementById('corrPick');
  pick.innerHTML=avail.map(k=>`<span class="chip ${_corr.vars.includes(k)?'on':''}" data-k="${esc(k)}">${esc(catLabel(k))}</span>`).join('');
  pick.querySelectorAll('[data-k]').forEach(c=>c.onclick=function(){const k=this.dataset.k;
    if(_corr.vars.includes(k))_corr.vars=_corr.vars.filter(x=>x!==k);
    else{if(_corr.vars.length>=14){toast('Up to 14 variables');return;}_corr.vars.push(k);}
    this.classList.toggle('on');drawCorr();});
  drawCorr();
};
function drawCorr(){
  const rows=corrRows(), vars=_corr.vars;
  const cols=vars.map(k=>rows.map(r=>corrVal(r,k)));
  const R=vars.map((_,i)=>vars.map((__,j)=>i===j?1:pearson(cols[i],cols[j])));
  let h='<table class="t corrt"><thead><tr><th class="corrhd"></th>';
  vars.forEach((k,j)=>h+=`<th class="corrnum" title="${esc(catLabel(k))}">${j+1}</th>`);
  h+='</tr></thead><tbody>';
  vars.forEach((k,i)=>{
    h+=`<tr><th class="corrrow">${i+1}. ${esc(catLabel(k))}</th>`;
    vars.forEach((k2,j)=>{const r=R[i][j];const strong=r!=null&&Math.abs(r)>0.55;
      h+=`<td class="corrcell" style="background:${corrColor(r)};color:${strong?'#fff':'var(--ink)'}" ${i!==j?`onclick="corrOpen('${esc(k2)}','${esc(k)}')"`:''} title="${esc(catLabel(k))} vs ${esc(catLabel(k2))}">${r==null?'·':(i===j?'1.0':r.toFixed(2))}</td>`;});
    h+='</tr>';});
  h+='</tbody></table>';
  document.getElementById('corrMatrix').innerHTML=h;
}
function corrOpen(xk,yk){_cs.level=_corr.level;_cs.x=xk;_cs.y=yk;_cs.group='none';_cs.kind='scatter';go('chart');}
function corrClipText(){
  const rows=corrRows(),vars=_corr.vars;
  const tgt=_corr.level==='biz'?'displacement_index':'disp';
  if(vars.indexOf(tgt)<0)return `Correlations among ${vars.length} ${_corr.level==='biz'?'business':'neighborhood'} measures.`;
  const tcol=rows.map(r=>corrVal(r,tgt));
  let best=null;vars.forEach(k=>{if(k===tgt)return;const r=pearson(tcol,rows.map(rr=>corrVal(rr,k)));if(r!=null&&(best==null||Math.abs(r)>Math.abs(best.r)))best={k,r};});
  return best?`Strongest link to risk (${_corr.level} level): ${catLabel(best.k)}, r=${best.r.toFixed(2)} (${rWord(best.r)}).`:`Correlations among ${vars.length} measures.`;
}



/* ============================================================
 * REGRESSION (simple, exploratory) — business + neighborhood levels
 * ============================================================ */
let _reg={level:'npa',y:null,x:null};
function regVars(){return _reg.level==='biz'?BIZ_NUM.slice():['disp'].concat(D.catalog.filter(c=>c.level==='Neighborhood'&&(c.key in NPAI)&&c.key!=='npa'&&NPA_COV[c.key]>=COV_MIN).map(c=>c.key));}
function regGetVal(r,k){if(_reg.level==='npa'){if(k==='disp')return (typeof NPA_DISP!=='undefined')?NPA_DISP[npaVal(r,'npa')]:npaVal(r,'disp');return npaVal(r,k);}return bzVal(r,k);}
function fitGeneric(rows,xkeys,ykey){
  if(!xkeys.length)return null;
  const stats={};
  xkeys.forEach(k=>{const v=rows.map(r=>regGetVal(r,k)).filter(isNum);const m=mean(v)||0;const sd=Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length||1))||1;stats[k]={m,sd,imp:Math.round(100*(1-v.length/rows.length))};});
  const Y=[],X=[];
  rows.forEach(r=>{const y=regGetVal(r,ykey);if(!isNum(y))return;Y.push(y);X.push(xkeys.map(k=>{let v=regGetVal(r,k);if(!isNum(v))v=stats[k].m;return (v-stats[k].m)/stats[k].sd;}));});
  if(X.length<8)return null;
  const ym=mean(Y),p=xkeys.length;
  const XtX=Array.from({length:p},()=>Array(p).fill(0)),Xty=Array(p).fill(0);
  for(let i=0;i<X.length;i++)for(let a=0;a<p;a++){Xty[a]+=X[i][a]*(Y[i]-ym);for(let b=0;b<p;b++)XtX[a][b]+=X[i][a]*X[i][b];}
  for(let a=0;a<p;a++)XtX[a][a]+=0.5;
  const beta=matMulVec(matInv(XtX),Xty);
  let ss=0,st=0;for(let i=0;i<X.length;i++){let pr=ym;for(let a=0;a<p;a++)pr+=beta[a]*X[i][a];ss+=(Y[i]-pr)**2;st+=(Y[i]-ym)**2;}
  return {beta,xkeys,stats,r2:1-ss/(st||1),n:X.length};
}
VIEWS.regress=function(){
  const vars=regVars();
  if(!_reg.y||vars.indexOf(_reg.y)<0)_reg.y=_reg.level==='biz'?'displacement_index':'disp';
  if(!_reg.x)_reg.x=_reg.level==='biz'?['dist_station_mi','land_value','building_age','employees']:['HOUSEHOLD INCOME','HOME OWNERSHIP','RENTAL COSTS','RESIDENTIAL DEMOLITIONS'];
  _reg.x=_reg.x.filter(k=>vars.indexOf(k)>=0&&k!==_reg.y);
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--blue)">Investigate · regression</div>
    <h2>What predicts what?</h2>
    <p class="small mut">Pick an outcome and the predictors you think drive it. A simple regression shows how strongly each one moves the outcome, holding the others fixed, and how much of the variation it explains. Observational, so a relationship is not proof of cause.</p>
    <div class="chips">
      <span class="chip ${_reg.level==='npa'?'on':''}" data-rl="npa">Neighborhood level</span>
      <span class="chip ${_reg.level==='biz'?'on':''}" data-rl="biz">Business level</span>
    </div>
    <div class="row"><label class="fld">Outcome to predict <select id="regY"></select></label></div>
    <div class="small mut" style="margin:6px 0 2px">Predictors:</div>
    <div class="chips" id="regX" style="max-height:120px;overflow:auto"></div>
  </div>
  <div class="card"><div id="regOut"></div><div style="margin-top:10px" id="regClip"></div></div>`;
  const ysel=document.getElementById('regY');
  ysel.innerHTML=vars.map(k=>`<option value="${k}" ${k===_reg.y?'selected':''}>${esc(catLabel(k))}</option>`).join('');
  ysel.onchange=function(){_reg.y=this.value;_reg.x=_reg.x.filter(k=>k!==_reg.y);VIEWS.regress();};
  document.querySelectorAll('[data-rl]').forEach(c=>c.onclick=function(){_reg.level=this.dataset.rl;_reg.y=null;_reg.x=null;VIEWS.regress();});
  const xh=document.getElementById('regX');
  xh.innerHTML=vars.filter(k=>k!==_reg.y).map(k=>`<span class="chip ${_reg.x.includes(k)?'on':''}" data-x="${esc(k)}">${esc(catLabel(k))}</span>`).join('');
  xh.querySelectorAll('[data-x]').forEach(c=>c.onclick=function(){const k=this.dataset.x;
    if(_reg.x.includes(k))_reg.x=_reg.x.filter(z=>z!==k);else{if(_reg.x.length>=10){toast('Up to 10 predictors');return;}_reg.x.push(k);}
    this.classList.toggle('on');drawReg();});
  document.getElementById('regClip').innerHTML=clipBtn('Regression',()=>regClipText(),'Clip this result');
  drawReg();
};
function drawReg(){
  const rows=_reg.level==='biz'?ALLBIZ:D.npa;
  const m=fitGeneric(rows,_reg.x,_reg.y);
  const out=document.getElementById('regOut');if(!out)return;
  if(!m){out.innerHTML='<div class="note">Pick an outcome and at least one predictor with enough data.</div>';return;}
  const coefs=m.xkeys.map((k,i)=>({k,b:m.beta[i],imp:m.stats[k].imp})).sort((a,b)=>Math.abs(b.b)-Math.abs(a.b));
  const maxB=Math.max(0.001,...coefs.map(c=>Math.abs(c.b)));
  const rowsH=coefs.map(c=>{const mag=Math.abs(c.b);const word=mag<0.04?'barely':mag<0.12?'weakly':mag<0.25?'moderately':'strongly';const up=c.b>=0;const col=up?'var(--red)':'var(--good)';const w=Math.min(50,mag/maxB*50);
    return `<div class="coefrow"><div>${esc(catLabel(c.k))}</div><div class="coefbar"><div class="zero"></div><div class="fill" style="background:${col};${up?'left:50%':'right:50%'};width:${w}%"></div></div><div class="coefval" style="color:${col}">${word} ${up?'raises':'lowers'} the outcome${c.imp>=40?` <span class="mut">(${c.imp}% filled in)</span>`:''}</div></div>`;}).join('');
  out.innerHTML=`<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:6px">
      <div><div style="font-size:22px;font-weight:750;line-height:1.05">${(m.r2*100).toFixed(0)}%</div><div class="small mut">of the variation in ${esc(catLabel(_reg.y))} explained (R²)</div></div>
      <div><div style="font-size:22px;font-weight:750;line-height:1.05">${m.n.toLocaleString()}</div><div class="small mut">observations used</div></div>
    </div>
    <h4 style="margin-top:8px">What each predictor does (standardized weight)</h4>${rowsH}
    <div class="note">Each predictor is scaled to the same range, so the bars are comparable. Red raises the outcome, green lowers it. A relationship here is not proof of cause.</div>`;
}
function regClipText(){const rows=_reg.level==='biz'?ALLBIZ:D.npa;const m=fitGeneric(rows,_reg.x,_reg.y);
  if(!m)return `Regression of ${catLabel(_reg.y)}.`;
  const top=m.xkeys.map((k,i)=>({k,b:m.beta[i]})).sort((a,b)=>Math.abs(b.b)-Math.abs(a.b))[0];
  return `${_reg.level==='npa'?'Neighborhood':'Business'} regression of ${catLabel(_reg.y)}: R²=${(m.r2*100).toFixed(0)}%, strongest predictor ${catLabel(top.k)} (${top.b>=0?'+':''}${top.b.toFixed(2)}).`;}


boot();
