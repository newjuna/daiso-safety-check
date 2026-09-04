/*
 * API 설정 파일
 *
 * API_URL: Apps Script를 "웹 앱"으로 배포하면 나오는 URL(.../exec)을 넣는다.
 *          배포할 때마다 URL이 바뀌지 않으므로 한 번만 설정하면 된다.
 *
 * API_KEY: Apps Script의 Code.gs 안에 있는 API_KEY와 똑같은 값을 넣는다.
 *          아무나 API를 호출해 시트/드라이브에 쓰는 것을 막는 최소한의 방어선이다.
 *
 * 주의: 이 파일은 브라우저에 그대로 내려가므로 여기 적힌 키는 완전한 비밀이 될 수 없다.
 *       팀 내부용이라는 전제 하에 쓰는 값이며, 저장소는 Private으로 유지해야 한다.
 *       정식 보안이 필요해지면 구글 로그인(OAuth) 방식으로 교체할 예정.
 */
window.API_URL = 'https://script.google.com/macros/s/AKfycbxx9zyhfmm_CoeHeYcPi1_paXToKrZ-wc_aZ3KNqwc5WaaGAEjwSF2xJ6Jwc_kZZPo6bA/exec';
window.API_KEY = 'daiso-safety-2026';
