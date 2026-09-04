/*
 * API 설정 · 환경 전환 파일
 *
 * ── 왜 이렇게 만들었나
 *   예전에는 테스트할 때마다 webapp 파일과 Apps Script 코드를 운영본과 바꿔치기해야 했다.
 *   그러면 되돌리는 걸 잊고 테스트 데이터가 운영 시트에 들어갈 위험이 있다.
 *   그래서 파일은 그대로 두고 "주소"로만 환경을 바꾸도록 했다.
 *
 * ── 쓰는 방법 (파일을 고치지 않아도 된다)
 *   운영    : index.html
 *   테스트  : index.html?env=test     ← 테스트용 Apps Script + 테스트 스프레드시트
 *   목업    : index.html?env=mock     ← 서버 연결 없이 화면 흐름만 확인 (샘플 데이터)
 *
 *   테스트·목업으로 들어가면 화면 오른쪽 위에 표시가 뜬다. 운영일 때는 아무것도 안 뜬다.
 *   한번 고른 환경은 이 브라우저에 기억되므로, 주소를 다시 붙이지 않아도 유지된다.
 *   운영으로 돌아올 때는 index.html?env=prod 로 한 번 들어오면 된다.
 *
 * ── 준비물 (한 번만)
 *   1) 운영 스프레드시트를 [사본 만들기]로 복사해 "테스트" 시트를 만든다.
 *   2) 그 사본의 확장프로그램 → Apps Script 에 appsscript/ 코드를 붙여넣고 배포한다.
 *   3) 거기서 나온 .../exec 주소를 아래 ENDPOINTS.test.url 에 넣는다.
 *   이러면 테스트가 운영 시트·드라이브를 건드리지 않는다.
 *
 * ── API_KEY
 *   Apps Script의 Code.gs 안 API_KEY와 똑같은 값이어야 한다.
 *   이 파일은 브라우저로 그대로 내려가므로 완전한 비밀은 될 수 없다.
 *   팀 내부용 전제이며 저장소는 Private으로 유지해야 한다.
 *
 * ── ⚠ 이 파일을 손댈 때 반드시 지킬 것
 *   prod.url / test.url 에 실제 주소를 넣은 뒤에는, 절대 이 파일을 통째로
 *   다시 쓰지 않는다(fs_write로 전체 덮어쓰기 금지). 반드시 str_replace로
 *   그 줄만 바꾼다. 통째로 덮어쓰면 여기 적힌 실제 배포 URL이 통째로 사라지고
 *   git 등 되돌릴 手段이 없으면 복구가 불가능하다(2026-09-04에 실제로 벌어진 일).
 */
(function(){
  var ENDPOINTS={
    /* 운영: 실제 점검 결과가 쌓이는 곳 */
    prod:{url:'https://script.google.com/macros/s/AKfycbyjUgbbLVXyxaBhBsCKexNhViEHAYoVPMm93-zd0031DJSKL8ZNdoISxn9afO_3iJrTYA/exec', key:'daiso-safety-2026', label:''},
    /* 테스트: 사본 스프레드시트에 연결된 별도 배포 주소를 넣는다 */
    test:{url:'PASTE_YOUR_TEST_APPS_SCRIPT_WEBAPP_URL_HERE', key:'daiso-safety-2026', label:'테스트 서버'},
    /* 목업: 서버를 아예 부르지 않는다. 주소는 필요 없다 */
    mock:{url:'', key:'', label:'목업 모드 · 서버 저장 안 됨'}
  };

  var STORE_KEY='daiso_app_env';
  /* 주소에 ?env=... 가 있으면 그걸 쓰고 기억한다. 없으면 지난번에 고른 값을 쓴다. */
  var asked=(function(){
    try{
      var m=String(location.search||'').match(/[?&]env=([a-zA-Z]+)/);
      return m?String(m[1]).toLowerCase():'';
    }catch(e){return ''}
  })();
  var saved='';
  try{saved=localStorage.getItem(STORE_KEY)||''}catch(e){}
  var env=ENDPOINTS[asked]?asked:(ENDPOINTS[saved]?saved:'prod');
  if(asked&&ENDPOINTS[asked]){
    try{localStorage.setItem(STORE_KEY,asked)}catch(e){}
  }

  var cfg=ENDPOINTS[env];
  window.APP_ENV=env;
  window.API_URL=cfg.url;
  window.API_KEY=cfg.key;
  /* app.js가 이 값을 보고 서버 호출을 건너뛴다(mockServer로 대체). */
  window.APP_TEST_MODE=(env==='mock');

  /* 지금 어느 환경인지 화면에 남긴다. 테스트인데 운영으로 착각하는 사고를 막는 장치다.
     운영일 때는 아무것도 그리지 않는다. */
  if(cfg.label){
    var draw=function(){
      if(!document.body||document.getElementById('envBadge'))return;
      var b=document.createElement('div');
      b.id='envBadge';
      b.textContent=cfg.label;
      b.title='운영으로 돌아가려면 주소 뒤에 ?env=prod 를 붙여 한 번 접속하세요.';
      b.style.cssText='position:fixed;z-index:9999;top:0;left:50%;transform:translateX(-50%);'
        +'padding:3px 12px;border-radius:0 0 9px 9px;pointer-events:none;'
        +'background:'+(env==='mock'?'#6b21a8':'#b45309')+';color:#fff;'
        +'font:700 10px/1.4 system-ui,-apple-system,"Malgun Gothic",sans-serif;letter-spacing:.02em';
      document.body.appendChild(b);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',draw);
    else draw();
  }
})();
