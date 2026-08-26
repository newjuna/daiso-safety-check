/* ============================================================
   안전보건 현장진단 결과보고서 (시안C 레이아웃 · 실제 데이터 연결본)

   레이아웃/함수 구조는 GPT 시안(안전보건_결과보고서_시안C_최종본.html)을 그대로 따랐다.
   시안과 달라진 점은 아래 3가지뿐이다.
     1) 하드코딩된 SNAPSHOT 상수 대신, 실제 점검 데이터를 읽어온다.
        (부모창 getLandscapeReportSnapshot() → 없으면 localStorage 캐시)
     2) 사진 placeholder를 실제 사진이 있으면 <img>로 바꿔 표시한다.
        (사진이 없으면 시안과 동일하게 "이미지 첨부 박스" 점선박스 유지)
     3) 사고이력이 없는 매장에서도 한 파일로 동작하도록 분기를 넣었다.
        (기존에는 result-preview-accident.html / -no-accident.html 두 개로 나뉘어 있었음)

   ※ 점수·등급 숫자는 화면에 절대 노출하지 않는다. 내부 판정(양호/관리필요/위험)에만 사용한다.
   ============================================================ */
(function(){

/* ============ 실제 점검 데이터 로드 ============ */
/* 1순위: 이 창을 열어준 부모창(앱 화면)의 함수를 직접 호출 — 사진 실데이터까지 온다.
   2순위: localStorage 캐시 — 팝업 차단/새로고침 상황 대비. 단 사진(dataUrl)은 저장되지 않아 없다. */
function loadSnapshot(){
  var d=null;
  try{ d=window.opener&&window.opener.getLandscapeReportSnapshot&&window.opener.getLandscapeReportSnapshot(); }catch(e){}
  if(!d){ try{ d=JSON.parse(localStorage.getItem('daiso_landscape_report_v1')); }catch(e){} }
  return d;
}

/* 이 파일은 두 곳에서 쓰인다.
   1) report.html — 점검자가 화면으로 보는 결과보고서
   2) app.js      — 최종 제출 시 같은 화면을 그려서 PDF로 캡처(드라이브 자동저장)
   그래서 페이지 HTML을 만드는 함수를 window.buildReportPages()로 노출한다. */

/* ============ 시안C 원본 유틸 (구조 그대로) ============ */
function esc(v){ return String(v ?? "").replace(/[&<>"']/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[s])); }
function pageNo(n){ return `<div class="page-no">${String(n).padStart(2,"0")}</div>`; }
function tag(label, level){ return `<span class="tag ${level}">${esc(label)}</span>`; }
function hazardPills(arr){ return (arr||[]).map(x=>`<span class="hazard">${esc(x)}</span>`).join(""); }

/* 점수(내부값)를 화면 표시용 상태로 변환. 숫자는 노출하지 않는다. */
function scoreState(v){ if(v==null) return ["확인필요","info"]; if(v>=75) return ["양호","good"]; if(v>=60) return ["관리필요","warn"]; return ["위험","danger"]; }

function categoryStates(s){
  const parts=s.scoreParts||{};
  const work = scoreState(parts.work);
  const ladder = scoreState(parts.ladder);
  const common = scoreState(parts.common);
  const fire = scoreState(parts.fire);
  let tbm = scoreState(parts.tbm);
  let accident = scoreState(parts.accident);
  if (s.tbmStretchGap && s.tbmStretchGap.level === "severe") tbm=["위험","danger"];
  if ((s.tbmCrossCheckFlags||[]).length) tbm=["위험","danger"];
  if ((s.accidents||[]).some(a=>a.status==="미조치" || a.riskLevel==="상")) accident=["위험","danger"];
  return {work,ladder,common,fire,tbm,accident};
}
function findingState(f){ return ["관리필요","warn"]; }

/* ============ 사진 표시 (실제 데이터 연결로 새로 만든 부분) ============ */
/* 사진이 있으면 실제 이미지로, 없으면 시안과 동일한 "이미지 첨부 박스" 점선박스로 표시한다.
   photos는 [{name, dataUrl}] 형태이며 dataUrl이 실제 이미지 데이터다. */
function photoBox(photos, label, cls){
  cls = cls || "";
  label = label || "이미지 첨부 박스";
  var list=(photos||[]).filter(function(p){ return p && p.dataUrl; });
  if(!list.length){
    return `<div class="placeholder ${cls}">${esc(label)}<small>첨부된 현장사진 없음</small></div>`;
  }
  var more = list.length>1 ? `<span class="more">+${list.length-1}</span>` : "";
  return `<div class="photo ${cls}"><img src="${list[0].dataUrl}" alt="${esc(label)}">${more}</div>`;
}

function previewFindings(s,count){ return (s.findings||[]).slice(0,count||2); }

function coverSummaryText(s,st){
  const parts = [];
  if(st.accident[0]==="위험") parts.push("사고 재발방지");
  if(st.ladder[0]!=="양호") parts.push("사다리 관리");
  if(st.tbm[0]==="위험") parts.push("TBM 운영");
  var lv = (s.inboundLabor && s.inboundLabor.level) || "";
  if(lv==="minor" || lv==="severe") parts.push("입고 인력부담");
  if((s.work||[]).some(w=>w.risk>0)) parts.push("위험신호 작업");
  const first = parts.slice(0,2);
  if(first.length===0){
    return '전반적으로 <span class="hero-highlight">양호한 수준</span>으로 확인되었으며, 현재 관리상태를 지속 유지할 필요가 있습니다.';
  }
  if(first.length===1){
    return '이번 점검에서는 <span class="hero-highlight">'+esc(first[0])+'</span>에 대한 우선 확인이 필요한 것으로 파악되었습니다.';
  }
  return '이번 점검에서는 <span class="hero-highlight">'+esc(first[0])+'</span> 및 <span class="hero-highlight">'+esc(first[1])+'</span>에 대한 우선 관리가 필요한 것으로 확인되었습니다.';
}
function workSummaryMap(s){
  const map={};
  (s.findings||[]).forEach(f=>{
    if(!map[f.area]) map[f.area]=[];
    map[f.area].push(f.title);
  });
  return map;
}
function areaFinding(s, category){ return (s.findings||[]).find(f=>f.category===category); }
/* 그 분야(카테고리)에 속한 사진들을 모아서 대표 1장을 뽑을 수 있게 한다. */
function areaPhotos(s, category){
  var out=[];
  (s.findings||[]).forEach(function(f){
    if(f.category===category)(f.photos||[]).forEach(function(p){ out.push(p); });
  });
  return out;
}

/* ============ 1페이지: 갑지 ============ */
function makeCover(s,n){
  const st=categoryStates(s);
  const previews=previewFindings(s,2);
  const gap=s.tbmStretchGap;
  const gapText = !gap ? "미측정" : (gap.gapMinutes>0 ? gap.gapMinutes+"분 지연" : "양호");
  return `<section class="page">
    <div class="kicker">SAFETY &amp; HEALTH FIELD DIAGNOSIS</div>
    <h1>${esc(s.store.name)} 안전보건 현장진단 결과보고서</h1>
    <div class="meta">${esc(s.store.hq)} · ${esc(s.store.dept)} · ${esc(s.store.team)}　|　${esc(s.store.date)}　|　점검자 ${esc(s.store.inspector)}</div>
    <div class="hero">
      <div>
        <div style="font-size:11px;opacity:.68;margin-bottom:6px">종합진단</div>
        <div style="font-size:22px;line-height:1.55;font-weight:780">
          ${coverSummaryText(s,st)}
        </div>
      </div>
      <div>
        <div style="font-size:11px;opacity:.68;margin-bottom:6px">이번 점검 핵심 신호</div>
        <div style="line-height:1.7;font-size:13px">
          · 위험신호 작업유형 <b>${(s.work||[]).filter(w=>w.risk>0).length}개</b><br>
          · 미흡사항 전체 <b>${(s.findings||[]).length}건</b><br>
          · 미조치 과거사고 <b>${(s.accidents||[]).filter(a=>a.status==="미조치").length}건</b><br>
          · TBM-입고 간격 <b>${esc(gapText)}</b>
        </div>
      </div>
    </div>
    <div class="statusrow">
      <div class="statusbox"><b>작업점검</b>${tag(st.work[0],st.work[1])}</div>
      <div class="statusbox"><b>사다리</b>${tag(st.ladder[0],st.ladder[1])}</div>
      <div class="statusbox"><b>공통·시설</b>${tag(st.common[0],st.common[1])}</div>
      <div class="statusbox"><b>소방</b>${tag(st.fire[0],st.fire[1])}</div>
      <div class="statusbox"><b>TBM</b>${tag(st.tbm[0],st.tbm[1])}</div>
    </div>
    <div class="section-head" style="margin-top:14px">
      <div><h2 style="font-size:20px;margin-bottom:4px">주요 현장 미흡사항</h2></div>
    </div>
    <div class="issue-preview-wrap">
      ${previews.length?previews.map(f=>`
        <div class="issue-preview">
          <div class="photo-cell">${photoBox(f.photos,"이미지 첨부 박스","tall")}</div>
          <div class="text">
            <div>${tag(f.category,"info")} ${tag(findingState(f)[0],findingState(f)[1])}</div>
            <h3>${esc(f.area)} · ${esc(f.title)}</h3>
            <div class="label">관련 위험</div>
            <div class="hazards">${hazardPills(f.hazards||[])}</div>
            <div class="label" style="margin-top:8px">주요 내용</div>
            <p class="meta">${esc(f.question || f.note || "현장 확인사항")}</p>
          </div>
        </div>`).join(""):'<div class="card"><h3>이번 점검 미흡사항 없음</h3><p class="meta">확인된 미흡사항이 없습니다.</p></div>'}
    </div>
    <div class="footer-note">※ 갑지는 긴 서술문 대신 키워드와 대표 미흡사항 카드 중심으로 구성</div>
    ${pageNo(n)}
  </section>`;
}

/* ============ 2페이지: 작업유형별 분석 ============ */
function workRows(s){
  const map=workSummaryMap(s);
  return (s.work||[]).map(w=>{
    const level = w.status==="na" ? ["해당없음","info"] : (w.risk>0 ? ["관리필요","warn"] : ["양호","good"]);
    const txt = (map[w.name]&&map[w.name].join(" / ")) || (w.status==="na" ? "해당없음" : "특이사항 없음");
    return `<div class="work-row">
      <div class="work-cell"><b>${esc(w.name)}</b></div>
      <div class="work-cell">${tag(level[0],level[1])}</div>
      <div class="work-cell">${esc(txt)}</div>
    </div>`;
  }).join("");
}
function makeWorkPage(s,n){
  const riskWorks=(s.work||[]).filter(w=>w.risk>0).map(w=>esc(w.name));
  const labor=s.inboundLabor;
  /* 입고 인력부담은 시간·인원을 다 입력하지 않으면 측정되지 않는다(null). 그 경우를 구분해서 표시한다. */
  const laborTag = !labor
      ? tag("미측정","info")
      : tag(labor.level==="severe"?"위험":labor.level==="minor"?"관리필요":"양호",
            labor.level==="severe"?"danger":labor.level==="minor"?"warn":"good");
  const laborBody = !labor
      ? '<p class="meta">입고 시작·종료시간과 투입인원을 모두 입력하면 인력부담이 자동 계산됩니다.</p>'
      : `<p>평균 투입인원 <b>${esc(labor.avgPeople)}명</b> · 도우미 공백비율 <b>${esc(labor.gapRatioPct)}%</b></p>
         <p class="meta">입고·하차 관련 위험신호와 함께 보면 작업부담 판단이 더 쉬워집니다.</p>`;
  return `<section class="page">
    <div class="kicker">WORK PROCESS REVIEW</div>
    <div class="section-head"><div><h2>작업유형별 분석</h2></div></div>
    <div class="rule"></div>
    <div class="grid2">
      <div class="card">
        <h3>작업유형 상세</h3>
        <div class="work-table">
          <div class="work-head"><div>작업유형</div></div>
          <div class="work-head"><div>상태</div></div>
          <div class="work-head"><div>주요 내용</div></div>
          ${workRows(s)}
        </div>
      </div>
      <div>
        <div class="card">
          <h3>분석 피드백</h3>
          ${riskWorks.length
            ? `<p style="font-size:18px;line-height:1.65">이번 점검에서는 <b>${riskWorks.join(", ")}</b> 작업에서 위험신호가 확인되었습니다.</p>
               <p class="meta">재해유형만 보이는 구조가 아니라, 실제로 어떤 작업 내용에서 위험신호가 발견됐는지를 함께 확인할 수 있습니다.</p>`
            : `<p style="font-size:18px;line-height:1.65">전체 작업유형에서 <b>위험신호가 확인되지 않았습니다.</b></p>
               <p class="meta">현재 작업방법과 관리상태를 지속 유지해 주세요.</p>`}
        </div>
        <div class="card" style="margin-top:12px">
          <h3>입고 인력부담</h3>
          <div style="margin-bottom:9px">${laborTag}</div>
          ${laborBody}
        </div>
      </div>
    </div>
    ${pageNo(n)}
  </section>`;
}

/* ============ 3페이지: 분야별 핵심 현황 ============ */
function makeAreaPage(s,n){
  const acc=(s.accidents||[])[0];
  const st=categoryStates(s);
  const ladderF=areaFinding(s,"사다리");
  const commonF=areaFinding(s,"공통·시설");
  const fireF=areaFinding(s,"소방");
  const tbmF=areaFinding(s,"TBM");
  const gap=s.tbmStretchGap;
  const ladderCounts=Object.entries((s.ladder&&s.ladder.counts)||{}).filter(function(e){return +e[1]>0});
  return `<section class="page">
    <div class="kicker">AREA SUMMARY</div>
    <div class="section-head"><div><h2>분야별 핵심 현황</h2></div></div>
    <div class="grid2">
      <div class="area-card">
        <div class="photo-cell">${photoBox(acc?acc.photos:[], "사고조사 / 조치 후 이미지 첨부 박스","tall")}</div>
        <div class="body">
          <div>${tag("사고 재발방지","info")} ${acc?tag(st.accident[0],st.accident[1]):tag("해당없음","info")}</div>
          <h3>${acc?esc(acc.type)+" 사고":"사고이력 없음"}</h3>
          <p>${acc?esc(acc.content):"과거 사고 이력이 없습니다."}</p>
          <div class="label">유해위험요인 / 현 상태</div>
          <p class="meta">${acc?esc(acc.hazardText)+" / "+esc(acc.status||"확인 전"):"특이사항 없음"}</p>
        </div>
      </div>
      <div class="area-card">
        <div class="photo-cell">${photoBox(areaPhotos(s,"사다리"), "사다리 미흡 이미지 첨부 박스","tall")}</div>
        <div class="body">
          <div>${tag("사다리","info")} ${tag(st.ladder[0],st.ladder[1])}</div>
          <h3>${ladderF?esc(ladderF.title):"사다리 현황"}</h3>
          <p>${ladderCounts.length?ladderCounts.map(function(e){return esc(e[0])+" "+e[1]+"대"}).join(" · "):"보유 사다리 없음"}</p>
          <div class="label">주요 내용</div>
          <p class="meta">${ladderF?esc(ladderF.title)+" 확인":"이상항목 없음"}</p>
        </div>
      </div>
      <div class="area-card">
        <div class="photo-cell">${photoBox(areaPhotos(s,"공통·시설").concat(areaPhotos(s,"소방")), "공통·시설 / 소방 이미지 첨부 박스","tall")}</div>
        <div class="body">
          <div>${tag("공통·시설","info")} ${tag(st.common[0],st.common[1])} ${tag("소방","info")} ${tag(st.fire[0],st.fire[1])}</div>
          <h3>공통·시설 / 소방</h3>
          <p>공통·시설 미흡 <b>${esc((s.sections&&s.sections.common)||0)}건</b> · 소방 미흡 <b>${esc((s.sections&&s.sections.fire)||0)}건</b></p>
          <div class="label">대표 항목</div>
          <p class="meta">${[commonF&&commonF.title, fireF&&fireF.title].filter(Boolean).map(esc).join(" / ")||"미흡사항 없음"}</p>
        </div>
      </div>
      <div class="area-card">
        <div class="photo-cell">${photoBox(areaPhotos(s,"TBM"), "TBM / 작업 확인 이미지 첨부 박스","tall")}</div>
        <div class="body">
          <div>${tag("TBM","info")} ${tag(st.tbm[0],st.tbm[1])}</div>
          <h3>${tbmF?esc(tbmF.title):"TBM 현황"}</h3>
          <p>입고 시작 전 TBM 운영 순서 및 위험요인 공유 여부를 함께 확인합니다.</p>
          <div class="label">핵심 신호</div>
          <p class="meta">${!gap?"TBM-입고 순서 미측정":(gap.gapMinutes>0?"입고작업이 TBM보다 "+gap.gapMinutes+"분 먼저 시작됨":"실시순서 양호")} / 확인방법: ${esc(s.tbmConfirmMethod||"-")}</p>
        </div>
      </div>
    </div>
    ${pageNo(n)}
  </section>`;
}

/* ============ 4페이지: 근로자 의견 및 지난 지적사항 조치확인 ============ */
function makeOpinionPage(s,n){
  return `<section class="page">
    <div class="kicker">WORKER VOICE · FOLLOW-UP</div>
    <h2>근로자 의견 및 지난 지적사항 조치확인</h2>
    <div class="rule"></div>
    <div class="grid2">
      <div class="card">
        <h3>근로자 의견청취</h3>
        <p class="meta">양호하지 않은 응답만 표시</p>
        ${(s.workerOpinions||[]).map(o=>`<div class="opinion"><b>근로자 ${esc(o.worker)}</b><div style="margin-top:5px">${esc(o.question)}</div><div style="margin-top:5px;color:var(--red);font-weight:800">${esc(o.answer)}</div></div>`).join("") || "<p class='meta'>특이의견 없음</p>"}
        ${(s.tbmCrossCheckFlags||[]).map(f=>`<div class="note"><b>TBM 교차확인</b><br>${esc(f.message)}</div>`).join("")}
      </div>
      <div class="card">
        <h3>지난 지적사항 조치확인</h3>
        ${(s.tasks||[]).map(t=>`
          <div class="follow-card">
            <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(t.title)}</b>${tag(t.status, t.status==="조치완료"?"good":"warn")}</div>
            <p class="meta" style="margin:7px 0 0">${esc(t.date)} · ${esc(t.owner)}</p>
            <div class="beforeafter">
              <div class="photo-cell">${photoBox([], "조치 전 이미지 첨부 박스","small")}</div>
              <div class="photo-cell">${photoBox([], "조치 후 이미지 첨부 박스","small")}</div>
            </div>
          </div>
        `).join("") || "<p class='meta'>지난 지적사항 없음</p>"}
        ${(s.tasks||[]).length?'<div class="note">현재 데이터 구조상 지난 지적사항의 조치 전/후 사진 필드는 존재하지 않으므로, 이 영역은 우선 디자인용 박스로 반영했습니다.</div>':''}
      </div>
    </div>
    ${pageNo(n)}
  </section>`;
}

/* ============ 5페이지~: 현장 개선사항 (미흡사항 전체, 2건씩 페이지 자동 증가) ============ */
function improvementText(f){
  const t=(f.title||"");
  if(f.category==="사다리") return "이상 사다리 사용 여부를 확인하고, 사용 전 발판·체결상태 점검 후 필요한 조치를 실시합니다.";
  if(f.category==="소방") return "소화기 상태를 재확인하고 정기점검 및 유지관리 기준에 따라 조치합니다.";
  if(f.category==="TBM") return "작업 전 최근 사고사례와 예방수칙이 실제 근로자에게 공유되도록 TBM 운영을 보완합니다.";
  if(t.includes("안전모")) return "해당 작업 시 필요한 보호구 착용기준이 현장에서 준수되도록 안내·확인합니다.";
  if(t.includes("하차")) return "수작업 부담을 줄일 수 있도록 작업방법과 투입인원을 검토하고, 끼임 위험이 없도록 작업동선을 관리합니다.";
  if(f.category==="공통·시설") return "전기·시설물의 이상상태를 확인하고 사용 전 안전상태가 유지되도록 조치합니다.";
  return "해당 위험요인을 제거하거나 노출을 줄일 수 있도록 현장 조치 후 재확인합니다.";
}
function makeIssuePages(s,startNo){
  const fs=s.findings||[];
  if(!fs.length)return "";
  const per=2;
  const pages=[];
  for(let i=0;i<fs.length;i+=per){
    const chunk=fs.slice(i,i+per);
    const n=startNo+pages.length;
    pages.push(`<section class="page">
      <div class="kicker">FIELD ACTION ITEMS</div>
      <div class="section-head"><div><h2>현장 개선사항</h2></div><div class="meta">${i+1}–${Math.min(i+per,fs.length)} / ${fs.length}</div></div>
      <div style="display:grid;grid-template-rows:1fr 1fr;gap:14px">
        ${chunk.map(f=>`
          <div class="issue-card">
            <div class="photo-cell">${photoBox(f.photos,"이미지 첨부 박스","tall")}</div>
            <div class="issue-copy">
              <div>${tag(f.category,"info")} ${tag(findingState(f)[0],findingState(f)[1])}</div>
              <h3>${esc(f.area)} · ${esc(f.title)}</h3>
              <div class="label">확인 문항/내용</div>
              <p>${esc(f.question || f.note || "현장 확인사항")}</p>
              <div class="label">관련 위험</div>
              <div class="hazards">${hazardPills(f.hazards||[])}</div>
              <div class="label" style="margin-top:9px">개선방향</div>
              <p class="meta">${improvementText(f)}</p>
            </div>
          </div>
        `).join("")}
      </div>
      ${pageNo(n)}
    </section>`);
  }
  return pages.join("");
}

/* ============ 페이지 HTML 생성 (app.js의 PDF 캡처에서도 재사용) ============ */
function buildReportPages(s){
  if(!s || !s.store) return "";
  var n=1, html="";
  html += makeCover(s,n++);
  html += makeWorkPage(s,n++);
  html += makeAreaPage(s,n++);
  html += makeOpinionPage(s,n++);
  html += makeIssuePages(s,n);
  return html;
}
window.buildReportPages=buildReportPages;

/* ============ 렌더링 (report.html 전용) ============ */
function render(){
  var deck=document.getElementById("deck");
  if(!deck)return; /* app.js가 이 파일을 불러쓸 때는 #deck이 없다. 그 경우 렌더링하지 않는다. */
  var s=loadSnapshot();
  if(!s || !s.store){
    deck.innerHTML='<div class="empty-live"><b>보고서 데이터를 불러오지 못했습니다.</b>'
      +'<small>점검 결과화면에서 «결과보고서 보기» 버튼을 다시 눌러 주세요.<br>'
      +'브라우저가 팝업을 차단했거나, 결과화면을 거치지 않고 이 주소를 직접 열면 데이터가 없습니다.</small></div>';
    return;
  }
  deck.innerHTML = buildReportPages(s);
}
window.reportGo=function(n){ var p=document.querySelectorAll(".page")[n-1]; if(p) p.scrollIntoView({behavior:"smooth"}); };
render();

})();
