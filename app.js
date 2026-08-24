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
const $=s=>document.querySelector(s),root=$('#app'),KEY='daiso_safety_v9';
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const fresh=()=>({screen:'start',store:null,basic:{date:new Date().toISOString().slice(0,10),inspector:'',hq:'',dept:'',team:'',people:'',size:'',floors:'',delivery:'',inboundHelpers:''},wi:0,wa:{},ladder:{types:[],counts:{},otherType:'',issues:[],guideSeen:false,step:1,status:''},common:{issues:[],status:''},fire:{issues:[],status:''},tbm:{issues:[],status:''},workers:[{answers:{}}],worker:0,others:[],tasks:[],accidents:[]});
let S=(()=>{try{return JSON.parse(localStorage.getItem(KEY))||fresh()}catch(e){return fresh()}})();
function normalizeState(){
  const f=fresh();
  if(!S||typeof S!=='object')S=f;
  S.basic={...f.basic,...(S.basic||{})};
  S.wa=S.wa||{};
  S.tbm=S.tbm||{};
  S.workers=Array.isArray(S.workers)&&S.workers.length?S.workers:f.workers;
  S.worker=Number.isInteger(S.worker)?S.worker:0;
  S.others=Array.isArray(S.others)?S.others:[];
  S.others.forEach(o=>{if(!o.id)o.id=uid()});
  S.tasks=Array.isArray(S.tasks)?S.tasks:[];
  S.inspectionId=S.inspectionId||'';
  /* 사고조사 탭 데이터 (과거 사고별 원인/재발방지 확인) */
  S.accidents=Array.isArray(S.accidents)?S.accidents:[];
  S.accidents.forEach(a=>{
    a.afterFiles=Array.isArray(a.afterFiles)?a.afterFiles:[];
    delete a.beforeFiles;
    delete a.files;
  });
  S.ladder=S.ladder||{};
  S.ladder.types=Array.isArray(S.ladder.types)?S.ladder.types:[];
  S.ladder.counts=S.ladder.counts||{};
  /* 유형별 양호/미흡 상태 (예: {'신형 사다리':'good','A형':'bad'}) */
  S.ladder.typeStatus=S.ladder.typeStatus||{};
  S.ladder.otherType=S.ladder.otherType||'';
  S.ladder.issues=Array.isArray(S.ladder.issues)?S.ladder.issues:[];
  /* typeKey는 유형별 인라인 입력을 위해 나중에 추가된 항목이다.
     예전에 저장된 데이터에는 없으므로 type(표시명)으로 되짚어 채운다. */
  S.ladder.issues.forEach(x=>{
    if(!x.id)x.id=uid();
    if(!x.typeKey){
      if(x.type&&D.ladderTypes.indexOf(x.type)>=0)x.typeKey=x.type;
      else if(x.type&&S.ladder.otherType&&x.type===S.ladder.otherType)x.typeKey='기타';
      else x.typeKey='';
    }
  });
  S.ladder.guideSeen=!!S.ladder.guideSeen;S.ladder.step=Number(S.ladder.step||1);S.ladder.status=S.ladder.status||'';
  /* 공통·시설 / 소방 / TBM은 체크리스트형이라 STEP 구분이 없다.
     예전(v8 이전) 데이터에 시설·소방이 하나로 합쳐져 있던 경우, 공통·시설 쪽으로 옮겨둔다. */
  const legacyFacility=(S.facility&&Array.isArray(S.facility.issues))?S.facility.issues:null;
  if(!S.common||Array.isArray(S.common))S.common={issues:legacyFacility||[]};
  S.common.issues=Array.isArray(S.common.issues)?S.common.issues:[];
  S.common.naItems=S.common.naItems||{};
  S.common.issues.forEach(x=>{if(!x.id)x.id=uid()});
  S.common.status=S.common.status||'';
  if(!S.fire||Array.isArray(S.fire))S.fire={issues:[]};
  S.fire.issues=Array.isArray(S.fire.issues)?S.fire.issues:[];
  S.fire.naItems=S.fire.naItems||{};
  S.fire.issues.forEach(x=>{if(!x.id)x.id=uid()});
  S.fire.status=S.fire.status||'';
  delete S.facility;
  if(!S.tbm||Array.isArray(S.tbm))S.tbm={issues:[]};
  S.tbm.issues=Array.isArray(S.tbm.issues)?S.tbm.issues:[];
  S.tbm.naItems=S.tbm.naItems||{};
  S.tbm.issues.forEach(x=>{if(!x.id)x.id=uid()});
  S.tbm.status=S.tbm.status||'';
  S.screen=S.screen||'start';
  S.wi=Number.isInteger(S.wi)?S.wi:0;
  /* v32에서 첫 문항의 답변 순서만 뒤집었다. 저장 중인 점검의 의미가 바뀌지 않게 인덱스를 함께 변환한다. */
  if(!S.answerOrderV32){
    const first=S.wa&&S.wa[0]&&S.wa[0][0];
    if(first&&(first.oi===0||first.oi===1)){first.oi=first.oi===0?1:0;first.risk=first.oi===1}
    S.answerOrderV32=true;
  }
  S.workNA=S.workNA||{};
  S.guides=S.guides||{};
  S.audit=S.audit||{};S.workChecked=S.workChecked||{};S.finalValidation=S.finalValidation||{};
  S.submittedAt=S.submittedAt||null;S.submittedBy=S.submittedBy||'';
  S.resultNote=S.resultNote||'';
  S.resultLinks=S.resultLinks||null;
}
normalizeState();
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function save(){localStorage.setItem(KEY,JSON.stringify(S))}function toast(x){const e=$('#toast');e.textContent=x;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1600)}

/* ============ 서버 호출 헬퍼 (Apps Script API를 fetch로 호출) ============ */
/* Apps Script 웹앱(API)을 호출한다.
   API_URL은 config.js에서 설정하며, GitHub Pages에 올린 화면이
   구글 시트/드라이브 작업을 요청할 때 이 함수를 통해 통신한다. */
/* 테스트 모드: 구글시트/드라이브에 연결하지 않고 화면 흐름만 확인할 때 켠다.
   서버 호출을 전부 가짜 응답으로 대신하므로 시트에 아무것도 기록되지 않는다. */
let TEST_MODE=false;
function isApiConfigured(){
  var u=window.API_URL||'';
  return !!u && u.indexOf('PASTE_YOUR')<0 && u.indexOf('http')===0;
}
function mockServer(fnName,args){
  if(fnName==='getStoreList')return D.sampleStores;
  if(fnName==='getStoreAccidentHistory'){
    /* 사고이력이 있는 매장 화면도 확인할 수 있도록 첫 번째 매장만 샘플을 준다. */
    if(args[0]==='테스트 강남점')return [
      {date:'2025-11-14',type:'넘어짐',content:'후방 통로 적재물에 걸려 넘어짐',source:'후방 통로 적재물',approved:'Y',lostDays:5},
      {date:'2025-06-02',type:'베임',content:'박스 개봉 중 커터칼에 손가락 베임',source:'커터칼',approved:'',lostDays:0}
    ];
    return [];
  }
  if(fnName==='getStoreOpenIssues'){
    if(args[0]==='테스트 강남점')return [{date:'2025-11-20',title:'창고·후방 통로 및 적재'}];
    return [];
  }
  if(fnName==='getLadderTypeImages')return {};
  if(fnName==='submitInspection')return {pdfUrl:'',folderUrl:''};
  if(fnName==='getStoreDashboardHistory')return [];
  if(fnName==='getDashboardData')return {summary:{inspectionCount:0,totalRiskSignals:0,openTaskCount:0},storeNames:[],deptRanking:[],hazardTop:[],openTasks:[]};
  return null;
}
function gsRun(fnName){
  var args=Array.prototype.slice.call(arguments,1);
  if(TEST_MODE)return Promise.resolve(mockServer(fnName,args));
  if(!isApiConfigured()){
    return Promise.reject(new Error('config.js의 API_URL이 설정되지 않았습니다. Apps Script 웹앱 배포 URL(.../exec)을 넣어주세요.'));
  }
  var body=JSON.stringify({fn:fnName,args:args,key:(window.API_KEY||'')});
  return fetch(window.API_URL,{
    method:'POST',
    /* text/plain으로 보내면 브라우저가 사전확인(preflight) 요청을 생략해
       Apps Script와의 통신이 단순해진다. 서버에서 JSON으로 파싱한다. */
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:body,
    cache:'no-store',
    redirect:'follow'
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
    k==='ladder'?ladder():checklist(k);return
  }
  if(kind==='other'){S.others[Number(arg)].files.splice(i,1);save();other();return}
  if(kind==='accidentAfter'){S.accidents[Number(arg)].afterFiles.splice(i,1);save();accident();return}
}
async function attachPhotos(fileList){
  const compressed=await compressAll(fileList);
  return compressed.map(p=>{
    const id=uid();
    PHOTO_STORE.set(id,p);
    return {id,name:p.name};
  });
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
  if(S.screen==='voice'){
    parts.push(S.worker);
  }
  return parts.join('|');
}
function frame(body,title='안전보건 현장진단',sub='모바일 현장점검'){
  const viewKey=currentViewKey();
  const sameView=(viewKey===LAST_VIEW_KEY);
  const keepY=sameView?window.scrollY:0;

  /* 테스트 모드에서는 실수로 실제 점검으로 착각하지 않게 항상 눈에 띄는 띠를 붙인다. */
  const testBar=TEST_MODE?'<div class="test-bar">테스트 모드 · 구글시트/드라이브에 저장되지 않습니다</div>':'';

  root.innerHTML=`<div class="app">${testBar}<header class="hero"><div class="hero-top"><div class="hero-logo">SH</div><div class="eyebrow">ASUNG DAISO · SAFETY & HEALTH</div><div class="hero-menu-wrap"><button class="hero-menu-btn" aria-label="메뉴 열기" aria-expanded="false" onclick="toggleMainMenu(event)"><span></span><span></span><span></span></button></div></div><h1>${title}</h1><p>${sub}</p></header><div class="menu-backdrop" id="menuBackdrop" onclick="closeMainMenu()"></div><aside class="hero-menu-panel" id="mainMenu" aria-hidden="true"><div class="menu-head"><div><small>ASUNG DAISO</small><b>안전보건 현장진단</b></div><button class="menu-close" aria-label="메뉴 닫기" onclick="closeMainMenu()">×</button></div><nav><button onclick="menuUnderTest('점검 현황')"><span class="menu-icon">▦</span><span>점검 현황<small>테스트 진행</small></span></button><button class="active" onclick="closeMainMenu();start()"><span class="menu-icon">✓</span><span>매장 점검</span></button><button onclick="menuUnderTest('사고 이력')"><span class="menu-icon">!</span><span>사고 이력<small>테스트 진행</small></span></button></nav><div class="menu-foot">SAFETY &amp; HEALTH · FIELD INSPECTION</div></aside><main class="content">${body}</main><button id="scrollTopBtn" class="scroll-top" onclick="scrollPageTop()" aria-label="맨 위로 이동"><i>↑</i><span>맨 위로</span></button></div>`;

  LAST_VIEW_KEY=viewKey;
  if(sameView){
    /* 다시 그린 직후에 위치를 복원해야 브라우저가 스크롤을 리셋하지 않는다. */
    requestAnimationFrame(function(){window.scrollTo(0,keepY)});
  }else{
    window.scrollTo(0,0);
  }
  requestAnimationFrame(updateScrollTopButton);
  save();
}
function updateScrollTopButton(){const b=document.getElementById('scrollTopBtn');if(b)b.classList.toggle('show',window.scrollY>360)}
function scrollPageTop(){window.scrollTo({top:0,behavior:'smooth'})}
window.addEventListener('scroll',updateScrollTopButton,{passive:true});
function toggleMainMenu(e){
  if(e)e.stopPropagation();
  const m=$('#mainMenu'),b=$('.hero-menu-btn'),back=$('#menuBackdrop');
  if(!m)return;
  const open=m.classList.toggle('open');
  if(back)back.classList.toggle('open',open);
  if(b)b.setAttribute('aria-expanded',open?'true':'false');
  m.setAttribute('aria-hidden',open?'false':'true');
  document.body.classList.toggle('menu-open',open);
}
function closeMainMenu(){
  const m=$('#mainMenu'),b=$('.hero-menu-btn'),back=$('#menuBackdrop');
  if(m)m.classList.remove('open');
  if(m)m.setAttribute('aria-hidden','true');
  if(back)back.classList.remove('open');
  if(b)b.setAttribute('aria-expanded','false');
  document.body.classList.remove('menu-open');
}
function menuUnderTest(name){closeMainMenu();toast(name+' 기능은 현재 테스트 진행 중입니다.')}
function field(label,id,value='',type='text',extra=''){return `<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${extra}></div>`}

/* ============ 매장 선택 (서버에서 실시간 조회) ============ */
let STORE_LIST=null,STORE_LOADING=false; // 매장 목록 메모리 캐시
const STORE_CACHE_KEY='daiso_store_list_compact_v1';

function normalizeStoreRows(list){return (list||[]).map(function(row){if(Array.isArray(row))return {division:row[0]||'',dept:row[1]||'',team:row[2]||'',store:row[3]||''};return row})}
function readStoreCache(){try{var x=JSON.parse(localStorage.getItem(STORE_CACHE_KEY)||'null');return x&&Array.isArray(x.rows)&&x.rows.length?normalizeStoreRows(x.rows):null}catch(e){return null}}
function writeStoreCache(list){try{localStorage.setItem(STORE_CACHE_KEY,JSON.stringify({savedAt:Date.now(),rows:(list||[]).map(function(r){return [r.division,r.dept,r.team,r.store]} )}))}catch(e){}}

function start(){
  S.screen='start';
  if(STORE_LIST){renderStart();return}
  var cached=readStoreCache();
  if(cached){STORE_LIST=cached;renderStart();return}
  STORE_LOADING=true;
  renderStart();
  var storeRequest=gsRun('getStoreListCompact').catch(function(err){
    /* GitHub 화면이 Apps Script보다 먼저 배포된 짧은 구간에는 기존 API로 호환한다. */
    var msg=err&&err.message?err.message:String(err);
    if(/허용되지 않은 요청|함수를 찾을 수 없습니다/.test(msg))return gsRun('getStoreList');
    throw err;
  });
  storeRequest.then(list=>{
    STORE_LIST=normalizeStoreRows(list);
    STORE_LOADING=false;
    if(!STORE_LIST.length){storeLoadFailed('시트에서 매장을 한 건도 읽지 못했습니다. 스프레드시트에 \u0027매장\u0027 탭이 있고 2행부터 영업본부/부서명/팀명/매장명이 채워져 있는지 확인하세요.');return}
    writeStoreCache(STORE_LIST);
    renderStart();
  }).catch(err=>{
    STORE_LOADING=false;
    storeLoadFailed(err&&err.message?err.message:String(err));
  });
}
/* 매장 목록 조회 실패 화면.
   원인을 그대로 보여주고, 서버 없이 화면만 확인할 수 있는 테스트 모드를 함께 제공한다. */
function storeLoadFailed(message){
  var h='<div class="card"><h2>매장 목록을 불러오지 못했습니다</h2>';
  h+='<div class="notice">'+esc(message)+'</div>';
  h+='<p class="muted">아래 순서로 확인해 보세요.<br>'
    +'1. <b>config.js</b>의 API_URL이 Apps Script 웹앱 주소(.../exec)로 채워져 있는지<br>'
    +'2. 모바일에서 Apps Script의 <b>/exec 주소를 직접 열었을 때 정상 API 안내가 나오는지</b><br>'
    +'3. Apps Script에서 [배포] → [배포 관리]의 액세스 권한이 <b>링크가 있는 모든 사용자</b>인지<br>'
    +'4. 코드를 수정했다면 기존 배포를 <b>수정(연필 아이콘) → 버전: 새 버전</b>으로 갱신했는지<br>'
    +'5. 스프레드시트에 <b>매장</b> 탭이 있고 데이터가 2행부터 들어있는지</p>';
  h+='<button class="primary wide" onclick="STORE_LIST=null;start()">다시 시도</button>';
  h+='<button class="secondary wide" style="margin-top:8px" onclick="enableTestMode()">서버 없이 테스트 모드로 진행</button>';
  h+='<p class="muted" style="margin-top:8px">테스트 모드는 샘플 매장으로 화면 흐름만 확인하는 기능입니다. 구글시트·드라이브에는 아무것도 저장되지 않습니다.</p>';
  h+='</div>';
  frame(h,'연결 확인이<br>필요합니다.','서버 연결 없이도 화면 테스트는 가능합니다.');
}
function enableTestMode(){
  TEST_MODE=true;STORE_LIST=null;
  toast('테스트 모드 · 시트에 저장되지 않습니다');
  start();
}
/* 점검자 목록 (Park이 안전/보건 두 명이라 소속을 붙여 구분) */
var INSPECTORS=['Kang(안전)','Park(안전)','Yoo(안전)','Seo(안전)','Park(보건)','Yoon(보건)'];

/* 조직 단계 선택 상태: 부문 -> 부서 -> 팀 -> 매장 */
var SEL={inspector:'',division:'',dept:'',team:'',store:'',date:new Date().toISOString().slice(0,10)};

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
function onInspectorChange(value){SEL.inspector=value;renderStart()}
function onInspectionDateChange(value){SEL.date=value}

function selectBox(label,field,options,selected,required,disabled){
  var h='<div class="field start-org-field'+(disabled?' disabled':'')+'"><label>'+label+(required?' <span class="req">*</span>':'')+'</label>';
  h+='<select onchange="onOrgChange(\''+field+'\',this.value)"'+(disabled?' disabled':'')+'>';
  h+='<option value="">선택</option>';
  for(var i=0;i<options.length;i++){
    var v=options[i];
    h+='<option'+(v===selected?' selected':'')+'>'+esc(v)+'</option>';
  }
  h+='</select></div>';
  return h;
}

function renderStart(){
  var h='<div class="card"><h2>점검 정보를 선택하세요</h2>';

  /* 점검자는 명단을 한눈에 보고 바로 누를 수 있도록 카드로 고정 노출한다. */
  h+='<div class="start-section-label"><b>점검자</b><span>필수</span></div><div class="inspector-grid">';
  for(var i=0;i<INSPECTORS.length;i++){
    var ins=INSPECTORS[i];
    var parts=ins.match(/^(.+)\((.+)\)$/)||['',ins,''];
    h+='<button class="inspector-card'+(ins===SEL.inspector?' selected':'')+'" onclick="onInspectorChange(\''+ins+'\')"><i>'+esc(parts[1].slice(0,1))+'</i><span><b>'+esc(parts[1])+'</b><small>'+esc(parts[2])+'</small></span>'+(ins===SEL.inspector?'<strong>✓</strong>':'')+'</button>';
  }
  h+='</div>';

  h+='<div class="start-info-panel"><div class="field"><label>점검일자 <span class="req">*</span></label><input type="date" value="'+esc(SEL.date)+'" onchange="onInspectionDateChange(this.value)"></div>';
  if(STORE_LOADING)h+='<div class="loading-notice">매장 정보를 준비하고 있습니다. 점검자와 날짜를 먼저 선택할 수 있습니다.</div>';
  h+='<div class="org-select-grid">';
  h+=selectBox('부문','division',orgOptions('division'),SEL.division,true,!SEL.inspector||STORE_LOADING);
  h+=selectBox('부서','dept',orgOptions('dept'),SEL.dept,true,!SEL.division);
  h+=selectBox('팀','team',orgOptions('team'),SEL.team,true,!SEL.dept);
  h+='</div>';
  h+=selectBox('매장','store',orgOptions('store'),SEL.store,true,!SEL.team);
  h+='</div>';

  h+='<button class="primary wide" style="margin-top:6px" onclick="selectStore()">점검 시작 →</button>';
  if(localStorage.getItem(KEY)&&S.store){
    h+='<button class="secondary wide" style="margin-top:8px" onclick="resume()">저장된 '+esc(S.store.name)+' 점검 이어하기</button>';
  }
  h+='</div>';

  frame(h,'안전보건 현장진단을<br>시작합니다.','점검자와 조직을 선택하면 사고이력·기존과제를 자동으로 불러옵니다.');
}
function selectStore(){
  if(!SEL.inspector)return uiError('점검자를 선택하세요');
  if(!SEL.store)return uiError('매장까지 모두 선택하세요');
  if(!SEL.date)return uiError('점검일을 선택하세요');
  var n=SEL.store;
  var meta={name:n,hq:SEL.division,dept:SEL.dept,team:SEL.team,people:'',size:'',floors:'',delivery:'',inboundHelpers:'',inspector:SEL.inspector,date:SEL.date};
  S=fresh();
  S.store={...meta,accidentRecords:[],accidents:[],openIssues:[],tasks:[]};
  Object.assign(S.basic,meta);
  S.screen='start';
  frame(`<div class="card"><h2>${esc(meta.name)}</h2><div class="loading-notice">사고이력·기존 개선과제를 불러오는 중입니다...</div></div>`,`점검을 준비하고<br>있습니다.`);
  Promise.all([gsRun('getStoreAccidentHistory',n),gsRun('getStoreOpenIssues',n)]).then(([acc,open])=>{
    acc=acc||[];open=open||[];
    S.store.accidentRecords=acc;
    S.store.accidents=acc.map(a=>`${a.date} ${a.type}${a.approved==='Y'?'(산재승인)':''}: ${a.content}`);
    S.store.openIssues=open;
    S.store.tasks=open.map(x=>x.title);
    enterInspection();
  }).catch(err=>{
    toast('사고이력 조회 실패: '+(err&&err.message?err.message:String(err)));
    enterInspection();
  });
}
function uiError(msg){const card=$('.card');if(card){card.classList.remove('shake-strong','validation-error');void card.offsetWidth;card.classList.add('shake-strong','validation-error');setTimeout(()=>card.classList.remove('shake-strong'),420);setTimeout(()=>card.classList.remove('validation-error'),900)}toast(msg)}
function enterInspection(){ensureDefaults();if(hasAccidents()){S.accidentPhase='initial';accident()}else{S.accidentPhase='final';S.screen='work';work()}}
function resume(){if(S.screen==='basic')return enterInspection();render(S.screen||'start')}
/* 점검 탭 구성.
 * - '시설·소방' 한 탭이던 것을 '공통·시설' / '소방' 두 탭으로 나눴다.
 * - '사고조사'는 이 매장에 과거 사고이력이 있을 때만 나온다.
 * - '조치확인'(개선과제)은 지난 점검에서 남은 미조치 지적사항이 있을 때만 나온다. 즉 재점검용 탭.
 * - '결과'는 탭에서 뺐다. 최종 제출을 하면 그때 결과화면으로 넘어간다. */
const ALL_SECTIONS=['accident','work','ladder','common','fire','tbm','voice','other','tasks'];
var SECTION_NAV_OPEN=false,WORK_NAV_OPEN=false,WORKER_NAV_OPEN=false,LADDER_EXPANDED=null;
function activeSections(){
  return ALL_SECTIONS.filter(function(k){
    if(k==='accident')return hasAccidents();
    if(k==='tasks')return hasOpenIssues();
    return true;
  });
}
function tabs(a){
  const nm={work:'작업점검',ladder:'사다리',common:'공통·시설',fire:'소방',tbm:'TBM',voice:'의견청취',other:'기타사항',accident:'사고조사',tasks:'조치확인'};
  const marks={work:'✓',ladder:'↗',common:'◇',fire:'●',tbm:'T',voice:'”',other:'＋',accident:'!',tasks:'↻'};
  return `<nav class="section-nav ${SECTION_NAV_OPEN?'open':''}" aria-label="점검 메뉴"><button class="section-nav-trigger" onclick="toggleSectionNav()"><i>${marks[a]}</i><span><small>점검 메뉴</small><b>${nm[a]}</b></span><strong>⌄</strong></button><div class="section-nav-body"><div class="section-nav-title"><span>INSPECTION MENU</span><b>이동할 메뉴 선택</b></div><div class="section-tabs">${activeSections().map(k=>`<button class="section-tab ${a===k?'active':''}" onclick="go('${k}')"><i>${marks[k]}</i><span>${nm[k]}</span></button>`).join('')}</div></div></nav>`;
}
function toggleSectionNav(){SECTION_NAV_OPEN=!SECTION_NAV_OPEN;if(SECTION_NAV_OPEN){WORK_NAV_OPEN=false;WORKER_NAV_OPEN=false}render(S.screen)}
function toggleWorkNav(){WORK_NAV_OPEN=!WORK_NAV_OPEN;if(WORK_NAV_OPEN){SECTION_NAV_OPEN=false;WORKER_NAV_OPEN=false}work()}
function selectWorkType(i){S.wi=i;WORK_NAV_OPEN=false;work()}
function go(k){
  SECTION_NAV_OPEN=false;WORK_NAV_OPEN=false;WORKER_NAV_OPEN=false;
  if(k!=='accident'&&S.accidentPhase==='initial')S.accidentPhase='final';
  if(k==='work')return work();
  if(k==='ladder')return ladder();
  if(k==='common'||k==='fire'||k==='tbm')return checklist(k);
  if(k==='voice')return voice();
  if(k==='other')return other();
  if(k==='accident')return hasAccidents()?accident():other();
  if(k==='tasks')return hasOpenIssues()?tasks():lastSectionScreen();
  return finalSubmit();
}
/* 점검 흐름의 마지막 화면 (있는 탭 중 가장 뒤) */
function lastSectionScreen(){
  if(hasOpenIssues())return tasks();
  if(hasAccidents())return accident();
  return other();
}
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
  m.innerHTML=`<div class="guide-modal"><button class="modal-close" aria-label="안내 닫기" onclick="closeGuide('${kind}')">×</button><div class="guide-icon">📋</div><h2>${title}</h2><p class="muted">아래 항목을 현장에서 확인한 뒤, 이상이 있는 사항만 등록해 주세요.</p><div class="guide-list">${items.map((x,i)=>`<div><b>${i+1}</b><span>${x}</span></div>`).join('')}</div></div>`;
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
  m.innerHTML='<div class="guide-modal"><button class="modal-close" aria-label="참고사진 닫기" onclick="'+closeOnclick+'">×</button><div class="guide-icon">🪜</div><h2>사다리 유형 참고사진</h2>'
    +'<p class="muted">우리 매장 사다리와 비슷한 유형을 사진으로 확인하세요.</p>'
    +'<div class="ladder-guide-list">'+items+'</div></div>';
  document.body.appendChild(m);
}
function closeLadderTypeGuide(){const m=document.getElementById('guideModal');if(m)m.remove()}
/* 사다리/공통·시설/소방/TBM 모두 체크항목이 짧아 별도 안내 팝업이 필요 없다. */
function showGuide(kind){if(S[kind])S[kind].guideSeen=true;save()}
function workTabs(){return `<nav class="work-nav ${WORK_NAV_OPEN?'open':''}" aria-label="작업유형"><button class="work-nav-trigger" onclick="toggleWorkNav()"><i>${String(S.wi+1).padStart(2,'0')}</i><span><small>작업유형 · ${S.wi+1}/${D.works.length}</small><b>${esc(D.works[S.wi][0])}</b></span><strong>⌄</strong></button><div class="work-nav-body"><div class="work-nav-head"><b>작업유형 선택</b><span>${S.wi+1} / ${D.works.length}</span></div><div class="work-chips">${D.works.map((w,i)=>{
  /* '완료' 여부는 실제로 '다음' 버튼을 눌러 확인한 workChecked 기준으로 판단한다. */
  /* (S.wa는 ensureDefaults가 진입 시 미리 채워두므로 완료 판단 기준으로 쓰면 안 됨) */
  const checked=S.workChecked&&S.workChecked[i];
  const isNA=S.workNA&&S.workNA[i];
  const done=!!checked&&checked.status!=='na'||isNA;
  const a=S.wa[i]||{},risk=!isNA&&Object.values(a).some(x=>x.risk);
  return `<button class="work-chip ${S.wi===i?'active':''} ${done?'done':''} ${risk?'risk':''}" onclick="selectWorkType(${i})"><i>${String(i+1).padStart(2,'0')}</i><span>${w[0]}</span></button>`
}).join('')}</div></div></nav>`}
function work(){
  S.screen='work';ensureDefaults();
  const w=D.works[S.wi],a=S.wa[S.wi]||{},done=Object.keys(a).length,risk=Object.values(a).filter(x=>x.risk).length;
  const inbound=w[0]==='입고·하차'?inboundWorkFields():'';
  frame(`${tabs('work')}${workTabs()}<div class="card"><div class="work-card-heading"><div><small>WORK CHECK</small><h2>${w[0]}</h2><span class="pill ${risk?'bad':''}">${S.workNA[S.wi]?'해당 없음':`${done}/${w[1].length} 완료 · 위험신호 ${risk}`}</span></div><div class="heading-actions"><button class="compact-na ${S.workNA[S.wi]?'active':''}" onclick="toggleWorkNA(${S.wi})">${S.workNA[S.wi]?'✓ ':''}해당 작업 없음</button><button class="guide-btn work-guide-btn" onclick="workGuide()">ⓘ 점검 가이드</button></div></div>${inbound}
  ${S.workNA[S.wi]?`<div class="notice"><b>${esc(w[0])}</b> 작업은 해당 없음으로 기록됩니다.</div>`:w[1].map((q,qi)=>question(q,qi,a[qi])).join('')}</div>
  ${nav(S.wi,D.works.length,`prevWork()`,`nextWork()`)}`,`작업유형별<br>통합점검`,`${S.wi+1}/${D.works.length} · 각 문항의 양호 답변이 기본 선택되어 있습니다.`);
}
function inboundWorkFields(){
  return `<div class="inbound-meta"><div class="field"><label>입고시간대</label><select onchange="S.basic.delivery=this.value;save()"><option value="">선택</option><option ${S.basic.delivery==='오전'?'selected':''}>오전</option><option ${S.basic.delivery==='오후(야간)'?'selected':''}>오후(야간)</option></select></div><div class="field"><label>입고도우미 인원</label><div class="number-suffix"><input type="number" min="0" inputmode="numeric" placeholder="0" value="${esc(S.basic.inboundHelpers)}" onchange="S.basic.inboundHelpers=this.value;save()"><span>명</span></div></div></div>`;
}
function question(q,qi,v){
  return `<div class="q" data-required="q${qi}"><h3>${qi+1}. ${q[0]} <span class="req">*</span></h3><div class="answers">${q[1].map((o,oi)=>{
    const showPhoto=v?.oi===oi&&v?.risk;
    const isRisk=(Array.isArray(q[3])?q[3]:[]).includes(oi);
    return `<div class="answer-row ${showPhoto?'has-photo':''}"><button class="ans ${isRisk?'risk-answer':'normal-answer'} ${v?.oi===oi?'sel':''}" onclick="pickWork(${qi},${oi})">${o}</button>${showPhoto?detail('work',`${S.wi}-${qi}`,v):''}</div>`;
  }).join('')}</div></div>`
}

function workGuide(){
  const old=document.getElementById('guideModal');if(old)old.remove();
  const m=document.createElement('div');m.id='guideModal';m.className='modal-backdrop';
  m.innerHTML=`<div class="guide-modal"><button class="modal-close" aria-label="점검 안내 닫기" onclick="closeWorkGuide()">×</button><div class="guide-icon">👀</div><h2>작업점검 안내</h2>
  <p class="muted">빠른 점검을 위해 각 문항의 <b>양호한 답변이 미리 선택</b>되어 있습니다.</p>
  <div class="guide-list"><div><b>1</b><span>실제 작업현장을 직접 확인해 주세요.</span></div><div><b>2</b><span>현장 상태가 기본 선택과 다를 때만 답변을 변경하세요.</span></div><div><b>3</b><span>해당 작업을 하지 않는 매장은 ‘해당 작업 없음’을 선택하세요.</span></div></div></div>`;
  document.body.appendChild(m)
}
function closeWorkGuide(){S.guides.work=true;save();const m=document.getElementById('guideModal');if(m)m.remove()}
function toggleWorkNA(wi){
  S.workNA[wi]=!S.workNA[wi];save();work()
}
/* 스크롤 위치 유지는 frame()이 알아서 처리하므로 여기서 따로 복원하지 않는다. */
function pickWork(qi,oi){const q=D.works[S.wi][1][qi];S.wa[S.wi]=S.wa[S.wi]||{};const old=S.wa[S.wi][qi]||{},riskSet=Array.isArray(q[3])?q[3]:[],isRisk=riskSet.includes(oi);S.wa[S.wi][qi]={...old,oi,risk:isRisk,hazards:q[2]};save();work();if(isRisk){const card=document.querySelector('[data-required="q'+qi+'"]');if(card){card.classList.add('risk-alert');setTimeout(()=>card.classList.remove('risk-alert'),620)}}}
/* 위험신호 답변을 고른 문항에 붙는 사진 첨부 영역.
   어떤 상태인지는 이미 선택한 답변이 말해주므로, 별도의 설명 입력칸은 두지 않는다.
   사진만 1:1 정사각형 칸으로 간단히 붙인다 (공통·시설/소방/TBM 점검표와 같은 형태). */
function detail(kind,id,v){return `<div class="inline-photo-strip" aria-label="미흡 사진"><label class="lad-cam" title="사진 추가">📷<input class="photo-input" type="file" accept="image/*" multiple onchange="pickFiles('${kind}','${id}',this)"></label>${renderPhotoList(v.files,'work',id)}</div>`}
async function pickFiles(k,id,input){
  const n=input.files.length;toast('사진 압축 중...');
  const added=await attachPhotos(input.files);
  const o=getObj(k,id);o.files=[...(o.files||[]),...added];save();
  toast(`${n}개 사진 선택됨`);
  /* 현재 화면을 다시 그려서 새 사진 목록을 반영 (작업점검 화면만 해당) */
  if(k==='work')work();
}
function getObj(k,id){if(k==='work'){const [a,b]=id.split('-');return S.wa[a][b]}return S[k][id]}
function invalid(sel,msg){const e=$(sel);if(e){e.classList.add('shake');e.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>e.classList.remove('shake'),400)}toast(msg);return false}function nextWork(){ensureDefaults();S.workChecked[S.wi]={checkedAt:new Date().toISOString(),checkedBy:S.basic?.inspector||'',status:S.workNA?.[S.wi]?'na':'checked'};save();if(S.wi<D.works.length-1){S.wi++;work()}else ladder()}function prevWork(){if(S.wi){S.wi--;work()}else start()}
/* 작업점검 화면만 쓰는 하단 고정 이동바.
   화면 아래에 고정되어 내용을 가리므로, 같은 높이의 빈 공간(nav-spacer)을 함께 넣어준다.
   (다른 화면은 고정바가 없으므로 .content에 큰 아래 여백을 두지 않는다) */
function nav(i,n,prev,next){return `<div class="nav-spacer"></div><nav class="nav"><button class="secondary" onclick="${prev}">← 이전</button><div class="progress">${i+1}/${n}<div class="bar"><i style="width:${(i+1)/n*100}%"></i></div></div><button class="primary" onclick="${next}">다음 →</button></nav>`}


/* 공통·시설 / 소방 / TBM 점검표.
   작업점검과 같은 방식이다. 항목 왼쪽에 내용, 오른쪽에 [양호][미흡] 버튼을 두고
   기본은 전부 '양호'로 선택된 상태다. '미흡'을 누른 항목만 그 줄 아래로 펼쳐져
   사진을 붙일 수 있다. 조건부 항목은 해당 시설이 없으면 '해당 없음'으로 기록한다. */
const NEXT_AFTER={common:'fire',fire:'tbm',tbm:'voice'};
const PREV_BEFORE={common:'ladder',fire:'common',tbm:'fire'};
const CHECKLIST_TITLE={common:'공통·시설',fire:'소방',tbm:'TBM'};
function checklist(k){
  normalizeState();S.screen=k;
  const st=S[k],title=CHECKLIST_TITLE[k];
  const total=D[k].length;
  const bad=(st.issues||[]).length;
  const naCount=Object.keys(st.naItems||{}).filter(function(x){return st.naItems[x]}).length;

  const rows=D[k].map(function(item){
    const name=typeof item==='string'?item:item.name;
    const conditional=!!(item&&typeof item==='object'&&item.conditional);
    const found=(st.issues||[]).find(function(x){return x.item===name});
    const idx=found?st.issues.indexOf(found):-1;
    const isBad=!!found;
    const isNA=!!(st.naItems||{})[name];
    let row='<div class="form-row'+(isBad?' bad':'')+'">';
    row+='<div class="form-row-top">';
    row+='<div class="form-name">'+esc(name)+(conditional?'<small class="conditional-label">해당 시설이 있을 때만</small>':'')+'</div>';
    row+='<div class="form-actions"><div class="form-status'+(conditional?' conditional':'')+'">';
    row+='<button class="lad-ok'+(!isBad&&!isNA?' sel':'')+'" onclick="setChecklistStatus(\u0027'+k+'\u0027,\u0027'+name+'\u0027,\u0027good\u0027)">양호</button>';
    row+='<button class="lad-ng'+(isBad?' sel':'')+'" onclick="setChecklistStatus(\u0027'+k+'\u0027,\u0027'+name+'\u0027,\u0027bad\u0027)">미흡</button>';
    if(conditional)row+='<button class="lad-na'+(isNA?' sel':'')+'" onclick="setChecklistStatus(\u0027'+k+'\u0027,\u0027'+name+'\u0027,\u0027na\u0027)">해당 없음</button>';
    row+='</div>';
    if(isBad){
      /* 미흡 상태버튼과 같은 행에 사진을 붙여 세로 길이가 늘어나지 않게 한다. */
      row+='<div class="inline-photo-strip checklist-photo" aria-label="미흡 사진">';
      row+='<label class="lad-cam" title="사진 추가">📷';
      row+='<input class="photo-input" type="file" accept="image/*" multiple onchange="attachIssuePhotos(\u0027'+k+'\u0027,'+idx+',this)"></label>';
      row+=renderPhotoList(found.files,'issue',k+'|'+idx);
      row+='</div>';
    }
    row+='</div></div></div>';
    return row;
  }).join('');

  const body=`<div class="card step-card"><div class="step-head"><span>${title}</span><b>양호가 기본 선택 · 미흡만 바꾸세요</b></div>
    <div class="summary"><h2>${title} 점검</h2><span class="pill ${bad?'bad':''}">${bad?`미흡 ${bad}건 · 해당없음 ${naCount}건`:`양호 ${total-naCount}항목 · 해당없음 ${naCount}건`}</span></div>
    <div class="form-list">${rows}</div>
    <div class="navrow"><button class="secondary" onclick="go('${PREV_BEFORE[k]}')">← 이전</button><button class="primary" onclick="finishChecklist('${k}')">${k==='tbm'?'의견청취':CHECKLIST_TITLE[NEXT_AFTER[k]]} →</button></div></div>`;

  frame(`${tabs(k)}${body}`,`${title}<br>점검`,'현장과 다른 항목만 미흡으로 바꾸면 됩니다.');
}
/* 양호/미흡 선택. 미흡인 항목만 issues에 남기므로 issues가 곧 미흡 목록이 된다. */
function setChecklistStatus(k,item,status){
  S[k].issues=Array.isArray(S[k].issues)?S[k].issues:[];
  S[k].naItems=S[k].naItems||{};
  if(status==='bad'){
    delete S[k].naItems[item];
    if(!S[k].issues.some(function(x){return x.item===item})){
      S[k].issues.push({id:uid(),item:item,note:'',files:[]});
    }
  }else if(status==='na'){
    S[k].issues=S[k].issues.filter(function(x){return x.item!==item});
    S[k].naItems[item]=true;
  }else{
    S[k].issues=S[k].issues.filter(function(x){return x.item!==item});
    delete S[k].naItems[item];
  }
  save();checklist(k);
}
function finishChecklist(k){
  const st=S[k];
  st.status=st.issues.length?'bad':'good';
  st.checkedAt=new Date().toISOString();st.checkedBy=S.basic?.inspector||'';
  save();
  if(k==='tbm')voice();else go(NEXT_AFTER[k]);
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
/* 사다리 유형 5종을 항상 모두 보여주는 카드.
   사진 + 수량(+/- 버튼) + 수량이 1개 이상일 때만 양호/미흡 선택이 나타난다.
   '미흡'을 누르면 그 카드가 한 줄 전체로 넓어지면서 바로 아래에
   이상항목/설명/사진 입력칸이 펼쳐진다 (작업점검 화면과 같은 방식).
   수량을 입력하지 않은 유형은 자동으로 0개(= 미보유)로 처리된다. */
function ladderInventoryCard(t){
  var st=S.ladder;
  var count=Math.max(0,Number((st.counts||{})[t]||0));
  var has=count>0;
  var img=(D.ladderTypeImages||{})[t];
  var label=t;
  var status=(st.typeStatus||{})[t]||'';
  var isBad=(status==='bad');
  var isExpanded=isBad&&LADDER_EXPANDED===t;
  var typeIssues=(st.issues||[]).filter(function(x){return x.typeKey===t});
  var issueCount=typeIssues.length;
  var photoCount=typeIssues.reduce(function(n,x){return n+(x.files||[]).length},0);

  var thumb;
  if(img){
    thumb='<img src="'+img+'" alt="'+esc(label)+'" onclick="zoomImage(\u0027'+t+'\u0027)">';
  }else{
    thumb='<span class="ladder-type-noimg">📷</span>';
  }

  /* 한 유형 = 한 줄. 미흡이면 이 줄 안에서 바로 이상사항을 적는다. */
  var h='<div class="lad-card'+(has?' has':'')+(isBad?' bad':'')+(isExpanded?' expanded':' collapsed')+'">';
  h+='<div class="lad-top">';
  h+='<div class="lad-thumb">'+thumb+'</div>';
  h+='<div class="lad-info">';
  h+='<div class="lad-name-row"><div class="lad-name">'+esc(label)+'</div>';
  if(isBad)h+="<button class=\"lad-fold "+(isExpanded?'open':'')+"\" onclick=\"toggleLadderIssues('"+t+"')\" aria-expanded=\""+(isExpanded?'true':'false')+"\"><span>"+(isExpanded?'이상항목 접기':'이상 '+issueCount+'개'+(photoCount?' · 사진 '+photoCount+'장':'')+' 펼치기')+"</span><i>"+(isExpanded?'⌃':'⌄')+"</i></button>";
  h+='</div>';
  h+='<div class="lad-controls">';

  /* 수량 조절 */
  h+='<div class="lad-count">';
  h+='<button class="lad-btn" onclick="stepLadderCount(\u0027'+t+'\u0027,-1)">−</button>';
  h+='<span class="lad-num" id="ladCount-'+esc(t)+'">'+count+'</span>';
  h+='<button class="lad-btn" onclick="stepLadderCount(\u0027'+t+'\u0027,1)">+</button>';
  h+='</div>';

  /* 보유한 유형만 상태 선택 노출 */
  if(has){
    h+='<div class="lad-status">';
    h+='<button class="lad-ok'+(status==='good'?' sel':'')+'" onclick="setLadderTypeStatus(\u0027'+t+'\u0027,\u0027good\u0027)">양호</button>';
    h+='<button class="lad-ng'+(isBad?' sel':'')+'" onclick="setLadderTypeStatus(\u0027'+t+'\u0027,\u0027bad\u0027)">미흡</button>';
    h+='</div>';
  }else{
    h+='<div class="lad-status-empty">미보유</div>';
  }
  h+='</div></div></div>'; /* .lad-controls, .lad-info, .lad-top 닫기 */

  /* 미흡이면 이 카드 안에서 바로 이상사항을 기록한다. */
  if(isExpanded)h+=ladderIssueInline(t,label);

  h+='</div>';
  return h;
}

/* 미흡으로 표시한 유형의 이상항목 선택 영역 (그 유형 줄 안에 펼쳐진다).
   전부 객관식이다. 이상항목을 체크박스로 고르고, 체크한 줄 오른쪽에
   작은 정사각형 사진칸(📷)과 해제용 X만 둔다.
   긴 주관식 설명칸과 큰 사진 버튼은 현장에서 번거로워 없앴다. */
function ladderIssueInline(t,label){
  var issues=Array.isArray(S.ladder.issues)?S.ladder.issues:[];
  var h='<div class="lad-issues">';
  h+='<div class="lad-issues-head">'+esc(label)+' 이상항목</div>';
  /* 항목명이 짧으니 1열로 쭉 나열할 필요가 없다. 2열 그리드로 배치한다. */
  h+='<div class="lad-chklist">';

  /* data.js의 D.ladder는 [외관상태, 나사상태, 기타사항] 3개뿐이다. */
  D.ladder.forEach(function(row){
    var name=row[0],hint=row[1]||'';
    /* 이 유형 + 이 항목으로 이미 등록된 건이 있는지 찾는다 (사진을 붙일 위치가 필요) */
    var found=null,idx=-1;
    for(var i=0;i<issues.length;i++){
      if(issues[i].typeKey===t&&issues[i].item===name){found=issues[i];idx=i;break}
    }
    var on=!!found;
    h+='<div class="lad-chk'+(on?' on':'')+'">';
    h+='<label class="lad-chk-main">';
    h+='<input type="checkbox"'+(on?' checked':'')+' onchange="toggleLadderItem(\u0027'+t+'\u0027,\u0027'+name+'\u0027,this.checked)">';
    h+='<span><b>'+esc(name)+'</b>'+(hint?'<small>'+esc(hint)+'</small>':'')+'</span></label>';
    if(on){
      h+='<div class="lad-chk-right">';
      h+=renderPhotoList(found.files,'issue','ladder|'+idx);
      h+='<label class="lad-cam" title="사진 추가">📷';
      h+='<input class="photo-input" type="file" accept="image/*" multiple onchange="attachIssuePhotos(\u0027ladder\u0027,'+idx+',this)"></label>';
      h+='<button class="lad-x" onclick="removeLadderItem(\u0027'+t+'\u0027,\u0027'+name+'\u0027)" aria-label="이상항목 해제">✕</button>';
      h+='</div>';
      /* '기타사항'만 목록에 없는 내용을 짧게 적을 수 있게 한 줄 입력칸을 둔다 */
      if(name==='기타사항'){
        h+='<div class="lad-etc"><input placeholder="어떤 이상인지 짧게 입력" value="'+esc(found.note||'')+'" onchange="setLadderIssueNote('+idx+',this.value)"></div>';
      }
    }
    h+='</div>';
  });

  h+='</div></div>';
  return h;
}
/* 체크하면 그 항목을 이상사항으로 등록하고, 체크를 풀면 사진까지 함께 지운다. */
function toggleLadderItem(t,item,on){
  S.ladder.issues=Array.isArray(S.ladder.issues)?S.ladder.issues:[];
  if(on){
    var exists=S.ladder.issues.some(function(x){return x.typeKey===t&&x.item===item});
    if(!exists){
      var label=t;
      S.ladder.issues.push({id:uid(),typeKey:t,type:label,item:item,note:'',files:[]});
    }
  }else{
    S.ladder.issues=S.ladder.issues.filter(function(x){return !(x.typeKey===t&&x.item===item)});
  }
  save();ladder();
}
function removeLadderItem(t,item){toggleLadderItem(t,item,false)}
function toggleLadderIssues(t){LADDER_EXPANDED=LADDER_EXPANDED===t?null:t;ladder()}
function setLadderIssueNote(idx,value){
  if(!S.ladder.issues[idx])return;
  S.ladder.issues[idx].note=value;
  save();
}

function ladder(){
  normalizeState();S.screen='ladder';const st=S.ladder;
  st.step=1;
  loadLadderTypeImages();
  const total=D.ladderTypes.reduce(function(n,t){return n+Math.max(0,Number((st.counts||{})[t]||0))},0);
  const badTypes=D.ladderTypes.filter(function(t){return (st.typeStatus||{})[t]==='bad'});

  const body=`<div class="card step-card"><div class="step-head"><span>사다리</span><b>보유현황 · 상태 · 이상사항</b></div>
    <div class="summary ladder-summary"><h2>보유 사다리</h2><div class="heading-actions"><button class="compact-na" onclick="noLadder()">∅ 사다리 없음</button><button class="guide-btn" onclick="showLadderTypeGuide()">📷 유형 사진</button></div></div>
    <div class="choice-divider"><span>또는 보유 사다리 입력</span></div>
    <div class="lad-grid">${D.ladderTypes.map(ladderInventoryCard).join('')}</div>
    <div class="ladder-nav">
      <button class="nav-action back" onclick="work()"><i>←</i><span><small>이전 단계</small><b>작업점검</b></span></button>
      <button class="nav-action next" onclick="ladderInventoryNext()"><span><small>다음 단계</small><b>공통·시설</b></span><i>→</i></button>
    </div></div>`;

  frame(`${tabs('ladder')}${body}`,`사다리 현황<br>점검`,'수량 · 양호/미흡 · 이상사항을 한 화면에서 입력');
}
function noLadder(){
  S.ladder.types=[];S.ladder.counts={};S.ladder.typeStatus={};S.ladder.issues=[];
  LADDER_EXPANDED=null;
  S.ladder.status='na';S.ladder.step=1;
  S.ladder.checkedAt=new Date().toISOString();S.ladder.checkedBy=S.basic?.inspector||'';
  save();checklist('common')
}
/* 사다리 화면을 마치고 시설·소방으로 넘어간다.
   한 화면에서 수량 / 양호·미흡 / 이상사항까지 모두 입력하므로 여기서 전부 검증한다. */
function ladderInventoryNext(){
  const st=S.ladder;
  const owned=D.ladderTypes.filter(function(t){return Math.max(0,Number((st.counts||{})[t]||0))>0});
  if(!owned.length)return toast('보유 수량을 입력하거나 "보유 사다리 없음"을 선택하세요.');

  /* 보유한 유형은 모두 양호/미흡을 선택해야 넘어갈 수 있다. */
  const unset=owned.filter(function(t){return !(st.typeStatus||{})[t]});
  if(unset.length)return toast(unset[0]+' 상태(양호·미흡)를 선택하세요.');

  const badTypes=owned.filter(function(t){return st.typeStatus[t]==='bad'});

  /* 미흡 유형은 이상항목을 1개 이상 체크해야 한다. */
  for(var i=0;i<badTypes.length;i++){
    var t=badTypes[i];
    var mine=st.issues.filter(function(x){return x.typeKey===t});
    if(!mine.length)return toast(t+' 이상항목을 1개 이상 체크하세요.');
  }

  /* 미흡이 아닌 유형에 남아있는 이상사항은 정리 */
  st.issues=st.issues.filter(function(x){return badTypes.indexOf(x.typeKey)>=0});

  /* 화면에 보이는 수량/상태를 types 배열에도 반영 (기존 저장구조 및 개선과제 생성과 호환) */
  st.types=owned;
  st.status=badTypes.length?'bad':'good';
  st.step=1;
  st.checkedAt=new Date().toISOString();
  st.checkedBy=S.basic?.inspector||'';
  save();checklist('common');
}
/* +/- 버튼으로 수량을 조절한다. 0 -> 1이 되면 상태 선택 UI가 나타나야 하고,
   1 -> 0이 되면 사라져야 하므로 그 경계에서만 화면을 다시 그린다. */
function stepLadderCount(t,delta){
  S.ladder.counts=S.ladder.counts||{};
  var before=Math.max(0,Number(S.ladder.counts[t]||0));
  var after=Math.max(0,before+delta);
  S.ladder.counts[t]=after;
  if(after===0){
    /* 미보유가 되면 그 유형의 상태 선택과 이상사항도 초기화 */
    if(S.ladder.typeStatus)delete S.ladder.typeStatus[t];
    if(Array.isArray(S.ladder.issues)){
      S.ladder.issues=S.ladder.issues.filter(function(x){return x.typeKey!==t});
    }
    if(LADDER_EXPANDED===t)LADDER_EXPANDED=null;
  }
  save();
  var crossedZero=(before===0&&after>0)||(before>0&&after===0);
  if(crossedZero){ladder();return}
  /* 그 외에는 숫자와 총합만 갱신 (화면이 튀지 않게) */
  var el=document.getElementById('ladCount-'+t);
  if(el)el.textContent=after;
  updateLadderTotal();
}
/* 양호/미흡 선택.
   '미흡'을 고르면 그 줄 아래에 이상항목 체크박스 목록이 펼쳐진다.
   '양호'로 되돌리면 그 유형에 체크해둔 이상항목을 모두 지운다. */
function setLadderTypeStatus(t,status){
  S.ladder.typeStatus=S.ladder.typeStatus||{};
  S.ladder.typeStatus[t]=status;
  S.ladder.issues=Array.isArray(S.ladder.issues)?S.ladder.issues:[];
  if(status!=='bad'){
    S.ladder.issues=S.ladder.issues.filter(function(x){return x.typeKey!==t});
    if(LADDER_EXPANDED===t)LADDER_EXPANDED=null;
  }else{
    LADDER_EXPANDED=t;
  }
  save();ladder();
}
function updateLadderTotal(){
  var el=document.getElementById('ladderTotal');
  if(!el)return;
  var total=D.ladderTypes.reduce(function(n,k){
    return n+Math.max(0,Number((S.ladder.counts||{})[k]||0));
  },0);
  el.textContent=total;
}

async function attachIssuePhotos(kind,i,input){
  const n=input.files.length;toast('사진 압축 중...');
  const added=await attachPhotos(input.files);
  S[kind].issues[i].files=[...(S[kind].issues[i].files||[]),...added];save();
  toast(`${n}개 사진 선택됨`);
  kind==='ladder'?ladder():checklist(kind);
}
function voiceQuestions(){const x=[...D.voice];(S.store.accidents||[]).forEach(a=>x.push([`사고사례 "${a}"에 대해 안내받았습니까?`,['안내받음','일부만 알고 있음','안내받지 못함']]));(S.store.tasks||[]).forEach(a=>x.push([`기존 개선과제 "${a}"가 개선되었다고 느낍니까?`,['개선됨','일부 개선','개선되지 않음']]));return x}

/* 의견청취도 작업점검과 같이 '양호한 답변'을 미리 선택해 둔다.
   각 문항의 첫 번째 보기가 가장 양호한 답변이므로 0번을 기본값으로 쓴다.
   현장에서 근로자가 다르게 답한 문항만 바꾸면 되므로 진행이 빨라진다. */
function ensureVoiceDefaults(workerIndex){
  const w=S.workers[workerIndex];
  w.answers=w.answers||{};
  const qs=voiceQuestions();
  qs.forEach(function(q,i){
    if(!w.answers[i])w.answers[i]={oi:0};
  });
  save();
}

function workerNav(){
  let list='';
  S.workers.forEach(function(_,i){
    list+='<div class="worker-item '+(i===S.worker?'active':'')+'"><button class="worker-select" onclick="selectWorker('+i+')"><i>'+(i+1)+'</i><span><b>근로자 '+(i+1)+'</b><small>'+(i===S.worker?'현재 작성 중':'응답 보기')+'</small></span></button>';
    if(S.workers.length>1)list+='<button class="worker-remove" aria-label="근로자 '+(i+1)+' 삭제" onclick="event.stopPropagation();removeWorkerAt('+i+')">삭제</button>';
    list+='</div>';
  });
  return '<nav class="worker-nav '+(WORKER_NAV_OPEN?'open':'')+'" aria-label="참여 근로자"><button class="worker-nav-trigger" onclick="toggleWorkerNav()"><i>”</i><span><small>참여 근로자 · '+S.workers.length+'명</small><b>근로자 '+(S.worker+1)+' 의견 작성</b></span><strong>⌄</strong></button><div class="worker-nav-body"><div class="worker-nav-head"><b>참여 근로자 관리</b><span>익명 응답</span></div><div class="worker-list">'+list+'</div><button class="worker-nav-add" onclick="addWorker()">＋ 새 근로자 추가</button></div></nav>';
}
function toggleWorkerNav(){WORKER_NAV_OPEN=!WORKER_NAV_OPEN;if(WORKER_NAV_OPEN){SECTION_NAV_OPEN=false;WORK_NAV_OPEN=false}voice()}
function selectWorker(i){S.worker=i;WORKER_NAV_OPEN=false;voice()}

/* 의견청취. 한 문항씩 넘기던 방식을 없애고 전 문항을 한 화면에 나열한다.
   양호한 답변(첫 번째 보기)이 기본 선택되어 있어서, 다르게 답한 것만 눌러 바꾸면 된다. */
function voice(){
  S.screen='voice';ensureVoiceDefaults(S.worker);
  const w=S.workers[S.worker],qs=voiceQuestions();
  /* 기본값(양호)에서 바뀐 문항 수 = 실제로 의견이 나온 문항 수 */
  const changed=qs.filter(function(q,i){return (w.answers[i]||{}).oi>0}).length;

  let body='<div class="card"><div class="worker-head"><h2>근로자 '+(S.worker+1)+' 익명 의견</h2>';
  body+='<span class="pill'+(changed?' bad':'')+'">'+(changed?'의견 '+changed+'건':'전체 양호')+'</span></div>';
  body+='<p class="muted">이름·사번·업무구분을 받지 않습니다. 양호한 답변이 기본 선택되어 있으니, 근로자가 다르게 답한 문항만 바꿔 주세요.</p>';

  qs.forEach(function(q,i){
    const a=w.answers[i]||{};
    body+='<div class="q"><h3>'+(i+1)+'. '+esc(q[0])+'</h3><div class="answers">';
    q[1].forEach(function(o,oi){
      body+='<button class="ans '+(oi>0?'risk-answer':'normal-answer')+' '+(a.oi===oi?'sel':'')+'" onclick="pickVoice('+i+','+oi+')">'+esc(o)+'</button>';
    });
    body+='</div>';
    /* '기타'를 고른 문항만 짧게 적을 수 있게 한다 */
    if(q[1][a.oi]==='기타'){
      body+='<div class="field"><input placeholder="기타 의견을 짧게 입력" value="'+esc(a.text||'')+'" onchange="setVoiceText('+i+',this.value)"></div>';
    }
    body+='</div>';
  });

  body+='<div class="navrow"><button class="secondary" onclick="checklist(\u0027tbm\u0027)">← 이전</button>';
  body+='<button class="primary" onclick="workerDone()">의견청취 완료 →</button></div></div>';

  frame(tabs('voice')+workerNav()+body,'근로자 의견청취','양호 답변이 기본 선택 · 다른 답변만 바꾸세요');
}
function setVoiceText(i,val){
  const w=S.workers[S.worker];
  w.answers[i]=w.answers[i]||{oi:0};
  w.answers[i].text=val;save();
}
/* 문항 번호(qi)와 보기 번호(oi)를 함께 받는다. 이전에 적어둔 기타 의견은 유지한다. */
function pickVoice(qi,oi){
  const w=S.workers[S.worker];
  const old=w.answers[qi]||{};
  w.answers[qi]={oi:oi,text:old.text||''};
  save();voice();
}
function workerDone(){frame(`${tabs('voice')}${workerNav()}<div class="card worker-complete"><div class="complete-mark">✓</div><h2>근로자 ${S.worker+1} 의견 저장 완료</h2><p class="muted">응답은 익명으로 저장됩니다. 위 참여 근로자 메뉴에서 응답을 관리할 수 있습니다.</p><div class="voice-actions"><button class="worker-add-action" onclick="addWorker()"><i>＋</i><span><b>근로자 추가</b><small>다음 근로자 의견 받기</small></span></button><button class="worker-finish-action" onclick="other()"><span><b>의견청취 종료</b><small>기타사항으로 이동</small></span><i>→</i></button></div></div>`,`의견청취 완료`,`현재 ${S.workers.length}명의 응답이 저장되었습니다.`)}function addWorker(){S.workers.push({answers:{},qi:0});S.worker=S.workers.length-1;WORKER_NAV_OPEN=false;save();voice()}
function removeWorkerAt(index){
  if(S.workers.length<2)return toast('최소 1명은 필요합니다.');
  if(!confirm('근로자 '+(index+1)+'의 응답을 삭제할까요?'))return;
  S.workers.splice(index,1);
  if(S.worker>index)S.worker--;
  else if(S.worker===index)S.worker=Math.min(index,S.workers.length-1);
  save();voice();toast('근로자 응답을 삭제했습니다.');
}
function removeWorker(){
  removeWorkerAt(S.worker);
}

function other(){
  S.screen='other';
  let items=S.others.map(function(x,i){
    return `<article class="other-item"><header><div><i>${String(i+1).padStart(2,'0')}</i><span><small>OTHER NOTE</small><b>기타사항 ${i+1}</b></span></div><button class="other-delete" onclick="removeOther(${i})" aria-label="기타사항 ${i+1} 삭제">×</button></header><div class="other-body"><label>특이사항 내용</label><textarea placeholder="현장에서 확인한 특이사항을 입력하세요." onchange="S.others[${i}].text=this.value;save()">${esc(x.text)}</textarea><div class="other-options"><label class="other-task ${x.task?'selected':''}"><input type="checkbox" ${x.task?'checked':''} onchange="S.others[${i}].task=this.checked;save();other()"><i>${x.task?'✓':''}</i><span><b>개선과제 후보</b><small>후속 조치가 필요한 사항</small></span></label><div class="other-photo"><span><b>현장 사진</b><small>${(x.files||[]).length}장</small></span><div class="form-photos">${renderPhotoList(x.files,'other',i)}<label class="lad-cam" title="사진 추가">📷<input class="photo-input" type="file" accept="image/*" multiple onchange="attachOtherPhotos(${i},this)"></label></div></div></div></div></article>`;
  }).join('');
  if(!items)items='<div class="other-empty"><i>＋</i><b>등록된 기타사항이 없습니다</b><span>정해진 문항 외 특이사항이 있을 때만 추가해 주세요.</span></div>';
  const body=`${tabs('other')}<div class="card other-card"><div class="other-heading"><div><small>INSPECTOR NOTE</small><h2>점검자 기타사항</h2><p>정해진 문항 외 현장 특이사항을 기록합니다.</p></div><span>${S.others.length}건</span></div><div class="other-list">${items}</div><button class="other-add" onclick="addOther()"><i>＋</i><span><b>기타사항 추가</b><small>내용·사진·개선과제 여부 기록</small></span></button><div class="navrow"><button class="secondary" onclick="voice()">← 이전</button>${hasAccidents()?`<button class="primary" onclick="openFinalAccident()">사고조사 →</button>`:hasOpenIssues()?`<button class="primary" onclick="tasks()">조치확인 →</button>`:`<button class="primary" onclick="finalSubmit()">최종 제출 →</button>`}</div></div>`;
  frame(body,'기타사항','정해진 문항 외 내용과 사진을 기록합니다.');
}
function addOther(){S.others.push({id:uid(),text:'',files:[],task:false});save();other()}
function removeOther(i){if(!confirm('기타사항 '+(i+1)+'을 삭제할까요?'))return;S.others.splice(i,1);save();other()}
function openFinalAccident(){S.accidentPhase='final';accident()}
async function attachOtherPhotos(i,input){
  const n=input.files.length;toast('사진 압축 중...');
  const added=await attachPhotos(input.files);
  S.others[i].files=[...(S.others[i].files||[]),...added];save();
  toast(`${n}개 사진 선택됨`);
  other();
}
/* ============ 사고조사 / 조치확인 (두 탭으로 분리) ============
 * 사고조사(accident): 이 매장의 과거 사고이력을 보고 재발방지가 되어 있는지 확인한다.
 *                     사고이력이 있는 매장에만 탭이 나온다.
 * 조치확인(tasks):    지난 점검에서 지적됐는데 아직 조치되지 않은 사항을 확인한다.
 *                     = 재점검 때만 나오는 탭. 첫 점검이면 아예 안 나온다.
 * 이번 점검에서 새로 발견한 미흡은 어느 쪽에도 넣지 않고 결과보고서에만 나온다.
 */
function hasAccidents(){return (S.store&&(S.store.accidentRecords||[]).length)>0}
function hasOpenIssues(){return (S.store&&(S.store.openIssues||[]).length)>0}
/* 예전 코드에서 쓰던 이름. 둘 중 하나라도 있으면 true. */
function hasPastTasks(){return hasAccidents()||hasOpenIssues()}

/* 조치확인 탭 데이터: 지난 점검의 미조치 지적사항만 담는다. */
function syncTasks(){
  var map={};
  (S.store.openIssues||[]).forEach(function(x,i){
    var key='past|'+i;
    map[key]={key:key,issueId:x.issueId||'',title:x.title,source:'지난 지적사항',date:x.date||'',
              owner:'매장 자체조치',status:'조치대기',include:true};
  });
  /* 점검자가 이미 수정한 값(상태/책임구분/포함여부)은 그대로 유지 */
  var prev={};(S.tasks||[]).forEach(function(t){if(t.key)prev[t.key]=t});
  S.tasks=Object.keys(map).map(function(key){
    return prev[key]?Object.assign({},map[key],prev[key]):map[key];
  });
  save();
}

/* API 없이 사고내용·기인물·재해유형의 반복 키워드로 유해위험요인 초안을 만든다. */
function inferAccidentHazard(a){
  const text=[a.source,a.type,a.content].filter(Boolean).join(' ');
  const src=a.source||'';
  const lead=src?src+' 관련 작업 중 ':'';
  const rules=[
    [/작두|커터|칼날|커터칼|가위|절단|베임/,lead+'손 베임·절단 사고 위험'],
    [/사다리|계단|발판|고소|추락|떨어/,lead+'높은 곳 작업 중 떨어짐 사고 위험'],
    [/바닥|통로|단차|미끄|넘어|적재물/,lead+'이동 중 미끄러짐·걸림·넘어짐 사고 위험'],
    [/전선|콘센트|멀티탭|분전|전기|감전/,lead+'전기설비 접촉에 의한 감전·화재 위험'],
    [/롤테이너|대차|L카|문|매대|끼임|부딪/,lead+'이동·취급 중 끼임·부딪힘 사고 위험'],
    [/박스|중량|운반|들어|허리|근골격/,lead+'중량물 취급에 따른 근골격계 부담 위험'],
    [/낙하|맞음|떨어진|상부/,lead+'물체 낙하에 의한 맞음 사고 위험'],
    [/화상|뜨거|고온/,lead+'고온 물체 접촉에 의한 화상 위험']
  ];
  for(let i=0;i<rules.length;i++)if(rules[i][0].test(text))return rules[i][1];
  return lead+(a.type?a.type+' 사고 재발 위험':'사고 재발 위험');
}
function riskLevelForStatus(status,approved){
  if(status==='조치완료')return'하';
  if(status==='개선 진행 중')return'중';
  if(status==='미조치')return'상';
  return approved==='Y'?'상':'중';
}
function accidentRecordKey(a){
  const raw=[a.date||'',a.type||'',a.content||''].join('|');
  let hash=2166136261;
  for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return'acc|'+(a.date||'no-date')+'|'+(hash>>>0).toString(36);
}
/* 사고조사 탭 데이터: 사고DB 원본과 현장 이행상태를 한 건씩 연결한다. */
function syncAccidents(){
  var map={};
  (S.store.accidentRecords||[]).forEach(function(a,i){
    var key=accidentRecordKey(a);
    map[key]={key:key,date:a.date||'',type:a.type||'사고',content:a.content||'',source:a.source||'',
              approved:a.approved||'',lostDays:a.lostDays||'',
              hazardText:inferAccidentHazard(a),riskLevel:riskLevelForStatus('',a.approved||''),
              currentState:'',status:'',afterFiles:[]};
  });
  var prev={},prevBySignature={};(S.accidents||[]).forEach(function(t){
    if(t.key)prev[t.key]=t;
    prevBySignature[[t.date||'',t.type||'',t.content||''].join('|')]=t;
  });
  S.accidents=Object.keys(map).map(function(key){
    var base=map[key],old=prev[key]||prevBySignature[[base.date,base.type,base.content].join('|')];
    var x=old?Object.assign({},base,old):base;
    /* 사고 원본정보는 항상 최신 사고DB 값을 사용한다. */
    ['date','type','content','source','approved','lostDays'].forEach(function(field){x[field]=base[field]});
    x.hazardText=x.hazardText||inferAccidentHazard(x);
    x.afterFiles=Array.isArray(x.afterFiles)?x.afterFiles:[];
    delete x.beforeFiles;
    if(x.status==='일부조치')x.status='개선 진행 중';
    x.riskLevel=riskLevelForStatus(x.status,x.approved);
    if(x.status&&!x.currentState)x.currentState=currentStateForStatus(x,x.status);
    delete x.files;
    return x;
  });
  save();
}
/* 자동 유해위험요인 초안 확인, 현 상태, 이행상태까지 채우면 조사 완료. */
function isAccidentDone(x){return !!(x.hazardText&&x.currentState&&x.status)}
function currentStateForStatus(x,status){
  if(status==='조치완료')return (x.source||x.type||'유해위험요인')+' 제거 조치 완료';
  if(status==='개선 진행 중')return'개선 진행 중';
  if(status==='미조치')return'미조치';
  return'';
}
function accident(){
  S.screen='accident';
  syncAccidents();
  var i,j;
  var h=tabs('accident');
  var done=S.accidents.filter(isAccidentDone).length;
  if(S.accidentOpenKey===undefined)S.accidentOpenKey=S.accidents[0]?S.accidents[0].key:'';
  h+='<div class="card"><div class="summary"><h2>사고조사</h2>';
  h+='<span class="pill'+(done<S.accidents.length?' bad':'')+'">'+done+'/'+S.accidents.length+' 조사완료</span></div>';
  h+='<p class="muted">사고DB의 원본정보와 자동 생성된 위험요인을 확인하고, 현재 이행상태를 기록하세요.</p>';

  for(i=0;i<S.accidents.length;i++){
    var x=S.accidents[i];
    var ok=isAccidentDone(x);
    var expanded=S.accidentOpenKey===x.key;
    h+='<div class="acc-card'+(ok?' done':'')+(expanded?' expanded':'')+'">';
    h+='<button class="acc-accordion-head" onclick="toggleAccidentCard('+i+')"><span><small>'+esc(x.date||'-')+'</small><b>'+esc(x.type||'사고')+'</b><em>'+esc(x.source||'기인물 미등록')+'</em></span><span class="acc-head-state"><i class="risk-dot risk-'+x.riskLevel+'">'+esc(x.riskLevel)+'</i><i>'+(x.status?esc(x.status):'확인 전')+'</i><strong>⌄</strong></span></button>';
    if(!expanded){h+='</div>';continue}

    /* 1) 사고DB에서 가져온 원본정보 (읽기 전용, 짧은 값은 2열) */
    h+='<div class="acc-head">';
    h+='<div class="acc-head-top"><b>사고 원본정보</b><span class="pill'+(x.approved==='Y'?' bad':'')+'">'+(x.approved==='Y'?'산재승인':'사고이력')+'</span></div>';
    h+='<div class="acc-fact-grid"><div><small>재해일자</small><b>'+esc(x.date||'-')+'</b></div><div><small>재해유형</small><b>'+esc(x.type||'-')+'</b></div><div><small>기인물</small><b>'+esc(x.source||'미등록')+'</b></div>';
    if(x.lostDays)h+='<div><small>근로손실일수</small><b>'+esc(String(x.lostDays))+'일</b></div>';
    h+='</div><div class="acc-content"><small>사고내용</small><p>'+esc(x.content||'등록된 사고내용이 없습니다.')+'</p></div>';
    h+='</div>';

    /* 2) 규칙 기반 자동분석 + 현장 확인 */
    h+='<div class="acc-body">';
    h+='<section class="acc-section"><div class="acc-section-title"><b>위험분석</b><span>자동 초안 · 수정 가능</span></div><div class="acc-analysis-grid"><div class="field"><label>유해위험요인</label><textarea onchange="setAccidentText('+i+',\u0027hazardText\u0027,this.value)">'+esc(x.hazardText)+'</textarea></div><div class="risk-level-box"><label>위험등급</label><div class="risk-levels">';
    ['상','중','하'].forEach(function(level){h+='<span class="risk-'+level+(x.riskLevel===level?' selected':'')+'">'+level+'</span>'});
    h+='</div><small>이행상태에 따라 자동 결정</small></div></div></section>';

    h+='<section class="acc-section"><div class="acc-section-title"><b>이행상태 확인</b><span>현장 선택</span></div>';
    h+='<div class="field"><label>이행상태</label><div class="form-status3">';
    for(j=0;j<D.accidentStatus.length;j++){
      var st=D.accidentStatus[j];
      var cls=st==='조치완료'?'status-done':(st==='개선 진행 중'?'status-progress':'status-none');
      h+='<button class="'+cls+(x.status===st?' sel':'')+'" onclick="setAccidentStatus('+i+',\u0027'+st+'\u0027)">'+st+'</button>';
    }
    h+='</div></div>';
    if(x.status)h+='<div class="auto-state"><small>현 상태</small><b>'+esc(x.currentState)+'</b></div>';
    if(x.status==='조치완료')h+='<div class="acc-photo-box acc-after-only"><b>조치 후 사진</b><div class="form-photos">'+renderPhotoList(x.afterFiles,'accidentAfter',i)+'<label class="lad-cam" title="조치 후 사진 추가">📷<input class="photo-input" type="file" accept="image/*" multiple onchange="attachAccidentPhotos('+i+',\u0027afterFiles\u0027,this)"></label></div></div>';
    h+='</section>';
    h+='</div></div>';
  }

  h+='<div class="navrow">';
  if(S.accidentPhase==='initial'){
    h+='<button class="secondary" onclick="start()">← 매장선택</button>';
    h+='<button class="primary" onclick="S.accidentPhase=\'final\';S.screen=\'work\';work()">작업점검 시작 →</button>';
  }else{
    h+='<button class="secondary" onclick="other()">← 이전</button>';
    h+=hasOpenIssues()
      ?'<button class="primary" onclick="tasks()">조치확인 →</button>'
      :'<button class="primary" onclick="finalSubmit()">최종 제출 →</button>';
  }
  h+='</div></div>';

  frame(h,'사고조사','사고 원본정보와 현재 이행상태를 확인합니다.');
}
function toggleAccidentCard(i){
  if(!S.accidents[i])return;
  S.accidentOpenKey=S.accidentOpenKey===S.accidents[i].key?'':S.accidents[i].key;
  save();accident();
}
function setAccidentText(i,field,value){
  if(!S.accidents[i])return;
  S.accidents[i][field]=value;save();
}
function setAccidentStatus(i,status){
  if(!S.accidents[i])return;
  S.accidents[i].status=status;
  S.accidents[i].riskLevel=riskLevelForStatus(status,S.accidents[i].approved);
  S.accidents[i].currentState=currentStateForStatus(S.accidents[i],status);
  save();accident();
}
async function attachAccidentPhotos(i,field,input){
  const n=input.files.length;toast('사진 압축 중...');
  const added=await attachPhotos(input.files);
  S.accidents[i][field]=[...(S.accidents[i][field]||[]),...added];save();
  toast(`${n}개 사진 선택됨`);
  accident();
}
function tasks(){
  S.screen='tasks';
  syncTasks();
  var i,j;
  var h=tabs('tasks');
  h+='<div class="card"><h2>지난 지적사항 조치 확인</h2>';
  h+='<p class="muted">지난 점검에서 지적됐지만 아직 조치되지 않은 사항입니다. 이번에 조치가 끝났으면 조치완료로 바꿔 주세요. 이번 점검에서 새로 발견한 미흡사항은 결과보고서에서 확인할 수 있습니다.</p>';

  if(!S.tasks.length){
    h+='<div class="notice">지난 점검에서 남은 미조치 지적사항이 없습니다.</div>';
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

  h+='<div class="navrow">';
  h+=hasAccidents()
    ?'<button class="secondary" onclick="accident()">← 이전</button>'
    :'<button class="secondary" onclick="other()">← 이전</button>';
  h+='<button class="primary" onclick="finalSubmit()">최종 제출 →</button>';
  h+='</div></div>';

  frame(h,'지난 지적사항<br>조치 확인','재점검 시 조치 여부를 확인하는 탭입니다.');
}
function setTaskField(i,field,value){S.tasks[i][field]=value;save()}

function completionState(){
  const missing=[];
  D.works.forEach((w,wi)=>{
    if(S.workNA?.[wi])return;
    if(!S.workChecked?.[wi])missing.push({kind:'work',wi,label:`작업점검 · ${w[0]}`});
  });
  if(!['good','bad','na'].includes(S.ladder.status))missing.push({kind:'ladder',label:'사다리 점검'});
  if(!['good','bad'].includes(S.common.status))missing.push({kind:'common',label:'공통·시설 점검'});
  if(!['good','bad'].includes(S.fire.status))missing.push({kind:'fire',label:'소방 점검'});
  if(!['good','bad'].includes(S.tbm.status))missing.push({kind:'tbm',label:'TBM 점검'});
  const qs=voiceQuestions();
  const workersOk=(S.workers||[]).length>0 && S.workers.every(w=>qs.every((_,i)=>w.answers&&w.answers[i]));
  if(!workersOk)missing.push({kind:'voice',label:'근로자 의견청취'});
  /* 사고조사는 사고이력이 있는 매장만. 기인물·원인·조치상태가 덜 채워진 건이 있으면 누락 처리 */
  if(hasAccidents()){
    syncAccidents();
    const un=(S.accidents||[]).filter(function(x){return !isAccidentDone(x)});
    if(un.length)missing.push({kind:'accident',label:`사고조사 · 미작성 ${un.length}건`});
  }
  return missing;
}
function jumpToMissing(m){
  if(!m)return;
  if(m.kind==='work'){S.wi=m.wi;work();return}
  if(m.kind==='ladder'){ladder();return}
  if(m.kind==='common'){checklist('common');return}
  if(m.kind==='fire'){checklist('fire');return}
  if(m.kind==='tbm'){checklist('tbm');return}
  if(m.kind==='voice'){voice();return}
  if(m.kind==='accident'){accident();return}
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
    Object.entries(S.wa[wi]||{}).filter(([qi,x])=>x.risk).forEach(([qi,x])=>{
      /* 설명 입력칸이 없으므로 선택한 위험 답변을 note로 넘겨 시트/PDF에 남긴다. */
      const q=w[1][qi];
      const picked=(q&&q[1]&&q[1][x.oi])?q[1][x.oi]:'';
      issues.push({issueId:S.inspectionId+'-work-'+wi+'-'+qi,category:'작업점검',itemName:w[0],note:picked,hazard:(x.hazards||[]).join('/'),photos:resolvePhotos(x.files)});
    });
  });
  (S.ladder.issues||[]).forEach(x=>{
    issues.push({issueId:S.inspectionId+'-ladder-'+x.id,category:'사다리',itemName:`${x.type||''} ${x.item||'이상사항'}`.trim(),note:x.note||'',hazard:'떨어짐',photos:resolvePhotos(x.files)});
  });
  (S.common.issues||[]).forEach(x=>{
    issues.push({issueId:S.inspectionId+'-common-'+x.id,category:'공통·시설',itemName:x.item||'미흡사항',note:x.note||'',hazard:'시설',photos:resolvePhotos(x.files)});
  });
  (S.fire.issues||[]).forEach(x=>{
    issues.push({issueId:S.inspectionId+'-fire-'+x.id,category:'소방',itemName:x.item||'미흡사항',note:x.note||'',hazard:'소방',photos:resolvePhotos(x.files)});
  });
  (S.tbm.issues||[]).forEach(x=>{
    issues.push({issueId:S.inspectionId+'-tbm-'+x.id,category:'TBM',itemName:x.item||'미흡사항',note:x.note||'',hazard:'안전관리',photos:resolvePhotos(x.files)});
  });
  S.others.forEach(x=>{
    issues.push({issueId:S.inspectionId+'-other-'+x.id,category:'기타사항',itemName:x.text||'기타사항',note:'',hazard:'기타',photos:resolvePhotos(x.files)});
  });
  /* 사고조사는 조치완료 건의 조치 후 사진을 보관하되, 완료 건은 조치대기로 만들지 않는다. */
  (S.accidents||[]).forEach(x=>{
    const after=(x.status==='조치완료'?resolvePhotos(x.afterFiles):[]).map(p=>({name:'조치후_'+p.name,dataUrl:p.dataUrl}));
    const memo=[x.status,x.source?'기인물: '+x.source:'',x.currentState?'현 상태: '+x.currentState:'',x.hazardText?'유해위험요인: '+x.hazardText:'','위험등급: '+x.riskLevel].filter(Boolean).join(' · ');
    issues.push({issueId:S.inspectionId+'-accident-'+x.key.replace(/[^a-zA-Z0-9_-]/g,'-'),category:'사고조사',itemName:`${x.date} ${x.type}`.trim(),note:memo,hazard:x.hazardText||x.type||'사고',status:x.status==='조치완료'?'조치완료':'조치대기',photos:after});
  });

  const c=calc();
  return {
    inspectionId:S.inspectionId,
    store:S.store.name, division:S.basic.hq||'', dept:S.basic.dept||'', team:S.basic.team||'',
    inspector:S.basic.inspector||'', date:S.basic.date||new Date().toISOString().slice(0,10),
    delivery:S.basic.delivery||'', inboundHelpers:S.basic.inboundHelpers||'',
    workRisk:c.work, ladderCount:c.lm, facilityCount:c.cm+c.fim, tbmCount:c.tm,
    tasks:S.tasks.filter(x=>x.include),
    /* 사고조사 결과 (사진은 위 issues에 이미 담겨 있으므로 여기서는 제외) */
    accidents:(S.accidents||[]).map(x=>({
      date:x.date,type:x.type,content:x.content||'',approved:x.approved||'',
      source:x.source||'',hazardText:x.hazardText||'',riskLevel:x.riskLevel||'',
      currentState:x.currentState||'',status:x.status||''
    })),
    resultNote:S.resultNote||'', issues
  };
}
/* 최종 제출.
   누락된 점검이 있으면 팝업(confirm) 대신 화면으로 목록을 보여주고,
   누르면 그 항목으로 바로 이동한다. */
function finalSubmit(){
  const missing=completionState();
  if(missing.length){missingScreen(missing);return}
  syncTasks();
  if(hasAccidents())syncAccidents();
  if(!S.inspectionId)S.inspectionId='INSP-'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+uid();
  S.submittedAt=new Date().toISOString();S.submittedBy=S.basic?.inspector||'';save();
  submitToServer();
}
var MISSING_CACHE=[];
function missingScreen(missing){
  MISSING_CACHE=missing;
  var h='<div class="card"><h2>아직 마치지 않은 점검이 있습니다</h2>';
  h+='<p class="muted">아래 '+missing.length+'개 항목을 완료해야 제출할 수 있습니다. 누르면 해당 화면으로 이동합니다.</p>';
  h+='<div class="form-list">';
  for(var i=0;i<missing.length;i++){
    h+='<button class="missing-row" onclick="jumpToMissingAt('+i+')"><span>'+esc(missing[i].label)+'</span><b>이동 →</b></button>';
  }
  h+='</div>';
  h+='<button class="secondary wide" style="margin-top:14px" onclick="jumpToMissingAt(0)">첫 미완료 항목부터 진행하기</button>';
  h+='</div>';
  frame(tabs('')+h,'제출 전 확인','누락된 점검을 먼저 마쳐 주세요.');
}
function jumpToMissingAt(i){jumpToMissing(MISSING_CACHE[i])}

/* 제출 처리: 로딩화면 -> 완료되면 결과화면(PDF 버튼 포함) */
function submitToServer(){
  S.screen='result';
  frame(`<div class="card submitting"><div class="spinner"></div><h2>제출 처리 중입니다</h2><p class="muted">사진을 올리고 결과보고서를 만들고 있습니다. 사진이 많으면 1~2분 걸릴 수 있습니다.<br><b>창을 닫지 마세요.</b></p></div>`,`제출 중`,`잠시만 기다려 주세요.`);
  const payload=buildSubmitPayload();
  gsRun('submitInspection',payload).then(links=>{
    S.resultLinks=links;S.submitError='';save();
    report();
  }).catch(err=>{
    /* 저장이 실패해도 로컬 결과는 보여준다. 재시도는 결과화면의 버튼으로 한다. */
    S.submitError=(err&&err.message?err.message:String(err));save();
    report();
  });
}
function calc(){const work=D.works.map((w,i)=>{if(S.workNA?.[i])return{name:w[0],risk:0,total:0,status:'na'};const a=Object.values(S.wa[i]||{}),r=a.filter(x=>x.risk).length;return{name:w[0],risk:r,total:a.length,status:'checked'}});const haz={};Object.entries(S.wa).forEach(([wi,ans])=>{if(S.workNA?.[wi])return;Object.values(ans).filter(x=>x.risk).forEach(x=>(x.hazards||[]).forEach(h=>haz[h]=(haz[h]||0)+1))});const cm=(S.common.issues||[]).length,fim=(S.fire.issues||[]).length,tm=(S.tbm.issues||[]).length,lm=(S.ladder.issues||[]).length;return{work,haz:Object.entries(haz).sort((a,b)=>b[1]-a[1]),cm,fim,tm,lm}}
/* 이번 점검에서 새로 발견한 지적사항 목록 (결과보고서에서만 보여준다) */
function buildFoundIssuesHtml(){
  var rows=[],i;
  D.works.forEach(function(w,wi){
    if(S.workNA&&S.workNA[wi])return;
    var ans=S.wa[wi]||{};
    Object.keys(ans).forEach(function(qi){
      var v=ans[qi];
      if(!v||!v.risk)return;
      /* 설명 입력칸을 없앴으므로, 실제로 고른 위험 답변을 지적내용으로 쓴다. */
      var q=w[1][qi];
      var picked=(q&&q[1]&&q[1][v.oi])?q[1][v.oi]:q[0];
      rows.push({cat:w[0],text:picked,hazard:(v.hazards||[]).join('/')});
    });
  });
  (S.ladder.issues||[]).forEach(function(x){
    rows.push({cat:'사다리',text:((x.type||'')+' '+(x.item||'이상사항')).trim(),hazard:'떨어짐'});
  });
  (S.common.issues||[]).forEach(function(x){
    rows.push({cat:'공통·시설',text:x.item||'미흡사항',hazard:'시설'});
  });
  (S.fire.issues||[]).forEach(function(x){
    rows.push({cat:'소방',text:x.item||'미흡사항',hazard:'소방'});
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
/* 결과화면. 탭에서 빠졌고, 최종 제출을 마친 뒤에만 나온다.
   맨 위에 저장 결과와 PDF 받기 버튼을 두고, 그 아래에 요약을 보여준다. */
function report(){
  S.screen='result';
  const c=calc(),active=S.tasks.filter(x=>x.include),
        top=[...c.work].filter(x=>x.status!=='na').sort((a,b)=>b.risk-a.risk).slice(0,3),
        responses=S.workers.length,
        submittedText=S.submittedAt?`${new Date(S.submittedAt).toLocaleDateString('ko-KR')} · ${esc(S.submittedBy||'')} 제출`:'';
  const links=S.resultLinks||{};
  const foundHtml=buildFoundIssuesHtml();

  /* 저장 결과 카드: 성공이면 PDF/폴더 버튼, 실패면 원인과 재시도 버튼 */
  let headCard='<div class="card result-head">';
  if(S.submitError){
    headCard+='<div class="result-badge fail">저장 실패</div>';
    headCard+='<h2>제출은 됐지만 저장에 실패했습니다</h2>';
    headCard+='<div class="notice">'+esc(S.submitError)+'</div>';
    headCard+='<p class="muted">아래 결과는 이 기기에 남아 있습니다. 연결을 확인한 뒤 다시 제출하면 그대로 저장됩니다.</p>';
    headCard+='<button class="primary wide" onclick="submitToServer()">다시 제출하기</button>';
  }else{
    headCard+='<div class="result-badge ok">제출 완료</div>';
    headCard+='<h2>'+esc(S.store.name)+' 점검이 저장되었습니다</h2>';
    if(submittedText)headCard+='<p class="muted">'+submittedText+'</p>';
    if(links.pdfUrl)headCard+='<a class="primary wide result-link" href="'+esc(links.pdfUrl)+'" target="_blank">📄 결과 PDF 받기</a>';
    if(links.folderUrl)headCard+='<a class="secondary wide result-link" href="'+esc(links.folderUrl)+'" target="_blank">📁 사진 폴더 열기</a>';
    if(!links.pdfUrl&&!links.folderUrl)headCard+='<div class="notice">테스트 모드로 진행해 저장 링크가 없습니다.</div>';
  }
  headCard+='</div>';

  const summaryCard=`<div class="card"><h2>점검 요약</h2><div class="notice"><b>공식 점수·등급은 아직 산출하지 않습니다.</b><br>현재는 확인된 위험신호와 미흡사항 건수를 중심으로 보여줍니다.</div><div class="metric"><div><b>${responses}</b>의견 참여</div><div><b>${c.cm}</b>시설 미흡</div><div><b>${c.fim}</b>소방 미흡</div><div><b>${c.lm}</b>사다리 이상</div><div><b>${c.tm}</b>TBM 미흡</div><div><b>${active.length}</b>개선과제</div></div></div>`;

  const body=`${headCard}${summaryCard}<div class="card"><h2>작업유형 위험신호</h2>${c.work.map(x=>`<div class="riskrow"><header><span>${x.name}</span><span>${x.status==='na'?'해당 없음':`위험신호 ${x.risk}건`}</span></header></div>`).join('')}</div><div class="card"><h2>재해유형별 위험신호</h2>${c.haz.length?c.haz.map(([h,n])=>`<div class="riskrow"><header><span>${h}</span><span>${n}건</span></header></div>`).join(''):'<p class="muted">위험신호 없음</p>'}</div><div class="card"><h2>종합진단 초안</h2><textarea readonly>${esc(`${S.store.name}은(는) ${top.filter(x=>x.risk).map(x=>x.name).join(', ')||'전 작업'} 영역을 중심으로 확인되었습니다. 공통·시설 미흡 ${c.cm}건, 소방 미흡 ${c.fim}건, TBM 미흡 ${c.tm}건, 사다리 이상 ${c.lm}건이며 개선과제 ${active.length}건을 검토해야 합니다.`)}</textarea><div class="field" style="margin-top:10px"><label>점검자 추가 의견 <small>(선택)</small></label><textarea placeholder="위 자동 진단에 덧붙일 내용을 입력하세요" onchange="S.resultNote=this.value;save()">${esc(S.resultNote)}</textarea></div>${foundHtml}${active.length?`<h2 style="margin-top:16px">지난 지적사항 조치 확인</h2>${active.map(x=>`<div class="q"><b>${esc(x.title)}</b><div class="muted">${esc(x.source||'')} · ${esc(x.owner||'')} · ${esc(x.status||'')}</div></div>`).join('')}`:''}<button class="secondary wide" style="margin-top:12px" onclick="window.print()">보고서 인쇄</button><button class="danger wide" style="margin-top:8px" onclick="resetAll()">새 점검 시작</button></div>`;

  frame(body,'점검 결과','제출이 완료되었습니다.');
}
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
function render(x){({start,work,ladder,common:()=>checklist('common'),fire:()=>checklist('fire'),tbm:()=>checklist('tbm'),voice,other,accident,tasks,result:report}[x]||start)()}
try{
  render(S.screen);
}catch(err){
  console.error(err);
  root.innerHTML=`<div class="app"><header class="hero"><div class="eyebrow">ASUNG DAISO · SAFETY & HEALTH</div><h1>실행 오류를 확인했습니다.</h1><p>저장된 테스트 데이터 또는 브라우저 상태를 초기화할 수 있습니다.</p></header><main class="content"><div class="card"><h2>로컬 실행 오류</h2><div class="notice">${esc(err&&err.message?err.message:String(err))}</div><button class="primary wide" onclick="localStorage.removeItem(KEY);S=fresh();normalizeState();STORE_LIST=null;start()">테스트 데이터 초기화 후 시작</button></div></main></div>`;
}
