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
const LABEL_ALIAS={disp:'Displacement index (City)',displacement_index:'Displacement index',survival:'Business survival (Active=1)',displacement_score:'Displacement score (0-5)',own_building:'Owns building',parcel_acres:'Parcel acres',tax_change:'Tax revaluation change',tax_pct_change:'Tax change %',employees_known:'Employees known?',parcel_commercial:'Commercial parcel',parcel_building_to_land:'Parcel building-to-land',parcel_recent_sale:'Recent sale (2020-25)',parcel_underutilized:'Parcel underutilized',parcel_out_of_state_owner:'Out-of-state owner',net_building_value:'Net building value',nbhd_income:'Neighborhood income',nbhd_pct_own:'Neighborhood % owner',nbhd_rent:'Neighborhood rent',leases_building:'Leases building',lot_acres:'Lot acres',building_to_land:'Building-to-land ratio',building_age:'Building age',dist_station_mi:'Distance to station (mi)',land_value:'Land value',total_value:'Total value',employees:'Employees',sector:'Business sector',line:'Transit line'};
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
  argumentText:{claim:'',transfers:''},
  team:null,
  conclusion:'',
  feedback:{}
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
function resetAll(){if(confirm('Clear all your work and answers? This also signs your team out, and cannot be undone.')){localStorage.removeItem(SKEY);location.reload();}}

/* ============================================================
 * Evidence tray
 * ============================================================ */
function clip(src,text){S.pins.push({id:'p'+Date.now()+Math.floor(Math.random()*99),src,text,t:Date.now()});renderPins();save();toast('Clipped to evidence');flashPill();}
function unpin(id){S.pins=S.pins.filter(p=>p.id!==id);
  // also remove from argument slots
  Object.keys(S.argument).forEach(k=>S.argument[k]=S.argument[k].filter(x=>x!==id));
  renderPins();save();}
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
    {id:'brief',ic:'◎',t:'Problem statement'},
    {id:'missions',ic:'🎯',t:'Tasks'},
    {id:'guide',ic:'📖',t:'Field guide & data'},
  ]},
  {grp:'Investigate',items:[
    {id:'map',ic:'🗺',t:'Map studio'},
    {id:'chart',ic:'📈',t:'Chart studio'},
    {id:'corr',ic:'▦',t:'Correlations'},
    {id:'time',ic:'⏳',t:'Time machine'},
    {id:'dig',ic:'🔬',t:'Dig into one area'},
    {id:'table',ic:'▦',t:'Data table'},
  ]},
  {grp:'The model',items:[
    {id:'survival1',ic:'',t:'Stage 1 · Build the model'},
    {id:'survival3',ic:'',t:'Stage 2 · Apply to the Red Line'},
  ]},
  {grp:'Wrap up',items:[
    {id:'feedback',ic:'★',t:'Feedback'},
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
ICON.present='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="12" height="9" rx="1.5"/><path d="M10 13v3M7.5 16.2h5"/></svg>';
ICON.regress='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l4-3 3 2 5-7"/><circle cx="4" cy="16" r="1"/><circle cx="16" cy="8" r="1"/></svg>';
function navIcon(id){return ICON[id]||'';}
function renderRail(){
  const done=k=>S.missions[k]&&S.missions[k].done;
  const missionsDone=MISSIONS?MISSIONS.filter(m=>done(m.id)).length:0;
  let h='';
  NAV.forEach(g=>{
    h+=`<div class="navgrp"><div class="lbl">${g.grp}</div>`;
    g.items.forEach(it=>{
      const extra=it.id==='missions'&&missionsDone?`<span class="badge">${missionsDone}/${MISSIONS.length}</span>`:'';
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
function clipBtn(){return '';}

/* DQ pill value + modal (defined in guide module too) */

function boot(){ if(!gateOK()){renderGate();return;} hideGate(); renderTeamChip(); renderPins(); renderRail(); go(S.view||'brief'); }

/* ---- Team login gate ---- */
function validEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e||'').trim());}
function gateOK(){return !!(S.team&&S.team.name&&validEmail(S.team.email));}
function hideGate(){var g=document.getElementById('gate');if(g){g.classList.add('hidden');g.innerHTML='';}}
function renderTeamChip(){var c=document.getElementById('teamChip');if(!c)return;
  if(gateOK()){c.style.display='';c.innerHTML='<b>'+esc(S.team.name)+'</b> <span class="mut" style="font-weight:400">'+esc(S.team.email)+'</span> <span style="cursor:pointer;margin-left:6px" title="Edit team" onclick="editTeam()">&#9998;</span>';}
  else c.style.display='none';}
function editTeam(){renderGate();}
function gateMsg(m){var e=document.getElementById('gateErr');if(e)e.textContent=m;}
function renderGate(){
  var g=document.getElementById('gate');if(!g)return;
  var t=(S.team&&S.team.name)||'',e=(S.team&&S.team.email)||'';
  g.innerHTML='<div class="gatebox">'+
    '<h2 style="margin:0 0 4px">Charlotte Decision Challenge</h2>'+
    '<p class="small mut" style="margin:0 0 16px">Sign in with your team to begin. Your team name and email let us share your final results with you and the organizer.</p>'+
    '<label class="gatelbl">Team name</label><input id="gateName" type="text" placeholder="e.g. The Transit Trackers" value="'+esc(t)+'">'+
    '<label class="gatelbl">Team email</label><input id="gateEmail" type="email" placeholder="you@school.edu" value="'+esc(e)+'">'+
    '<div id="gateErr" class="gateerr"></div>'+
    '<button class="btn" id="gateGo" style="width:100%;margin-top:6px">Start the challenge &rarr;</button>'+
    '<p class="tiny mut" style="margin-top:10px">By starting, you agree your team name, email and final answers may be shared with the challenge organizer (vgude@elon.edu).</p>'+
  '</div>';
  g.classList.remove('hidden');
  function submit(){var n=document.getElementById('gateName').value.trim();var em=document.getElementById('gateEmail').value.trim();
    if(!n){gateMsg('Please enter your team name.');return;}
    if(!validEmail(em)){gateMsg('Please enter a valid email address.');return;}
    S.team={name:n,email:em,ts:Date.now()};save();hideGate();renderTeamChip();renderPins();renderRail();go(S.view||'brief');}
  document.getElementById('gateGo').onclick=submit;
  document.getElementById('gateEmail').addEventListener('keydown',function(ev){if(ev.key==='Enter')submit();});
  var nm=document.getElementById('gateName');if(nm)nm.focus();
}

/* ---- Download any chart as a PNG (white background) ---- */
function downloadCanvas(id,filename){var c=document.getElementById(id);if(!c||!c.toDataURL){toast('Chart not ready yet');return;}
  var t=document.createElement('canvas');t.width=c.width;t.height=c.height;var x=t.getContext('2d');
  x.fillStyle='#ffffff';x.fillRect(0,0,t.width,t.height);x.drawImage(c,0,0);
  var url;try{url=t.toDataURL('image/png');}catch(err){toast('Could not export chart');return;}
  var a=document.createElement('a');a.href=url;a.download=filename||'chart.png';document.body.appendChild(a);a.click();a.remove();toast('Chart downloaded');}
/* ---- Generic CSV download (any rendered table, or an array of rows) ---- */
function downloadRows(rows,filename){var csv=rows.map(function(r){return r.map(function(c){c=(c==null?'':''+c);return (c.indexOf(',')>=0||c.indexOf('"')>=0||c.indexOf('\n')>=0)?'"'+c.replace(/"/g,'""')+'"':c;}).join(',');}).join('\n');download(filename,csv);toast('Downloaded');}
function downloadTableEl(id,filename){var el=document.getElementById(id);if(!el){toast('Nothing to download yet');return;}
  var tbl=el.tagName==='TABLE'?el:el.querySelector('table');if(!tbl){toast('Nothing to download yet');return;}
  var rows=[].slice.call(tbl.querySelectorAll('tr')).map(function(tr){return [].slice.call(tr.querySelectorAll('th,td')).map(function(c){return (c.innerText||c.textContent||'').replace(/\s+/g,' ').trim();});}).filter(function(r){return r.join('').length;});
  if(!rows.length){toast('Nothing to download yet');return;}
  downloadRows(rows,(filename||'table')+'.csv');}
function dlT(id,fn){return '<button class="btn ghost sm" onclick="downloadTableEl(\''+id+'\',\''+fn+'\')">⬇ CSV</button>';}
function downloadMapData(){try{var key=_mapState.key,mm=varMeasure(key);var rows=[['npa','town','red_line',catLabel(key)+(mm.unit&&mm.unit!=='—'?' ('+mm.unit+')':'')]];
  D.npa.forEach(function(r){rows.push([npaVal(r,'npa'),npaVal(r,'town')||'',npaVal(r,'is_red')===1?'yes':'no',npaVal(r,key)]);});
  downloadRows(rows,'neighborhoods_'+(''+key).replace(/[^a-z0-9]+/gi,'_')+'.csv');}catch(e){toast('Could not export');}}
function downloadBeforeAfter(){try{var cat=null;TM_CAT.forEach(function(c){if(c.k===_tmCat)cat=c;});if(!cat)return;
  var rows=[['variable (Blue corridor)','before','after','change','years']];
  cat.items.filter(function(it){return _tmSel[it.k];}).forEach(function(it){var r=blueBA(it);if(r)rows.push([r.label,r.beforeT,r.afterT,r.delta,r.years]);});
  downloadRows(rows,'blue_before_after.csv');}catch(e){toast('Could not export');}}
function downloadDigBiz(){try{if(!window.BIZ||_dig.npa==null){toast('Pick a neighborhood first');return;}var ci=BIZc;
  var rows=[['business_id','lat','lon','sector','status','employees','land_value','dist_to_nearest_station_mi']];
  BIZ.rows.forEach(function(r){if(r[ci.npa]!==_dig.npa)return;var d=[r[ci.dred],r[ci.dblue],r[ci.dsilver]].filter(isNum);
    rows.push([r[ci.li]!=null?('BZ'+r[ci.li]):'',r[ci.lat],r[ci.lon],SECTORS[r[ci.sector]]||r[ci.sector],r[ci.status]===1?'Active':'Closed',r[ci.emp],r[ci.land],d.length?Math.min.apply(null,d):'']);});
  if(rows.length<2){toast('No businesses to export');return;}
  downloadRows(rows,'neighborhood_'+_dig.npa+'_businesses.csv');}catch(e){toast('Could not export');}}
/* ---- Map -> PNG: redraw the map's data on a clean white canvas (basemap tiles can't be captured) ---- */
function _geomRings(g){if(!g)return [];return g.type==='Polygon'?g.coordinates:(g.type==='MultiPolygon'?[].concat.apply([],g.coordinates):(g.type==='LineString'?[g.coordinates]:(g.type==='MultiLineString'?g.coordinates:[])));}
function renderMapPNG(opts){try{
  var mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9;function ext(lon,lat){if(lon<mnx)mnx=lon;if(lon>mxx)mxx=lon;if(lat<mny)mny=lat;if(lat>mxy)mxy=lat;}
  (opts.polys||[]).forEach(function(p){p.rings.forEach(function(r){r.forEach(function(c){ext(c[0],c[1]);});});});
  (opts.lines||[]).forEach(function(l){l.rings.forEach(function(r){r.forEach(function(c){ext(c[0],c[1]);});});});
  (opts.points||[]).forEach(function(pt){ext(pt.lon,pt.lat);});
  if(mnx>mxx){toast('Nothing on the map to export yet');return;}
  var W=opts.width||1100,pad=opts.pad||26,dw=(mxx-mnx)||1e-4,dh=(mxy-mny)||1e-4,kx=Math.cos((mny+mxy)/2*Math.PI/180);
  var sc=(W-2*pad)/(dw*kx);var H=Math.max(220,Math.round(dh*sc+2*pad));
  function X(lon){return pad+(lon-mnx)*kx*sc;}function Y(lat){return pad+(mxy-lat)*sc;}
  var cv=document.createElement('canvas');cv.width=W;cv.height=H;var ctx=cv.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
  (opts.polys||[]).forEach(function(p){p.rings.forEach(function(r){if(!r.length)return;ctx.beginPath();r.forEach(function(c,i){var x=X(c[0]),y=Y(c[1]);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.closePath();if(p.fill){ctx.fillStyle=p.fill;ctx.fill();}if(p.stroke){ctx.strokeStyle=p.stroke;ctx.lineWidth=p.w||0.7;ctx.stroke();}});});
  (opts.lines||[]).forEach(function(l){l.rings.forEach(function(r){if(r.length<2)return;ctx.beginPath();r.forEach(function(c,i){var x=X(c[0]),y=Y(c[1]);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.strokeStyle=l.color||'#888';ctx.lineWidth=l.w||2;ctx.setLineDash(l.dash?[7,6]:[]);ctx.stroke();ctx.setLineDash([]);});});
  (opts.points||[]).forEach(function(pt){ctx.globalAlpha=pt.alpha!=null?pt.alpha:0.85;ctx.beginPath();ctx.arc(X(pt.lon),Y(pt.lat),pt.r||2.5,0,6.2832);ctx.fillStyle=pt.color||'#1f6feb';ctx.fill();ctx.globalAlpha=1;});
  if(opts.title){ctx.fillStyle='#16202c';ctx.font='600 16px Arial, sans-serif';ctx.fillText(opts.title,pad,20);}
  var a=document.createElement('a');a.href=cv.toDataURL('image/png');a.download=(opts.filename||'map')+'.png';document.body.appendChild(a);a.click();a.remove();toast('Map downloaded');
}catch(e){toast('Could not export map');}}
function downloadMapImage(){try{var key=_mapState.key,vs=D.npa.map(function(r){return npaVal(r,key);}).filter(isNum),lo=quantile(vs,0.05),hi=quantile(vs,0.95);
  var polys=((window.NPAS&&window.NPAS.features)||[]).map(function(f){var row=NPA_BY_ID[f.properties.id],v=row?npaVal(row,key):null,t=isNum(v)?(v-lo)/((hi-lo)||1):null;if(_mapState.rev&&t!=null)t=1-t;return {rings:_geomRings(f.geometry),fill:t==null?'#eef0f4':colorScale(Math.max(0,Math.min(1,t))),stroke:'#dfe3ea',w:0.5};});
  var lines=(_mapState.lines&&window.LINESG)?window.LINESG.features.map(function(f){var ln=(f.properties.line||'').toLowerCase();return {rings:_geomRings(f.geometry),color:LINEHEX[ln]||'#444',w:2.5,dash:!!f.properties.dash};}):[];
  var points=[];if(_mapState.stations)(window.RED_STATIONS||[]).forEach(function(s){points.push({lon:s.mlon||s.lon,lat:s.mlat||s.lat,color:'#b3203a',r:4});});
  renderMapPNG({polys:polys,lines:lines,points:points,filename:'map_'+(''+key).replace(/[^a-z0-9]+/gi,'_'),title:prettyVar(catLabel(key))});}catch(e){toast('Could not export map');}}
function downloadSurvMap(which){try{if(!window.RL2)return;var model=smModel(),R=window.RL2,rows=which==='red'?R.test:R.train,li=smIdx('lat'),lo=smIdx('lon'),sti=smIdx('status'),mode=_smMapMode||'pred';
  var points=rows.map(function(r){var la=r[li],ln=r[lo];if(!la||!ln)return null;var p=model.prob(r);var col=(which!=='red'&&mode==='actual')?(r[sti]==='Active'?'#127a4b':'rgb(179,32,58)'):rateColor(p);return {lat:la,lon:ln,color:col,r:2.2,alpha:0.7};}).filter(Boolean);
  var lines=window.LINESG?window.LINESG.features.map(function(f){var l=(f.properties.line||'').toLowerCase();return {rings:_geomRings(f.geometry),color:LINEHEX[l]||'#888',w:2,dash:!!f.properties.dash};}):[];
  renderMapPNG({points:points,lines:lines,filename:which==='red'?'red_line_survival_map':'blue_silver_survival_map'});}catch(e){toast('Could not export map');}}
function downloadExMap(){try{var e=exEnsure(),filtered=exFiltered(e._scored),li=smIdx('lat'),lo=smIdx('lon');
  var points=filtered.map(function(o){var la=o.r[li],ln=o.r[lo];if(!la||!ln)return null;return {lat:la,lon:ln,color:rateColor(o.p),r:2.5,alpha:0.8};}).filter(Boolean);
  var lines=window.LINESG?window.LINESG.features.map(function(f){var l=(f.properties.line||'').toLowerCase();return {rings:_geomRings(f.geometry),color:LINEHEX[l]||'#888',w:2,dash:!!f.properties.dash};}):[];
  renderMapPNG({points:points,lines:lines,filename:'red_line_explorer_map'});}catch(e){toast('Could not export map');}}
function downloadDigMap(){try{if(_dig.npa==null)return;var f=npaFeature(_dig.npa),polys=f?[{rings:_geomRings(f.geometry),fill:'rgba(31,111,235,0.08)',stroke:'#1f6feb',w:1.5}]:[],ci=BIZc,points=[];
  BIZ.rows.forEach(function(r){if(r[ci.npa]!==_dig.npa)return;if(_dig.sector!=null&&r[ci.sector]!==_dig.sector)return;points.push({lat:r[ci.lat],lon:r[ci.lon],color:SECTOR_COLORS[r[ci.sector]]||'#888',r:2.6,alpha:0.85});});
  renderMapPNG({polys:polys,points:points,filename:'neighborhood_'+_dig.npa+'_map'});}catch(e){toast('Could not export map');}}

/* ============================================================
 * VIEW MODULES
 * ============================================================ */
/* ---------------- BRIEF ---------------- */
VIEWS.brief=function(){
  const m=document.getElementById('main');
  m.innerHTML=`
  <div class="card">
    <div class="kick">Problem statement</div>
    <h2>Which businesses will survive the Red Line?</h2>
    <p class="lede">Charlotte is planning the LYNX <b style="color:var(--red)">Red Line</b>, a commuter-rail line running north through Huntersville, Cornelius, and Davidson. New transit reshapes the businesses around it: some shops gain customers, while others are priced out or torn down as land values climb. The City wants to know, <b>before the line is built</b>, which local businesses are most likely to stay open and which may close — so it can target outreach and support to the ones that need it most.</p>
  </div>

  <div class="card">
    <div class="kick">Your challenge</div>
    <h3 style="margin-top:2px">What we want you to do</h3>
    <ol style="margin:6px 0 0;padding-left:20px;font-size:14px;color:var(--ink2);line-height:1.7">
      <li><b>Explore the history.</b> Use the City of Charlotte's data to understand how the earlier transit lines (Blue and Silver) changed the businesses and neighborhoods around them.</li>
      <li><b>Build a model.</b> On those already-built corridors, learn what separates a business that stays open from one that closes.</li>
      <li><b>Predict the Red Line.</b> Apply your model to the planned Red Line and find which businesses may need the most support.</li>
      <li><b>Make a recommendation.</b> Tell the City who to prioritize, and why.</li>
    </ol>
    <p class="small mut" style="margin-top:10px">No coding required. Every step is laid out as a checklist in the <b>Tasks</b> tab.</p>
    <div class="okbox" style="margin-top:10px"><b>Your deliverable:</b> present your findings as a slide deck. Build it in <a href="https://docs.google.com/presentation/d/1T5wEt3Wh-vwK5j-QskoAHFabN6Kc-ZhFS4spuLkn7ro/copy" target="_blank" rel="noopener">this presentation template</a> — the link opens your own copy to edit as a team.</div>
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
        <li>What does a business that's likely to close look like in the data? What about one that's likely to stay open?</li>
        <li>Which signals of survival or closure show up at the neighborhood, parcel, and business scale?</li>
        <li>Which data patterns are caused by the train development, which by general city growth, and which by both?</li>
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
    <div class="kick">Your task list</div>
    <h3 style="margin-top:2px">Work through the Tasks tab</h3>
    <p class="small mut">The <b>Tasks</b> tab is your step-by-step checklist — each task sends you to the right tool and asks what you found. The tools are grouped in the sidebar like this:</p>
    <div class="bars" style="margin-top:6px">
      ${[['Investigate — explore the City of Charlotte data (Map, Chart, Correlations, Time machine, Dig in)','map'],
         ['Stage 1 — build the survival model on the Blue + Silver corridors','survival1'],
         ['Stage 2 — apply the model to the planned Red Line and find who needs support','survival3']
       ].map(r=>`<div class="spread" style="padding:7px 0;border-bottom:1px solid var(--line2)">
         <div><b style="font-weight:600">${r[0]}</b></div>
         <button class="btn ghost sm" onclick="go('${r[1]}')">open</button></div>`).join('')}
    </div>
    <button class="btn" style="margin-top:12px" onclick="go('missions')">Open the Tasks list →</button>
  </div>

  <div class="card tight">
    <div class="spread"><div class="small mut">Scope: Mecklenburg County. Learn on the Blue and Silver corridors, then apply to the Red Line.</div>
    <button class="btn" onclick="go('missions')">See your tasks →</button></div>
  </div>`;
  document.getElementById('hypo').oninput=function(){S.hypothesis=this.value;save();};
};

/* ---------------- FIELD GUIDE + DATA DICTIONARY + DQ ---------------- */
function provTag(p){return p==='derived'?'<span class="tag derived">derived</span>':
  p.indexOf('QoL')>=0?'<span class="tag npa">QoL survey</span>':
  p.indexOf('assessor')>=0?'<span class="tag biz">assessor</span>':
  '<span class="tag derived">'+esc(p)+'</span>';}
// Plain-language statistic type + units for every variable (so a new student can read the dictionary and map legends).
const _MEASURE_BY_KEY={
  n_businesses:['Count','businesses in the neighborhood'],
  median_emp:['Median','employees per business'],
  pct_lease:['Percent','% of businesses that rent (not own) their space'],
  pct_small_le9:['Percent','% of businesses with 9 or fewer employees'],
  pct_near_red:['Percent','% of parcels within ½ mile of a planned Red Line station'],
  pct_near_blue:['Percent','% of parcels within ½ mile of a Blue Line station'],
  pct_parcel_underutilized:['Percent','% of parcels flagged underutilized'],
  pct_parcel_out_of_state:['Percent','% of parcels with an out-of-state owner'],
  land_value:['Dollar value','assessed land value, per parcel ($)'],
  total_value:['Dollar value','assessed total value, per parcel ($)'],
  net_building_value:['Dollar value','assessed building value, per parcel ($)'],
  building_to_land:['Ratio','building value ÷ land value'],
  parcel_building_to_land:['Ratio','building value ÷ land value'],
  lot_acres:['Size','lot size (acres)'],
  building_age:['Value','building age (years)'],
  parcel_underutilized:['Flag (0/1)','1 = underutilized parcel'],
  parcel_commercial:['Flag (0/1)','1 = commercial parcel'],
  parcel_out_of_state_owner:['Flag (0/1)','1 = owner mails from outside NC'],
  parcel_recent_sale:['Flag (0/1)','1 = parcel sold recently'],
  sector:['Category','business sector (NAICS group)'],
  leases_building:['Flag (0/1)','1 = business rents its building'],
  employees:['Count','employees at the business'],
  dist_station_mi:['Distance','miles to nearest transit station'],
  nbhd_income:['Median','median household income ($)'],
  nbhd_pct_own:['Percent','% of homes that are owner-occupied'],
  nbhd_rent:['Median','median gross rent ($/month)'],
  '311 REQUESTS':['Rate','311 service calls per 100 residents'],
  'ADOPT A STREAM':['Rate','program participants per 1,000 residents'],
  'ADOPT A STREET':['Rate','program participants per 1,000 residents'],
  'CALLS FOR ANIMAL CARE':['Rate','calls per 1,000 residents'],
  'CALLS FOR DISORDER':['Rate','calls per 1,000 residents'],
  'COMMERCIAL BLDG AGE':['Median','age of commercial buildings (years)'],
  'COMMERCIAL CONST':['Rate','new commercial construction (permitted sq ft per acre)'],
  'EDU LEVEL BACH DEGREE':['Percent','% of adults with a bachelor’s degree'],
  'EDU LEVEL HS DIPLOMA':['Percent','% of adults with at least a high-school diploma'],
  'ENERGY CONS ELECTRICITY':['Average','electricity use per household (kWh)'],
  'ENERGY CONS NATURAL GAS':['Average','natural-gas use per household (therms)'],
  'FOOD AND NUTRITION SVCS':['Percent','% of residents receiving food/nutrition assistance'],
  'HOUSING ASSIST DEVBASED':['Rate','subsidized housing units per 1,000 housing units'],
  'HS GRADUATIONRATE':['Percent','% of students graduating high school on time'],
  'MUNI BOARD PARTICPICIPATION':['Rate','city-board appointees per 1,000 residents'],
  'NBRHOOD ORGANIZATIONS':['Rate','registered neighborhood organizations per 1,000 residents'],
  'NBRHOOD SCHOOL ATTNDCE':['Percent','% of students attending their assigned neighborhood school'],
  'PROX TO A GROCERY STORE':['Percent','% of households within walking distance of a grocery store'],
  'PROX TO A PHARMACY':['Percent','% of households within walking distance of a pharmacy'],
  'PROX TO EARLY CARE':['Percent','% of households within walking distance of early childcare'],
  'PROX TO FINANCIAL SVCS':['Percent','% of households within walking distance of financial services'],
  'PROX TO LOW COST HEALTH':['Percent','% of households within walking distance of low-cost health care'],
  'PROX TO OUTDOOR REC':['Percent','% of households within walking distance of outdoor recreation'],
  'PROX TO PUBLIC TRANSPORTATION':['Percent','% of households within walking distance of transit'],
  'PROX TO SCHOOLAGE CARE':['Percent','% of households within walking distance of school-age care'],
  'RACEETH ALL OTHER RACES':['Percent','% of residents of other races/ethnicities'],
  'RACEETH ASIAN':['Percent','% of residents who are Asian'],
  'RACEETH BLACK':['Percent','% of residents who are Black'],
  'RACEETH HISPANIC':['Percent','% of residents who are Hispanic'],
  'RACEETH WHITE':['Percent','% of residents who are White'],
  'RESIDENTIAL NEW CONST':['Rate','new homes built (permits per 1,000 parcels)'],
  'RESIDENTIAL WASTE':['Average','household waste collected (lbs per household)'],
  'RESIDENTIAL WASTE DIV':['Percent','% of household waste recycled or diverted'],
  'TEST PROF ELEMENTARY':['Percent','% of elementary students proficient on state tests'],
  'TEST PROF HIGH':['Percent','% of high-school students proficient on state tests'],
  'TEST PROF MIDDLE':['Percent','% of middle-school students proficient on state tests'],
  'WATER CONS':['Average','water use per household (gallons)']
};
function _measureFromUnit(u){
  var l=(u||'').toLowerCase();
  if(l==='%')return['Percent','% (share)'];
  if(l.indexOf('median')>=0)return['Median',u];
  if(l.indexOf('avg')>=0||l.indexOf('average')>=0)return['Average',u];
  if(l.indexOf('index')>=0)return['Index',u];
  if(l.indexOf('acre')>=0)return['Density',u];
  if(l.indexOf('/')>=0||l.indexOf(' per ')>=0)return['Rate',u];
  if(l.indexOf('$')>=0)return['Dollar value',u];
  if(l.indexOf('year')>=0)return['Median',u];
  if(l.indexOf('sqft')>=0)return['Average',u];
  return[u?'Measured value':'—',u||'—'];
}
function varMeasure(key){
  var m=_MEASURE_BY_KEY[key];
  if(m)return{stat:m[0],unit:m[1]};
  var c=catByKey[key];var fu=_measureFromUnit(c&&c.unit);
  return{stat:fu[0],unit:fu[1]};
}
const _ABBR=[[/\bRaceeth\b/gi,'Race/ethnicity:'],[/\bEdu\b/gi,'Education'],[/\bHs\b/gi,'High-school'],[/\bProx To\b/gi,'Proximity to'],[/\bSvcs\b/gi,'Services'],[/\bNbrhood\b/gi,'Neighborhood'],[/\bBldg\b/gi,'Building'],[/\bConst\b/gi,'Construction'],[/\bParticpicipation\b/gi,'Participation'],[/\bAttndce\b/gi,'Attendance'],[/\bDevbased\b/gi,'Development-based'],[/\bCons\b/gi,'Consumption'],[/\bDiv\b/gi,'Diversion'],[/\bGraduationrate\b/gi,'Graduation rate'],[/\bRec\b/gi,'Recreation']];
function prettyVar(t){t=t||'';_ABBR.forEach(function(p){t=t.replace(p[0],p[1]);});return t;}
function _statTagClass(s){return 'derived';}

const KEY_VARS=[
  ['dist_station_mi','How close the business sits to a transit station.'],
  ['leases_building','Whether the business rents or owns its space — renters are more exposed.'],
  ['employees','Business size, measured in employees.'],
  ['sector','What kind of business it is (retail, food, finance, and so on).'],
  ['building_to_land','Building value ÷ land value. A low ratio means the land is worth more than what sits on it — ripe for redevelopment.'],
  ['parcel_underutilized','A flag for parcels that look under-built for where they sit.'],
  ['nbhd_income','Median household income of the surrounding neighborhood.'],
  ['nbhd_pct_own','Share of nearby homes that are owner-occupied.']
];
VIEWS.guide=function(){
  const m=document.getElementById('main');
  const cats=Array.from(new Set(D.catalog.map(c=>c.category))).sort();
  const keyVarsHTML=KEY_VARS.map(function(kv){var c=catByKey[kv[0]];if(!c)return '';var mm=varMeasure(kv[0]);
    return '<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--line2)"><span style="color:#e0a400;font-size:15px;line-height:1.4">★</span><div><div style="font-weight:600;font-size:13px">'+esc(prettyVar(c.title))+' <span class="mut" style="font-weight:400">· '+esc(mm.stat)+' · '+esc(mm.unit)+'</span></div><div class="small mut">'+kv[1]+'</div></div></div>';}).join('');
  m.innerHTML=`
  <div class="card">
    <div class="kick">Field guide</div>
    <h2>Field guide &amp; data dictionary</h2>
    <p class="lede">What you are predicting is <b>business survival</b> — whether a business stayed open or closed. Every variable below is a possible <b>input</b> or piece of context for that question. For each one the table tells you <b>what statistic it is</b> (a count, a percentage, a median, a rate, and so on) and <b>its units</b>, so you always know what a number means before you use it.</p>
    <div class="warnbox" style="background:#eef5ff;border-color:#cfe0ff;color:#1b3a6b;margin-top:10px"><b>Facilitator tip (10 min):</b> before anyone builds a model, have each team skim this dictionary and pick three variables they think will predict survival. It is a fast data-check that surfaces misunderstandings early.</div>
    <div class="row" style="margin-top:8px">
      <button class="btn ghost sm" onclick="document.getElementById('keyvars').scrollIntoView({behavior:'smooth'})">★ Key variables</button>
      <button class="btn ghost sm" onclick="document.getElementById('breaks').scrollIntoView({behavior:'smooth'})">Things that will fool you ⚠</button>
    </div>
  </div>

  <div class="card" id="keyvars">
    <div class="kick">Start here</div>
    <h3 style="margin-top:2px">Key variables to explore</h3>
    <p class="small mut">If you only look at a few columns, look at these — they tend to matter most for whether a business survives.</p>
    ${keyVarsHTML}
  </div>

  <div class="card">
    <h3 style="margin-bottom:6px">How to read the numbers</h3>
    <div class="small mut" style="line-height:1.6">
      <b>Indexes are scores, not counts.</b> The City <b>displacement index</b> runs <b>0 to 5</b> (higher = more displacement pressure). A few Quality-of-Life measures run <b>1 to 3</b> (1 = low, 2 = medium, 3 = high). An index of 0 or 1 is the low end of the scale, not a missing value.<br>
      <b>Common abbreviations:</b> NPA = Neighborhood Profile Area · CBP = Census County Business Patterns (the business-count source) · QoL = Quality of Life survey · building-to-land = building value ÷ land value.
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
    <div class="row" style="justify-content:flex-end;margin-bottom:6px">${dlT('dictTable','data_dictionary')}</div>
    <div class="scrollx"><table class="t" id="dictTable"></table></div>
    <div class="small mut" id="dictCount" style="margin-top:6px"></div>
  </div>

  <div class="card" id="breaks">
    <h3>⚠ Things that will fool you</h3>
    <div class="warnbox"><b>Measurement breaks.</b> Business counts come from the Census CBP, whose methodology shifts around <b>2012</b>; building-permit coverage firms up around <b>2016</b>. A jump across those years can be a <i>recording</i> change, not a real-world change. The Time machine shades these years.</div>
    <div class="warnbox"><b>The City displacement index is an input, not the answer.</b> It is a vulnerability score the City built (0 to 5, at the neighborhood level), and it is populated for only <b>${DQ.dispN} of ${DQ.nNpa}</b> neighborhoods. You can feed it to the model as one signal, but the thing you are actually predicting is whether each business survived.</div>
    <div class="warnbox"><b>Watch for circular inputs.</b> The City built its displacement index partly from variables that are also in this table (underutilized parcels, out-of-state owners). Using both the index and its ingredients can make a model look stronger than it really is.</div>
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
      '<thead><tr><th>Variable</th><th>Measure</th><th>What one number means &amp; its units</th><th>Level</th><th>Source</th></tr></thead><tbody>'+
      rows.map(c=>{const mm=varMeasure(c.key);return `<tr><td><b style="font-weight:600">${esc(prettyVar(c.title))}</b><div class="tiny mut">${esc(c.key)}</div></td>`+
        `<td><span class="tag ${_statTagClass(mm.stat)}">${esc(mm.stat)}</span></td>`+
        `<td>${esc(mm.unit)}</td>`+
        `<td><span class="tag ${c.level==='Neighborhood'?'npa':c.level==='Business'?'biz':'derived'}">${esc(c.level)}</span></td>`+
        `<td>${provTag(c.prov)}</td></tr>`;}).join('')+'</tbody>';
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
     <div class="note" style="margin-top:12px"><b>Overall measured:</b> ${DQ.overall}% across these features. <b>City index coverage:</b> the neighborhood displacement index (an optional input) exists for ${DQ.dispN}/${DQ.nNpa} neighborhoods. <b>Stations:</b> ${DQ.stationsRaw} raw → ${DQ.stationsUniq} unique (de-duplicated here).</div>
     <p class="small mut" style="margin-top:10px">Honesty layer: imputed values are filled with the column mean and counted, never hidden. Stage 1 shows the imputation % for every feature you pick.</p>`);
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
// Place the 3 planned Red Line station markers ON the dashed line (their town-centre coords sit ~1.5km off the rail alignment).
function _snapRedStations(){try{
  if(!window.RED_STATIONS||!window.LINESG)return;
  var red=null;window.LINESG.features.forEach(function(f){if(f.properties&&f.properties.line==='red')red=f;});if(!red)return;
  var pts=[];(function flat(a){if(typeof a[0]==='number')pts.push(a);else a.forEach(flat);})(red.geometry.coordinates);
  window.RED_STATIONS.forEach(function(s){var kx=Math.cos(s.lat*Math.PI/180),best=1e18,bp=null;
    pts.forEach(function(p){var dx=(p[0]-s.lon)*kx,dy=(p[1]-s.lat),d=dx*dx+dy*dy;if(d<best){best=d;bp=p;}});
    if(bp){s.mlat=bp[1];s.mlon=bp[0];}});
}catch(e){}}
_snapRedStations();
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
      <button class="btn ghost sm" onclick="downloadMapImage()">⬇ Map (PNG)</button>
      <button class="btn ghost sm" onclick="downloadMapData()">⬇ Map data (CSV)</button>
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
    <div class="card"><div class="spread" style="margin-bottom:8px"><h3 style="margin:0">Highest 12</h3>${dlT('mapTop','highest_neighborhoods')}</div><div class="scrollx" style="max-height:340px"><table class="t" id="mapTop"></table></div></div>
    <div class="card"><div class="spread" style="margin-bottom:8px"><h3 style="margin:0">Lowest 12</h3>${dlT('mapBot','lowest_neighborhoods')}</div><div class="scrollx" style="max-height:340px"><table class="t" id="mapBot"></table></div></div>
  </div>`;
  document.getElementById('mapClip').innerHTML=clipBtn('Map studio',()=>mapClipText(),'Clip this map');
  const map=L.map('mapHost',{scrollWheelZoom:true,zoomControl:true}).setView([35.32,-80.82],10);
  _mapObj=map;
  map.createPane('choro');map.getPane('choro').style.zIndex=350;
  map.createPane('lnpane');map.getPane('lnpane').style.zIndex=450;map.getPane('lnpane').style.pointerEvents='none';
  map.createPane('stpane');map.getPane('stpane').style.zIndex=460;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',{maxZoom:18,attribution:'© OpenStreetMap © CARTO',subdomains:'abcd'}).addTo(map);
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
    const mm=varMeasure(key);
    document.getElementById('mapLegend').innerHTML=
      `<b style="color:var(--ink)">${esc(prettyVar(catLabel(key)))}</b>`+
      `<span class="tag derived" style="margin-left:8px">${esc(mm.stat)}</span>`+
      `<span class="mut" style="margin-left:6px">${esc(mm.unit)}</span>`+
      `<span style="margin-left:14px">${fmt(_mapState.rev?hi:lo)}</span><div class="grad" style="${_mapState.rev?'transform:scaleX(-1)':''}"></div><span>${fmt(_mapState.rev?lo:hi)}</span>`+
      `<span class="mut">· ${vs.length}/${D.npa.length} neighborhoods measured</span>`;
    document.getElementById('mapDesc').innerHTML=`Typical neighborhood (median): <b>${fmt(median(vs))}</b> ${esc(mm.unit)}. Red Line neighborhoods: `+
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
      (window.RED_STATIONS||[]).forEach(s=>L.circleMarker([s.mlat||s.lat,s.mlon||s.lon],{pane:'stpane',radius:6,color:'#111',weight:1.5,fillColor:'#b3203a',fillOpacity:1}).bindTooltip('Planned Red Line station: '+s.name).addTo(stLayer));
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
    `<div style="margin:6px 0;padding:7px 9px;background:#eef5ff;border:1px solid #cfe0ff;border-radius:7px"><div style="font-size:12px;color:#1b3a6b;font-weight:700">${esc(prettyVar(catLabel(key)))}</div><div style="font-size:18px;font-weight:800;color:#16202c;line-height:1.15">${f(key)} <span style="font-size:11px;font-weight:600;color:#5b6675">${esc(varMeasure(key).unit)}</span></div><div style="font-size:10px;color:#7a8694">${esc(varMeasure(key).stat)}</div></div>`+
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
      <label class="fld">Group / colour by <select id="cgrp"></select></label>
      <label class="fld">Chart <select id="ckind"><option value="scatter">scatter + fit line</option><option value="box">box plot (Y by transit line)</option></select></label>
      <span id="chartClip" style="align-self:flex-end"></span>
    </div>
    <div class="row" style="justify-content:flex-end;margin:4px 0 0"><button class="btn ghost sm" onclick="downloadCanvas('csCanvas','chart-studio.png')">⬇ Download PNG</button></div>
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
  document.getElementById('ckind').onchange=function(){_cs.kind=this.value;if(_cs.kind==='box'&&_cs.group==='none'){_cs.group='line';VIEWS.chart();return;}drawCS();};
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
    <p class="small mut">Stack filters to define a group of businesses. Counts, sector mix, and average survival chance update live. Export the set.</p>
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
/* ---------------- TIME MACHINE (rebuilt 2026-06-16) ---------------- */
let _tmChart=null,_tm='homeval';
let _tmOverlay='';
let _tmLines={blue:true,silver:true,gold:true,red:true};
let _tmSector='retail';
const TM_AREA_COLORS=['#1f6feb','#b3203a','#b08a2e','#127a4b','#6b4ea0','#0e8a8a','#c2570c','#6b7280','#d11d6b'];
if(window.Chart&&Chart.defaults){Chart.defaults.font.family="'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";Chart.defaults.font.size=12;Chart.defaults.color='#5b6675';}
const ANNFONT="600 11px "+"'Inter',-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
// Find the x-pixel for an event year on any time-series, even when that exact year is not a tick (interpolates between the two surrounding years; returns null if outside the chart's range).
function _tsEventX(chart,year){var sc=chart.scales.x;if(!sc)return null;var labels=chart.data.labels||[];if(!labels.length)return null;var nums=labels.map(function(l){return parseFloat(String(l).slice(0,4));});for(var i=0;i<labels.length;i++){if(nums[i]===year)return sc.getPixelForValue(labels[i]);}var lo=-1,hi=-1;for(var j=0;j<nums.length;j++){if(isNaN(nums[j]))continue;if(nums[j]<year&&(lo<0||nums[j]>nums[lo]))lo=j;if(nums[j]>year&&(hi<0||nums[j]<nums[hi]))hi=j;}if(lo<0||hi<0)return null;var xlo=sc.getPixelForValue(labels[lo]),xhi=sc.getPixelForValue(labels[hi]);return xlo+(xhi-xlo)*((year-nums[lo])/(nums[hi]-nums[lo]));}
function _tsLabelBox(ctx,text,x,y,color){ctx.font=ANNFONT;var w=ctx.measureText(text).width;ctx.fillStyle='rgba(255,255,255,.86)';ctx.fillRect(x-2,y-9,w+4,12);ctx.fillStyle=color;ctx.fillText(text,x,y);}
// One marker plugin for every time-series chart. Reads chart.options.plugins.tsmarkers.events = [{year,label,kind:'rail'|'break'}].
const tsMarkerPlugin={id:'tsmarkers',afterDatasetsDraw(chart){var cfg=(chart.options.plugins&&chart.options.plugins.tsmarkers)||{};var evs=cfg.events||[];if(!evs.length)return;var ctx=chart.ctx,ca=chart.chartArea;evs.forEach(function(e){var x=_tsEventX(chart,e.year);if(x==null||x<ca.left-1||x>ca.right+1)return;var brk=e.kind==='break';var lcol=brk?'rgba(154,91,0,.5)':'rgba(18,122,75,.5)';var tcol=brk?'rgba(154,91,0,.95)':'rgba(18,122,75,.95)';ctx.save();ctx.strokeStyle=lcol;ctx.setLineDash(brk?[4,4]:[5,3]);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,ca.top);ctx.lineTo(x,ca.bottom);ctx.stroke();ctx.setLineDash([]);var ly=brk?ca.top+11:ca.bottom-6;_tsLabelBox(ctx,e.label,x+4,ly,tcol);ctx.restore();});}};
function _has(x){return x&&typeof x==='object';}
function _cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function _secName(s){return {retail:'retail',realestate:'real estate',finance:'finance',food:'food and hotels'}[s]||s;}
function _missing(name){return {labels:[],ds:[],note:'',error:'Series data ('+name+') is not loaded. Your browser is likely serving a cached data/rl_geo.js. Reload from disk (see the data check in the header).',table:null};}
const TM_SERIES={
  homeval:{label:'Home values (Zillow)',build(){const h=window.HOMEVAL;if(!_has(h))return _missing('HOMEVAL');
    return {labels:h.years,ds:[
      {label:'Red Line towns',data:h.corridor,borderColor:'#b3203a',backgroundColor:'#b3203a18',tension:.25,fill:true},
      {label:'Charlotte city ZIPs',data:h.charlotte,borderColor:'#1f6feb',backgroundColor:'transparent',tension:.25}],
      note:'Typical home value (Zillow ZHVI), annual average by ZIP. Red Line towns (Huntersville, Cornelius, Davidson) against a basket of Charlotte city ZIPs. Corridor values roughly doubled since 2010 and stay well above the city, the clearest displacement-pressure signal in the data. Read at ZIP level, not neighborhood level.',
      fmt:v=>'$'+Math.round(v/1000)+'k',
      table:{head:['Year','Red Line towns','Charlotte ZIPs','Huntersville','Cornelius','Davidson'],rows:h.years.map((y,i)=>[y,'$'+h.corridor[i].toLocaleString(),'$'+h.charlotte[i].toLocaleString(),'$'+h.Huntersville[i].toLocaleString(),'$'+h.Cornelius[i].toLocaleString(),'$'+h.Davidson[i].toLocaleString()])}};}},
  rent:{label:'Rents (Zillow)',build(){const r=window.RENT;if(!_has(r))return _missing('RENT');
    return {labels:r.years,ds:[
      {label:'Red Line towns',data:r.corridor,borderColor:'#b3203a',backgroundColor:'#b3203a18',tension:.25,fill:true},
      {label:'Charlotte city ZIPs',data:r.charlotte,borderColor:'#1f6feb',backgroundColor:'transparent',tension:.25}],
      note:'Typical asking rent (Zillow ZORI), annual average by ZIP. Corridor rents rose about 68 percent since 2015 and pulled ahead of the city after 2020. Rising rents are a leading displacement signal for residents and small commercial tenants.',
      fmt:v=>'$'+v,
      table:{head:['Year','Red Line towns','Charlotte ZIPs'],rows:r.years.map((y,i)=>[y,'$'+r.corridor[i],'$'+r.charlotte[i]])}};}},
  rezone:{label:'Rezoning activity',build(){const z=window.REZONE;if(!_has(z))return _missing('REZONE');
    return {labels:z.years,ds:[{label:'Rezoning petitions approved',data:z.counts,borderColor:'#b08a2e',backgroundColor:'#b08a2e18',tension:.25,fill:true}],
      note:'Rezoning petitions approved per year, City of Charlotte. A proxy for redevelopment pressure. Citywide, not corridor-only, since the north towns zone separately, so treat it as background context.',
      table:{head:['Year','Approved'],rows:z.years.map((y,i)=>[y,z.counts[i]])}};}},
  corridor:{label:'Corridor demolitions & new build',build(){const cy=(D&&D.corridorYearly)||{};const labels=Object.keys(cy).sort();if(!labels.length)return _missing('corridorYearly');
    return {labels,ds:[
      {label:'Demolitions',data:labels.map(y=>cy[y][0]),borderColor:'#b3203a',backgroundColor:'#b3203a22',tension:.25,fill:true},
      {label:'New construction',data:labels.map(y=>cy[y][1]),borderColor:'#1f6feb',backgroundColor:'#1f6feb18',tension:.25,fill:true}],
      note:'Building permits along the built corridors, 1995 to 2024. New construction dwarfs demolition in raw counts, but teardowns are the sharper displacement signal.',
      table:{head:['Year','Demolitions','New construction'],rows:labels.map(y=>[y,cy[y][0],cy[y][1]])}};}},
  teardown:{label:'Teardown rate',build(){const cy=(D&&D.corridorYearly)||{};const labels=Object.keys(cy).sort();if(!labels.length)return _missing('corridorYearly');
    const share=labels.map(y=>{const d=cy[y][0],n=cy[y][1];return (d+n)>0?+(100*d/(d+n)).toFixed(1):null;});
    return {labels,ds:[{label:'Demolition share of permits (%)',data:share,borderColor:'#8b1e3f',backgroundColor:'#8b1e3f18',tension:.25,fill:true}],
      note:'Share of permit activity that is demolition rather than new build. A rising share means existing buildings are being replaced, not just added to.',
      fmt:v=>v+'%',
      table:{head:['Year','Demolition share %'],rows:labels.map((y,i)=>[y,share[i]])}};}},
  mix:{label:'Sector mix shift',build(){const mx=window.MIXSE;if(!_has(mx))return _missing('MIXSE');const labels=mx.years;
    const cfg=[['retail','Retail trade','#b3203a'],['realestate','Real estate','#1f6feb'],['finance','Finance','#b08a2e'],['food','Food service','#127a4b']];
    return {labels,ds:cfg.map(([k,l,c])=>({label:l,data:mx[k],borderColor:c,backgroundColor:'transparent',tension:.25})),
      note:'Share of corridor businesses by sector. Retail trade falls steadily while real estate and food service rise, a replacement signal even when total counts look stable.',
      table:{head:['Year','Retail %','Real estate %','Finance %','Food %'],rows:labels.map((y,i)=>[y,mx.retail[i],mx.realestate[i],mx.finance[i],mx.food[i]])}};}},
  area:{label:'Sector by area',sub:'sectors',build(){const ma=window.MIXALL;if(!_has(ma))return _missing('MIXALL');const labels=ma.years;const sec=_tmSector;const keys=Object.keys(ma.areas);
    return {labels,ds:keys.map((k,i)=>{const a=ma.areas[k];const isRed=(a.label||'').indexOf('Red')>=0;return {label:a.label,data:a[sec],borderColor:TM_AREA_COLORS[i%TM_AREA_COLORS.length],backgroundColor:'transparent',tension:.25,borderDash:isRed?[6,4]:[],borderWidth:2};}),
      note:'Share of '+_secName(sec)+' businesses by corridor area, over time. Red Line areas are dashed. Compare how the sector moved in the built corridors against the Red Line areas.',
      table:{head:['Year',...keys.map(k=>ma.areas[k].label)],rows:labels.map((y,i)=>[y,...keys.map(k=>ma.areas[k][sec][i])])}};}},
  demos:{label:'Demolitions by line',sub:'lines',build(){const d=window.DEMOS;if(!_has(d))return _missing('DEMOS');const labels=d.years;const all=Object.keys(d.lines);const sel=all.filter(ln=>_tmLines[ln]);
    return {labels,ds:sel.map(ln=>({label:_cap(ln),data:d.lines[ln],borderColor:LINEHEX[ln]||'#888',backgroundColor:'transparent',tension:.25})),
      note:'Residential demolition-rate index by corridor, where 1.0 is the countywide baseline. All four corridors climb after the mid-2010s; the Red corridor starts lowest, since it is sparser, newer and owner-occupied.',
      table:{head:['Year',...all.map(_cap)],rows:labels.map((y,i)=>[y,...all.map(ln=>d.lines[ln][i])])}};}},
  sales:{label:'Home-sale volume by line',sub:'lines',build(){const hs=window.HOMESALES;if(!_has(hs))return _missing('HOMESALES');const labels=hs.years;const all=Object.keys(hs.lines);const sel=all.filter(ln=>_tmLines[ln]);
    return {labels,ds:sel.map(ln=>({label:_cap(ln),data:hs.lines[ln],borderColor:LINEHEX[ln]||'#888',backgroundColor:'transparent',tension:.25})),
      note:'Home sales near each corridor. The Red corridor has far more homes, so its raw counts dwarf the others. Rising sales often precede commercial change.',
      table:{head:['Year',...all.map(_cap)],rows:labels.map((y,i)=>[y,...all.map(ln=>hs.lines[ln][i])])}};}}
};
const TM_ORDER=['homeval','rent','rezone','corridor','teardown','mix','area','demos','sales'];
VIEWS.time=function(){
  const m=document.getElementById('main');
  const need=['RLDATA','DEMOS','MIXSE','MIXALL','HOMESALES','HOMEVAL','RENT','REZONE'];
  const miss=need.filter(k=>!window[k]);
  const stamp=miss.length?`<span style="color:var(--warn)">data check: missing ${miss.join(', ')} (rl_geo.js is cached, reload from disk)</span>`:`<span style="color:#127a4b">data check: all ${need.length} series loaded</span>`;
  m.innerHTML=`
  <div class="card">
    <div class="kick" style="color:var(--blue)">Investigate · time machine</div>
    <h2>Change over time</h2>
    <p class="small mut">Track how the Blue and Silver corridors changed over time — the lesson you carry to the Red Line. Pick a variable, then optionally <b>overlay a second one on the right axis</b> to compare two trends at different scales. A year marked <span style="color:var(--warn)">⚠</span> can be a recording change, not a real one. <span style="font-variant:all-small-caps">build tm-2026-06-16</span> · ${stamp}.</p>
    <div class="small mut" style="margin-bottom:4px">Variable (left axis):</div>
    <div class="chips">${TM_ORDER.map(id=>`<span class="chip ${_tm===id?'on':''}" data-tm="${id}">${TM_SERIES[id].label}</span>`).join('')}</div>
    <div id="tmLineChips" class="chips" style="margin-top:0"></div>
    <div id="tmOverlay" class="chips" style="margin-top:0"></div>
    <div class="row" style="justify-content:flex-end;margin:4px 0 0"><button class="btn ghost sm" onclick="downloadCanvas('tmCanvas','time-machine.png')">⬇ Download PNG</button></div>
    <div class="chartwrap" style="height:360px"><canvas id="tmCanvas"></canvas></div>
    <div class="note" id="tmNote"></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px">${dlT('tmTable','time_series_table')}</div>
    <div id="tmTable" style="margin-top:4px;overflow:auto"></div>
    <div id="tmScore" style="margin-top:16px"></div>
    <div style="margin-top:10px" id="tmClip"></div>
  </div>`;
  document.querySelectorAll('[data-tm]').forEach(ch=>ch.onclick=function(){_tm=this.dataset.tm;document.querySelectorAll('[data-tm]').forEach(x=>x.classList.remove('on'));this.classList.add('on');renderTmLineChips();renderTmOverlay();drawTM();});
  renderTmLineChips();renderTmOverlay();
  document.getElementById('tmClip').innerHTML=clipBtn('Time machine',()=>tmClipText(),'Clip this trend');
  drawTM();
  drawTmScore();
};
function renderTmLineChips(){
  const host=document.getElementById('tmLineChips');if(!host)return;
  const sub=(TM_SERIES[_tm]||{}).sub;
  if(sub==='sectors'){const secs=[['retail','Retail'],['realestate','Real estate'],['finance','Finance'],['food','Food & hotels']];
    host.innerHTML='<span class="small mut" style="align-self:center;margin-right:4px">sector:</span>'+secs.map(p=>`<span class="chip ${_tmSector===p[0]?'on':''}" data-ts="${p[0]}">${p[1]}</span>`).join('');
    host.querySelectorAll('[data-ts]').forEach(c=>c.onclick=function(){_tmSector=this.dataset.ts;renderTmLineChips();drawTM();});return;}
  if(sub==='lines'){const src=_tm==='sales'?window.HOMESALES:window.DEMOS;const lines=(src&&src.lines)?Object.keys(src.lines):[];
    host.innerHTML='<span class="small mut" style="align-self:center;margin-right:4px">compare lines:</span>'+lines.map(ln=>`<span class="chip ${_tmLines[ln]?'on':''}" data-tl="${ln}" style="border-color:${LINEHEX[ln]||'#888'}">${_cap(ln)}</span>`).join('');
    host.querySelectorAll('[data-tl]').forEach(c=>c.onclick=function(){_tmLines[this.dataset.tl]=!_tmLines[this.dataset.tl];this.classList.toggle('on');drawTM();});return;}
  host.innerHTML='';
}
function _tmTableHTML(t){
  return '<table style="border-collapse:collapse;font-size:12px;width:100%"><thead><tr>'+
    t.head.map((h,i)=>`<th style="text-align:${i?'right':'left'};padding:5px 8px;border-bottom:1px solid #e5e9f0;color:#5b6675;font-weight:600;white-space:nowrap">${h}</th>`).join('')+
    '</tr></thead><tbody>'+
    t.rows.map(r=>'<tr>'+r.map((c,i)=>`<td style="text-align:${i?'right':'left'};padding:3px 8px;border-bottom:1px solid #f1f4f8;white-space:nowrap">${c==null?'—':c}</td>`).join('')+'</tr>').join('')+
    '</tbody></table>';
}
function renderTmOverlay(){
  const host=document.getElementById('tmOverlay');if(!host)return;
  const opts=['homeval','rent','rezone','corridor','teardown'].filter(id=>id!==_tm);
  host.innerHTML='<span class="small mut" style="align-self:center;margin-right:4px">overlay (right axis):</span>'+
    '<span class="chip '+(!_tmOverlay?'on':'')+'" data-ov="">none</span>'+
    opts.map(id=>'<span class="chip '+(_tmOverlay===id?'on':'')+'" data-ov="'+id+'">'+TM_SERIES[id].label+'</span>').join('');
  host.querySelectorAll('[data-ov]').forEach(c=>c.onclick=function(){_tmOverlay=this.dataset.ov;renderTmOverlay();drawTM();});
}
function drawTM(){
  const def=TM_SERIES[_tm]||TM_SERIES.homeval;
  let b;try{b=def.build();}catch(e){b={labels:[],ds:[],note:'',error:'Build error: '+e.message,table:null};}
  const noteEl=document.getElementById('tmNote'),tableEl=document.getElementById('tmTable');
  if(tableEl)tableEl.innerHTML=b.table?_tmTableHTML(b.table):'';
  if(noteEl)noteEl.innerHTML=b.error?`<span style="color:var(--warn)">${b.error}</span>`:b.note;
  const canvas=document.getElementById('tmCanvas');if(!canvas)return;
  try{var _prev=(window.Chart&&Chart.getChart)?Chart.getChart(canvas):null;if(_prev)_prev.destroy();}catch(e){}
  if(_tmChart){try{_tmChart.destroy();}catch(e){}_tmChart=null;}
  if(b.error||!b.labels.length){const c=canvas.getContext&&canvas.getContext('2d');if(c)c.clearRect(0,0,canvas.width||0,canvas.height||0);return;}
  let labels=b.labels.slice(),datasets=b.ds.map(d=>Object.assign({},d,{yAxisID:'y',spanGaps:true})),y2=null;
  if(_tmOverlay&&_tmOverlay!==_tm&&TM_SERIES[_tmOverlay]){
    let ob;try{ob=TM_SERIES[_tmOverlay].build();}catch(e){ob=null;}
    if(ob&&ob.labels&&ob.ds.length){
      const union=Array.from(new Set(b.labels.concat(ob.labels))).sort();
      const remap=(lbls,data)=>union.map(y=>{const i=lbls.indexOf(y);return i>=0?data[i]:null;});
      labels=union;
      datasets=b.ds.map(d=>Object.assign({},d,{yAxisID:'y',spanGaps:true,data:remap(b.labels,d.data)}));
      const od=ob.ds[0];
      datasets.push(Object.assign({},od,{label:TM_SERIES[_tmOverlay].label+' (right axis →)',yAxisID:'y2',spanGaps:true,borderDash:[5,4],fill:false,backgroundColor:'transparent',borderColor:'#6b4ea0',data:remap(ob.labels,od.data)}));
      y2={position:'right',beginAtZero:false,grid:{drawOnChartArea:false},ticks:ob.fmt?{callback:ob.fmt,color:'#6b4ea0'}:{color:'#6b4ea0'},title:{display:true,text:'right axis → '+TM_SERIES[_tmOverlay].label,color:'#6b4ea0',font:{weight:'600'}}};
      if(noteEl)noteEl.innerHTML=b.note+' <span class="mut"><b style="color:#6b4ea0">Dashed purple line = '+TM_SERIES[_tmOverlay].label+', read on the right-hand axis.</b></span>';
    }
  }
  try{
    const ctx=canvas.getContext('2d');
    const scales={x:{grid:{display:false}},y:{beginAtZero:false,grid:{color:'#eef2f7'},ticks:b.fmt?{callback:b.fmt}:{}}};
    if(y2)scales.y2=y2;
    // Reference overlays on every time series: green = transit milestones, yellow = years to read with caution (see Field guide).
    const _tsEv=[{year:2007,label:'Blue Line opens',kind:'rail'},{year:2018,label:'Blue extension',kind:'rail'},{year:2012,label:'⚠ 2012',kind:'break'},{year:2016,label:'⚠ 2016',kind:'break'}];
    _tmChart=new Chart(ctx,{type:'line',data:{labels,datasets},plugins:[tsMarkerPlugin],
      options:{animation:false,maintainAspectRatio:false,plugins:{legend:{position:'top'},tsmarkers:{events:_tsEv}},scales}});
  }catch(e){if(noteEl)noteEl.innerHTML=`<span style="color:var(--warn)">Chart could not render (${e.message}). The data table below still shows every value.</span>`;}
}
/* ---- Time machine: before -> after scorecard (pick variables) ---- */
const TM_CAT=[
  {k:'sectors',label:'Business sectors',common:true,mode:'pts',items:[
    {sk:'retail',label:'Retail'},
    {sk:'realestate',label:'Real estate'},
    {sk:'finance',label:'Finance'},
    {sk:'food',label:'Food & hotels'}
  ]},
  {k:'activity',label:'Development & sales',common:false,mode:'pct',items:[
    {sk:'demolitions',label:'Teardowns per 1,000 homes'},
    {sk:'homesales',label:'Home sales per 1,000'}
  ]}
];
let _tmCat='sectors',_tmSel={};
TM_CAT.forEach(function(c){c.items.forEach(function(it){it.k=c.k+'_'+it.sk;it.mode=c.mode;_tmSel[it.k]=true;});});
function _fmtBlue(v,mode){if(mode==='pts')return (Math.round(v*10)/10)+'%';if(Math.abs(v)<10)return (Math.round(v*100)/100).toString();return Math.round(v).toLocaleString();}
function blueBA(it){var B=window.BLUE_TS;if(!B||!B.series||!B.series[it.sk])return null;var s=B.series[it.sk];
  var ys=B.years.filter(function(y){return s.vals[y]!=null&&!isNaN(s.vals[y]);});if(ys.length<2)return null;
  var by=ys[0],ly=ys[ys.length-1],bv=s.vals[by],av=s.vals[ly];var delta;
  if(it.mode==='pts'){var d=av-bv;delta=(d>=0?'+':'−')+(Math.round(Math.abs(d)*10)/10)+' pts';}
  else{var p=bv?(av-bv)/Math.abs(bv)*100:0;delta=(p>=0?'+':'−')+Math.abs(Math.round(p))+'%';}
  return {label:it.label,bv:bv,av:av,beforeT:_fmtBlue(bv,it.mode),afterT:_fmtBlue(av,it.mode),years:by+' → '+ly,up:av>=bv,delta:delta};
}
function _tmBar(w,c,val,lab,bold){return '<div style="display:grid;grid-template-columns:42px 1fr 80px;gap:8px;align-items:center;margin:3px 0">'+
  '<span style="font-size:11px;color:#94a3b8">'+lab+'</span>'+
  '<div style="background:#eef2f7;border-radius:5px;height:15px;overflow:hidden"><div style="height:15px;width:'+w+'%;background:'+c+';border-radius:5px"></div></div>'+
  '<span style="font-size:12px;text-align:right;'+(bold?'font-weight:700;color:var(--ink)':'color:#64748b')+'">'+val+'</span></div>';}
function drawTmScore(){var host=document.getElementById('tmScore');if(!host)return;
  var cat=null;TM_CAT.forEach(function(c){if(c.k===_tmCat)cat=c;});if(!cat)cat=TM_CAT[0];
  var catChips=TM_CAT.map(function(c){return '<span class="chip '+(c.k===_tmCat?'on':'')+'" data-tcat="'+c.k+'">'+esc(c.label)+'</span>';}).join('');
  var varChips=cat.items.map(function(it){return '<span class="chip '+(_tmSel[it.k]?'on':'')+'" data-tvar="'+it.k+'">'+esc(it.label)+'</span>';}).join('');
  var data=cat.items.filter(function(it){return _tmSel[it.k];}).map(function(it){return blueBA(it);}).filter(function(r){return r;});
  var smax=0;if(cat.common)data.forEach(function(r){smax=Math.max(smax,r.bv,r.av);});smax=smax*1.05;
  var rows=data.map(function(r){var col=r.up?{bar:'#d99a1c',bg:'#fbeed7',tx:'#7a5410',ar:'▲'}:{bar:'#1f6feb',bg:'#e7f0fd',tx:'#0c447c',ar:'▼'};
    var mx=cat.common?(smax||1):(Math.max(r.bv,r.av)*1.05||1);
    var bw=Math.max(2,Math.round(r.bv/mx*100)),aw=Math.max(2,Math.round(r.av/mx*100));
    return '<div style="padding:12px 0;border-bottom:1px solid var(--line2)">'+
      '<div class="spread" style="margin-bottom:4px"><div style="font-size:13px;font-weight:600;color:var(--ink)">'+esc(r.label)+' <span style="font-weight:400;color:#94a3b8;font-size:11px">'+esc(r.years)+'</span></div>'+
      '<span style="font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px;background:'+col.bg+';color:'+col.tx+'">'+col.ar+' '+r.delta+'</span></div>'+
      _tmBar(bw,'#cbd5e1',r.beforeT,'before',false)+_tmBar(aw,col.bar,r.afterT,'after',true)+
    '</div>';}).join('');
  host.innerHTML='<div class="card" style="margin-top:6px">'+
    '<div class="spread" style="align-items:center"><h3 style="margin:0">Before → after · Blue Line corridor</h3><button class="btn ghost sm" onclick="downloadBeforeAfter()">⬇ CSV</button></div>'+
    '<div class="small mut" style="margin:4px 0 8px">All figures below are for the <b>Blue Line corridor</b> — the line you learn from before predicting the Red Line.</div>'+
    '<div class="small mut" style="margin:8px 0 4px"><b>1 ·</b> Pick a category:</div><div class="chips" style="margin-bottom:8px">'+catChips+'</div>'+
    '<div class="small mut" style="margin:4px 0 4px"><b>2 ·</b> Show which? (pick one or more)</div><div class="chips" style="margin-bottom:10px">'+varChips+'</div>'+
    (cat.common?'<div class="small mut" style="font-size:11px;margin-bottom:8px">Bars share one scale — compare these directly.</div>':'<div class="small mut" style="font-size:11px;margin-bottom:8px">Different units, so each row is scaled to itself.</div>')+
    (rows||'<div class="small mut">Pick at least one above.</div>')+
  '</div>';
  host.querySelectorAll('[data-tcat]').forEach(function(c){c.onclick=function(){_tmCat=this.dataset.tcat;drawTmScore();};});
  host.querySelectorAll('[data-tvar]').forEach(function(c){c.onclick=function(){_tmSel[this.dataset.tvar]=!_tmSel[this.dataset.tvar];drawTmScore();};});
}
function tmClipText(){
  const def=TM_SERIES[_tm]||TM_SERIES.homeval;let b;try{b=def.build();}catch(e){return def.label;}
  return def.label+': '+((b.note||'').replace(/\s+/g,' ').slice(0,200));
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
      <span class="chip ${_dt.which==='surv'?'on':''}" data-w="surv">Survival data (${window.RL2?(RL2.train.length+RL2.test.length).toLocaleString():0})</span>
      <span id="dtLineWrap"></span>
      <input type="text" id="dtSearch" placeholder="filter rows…" style="min-width:160px">
      <button class="btn sec sm" id="dtCsv">Export view (CSV)</button>
    </div>
    <div class="small mut" id="dtCount" style="margin:6px 0"></div>
    <div class="scrollx"><table class="t" id="dtTable"></table></div>
    <div class="small mut" style="margin-top:6px">Click a column header to sort. Showing up to 500 rows; export gives the full filtered set.</div>
  </div>`;
  document.querySelectorAll('[data-w]').forEach(ch=>ch.onclick=function(){_dt.which=this.dataset.w;_dt.sort=null;VIEWS.table();});
  document.getElementById('dtLineWrap').innerHTML=(_dt.which==='biz'||_dt.which==='surv')?
    `<label class="fld">Line <select id="dtLine"><option value="">all</option><option value="Blue">Blue</option><option value="Silver">Silver</option><option value="Red">Red</option></select></label>`:'';
  if(_dt.which==='biz'||_dt.which==='surv'){document.getElementById('dtLine').value=_dt.line;document.getElementById('dtLine').onchange=function(){_dt.line=this.value;drawDT();};}
  document.getElementById('dtSearch').value=_dt.q;
  document.getElementById('dtSearch').oninput=function(){_dt.q=this.value.toLowerCase();drawDT();};
  document.getElementById('dtCsv').onclick=()=>{const {cols,rows}=dtData();download((_dt.which)+'_table.csv',[cols.join(',')].concat(rows.map(r=>r.map(c=>typeof c==='string'&&c.indexOf(',')>=0?'"'+c+'"':c).join(','))).join('\n'));toast('CSV downloaded');};
  drawDT();
};
function dtData(){
  if(_dt.which==='surv'){
    const R=window.RL2;if(!R)return {cols:['RL2 not loaded'],rows:[]};
    const cols=['business_id','line','sector','npa'].concat(R.inputs.map(d=>d.key));
    const ci=cols.map(c=>R.cols.indexOf(c)),li=R.cols.indexOf('line');
    let rows=R.train.concat(R.test).filter(r=>!_dt.line||r[li]===_dt.line).map(r=>ci.map(i=>r[i]));
    if(_dt.q)rows=rows.filter(r=>r.join(' ').toLowerCase().indexOf(_dt.q)>=0);
    return {cols,rows};
  }
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
    <p class="small mut">Pick the signals you think predict displacement. The lab fits a rule on <b>${TRAIN_FIT.length.toLocaleString()}</b> Blue and Silver businesses, then checks it on <b>${TRAIN_HOLD.length.toLocaleString()}</b> it never saw. The gap between those two scores is the point.</p>
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
      <div class="coefval" style="color:${col}">${word} ${up?'raises':'lowers'} the displacement score${c.imp>=40?` <span class="mut">(${c.imp}% filled in)</span>`:''}</div></div>`;}).join('');
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
   q:'The brief warns the Red Line is wealthier. Is that true, and does "wealthier" mean local shops are more likely to survive?',
   steps:['In Chart studio (Neighborhood level), plot <b>income</b> (X) vs <b>residential demolitions</b> (Y). Color by "Red Line vs rest".',
     'Switch to the "Carry to the Red Line" view and read the Blue/Silver/Red comparison table.',
     'Clip the comparison.'],
   tool:'chart',
   checks:['Name three concrete ways the Red corridor differs from the Blue. For each, say whether it makes local businesses <i>more likely to survive</i>, <i>more likely to close</i>, or <i>just different</i>.']},
  {id:'m3',t:'Where is the land turning over?',time:'30 min',phase:1,
   q:'Displacement starts with land. Where is the building worth little next to the dirt it sits on?',
   steps:['Map studio: shade by <b>% parcels underutilized</b> and <b>% out-of-state owners</b>.',
     'Chart studio (Neighborhood): plot <b>% underutilized</b> vs <b>demolitions</b>. Is the signal real?',
     'Both of these are ingredients the City used to build its own index. Hold that thought for Stage 1, where the index is just one optional input.'],
   tool:'map',
   checks:['Where is redevelopment pressure highest? Does it line up with the train, or with something else (downtown, the river, the airport)?']},
  {id:'m4',t:'What happened to retail?',time:'30 min',phase:1,
   q:'A corridor can keep the same number of businesses while completely changing who they are. Look for replacement, not just shrinkage.',
   steps:['Time machine → "Sector mix shift". Watch retail vs real estate vs food service.',
     'Mind the ⚠2012/2016 recording breaks before you call a jump "real".',
     'Time machine → Sector by area: watch retail in South End against the Red Line areas.'],
   tool:'time',
   checks:['Who is being replaced by whom along the built corridors? What evidence separates a real shift from a measurement artefact?']},
  {id:'m5',t:'Does more always mean better?',time:'25 min',phase:1,
   q:'A model with more inputs usually scores higher on the data it trained on. Is it actually better on new businesses?',
   steps:['Open Stage 1 (Build the model). Start with a few plain inputs such as distance, land value and owns building. Note the Red-Line accuracy and AUC.',
     'Add more inputs, including the City displacement score. Watch training accuracy against the held-out Red-Line accuracy.',
     'Decide whether each added input helps on the Red Line, or just fits the Blue and Silver businesses better.'],
   tool:'survival1',
   checks:['Which inputs raised Red-Line accuracy, and which only raised training accuracy? Why is the held-out number the honest one?']},
  {id:'m6',t:'Does "near a station" even matter?',time:'25 min',phase:1,
   q:'The premise is that proximity to the train changes a business’s odds. Test it instead of assuming it.',
   steps:['In Stage 1, include <b>distance to station</b> and read its coefficient: does being closer raise or lower survival?',
     'Compare it against a stronger signal such as owning the building.',
     'Remember distance is measured to the nearest station on the business’s own line.'],
   tool:'survival1',
   checks:['Does proximity actually move survival in this data? How big is it next to the strongest factor, and could a third factor explain it?']},
  {id:'m7',t:'Build and defend your survival model',time:'40 min',phase:1,
   q:'Commit to a set of inputs that predicts which businesses stay active.',
   steps:['In Stage 1, choose the inputs you trust and read the coefficient chart: which factors raise survival, which lower it?',
     'Aim for high Red-Line accuracy and AUC, but keep a version you can explain, not just the highest number.',
     'Your model is ready to read on the map.'],
   tool:'survival1',
   checks:['State your model in one sentence. What is its Red-Line accuracy versus the baseline, and which inputs did you trust most?']},
  {id:'m8',t:'Read it on the Red Line',time:'35 min',phase:2,
   q:'Your model learned on Blue and Silver. Where does it expect survivors and businesses likely to close on the Red Line, and is it right?',
   steps:['In Stage 2, look at the two maps and toggle <b>predicted</b> versus <b>actual</b> survival.',
     'Find neighborhoods where the model is confident, and where it is wrong.',
     'Clip the result and note the Red-Line accuracy.'],
   tool:'survival3',
   checks:['Where does the model transfer well to the Red Line, and where does it miss? What might explain the misses?']},
  {id:'m9',t:'Argue against yourself',time:'20 min',phase:2,
   q:'The strongest analyst states the best case <i>against</i> their own conclusion.',
   steps:['Revisit your shortlist and your model. Find the evidence that complicates your story.',
     'In the answer box below, write the case for who is affected and how far the model transfers to the Red Line.',
     'It is fully legitimate to conclude the model partly does <i>not</i> transfer to the wealthier Red corridor.'],
   tool:'survival3',
   checks:['What is the single best argument that your story about which businesses close is wrong or overstated? How would you check it with more data?']},
  {id:'m10',t:'Make your case',time:'25 min',phase:2,
   q:'Assemble everything into one defensible recommendation for the City.',
   steps:['In the answer box below, write your recommendation: which Red Line businesses or areas the City should prioritize, and why.',
     'Make sure your shortlist in Stage 2 reflects your top picks; export it (CSV) for your slides.',
     'Build your final presentation in the <a href="https://docs.google.com/presentation/d/1T5wEt3Wh-vwK5j-QskoAHFabN6Kc-ZhFS4spuLkn7ro/copy" target="_blank" rel="noopener">slide template</a> (opens your own copy) and present it.'],
   tool:'survival3',
   checks:['If the City could act on only three of your flagged areas or business types, which three and why?']},
];
VIEWS.missions=function(){
  const m=document.getElementById('main');
  const done=MISSIONS.filter(x=>S.missions[x.id]&&S.missions[x.id].done).length;
  m.innerHTML=`
  <div class="card">
    <div class="kick">Orient · your tasks</div>
    <h2>Tasks</h2>
    <p class="small mut">Each task points you to a tool and asks what you concluded. You are predicting <b>business survival</b>; your answers build your final case. Do them in order or jump around.</p>
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
        <div style="flex:1"><div class="mtitle">${esc(m.t)}</div><div class="mmeta">${m.phase===2?'Part 2 · The Red Line':'Part 1 · Learn from Blue & Silver'}</div></div>
        <div class="small mut">${open?'▾':'▸'}</div>
      </div>
      <div class="mbody">
        <p style="font-size:14px;color:var(--ink2)">${m.q}</p>
        <div style="margin:6px 0">${m.steps.map((s,j)=>`<div class="step"><span class="sn">${j+1}</span><div>${s}</div></div>`).join('')}</div>
        <button class="btn ghost sm" onclick="go('${m.tool}')">Open ${NAV.flatMap(g=>g.items).find(x=>x.id===m.tool).t} →</button>
        <div style="margin-top:12px">${m.checks.map((c,j)=>`<div style="margin-bottom:8px"><div class="small" style="font-weight:600;margin-bottom:4px">${c}</div>
          <textarea data-mc="${m.id}:${j}" placeholder="Your answer…">${esc((st.answers&&st.answers[j])||'')}</textarea></div>`).join('')}</div>
        <button class="btn sm" onclick="completeMission('${m.id}')">${st.done?'✓ Completed (tap to reopen)':'Mark task complete'}</button>
      </div></div>`;
  }).join('');
  document.querySelectorAll('[data-mc]').forEach(t=>t.oninput=function(){const [id,j]=this.dataset.mc.split(':');
    S.missions[id]=S.missions[id]||{answers:{}};S.missions[id].answers=S.missions[id].answers||{};S.missions[id].answers[j]=this.value;save();});
}
function toggleMission(id){S.missions[id]=S.missions[id]||{};S.missions[id].open=!S.missions[id].open;save();drawMissions();}
function completeMission(id){S.missions[id]=S.missions[id]||{};S.missions[id].done=!S.missions[id].done;save();drawMissions();renderRail();toast(S.missions[id].done?'Task complete ✓':'Reopened');}
/* ---------------- FEEDBACK ---------------- */
const FB_APP=[
  ['app_ease','The web app was easy to use'],
  ['app_tools','The tools helped me understand the data'],
  ['app_clear','It was clear what to do at each step'],
  ['app_design','The app looked clean and professional']
];
const FB_EVENT=[
  ['ev_overall','My overall experience at the event was good'],
  ['ev_learn','I learned something useful'],
  ['ev_org','The event was well organized'],
  ['ev_recommend','I would recommend this challenge to a friend']
];
function fbSlider(key,label){var v=(S.feedback&&S.feedback[key]!=null)?S.feedback[key]:3;
  return '<div style="margin:12px 0"><div class="spread" style="margin-bottom:3px"><div style="font-size:13px;color:#334155">'+esc(label)+'</div><div style="font-weight:800;font-size:14px;width:26px;text-align:right;color:#1f6feb" id="fbv_'+key+'">'+v+'</div></div>'+
    '<input type="range" min="1" max="5" step="1" value="'+v+'" data-fb="'+key+'" style="width:100%;accent-color:#1f6feb">'+
    '<div class="spread" style="font-size:10px;color:#94a3b8"><span>1 · strongly disagree</span><span>strongly agree · 5</span></div></div>';}
VIEWS.feedback=function(){
  var m=document.getElementById('main');
  m.innerHTML='<div class="card">'+
    '<div class="kick">Wrap up · feedback</div>'+
    '<h2>Tell us what you thought</h2>'+
    '<p class="lede">A few quick ratings and two short questions. It takes about a minute and helps us improve both the tool and the event.</p>'+
  '</div>'+
  '<div class="grid2">'+
    '<div class="card"><h3 style="margin-bottom:4px">About the web app</h3>'+FB_APP.map(function(f){return fbSlider(f[0],f[1]);}).join('')+'</div>'+
    '<div class="card"><h3 style="margin-bottom:4px">About the event</h3>'+FB_EVENT.map(function(f){return fbSlider(f[0],f[1]);}).join('')+'</div>'+
  '</div>'+
  '<div class="card"><h3 style="margin-bottom:6px">In your own words</h3>'+
    '<div class="small mut" style="margin-bottom:3px">What worked well?</div><textarea data-fbq="liked" placeholder="The part I liked most was…" style="min-height:80px">'+esc((S.feedback&&S.feedback.liked)||'')+'</textarea>'+
    '<div class="small mut" style="margin:12px 0 3px">What would you improve?</div><textarea data-fbq="improve" placeholder="One thing that would make this better…" style="min-height:80px">'+esc((S.feedback&&S.feedback.improve)||'')+'</textarea>'+
  '</div>'+
  '<div class="card"><div id="fbStatus"></div><div class="row" style="gap:8px">'+
    '<button class="btn" id="fbSubmitBtn" onclick="fbSubmit()">Submit results &amp; feedback</button>'+
    '<button class="btn sec" onclick="fbDownload()">⬇ Download a copy</button></div>'+
    '<p class="small mut" style="margin-top:8px">Submitting sends your team name, email, key model results (inputs, Red Line accuracy, shortlist size) and these ratings to the organizer ('+ORGANIZER_EMAIL+').'+(SUBMIT_URL?'':' <b>Note:</b> automatic saving is not switched on yet, so use Download and send the file in.')+'</p></div>';
  document.querySelectorAll('[data-fb]').forEach(function(sl){sl.oninput=function(){if(!S.feedback)S.feedback={};S.feedback[this.dataset.fb]=+this.value;var el=document.getElementById('fbv_'+this.dataset.fb);if(el)el.textContent=this.value;save();};});
  document.querySelectorAll('[data-fbq]').forEach(function(t){t.oninput=function(){if(!S.feedback)S.feedback={};S.feedback[this.dataset.fbq]=this.value;save();};});
};
function fbDownload(){var f=S.feedback||{};var rows=[['question','rating (1-5) or answer']];
  if(S.team&&S.team.name)rows.push(['team',S.team.name]);
  FB_APP.concat(FB_EVENT).forEach(function(q){rows.push([q[1],f[q[0]]!=null?f[q[0]]:'']);});
  rows.push(['What worked well?',f.liked||'']);rows.push(['What would you improve?',f.improve||'']);
  var csv=rows.map(function(r){return r.map(function(c){c=''+(c==null?'':c);return (c.indexOf(',')>=0||c.indexOf('"')>=0||c.indexOf('\n')>=0)?'"'+c.replace(/"/g,'""')+'"':c;}).join(',');}).join('\n');
  download('charlotte_feedback.csv',csv);toast('Feedback downloaded');}
function fbMetrics(){var mm=(typeof smResultsModel==='function')?smResultsModel():null;
  var done=(MISSIONS||[]).filter(function(x){return S.missions[x.id]&&S.missions[x.id].done;}).length;
  return {inputs:mm?mm.inputs:[],redAccuracy:mm?mm.redAccuracy:null,baseline:mm?mm.baseline:null,auc:mm?mm.auc:null,
    shortlistCount:(S.shortlist||[]).length,tasksComplete:done+'/'+((MISSIONS||[]).length),hypothesis:S.hypothesis||''};}
function fbPayload(){var f=S.feedback||{};
  return {type:'charlotte_submission',team:(S.team&&S.team.name)||'',email:(S.team&&S.team.email)||'',organizer:ORGANIZER_EMAIL,submittedAt:new Date().toISOString(),
    metrics:fbMetrics(),
    feedback:{app_ease:f.app_ease,app_tools:f.app_tools,app_clear:f.app_clear,app_design:f.app_design,ev_overall:f.ev_overall,ev_learn:f.ev_learn,ev_org:f.ev_org,ev_recommend:f.ev_recommend,liked:f.liked||'',improve:f.improve||''}};}
function fbSubmit(){
  if(!gateOK()){toast('Please sign in with your team first');renderGate();return;}
  var p=fbPayload();var btn=document.getElementById('fbSubmitBtn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  function done(ok){var s=document.getElementById('fbStatus');
    if(s)s.innerHTML=ok?'<div class="okbox">&#10003; Saved. Thanks &mdash; your results and feedback were sent to the organizer.</div>'
      :'<div class="warnbox">Could not reach the server. Use <b>Download a copy</b> below and email it to '+ORGANIZER_EMAIL+'.</div>';
    if(btn){btn.disabled=false;btn.textContent='Submit results & feedback';}S.submitted=Date.now();save();}
  if(!SUBMIT_URL){done(false);return;}
  try{fetch(SUBMIT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(p)}).then(function(){done(true);}).catch(function(){done(false);});}
  catch(err){done(false);}
}
/* ---------------- ARGUMENT BOARD ---------------- */
/* ============================================================
 * FINISH & SUBMIT  (results go to a Google Sheet via Apps Script)
 * ============================================================ */
// Paste your Google Apps Script Web App URL between the quotes to turn on automatic
// submission to your Google Sheet. Leave empty to fall back to a downloadable file.
const ORGANIZER_EMAIL='vgude@elon.edu';
// Paste your Google Apps Script Web App URL between the quotes to save results + feedback to your Google Sheet.
const SUBMIT_URL='https://script.google.com/macros/s/AKfycbzinGHjwmyQWAePss3PJLrVL9uGcqn6MOiwqcn2CYzQ3f5COoAWqH6lQy6qfA9JNEEk/exec';
function smResultsModel(){if(!(window.RL2&&typeof smSelected==='function'&&smSelected().length))return null;
  var mm=smTrain(),te=smMetrics(mm,window.RL2.test);
  return {inputs:smSelected().map(smLabel),redAccuracy:+(te.acc*100).toFixed(1),baseline:+(te.base*100).toFixed(1),auc:+te.auc.toFixed(3)};}
function buildResults(){
  var answers={};(MISSIONS||[]).forEach(function(m){var st=S.missions[m.id];if(st&&st.answers){var a=Object.keys(st.answers).map(function(k){return st.answers[k];}).filter(function(x){return x&&x.trim();});if(a.length)answers[m.t]=a;}});
  var done=(MISSIONS||[]).filter(function(m){return S.missions[m.id]&&S.missions[m.id].done;}).length;
  var shortlist=[];try{var e=exEnsure();var byId={};e._scored.forEach(function(o){byId[o.id]=o;});(S.shortlist||[]).forEach(function(id){var o=byId[id];if(o)shortlist.push({id:id,sector:o.sector,neighborhood:smTown(o.npa),npa:o.npa,survivalPct:Math.round(o.p*100),outlook:exBand(o.p).label});});}catch(err){}
  return {team:(S.team&&S.team.name)||'',email:(S.team&&S.team.email)||'',organizer:ORGANIZER_EMAIL,submittedAt:new Date().toISOString(),
    hypothesis:S.hypothesis||'',conclusion:S.conclusion||'',tasksComplete:done+'/'+((MISSIONS||[]).length),
    model:smResultsModel(),answers:answers,shortlist:shortlist};
}
function downloadResults(){var r=buildResults();var fn=((r.team||'team').replace(/[^a-z0-9]+/gi,'_')||'team')+'_charlotte_results.json';download(fn,JSON.stringify(r,null,2));S.submitted=Date.now();save();toast('Results file downloaded');}
function emailResults(){var r=buildResults();
  var lines=['Team: '+r.team,'Email: '+r.email,'Tasks complete: '+r.tasksComplete];
  if(r.model)lines.push('Survival model: '+r.model.inputs.join(', '),'Red Line accuracy: '+r.model.redAccuracy+'% vs '+r.model.baseline+'% baseline, AUC '+r.model.auc);
  lines.push('Shortlisted businesses: '+(r.shortlist?r.shortlist.length:0),'','Recommendation:',r.conclusion||'(none written)','','(Please attach the results file you downloaded.)');
  var href='mailto:'+encodeURIComponent(ORGANIZER_EMAIL)+'?cc='+encodeURIComponent(r.email||'')+'&subject='+encodeURIComponent('Charlotte Challenge results - '+(r.team||'team'))+'&body='+encodeURIComponent(lines.join('\n'));
  window.location.href=href;}
VIEWS.submit=function(){
  var m=document.getElementById('main');
  var mdl=smResultsModel();
  var done=(MISSIONS||[]).filter(function(x){return S.missions[x.id]&&S.missions[x.id].done;}).length;
  var shortN=(S.shortlist||[]).length;
  m.innerHTML='<div class="card">'+
    '<div class="kick">Finish</div>'+
    '<h2>Finish &amp; submit</h2>'+
    '<p class="lede">Review your work, write a short recommendation, then download your results and email them to the organizer.</p>'+
    '<div class="note" style="margin-top:0"><b>Team:</b> '+esc((S.team&&S.team.name)||'—')+' &middot; '+esc((S.team&&S.team.email)||'')+'</div>'+
  '</div>'+
  '<div class="grid2">'+
    '<div class="card"><h3 style="margin-bottom:8px">Your work so far</h3>'+
      '<div class="note" style="margin-top:0"><b>Tasks complete:</b> '+done+' / '+((MISSIONS||[]).length)+'</div>'+
      (mdl?('<div class="note"><b>Survival model inputs:</b> '+esc(mdl.inputs.join(', '))+'</div>'+
            '<div class="note"><b>Red Line accuracy:</b> '+mdl.redAccuracy+'% vs '+mdl.baseline+'% baseline &middot; AUC '+mdl.auc+'</div>')
           :'<div class="warnbox">No model yet &mdash; build one in Stage 1 before you submit.</div>')+
      '<div class="note"><b>Shortlisted businesses:</b> '+shortN+'</div>'+
    '</div>'+
    '<div class="card"><h3 style="margin-bottom:8px">Your recommendation</h3>'+
      '<p class="small mut" style="margin-top:0">In a few sentences: which Red Line businesses or areas should the City prioritize for support, and why?</p>'+
      '<textarea id="subConc" placeholder="Our analysis suggests…" style="min-height:150px">'+esc(S.conclusion||'')+'</textarea>'+
    '</div>'+
  '</div>'+
  '<div class="card">'+
    '<div class="row" style="gap:8px"><button class="btn" onclick="downloadResults()">&#8595; Download my results file</button>'+
    '<button class="btn sec" onclick="emailResults()">&#9993; Email the organizer</button></div>'+
    '<p class="small mut" style="margin-top:10px">To hand in: download your results file, then email it to <b>'+ORGANIZER_EMAIL+'</b>. The Email button opens your mail app with a summary already written &mdash; just attach the file you downloaded.</p>'+
  '</div>';
  var ta=document.getElementById('subConc');if(ta)ta.oninput=function(){S.conclusion=this.value;save();};
};

/* ============================================================
 * DIG IN — neighborhood deep-dive  (re-added "follow one area all the way down")
 * ============================================================ */
const BIZc={}; if(window.BIZ){BIZ.cols.forEach((c,i)=>BIZc[c]=i);}
const DIG_NPAS=new Set(window.BIZ?BIZ.rows.map(r=>r[BIZc.npa]).filter(n=>n!=null):[]);
const SECTOR_COLORS=['#1f6feb','#b3203a','#b08a2e','#127a4b','#6b4ea0','#0e8a8a','#c2570c','#9aa3af'];
let _dig={line:'',npa:null,sector:null};
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
  const bizAll=biz;
  const presentSec=[...new Set(bizAll.map(r=>r[BIZc.sector]).filter(x=>x!=null))].sort((a,b)=>a-b);
  if(_dig.sector!=null)biz=biz.filter(r=>r[BIZc.sector]===_dig.sector);
  const secChips='<div class="chips" style="margin:0 0 12px"><span class="small mut" style="align-self:center;margin-right:4px">Filter businesses by sector:</span><span class="chip '+(_dig.sector==null?'on':'')+'" data-ds="all">All</span>'+presentSec.map(si=>'<span class="chip '+(_dig.sector===si?'on':'')+'" data-ds="'+si+'">'+esc(SECTORS[si])+'</span>').join('')+'</div>';
  const dispV=npaVal(row,'disp');
  // business composition
  const secCount={};biz.forEach(r=>{const s=r[BIZc.sector];if(s!=null)secCount[s]=(secCount[s]||0)+1;});
  const secRank=Object.keys(secCount).map(s=>({s:+s,n:secCount[s]})).sort((a,b)=>b.n-a.n);
  const emps=biz.map(r=>r[BIZc.emp]).filter(isNum);
  const ages=biz.map(r=>{const y=r[BIZc.yrbuilt];return isNum(y)&&y>1800?CUR-y:null;}).filter(isNum);
  const lands=biz.map(r=>r[BIZc.land]).filter(isNum);
  const small=pct(emps.filter(e=>e<=S.thresholds.small_emp).length,emps.length);
  const dists=biz.map(r=>Math.min(...[r[BIZc.dred],r[BIZc.dblue],r[BIZc.dsilver]].filter(isNum))).filter(isNum);
  // index rank if defined
  let idxBlock='';
  if(S.indexDef&&Object.values(S.indexDef.weights||{}).some(w=>w)){
    const scored=D.npa.filter(r=>npaLineToken(npaVal(r,'npa'))!=='').map(r=>({id:npaVal(r,'npa'),v:npaIndexScore(r)})).filter(x=>isNum(x.v)).sort((a,b)=>b.v-a.v);
    const pos=scored.findIndex(x=>x.id===id);
    idxBlock=pos>=0?`<div class="okbox"><b>Your custom index</b> ranks this neighborhood <b>#${pos+1} of ${scored.length}</b> corridor areas for displacement pressure (score ${scored[pos].v.toFixed(2)}). <span class="mut">Build/adjust it in “Build your own index”.</span></div>`:'';
  } else {
    idxBlock=`<div class="note">Build a weighted index in <b>“Build your own index”</b> and this area will show its rank here.</div>`;
  }
  const tile=(b,l,c)=>statTile(b,l,c);
  document.getElementById('digBody').innerHTML=`
  ${secChips}
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
    <div class="card"><div class="spread" style="margin-bottom:6px"><h3 style="margin:0">On the map</h3><div class="row" style="gap:6px"><button class="btn ghost sm" onclick="downloadDigMap()">⬇ Map (PNG)</button><button class="btn ghost sm" onclick="downloadDigBiz()">⬇ Businesses (CSV)</button></div></div>
      <div class="mapbox" id="digMap" style="height:360px"></div>
      <div class="diglegend">${[...new Set(biz.map(r=>r[BIZc.sector]).filter(x=>x!=null))].sort((a,b)=>a-b).map(si=>'<span class="legitem"><i style="background:'+SECTOR_COLORS[si]+'"></i>'+esc(SECTORS[si])+'</span>').join('')||'<span class="small mut">No businesses mapped in this area.</span>'}</div>
      <div class="small mut" style="margin-top:4px">${biz.length} businesses${_dig.sector!=null?' in '+esc(SECTORS[_dig.sector]):''} inside this neighborhood. Lighter lines are the other neighborhoods.</div></div>
    <div class="card"><h3>Read it at three scales</h3>
      <div style="margin-top:6px"><div class="kick" style="color:var(--blue)">Neighborhood</div>
        <table class="t"><tbody>
          ${digRow(row,'RESIDENTIAL DEMOLITIONS','residential demolitions')}
          ${digRow(row,'RESIDENTIAL NEW CONST','residential new construction')}
          ${digRow(row,'RESIDENTIAL FORECLOSURES','foreclosures')}
          ${digRow(row,'EDU LEVEL BACH DEGREE','bachelor degree %')}
          ${digRow(row,'RACEETH WHITE','% white')}
        </tbody></table></div>
      <div style="margin-top:10px"><div class="kick" style="color:var(--blue)">Land / parcels <span class="tiny mut">(whole neighborhood)</span></div>
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
          <tr><td>median building age</td><td>${ages.length?fmt(median(ages))+' yrs':'—'}</td></tr>
          <tr><td>median land value</td><td>${lands.length?fmt$(median(lands)):'—'}</td></tr>
        </tbody></table></div>
    </div>
  </div>`;
  // map
  if(_digMap){try{_digMap.remove();}catch(e){}_digMap=null;}
  const dm=L.map('digMap',{scrollWheelZoom:true}).setView([npaVal(row,'lat'),npaVal(row,'lon')],13);
  _mapObj=dm;_digMap=dm;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',{maxZoom:18,subdomains:'abcd',attribution:'© OSM © CARTO'}).addTo(dm);
  L.geoJSON(window.NPAS,{interactive:false,style:{color:'#cfd6e0',weight:.7,fill:false}}).addTo(dm);
  if(feat){const gj=L.geoJSON(feat,{style:{color:red?'#b3203a':'#1f6feb',weight:2.4,fill:true,fillColor:red?'#b3203a':'#1f6feb',fillOpacity:.07}}).addTo(dm);try{dm.fitBounds(gj.getBounds(),{maxZoom:14,padding:[24,24]});}catch(e){}}
  if(window.LINESG)L.geoJSON(window.LINESG,{style:f=>{const ln=(f.properties.line||'').toLowerCase();return{color:LINEHEX[ln]||'#444',weight:3.5,opacity:.9,dashArray:f.properties.dash?'7,6':null};}}).addTo(dm);
  biz.forEach(r=>{const la=r[BIZc.lat],lo=r[BIZc.lon];if(!isNum(la)||!isNum(lo))return;const s=r[BIZc.sector];
    L.circleMarker([la,lo],{radius:3.5,color:'#fff',weight:.6,fillColor:SECTOR_COLORS[s]||'#888',fillOpacity:.85}).bindTooltip(SECTORS[s]||'business').addTo(dm);});
  ST_UNIQ.forEach(s=>{L.circleMarker([s[1],s[0]],{radius:4,color:'#111',weight:1,fillColor:LINEHEX[(s[3]||'').toLowerCase()]||'#333',fillOpacity:1}).bindTooltip(s[2]||'').addTo(dm);});
  (window.RED_STATIONS||[]).forEach(s=>L.circleMarker([s.mlat||s.lat,s.mlon||s.lon],{radius:5,color:'#111',weight:1.2,fillColor:'#b3203a',fillOpacity:1}).bindTooltip('Planned Red Line station: '+s.name).addTo(dm));
  setTimeout(()=>dm.invalidateSize(),60);
  document.querySelectorAll('#digBody [data-ds]').forEach(c=>c.onclick=function(){_dig.sector=this.dataset.ds==='all'?null:+this.dataset.ds;drawDig();});
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
    <p class="small mut">Choose the neighborhood signals you think predict closures, then weight each one: negative lowers the score, positive raises it. The index is standardized on the Blue and Silver corridors and can be carried to the <b style="color:var(--red)">Red Line</b>.</p>
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
    <div class="legend"><span>lower</span><div class="grad"></div><span>higher pressure</span><span class="mut">· click an area to see its score</span></div>
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
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',{maxZoom:18,subdomains:'abcd',attribution:'© OSM © CARTO'}).addTo(map);
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
let _corr={level:'biz',vars:null,line:''};
function corrRows(){if(_corr.level==='surv'){let rs=window.RL2?RL2.train.concat(RL2.test):[];if(_corr.line){const li=RL2.cols.indexOf('line');rs=rs.filter(r=>r[li]===_corr.line);}return rs;}let rows=_corr.level==='biz'?ALLBIZ:D.npa;if(_corr.line){if(_corr.level==='biz')rows=rows.filter(r=>bzVal(r,'line')===_corr.line);else{const ln=_corr.line.toLowerCase();rows=rows.filter(r=>npaLineToken(npaVal(r,'npa')).split(';').indexOf(ln)>=0);}}return rows;}
function corrVal(r,k){if(_corr.level==='surv')return r[RL2.cols.indexOf(k)];return _corr.level==='biz'?bzVal(r,k):npaVal(r,k);}
function corrVarList(){
  if(_corr.level==='surv') return window.RL2?['survival'].concat(RL2.inputs.map(d=>d.key)):[];
  if(_corr.level==='biz') return BIZ_NUM;
  return D.catalog.filter(c=>c.level==='Neighborhood'&&(c.key in NPAI)&&c.key!=='npa'&&NPA_COV[c.key]>=COV_MIN).map(c=>c.key);
}
function corrDefault(){
  if(_corr.level==='surv') return ['survival','displacement_score','own_building','dist_station_mi','land_value','building_age'];
  return _corr.level==='biz'
    ? ['dist_station_mi','employees','land_value','building_to_land','building_age','nbhd_income','nbhd_rent']
    : ['HOUSEHOLD INCOME','HOME OWNERSHIP','RENTAL COSTS','RESIDENTIAL DEMOLITIONS','RESIDENTIAL NEW CONST','HOUSING AGE','RESIDENTIAL FORECLOSURES'];
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
      <select id="corrLine" aria-label="Filter by line" style="margin-left:auto"><option value="">All corridors</option><option value="Blue">Blue</option><option value="Silver">Silver</option><option value="Red">Red</option></select>
    </div>
    <div class="small mut" style="margin:4px 0">Variables (${_corr.vars.length} chosen, up to 14):</div>
    <div class="chips" id="corrPick" style="max-height:120px;overflow:auto"></div>
  </div>
  <div class="card">
    <div class="row" style="justify-content:flex-end;margin-bottom:6px">${dlT('corrMatrix','correlations')}</div>
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
function corrOpen(xk,yk){if(_corr.level==='surv'){toast('These are survival-model inputs — open the Survival model to explore them');return;}_cs.level=_corr.level;_cs.x=xk;_cs.y=yk;_cs.group='none';_cs.kind='scatter';go('chart');}
function corrClipText(){
  const rows=corrRows(),vars=_corr.vars;
  const tgt=_corr.level==='surv'?'survival':(_corr.level==='biz'?'displacement_index':'disp');
  if(vars.indexOf(tgt)<0)return `Correlations among ${vars.length} ${_corr.level==='biz'?'business':'neighborhood'} measures.`;
  const tcol=rows.map(r=>corrVal(r,tgt));
  let best=null;vars.forEach(k=>{if(k===tgt)return;const r=pearson(tcol,rows.map(rr=>corrVal(rr,k)));if(r!=null&&(best==null||Math.abs(r)>Math.abs(best.r)))best={k,r};});
  return best?`Strongest link to the outcome (${_corr.level} level): ${catLabel(best.k)}, r=${best.r.toFixed(2)} (${rWord(best.r)}).`:`Correlations among ${vars.length} measures.`;
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
  _reg.x=_reg.x.filter(k=>vars.indexOf(k)>=0&&k!==_reg.y&&k!=='disp'&&k!=='displacement_index');
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
  xh.innerHTML=vars.filter(k=>k!==_reg.y&&k!=='disp'&&k!=='displacement_index').map(k=>`<span class="chip ${_reg.x.includes(k)?'on':''}" data-x="${esc(k)}">${esc(catLabel(k))}</span>`).join('');
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



/* ============================================================
 * PRESENT YOUR FINDINGS — pitch structure for the judges
 * ============================================================ */
VIEWS.present=function(){
  const m=document.getElementById('main');
  const w=(S.indexDef&&S.indexDef.weights)||{};
  const sel=Object.keys(w).filter(k=>w[k]).sort((a,b)=>Math.abs(w[b])-Math.abs(w[a]));
  const weightsTxt=sel.length?sel.map(k=>esc(catLabel(k))+' ('+(w[k]>0?'+':'')+w[k]+')').join(', '):'<i>none yet — build one in Build your own index</i>';
  const sim=S.similarity||{};
  const simTxt=['income','ownership','demolitions'].map(d=>d[0].toUpperCase()+d.slice(1)+': '+(sim[d]||'—')).join('  ·  ');
  const adapted=sel.filter(k=>S.adapt&&isNum(S.adapt[k])&&S.adapt[k]<1).map(k=>esc(catLabel(k))).join(', ');
  const sec=(n,title,bullets,links)=>`<div class="card"><h3>${n}. ${title}</h3><div class="small mut" style="margin-bottom:6px">Show the judges:</div>`+
    bullets.map(b=>`<div class="step"><span class="sn">•</span><div>${b}</div></div>`).join('')+
    (links?`<div class="row" style="margin-top:8px">${links.map(l=>`<button class="btn ghost sm" onclick="go('${l[1]}')">${l[0]} →</button>`).join('')}</div>`:'')+`</div>`;
  m.innerHTML=`
  <div class="card">
    <div class="kick">Conclude · present your findings</div>
    <h2>Present your findings</h2>
    <p class="lede">A structure for your pitch to the City judges. Go in order; each section says what to show and where to find it in this tool.</p>
  </div>
  ${sec(1,'Your model',[
    'Your final index: the factors you kept and their weights.',
    'Whether it agrees with the City score on the Blue and Silver lines (cite your rank agreement and average miss).',
    'Why each top factor matters: back it with a Correlations cell or a specific Chart studio plot, do not just assert it.'],
    [['Build your own index','index'],['Correlations','corr'],['Chart studio','chart']])}
  ${sec(2,'How it carries to the Red Line',[
    'How your index ranks the Red Line neighborhoods (your priority list).',
    'Your similarity verdict on income, ownership, and demolitions, and which factors you down-weighted for the Red corridor.',
    'The permit reality check: did your top areas actually see teardowns afterward?'],
    [['Carry to the Red Line','red']])}
  ${sec(3,'Limitations',[
    'The displacement score is set at the neighborhood level, so your claims are about areas and business types, not single shops.',
    'Some fields are missing and filled with averages, and correlation is not cause.',
    'The Red Line is wealthier and mostly owner-occupied, so the rule may not transfer cleanly.'],null)}
  ${sec(4,'Outside insight & research',[
    'What outside data or local knowledge did you add, and how does it change the picture?',
    'One concrete next step or recommendation the City could act on first.'],
    [['Put it all together','argument']])}
  <div class="card">
    <h3>Your work so far</h3>
    <div class="note" style="margin-top:0"><b>Index weights:</b> ${weightsTxt}</div>
    ${S.indexBestMae!=null?`<div class="note"><b>Best match to the City score:</b> average miss ${S.indexBestMae.toFixed(2)} points (0 to 5 scale).</div>`:''}
    <div class="note"><b>Red Line similarity verdict:</b> ${simTxt}${adapted?` · down-weighted for Red: ${adapted}`:''}</div>
    <div class="row" style="margin-top:10px"><button class="btn" onclick="go('survival3')">Go to Stage 2 · Apply to the Red Line →</button></div>
  </div>`;
};


ICON.survival=ICON.model;ICON.survival1=ICON.model;ICON.survival2=ICON.model;ICON.survival3=ICON.model;
/* ===================== SURVIVAL MODEL (Business Status) ===================== */
let _smChart=null;
var _smNpa={};
(function(){try{if(window.NPAS&&NPAS.features)NPAS.features.forEach(f=>{_smNpa[f.properties.id]=f.properties;});}catch(e){}})();
var _sectorSurv={};(function(){try{var R=window.RL2;if(!R)return;var di=R.cols.indexOf('sic_div'),yi=R.cols.indexOf('survival'),agg={};R.train.forEach(function(r){var d=r[di];if(d==null)return;if(!agg[d])agg[d]=[0,0];agg[d][0]+=r[yi];agg[d][1]++;});Object.keys(agg).forEach(function(d){_sectorSurv[d]=agg[d][1]?agg[d][0]/agg[d][1]:null;});}catch(e){}})();
function smCols(){return window.RL2?window.RL2.cols:[];}
function smIdx(k){return smCols().indexOf(k);}
function _bizFmt(k){if(['land_value','total_value','net_building_value','tax_change'].indexOf(k)>=0)return 'money';if(k==='own_building')return 'frac';if(k==='tax_pct_change')return 'pctfrac';if(k==='dist_station_mi')return 'mi';if(k==='building_age')return 'yr';if(k==='displacement_score')return 'disp';if(k==='employees')return 'int';return 'num';}
const SM_CAT=(function(){
  var biz=(window.RL2&&window.RL2.inputs?window.RL2.inputs:[]).map(d=>({k:d.key,label:d.label,src:'biz',cat:'Business & parcel',fmt:_bizFmt(d.key)}));biz.push({k:'sector_surv',label:'Sector survival rate (SIC)',src:'sector',cat:'Business & parcel',fmt:'pctfrac'});
  function N(k,label,fmt,cat){return {k:k,label:label,src:'npa',cat:cat,fmt:fmt};}
  var demo=[N('age_of_residents','Median age','num'),N('population_youth','Youth share','pct'),N('population_older','Older-adult share','pct'),N('raceeth_black','Black residents','pct'),N('raceeth_hispanic','Hispanic residents','pct'),N('white','White residents','pct'),N('raceeth_asian','Asian residents','pct')].map(d=>(d.cat='Demographics',d));
  var soc=[N('income','Median household income','money'),N('college','Bachelor’s degree','pct'),N('edu_level_hs_dip','High-school diploma','pct'),N('employ','Employment rate','pct'),N('job_density','Job density','num'),N('food_and_nutriti','Food & nutrition aid','num'),N('public_health_in','Public health insurance','pct')].map(d=>(d.cat='Socioeconomic',d));
  var hou=[N('own','Homeownership','pct'),N('rent','Median rent','money'),N('price','Median home price','money'),N('housing_age','Housing age','num'),N('housing_density','Housing density','num'),N('vacant_land','Vacant land','pct'),N('foreclose','Foreclosures','num'),N('demo','Residential demolitions','num'),N('newc','New construction','num'),N('single_family_ho','Single-family housing','pct'),N('rental_houses','Rental houses','pct'),N('residential_occu','Residential occupancy','pct')].map(d=>(d.cat='Housing & land',d));
  var ctx=[N('crime','Violent crime','num'),N('crime_property','Property crime','num'),N('tree_canopy','Tree canopy','pct'),N('impervious_surfa','Impervious surface','pct'),N('commercial_space','Commercial space','num')].map(d=>(d.cat='Neighborhood context',d));
  return biz.concat(demo,soc,hou,ctx);
})();
const SM_BYK={};SM_CAT.forEach(d=>SM_BYK[d.k]=d);
const SM_CATS=['Business & parcel','Demographics','Socioeconomic','Housing & land','Neighborhood context'];
function smLabel(k){return SM_BYK[k]?SM_BYK[k].label:k;}
function smFmt(k,v){if(v==null||isNaN(v))return '—';var f=(SM_BYK[k]||{}).fmt;
  if(f==='money')return '$'+Math.round(v).toLocaleString();
  if(f==='pct')return v.toFixed(1)+'%';
  if(f==='pctfrac')return (v*100).toFixed(0)+'%';
  if(f==='frac')return Math.round(v*100)+'%';
  if(f==='mi')return v.toFixed(2)+' mi';
  if(f==='yr')return Math.round(v)+' yr';
  if(f==='int')return Math.round(v).toLocaleString();
  if(f==='disp')return v.toFixed(2);
  return (Math.abs(v)>=1000?Math.round(v).toLocaleString():v.toFixed(2));}
const SM={inputs:{}};
(function(){SM_CAT.forEach(d=>{SM.inputs[d.k]=false;});})();
function smSelFrom(obj){return SM_CAT.filter(d=>obj&&obj[d.k]).map(d=>d.k);}
function smSelected(){return smSelFrom(SM.inputs);}
function smActiveSel(){return smSelected();}
function smModel(){var m=smTrain(smSelected());if(!m)return m;var mult=SM.mod2||{};var any=m.keys.some(function(k){return mult[k]!=null&&mult[k]!==1;});if(!any)return m;var sw=m.w.map(function(wj,j){var f=mult[m.keys[j]];return wj*(f==null?1:f);});var sig=function(z){return 1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));};var mm={keys:m.keys,w:sw,b:m.b,means:m.means,sd:m.sd,std:m.std};mm.prob=function(r){var x=m.std(r);var z=mm.b;for(var j=0;j<sw.length;j++)z+=sw[j]*x[j];return sig(z);};mm.contribs=function(r){var x=m.std(r);return mm.keys.map(function(k,j){return {key:k,raw:smVal(r,k),c:sw[j]*x[j]};});};return mm;}
var _npaIc=null;function npaIdx(){if(_npaIc==null)_npaIc=smIdx('npa');return _npaIc;}
var _bizIdxCache={};
function smVal(r,k){var d=SM_BYK[k];if(!d)return null;
  if(d.src==='biz'){var i=_bizIdxCache[k];if(i==null){i=smIdx(k);_bizIdxCache[k]=i;}return i<0?null:r[i];}
  if(d.src==='sector'){var dv=r[smIdx('sic_div')];return (dv!=null&&_sectorSurv[dv]!=null)?_sectorSurv[dv]:null;}
  var p=_smNpa[r[npaIdx()]];if(!p)return null;var v=p[k];return (v==null||v==='')?null:+v;}
function smTrain(selKeys){
  var R=window.RL2,keys=selKeys||smSelected();if(!keys.length)return null;
  var yi=smIdx('survival'),tr=R.train,p=keys.length;
  var means=Array(p).fill(0),cnt=Array(p).fill(0);
  tr.forEach(r=>keys.forEach((k,j)=>{var v=smVal(r,k);if(v!=null&&!isNaN(v)){means[j]+=v;cnt[j]++;}}));
  for(var j=0;j<p;j++)means[j]=cnt[j]?means[j]/cnt[j]:0;
  var vr=Array(p).fill(0);
  tr.forEach(r=>keys.forEach((k,j)=>{var v=smVal(r,k);v=(v==null||isNaN(v))?means[j]:v;vr[j]+=(v-means[j])*(v-means[j]);}));
  var sd=vr.map((v,j)=>Math.sqrt(v/tr.length)||1);
  function std(r){return keys.map(function(k,j){var v=smVal(r,k);v=(v==null||isNaN(v))?means[j]:v;return (v-means[j])/(sd[j]||1);});}
  var sig=z=>1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));
  var w=Array(p).fill(0),b=0,lr=0.3,X=tr.map(std),y=tr.map(r=>r[yi]),N=X.length;
  for(var ep=0;ep<250;ep++){
    var gw=Array(p).fill(0),gb=0;
    for(var n=0;n<N;n++){var z=b,xn=X[n];for(var j2=0;j2<p;j2++)z+=w[j2]*xn[j2];var e=sig(z)-y[n];for(var j3=0;j3<p;j3++)gw[j3]+=e*xn[j3];gb+=e;}
    for(var j4=0;j4<p;j4++)w[j4]-=lr*(gw[j4]/N+0.001*w[j4]);b-=lr*gb/N;
  }
  var model={keys:keys,w:w,b:b,means:means,sd:sd};
  model.std=std;
  model.prob=function(r){return sig(b+std(r).reduce((s,v,j)=>s+w[j]*v,0));};
  model.contribs=function(r){return keys.map(function(k,j){var raw=smVal(r,k);var val=(raw==null||isNaN(raw))?means[j]:raw;var z=(val-means[j])/(sd[j]||1);return {key:k,raw:raw,c:w[j]*z};});};
  return model;
}
function smMetrics(model,rows){
  var yi=smIdx('survival'),correct=0,sc=[],ys=[];
  rows.forEach(r=>{var p=model.prob(r);sc.push(p);ys.push(r[yi]);if((p>=0.5?1:0)===r[yi])correct++;});
  var pos=[],neg=[];sc.forEach((s,i)=>(ys[i]?pos:neg).push(s));
  var auc=0;if(pos.length&&neg.length){var c=0;pos.forEach(pp=>neg.forEach(nn=>c+=pp>nn?1:(pp===nn?0.5:0)));auc=c/(pos.length*neg.length);}
  var rate=ys.reduce((a,b)=>a+b,0)/ys.length;
  return {acc:correct/rows.length,auc:auc,base:Math.max(rate,1-rate),rate:rate,n:rows.length};
}
function drawSMCoef(model){
  if(_smChart){try{_smChart.destroy();}catch(e){}_smChart=null;}
  var cv=document.getElementById('smCoef');if(!cv)return;
  try{var prev=(window.Chart&&Chart.getChart)?Chart.getChart(cv):null;if(prev)prev.destroy();}catch(e){}
  var pairs=model.keys.map((k,j)=>[smLabel(k),model.w[j]]).sort((a,b)=>a[1]-b[1]);
  try{
    _smChart=new Chart(cv.getContext('2d'),{type:'bar',data:{labels:pairs.map(p=>p[0]),datasets:[{data:pairs.map(p=>p[1]),backgroundColor:pairs.map(p=>p[1]>=0?'#127a4b':'#b3203a')}]},
      options:{indexAxis:'y',animation:false,maintainAspectRatio:false,plugins:{legend:{display:false}},
        scales:{x:{grid:{color:'#eef2f7'},title:{display:true,text:'← lowers survival     raises survival →'}},y:{grid:{display:false}}}}});
  }catch(e){var nt=document.getElementById('smNote');if(nt)nt.innerHTML='<span style="color:var(--warn)">Chart error: '+e.message+'</span>';}
}
function smTableHTML(model){
  var si=smIdx('sector'),di=smIdx('displacement_score'),bi=smIdx('business_id');
  var scored=window.RL2.test.map(r=>({r:r,p:model.prob(r)})).sort((a,b)=>b.p-a.p);
  var top=scored.slice(0,8),bot=scored.slice(-8).reverse();
  function rowsHtml(list){return list.map(o=>{var r=o.r;
    return '<tr><td style="padding:3px 8px;border-bottom:1px solid #f1f4f8">'+r[bi]+'</td>'+
      '<td style="padding:3px 8px;border-bottom:1px solid #f1f4f8">'+esc(r[si])+'</td>'+
      '<td style="text-align:right;padding:3px 8px;border-bottom:1px solid #f1f4f8">'+(r[di]==null?'—':r[di])+'</td>'+
      '<td style="text-align:right;padding:3px 8px;border-bottom:1px solid #f1f4f8"><b>'+(o.p*100).toFixed(0)+'%</b></td></tr>';}).join('');}
  var head='<thead><tr>'+['Business','Sector','Disp. score','Pred. survival'].map((h,i)=>'<th style="text-align:'+(i>=2?'right':'left')+';padding:5px 8px;border-bottom:1px solid #e5e9f0;color:#5b6675;font-weight:600;white-space:nowrap">'+h+'</th>').join('')+'</tr></thead>';
  return '<table style="border-collapse:collapse;font-size:12px;width:100%">'+head+'<tbody>'+
    '<tr><td colspan="4" style="padding:5px 8px;background:#f4faf6;color:#127a4b;font-weight:600">Most likely to survive</td></tr>'+rowsHtml(top)+
    '<tr><td colspan="4" style="padding:5px 8px;background:#fcf3f5;color:#b3203a;font-weight:600">Least likely to survive</td></tr>'+rowsHtml(bot)+
    '</tbody></table>';
}
function smNoteText(model,teM){
  var pairs=model.keys.map((k,j)=>[k,model.w[j]]).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  var top=pairs.slice(0,3).map(p=>smLabel(p[0])+' ('+(p[1]>=0?'+':'')+p[1].toFixed(2)+')').join(', ');
  var lift=((teM.acc-teM.base)*100).toFixed(1);
  return 'On the held-out Red Line, the model is right '+(teM.acc*100).toFixed(1)+'% of the time, '+lift+' points above the '+(teM.base*100).toFixed(1)+'% majority-guess baseline (AUC '+teM.auc.toFixed(3)+'). Strongest signals: '+top+'. A positive weight means the factor raises the chance a business stays active.';
}
function smClipText(model,teM,trM){
  return 'Survival model (target = Business Status). Red Line accuracy '+(teM.acc*100).toFixed(1)+'% vs '+(teM.base*100).toFixed(1)+'% baseline, AUC '+teM.auc.toFixed(3)+'. Inputs: '+model.keys.map(smLabel).join(', ')+'.';
}
function _kpi(label,value,sub){return '<div style="background:#f7f9fc;border:1px solid #e5e9f0;border-radius:10px;padding:10px 12px"><div style="font-size:11px;color:#5b6675;text-transform:uppercase;letter-spacing:.04em">'+label+'</div><div style="font-size:24px;font-weight:700;color:#16202c;line-height:1.1;margin-top:2px">'+value+'</div><div style="font-size:11px;color:#7a8694;margin-top:2px">'+sub+'</div></div>';}
let _smMapMode='pred';
var _smMaps=[];
const _smTown={};
(function(){try{if(window.RLDATA&&RLDATA.npa&&RLDATA.npaCols){var ci=RLDATA.npaCols.indexOf('npa'),ti=RLDATA.npaCols.indexOf('town');if(ti>=0)RLDATA.npa.forEach(r=>{_smTown[r[ci]]=r[ti];});}}catch(e){}})();
function smTown(id){return _smTown[id]||('NPA '+id);}
function rateColor(v){if(v==null||isNaN(v))return '#cdd5df';v=Math.max(0,Math.min(1,v));return _grad(v);}
function _grad(v){var a,b,t;if(v<0.5){a=[179,32,58];b=[242,201,76];t=v/0.5;}else{a=[242,201,76];b=[18,122,75];t=(v-0.5)/0.5;}var c=a.map(function(x,i){return Math.round(x+(b[i]-x)*t);});return 'rgb('+c[0]+','+c[1]+','+c[2]+')';}
function _rateColorOld(v){if(v==null||isNaN(v))return '#cdd5df';v=Math.max(0,Math.min(1,v));
  var a,b,t;if(v<0.5){a=[179,32,58];b=[232,195,58];t=v/0.5;}else{a=[232,195,58];b=[18,122,75];t=(v-0.5)/0.5;}
  var c=a.map((x,i)=>Math.round(x+(b[i]-x)*t));return 'rgb('+c[0]+','+c[1]+','+c[2]+')';}
function smNpaAgg(rows,model){
  var npaI=smIdx('npa'),yi=smIdx('survival'),li=smIdx('line'),o={};
  rows.forEach(r=>{var n=r[npaI];if(n==null)return;if(!o[n])o[n]={cnt:0,surv:0,pred:0,line:r[li]};o[n].cnt++;o[n].surv+=r[yi];o[n].pred+=model.prob(r);});
  Object.keys(o).forEach(n=>{o[n].surv/=o[n].cnt;o[n].pred/=o[n].cnt;});
  return o;
}
function makeSurvMap(divId,agg,mode,onpick){
  var el=document.getElementById(divId);if(!el||!window.L||!window.NPAS)return null;
  var map;try{map=L.map(divId,{zoomControl:false,attributionControl:false});}catch(e){return null;}
  try{L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:18}).addTo(map);}catch(e){}
  var feats=window.NPAS.features.filter(f=>agg[f.properties.id]);
  if(!feats.length){map.setView([35.35,-80.8],10);return map;}
  var layer=L.geoJSON({type:'FeatureCollection',features:feats},{
    style:f=>{var a=agg[f.properties.id];var v=mode==='actual'?a.surv:a.pred;return {color:'#fff',weight:1,fillColor:rateColor(v),fillOpacity:.8};},
    onEachFeature:(f,lyr)=>{var a=agg[f.properties.id];var v=mode==='actual'?a.surv:a.pred;lyr.bindTooltip(smTown(f.properties.id)+': '+(mode==='actual'?'actual':'predicted')+' survival '+Math.round(v*100)+'% (n='+a.cnt+')');if(onpick)lyr.on('click',function(){onpick(f.properties.id);});}
  }).addTo(map);
  try{map.fitBounds(layer.getBounds(),{padding:[8,8]});}catch(e){map.setView([35.35,-80.8],10);}
  return map;
}
function smNpaTable(agg,mode,hideActual){
  var rows=Object.keys(agg).map(k=>({id:+k,cnt:agg[k].cnt,surv:agg[k].surv,pred:agg[k].pred})).sort((a,b)=>(mode==='actual'&&!hideActual?b.surv-a.surv:b.pred-a.pred));
  var cols=hideActual?['Neighborhood','n','Pred']:['Neighborhood','n','Pred','Actual'];
  var head='<tr>'+cols.map((h,i)=>'<th style="text-align:'+(i?'right':'left')+';padding:3px 6px;border-bottom:1px solid #e5e9f0;color:#5b6675;font-weight:600;position:sticky;top:0;background:#fff">'+h+'</th>').join('')+'</tr>';
  return '<table style="border-collapse:collapse;font-size:11px;width:100%">'+head+rows.map(r=>'<tr>'+
    '<td style="padding:2px 6px;border-bottom:1px solid #f4f6f9;white-space:nowrap">'+esc(smTown(r.id))+'</td>'+
    '<td style="text-align:right;padding:2px 6px;border-bottom:1px solid #f4f6f9">'+r.cnt+'</td>'+
    '<td style="text-align:right;padding:2px 6px;border-bottom:1px solid #f4f6f9;font-weight:600;color:'+rateColor(r.pred)+'">'+Math.round(r.pred*100)+'%</td>'+
    (hideActual?'':'<td style="text-align:right;padding:2px 6px;border-bottom:1px solid #f4f6f9;color:'+rateColor(r.surv)+'">'+Math.round(r.surv*100)+'%</td>')+'</tr>').join('')+'</table>';
}
function drawRailLines(map){try{if(!window.LINESG||!window.L)return;L.geoJSON(window.LINESG,{style:function(f){var ln=f.properties.line,planned=(ln==='red');return {color:LINEHEX[ln]||'#888',weight:planned?4:3,opacity:.8,dashArray:(f.properties.dash||planned)?'7,6':null};}}).addTo(map);if(window.RED_STATIONS)window.RED_STATIONS.forEach(function(st){L.circleMarker([st.mlat||st.lat,st.mlon||st.lon],{radius:5,color:'#fff',weight:2,fillColor:'#b3203a',fillOpacity:1}).bindTooltip('Planned Red Line station: '+st.name).addTo(map);});}catch(e){}}
function makeBizMap(divId,scored,mode,onpick){
  var el=document.getElementById(divId);if(!el||!window.L)return null;
  var map;try{map=L.map(divId,{center:[35.42,-80.83],zoom:11,zoomControl:false,attributionControl:false,preferredCanvas:true});}catch(e){return null;}
  try{L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:18}).addTo(map);}catch(e){}
  if(divId==='smMapRed')drawRailLines(map);
  var li=smIdx('lat'),lo=smIdx('lon'),sti=smIdx('status'),npaI=smIdx('npa'),bi=smIdx('business_id'),sec=smIdx('sector');
  var interactive=scored.length<=4000,bounds=[];
  scored.forEach(function(o){var la=o.r[li],ln=o.r[lo];if(!la||!ln)return;
    var col=mode==='actual'?(o.r[sti]==='Active'?'#127a4b':'rgb(179,32,58)'):rateColor(o.p);
    var cm=L.circleMarker([la,ln],{radius:3,stroke:false,fillColor:col,fillOpacity:.65});
    if(interactive){cm.bindTooltip(o.r[bi]+' · '+esc(o.r[sec])+' · '+(mode==='actual'?o.r[sti]:'pred '+Math.round(o.p*100)+'% survive'));if(onpick)cm.on('click',function(){onpick(o.r[npaI]);});}
    cm.addTo(map);bounds.push([la,ln]);});
  try{map.invalidateSize();}catch(e){}
  if(bounds.length){try{map.fitBounds(bounds,{padding:[12,12]});}catch(e){}}
  return map;
}
function drawSurvMaps(model){
  try{(_smMaps||[]).forEach(mp=>{try{mp.remove();}catch(e){}});}catch(e){}
  _smMaps=[];
  var R=window.RL2,mode=_smMapMode||'pred';
  var scoredT=R.train.map(r=>({r:r,p:model.prob(r)})),scoredR=R.test.map(r=>({r:r,p:model.prob(r)}));
  requestAnimationFrame(function(){var mt=makeBizMap('smMapTrain',scoredT,mode);if(mt)_smMaps.push(mt);var mr=makeBizMap('smMapRed',scoredR,'pred');if(mr)_smMaps.push(mr);});
  var lg=document.getElementById('smMapLegend');if(lg)lg.innerHTML='<b>Metric:</b> '+(document.getElementById('smMapTrain')&&mode==='actual'?'each business’s <b>actual status</b> — <span style="color:#127a4b">■</span> Active (stayed open), <span style="color:rgb(179,32,58)">■</span> Deleted (closed).':'<b>predicted chance a business stays Active</b>, on a 0–100% scale — <span style="color:rgb(179,32,58)">■</span> low (likely to close) → <span style="color:rgb(18,122,75)">■</span> high (likely to stay open).')+' Each dot is one business, placed within its neighborhood.';
  var tt=document.getElementById('smTblTrain');if(tt)tt.innerHTML=smNpaTable(smNpaAgg(R.train,model),mode,false);
  var trd=document.getElementById('smTblRed');if(trd)trd.innerHTML=smNpaTable(smNpaAgg(R.test,model),'pred',true);
}
function smCoefNote(model){
  var pairs=model.keys.map((k,j)=>[k,model.w[j]]).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  var top=pairs.slice(0,3).map(p=>smLabel(p[0])+' ('+(p[1]>=0?'+':'')+p[1].toFixed(2)+')').join(', ');
  return 'Strongest signals: '+top+'. A positive weight raises the chance a business stays active; negative lowers it. Explore these pairwise in Correlations (business level).';
}
VIEWS.survival1=function(){
  var m=document.getElementById('main');
  if(!window.RL2){m.innerHTML='<div class="card"><h2>Stage 1</h2><p class="note">Business dataset not loaded (window.RL2 missing). Reload from disk.</p></div>';return;}
  var R=window.RL2,sel=smSelected();
  var model=sel.length?smTrain():null,trM=model?smMetrics(model,R.train):null;
  var chips=SM_CATS.map(function(cat){var items=SM_CAT.filter(d=>d.cat===cat);if(!items.length)return '';return '<div class="small mut" style="margin:10px 0 2px;font-weight:600;color:#334155">'+cat+'</div><div class="chips" style="margin:0">'+items.map(d=>'<span class="chip '+(SM.inputs[d.k]?'on':'')+'" data-si="'+d.k+'" title="'+esc(d.label)+'">'+esc(d.label)+(d.k==='displacement_score'?' ★':'')+'</span>').join('')+'</div>';}).join('');
  m.innerHTML='<div class="card">'+
    '<div class="kick" style="color:var(--blue)">Survival model · Stage 1 of 2</div>'+
    '<h2>Stage 1 · Build the survival model</h2>'+
    '<p class="small mut">Learn what predicts whether a business stays <b>Active</b>, using the built corridors only: <b>Blue + Silver</b> ('+R.train.length.toLocaleString()+' businesses). Pick inputs and read which ones matter. The City <b>displacement score ★</b> is just one input you can include or drop. The honest test comes in Stage 2 on the Red Line.</p>'+
    '<div class="small mut" style="margin:8px 0 4px">Pick inputs (the model retrains instantly):</div>'+
    chips+
    (model?(
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0">'+
        _kpi('Blue+Silver accuracy',(trM.acc*100).toFixed(1)+'%','in-sample fit')+
        _kpi('Blue+Silver AUC',trM.auc.toFixed(3),'0.5 = coin flip')+
        _kpi('Inputs used',sel.length,'of '+SM_CAT.length)+
      '</div>'+
      '<div class="small mut" style="margin-bottom:4px">How each input pushes survival (standardized weight):</div>'+
      '<div class="row" style="justify-content:flex-end;margin:4px 0 0"><button class="btn ghost sm" onclick="downloadCanvas(\'smCoef\',\'stage1-factors.png\')">⬇ Download PNG</button></div>'+
      '<div class="chartwrap" style="height:'+Math.max(140,sel.length*26+50)+'px"><canvas id="smCoef"></canvas></div>'+
      '<div class="note" id="smNote" style="margin-top:12px"></div>'+
      '<div style="margin-top:18px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>Blue + Silver neighborhoods</b><span class="chip" data-mm="pred">Predicted survival</span><span class="chip" data-mm="actual">Actual survival</span><button class="btn ghost sm" style="margin-left:auto" onclick="downloadSurvMap(\'train\')">⬇ Map (PNG)</button></div>'+
      '<div style="margin-top:8px"><div id="smMapTrain" style="height:560px;border:1px solid #e5e9f0;border-radius:10px;background:#eef2f7"></div><div id="smMapLegend" class="small mut" style="margin-top:6px"></div><div class="row" style="justify-content:flex-end;margin-top:8px">'+dlT('smTblTrain','blue_silver_neighborhoods')+'</div><div id="smTblTrain" style="margin-top:4px;max-height:220px;overflow:auto"></div></div>'+
      '<div style="margin-top:12px" id="smClip"></div>'+
      '<div class="row" style="margin-top:12px"><button class="btn" onclick="go(\'survival3\')">Stage 2 · Apply to the Red Line →</button></div>'
    ):'<div class="note" style="margin-top:14px">Select at least one input to train the model.</div>')+
  '</div>';
  document.querySelectorAll('[data-si]').forEach(c=>c.onclick=function(){SM.inputs[this.dataset.si]=!SM.inputs[this.dataset.si];VIEWS.survival1();});
  if(model){drawSMCoef(model);drawSurvMaps(model);
    document.querySelectorAll('[data-mm]').forEach(c=>{c.classList.toggle('on',(_smMapMode||'pred')===c.dataset.mm);c.onclick=function(){_smMapMode=this.dataset.mm;document.querySelectorAll('[data-mm]').forEach(x=>x.classList.toggle('on',x.dataset.mm===_smMapMode));drawSurvMaps(model);};});
    var nt=document.getElementById('smNote');if(nt)nt.innerHTML=smCoefNote(model);
    var cl=document.getElementById('smClip');if(cl)cl.innerHTML=clipBtn('Survival model stage 1',()=>('Stage 1 (Blue+Silver): inputs '+sel.map(smLabel).join(', ')+'. In-sample accuracy '+(trM.acc*100).toFixed(1)+'%, AUC '+trM.auc.toFixed(3)+'.'),'Clip stage 1');
  }
};
VIEWS.survival2=function(){go('survival3');};
function smResetMod2(){SM.mod2={};VIEWS_survival3();}
VIEWS.survival=function(){go('survival1');};
/* ===================== RED LINE PREDICTION EXPLORER ===================== */
let _ex={npa:'',biz:'',sector:'',band:'',sort:'survlow',q:'',shortOnly:false,adjOpen:false};var _exFocus=0;var EX={};
var _exMap=null;
const _exProps={};
(function(){try{if(window.NPAS&&NPAS.features)NPAS.features.forEach(f=>{_exProps[f.properties.id]=f.properties;});}catch(e){}})();
const EX_DEMOG=[
  ['income','Median household income','money'],
  ['own','Homeownership','pct'],
  ['rent','Median rent','money'],
  ['price','Median home-sale price','money'],
  ['raceeth_black','Black residents','pct'],
  ['raceeth_hispanic','Hispanic residents','pct'],
  ['white','White residents','pct'],
  ['college','Adults with a degree','pct'],
  ['age_of_residents','Median age','num']
];
function exFmtDem(kind,v){if(v==null||isNaN(v))return '—';if(kind==='money')return '$'+Math.round(v).toLocaleString();if(kind==='pct')return v.toFixed(1)+'%';return v.toFixed(1);}
function exFmtInput(k,v){if(v==null||isNaN(v))return '—';
  if(['land_value','total_value','net_building_value','tax_change'].indexOf(k)>=0)return '$'+Math.round(v).toLocaleString();
  if(k==='own_building')return Math.round(v*100)+'%';
  if(k==='tax_pct_change')return (v*100).toFixed(0)+'%';
  if(k==='dist_station_mi')return v.toFixed(2)+' mi';
  if(k==='building_age')return Math.round(v)+' yr';
  if(k==='employees')return Math.round(v);
  if(k==='displacement_score')return v.toFixed(2);
  return v.toFixed(2);}
function exMean(rows,idx){var s=0,n=0;rows.forEach(r=>{var v=r[idx];if(v!=null&&!isNaN(v)){s+=v;n++;}});return n?s/n:null;}
function exSd(rows,idx){var m=exMean(rows,idx);if(m==null)return 1;var s=0,n=0;rows.forEach(r=>{var v=r[idx];if(v!=null&&!isNaN(v)){s+=(v-m)*(v-m);n++;}});return n?Math.sqrt(s/n)||1:1;}
function exDemMean(biz,key){var s=0,n=0;biz.forEach(o=>{var p=_exProps[o.r[smIdx('npa')]];if(p&&p[key]!=null&&!isNaN(p[key])){s+=+p[key];n++;}});return n?s/n:null;}
function exSectorMix(biz){var c={},t=0;biz.forEach(o=>{var sec=o.r[smIdx('sector')]||'Unknown';c[sec]=(c[sec]||0)+1;t++;});return Object.keys(c).map(k=>[k,c[k],100*c[k]/t]).sort((a,b)=>b[1]-a[1]);}
function exBand(p){if(p<0.35)return{k:'low',label:'Unlikely to survive',color:_grad(0.12)};if(p<0.5)return{k:'lomid',label:'Leans toward closing',color:_grad(0.38)};if(p<0.65)return{k:'himid',label:'Leans toward surviving',color:_grad(0.6)};return{k:'high',label:'Likely to survive',color:_grad(0.85)};}
function exEnsure(){var sig=smSelected().join(',')+'|'+JSON.stringify(SM.mod2||{});if(EX._sig!==sig||!EX._scored){EX._model=smModel();EX._scored=window.RL2.test.map(function(r){return {r:r,p:EX._model.prob(r),id:r[smIdx('business_id')],sector:r[smIdx('sector')],npa:r[smIdx('npa')]};});EX._sig=sig;}return EX;}
function exFiltered(scored){
  var q=(_ex.q||'').toLowerCase();
  var f=scored.filter(function(o){
    if(_ex.sector&&o.sector!==_ex.sector)return false;
    if(_ex.npa&&String(o.npa)!==String(_ex.npa))return false;
    if(_ex.band&&exBand(o.p).k!==_ex.band)return false;
    if(_ex.shortOnly&&S.shortlist.indexOf(o.id)<0)return false;
    if(q&&!((''+o.id).toLowerCase().indexOf(q)>=0||(''+o.sector).toLowerCase().indexOf(q)>=0||smTown(o.npa).toLowerCase().indexOf(q)>=0))return false;
    return true;});
  f.sort(_ex.sort==='survhigh'?function(a,b){return b.p-a.p;}:_ex.sort==='name'?function(a,b){return (''+a.id<''+b.id)?-1:1;}:function(a,b){return a.p-b.p;});
  return f;
}
function exContribDet(o,model){var r=o.r;return model.keys.map(function(k,j){var raw=smVal(r,k);var val=(raw==null||isNaN(raw))?model.means[j]:raw;var z=(val-model.means[j])/(model.sd[j]||1);return {key:k,raw:raw,z:z,c:model.w[j]*z};});}
function exStripHTML(scored){
  var bands=[['low','Unlikely to survive',_grad(0.12)],['lomid','Leans toward closing',_grad(0.38)],['himid','Leans toward surviving',_grad(0.6)],['high','Likely to survive',_grad(0.85)]];
  var cnt={low:0,lomid:0,himid:0,high:0};scored.forEach(function(o){cnt[exBand(o.p).k]++;});
  return '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0">'+bands.map(function(b){var on=_ex.band===b[0];return '<div data-band="'+b[0]+'" style="cursor:pointer;border:1px solid '+(on?b[2]:'#e5e9f0')+';background:'+(on?b[2]+'14':'#fff')+';border-radius:10px;padding:8px 10px"><div style="font-size:22px;font-weight:800;color:'+b[2]+'">'+cnt[b[0]]+'</div><div style="font-size:11px;color:#5b6675;font-weight:600">'+b[1]+'</div><div style="font-size:10px;color:#94a3b8">'+Math.round(100*cnt[b[0]]/scored.length)+'% of corridor</div></div>';}).join('')+'</div>';
}
function exList(filtered,selId){
  var cap=Math.min(filtered.length,300);
  var rows=filtered.slice(0,cap).map(function(o){var b=exBand(o.p),rc=rateColor(o.p),pct=Math.round(o.p*100),star=S.shortlist.indexOf(o.id)>=0,on=o.id===selId;
    return '<div class="exrow" data-bid="'+o.id+'" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #f1f4f8;cursor:pointer;background:'+(on?'#eef5ff':'#fff')+'">'+
      '<span data-star="'+o.id+'" title="shortlist" style="cursor:pointer;font-size:15px;line-height:1;color:'+(star?'#e0a400':'#cbd5e1')+'">'+(star?'★':'☆')+'</span>'+
      '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+o.id+' <span style="color:#94a3b8;font-weight:400">'+esc(o.sector)+'</span></div><div style="font-size:11px;color:#7a8694">'+esc(smTown(o.npa))+'</div></div>'+
      '<div style="width:84px;text-align:right"><div style="font-weight:700;font-size:13px;color:'+rc+'">'+pct+'%</div><div style="height:5px;border-radius:3px;background:#eef2f7;margin-top:2px;overflow:hidden"><div style="height:5px;width:'+pct+'%;background:'+rc+'"></div></div></div>'+
    '</div>';}).join('');
  return '<div style="font-size:11px;color:#7a8694;padding:6px 8px;border-bottom:1px solid #e5e9f0;background:#f8fafc">Showing '+cap+' of '+filtered.length.toLocaleString()+' · sorted by '+(_ex.sort==='survhigh'?'highest predicted survival rate':_ex.sort==='name'?'business ID':'lowest predicted survival rate')+'</div>'+rows+(filtered.length>cap?'<div style="font-size:11px;color:#94a3b8;padding:8px;text-align:center">Refine filters to see the rest</div>':'');
}
function exDetail(o,model,scored){
  var r=o.r,b=exBand(o.p),pct=Math.round(o.p*100);
  var det=exContribDet(o,model);
  var ups=det.filter(function(c){return c.c>0;}).sort(function(a,b){return b.c-a.c;});
  var downs=det.filter(function(c){return c.c<0;}).sort(function(a,b){return a.c-b.c;});
  function facRow(c){var cmp=c.z>0.4?'higher than typical':c.z<-0.4?'lower than typical':'about typical';var cc=c.z>0.4?'#b45309':c.z<-0.4?'#0369a1':'#94a3b8';
    return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #f4f6f9;font-size:12px"><div>'+esc(smLabel(c.key))+'<div style="font-size:10px;color:'+cc+'">'+cmp+'</div></div><div style="text-align:right;font-weight:600;white-space:nowrap">'+smFmt(c.key,c.raw)+'</div></div>';}
  var avg=scored.reduce(function(s,x){return s+x.p;},0)/scored.length, avgPct=Math.round(avg*100);
  var verdict=b.label;
  var rel=o.p>=avg?('above the Red Line average of '+avgPct+'%'):('below the Red Line average of '+avgPct+'%');
  var p=_exProps[o.npa];
  var snap=p?[['income','Median income','money'],['own','Homeownership','pct'],['rent','Median rent','money'],['college','Degree holders','pct']].map(function(d){return '<span style="display:inline-block;margin:2px 10px 2px 0"><span class="mut">'+d[1]+':</span> <b>'+exFmtDem(d[2],p[d[0]])+'</b></span>';}).join(''):'';
  var inShort=S.shortlist.indexOf(o.id)>=0;
  return '<div style="border:1px solid #e5e9f0;border-radius:12px;padding:16px;background:#fff">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><div><div style="font-size:18px;font-weight:800">'+o.id+'</div><div class="small mut">'+esc(o.sector)+' · '+esc(smTown(o.npa))+' (NPA '+o.npa+')</div></div>'+
    '<div style="text-align:right"><div style="font-size:30px;font-weight:800;color:'+rateColor(o.p)+';line-height:1">'+pct+'%</div><div style="font-size:11px;font-weight:600;color:'+rateColor(o.p)+'">'+b.label+'</div></div></div>'+
    '<div style="height:12px;border-radius:7px;background:linear-gradient(90deg,rgb(179,32,58),rgb(242,201,76),rgb(18,122,75));position:relative;margin:12px 0 6px"><div style="position:absolute;left:calc('+pct+'% - 2px);top:-3px;width:4px;height:18px;background:#16202c;border-radius:2px"></div></div>'+
    '<div class="small mut" style="margin-bottom:10px">Predicted survival rate: <b>'+pct+'%</b> — <b style="color:'+b.color+'">'+verdict+'</b> ('+rel+').</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">'+
      '<div><div style="font-weight:700;color:#127a4b;font-size:13px;margin-bottom:2px">▲ Holding it up</div>'+(ups.length?ups.map(facRow).join(''):'<div class="small mut">nothing notable</div>')+'</div>'+
      '<div><div style="font-weight:700;color:#b3203a;font-size:13px;margin-bottom:2px">▼ Pulling it down</div>'+(downs.length?downs.map(facRow).join(''):'<div class="small mut">nothing notable</div>')+'</div>'+
    '</div>'+
    (snap?'<div style="margin-top:12px;padding-top:10px;border-top:1px solid #f1f4f8;font-size:12px"><span class="mut" style="font-weight:600">Its neighborhood: </span>'+snap+'</div>':'')+
    '<div class="row" style="margin-top:14px;gap:8px">'+
      '<button class="btn '+(inShort?'sec':'')+' sm" onclick="toggleShort(\''+o.id+'\')">'+(inShort?'✓ In shortlist':'★ Add to shortlist')+'</button>'+
      '<button class="btn sec sm" onclick="exCopyBiz(\''+o.id+'\')">Copy summary</button>'+
      clipBtn('Red Line business',function(){return exSummaryText(o,model,scored);},'Clip')+
    '</div>'+
  '</div>';
}
function exSummaryText(o,model,scored){
  var det=exContribDet(o,model);var downs=det.filter(function(c){return c.c<0;}).sort(function(a,b){return a.c-b.c;}).slice(0,3).map(function(c){return smLabel(c.key);});
  var ups=det.filter(function(c){return c.c>0;}).sort(function(a,b){return b.c-a.c;}).slice(0,3).map(function(c){return smLabel(c.key);});
  var pct=Math.round(o.p*100),b=exBand(o.p);
  return o.id+' ('+o.sector+', '+smTown(o.npa)+') — predicted '+pct+'% likely to stay active ['+b.label+']. Pulling it down: '+(downs.join(', ')||'little')+'. Holding it up: '+(ups.join(', ')||'little')+'.';
}
function toggleShort(id){var i=S.shortlist.indexOf(id);if(i>=0)S.shortlist.splice(i,1);else S.shortlist.push(id);save();VIEWS_survival3();}
function exCopyBiz(id){var e=exEnsure();var o=e._scored.find(function(x){return x.id===id;});if(!o)return;var t=exSummaryText(o,e._model,e._scored);try{navigator.clipboard.writeText(t);toast('Summary copied');}catch(err){toast('Copy not available');}}
function exExportShortlist(){if(!S.shortlist.length){toast('Shortlist is empty — star some businesses first');return;}var e=exEnsure();var byId={};e._scored.forEach(function(o){byId[o.id]=o;});var rows=[['business_id','sector','neighborhood','npa','predicted_survival_pct','survival_band','factors_lowering_survival']];S.shortlist.forEach(function(id){var o=byId[id];if(!o)return;var d=exContribDet(o,e._model).filter(function(c){return c.c<0;}).sort(function(a,b){return a.c-b.c;}).slice(0,3).map(function(c){return smLabel(c.key);});rows.push([id,o.sector,smTown(o.npa),o.npa,Math.round(o.p*100),exBand(o.p).label,d.join('; ')]);});var csv=rows.map(function(r){return r.map(function(c){c=''+c;return c.indexOf(',')>=0||c.indexOf('"')>=0?'"'+c.replace(/"/g,'""')+'"':c;}).join(',');}).join('\n');download('red_line_shortlist.csv',csv);toast(S.shortlist.length+' businesses exported');}
function exSelectBiz(id){
  _ex.biz=id;var o=EX._scored?EX._scored.find(function(x){return x.id===id;}):null;
  var dw=document.getElementById('exDetailWrap');if(dw&&o)dw.innerHTML=exDetail(o,EX._model,EX._scored);
  document.querySelectorAll('.exrow').forEach(function(x){x.style.background=x.dataset.bid===id?'#eef5ff':'#fff';});
  if(EX._markers)Object.keys(EX._markers).forEach(function(k){var mk=EX._markers[k];try{mk.setStyle({radius:k===id?7:4,stroke:k===id,color:k===id?'#16202c':'transparent',weight:k===id?2:0,fillOpacity:k===id?0.95:0.6});if(k===id&&mk.bringToFront)mk.bringToFront();}catch(e){}});
}
function exDrawMap(filtered,selId){
  try{if(EX._map){EX._map.remove();EX._map=null;}}catch(e){}
  EX._markers={};
  var el=document.getElementById('exMap');if(!el||!window.L)return;
  var map;try{map=L.map('exMap',{center:[35.42,-80.83],zoom:11,zoomControl:true,attributionControl:false,preferredCanvas:true});}catch(e){return;}
  try{L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:18}).addTo(map);}catch(e){}
  EX._map=map;
  try{var ids={};filtered.forEach(function(o){ids[o.npa]=1;});var feats=(window.NPAS&&NPAS.features?NPAS.features:[]).filter(function(f){return ids[f.properties.id];});
    if(feats.length)L.geoJSON({type:'FeatureCollection',features:feats},{style:function(){return {color:'#94a3b8',weight:1,fill:false,opacity:.6};}}).addTo(map);}catch(e){}
  drawRailLines(map);
  var bounds=[],li=smIdx('lat'),lo=smIdx('lon');
  filtered.slice(0,1500).forEach(function(o){var la=o.r[li],ln=o.r[lo];if(!la||!ln)return;var b=exBand(o.p),isSel=o.id===selId;
    var cm=L.circleMarker([la,ln],{radius:isSel?7:4,stroke:isSel,color:isSel?'#16202c':'transparent',weight:isSel?2:0,fillColor:b.color,fillOpacity:isSel?0.95:0.6});
    cm.bindTooltip(o.id+' · '+esc(o.sector)+' · '+Math.round(o.p*100)+'% survive');
    cm.on('click',function(){exSelectBiz(o.id);});
    cm.addTo(map);EX._markers[o.id]=cm;bounds.push([la,ln]);});
  try{map.invalidateSize();}catch(e){}
  if(bounds.length){try{map.fitBounds(bounds,{padding:[20,20]});}catch(e){}}
}
function exDataTable(filtered,model){
  var keys=model.keys,cap=Math.min(filtered.length,300);
  var head=['Business','Sector','Neighborhood','Predicted survival rate'].concat(keys.map(smLabel));
  var thead='<tr>'+head.map(function(h,i){return '<th style="position:sticky;top:0;background:#fff;text-align:'+(i>=3?'right':'left')+';padding:5px 8px;border-bottom:1px solid #e5e9f0;color:#5b6675;font-weight:600;white-space:nowrap">'+esc(h)+'</th>';}).join('')+'</tr>';
  var rows=filtered.slice(0,cap).map(function(o){var pct=Math.round(o.p*100),col=rateColor(o.p),on=o.id===_ex.biz;
    return '<tr class="exdrow" data-bid="'+o.id+'" style="cursor:pointer;background:'+(on?'#eef5ff':'#fff')+'">'+
      '<td style="padding:3px 8px;border-bottom:1px solid #f4f6f9;font-weight:600">'+o.id+'</td>'+
      '<td style="padding:3px 8px;border-bottom:1px solid #f4f6f9">'+esc(o.sector)+'</td>'+
      '<td style="padding:3px 8px;border-bottom:1px solid #f4f6f9">'+esc(smTown(o.npa))+'</td>'+
      '<td style="padding:3px 8px;border-bottom:1px solid #f4f6f9;text-align:right;font-weight:700;color:#fff;background:'+col+'">'+pct+'%</td>'+
      keys.map(function(k){return '<td style="padding:3px 8px;border-bottom:1px solid #f4f6f9;text-align:right;white-space:nowrap">'+smFmt(k,smVal(o.r,k))+'</td>';}).join('')+
    '</tr>';}).join('');
  return '<div style="overflow:auto;max-height:420px;border:1px solid #e5e9f0;border-radius:11px"><table style="border-collapse:collapse;font-size:11px;width:100%"><thead>'+thead+'</thead><tbody>'+rows+'</tbody></table></div>';
}
function exDownloadTable(){
  var e=exEnsure();var filtered=exFiltered(e._scored);var model=e._model;
  var head=['business_id','sector','neighborhood','npa','predicted_survival_rate_pct'].concat(model.keys.map(smLabel));
  var rows=[head];
  filtered.forEach(function(o){var row=[o.id,o.sector,smTown(o.npa),o.npa,Math.round(o.p*100)];model.keys.forEach(function(k){row.push(smFmt(k,smVal(o.r,k)));});rows.push(row);});
  var csv=rows.map(function(r){return r.map(function(c){c=''+(c==null?'':c);return (c.indexOf(',')>=0||c.indexOf('"')>=0||c.indexOf('\n')>=0)?'"'+c.replace(/"/g,'""')+'"':c;}).join(',');}).join('\n');
  download('red_line_business_data.csv',csv);toast('Business data downloaded ('+filtered.length+' rows)');
}
function VIEWS_survival3(){
  var m=document.getElementById('main');
  if(!window.RL2){m.innerHTML='<div class="card"><h2>Explore the Red Line</h2><p class="note">Business dataset not loaded. Reload from disk.</p></div>';return;}
  if(!S.shortlist)S.shortlist=[];
  if(!smActiveSel().length){m.innerHTML='<div class="card"><div class="kick" style="color:var(--blue)">Survival model · Stage 2 of 2</div><h2>Stage 2 · Apply to the Red Line</h2><div class="warnbox" style="margin-top:10px">No model yet. Build one in <b>Stage 1</b> first.</div><div class="row" style="margin-top:12px"><button class="btn" onclick="go(\'survival1\')">← Go to Stage 1</button></div></div>';return;}
  var e=exEnsure(),scored=e._scored,model=e._model;
  var sectors=Array.from(new Set(scored.map(function(o){return o.sector;}))).sort();
  var npas=Array.from(new Set(scored.map(function(o){return o.npa;}))).sort(function(a,b){return a-b;});
  var filtered=exFiltered(scored);
  var selected=_ex.biz?scored.find(function(o){return o.id===_ex.biz;}):(filtered[0]||null);
  if(selected)_ex.biz=selected.id;
  var _akeys=smSelected(),_ref=smTrain(_akeys);
  var _modPct=Math.round(100*scored.filter(function(o){return o.p>=0.5;}).length/scored.length);
  var _refPct=Math.round(100*window.RL2.test.filter(function(r){return _ref.prob(r)>=0.5;}).length/window.RL2.test.length);
  var _nadj=_akeys.filter(function(k){return SM.mod2&&SM.mod2[k]!=null&&SM.mod2[k]!==1;}).length;
  var _sliders=_akeys.map(function(k){var v=(SM.mod2&&SM.mod2[k]!=null?SM.mod2[k]:1);return '<div style="display:flex;align-items:center;gap:10px;margin:5px 0"><div style="width:210px;font-size:12px;color:#334155">'+esc(smLabel(k))+'</div><input type="range" min="0" max="2" step="0.1" value="'+v+'" data-mw="'+k+'" style="flex:1;accent-color:#1f6feb"><div style="width:42px;text-align:right;font-size:12px;font-weight:700" id="mwv_'+k+'">'+v.toFixed(1)+'×</div></div>';}).join('');
  var _adj='<details '+(_ex.adjOpen?'open':'')+' id="exAdj" style="margin:10px 0;border:1px solid #e5e9f0;border-radius:11px;padding:8px 12px"><summary style="cursor:pointer;font-weight:600;font-size:13px">Adjust factor influence — forecast '+_modPct+'% survive vs '+_refPct+'% Stage 1 reference'+(_nadj?' · '+_nadj+' changed':'')+'</summary><div class="small mut" style="margin:6px 0">Dial each Stage 1 factor up or down (1.0× = your Stage 1 model). The map, list and rankings update live.</div>'+_sliders+'<div class="row" style="margin-top:8px"><button class="btn sec sm" onclick="smResetMod2()">Reset to 1.0×</button></div></details>';
  m.innerHTML='<div class="card">'+
    '<div class="kick" style="color:var(--blue)">Survival model · Stage 2 of 2</div>'+
    '<h2>Stage 2 · Apply to the Red Line</h2>'+
    '<p class="small mut">A working list of every planned Red Line business, each with a <b>predicted survival rate</b> from your model. Sort by predicted survival rate, filter by sector or neighborhood, click any business to see why, and <b>star the ones that matter</b> to build a shortlist you can export.</p>'+
    _adj+
    exStripHTML(scored)+
    '<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">'+
      '<select id="exSector"><option value="">All sectors</option>'+sectors.map(function(s){return '<option value="'+esc(s)+'" '+(_ex.sector===s?'selected':'')+'>'+esc(s)+'</option>';}).join('')+'</select>'+
      '<select id="exNpaF"><option value="">All neighborhoods</option>'+npas.map(function(n){return '<option value="'+n+'" '+(String(_ex.npa)===String(n)?'selected':'')+'>'+esc(smTown(n))+'</option>';}).join('')+'</select>'+
      '<select id="exSort"><option value="survhigh" '+(_ex.sort==='survhigh'?'selected':'')+'>Highest predicted survival rate first</option><option value="survlow" '+(_ex.sort==='survlow'?'selected':'')+'>Lowest predicted survival rate first</option><option value="name" '+(_ex.sort==='name'?'selected':'')+'>By business ID</option></select>'+
      '<span class="chip '+(_ex.shortOnly?'on':'')+'" id="exShortOnly">★ Shortlist only</span>'+
    '</div>'+
    '<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" onclick="downloadExMap()">⬇ Map (PNG)</button></div>'+
    '<div id="exMap" style="height:560px;border:1px solid #e5e9f0;border-radius:11px;margin-top:6px;background:#eef2f7"></div>'+
    '<div class="small mut" style="margin-top:4px">Each dot is a business colored by its <b>predicted survival rate</b> (red = low rate, likely to close; green = high rate, likely to stay open); faint outlines are neighborhoods. Click a dot or a row to inspect it. Positions are placed within each business’s neighborhood (the data has no street addresses).</div>'+
    '<div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(320px,1.4fr);gap:16px;margin-top:12px;align-items:start">'+
      '<div><div style="font-weight:700;font-size:13px;margin-bottom:6px">Survival rates by business</div><div id="exListWrap" style="border:1px solid #e5e9f0;border-radius:11px;overflow:auto;max-height:520px">'+exList(filtered,selected?selected.id:'')+'</div></div>'+
      '<div><div style="font-weight:700;font-size:13px;margin-bottom:6px">Detailed business data (individual)</div><div id="exDetailWrap">'+(selected?exDetail(selected,model,scored):'<div class="note">No businesses match these filters.</div>')+'</div></div>'+
    '</div>'+
    '<div class="spread" style="margin-top:18px;align-items:flex-end"><div><b>Detailed business data (all filtered businesses)</b> <span class="small mut">— the predicted-survival-rate cell is shaded red (low) to green (high); click a row to inspect</span></div><button class="btn ghost sm" onclick="exDownloadTable()">⬇ Download (CSV)</button></div>'+
    '<div style="margin-top:6px">'+exDataTable(filtered,model)+'</div>'+
    '<div class="spread" style="margin-top:14px;padding-top:12px;border-top:1px solid #f1f4f8"><div class="small mut"><b>'+S.shortlist.length+'</b> business'+(S.shortlist.length===1?'':'es')+' on your shortlist</div><button class="btn" onclick="exExportShortlist()">⬇ Export shortlist (CSV)</button></div>'+
  '</div>';
  // wire
  var _adjEl=document.getElementById('exAdj');if(_adjEl)_adjEl.ontoggle=function(){_ex.adjOpen=this.open;};
  document.querySelectorAll('[data-mw]').forEach(function(sl){sl.oninput=function(){var el=document.getElementById('mwv_'+this.dataset.mw);if(el)el.textContent=(+this.value).toFixed(1)+'×';};sl.onchange=function(){if(!SM.mod2)SM.mod2={};SM.mod2[this.dataset.mw]=+this.value;_ex.adjOpen=true;VIEWS_survival3();};});
  document.querySelectorAll('[data-band]').forEach(function(c){c.onclick=function(){_ex.band=(_ex.band===this.dataset.band)?'':this.dataset.band;VIEWS_survival3();};});
  var ss=document.getElementById('exSearch');if(ss)ss.oninput=function(){_ex.q=this.value;_exFocus=1;VIEWS_survival3();};
  var sec=document.getElementById('exSector');if(sec)sec.onchange=function(){_ex.sector=this.value;VIEWS_survival3();};
  var nf=document.getElementById('exNpaF');if(nf)nf.onchange=function(){_ex.npa=this.value;VIEWS_survival3();};
  var so=document.getElementById('exSort');if(so)so.onchange=function(){_ex.sort=this.value;VIEWS_survival3();};
  var sho=document.getElementById('exShortOnly');if(sho)sho.onclick=function(){_ex.shortOnly=!_ex.shortOnly;VIEWS_survival3();};
  document.querySelectorAll('.exrow').forEach(function(row){row.onclick=function(ev){if(ev.target&&ev.target.dataset&&ev.target.dataset.star){toggleShort(ev.target.dataset.star);return;}exSelectBiz(this.dataset.bid);};});
  requestAnimationFrame(function(){exDrawMap(filtered,selected?selected.id:'');});
  document.querySelectorAll('.exdrow').forEach(function(row){row.onclick=function(){exSelectBiz(this.dataset.bid);};});
  if(_exFocus){var si=document.getElementById('exSearch');if(si){si.focus();try{si.setSelectionRange(si.value.length,si.value.length);}catch(e){}}_exFocus=0;}
}
function exPickBiz(id){_ex.biz=id;VIEWS_survival3();}
function exClipText(scored){
  var surv=scored.filter(o=>o.p>=0.5).length;
  if(_ex.npa){var id=+_ex.npa,biz=scored.filter(o=>o.r[smIdx('npa')]===id);return 'Red Line explorer — '+smTown(id)+': '+biz.length+' businesses, '+Math.round(100*biz.filter(o=>o.p>=0.5).length/biz.length)+'% predicted to survive.';}
  return 'Red Line explorer: of '+scored.length+' businesses, '+Math.round(100*surv/scored.length)+'% predicted to survive; explore which business and neighborhood traits separate the survivors from those likely to close.';
}
VIEWS.survival3=VIEWS_survival3;
/* build: survival-canonical + data-dictionary measures + tasks nav (2026-06) */
boot();
