/* ============================================================
   안전보건 현장진단 결과보고서 (동선형 레이아웃 · 실제 데이터 연결본)

   동선형 시안의 핵심 구조를 실제 점검 데이터와 PDF 캡처 흐름에 연결한다.
   실제 데이터 연결 원칙은 아래와 같다.
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

function routeBadge(label, level){ return `<span class="route-badge ${level}">${esc(label)}</span>`; }
function workDisplayState(w){
  if(!w || w.status==="na") return ["해당없음","none"];
  if(+w.risk>0) return ["관리필요","watch"];
  return ["양호","good"];
}
function workFindingMap(s){
  const map={};
  (s.findings||[]).forEach(function(f){
    const key=f.area||"";
    if(!map[key]) map[key]=[];
    map[key].push(f);
  });
  return map;
}

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
  const gap=s.tbmStretchGap;
  const gapText = !gap ? "미측정" : (gap.gapMinutes>0 ? gap.gapMinutes+"분 지연" : "양호");
  const works=(s.work||[]).slice(0,11);
  const statusRows=[
    ["작업",(s.work||[]).filter(w=>w.risk>0).length+"개 동선 확인",(s.work||[]).some(w=>w.risk>0)?["위험신호","danger"]:st.work],
    ["사다리","사다리 점검",st.ladder],
    ["시설","공통·시설 점검",st.common],
    ["소방","소방설비 점검",st.fire],
    ["TBM","입고 간격 "+gapText,st.tbm]
  ];
  return `<section class="page">
    <div class="kicker">SAFETY &amp; HEALTH FIELD DIAGNOSIS</div>
    <h1>${esc(s.store.name)} 안전보건 현장진단 결과보고서</h1>
    <div class="meta">${esc(s.store.hq)} · ${esc(s.store.dept)} · ${esc(s.store.team)}　|　${esc(s.store.date)}　|　점검자 ${esc(s.store.inspector)}</div>
    <div class="route-cover-grid">
      <div>
        <div class="route-statement"><small>오늘 이 매장에서 먼저 손볼 흐름</small><div>${coverSummaryText(s,st)}</div></div>
        <div class="route-journey"><h2>매장 하루 동선 요약</h2><div class="route-strip">
          ${works.map(function(w,i){const ws=workDisplayState(w);return `<div class="route-stop ${ws[1]}"><span>${String(i+1).padStart(2,"0")}</span><b>${esc(w.name)}</b></div>`;}).join("")}
        </div></div>
      </div>
      <aside class="route-side">
        <div class="route-panel"><h3>상태 판정</h3>${statusRows.map(function(r){return `<div class="route-rank"><b>${r[0]}</b><span>${esc(r[1])}</span>${routeBadge(r[2][0],r[2][1]==="danger"?"risk":r[2][1]==="warn"?"watch":r[2][1])}</div>`;}).join("")}</div>
        <div class="route-panel"><h3>이번 점검 핵심 신호</h3><p>미흡사항 <b>${(s.findings||[]).length}건</b> · 미조치 과거사고 <b>${(s.accidents||[]).filter(a=>a.status==="미조치").length}건</b></p><p class="meta">먼저 작업 동선을 보고, 이어 사고·시설·근로자 의견과 상세 증빙을 확인합니다.</p></div>
      </aside>
    </div>
    <div class="footer-note">※ 위험신호가 있는 동선을 먼저 펼쳐 보여주는 구조</div>
    ${pageNo(n)}
  </section>`;
}

/* ============ 2페이지: 작업유형별 분석 ============ */
/* 작업유형 11개가 16:9 한 페이지에 모두 들어가야 하므로 '주요 내용'은 반드시 한 줄로 끝나야 한다.
   미흡사항이 여러 건이면 전부 나열하지 않고 "첫 항목 외 N건"으로 줄인다.
   (전체 내용은 뒤쪽 '현장 개선사항' 페이지에 사진과 함께 빠짐없이 나온다) */
function workNoteText(s,w,map){
  const list=map[w.name]||[];
  if(!list.length)return w.status==="na" ? "해당없음" : "특이사항 없음";
  if(list.length===1)return list[0];
  return list[0]+" 외 "+(list.length-1)+"건";
}
function workRows(s){
  const map=workSummaryMap(s);
  return (s.work||[]).map(w=>{
    const level = w.status==="na" ? ["해당없음","info"] : (w.risk>0 ? ["관리필요","warn"] : ["양호","good"]);
    const txt = workNoteText(s,w,map);
    return `<div class="work-row">
      <div class="work-cell"><b>${esc(w.name)}</b></div>
      <div class="work-cell">${tag(level[0],level[1])}</div>
      <div class="work-cell work-cell-note" title="${esc((map[w.name]||[]).join(" / "))}">${esc(txt)}</div>
    </div>`;
  }).join("");
}
function makeWorkPage(s,n){
  const works=(s.work||[]).slice(0,11);
  const fmap=workFindingMap(s);
  const actionWorks=works.filter(w=>+w.risk>0 || (fmap[w.name]||[]).length).slice(0,4);
  return `<section class="page">
    <div class="kicker">WORKDAY ROUTE</div>
    <div class="section-head"><div><h2>작업점검은 하루 동선으로 읽습니다</h2><p class="meta">전체 흐름을 보이고, 이상 있는 지점만 조치 카드로 펼칩니다.</p></div></div>
    <div class="route-layout">
      <div class="route-rail">${works.map(function(w,i){const ws=workDisplayState(w);return `<div class="route-rail-row ${ws[1]}"><span>${String(i+1).padStart(2,"0")}</span><b>${esc(w.name)}</b>${routeBadge(ws[0],ws[1])}</div>`;}).join("")}</div>
      <div class="route-actions">${actionWorks.length?actionWorks.map(function(w){const fs=fmap[w.name]||[];const f=fs[0]||{};return `<article class="route-action"><div>${routeBadge(+w.risk>0?"우선조치":"관리필요",+w.risk>0?"risk":"watch")}<span class="route-code">${String(works.indexOf(w)+1).padStart(2,"0")}</span></div><h3>${esc(f.title||w.name+" 위험신호")}</h3><p>${esc(f.question||f.note||"현장 확인 결과 관리가 필요한 작업입니다.")}</p><div class="hazards">${hazardPills(f.hazards||[])}</div></article>`;}).join(""):'<div class="route-empty"><h3>펼쳐 볼 위험신호가 없습니다</h3><p>현재 작업방법과 관리상태를 유지해 주세요.</p></div>'}</div>
    </div>
    <div class="footer-note">※ 이상 없는 지점은 접고, 상세 사진은 현장 개선사항 페이지에서 전체 표시</div>
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
        <div class="photo-cell">${photoBox(acc?(acc.afterPhotos&&acc.afterPhotos.length?acc.afterPhotos:acc.beforePhotos):[], acc&&acc.afterPhotos&&acc.afterPhotos.length?"사고조사 조치 후 사진":"사고조사 현재 상태 사진","tall")}</div>
        <div class="body">
          <div>${tag("사고 재발방지","info")} ${acc?tag(st.accident[0],st.accident[1]):tag("해당없음","info")}</div>
          <h3>${acc?esc(acc.type)+" 사고":"사고이력 없음"}</h3>
          <p>${acc?esc(acc.content):"과거 사고 이력이 없습니다."}</p>
          <div class="label">유해위험요인 / 현 상태</div>
          <p class="meta">${acc?esc(acc.hazardText)+" / "+esc(acc.status||"확인 전")+(acc.actionText?" / "+esc(acc.actionText):""):"특이사항 없음"}</p>
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
              <div class="photo-cell">${photoBox(t.beforePhotos, "조치 전 사진","small")}</div>
              <div class="photo-cell">${photoBox(t.afterPhotos, "조치 후 사진","small")}</div>
            </div>
            <p class="meta" style="margin:8px 0 0">현재 상태: ${esc(t.currentState||"-")}<br>조치내용: ${esc(t.actionText||"-")}</p>
          </div>
        `).join("") || "<p class='meta'>지난 지적사항 없음</p>"}
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

/* 사고조사·이전 지적사항의 조치 전/후 사진은 입력 화면에서 접어 보여도 보고서에는 전부 싣는다. */
function makeEvidencePages(s,startNo){
  const photos=[];
  (s.accidents||[]).forEach(function(a,ai){
    (a.beforePhotos||[]).forEach(function(p,i){photos.push({p,label:"사고조사 · 조치 전 "+(i+1)+"/"+a.beforePhotos.length,title:(a.date||"")+" "+(a.type||"사고")})});
    (a.afterPhotos||[]).forEach(function(p,i){photos.push({p,label:"사고조사 · 조치 후 "+(i+1)+"/"+a.afterPhotos.length,title:(a.date||"")+" "+(a.type||"사고")})});
  });
  (s.tasks||[]).forEach(function(t){
    (t.beforePhotos||[]).forEach(function(p,i){photos.push({p,label:"이전 지적사항 · 조치 전 "+(i+1)+"/"+t.beforePhotos.length,title:t.title||"조치확인"})});
    (t.afterPhotos||[]).forEach(function(p,i){photos.push({p,label:"이전 지적사항 · 조치 후 "+(i+1)+"/"+t.afterPhotos.length,title:t.title||"조치확인"})});
  });
  if(!photos.length)return {html:"",count:0};
  const per=4,pages=[];
  for(let i=0;i<photos.length;i+=per){
    const chunk=photos.slice(i,i+per),n=startNo+pages.length;
    pages.push(`<section class="page"><div class="kicker">BEFORE · AFTER EVIDENCE</div><div class="section-head"><div><h2>조치 전·후 사진 증빙</h2></div><div class="meta">${i+1}–${Math.min(i+per,photos.length)} / ${photos.length}</div></div><div class="evidence-report-grid">${chunk.map(function(x){return `<figure class="evidence-report-item"><div>${x.p&&x.p.dataUrl?`<img src="${x.p.dataUrl}" alt="${esc(x.label)}">`:"사진 없음"}</div><figcaption><b>${esc(x.label)}</b><span>${esc(x.title)}</span></figcaption></figure>`}).join("")}</div>${pageNo(n)}</section>`);
  }
  return {html:pages.join(""),count:pages.length};
}

/* ============ 페이지 HTML 생성 (app.js의 PDF 캡처에서도 재사용) ============ */
function buildReportPages(s){
  if(!s || !s.store) return "";
  var n=1, html="";
  html += makeCover(s,n++);
  html += makeWorkPage(s,n++);
  html += makeAreaPage(s,n++);
  html += makeOpinionPage(s,n++);
  var evidence=makeEvidencePages(s,n);html+=evidence.html;n+=evidence.count;
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
