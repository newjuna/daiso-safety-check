/**
 * GitHub Pages에서 실행되는 화면 로직. 서버 작업은 Apps Script API로 요청한다.
 *
 * v1과 다른 점 (매장/사고이력 연동):
 *  - D.stores(하드코딩 샘플 3개)를 없애고, 서버(Code.gs getStoreList)에서
 *    구글시트 '매장' 탭(1389개 실데이터)을 읽어와 STORE_LIST에 채운다.
 *  - 매장 선택 시 getStoreAccidentHistory(매장명), getStoreOpenIssues(매장명)을
 *    호출해 그 매장의 사고이력(승인 여부와 상관없이 전체, 승인건은 배지 표시)과
 *    기존 미조치 개선과제를 서버에서 실시간으로 받아온다.
 *  - 나머지 점검 흐름(작업점검/사다리/시설소방/TBM/의견청취/기타사항/개선과제/
 *    결과보고서)과 localStorage 임시저장 로직은 v1과 동일하다.
 */
const $=s=>document.querySelector(s),root=$('#app'),KEY='daiso_safety_v8';
const fresh=()=>({screen:'start',store:null,basic:{date:new Date().toISOString().slice(0,10),inspector:'',hq:'',dept:'',team:'',people:'',size:'',floors:'',delivery:'오전'},wi:0,wa:{},ladder:{types:[],counts:{},otherType:'',issues:[],guideSeen:false,step:1,status:''},facility:{issues:[],guideSeen:false,step:1,status:''},tbm:{issues:[],guideSeen:false,step:1,status:''},workers:[{answers:{},qi:0}],worker:0,others:[],tasks:[]});
let S=(()=>{try{return JSON.parse(localStorage.getItem(KEY))||fresh()}catch(e){return fresh()}})();
function normalizeState(){
  const f=fresh();
  if(!S||typeof S!=='object')S=f;
  S.basic={...f.basic,...(S.basic||{})};
  S.wa=S.wa||{};
  S.facility=S.facility||{};
  S.tbm=S.tbm||{};
  S.workers=Array.isArray(S.workers)&&S.workers.length?S.workers:f.workers;
  S.worker=Number.isInteger(S.worker)?S.worker:0;
  S.others=Array.isArray(S.others)?S.others:[];
  S.others.forEach(o=>{if(!o.id)o.id=uid()});
  S.tasks=Array.isArray(S.tasks)?S.tasks:[];
  S.ladder=S.ladder||{};
  S.ladder.types=Array.isArray(S.ladder.types)?S.ladder.types:[];
  S.ladder.counts=S.ladder.counts||{};
  S.ladder.otherType=S.ladder.otherType||'';
  S.ladder.issues=Array.isArray(S.ladder.issues)?S.ladder.issues:[];
  S.ladder.issues.forEach(x=>{if(!x.id)x.id=uid()});
  S.ladder.guideSeen=!!S.ladder.guideSeen;S.ladder.step=Number(S.ladder.step||1);S.ladder.status=S.ladder.status||'';
  if(!S.facility||Array.isArray(S.facility))S.facility={issues:[],guideSeen:false};
  S.facility.issues=Array.isArray(S.facility.issues)?S.facility.issues:[];
  S.facility.issues.forEach(x=>{if(!x.id)x.id=uid()});
  S.facility.guideSeen=!!S.facility.guideSeen;S.facility.step=Number(S.facility.step||1);S.facility.status=S.facility.status||'';
  if(!S.tbm||Array.isArray(S.tbm))S.tbm={issues:[],guideSeen:false};
  S.tbm.issues=Array.isArray(S.tbm.issues)?S.tbm.issues:[];
  S.tbm.issues.forEach(x=>{if(!x.id)x.id=uid()});
  S.tbm.guideSeen=!!S.tbm.guideSeen;S.tbm.step=Number(S.tbm.step||1);S.tbm.status=S.tbm.status||'';
  S.screen=S.screen||'start';
  S.wi=Number.isInteger(S.wi)?S.wi:0;
  S.workNA=S.workNA||{};
  S.guides=S.guides||{};
  S.audit=S.audit||{};S.workChecked=S.workChecked||{};S.finalValidation=S.finalValidation||{};
  S.submittedAt=S.submittedAt||null;S.submittedBy=S.submittedBy||'';
  S.resultNote=S.resultNote||'';
  S.resultLinks=S.resultLinks||null;
}
normalizeState();
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
function save(){localStorage.setItem(KEY,JSON.stringify(S))}function toast(x){const e=$('#toast');e.textContent=x;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1600)}

/* ============ 서버 호출 헬퍼 (Apps Script API를 fetch로 호출) ============ */
/* Apps Script 웹앱(API)을 호출한다.
   API_URL은 config.js에서 설정하며, GitHub Pages에 올린 화면이
   구글 시트/드라이브 작업을 요청할 때 이 함수를 통해 통신한다. */
function gsRun(fnName){
  var args=Array.prototype.slice.call(arguments,1);
  var body=JSON.stringify({fn:fnName,args:args,key:(window.API_KEY||'')});
  return fetch(window.API_URL,{
    method:'POST',
    /* text/plain으로 보내면 브라우저가 사전확인(preflight) 요청을 생략해
       Apps Script와의 통신이 단순해진다. 서버에서 JSON으로 파싱한다. */
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:body
  }).then(function(res){
    if(!res.ok)throw new Error('서버 응답 오류 ('+res.status+')');
    return res.json();
  }).then(function(json){
    if(json && json.ok===false)throw new Error(json.message||'서버 처리 실패');
    return json ? json.data : null;
  });
}

/* ============ 사진 압축 (업로드 전 용량 최소화) ============ */
/* 가로 최대 1200px로 축소 + JPEG 60% 품질로 압축한 base64 dataUrl을 반환한다. */
/* 구글 드라이브 용량을 아끼기 위해 원본 그대로 올리지 않는다. */
function compressImage(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const MAX_W=1200;
        const scale=Math.min(1,MAX_W/img.width);
        const w=Math.round(img.width*scale),h=Math.round(img.height*scale);
        const canvas=document.createElement('canvas');
        canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve({name:file.name.replace(/\.(png|heic|heif)$/i,'.jpg'),dataUrl:canvas.toDataURL('image/jpeg',0.6)});
      };
      img.onerror=reject;
      img.src=reader.result;
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}
/* input[type=file]에서 선택된 여러 파일을 전부 압축해서 [{name,dataUrl}] 배열로 반환 */
async function compressAll(fileList){
  const out=[];
  for(const f of fileList){
    try{out.push(await compressImage(f))}catch(e){console.error('사진 압축 실패',e)}
  }
  return out;
}
/* 압축된 사진의 실제 데이터(dataUrl)는 localStorage 용량 제한(5~10MB) 때문에 */
/* 저장하지 않고 브라우저 메모리(PHOTO_STORE)에만 둔다. S(localStorage에 저장되는 상태)에는 */
/* 표시용 이름과 이 Map을 찾아갈 id만 넣는다. 페이지를 새로고침하면 사진은 다시 선택해야 하지만, */
/* 다른 점검 답변 데이터는 그대로 보존된다. */
const PHOTO_STORE=new Map(); // id -> {name, dataUrl}
/* 사진 목록을 작은 썸네일 그리드로 보여준다. PHOTO_STORE에 실제 데이터가 있으면 */
/* 미리보기 이미지를, 없으면(예: 새로고침 후 유실) 카메라 배지로 대체 표시한다. */
/* 백틱 문자열 중첩으로 파서가 깨졌던 적이 있어, 문자열 연결(+)만 사용한다. */
function renderPhotoList(files,removeKind,removeArg){
  if(!files||!files.length)return'';
  var items='';
  for(var i=0;i<files.length;i++){
    var f=files[i];
    var stored=(f&&f.id)?PHOTO_STORE.get(f.id):null;
    var thumb=stored
      ?('<img src="'+stored.dataUrl+'" alt="'+esc(f.name||'')+'">')
      :'<span class="photo-thumb-fallback">📷</span>';
    var onclick="removePhotoAt('"+removeKind+"','"+removeArg+"',"+i+")";
    items+='<div class="photo-thumb">'+thumb+'<button class="photo-remove" onclick="'+onclick+'" aria-label="사진 삭제">×</button></div>';
  }
  return '<div class="photo-list">'+items+'</div>';
}
function removePhotoAt(kind,arg,i){
  if(kind==='work'){const o=getObj('work',arg);o.files.splice(i,1);save();work();return}
  if(kind==='issue'){
    const parts=arg.split('|');const k=parts[0],idx=Number(parts[1]);
    S[k].issues[idx].files.splice(i,1);save();
    k==='ladder'?ladder():check(k);return
  }
  if(kind==='other'){S.others[Number(arg)].files.splice(i,1);save();other();return}
}
async function attachPhotos(fileList){
  const compressed=await compressAll(fileList);
  return compressed.map(p=>{
    const id=uid();
    PHOTO_STORE.set(id,p);
    return {id,name:p.name};
  });
}

function progressInfo(){
  const order=['start','basic','work','ladder','facility','tbm','voice','other','tasks','result'];
  let idx=order.indexOf(S.screen);if(idx<0)idx=0;
  const total=9, shown=Math.min(total,Math.max(0,idx));
  return {n:shown,total,pct:Math.round(shown/total*100)}
}
/* 마지막으로 그린 화면의 식별자. 같은 화면을 다시 그리는 경우(예: 사다리 유형 선택,
   수량 입력, 사진 추가)에는 스크롤을 맨 위로 올리지 않고 보던 위치를 유지한다.
   화면 자체가 바뀔 때만(작업점검 -> 사다리 등) 맨 위로 올린다. */
var LAST_VIEW_KEY='';
function currentViewKey(){
  /* 같은 화면 안에서도 단계(STEP)나 작업유형이 바뀌면 새 화면으로 취급한다. */
  var parts=[S.screen];
  if(S.screen==='work')parts.push(S.wi);
  if(S.screen==='ladder')parts.push(S.ladder&&S.ladder.step);
  if(S.screen==='facility')parts.push(S.facility&&S.facility.step);
  if(S.screen==='tbm')parts.push(S.tbm&&S.tbm.step);
  if(S.screen==='voice'){
    parts.push(S.worker);
    var w=S.workers&&S.workers[S.worker];
    parts.push(w&&w.qi);
  }
  return parts.join('|');
}
function frame(body,title='안전보건 현장진단',sub='모바일 현장점검'){
  const pg=progressInfo();
  const viewKey=currentViewKey();
  const sameView=(viewKey===LAST_VIEW_KEY);
  const keepY=sameView?window.scrollY:0;

  root.innerHTML=`<div class="app"><header class="hero"><div class="hero-top"><div class="hero-logo">SH</div><div class="eyebrow">ASUNG DAISO · SAFETY & HEALTH</div></div><h1>${title}</h1><p>${sub}</p><div class="hero-progress"><div class="hero-progress-top"><span>전체 진행 ${pg.n}/${pg.total}</span><span>${pg.pct}%</span></div><div class="hero-progress-track"><i style="width:${pg.pct}%"></i></div></div></header><main class="content">${body}</main></div>`;

  LAST_VIEW_KEY=viewKey;
  if(sameView){
    /* 다시 그린 직후에 위치를 복원해야 브라우저가 스크롤을 리셋하지 않는다. */
    requestAnimationFrame(function(){window.scrollTo(0,keepY)});
  }else{
    window.scrollTo(0,0);
  }
  save();
}
function field(label,id,value='',type='text',extra=''){return `<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${extra}></div>`}

/* ============ 매장 선택 (서버에서 실시간 조회) ============ */
let STORE_LIST=null; // getStoreList() 결과 캐시: [{division,dept,team,store}, ...]

function start(){
  S.screen='start';
  if(STORE_LIST){renderStart();return}
  frame(`<div class="card"><h2>점검할 매장을 선택하세요</h2><div class="loading-notice">매장 목록을 불러오는 중입니다...</div></div>`,`안전보건 현장진단을<br>시작합니다.`,`매장 선택 후 필요한 정보만 불러옵니다.`);
  gsRun('getStoreList').then(list=>{STORE_LIST=list||[];renderStart()}).catch(err=>{
    frame(`<div class="card"><h2>매장 목록을 불러오지 못했습니다</h2><div class="notice">${esc(err&&err.message?err.message:String(err))}</div><button class="primary wide" onclick="STORE_LIST=null;start()">다시 시도</button></div>`);
  });
}
/* 점검자 목록 (Park이 안전/보건 두 명이라 소속을 붙여 구분) */
var INSPECTORS=['Kang(안전)','Park(안전)','Yoo(안전)','Seo(안전)','Park(보건)','Yoon(보건)'];

/* 조직 단계 선택 상태: 부문 -> 부서 -> 팀 -> 매장 */
var SEL={inspector:'',division:'',dept:'',team:'',store:''};

/* 앞 단계 선택값에 맞는 다음 단계 후보만 추려서 돌려준다. */
function orgOptions(field){
  var rows=STORE_LIST||[];
  if(field!=='division'&&SEL.division)rows=rows.filter(function(r){return r.division===SEL.division});
  if((field==='team'||field==='store')&&SEL.dept)rows=rows.filter(function(r){return r.dept===SEL.dept});
  if(field==='store'&&SEL.team)rows=rows.filter(function(r){return r.team===SEL.team});
  var seen={},out=[];
  rows.forEach(function(r){
    var v=field==='division'?r.division:(field==='dept'?r.dept:(field==='team'?r.team:r.store));
    if(v&&!seen[v]){seen[v]=true;out.push(v)}
  });
  return out.sort();
}
/* 상위 단계를 바꾸면 하위 선택은 초기화한다. */
function onOrgChange(field,value){
  SEL[field]=value;
  if(field==='division'){SEL.dept='';SEL.team='';SEL.store=''}
  if(field==='dept'){SEL.team='';SEL.store=''}
  if(field==='team'){SEL.store=''}
  renderStart();
}
function onInspectorChange(value){SEL.inspector=value}

function selectBox(label,field,options,selected,required){
  var h='<div class="field"><label>'+label+(required?' <span class="req">*</span>':'')+'</label>';
  h+='<select onchange="onOrgChange(\''+field+'\',this.value)">';
  h+='<option value="">선택 ('+options.length+')</option>';
  for(var i=0;i<options.length;i++){
    var v=options[i];
    h+='<option'+(v===selected?' selected':'')+'>'+esc(v)+'</option>';
  }
  h+='</select></div>';
  return h;
}

function renderStart(){
  var h='<div class="card"><h2>점검 정보를 선택하세요</h2>';

  /* 점검자 */
  h+='<div class="field"><label>점검자 <span class="req">*</span></label>';
  h+='<select onchange="onInspectorChange(this.value)"><option value="">점검자 선택</option>';
  for(var i=0;i<INSPECTORS.length;i++){
    var ins=INSPECTORS[i];
    h+='<option'+(ins===SEL.inspector?' selected':'')+'>'+esc(ins)+'</option>';
  }
  h+='</select></div>';

  /* 조직 단계: 부문 -> 부서 -> 팀 -> 매장 */
  h+=selectBox('영업부문','division',orgOptions('division'),SEL.division,true);
  if(SEL.division)h+=selectBox('부서','dept',orgOptions('dept'),SEL.dept,true);
  if(SEL.dept)h+=selectBox('팀','team',orgOptions('team'),SEL.team,true);
  if(SEL.team)h+=selectBox('매장','store',orgOptions('store'),SEL.store,true);

  h+='<button class="primary wide" style="margin-top:6px" onclick="selectStore()">기본정보 확인 →</button>';
  if(localStorage.getItem(KEY)&&S.store){
    h+='<button class="secondary wide" style="margin-top:8px" onclick="resume()">저장된 '+esc(S.store.name)+' 점검 이어하기</button>';
  }
  h+='<button class="secondary wide" style="margin-top:8px" onclick="openDashboard()">📊 대시보드 보기</button>';
  h+='</div>';

  frame(h,'안전보건 현장진단을<br>시작합니다.','점검자와 조직을 선택하면 사고이력·기존과제를 자동으로 불러옵니다.');
}
function resume(){render(S.screen||'basic')}

function selectStore(){
  if(!SEL.inspector)return toast('점검자를 선택하세요');
  if(!SEL.store)return toast('매장까지 모두 선택하세요');
  var n=SEL.store;
  var meta={name:n,hq:SEL.division,dept:SEL.dept,team:SEL.team,people:'',size:'',floors:'',delivery:'오전',inspector:SEL.inspector};
  S=fresh();
  S.store={...meta,accidentRecords:[],accidents:[],openIssues:[],tasks:[]};
  Object.assign(S.basic,meta);
  S.screen='basic';
  frame(`<div class="card"><h2>${esc(meta.name)} 기본정보</h2><div class="loading-notice">사고이력·기존 개선과제를 불러오는 중입니다...</div></div>`,`매장 기본정보를<br>확인하세요.`);
  Promise.all([gsRun('getStoreAccidentHistory',n),gsRun('getStoreOpenIssues',n)]).then(([acc,open])=>{
    acc=acc||[];open=open||[];
    S.store.accidentRecords=acc;
    S.store.accidents=acc.map(a=>`${a.date} ${a.type}${a.approved==='Y'?'(산재승인)':''}: ${a.content}`);
    S.store.openIssues=open;
    S.store.tasks=open.map(x=>x.title);
    basic();
  }).catch(err=>{
    toast('사고이력 조회 실패: '+(err&&err.message?err.message:String(err)));
    basic();
  });
}

function basic(){
  S.screen='basic';const b=S.basic,m=S.store;
  const accRecords=m.accidentRecords||[];
  const openIssues=m.openIssues||[];
  const accidentHtml=accRecords.length?`<div class="notice"><b>사고이력 ${accRecords.length}건</b>${accRecords.map(a=>`<div class="accident-item"><span class="date">${esc(a.date)}</span> ${esc(a.type)}${a.approved==='Y'?'<span class="badge-approved">산재승인</span>':''}<br>${esc(a.content)}</div>`).join('')}</div>`:'';
  const taskHtml=openIssues.length?`<div class="notice"><b>기존 조치대기 ${openIssues.length}건</b><br>${openIssues.map(x=>esc(x.title)).join('<br>')}</div>`:'';
  frame(`<div class="card"><h2>${esc(m.name)} 기본정보</h2>${accidentHtml}${taskHtml}<div class="grid">${field('점검일 *','date',b.date,'date')}${field('점검자','inspectorView',b.inspector,'text','readonly')}${field('본부','hq',b.hq,'text','readonly')}${field('부서','dept',b.dept,'text','readonly')}${field('팀','team',b.team,'text','readonly')}</div><div class="field"><label>입고시간대</label><select id="delivery"><option ${b.delivery==='오전'?'selected':''}>오전</option><option ${b.delivery==='오후(야간)'?'selected':''}>오후(야간)</option></select></div><div class="grid"><button class="secondary" onclick="start()">← 매장선택</button><button class="primary" onclick="begin()">작업점검 시작 →</button></div></div>`,`매장 기본정보를<br>확인하세요.`,`사고이력과 기존 미조치 과제를 선택 매장 기준으로 표시합니다.`)
}
function begin(){['date','delivery'].forEach(k=>S.basic[k]=$('#'+k).value);if(!S.basic.date)return toast('점검일을 확인하세요');ensureDefaults();S.screen='work';work()}
const ALL_SECTIONS=['work','ladder','facility','tbm','voice','other','tasks','result'];
/* 과거 지적사항/사고이력이 없는 매장은 '개선과제'(조치확인) 탭 자체를 노출하지 않는다. */
function activeSections(){
  return ALL_SECTIONS.filter(function(k){return k!=='tasks'||hasPastTasks()});
}
function tabs(a){
  const nm={work:'작업점검',ladder:'사다리',facility:'시설·소방',tbm:'TBM',voice:'의견청취',other:'기타사항',tasks:'조치확인',result:'결과'};
  return `<div class="tabs-wrap"><div class="tabs">${activeSections().map(k=>`<button class="tab ${a===k?'active':''}" onclick="go('${k}')">${nm[k]}</button>`).join('')}</div></div>`;
}function go(k){if(k==='work')work();else if(k==='ladder')ladder();else if(k==='facility'||k==='tbm')check(k);else if(k==='voice')voice();else if(k==='other')other();else if(k==='tasks'){hasPastTasks()?tasks():other()}else finalSubmit()}
function goodIndex(q){
  const goods=Array.isArray(q[4])?q[4]:[];
  if(goods.length)return goods[0];
  const risks=Array.isArray(q[3])?q[3]:[];
  const idx=q[1].findIndex((_,i)=>!risks.includes(i));
  return idx>=0?idx:0;
}
function ensureDefaults(){
  normalizeState();
  D.works.forEach((w,wi)=>{S.wa[wi]=S.wa[wi]||{};w[1].forEach((q,qi)=>{if(!S.wa[wi][qi]){const oi=goodIndex(q);S.wa[wi][qi]={oi,risk:false,hazards:q[2]}}})});
  save();
}

function guideModal(title,items,kind){
  const old=document.getElementById('guideModal');if(old)old.remove();
  const m=document.createElement('div');m.id='guideModal';m.className='modal-backdrop';
  m.innerHTML=`<div class="guide-modal"><div class="guide-icon">📋</div><h2>${title}</h2><p class="muted">아래 항목을 현장에서 확인한 뒤, 이상이 있는 사항만 등록해 주세요.</p><div class="guide-list">${items.map((x,i)=>`<div><b>${i+1}</b><span>${x}</span></div>`).join('')}</div><button class="primary wide" onclick="closeGuide('${kind}')">확인했습니다 · 점검 시작</button></div>`;
  document.body.appendChild(m);
}
function closeGuide(kind){const m=document.getElementById('guideModal');if(m)m.remove();if(S[kind])S[kind].guideSeen=true;save()}
/* 사다리 유형별 참고 사진을 크게 볼 수 있는 모달 (STEP1 "📷 사진으로 확인" 버튼) */
function showLadderTypeGuide(){
  const old=document.getElementById('guideModal');if(old)old.remove();
  var items='';
  D.ladderTypes.forEach(function(t){
    var img=(D.ladderTypeImages||{})[t];
    items+='<div class="ladder-guide-item"><div class="ladder-guide-label">'+esc(t)+'</div>'
      +(img?'<img src="'+img+'" alt="'+esc(t)+'">':'<div class="ladder-type-noimg" style="height:160px">📷 이미지 준비 중</div>')
      +'</div>';
  });
  const m=document.createElement('div');m.id='guideModal';m.className='modal-backdrop';
  var closeOnclick="closeLadderTypeGuide()";
  m.innerHTML='<div class="guide-modal"><div class="guide-icon">🪜</div><h2>사다리 유형 참고사진</h2>'
    +'<p class="muted">우리 매장 사다리와 비슷한 유형을 사진으로 확인하세요.</p>'
    +'<div class="ladder-guide-list">'+items+'</div>'
    +'<button class="primary wide" onclick="'+closeOnclick+'">확인했습니다</button></div>';
  document.body.appendChild(m);
}
function closeLadderTypeGuide(){const m=document.getElementById('guideModal');if(m)m.remove()}
function showGuide(kind){
  const title=kind==='ladder'?'사다리 점검 가이드':kind==='facility'?'시설·소방 점검 가이드':'TBM 점검 가이드';
  const items=kind==='ladder'?D.ladder.map(x=>x[1]):D[kind];
  guideModal(title,items,kind);
}
function workTabs(){return `<div class="tabs-wrap"><div class="tabs">${D.works.map((w,i)=>{
  /* '완료' 여부는 실제로 '다음' 버튼을 눌러 확인한 workChecked 기준으로 판단한다. */
  /* (S.wa는 ensureDefaults가 진입 시 미리 채워두므로 완료 판단 기준으로 쓰면 안 됨) */
  const checked=S.workChecked&&S.workChecked[i];
  const isNA=S.workNA&&S.workNA[i];
  const done=!!checked&&checked.status!=='na'||isNA;
  const a=S.wa[i]||{},risk=!isNA&&Object.values(a).some(x=>x.risk);
  return `<button class="tab ${S.wi===i?'active':''} ${done?'done':''} ${risk?'risk':''}" onclick="S.wi=${i};work()">${w[0]}</button>`
}).join('')}</div></div>`}
function work(){
  S.screen='work';ensureDefaults();
  const w=D.works[S.wi],a=S.wa[S.wi]||{},done=Object.keys(a).length,risk=Object.values(a).filter(x=>x.risk).length;
  frame(`${tabs('work')}${workTabs()}<div class="card"><div class="summary"><h2>${w[0]}</h2><span class="pill ${risk?'bad':''}">${S.workNA[S.wi]?'해당 없음':`${done}/${w[1].length} 완료 · 위험신호 ${risk}`}</span></div>
  <button class="work-na ${S.workNA[S.wi]?'active':''}" onclick="toggleWorkNA(${S.wi})">${S.workNA[S.wi]?'✓ 해당 작업 없음':'해당 작업 없음'}</button>
  ${S.workNA[S.wi]?`<div class="notice"><b>${esc(w[0])}</b> 작업은 해당 없음으로 기록됩니다.</div>`:w[1].map((q,qi)=>question(q,qi,a[qi])).join('')}</div>
  ${nav(S.wi,D.works.length,`prevWork()`,`nextWork()`)}`,`작업유형별<br>통합점검`,`${S.wi+1}/${D.works.length} · 각 문항의 양호 답변이 기본 선택되어 있습니다.`);
  if(!S.guides.work)setTimeout(()=>workGuide(),80);
}
function question(q,qi,v){return `<div class="q" data-required="q${qi}"><h3>${qi+1}. ${q[0]} <span class="req">*</span></h3><div class="answers">${q[1].map((o,oi)=>`<button class="ans ${v?.oi===oi?'sel':''}" onclick="pickWork(${qi},${oi})">${o}</button>`).join('')}</div>${v?.risk?detail('work',`${S.wi}-${qi}`,v):''}</div>`}

function workGuide(){
  const old=document.getElementById('guideModal');if(old)old.remove();
  const m=document.createElement('div');m.id='guideModal';m.className='modal-backdrop';
  m.innerHTML=`<div class="guide-modal"><div class="guide-icon">👀</div><h2>작업점검 안내</h2>
  <p class="muted">빠른 점검을 위해 각 문항의 <b>양호한 답변이 미리 선택</b>되어 있습니다.</p>
  <div class="guide-list"><div><b>1</b><span>실제 작업현장을 직접 확인해 주세요.</span></div><div><b>2</b><span>현장 상태가 기본 선택과 다를 때만 답변을 변경하세요.</span></div><div><b>3</b><span>해당 작업을 하지 않는 매장은 ‘해당 작업 없음’을 선택하세요.</span></div></div>
  <button class="primary wide" onclick="S.guides.work=true;save();document.getElementById('guideModal').remove()">확인했습니다 · 점검 시작</button></div>`;
  document.body.appendChild(m)
}
function toggleWorkNA(wi){
  S.workNA[wi]=!S.workNA[wi];save();work()
}
/* 스크롤 위치 유지는 frame()이 알아서 처리하므로 여기서 따로 복원하지 않는다. */
function pickWork(qi,oi){const q=D.works[S.wi][1][qi];S.wa[S.wi]=S.wa[S.wi]||{};const old=S.wa[S.wi][qi]||{},riskSet=Array.isArray(q[3])?q[3]:[];S.wa[S.wi][qi]={...old,oi,risk:riskSet.includes(oi),hazards:q[2]};save();work()}
function detail(kind,id,v){return `<div class="detail"><div class="field"><label>위험·미흡 내용</label><textarea onchange="setDetail('${kind}','${id}','note',this.value)">${esc(v.note)}</textarea></div><div class="field"><label>사진 첨부</label><label class="photo-picker"><span class="camera-emoji">📷</span><span><b>사진 촬영·추가</b><small>카메라 또는 앨범에서 선택</small></span><input class="photo-input" type="file" accept="image/*" multiple onchange="pickFiles('${kind}','${id}',this)"></label></div>${renderPhotoList(v.files,'work',id)}</div>`}
function setDetail(k,id,p,val){const o=getObj(k,id);o[p]=val;save()}
async function pickFiles(k,id,input){
  const n=input.files.length;toast('사진 압축 중...');
  const added=await attachPhotos(input.files);
  const o=getObj(k,id);o.files=[...(o.files||[]),...added];save();
  toast(`${n}개 사진 선택됨`);
  /* 현재 화면을 다시 그려서 새 사진 목록을 반영 (작업점검 화면만 해당) */
  if(k==='work')work();
}
function getObj(k,id){if(k==='work'){const [a,b]=id.split('-');return S.wa[a][b]}return S[k][id]}
function invalid(sel,msg){const e=$(sel);if(e){e.classList.add('shake');e.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>e.classList.remove('shake'),400)}toast(msg);return false}function nextWork(){ensureDefaults();S.workChecked[S.wi]={checkedAt:new Date().toISOString(),checkedBy:S.basic?.inspector||'',status:S.workNA?.[S.wi]?'na':'checked'};save();if(S.wi<D.works.length-1){S.wi++;work()}else ladder()}function prevWork(){if(S.wi){S.wi--;work()}else basic()}
function nav(i,n,prev,next){return `<nav class="nav"><button class="secondary" onclick="${prev}">← 이전</button><div class="progress">${i+1}/${n}<div class="bar"><i style="width:${(i+1)/n*100}%"></i></div></div><button class="primary" onclick="${next}">다음 →</button></nav>`}


function check(k){
  normalizeState();S.screen=k;
  const st=S[k],title=k==='facility'?'시설·소방':'TBM',next=k==='facility'?`check('tbm')`:'voice()',prev=k==='facility'?`ladder()`:`check('facility')`;
  let body='';
  if(st.step===1){
    body=`<div class="card step-card"><div class="step-head"><span>STEP 1</span><b>${title} 이상유무</b></div>
      <div class="summary"><h2>${title} 점검</h2><button class="guide-btn" onclick="showGuide('${k}')">📋 점검 가이드</button></div>
      <p class="muted">가이드 항목을 현장에서 확인한 뒤 이상유무를 선택하세요.</p>
      <div class="status-choice">
        <button class="status-good ${st.status==='good'?'selected':''}" onclick="S.${k}.status='good';save();check('${k}')"><b>✓ 이상 없음</b><small>전체 항목을 양호로 처리합니다.</small></button>
        <button class="status-bad ${st.status==='bad'?'selected':''}" onclick="S.${k}.status='bad';save();check('${k}')"><b>! 이상 있음</b><small>미흡사항을 다음 단계에서 등록합니다.</small></button>
      </div>
      <div class="grid"><button class="secondary" onclick="${prev}">← 이전</button><button class="primary" onclick="nextSimple('${k}')">다음 →</button></div></div>`;
  }else{
    body=`<div class="card step-card"><div class="step-head"><span>STEP 2</span><b>${title} 미흡사항 등록</b></div>
      <div class="summary"><h2>발견된 미흡사항</h2><span class="pill bad">${st.issues.length}건</span></div>
      ${st.issues.map((x,i)=>issueCard(k,x,i)).join('')}
      <button class="secondary wide" onclick="addIssue('${k}')">＋ 미흡사항 추가</button>
      <div class="grid" style="margin-top:10px"><button class="secondary" onclick="S.${k}.step=1;save();check('${k}')">← 이상유무</button><button class="primary" onclick="finishSimple('${k}')">${k==='facility'?'TBM 점검':'의견청취'} →</button></div></div>`;
  }
  frame(`${tabs(k)}${body}`,`${title}<br>STEP 점검`,st.step===1?'이상유무만 먼저 확인합니다.':'이상이 있는 항목만 기록합니다.');
  if(!st.guideSeen)setTimeout(()=>showGuide(k),80);
}
function nextSimple(k){
  const st=S[k];if(!st.status)return toast('이상유무를 선택하세요.');
  if(st.status==='good'){
    st.issues=[];st.step=1;st.checkedAt=new Date().toISOString();st.checkedBy=S.basic?.inspector||'';
    save();k==='facility'?check('tbm'):voice()
  }
  else{st.step=2;if(!st.issues.length)st.issues.push({id:uid(),item:'',note:'',files:[]});save();check(k)}
}
function finishSimple(k){
  if(!S[k].issues.length)return toast('미흡사항을 1건 이상 등록하세요.');
  const invalidIssue=S[k].issues.find(x=>!x.item);
  if(invalidIssue)return toast('미흡 항목을 선택하세요.');
  S[k].status='bad';S[k].step=1;S[k].checkedAt=new Date().toISOString();S[k].checkedBy=S.basic?.inspector||'';save();k==='facility'?check('tbm'):voice()
}

/* 사다리 유형별 참고 이미지 (서버 getLadderTypeImages()로 1회 로드 후 캐시) */
let LADDER_IMAGES_LOADED=false;
function loadLadderTypeImages(){
  if(LADDER_IMAGES_LOADED)return;
  gsRun('getLadderTypeImages').then(function(map){
    D.ladderTypeImages=map||{};
    LADDER_IMAGES_LOADED=true;
    if(S.screen==='ladder')ladder();
  }).catch(function(){ /* 이미지 없이도 점검은 계속 진행 가능하므로 조용히 무시 */ });
}
function ladderTypeCard(t,selected){
  var img=(D.ladderTypeImages||{})[t];
  /* 사진 부분을 누르면 확대해서 보고, 라벨/카드 영역을 누르면 유형을 선택한다.
     (작은 썸네일만으로는 유형 구분이 어려운 경우가 있어 확대보기를 붙였다) */
  var thumb;
  if(img){
    var zoomClick="zoomImage('"+t+"');event.stopPropagation();return false;";
    thumb='<img src="'+img+'" alt="'+esc(t)+'" onclick="'+zoomClick+'">';
  }else{
    thumb='<span class="ladder-type-noimg">📷</span>';
  }
  /* onclick 문자열은 큰따옴표로 감싸서 만들고, 그 안에서 함수 인자 구분은 작은따옴표를 쓴다. */
  /* (백슬래시로 따옴표를 이스케이프하는 방식은 피한다 - 이전에 파서 문제를 일으킨 적이 있음) */
  var onclick="toggleLadderType('"+t+"')";
  return '<button class="ladder-type-card'+(selected?' sel':'')+'" onclick="'+onclick+'">'
    +'<span class="ladder-type-thumb">'+thumb+'</span>'
    +'<span class="ladder-type-label">'+esc(t)+' <small style="font-weight:700;color:#9aa0aa">(사진 탭하면 확대)</small></span>'
    +'</button>';
}
/* 사다리 유형 사진을 전체화면으로 크게 보여준다. */
function zoomImage(typeName){
  var url=(D.ladderTypeImages||{})[typeName];
  if(!url)return;
  var old=document.getElementById('imgZoom');if(old)old.remove();
  var box=document.createElement('div');
  box.id='imgZoom';box.className='img-zoom';
  box.innerHTML='<button class="zoom-close" onclick="closeZoom()">✕</button>'
    +'<img src="'+url+'" alt="'+esc(typeName)+'">'
    +'<div class="zoom-label">'+esc(typeName)+'</div>';
  box.onclick=function(e){if(e.target===box)closeZoom()};
  document.body.appendChild(box);
}
function closeZoom(){var b=document.getElementById('imgZoom');if(b)b.remove()}
function ladder(){
  normalizeState();S.screen='ladder';const st=S.ladder;
  loadLadderTypeImages();
  const total=(st.types||[]).reduce((n,t)=>n+Math.max(0,Number(st.counts[t]||0)),0);
  let body='';
  if(st.step===1){
    body=`<div class="card step-card"><div class="step-head"><span>STEP 1</span><b>사다리 보유현황</b></div>
      <div class="summary"><h2>보유 사다리</h2><button class="guide-btn" onclick="showGuide('ladder')">📋 점검 가이드</button></div>
      <p class="muted">보유한 사다리 유형과 수량만 입력하세요.</p>
      <div class="field"><label>보유 사다리 유형 <button class="guide-btn" style="margin-left:6px" onclick="showLadderTypeGuide()">📷 사진으로 확인</button></label><div class="ladder-type-grid">${D.ladderTypes.map(t=>ladderTypeCard(t,st.types.includes(t))).join('')}</div></div>
      ${st.types.includes('기타')?`<div class="field"><label>기타 사다리 유형명</label><input value="${esc(st.otherType)}" onchange="S.ladder.otherType=this.value;save()"></div>`:''}
      ${st.types.length?`<div class="grid">${st.types.map(t=>`<div class="field"><label>${t==='기타'?(st.otherType||'기타'):t} 수량</label><input type="number" min="0" value="${esc(st.counts[t]??1)}" oninput="setLadderCount('${t}',this.value)"></div>`).join('')}</div>`:''}
      <div class="notice"><b>총 보유수량 <span id="ladderTotal">${total}</span>대</b></div>
      <div class="grid" style="margin-top:10px">
        <button class="secondary" onclick="work()">← 작업유형으로</button>
        <button class="primary" onclick="ladderInventoryNext()">다음 →</button>
      </div>
      <button class="secondary wide" style="margin-top:8px" onclick="noLadder()">보유 사다리 없음</button></div>`;
  }else if(st.step===2){
    body=`<div class="card step-card"><div class="step-head"><span>STEP 2</span><b>사다리 이상유무</b></div>
      <div class="summary"><h2>사다리 상태 확인</h2><button class="guide-btn" onclick="showGuide('ladder')">📋 점검 가이드</button></div>
      <p class="muted">보유 사다리를 확인한 뒤 이상유무만 선택하세요.</p>
      <div class="status-choice">
        <button class="status-good ${st.status==='good'?'selected':''}" onclick="S.ladder.status='good';save();ladder()"><b>✓ 이상 없음</b><small>사다리 점검 전체를 양호로 처리합니다.</small></button>
        <button class="status-bad ${st.status==='bad'?'selected':''}" onclick="S.ladder.status='bad';save();ladder()"><b>! 이상 있음</b><small>발견한 이상사항만 등록합니다.</small></button>
      </div>
      <div class="grid"><button class="secondary" onclick="S.ladder.step=1;save();ladder()">← 보유현황</button><button class="primary" onclick="ladderStatusNext()">다음 →</button></div></div>`;
  }else{
    body=`<div class="card step-card"><div class="step-head"><span>STEP 3</span><b>사다리 이상사항 등록</b></div>
      <div class="summary"><h2>발견된 이상사항</h2><span class="pill bad">${st.issues.length}건</span></div>
      ${st.issues.map((x,i)=>issueCard('ladder',x,i)).join('')}
      <button class="secondary wide" onclick="addIssue('ladder')">＋ 이상사항 추가</button>
      <div class="grid" style="margin-top:10px"><button class="secondary" onclick="S.ladder.step=2;save();ladder()">← 이상유무</button><button class="primary" onclick="finishLadder()">시설·소방 →</button></div></div>`;
  }
  frame(`${tabs('ladder')}${body}`,`사다리 현황<br>STEP 점검`,st.step===1?'보유현황':st.step===2?'이상유무':'이상사항만 기록');
  if(!st.guideSeen)setTimeout(()=>showGuide('ladder'),80);
}
function noLadder(){
  S.ladder.types=[];S.ladder.counts={};S.ladder.issues=[];S.ladder.status='na';S.ladder.step=1;
  S.ladder.checkedAt=new Date().toISOString();S.ladder.checkedBy=S.basic?.inspector||'';
  save();check('facility')
}
function ladderInventoryNext(){
  const total=(S.ladder.types||[]).reduce((n,t)=>n+Math.max(0,Number(S.ladder.counts[t]||0)),0);
  if(!S.ladder.types.length||total<1)return toast('사다리 유형과 보유수량을 입력하세요.');
  S.ladder.step=2;save();ladder()
}
function ladderStatusNext(){
  if(!S.ladder.status)return toast('이상유무를 선택하세요.');
  if(S.ladder.status==='good'){
    S.ladder.issues=[];S.ladder.step=1;S.ladder.checkedAt=new Date().toISOString();S.ladder.checkedBy=S.basic?.inspector||'';
    save();check('facility')
  }
  else{S.ladder.step=3;if(!S.ladder.issues.length)S.ladder.issues.push({id:uid(),type:'',item:'',note:'',files:[]});save();ladder()}
}
function finishLadder(){
  if(!S.ladder.issues.length)return toast('이상사항을 1건 이상 등록하세요.');
  if(S.ladder.issues.find(x=>!x.type||!x.item))return toast('사다리 유형과 이상 항목을 선택하세요.');
  S.ladder.status='bad';S.ladder.step=1;S.ladder.checkedAt=new Date().toISOString();S.ladder.checkedBy=S.basic?.inspector||'';save();check('facility')
}
function toggleLadderType(t){const a=S.ladder.types.indexOf(t);if(a>=0)S.ladder.types.splice(a,1);else{S.ladder.types.push(t);if(S.ladder.counts[t]==null)S.ladder.counts[t]=1}save();ladder()}
/* 수량 입력은 화면 전체를 다시 그리지 않고 '총 보유수량' 숫자만 갱신한다.
   (다시 그리면 입력 중이던 칸에서 커서가 빠져나가 불편함) */
function setLadderCount(t,value){
  S.ladder.counts[t]=Math.max(0,Number(value||0));
  save();
  var el=document.getElementById('ladderTotal');
  if(el){
    var total=(S.ladder.types||[]).reduce(function(n,k){
      return n+Math.max(0,Number(S.ladder.counts[k]||0));
    },0);
    el.textContent=total;
  }
}
function issueCard(kind,x,i){
  const data=kind==='ladder'?D.ladder.map(v=>v[0]):D[kind];
  const types=kind==='ladder'?(S.ladder.types.length?S.ladder.types:D.ladderTypes):[];
  return `<div class="q issue-card">
    ${kind==='ladder'?`<div class="field"><label>사다리 유형</label><select onchange="S.ladder.issues[${i}].type=this.value;save()"><option value="">유형 선택</option>${types.map(t=>{const label=t==='기타'&&S.ladder.otherType?S.ladder.otherType:t;return `<option value="${esc(label)}" ${x.type===label?'selected':''}>${esc(label)}</option>`}).join('')}</select></div>`:''}
    <div class="field"><label>이상 항목</label><select onchange="S.${kind}.issues[${i}].item=this.value;save()"><option value="">항목 선택</option>${data.map(v=>`<option ${x.item===v?'selected':''}>${v}</option>`).join('')}<option ${x.item==='기타'?'selected':''}>기타</option></select></div>
    <div class="field"><label>추가 설명 <small>(선택)</small></label><textarea placeholder="사진만으로 설명이 어려운 경우 입력" onchange="S.${kind}.issues[${i}].note=this.value;save()">${esc(x.note||'')}</textarea></div>
    <div class="field"><label>사진</label><label class="photo-picker"><span class="camera-emoji">📷</span><span><b>사진 촬영·추가</b><small>이상사항 사진을 첨부하세요</small></span><input class="photo-input" type="file" accept="image/*" multiple onchange="attachIssuePhotos('${kind}',${i},this)"></label>${renderPhotoList(x.files,'issue',kind+'|'+i)}</div>
    <button class="danger wide" onclick="S.${kind}.issues.splice(${i},1);save();${kind==='ladder'?'ladder()':`check('${kind}')`}">이 항목 삭제</button>
  </div>`
}
function addIssue(kind){S[kind].issues.push({id:uid(),type:'',item:'',note:'',files:[]});save();kind==='ladder'?ladder():check(kind)}
async function attachIssuePhotos(kind,i,input){
  const n=input.files.length;toast('사진 압축 중...');
  const added=await attachPhotos(input.files);
  S[kind].issues[i].files=[...(S[kind].issues[i].files||[]),...added];save();
  toast(`${n}개 사진 선택됨`);
  kind==='ladder'?ladder():check(kind);
}
function voiceQuestions(){const x=[...D.voice];(S.store.accidents||[]).forEach(a=>x.push([`사고사례 "${a}"에 대해 안내받았습니까?`,['안내받음','일부만 알고 있음','안내받지 못함']]));(S.store.tasks||[]).forEach(a=>x.push([`기존 개선과제 "${a}"가 개선되었다고 느낍니까?`,['개선됨','일부 개선','개선되지 않음']]));return x}

function ensureVoiceDefaults(workerIndex){
  const w=S.workers[workerIndex];
  w.answers=w.answers||{};
  if(!Number.isInteger(w.qi)||w.qi<0)w.qi=0;
  save();
}

function voice(){S.screen='voice';ensureVoiceDefaults(S.worker);const w=S.workers[S.worker],qs=voiceQuestions(),q=qs[w.qi];frame(`${tabs('voice')}<div class="card"><div class="worker-head"><h2>근로자 ${S.worker+1} 익명 의견</h2><span class="pill">${w.qi+1}/${qs.length}</span></div><div class="muted">이름·사번·업무구분을 받지 않습니다.</div><div class="stepdots"><i style="width:${(w.qi+1)/qs.length*100}%"></i></div><div class="q"><h3>${q[0]}</h3><div class="answers">${q[1].map((o,i)=>`<button class="ans ${w.answers[w.qi]?.oi===i?'sel':''}" onclick="pickVoice(${i})">${o}</button>`).join('')}</div>${q[1][w.answers[w.qi]?.oi]==='기타'?`<textarea placeholder="기타 의견" onchange="S.workers[S.worker].answers[S.workers[S.worker].qi].text=this.value;save()">${esc(w.answers[w.qi]?.text)}</textarea>`:''}</div><div class="grid"><button class="secondary" onclick="voicePrev()">← 이전</button><button class="primary" onclick="voiceNext()">${w.qi===qs.length-1?'완료':'다음 →'}</button></div></div>${S.workers.length>1?`<div class="card"><b>참여 근로자 ${S.workers.length}명</b><div class="tabs" style="margin-top:9px">${S.workers.map((_,i)=>`<button class="tab ${i===S.worker?'active':''}" onclick="S.worker=${i};voice()">근로자 ${i+1}</button>`).join('')}</div></div>`:''}`,`근로자 의견청취`,`한 질문씩 진행 · 사고/미조치 과제 질문 자동 추가`);appendWorkerDeleteButton()}
/* 의견청취 진행 중에도 현재 근로자를 삭제할 수 있게, 화면이 그려진 뒤 버튼을 붙인다. */
/* (voice()의 긴 템플릿 문자열에 직접 넣으면 파서가 깨지는 문제가 있어 DOM으로 추가) */
function appendWorkerDeleteButton(){
  if(S.workers.length<2)return;
  var cards=document.querySelectorAll('.content .card');
  var target=cards[cards.length-1];
  if(!target)return;
  var btn=document.createElement('button');
  btn.className='danger wide';
  btn.style.marginTop='8px';
  btn.textContent='현재 근로자 삭제';
  btn.onclick=function(){
    if(confirm('근로자 '+(S.worker+1)+'의 응답을 삭제할까요?'))removeWorker();
  };
  target.appendChild(btn);
}
function pickVoice(oi){const w=S.workers[S.worker];w.answers[w.qi]={oi};voice()}function voicePrev(){const w=S.workers[S.worker];if(w.qi){w.qi--;voice()}else check('tbm')}function voiceNext(){const w=S.workers[S.worker],n=voiceQuestions().length;if(!w.answers[w.qi])return toast('답변을 선택하세요');if(w.qi<n-1){w.qi++;voice()}else workerDone()}
function workerDone(){frame(`${tabs('voice')}<div class="card"><h2>근로자 ${S.worker+1} 의견청취 완료</h2><p class="muted">응답은 익명으로 저장되며 최종 결과에는 대표의견과 기타의견으로 요약됩니다.</p><button class="primary wide" onclick="addWorker()">＋ 근로자 추가</button><button class="secondary wide" style="margin-top:8px" onclick="other()">의견청취 종료 →</button>${S.workers.length>1?`<button class="danger wide" style="margin-top:8px" onclick="removeWorker()">현재 근로자 삭제</button>`:''}</div>`,`의견청취 완료`,`인원 제한 없이 추가할 수 있습니다.`)}function addWorker(){S.workers.push({answers:{},qi:0});S.worker=S.workers.length-1;voice()}
function removeWorker(){
  if(S.workers.length<2)return toast('최소 1명은 필요합니다.');
  S.workers.splice(S.worker,1);
  S.worker=Math.min(S.worker,S.workers.length-1);
  save();voice();
}
function prevVoice(){
  const w=S.workers[S.worker];
  if(w&&w.qi>0){w.qi--;save();voice();return}
  if(S.worker>0){S.worker--;const pw=S.workers[S.worker];pw.qi=Math.max(0,voiceQuestions().length-1);save();voice();return}
  check('tbm')
}
function other(){S.screen='other';frame(`${tabs('other')}<div class="card"><h2>점검자 기타사항</h2><p class="muted">정해진 문항 외 특이사항을 여러 건 기록할 수 있습니다.</p>${S.others.map((x,i)=>`<div class="q"><textarea placeholder="특이사항 내용" onchange="S.others[${i}].text=this.value;save()">${esc(x.text)}</textarea><div class="field"><label>사진</label><label class="photo-picker"><span class="camera-emoji">📷</span><span><b>사진 촬영·추가</b><small>카메라 또는 앨범에서 선택</small></span><input class="photo-input" type="file" accept="image/*" multiple onchange="attachOtherPhotos(${i},this)"></label></div>${renderPhotoList(x.files,'other',i)}<label class="muted"><input style="width:auto" type="checkbox" ${x.task?'checked':''} onchange="S.others[${i}].task=this.checked;save()"> 개선과제 후보에 포함</label><button class="danger wide" onclick="S.others.splice(${i},1);other()">삭제</button></div>`).join('')}<button class="secondary wide" onclick="S.others.push({id:uid(),text:'',files:[],task:false});other()">＋ 기타사항 추가</button><div class="grid" style="margin-top:8px"><button class="secondary" onclick="voice()">← 이전</button>${hasPastTasks()?`<button class="primary" onclick="tasks()">조치확인 →</button>`:`<button class="primary" onclick="finalSubmit()">최종 제출 →</button>`}</div></div>`,`기타사항`,`정해진 문항 외 내용과 사진을 기록합니다.`)}
async function attachOtherPhotos(i,input){
  const n=input.files.length;toast('사진 압축 중...');
  const added=await attachPhotos(input.files);
  S.others[i].files=[...(S.others[i].files||[]),...added];save();
  toast(`${n}개 사진 선택됨`);
  other();
}
/* ============ 개선과제 = 과거 지적사항의 조치 확인 ============
 * 이번 점검에서 발견한 미흡은 개선과제로 만들지 않는다 (결과보고서에서만 확인).
 * 개선과제 탭은 "지난 점검에서 지적된 것이 조치됐는지" + "과거 사고이력에 대한
 * 재발방지 확인"을 체크하는 화면이다.
 * 과거 이력과 사고이력이 모두 없으면(=첫 점검) 이 탭 자체를 건너뛴다.
 */
function syncTasks(){
  var map={};
  /* 1) 지난 점검에서 남은 미조치 지적사항 (이슈상세 시트의 '조치대기') */
  (S.store.openIssues||[]).forEach(function(x,i){
    var key='past|'+i;
    map[key]={key:key,title:x.title,source:'지난 지적사항',date:x.date||'',
              owner:'매장 자체조치',status:'조치대기',include:true};
  });
  /* 2) 과거 사고이력 기반 재발방지 확인 */
  (S.store.accidentRecords||[]).forEach(function(a,i){
    var key='acc|'+i;
    var label=(a.type||'사고')+' 재발방지 조치 확인';
    map[key]={key:key,title:label,source:'사고이력',date:a.date||'',
              detail:a.content||'',approved:a.approved||'',
              owner:'매장 자체조치',status:'조치대기',include:true};
  });
  /* 점검자가 이미 수정한 값(상태/책임구분/포함여부)은 그대로 유지 */
  var prev={};(S.tasks||[]).forEach(function(t){if(t.key)prev[t.key]=t});
  S.tasks=Object.keys(map).map(function(key){
    return prev[key]?Object.assign({},map[key],prev[key]):map[key];
  });
  save();
}
/* 개선과제 탭을 보여줄 필요가 있는지 (과거 이력이 하나라도 있으면 true) */
function hasPastTasks(){
  return ((S.store.openIssues||[]).length+(S.store.accidentRecords||[]).length)>0;
}
function tasks(){
  S.screen='tasks';
  syncTasks();
  var i,j;
  var h=tabs('tasks');
  h+='<div class="card"><h2>과거 지적사항 조치 확인</h2>';
  h+='<p class="muted">지난 점검에서 지적된 사항과 과거 사고이력에 대해 조치가 되었는지 확인합니다. 이번 점검에서 새로 발견한 미흡사항은 결과보고서에서 확인할 수 있습니다.</p>';

  if(!S.tasks.length){
    h+='<div class="notice">이 매장은 과거 지적사항과 사고이력이 없습니다. 첫 점검이거나 모두 조치 완료된 상태입니다.</div>';
  }else{
    for(i=0;i<S.tasks.length;i++){
      var x=S.tasks[i];
      h+='<div class="q">';
      h+='<div class="summary"><b>'+esc(x.title)+'</b>';
      h+='<span class="pill'+(x.source==='사고이력'?' bad':'')+'">'+esc(x.source)+'</span></div>';
      if(x.date)h+='<div class="muted">'+esc(x.date)+(x.approved==='Y'?' · 산재승인':'')+'</div>';
      if(x.detail)h+='<div class="muted" style="margin-top:5px">'+esc(x.detail)+'</div>';
      h+='<div class="grid" style="margin-top:9px">';
      h+='<div class="field"><label>책임구분</label><select onchange="setTaskField('+i+',\'owner\',this.value)">';
      var owners=['매장 자체조치','타부서 조치','공동조치'];
      for(j=0;j<owners.length;j++){
        h+='<option'+(x.owner===owners[j]?' selected':'')+'>'+owners[j]+'</option>';
      }
      h+='</select></div>';
      h+='<div class="field"><label>조치 상태</label><select onchange="setTaskField('+i+',\'status\',this.value)">';
      var statuses=['조치대기','조치완료'];
      for(j=0;j<statuses.length;j++){
        h+='<option'+(x.status===statuses[j]?' selected':'')+'>'+statuses[j]+'</option>';
      }
      h+='</select></div>';
      h+='</div></div>';
    }
  }

  h+='<div class="grid" style="margin-top:10px">';
  h+='<button class="secondary" onclick="other()">← 이전</button>';
  h+='<button class="primary" onclick="finalSubmit()">최종 제출 →</button>';
  h+='</div></div>';

  frame(h,'과거 지적사항<br>조치 확인','지난 지적사항과 사고이력의 조치 여부를 확인합니다.');
}
function setTaskField(i,field,value){S.tasks[i][field]=value;save()}

function completionState(){
  const missing=[];
  D.works.forEach((w,wi)=>{
    if(S.workNA?.[wi])return;
    if(!S.workChecked?.[wi])missing.push({kind:'work',wi,label:`작업점검 · ${w[0]}`});
  });
  if(!['good','bad','na'].includes(S.ladder.status))missing.push({kind:'ladder',label:'사다리 점검'});
  if(!['good','bad'].includes(S.facility.status))missing.push({kind:'facility',label:'시설·소방 점검'});
  if(!['good','bad'].includes(S.tbm.status))missing.push({kind:'tbm',label:'TBM 점검'});
  const qs=voiceQuestions();
  const workersOk=(S.workers||[]).length>0 && S.workers.every(w=>qs.every((_,i)=>w.answers&&w.answers[i]));
  if(!workersOk)missing.push({kind:'voice',label:'근로자 의견청취'});
  return missing;
}
function jumpToMissing(m){
  if(!m)return;
  if(m.kind==='work'){S.wi=m.wi;work();return}
  if(m.kind==='ladder'){ladder();return}
  if(m.kind==='facility'){check('facility');return}
  if(m.kind==='tbm'){check('tbm');return}
  if(m.kind==='voice'){voice();return}
}
/* PHOTO_STORE(브라우저 메모리)에서 실제 사진 데이터를 꺼내온다. */
function resolvePhotos(list){
  return (list||[]).map(p=>PHOTO_STORE.get(p.id)).filter(Boolean).map(p=>({name:p.name,dataUrl:p.dataUrl}));
}
/* 서버(submitInspection)로 보낼 payload를 구성한다. */
/* 사진이 있는 이슈만 issues 배열에 담는다 (정상 항목은 폴더 자체가 안 생기도록). */
function buildSubmitPayload(){
  const issues=[];
  D.works.forEach((w,wi)=>{
    Object.values(S.wa[wi]||{}).filter(x=>x.risk&&x.files&&x.files.length).forEach(x=>{
      issues.push({category:'작업점검',itemName:w[0],note:x.note||'',hazard:(x.hazards||[]).join('/'),photos:resolvePhotos(x.files)});
    });
  });
  (S.ladder.issues||[]).filter(x=>x.files&&x.files.length).forEach(x=>{
    issues.push({category:'사다리',itemName:`${x.type||''} ${x.item||'이상사항'}`.trim(),note:x.note||'',hazard:'떨어짐',photos:resolvePhotos(x.files)});
  });
  (S.facility.issues||[]).filter(x=>x.files&&x.files.length).forEach(x=>{
    issues.push({category:'시설소방',itemName:x.item||'미흡사항',note:x.note||'',hazard:'시설·소방',photos:resolvePhotos(x.files)});
  });
  (S.tbm.issues||[]).filter(x=>x.files&&x.files.length).forEach(x=>{
    issues.push({category:'TBM',itemName:x.item||'미흡사항',note:x.note||'',hazard:'안전관리',photos:resolvePhotos(x.files)});
  });
  S.others.filter(x=>x.files&&x.files.length).forEach(x=>{
    issues.push({category:'기타사항',itemName:x.text||'기타사항',note:'',hazard:'기타',photos:resolvePhotos(x.files)});
  });

  const c=calc();
  return {
    store:S.store.name, division:S.basic.hq||'', dept:S.basic.dept||'', team:S.basic.team||'',
    inspector:S.basic.inspector||'', date:S.basic.date||new Date().toISOString().slice(0,10),
    workRisk:c.work, ladderCount:c.lm, facilityCount:c.fm, tbmCount:c.tm,
    tasks:S.tasks.filter(x=>x.include), resultNote:S.resultNote||'', issues
  };
}
function finalSubmit(){
  const missing=completionState();
  if(missing.length){
    const first=missing[0];
    if(confirm(`아직 완료하지 않은 점검이 있습니다.\n\n${first.label}\n\n미완료 항목으로 이동할까요?`))jumpToMissing(first);
    return;
  }
  syncTasks();
  S.submittedAt=new Date().toISOString();S.submittedBy=S.basic?.inspector||'';save();
  submitToServer();
}
function submitToServer(){
  S.screen='result';
  frame(`<div class="card"><h2>제출 처리 중입니다...</h2><div class="loading-notice">사진 업로드와 결과보고서 생성에 시간이 걸릴 수 있습니다. 창을 닫지 마세요.</div></div>`,`결과보고서 생성 중`);
  const payload=buildSubmitPayload();
  gsRun('submitInspection',payload).then(links=>{
    S.resultLinks=links;save();
    report();
  }).catch(err=>{
    toast('제출 중 오류: '+(err&&err.message?err.message:String(err)));
    report(); // 저장은 실패했어도 로컬 결과화면은 보여준다 (재시도는 최종 제출을 다시 누르면 됨)
  });
}
function calc(){const work=D.works.map((w,i)=>{if(S.workNA?.[i])return{name:w[0],risk:0,total:0,status:'na'};const a=Object.values(S.wa[i]||{}),r=a.filter(x=>x.risk).length;return{name:w[0],risk:r,total:a.length,status:'checked'}});const haz={};Object.entries(S.wa).forEach(([wi,ans])=>{if(S.workNA?.[wi])return;Object.values(ans).filter(x=>x.risk).forEach(x=>(x.hazards||[]).forEach(h=>haz[h]=(haz[h]||0)+1))});const fm=(S.facility.issues||[]).length,tm=(S.tbm.issues||[]).length,lm=(S.ladder.issues||[]).length;return{work,haz:Object.entries(haz).sort((a,b)=>b[1]-a[1]),fm,tm,lm}}
/* 이번 점검에서 새로 발견한 지적사항 목록 (결과보고서에서만 보여준다) */
function buildFoundIssuesHtml(){
  var rows=[],i;
  D.works.forEach(function(w,wi){
    if(S.workNA&&S.workNA[wi])return;
    var ans=S.wa[wi]||{};
    Object.keys(ans).forEach(function(qi){
      var v=ans[qi];
      if(!v||!v.risk)return;
      rows.push({cat:w[0],text:(v.note||'').trim()||w[1][qi][0],hazard:(v.hazards||[]).join('/')});
    });
  });
  (S.ladder.issues||[]).forEach(function(x){
    rows.push({cat:'사다리',text:((x.type||'')+' '+(x.item||'이상사항')).trim(),hazard:'떨어짐'});
  });
  (S.facility.issues||[]).forEach(function(x){
    rows.push({cat:'시설·소방',text:x.item||'미흡사항',hazard:'시설·소방'});
  });
  (S.tbm.issues||[]).forEach(function(x){
    rows.push({cat:'TBM',text:x.item||'미흡사항',hazard:'안전관리'});
  });
  (S.others||[]).filter(function(x){return (x.text||'').trim()}).forEach(function(x){
    rows.push({cat:'기타사항',text:x.text,hazard:'기타'});
  });

  var h='<h2 style="margin-top:16px">이번 점검 지적사항 ('+rows.length+'건)</h2>';
  if(!rows.length)return h+'<p class="muted">이번 점검에서 발견된 지적사항이 없습니다.</p>';
  for(i=0;i<rows.length;i++){
    h+='<div class="q"><b>'+esc(rows[i].text)+'</b><div class="muted">'+esc(rows[i].cat)+' · '+esc(rows[i].hazard)+'</div></div>';
  }
  return h;
}
function report(){S.screen='result';const c=calc(),active=S.tasks.filter(x=>x.include),top=[...c.work].filter(x=>x.status!=='na').sort((a,b)=>b.risk-a.risk).slice(0,3),responses=S.workers.length,submittedText=S.submittedAt?`${new Date(S.submittedAt).toLocaleDateString('ko-KR')} · ${esc(S.submittedBy||'')} 제출`:'';
  const links=S.resultLinks;
  const linksHtml=links?`<div class="notice"><b>저장 완료</b><br>${links.pdfUrl?`<a href="${esc(links.pdfUrl)}" target="_blank">📄 결과 PDF 열기</a><br>`:''}${links.folderUrl?`<a href="${esc(links.folderUrl)}" target="_blank">📁 점검 폴더 열기</a>`:''}</div>`:'';
  const foundHtml=buildFoundIssuesHtml();
  frame(`${tabs('result')}<div class="card"><h2>${esc(S.store.name)} 안전보건 현장진단 결과</h2>${submittedText?`<p class="muted">${submittedText}</p>`:''}${linksHtml}<div class="notice"><b>공식 점수·등급은 아직 산출하지 않습니다.</b><br>현재는 확인된 위험신호와 미흡사항 건수를 중심으로 보여줍니다.</div><div class="metric"><div><b>${responses}</b>의견 참여</div><div><b>${c.fm}</b>시설 미흡</div><div><b>${c.lm}</b>사다리 이상</div><div><b>${c.tm}</b>TBM 미흡</div><div><b>${active.length}</b>개선과제</div></div></div><div class="card"><h2>작업유형 위험신호</h2>${c.work.map(x=>`<div class="riskrow"><header><span>${x.name}</span><span>${x.status==='na'?'해당 없음':`위험신호 ${x.risk}건`}</span></header></div>`).join('')}</div><div class="card"><h2>재해유형별 위험신호</h2>${c.haz.length?c.haz.map(([h,n])=>`<div class="riskrow"><header><span>${h}</span><span>${n}건</span></header></div>`).join(''):'<p class="muted">위험신호 없음</p>'}</div><div class="card"><h2>종합진단 초안</h2><textarea readonly>${esc(`${S.store.name}은(는) ${top.filter(x=>x.risk).map(x=>x.name).join(', ')||'전 작업'} 영역을 중심으로 확인되었습니다. 시설·소방 미흡 ${c.fm}건, TBM 미흡 ${c.tm}건, 사다리 이상 ${c.lm}건이며 개선과제 ${active.length}건을 검토해야 합니다.`)}</textarea><div class="field" style="margin-top:10px"><label>점검자 추가 의견 <small>(선택)</small></label><textarea placeholder="위 자동 진단에 덧붙일 내용을 입력하세요" onchange="S.resultNote=this.value;save()">${esc(S.resultNote)}</textarea></div>${foundHtml}<h2 style="margin-top:16px">과거 지적사항 조치 확인</h2>${active.map(x=>`<div class="q"><b>${esc(x.title)}</b><div class="muted">${esc(x.source||'')} · ${esc(x.owner||'')} · ${esc(x.status||'')}</div></div>`).join('')||'<p class="muted">과거 지적사항 없음</p>'}<button class="secondary wide" onclick="go('tasks')">← 이전</button><button class="secondary wide" style="margin-top:8px" onclick="window.print()">보고서 인쇄</button><button class="danger wide" style="margin-top:8px" onclick="resetAll()">새 점검 시작</button></div>`,`결과보고서`,`공식 점수·상중하 등급은 가중치 확정 후 적용합니다.`)}
function resetAll(){if(confirm('저장된 점검 내용을 지우고 새로 시작할까요?')){localStorage.removeItem(KEY);S=fresh();normalizeState();STORE_LIST=null;PHOTO_STORE.clear();start()}}

/* ============ 대시보드 ============ */
var DASH_PERIOD='all'; // 'all' | 'thisMonth' | 'lastMonth'
var DASH_STORE='';     // 매장 이력조회에서 선택된 매장명

function openDashboard(){
  frame('<div class="card"><div class="loading-notice">대시보드를 불러오는 중입니다...</div></div>','안전보건 점검<br>대시보드','점검 결과를 모아봅니다.');
  gsRun('getDashboardData',DASH_PERIOD).then(function(data){
    renderDashboard(data);
  }).catch(function(err){
    frame('<div class="card"><h2>불러오지 못했습니다</h2><div class="notice">'+esc(err&&err.message?err.message:String(err))+'</div><button class="secondary wide" onclick="start()">시작화면으로</button></div>','대시보드','오류');
  });
}
function periodLabel(p){return p==='thisMonth'?'이번달':(p==='lastMonth'?'지난달':'전체기간')}

function renderDashboard(data){
  var s=data.summary;
  var i;

  /* 1) 전체 요약 + 기간 필터 */
  var html='<div class="card"><h2>전체 요약 ('+periodLabel(DASH_PERIOD)+')</h2>';
  html+='<div class="tabs" style="margin:6px 0 12px">';
  var periods=['all','thisMonth','lastMonth'];
  for(i=0;i<periods.length;i++){
    var p=periods[i];
    html+='<button class="tab '+(DASH_PERIOD===p?'active':'')+'" onclick="setDashPeriod(\''+p+'\')">'+periodLabel(p)+'</button>';
  }
  html+='</div>';
  html+='<div class="metric">'
    +'<div><b>'+s.inspectionCount+'</b>점검 건수</div>'
    +'<div><b>'+s.totalRiskSignals+'</b>위험신호</div>'
    +'<div><b>'+s.openTaskCount+'</b>미해결 과제</div>'
    +'</div></div>';

  /* 2) 매장 이력 조회 */
  html+='<div class="card"><h2>매장 이력 조회</h2>';
  html+='<div class="field"><label>매장 선택</label><select onchange="onDashStoreChange(this.value)">';
  html+='<option value="">매장을 선택하세요 ('+data.storeNames.length+'개)</option>';
  for(i=0;i<data.storeNames.length;i++){
    var nm=data.storeNames[i];
    html+='<option'+(nm===DASH_STORE?' selected':'')+'>'+esc(nm)+'</option>';
  }
  html+='</select></div><div id="dashStoreHistory">';
  html+=DASH_STORE?'<div class="loading-notice">불러오는 중입니다...</div>':'<p class="muted">매장을 선택하면 과거 점검 이력이 최신순으로 표시됩니다.</p>';
  html+='</div></div>';

  /* 3) 부서 취약점 비교 */
  html+='<div class="card"><h2>부서·팀 취약점 비교</h2>';
  if(data.deptRanking.length){
    var maxRisk=data.deptRanking[0].riskSignals||1;
    for(i=0;i<data.deptRanking.length;i++){
      var d=data.deptRanking[i];
      var pct=Math.round(d.riskSignals/maxRisk*100);
      html+='<div class="rank-row"><div class="rank-num">'+(i+1)+'</div>'
        +'<div class="rank-info"><div class="rank-name">'+esc(d.dept)+'</div>'
        +'<div class="rank-bar"><i style="width:'+pct+'%"></i></div></div>'
        +'<div class="rank-value">위험신호 '+d.riskSignals+'건</div></div>';
    }
  }else{ html+='<p class="muted">데이터 없음</p>'; }
  html+='</div>';

  /* 4) 재해유형 TOP */
  html+='<div class="card"><h2>재해유형 TOP</h2>';
  if(data.hazardTop.length){
    for(i=0;i<data.hazardTop.length;i++){
      var hz=data.hazardTop[i];
      html+='<div class="riskrow"><header><span>'+esc(hz.hazard)+'</span><span>'+hz.count+'건</span></header></div>';
    }
  }else{ html+='<p class="muted">위험신호 없음</p>'; }
  html+='</div>';

  /* 5) 미해결 개선과제 */
  html+='<div class="card"><h2>미해결 개선과제 현황</h2>';
  if(data.openTasks.length){
    for(i=0;i<data.openTasks.length;i++){
      var t=data.openTasks[i];
      html+='<div class="q"><b>'+esc(t.item)+'</b><div class="muted">'+esc(t.store)+' · '+esc(t.category)+' · '+esc(t.date)+'</div></div>';
    }
  }else{ html+='<p class="muted">미해결 과제가 없습니다.</p>'; }
  html+='</div>';

  html+='<div class="card">'
    +'<button class="secondary wide" onclick="toast(\'종합 보고서 PDF는 테스트 중입니다.\')">📄 종합 보고서 PDF</button>'
    +'<button class="secondary wide" style="margin-top:8px" onclick="start()">시작화면으로</button>'
    +'</div>';

  frame(html,'안전보건 점검<br>대시보드','점검 결과를 부서·매장 기준으로 모아봅니다.');
  if(DASH_STORE)loadDashStoreHistory(DASH_STORE);
}

function setDashPeriod(p){DASH_PERIOD=p;openDashboard()}

function onDashStoreChange(name){
  DASH_STORE=name;
  var el=$('#dashStoreHistory');
  if(!el)return;
  if(!name){el.innerHTML='<p class="muted">매장을 선택하면 과거 점검 이력이 최신순으로 표시됩니다.</p>';return}
  el.innerHTML='<div class="loading-notice">불러오는 중입니다...</div>';
  loadDashStoreHistory(name);
}

function loadDashStoreHistory(name){
  gsRun('getStoreDashboardHistory',name).then(function(rows){
    var el=$('#dashStoreHistory');
    if(!el)return;
    if(!rows||!rows.length){el.innerHTML='<p class="muted">이 매장의 점검 이력이 아직 없습니다.</p>';return}
    var h='';
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      h+='<div class="q"><div class="summary"><b>'+esc(r.date)+'</b><span class="muted">'+esc(r.inspector)+'</span></div>'
        +'<div class="muted">위험신호 '+r.workRisk+' · 사다리 '+r.ladder+' · 시설 '+r.facility+' · TBM '+r.tbm
        +' · 개선과제 '+r.taskDone+'/'+r.taskCount+'</div>';
      if(r.folderUrl)h+='<a href="'+esc(r.folderUrl)+'" target="_blank">📁 점검 폴더 열기</a>';
      h+='</div>';
    }
    el.innerHTML=h;
  }).catch(function(err){
    var el=$('#dashStoreHistory');
    if(el)el.innerHTML='<div class="notice">이력을 불러오지 못했습니다: '+esc(err&&err.message?err.message:String(err))+'</div>';
  });
}
function render(x){({start,basic,work,ladder,facility:()=>check('facility'),tbm:()=>check('tbm'),voice,other,tasks,result:report}[x]||start)()}
try{
  render(S.screen);
}catch(err){
  console.error(err);
  root.innerHTML=`<div class="app"><header class="hero"><div class="eyebrow">ASUNG DAISO · SAFETY & HEALTH</div><h1>실행 오류를 확인했습니다.</h1><p>저장된 테스트 데이터 또는 브라우저 상태를 초기화할 수 있습니다.</p></header><main class="content"><div class="card"><h2>로컬 실행 오류</h2><div class="notice">${esc(err&&err.message?err.message:String(err))}</div><button class="primary wide" onclick="localStorage.removeItem(KEY);S=fresh();normalizeState();STORE_LIST=null;start()">테스트 데이터 초기화 후 시작</button></div></main></div>`;
}
