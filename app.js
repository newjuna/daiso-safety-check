/**
 * 안전보건 현장진단 - Apps Script API
 *
 * 이 파일은 화면(UI)을 담당하지 않는다. 화면은 GitHub Pages에 올린
 * webapp/index.html 이 담당하고, 이 파일은 그 화면이 요청하는
 * 시트 읽기/쓰기, 드라이브 저장 같은 서버 작업만 처리한다.
 *
 * ── 배포 방법 ─────────────────────────────────────────────
 * 1) 이 스프레드시트의 [확장 프로그램] → [Apps Script] 열기
 * 2) Code.gs / Sheets.gs / Drive.gs / SyncApproval.gs 붙여넣기
 * 3) 상단 [배포] → [새 배포] → 유형: 웹 앱
 *    - 실행할 사용자: 나
 *    - 액세스 권한: 링크가 있는 모든 사용자
 * 4) 배포 후 나오는 URL(.../exec)을 webapp/config.js의 API_URL에 붙여넣기
 * ──────────────────────────────────────────────────────────
 */

/* 화면(config.js)에 적어둔 값과 반드시 같아야 한다.
   이 키가 맞지 않는 요청은 시트/드라이브에 아무것도 쓰지 않는다. */
const API_KEY = 'daiso-safety-2026';

/* 화면에서 호출할 수 있는 함수 목록(허용 목록).
   여기 없는 함수명은 요청해도 실행되지 않는다. */
const ALLOWED_FUNCTIONS = {
  getStoreList: true,
  getStoreListCompact: true,
  getStoreAccidentHistory: true,
  getStoreOpenIssues: true,
  /* 위 두 개를 한 번에 돌려주는 함수. 화면 진입 대기시간을 줄이기 위해 추가했다. */
  getStorePrepData: true,
  /* 과거 점검 결과·지적사항·사진을 점검 시작 전에 함께 확인한다. */
  getStoreInspectionHistory: true,
  getInspectionSnapshot: true,
  getLadderTypeImages: true,
  getDashboardData: true,
  getStoreDashboardHistory: true,
  submitInspection: true,
  /* 화면에서 만든 결과보고서 PDF를 드라이브에 저장 (제출 직후 자동 호출) */
  saveReportPdf: true
};

/**
 * 화면에서 fetch(POST)로 보낸 요청을 처리하는 진입점.
 * 요청 본문 예: {"fn":"getStoreList","args":[],"key":"..."}
 */
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);

    if (req.key !== API_KEY) {
      return jsonOut_({ ok: false, message: '인증 실패' });
    }
    if (!ALLOWED_FUNCTIONS[req.fn]) {
      return jsonOut_({ ok: false, message: '허용되지 않은 요청: ' + req.fn });
    }

    const fn = this[req.fn];
    if (typeof fn !== 'function') {
      return jsonOut_({ ok: false, message: '함수를 찾을 수 없습니다: ' + req.fn });
    }

    const result = fn.apply(null, req.args || []);
    return jsonOut_({ ok: true, data: result });

  } catch (err) {
    return jsonOut_({ ok: false, message: (err && err.message) ? err.message : String(err) });
  }
}

/** 브라우저에서 주소를 직접 열었을 때 보여줄 안내 (동작 확인용) */
function doGet() {
  return jsonOut_({
    ok: true,
    data: '안전보건 현장진단 API가 정상 동작 중입니다. 화면은 GitHub Pages에서 접속하세요.'
  });
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ 시트 이름 상수 ============ */
const SHEET_ACCIDENT   = '사고DB';         /* 산재사고 원장 (기존 탭, 읽기 전용) */
const SHEET_ORG_MAP    = '조직_표준화표';   /* 부서명 매핑표 (기존 탭, 읽기 전용) */
const SHEET_STORES     = '매장';           /* 매장 목록 (기존 탭, 읽기 전용) */
const SHEET_INSPECTION = '점검이력';       /* 점검 1건 = 1행 */
const SHEET_ISSUES     = '이슈상세';       /* 미흡/위험 항목 1건 = 1행 */

/* ============ 최초 1회 실행 - 신규 탭 생성 ============ */
/**
 * 상단 함수 선택에서 setupInspectionSheets 선택 후 ▶ 실행.
 * '점검이력' / '이슈상세' 탭만 새로 만든다. 기존 탭은 건드리지 않는다.
 */
function setupInspectionSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  createOrUpdateSheet_(ss, SHEET_INSPECTION, [
    '제출일시', '점검일', '점검자', '영업본부', '부서명', '팀명', '매장명',
    '작업위험신호', '사다리이상', '시설미흡', 'TBM미흡',
    '개선과제건수', '개선과제완료건수', '점검폴더링크',
    /* 아래 2개는 사고조사 탭에서 넘어오는 값 (기존 열 뒤에 추가) */
    '사고조사건수', '재발방지미흡건수',
    '점검ID', '결과PDF링크', '입고시간대', '입고도우미인원',
    /* 2026-08 점수화 반영분 (기존 열 뒤에 추가, 기존 데이터에는 영향 없음) */
    '종합점수', '종합등급', '입고인력부담', '입고평균투입인원', 'TBM확인방법',
    /* 2026-08 추가분: TBM(스트레칭) 실시시각과 입고작업 시작시간 비교 결과 */
    'TBM오전시각', 'TBM오후시각', 'TBM스트레칭갭', 'TBM스트레칭갭분',
    /* 결과보고서 판정 근거를 그대로 재현하기 위한 입고작업 원본값 */
    '입고시작시각', '입고종료시각', '임직원투입인원', '도우미퇴근시각',
    /* 2026-09 현장정보 추가: 물량과 층/이동설비는 서로 분리해 기록 */
    /* 직전 시험버전 열은 기존 행이 다른 의미로 해석되지 않도록 그대로 보존 */
    '입고박스수', '작업공간층구성', '작업공간이동설비', '입고이동경로',
    '작업공간층수', '계단유무', 'EV유무', 'ES유무',
    '점검유형', '기준점검ID', '점검원본링크'
  ]);

  createOrUpdateSheet_(ss, SHEET_ISSUES, [
    '제출일시', '점검일', '매장명', '영업본부', '부서명', '팀명', '점검자',
    '구분', '세부항목', '재해유형', '개선과제여부', '상태', '사진링크',
    '점검ID', '이슈ID', '조치완료점검ID', '상세내용'
  ]);

  /* 스크립트 편집기에서 직접 실행하면 UI 세션이 없어 getUi()가 예외를 던질 때가 있다.
     탭/헤더 생성(위 로직)은 이미 끝났으므로 알림 실패는 조용히 무시한다. */
  try {
    SpreadsheetApp.getUi().alert('세팅 완료: 점검이력 / 이슈상세 탭이 준비되었습니다.');
  } catch (e) {
    Logger.log('세팅 완료 (UI 알림 없는 환경): 점검이력 / 이슈상세 탭이 준비되었습니다.');
  }
}

function createOrUpdateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f0f2f5');
  sheet.autoResizeColumns(1, headers.length);
}

/* ============ 연결 테스트 ============ */
/**
 * 함수 선택에서 testConnection 실행 → 실행 로그에서 결과 확인.
 * 시트 연결과 매장 목록 조회가 정상인지 점검한다.
 */
function testConnection() {
  const stores = getStoreList();
  Logger.log('매장 목록 수: ' + stores.length);
  if (stores.length) {
    const sample = stores[0].store;
    Logger.log('샘플 매장명: ' + sample);
    Logger.log('그 매장 사고이력 수: ' + getStoreAccidentHistory(sample).length);
  }
  Logger.log('사다리 가이드 이미지: ' + JSON.stringify(getLadderTypeImages()));
}
