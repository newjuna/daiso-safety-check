/* ============================================================
   안전보건 현장진단 결과보고서 (sr- 레이아웃 · 실제 데이터 연결 최종본)

   ── 이 파일이 쓰이는 곳 (두 군데에서 같은 HTML을 만든다)
     1) report.html — 점검자가 화면으로 보는 결과보고서
     2) app.js      — 최종 제출 시 같은 화면을 캡처해 PDF로 만들어 드라이브에 저장
     그래서 페이지 생성 함수를 window.buildReportPages()로 노출한다.
     화면과 PDF가 100% 같은 모양이 되는 이유가 이것이다.

   ── 데이터
     1순위: 부모창(앱 화면)의 getLandscapeReportSnapshot() 직접 호출 — 사진 실데이터까지 온다.
     2순위: localStorage 캐시 — 팝업 차단·새로고침 대비. 단 사진(dataUrl)은 저장되지 않는다.

   ── 반드시 지키는 규칙
     · 점수·등급 숫자(84, B 등)를 화면에 절대 노출하지 않는다.
       내부 점수는 양호/관리필요/위험 판정과 정성 문장 생성에만 쓴다.
     · 사고·미흡사항·근로자 의견은 개수 제한 없이 전부 싣는다. 분량이 늘면 페이지가 자동 증가한다.
     · 사진이 없는 항목은 점선 안내 박스로 자리를 유지한다.
     · 클래스명은 sr- 접두어만 쓴다(앱 style.css와 충돌 방지).
   ============================================================ */
(function(){

/* ============ 실제 점검 데이터 로드 ============ */
function loadSnapshot(){
  var d=null;
  try{ d=window.opener&&window.opener.getLandscapeReportSnapshot&&window.opener.getLandscapeReportSnapshot(); }catch(e){}
  if(!d){ try{ d=window.__LANDSCAPE_REPORT__||null; }catch(e){} }
  if(!d){ try{ d=JSON.parse(localStorage.getItem('daiso_landscape_report_v1')); }catch(e){} }
  return d;
}

/* ============ 공통 유틸 ============ */
function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(s){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[s]}); }
function pad2(n){ return String(n).padStart(2,"0"); }
function dot(level){ return '<span class="sr-dot '+(level||"")+'"></span>'; }
function hazPills(arr){
  if(!arr||!arr.length)return "";
  return '<div class="sr-hazards">'+arr.map(function(h){return '<span class="sr-haz">'+esc(h)+'</span>'}).join("")+'</div>';
}
function dateDot(v){ return String(v||"").replace(/-/g,"."); }
function inboundFacts(s){
  var x=s.inbound||{},parts=[];
  if(x.delivery)parts.push("입고시간 "+x.delivery);
  if(x.boxes)parts.push("입고 "+x.boxes+"박스");
  var t=s.transport||{};
  if(t.floors)parts.push("작업공간 "+t.floors+"층");
  if(t.floors)parts.push("계단 "+(t.stairs||"무")+" · E/V "+(t.elevator||"무")+" · E/S "+(t.escalator||"무"));
  if(x.start||x.end)parts.push((x.start||"-")+"~"+(x.end||"-"));
  if(x.staff||x.helpers)parts.push("임직원 "+(+x.staff||0)+"명 · 도우미 "+(+x.helpers||0)+"명");
  if(x.helperOutAt)parts.push("도우미 "+x.helperOutAt+" 퇴근");
  return parts.join(" · ");
}
function activeTbmTime(s){
  var x=s.inbound||{},t=s.tbmTimes||{};
  return x.delivery==="오후(야간)"?(t.pm||""):(t.am||t.pm||"");
}

/* 사다리 고위험 유형. data.js의 D.ladderHighRiskTypes와 같은 값이다.
   report.html은 data.js를 불러오지 않으므로 여기에 따로 둔다. */
var LADDER_HIGH_RISK=["구형 사다리(검정)","A형"];
var LADDER_ORDER=["구형 사다리(빨강)","구형 사다리(검정)","신형 사다리","A형","기타"];

/* ============ 상태 판정 ============ */
/* 내부 점수를 표시용 상태로만 바꾼다. 숫자는 절대 내보내지 않는다. */
function scoreState(v){
  if(v==null)return ["확인필요","warn"];
  if(v>=90)return ["우수","good"];
  if(v>=75)return ["양호","good"];
  if(v>=60)return ["관리필요","warn"];
  return ["위험","risk"];
}
function categoryStates(s){
  var parts=s.scoreParts||{};
  var st={
    work:scoreState(parts.work),
    ladder:scoreState(parts.ladder),
    common:scoreState(parts.common),
    fire:scoreState(parts.fire),
    tbm:scoreState(parts.tbm),
    accident:(s.accidents||[]).length?scoreState(parts.accident):null
  };
  /* 점수만으로는 드러나지 않는 신호를 상태에 반영한다(판정 근거는 화면에 문장으로 함께 표시). */
  if(s.tbmStretchGap&&s.tbmStretchGap.level==="severe")st.tbm=["위험","risk"];
  else if(s.tbmStretchGap&&s.tbmStretchGap.level==="minor"&&st.tbm[1]==="good")st.tbm=["관리필요","warn"];
  if((s.tbmCrossCheckFlags||[]).length)st.tbm=["위험","risk"];
  if(st.accident&&(s.accidents||[]).some(function(a){return a.status==="미조치"||a.riskLevel==="상"}))st.accident=["위험","risk"];
  /* 미흡이 실제로 있는 분야는 최소 '관리필요'로 내린다(건수는 적어도 현장에서 조치가 필요하므로). */
  if(countFindings(s,"사다리")&&st.ladder[1]==="good")st.ladder=["관리필요","warn"];
  if(countFindings(s,"공통·시설")&&st.common[1]==="good")st.common=["관리필요","warn"];
  if(countFindings(s,"소방")&&st.fire[1]==="good")st.fire=["관리필요","warn"];
  if((s.work||[]).some(function(w){return +w.risk>0})&&st.work[1]==="good")st.work=["관리필요","warn"];
  if(s.inboundLabor&&s.inboundLabor.level==="severe")st.work=["위험","risk"];
  return st;
}
function countFindings(s,category){
  return (s.findings||[]).filter(function(f){return f.category===category}).length;
}
function findingsOf(s,category){
  return (s.findings||[]).filter(function(f){return f.category===category});
}

/* 근로자가 과거 사고사례를 안내받지 못했다고 답한 건 */
function unsharedAccidentVoices(s){
  return (s.workerOpinions||[]).filter(function(o){
    return /사고사례/.test(o.question||"")&&/안내받지 못함/.test(o.answer||"");
  });
}

/* ============ 개선방향 문구 (카테고리·키워드 기반 자동 생성) ============ */
function improvementText(f){
  var t=f.title||"";
  if(f.category==="사다리")return "이상 사다리 사용 여부를 확인하고, 사용 전 발판·체결상태 점검 후 필요한 조치를 실시합니다.";
  if(f.category==="소방")return "소화기 등 소방설비 상태를 재확인하고 정기점검 및 유지관리 기준에 따라 조치합니다.";
  if(f.category==="TBM")return "작업 전 최근 사고사례와 예방수칙이 실제 근로자에게 공유되도록 TBM 운영을 보완합니다.";
  if(t.indexOf("안전모")>=0)return "해당 작업 시 필요한 보호구 착용기준이 현장에서 준수되도록 안내·확인합니다.";
  if(t.indexOf("하차")>=0)return "수작업 부담을 줄일 수 있도록 작업방법과 투입인원을 검토하고, 끼임 위험이 없도록 작업동선을 관리합니다.";
  if(t.indexOf("칼")>=0||t.indexOf("개봉")>=0)return "노출형 칼날 사용을 중지하고 자동복귀형 안전칼 사용으로 전환합니다.";
  if(t.indexOf("발판")>=0||t.indexOf("사다리")>=0)return "규격 발판·사다리만 사용하도록 하고 임시 발판은 현장에서 제거합니다.";
  if(t.indexOf("전선")>=0||t.indexOf("콘센트")>=0||t.indexOf("멀티탭")>=0)return "전선을 고정·정리해 통행로를 확보하고 과부하 여부를 함께 확인합니다.";
  if(t.indexOf("적재")>=0||t.indexOf("통로")>=0)return "통로 적재물을 제거하고 지정 적치구역을 운영해 통행 동선을 확보합니다.";
  if(f.category==="공통·시설")return "시설물의 이상상태를 확인하고 사용 전 안전상태가 유지되도록 보수·정리합니다.";
  if(f.category==="기타사항")return "확인된 특이사항의 위험 노출을 줄이도록 현장 조치 후 재확인합니다.";
  return "해당 위험요인을 제거하거나 노출을 줄일 수 있도록 현장 조치 후 재확인합니다.";
}

/* ============ 우선 조치사항 산출 ============
   입력 순서가 아니라 아래 기준으로 정렬한다.
     10 미조치·위험등급 상 과거사고     (즉시조치)
     20 스트레칭 없이 입고작업 선행      (즉시/개선)
     30 입고 인력부담                    (즉시/개선)
     40 사고사례·위험요인 공유 미인지    (확인필요)
     50 사다리(고위험 유형 보유 시 가중) (개선필요)
     60 그 밖의 현장 미흡사항            (개선필요)
   ============================================================ */
function buildPriorities(s){
  var out=[];

  (s.accidents||[]).forEach(function(a){
    if(a.status==="미조치"||a.riskLevel==="상"){
      out.push({
        w:10,key:"사고 재발방지",
        title:esc(a.type||"사고")+" 사고 재발방지 조치 ("+esc(a.status||"확인 전")+")",
        detail:dateDot(a.date)+" · 기인물 "+esc(a.source||"미등록")+" · 위험등급 "+esc(a.riskLevel||"-"),
        status:"즉시조치",cls:""
      });
    }
  });

  var gap=s.tbmStretchGap;
  if(gap&&gap.level!=="good"&&gap.gapMinutes>0){
    out.push({
      w:20,key:"TBM 운영",
      title:"입고작업 전 스트레칭(TBM) 실시순서 조정",
      detail:((s.inbound&&s.inbound.start)?"입고 "+s.inbound.start+" 시작":"입고작업")
        +(activeTbmTime(s)?" / TBM "+activeTbmTime(s):"")+" · "+gap.gapMinutes+"분 먼저 시작 · 스트레칭 없이 중량물 작업",
      status:gap.level==="severe"?"즉시조치":"개선필요",cls:gap.level==="severe"?"":"warn"
    });
  }

  var lb=s.inboundLabor;
  if(lb&&lb.level!=="good"){
    out.push({
      w:30,key:"입고 인력부담",
      title:"입고 인력부담 완화 (투입인원·작업방법 조정)",
      detail:(inboundFacts(s)?inboundFacts(s)+" · ":"")+"평균 투입인원 "+lb.avgPeople+"명 · 도우미 공백비율 "+lb.gapRatioPct+"%",
      status:lb.level==="severe"?"즉시조치":"개선필요",cls:lb.level==="severe"?"":"warn"
    });
  }

  var unshared=unsharedAccidentVoices(s);
  var crossFlags=(s.tbmCrossCheckFlags||[]);
  if(unshared.length||crossFlags.length){
    var reason=unshared.length
      ? "근로자가 과거 사고사례 "+unshared.length+"건을 \"안내받지 못함\"으로 응답"
      : "관리자 TBM 점검결과와 근로자 응답 불일치";
    out.push({
      w:40,key:"TBM 공유",
      title:"사고사례 중심 TBM 공유 강화",
      detail:reason+" · 확인방법: "+esc(s.tbmConfirmMethod||"-"),
      status:"확인필요",cls:"warn"
    });
  }

  var ladderF=findingsOf(s,"사다리");
  if(ladderF.length){
    var owned=highRiskOwned(s);
    out.push({
      w:50,key:"사다리 관리",
      title:"사다리 이상항목 조치 및 상부작업 관리 ("+ladderF.length+"건)",
      detail:ladderF.map(function(f){return esc(f.area)+" "+esc(f.title)}).join(" · ")
             +(owned.length?" · 고위험 유형 보유("+owned.join(", ")+")":""),
      status:"개선필요",cls:"warn"
    });
  }

  var etc=(s.findings||[]).filter(function(f){return f.category!=="사다리"});
  if(etc.length){
    var byCat={};
    etc.forEach(function(f){ byCat[f.category]=(byCat[f.category]||0)+1 });
    out.push({
      w:60,key:"현장 미흡사항",
      title:"그 밖의 현장 미흡사항 조치 ("+etc.length+"건)",
      detail:Object.keys(byCat).map(function(k){return k+" "+byCat[k]+"건"}).join(" · ")
             +" · "+etc.slice(0,2).map(function(f){return esc(f.title)}).join(", ")+(etc.length>2?" 등":""),
      status:"개선필요",cls:"warn"
    });
  }

  out.sort(function(a,b){return a.w-b.w});
  return out;
}
/* 보유한 사다리 중 고위험 유형 */
function highRiskOwned(s){
  var counts=(s.ladder&&s.ladder.counts)||{};
  return LADDER_HIGH_RISK.filter(function(t){return Number(counts[t]||0)>0});
}

/* ============ 종합 진단 문장 (점수 대신 정성 표현) ============ */
function diagnosisLabel(s,priorities){
  var hasNow=priorities.some(function(p){return p.status==="즉시조치"});
  var hasAny=priorities.length>0;
  if(hasNow)return{label:"우선관리<br>필요",sub:priorities.slice(0,2).map(function(p){return p.key}).join(" · ")};
  if(hasAny)return{label:"관리<br>필요",sub:priorities.slice(0,2).map(function(p){return p.key}).join(" · ")};
  return{label:"양호<br>유지",sub:"현재 관리상태 지속"};
}
function verdictHeadline(priorities){
  if(!priorities.length)return "전반적으로 관리되고 있어<br>현재 상태를 유지하면 됩니다.";
  var keys=[];
  priorities.forEach(function(p){ if(keys.indexOf(p.key)<0)keys.push(p.key) });
  if(keys.length===1)return esc(keys[0])+"을(를)<br><span class="+'"sr-hl"'+">우선 관리</span>해야 합니다.";
  return esc(keys[0])+"과 "+esc(keys[1])+"을<br><span class=\"sr-hl\">우선 관리</span>해야 합니다.";
}
/* 실제 측정값을 근거로 요약 문단을 만든다. 판정 근거가 문장으로 드러나야 한다는 요구사항 반영. */
function verdictBody(s){
  var out=[];
  var acc=s.accidents||[];
  var open=acc.filter(function(a){return a.status==="미조치"});
  if(acc.length){
    out.push("과거 사고 "+acc.length+"건 중 "+(open.length?open.length+"건이 미조치 상태":"전 건 조치완료")+"입니다.");
  }
  var unshared=unsharedAccidentVoices(s);
  if(unshared.length)out.push("근로자는 사고사례 "+unshared.length+"건을 안내받지 못했다고 응답했습니다.");
  var gap=s.tbmStretchGap;
  if(gap&&gap.gapMinutes>0)out.push("입고작업이 스트레칭(TBM)보다 "+gap.gapMinutes+"분 먼저 시작됩니다.");
  var lb=s.inboundLabor;
  if(lb&&lb.level!=="good")out.push("입고 평균 투입인원은 "+lb.avgPeople+"명(도우미 공백비율 "+lb.gapRatioPct+"%)으로 중량물 취급 부담이 큽니다.");
  var fc=(s.findings||[]).length;
  if(fc)out.push("이번 점검에서 확인된 미흡사항은 "+fc+"건입니다.");
  if(!out.length)out.push("확인된 미흡사항과 미조치 사고가 없어 현재 관리상태를 유지하면 됩니다.");
  return out.join(" ");
}

/* ============ 사진 ============ */
/* 실제 사진이 있으면 <img>, 없으면 점선 안내 박스로 자리를 유지한다. */
function photoBox(photos,label,caption){
  var list=(photos||[]).filter(function(p){return p&&p.dataUrl});
  if(!list.length){
    return '<div class="sr-photo empty" data-label="'+esc(label)+'">'+esc(caption||"첨부된 사진 없음")+'</div>';
  }
  var more=list.length>1?'<span class="sr-more">+'+(list.length-1)+'</span>':"";
  return '<div class="sr-photo" data-label="'+esc(label)+'"><img src="'+list[0].dataUrl+'" alt="'+esc(label)+'">'+more+'</div>';
}

/* ============ 페이지 조립 ============ */
function sheet(label,inner){ return {label:label,html:inner}; }
function head(kicker,title,noHolder){
  return '<header class="sr-page-head"><div><small>'+esc(kicker)+'</small><h2>'+title+'</h2></div>'
    +'<span class="sr-page-no">'+noHolder+'</span></header>';
}
function footer(left,noHolder){
  return '<footer class="sr-footer"><span>'+esc(left)+'</span><span>'+noHolder+'</span></footer>';
}
/* 페이지 번호는 전체 장수가 확정된 뒤 치환한다. */
var NO="__SR_PAGE_NO__";

/* ---------- 01 표지 ---------- */
function coverPriorityPhotos(s,p){
  var acc=s.accidents||[],findings=s.findings||[],list=[];
  if(p.w===10){
    acc.some(function(a){
      if(a.status==="미조치"||a.riskLevel==="상"){
        list=(a.beforePhotos||[]).concat(a.afterPhotos||[]); return list.length>0;
      }
      return false;
    });
  }else if(p.w===50){
    findings.some(function(f){if(f.category==="사다리"&&(f.photos||[]).length){list=f.photos;return true}return false});
  }else if(p.w===20||p.w===30){
    findings.some(function(f){if(f.category==="작업점검"&&/입고|하차/.test(f.area||"")&&(f.photos||[]).length){list=f.photos;return true}return false});
  }else if(p.w===40){
    findings.some(function(f){if(f.category==="TBM"&&(f.photos||[]).length){list=f.photos;return true}return false});
  }
  if(!list.length)findings.some(function(f){if((f.photos||[]).length){list=f.photos;return true}return false});
  return list;
}
function coverRouteStates(s){
  var st=categoryStates(s),acc=s.accidents||[],opinions=s.workerOpinions||[];
  function cls(x){return !x?"good":(x[1]==="risk"?"":(x[1]==="warn"?"watch":"good"))}
  return [
    ["사고",acc.length?(acc.some(function(a){return a.status==="미조치"})?"":"good"):"good",acc.length?acc.length+"건":"없음"],
    ["작업",cls(st.work),st.work[0]], ["사다리",cls(st.ladder),st.ladder[0]],
    ["시설",cls(st.common),st.common[0]], ["소방",cls(st.fire),st.fire[0]],
    ["TBM",cls(st.tbm),st.tbm[0]], ["의견",opinions.length?"":"good",opinions.length?opinions.length+"건":"양호"]
  ];
}
function coverFieldRows(s){
  var acc=s.accidents||[],open=acc.filter(function(a){return a.status==="미조치"}).length;
  function row(label,list,empty){
    var first=list[0],text=list.length?(list.length+"건 · "+(first.title||first.answer||"확인 필요")):(empty||"양호");
    return [label,text,list.length?"":"good"];
  }
  var rows=[];
  rows.push(["사고조사",acc.length?(acc.length+"건 중 "+(open?open+"건 미조치":"전 건 조치완료")):"사고이력 없음",open?"": "good"]);
  rows.push(row("작업점검",findingsOf(s,"작업점검"),"특이사항 없음"));
  rows.push(row("사다리",findingsOf(s,"사다리"),"이상항목 없음"));
  rows.push(row("공통·시설",findingsOf(s,"공통·시설"),"시설상태 양호"));
  rows.push(row("소방",findingsOf(s,"소방"),"소방상태 양호"));
  var tbm=findingsOf(s,"TBM"),cross=s.tbmCrossCheckFlags||[];
  rows.push(["TBM",tbm.length?tbm.length+"건 미흡":(cross.length?"응답 교차확인 필요":"운영상태 양호"),(tbm.length||cross.length)?"watch":"good"]);
  rows.push(row("근로자 의견",s.workerOpinions||[],"특이의견 없음"));
  return rows;
}
function sheetCover(s){
  var pr=buildPriorities(s);
  var dg=diagnosisLabel(s,pr);
  var acc=s.accidents||[];
  var open=acc.filter(function(a){return a.status==="미조치"}).length;
  var shown=pr.slice(0,3),route=coverRouteStates(s),fields=coverFieldRows(s);

  var h='<header class="sr-cover-head">'
    +'<div class="sr-kicker">ASUNG DAISO · SAFETY &amp; HEALTH</div>'
    +'<h1>안전보건 현장진단<br>결과보고서</h1>'
    +'<div class="sr-subtitle">위험을 발견하고, 조치로 연결합니다.</div>'
    +'<div class="sr-meta"><span>'+esc(s.store.name)+'</span><span>'+dateDot(s.store.date)+'</span>'
    +'<span>점검자 '+esc(s.store.inspector)+'</span>'
    +'<span>'+[s.store.hq,s.store.dept,s.store.team].filter(Boolean).map(esc).join(" · ")+'</span></div>'
    +'</header>';

  h+='<div class="sr-body"><div class="sr-dash-summary">'
    +'<div class="sr-dash-score"><small>종합 진단결과</small><b>'+dg.label+'</b><span>'+esc(dg.sub)+'</span></div>'
    +'<div class="sr-dash-verdict"><small>EXECUTIVE SUMMARY</small><b>'+verdictHeadline(pr)+'</b><p>'+esc(verdictBody(s))+'</p></div>'
    +'<div class="sr-dash-metric'+((s.findings||[]).length?' bad':'')+'"><small>점검 미흡</small><b>'+(s.findings||[]).length+'</b><span>건</span></div>'
    +'<div class="sr-dash-metric"><small>사고이력</small><b>'+acc.length+'</b><span>건</span></div>'
    +'<div class="sr-dash-metric'+(open?' bad':'')+'"><small>미조치 사고</small><b>'+open+'</b><span>건</span></div>'
    +'<div class="sr-dash-metric"><small>근로자 의견</small><b>'+(s.workerOpinions||[]).length+'</b><span>건</span></div></div>';

  h+='<div class="sr-dashboard-grid"><div class="sr-dashboard-panel">'
    +'<div class="sr-dashboard-title"><div><small>INSPECTION JOURNEY</small><b>점검동선</b></div><span>분야별 핵심상태</span></div><div class="sr-mini-route">';
  route.forEach(function(r){h+='<div class="sr-mini-step '+r[1]+'"><b>'+esc(r[0])+'</b><small>'+esc(r[2])+'</small></div>'});
  h+='</div><div class="sr-dashboard-title"><div><small>WORK TYPE STATUS</small><b>작업유형</b></div><span>'+((s.work||[]).length)+'개 유형</span></div><div class="sr-work-grid">';
  (s.work||[]).forEach(function(w,i){
    var c=w.status==="na"?"na":(+w.risk>0?"bad":""),state=w.status==="na"?"해당없음":(+w.risk>0?"관리필요":"양호");
    h+='<div class="sr-work-row '+c+'"><i>'+pad2(i+1)+'</i><b>'+esc(w.name)+'</b><span>'+state+'</span></div>';
  });
  h+='</div><div class="sr-dashboard-title sr-priority-title"><div><small>TOP PRIORITIES</small><b>우선 조치사항 · 미흡사진</b></div><span>상세사진은 뒤 페이지 참조</span></div><div class="sr-priority-photo-list">';
  if(!shown.length)h+='<div class="sr-note info">우선 조치가 필요한 항목이 없습니다.</div>';
  shown.forEach(function(p,i){
    h+='<div class="sr-priority-photo">'+photoBox(coverPriorityPhotos(s,p),pad2(i+1)+" · 미흡사진","첨부된 미흡사진 없음")
      +'<div><b>'+p.title+'</b><small>'+p.detail+'</small></div><span class="sr-status '+p.cls+'">'+esc(p.status)+'</span></div>';
  });
  h+='</div></div><div class="sr-dashboard-panel"><div class="sr-dashboard-title"><div><small>RISK &amp; FIELD SUMMARY</small><b>위험분석 · 분야별 상세결과</b></div><span>핵심 미흡사항 요약</span></div>'
    +'<div class="sr-field-summary">';
  fields.forEach(function(r){h+='<div class="sr-field-row '+r[2]+'"><b>'+esc(r[0])+'</b><span>'+esc(r[1])+'</span></div>'});
  h+='</div><div class="sr-cover-risk-note"><small>위험관리 방향</small><b>'+verdictHeadline(pr)+'</b><p>'+esc(verdictBody(s))+'</p></div>'
    +'<div class="sr-cover-facts"><b>현장 확인정보</b><span>'+esc(inboundFacts(s)||"작업시간 입력 없음")+'</span><span>TBM '+esc(activeTbmTime(s)||"시간 미입력")+' · '+esc(s.tbmConfirmMethod||"확인방법 미입력")+'</span></div>'
    +'</div></div>'+footer("CONFIDENTIAL · INTERNAL USE ONLY",NO)+'</div>';
  return sheet("표지",h);
}

/* ---------- 02 점검동선 ---------- */
function sheetRoute(s){
  var st=categoryStates(s);
  var acc=s.accidents||[];
  var open=acc.filter(function(a){return a.status==="미조치"}).length;
  var riskWorks=(s.work||[]).filter(function(w){return +w.risk>0});
  var sec=s.sections||{};
  var gap=s.tbmStretchGap,lb=s.inboundLabor;
  var unshared=unsharedAccidentVoices(s);

  var rows=[];
  if(acc.length){
    rows.push({cls:open?"risk":"good",mark:"사고",
      title:"사고이력 및 재발방지 확인",
      desc:acc.map(function(a){return esc(a.type||"사고")+" 1건("+esc(a.status||"확인 전")+")"}).join(" · ")+" / 출퇴근 재해 제외",
      big:acc.length+"건",sub:open?open+"건 미조치":"전 건 조치완료"});
  }
  rows.push({cls:riskWorks.length?"risk":"good",mark:"작업",
    title:"작업유형 "+(s.work||[]).length+"개 점검",
    desc:(riskWorks.length?riskWorks.map(function(w){return esc(w.name)}).join(", ")+"에서 위험신호 확인":"전 작업유형 특이사항 없음")
         +(inboundFacts(s)?" · "+esc(inboundFacts(s)):"")
         +(lb&&lb.level!=="good"?" · 입고 인력부담 "+(lb.level==="severe"?"위험(심각)":"위험(경미)"):""),
    big:findingsOf(s,"작업점검").length+"건",sub:riskWorks.length?"위험발견":"양호"});
  rows.push({cls:sec.ladder?"risk":"good",mark:"사다리",
    title:"사다리 보유·상태",
    desc:findingsOf(s,"사다리").length?findingsOf(s,"사다리").map(function(f){return esc(f.area)+" "+esc(f.title)+" 미흡"}).join(" · "):"이상항목 없음",
    big:(sec.ladder||0)+"건",sub:sec.ladder?"개선필요":"양호"});
  rows.push({cls:sec.common?"risk":"good",mark:"시설",
    title:"공통·시설 점검",
    desc:findingsOf(s,"공통·시설").length?findingsOf(s,"공통·시설").map(function(f){return esc(f.title)}).join(" · "):"주요 시설 상태 양호",
    big:(sec.common||0)+"건",sub:sec.common?"개선필요":"양호"});
  rows.push({cls:sec.fire?"risk":"good",mark:"소방",
    title:"소방 점검",
    desc:findingsOf(s,"소방").length?findingsOf(s,"소방").map(function(f){return esc(f.title)}).join(" · "):"피난·소화설비 상태 양호",
    big:(sec.fire||0)+"건",sub:sec.fire?"개선필요":"양호"});
  rows.push({cls:st.tbm[1]==="risk"?"risk":(st.tbm[1]==="warn"?"watch":"good"),mark:"TBM",
    title:"TBM 운영",
    desc:((sec.tbm||0)?"미흡 "+sec.tbm+"건":"전 항목 양호 체크")
         +" · 확인방법 \""+esc(s.tbmConfirmMethod||"-")+"\""
         +(activeTbmTime(s)?" · 실시 "+esc(activeTbmTime(s)):"")
         +(gap&&gap.gapMinutes>0?" · 입고작업이 "+gap.gapMinutes+"분 먼저 시작":""),
    big:st.tbm[0],sub:st.tbm[1]==="good"?"점검완료":"실효성 확인"});
  rows.push({cls:(s.workerOpinions||[]).length?"risk":"good",mark:"의견",
    title:"근로자 의견청취",
    desc:(s.workerOpinions||[]).length?"양호하지 않은 응답 "+(s.workerOpinions||[]).length+"건"+(unshared.length?" · 사고사례 "+unshared.length+"건 안내 미인지":""):"특이의견 없음",
    big:(s.workerOpinions||[]).length+"건",sub:(s.workerOpinions||[]).length?"교차확인":"양호"});
  if((s.tasks||[]).length){
    var doneT=(s.tasks||[]).filter(function(t){return t.status==="조치완료"}).length;
    rows.push({cls:doneT===(s.tasks||[]).length?"good":"risk",mark:"조치",
      title:"지난 지적사항 조치확인",
      desc:(s.tasks||[]).map(function(t){return esc(t.title)+"("+esc(t.status||"-")+")"}).join(" · "),
      big:doneT+"/"+(s.tasks||[]).length,sub:"조치완료"});
  }

  var h=head("INSPECTION JOURNEY","현장점검 동선",NO)+'<div class="sr-body"><div class="sr-route">';
  rows.forEach(function(r){
    h+='<div class="sr-route-item '+r.cls+'"><div class="sr-route-mark">'+esc(r.mark)+'</div>'
      +'<div class="sr-route-copy"><b>'+esc(r.title)+'</b><p>'+r.desc+'</p></div>'
      +'<div class="sr-route-state"><strong>'+esc(r.big)+'</strong>'+esc(r.sub)+'</div></div>';
  });
  h+='</div>'+footer(esc(s.store.name)+" · 현장점검 동선",NO)+'</div>';
  return sheet("점검동선",h);
}

/* ---------- 03 작업유형별 상태 ---------- */
function sheetWorkTypes(s){
  var works=s.work||[];
  var map={};
  (s.findings||[]).forEach(function(f){
    if(f.category!=="작업점검")return;
    if(!map[f.area])map[f.area]=[];
    map[f.area].push(f);
  });
  var riskN=works.filter(function(w){return +w.risk>0}).length;
  var naN=works.filter(function(w){return w.status==="na"}).length;
  var lb=s.inboundLabor,gap=s.tbmStretchGap;

  var h=head("WORK TYPE STATUS","작업유형별 상태",NO)+'<div class="sr-body">'
    +'<div class="sr-section-title"><div><small>SUMMARY</small><h2>'+works.length+'개 작업유형 점검결과</h2></div>'
    +'<span>관리필요 '+riskN+' · 해당없음 '+naN+' · 양호 '+(works.length-riskN-naN)+'</span></div>'
    +'<table class="sr-findings"><thead><tr><th style="width:180px">작업유형</th><th>확인 결과</th><th style="width:120px">상태</th></tr></thead><tbody>';

  works.forEach(function(w,i){
    var list=map[w.name]||[];
    var state=w.status==="na"?["해당없음","none"]:(+w.risk>0?["관리필요","warn"]:["양호","good"]);
    var note;
    if(w.status==="na")note="해당 작업 없음";
    else if(!list.length)note="특이사항 없음";
    else note=list.map(function(f){return esc(f.title)}).join(" · ");
    /* 입고·하차는 인력부담·TBM 선행 측정 결과를 같은 줄에 함께 보여준다(판정 근거 노출). */
    if(w.name==="입고·하차"){
      var extra=[];
      if(inboundFacts(s))extra.push(inboundFacts(s));
      if(lb)extra.push("입고 인력부담 "+(lb.level==="good"?"양호":(lb.level==="severe"?"위험(심각)":"위험(경미)"))
        +"(평균 "+lb.avgPeople+"명 · 공백 "+lb.gapRatioPct+"%)");
      if(gap&&gap.gapMinutes>0)extra.push("TBM보다 "+gap.gapMinutes+"분 먼저 시작");
      if(extra.length)note+='<div class="sr-sub">'+esc(extra.join(" · "))+'</div>';
      if(lb&&lb.level==="severe")state=["위험","risk"];
    }
    h+='<tr><td>'+pad2(i+1)+' '+esc(w.name)+'</td><td>'+note
      +hazPills(w.hazards||[])+'</td><td>'+dot(state[1]==="none"?"":state[1])+esc(state[0])+'</td></tr>';
  });

  h+='</tbody></table>';
  if(lb){
    h+='<div class="sr-note'+(lb.level==="good"?" info":"")+'"><b>입고 인력부담 측정</b> — '
      +(inboundFacts(s)?esc(inboundFacts(s))+' · ':'')+'평균 투입인원 '+lb.avgPeople+'명, 도우미 공백비율 '+lb.gapRatioPct+'% → '
      +(lb.level==="good"?"양호":(lb.level==="severe"?"위험(심각)":"위험(경미)"))
      +'. 인시(person-minutes) 기준으로 자동 산출되며 근골격계 위험신호에 반영됩니다.</div>';
  }
  h+=footer("양호 항목은 요약하고 위험·미흡 항목을 중심으로 기재",NO)+'</div>';
  return sheet("작업유형",h);
}

/* ---------- 04 위험분석 ---------- */
function sheetRiskAnalysis(s){
  var pr=buildPriorities(s);
  var cards=pr.slice(0,3);
  var h=head("RISK ANALYSIS","핵심 위험요인 분석",NO)+'<div class="sr-body">';

  if(!cards.length){
    h+='<div class="sr-note info">우선 관리가 필요한 위험요인이 확인되지 않았습니다.</div>';
  }else{
    h+='<div class="sr-risk-grid">';
    cards.forEach(function(p,i){
      var tone=p.status==="즉시조치"?"":(p.status==="확인필요"?"green":"orange");
      var grade=p.status==="즉시조치"?"HIGH":(p.status==="확인필요"?"CHECK":"MEDIUM");
      h+='<article class="sr-risk-card '+tone+'"><small>PRIORITY '+pad2(i+1)+' · '+grade+'</small>'
        +'<h3>'+p.title+'</h3><dl>'
        +'<dt>판정 근거</dt><dd>'+p.detail+'</dd>'
        +'<dt>구분</dt><dd>'+esc(p.key)+'</dd>'
        +'<dt>권고</dt><dd>'+esc(p.status)+'</dd>'
        +'</dl></article>';
    });
    h+='</div>';
  }

  /* TBM 실효성 교차확인 */
  var unshared=unsharedAccidentVoices(s);
  var flags=(s.tbmCrossCheckFlags||[]);
  if(unshared.length||flags.length){
    h+='<div class="sr-section-title"><div><small>CROSS CHECK</small><h2>TBM 실효성 교차확인</h2></div>'
      +'<span>관리자 점검결과 vs 근로자 응답</span></div>';
    if(flags.length){
      flags.forEach(function(f){ h+='<div class="sr-note">'+esc(f.message)+'</div>'; });
    }
    if(unshared.length){
      h+='<div class="sr-note"><b>TBM 점검은 '+((s.sections&&s.sections.tbm)?"미흡 "+s.sections.tbm+"건으로":"전 항목 \u0027양호\u0027로")+' 기록됐지만</b>, '
        +'확인방법이 "'+esc(s.tbmConfirmMethod||"-")+'"이고 근로자는 과거 사고 '+unshared.length+'건에 대해 모두 "안내받지 못함"으로 응답했습니다. '
        +'사고사례 공유가 실제로 이루어지는지 다음 방문 시 직접참관으로 확인이 필요합니다.</div>';
    }
  }

  h+='<div class="sr-section-title"><div><small>MANAGEMENT NOTE</small><h2>점검자 종합의견</h2></div></div>'
    +'<div class="sr-verdict"><p>'+esc(managementNote(s))+'</p></div>';
  if(s.resultNote)h+='<div class="sr-note info"><b>점검자 메모</b> — '+esc(s.resultNote)+'</div>';
  h+=footer("위험도는 현장상태와 사고이력을 종합하여 산정",NO)+'</div>';
  return sheet("위험분석",h);
}
/* 근로자 의견과 현장 신호가 같은 방향인지 대조해 종합의견을 만든다. */
function managementNote(s){
  var out=[];
  var voiceDanger=(s.workerOpinions||[]).filter(function(o){return /위험하다고 느끼는/.test(o.question||"")});
  var ladderF=findingsOf(s,"사다리");
  if(voiceDanger.length&&ladderF.length&&voiceDanger.some(function(o){return /사다리|상부/.test(o.answer||"")})){
    out.push("근로자가 지적한 \""+voiceDanger[0].answer+"\" 위험은 이번 점검의 "+ladderF[0].area+" "+ladderF[0].title+" 미흡과 방향이 일치합니다.");
  }
  var open=(s.accidents||[]).filter(function(a){return a.status==="미조치"});
  var gap=s.tbmStretchGap,lb=s.inboundLabor;
  if(open.length&&(gap&&gap.gapMinutes>0||lb&&lb.level!=="good")){
    out.push("과거 "+open[0].type+" 사고가 미조치 상태인데 "
      +[(gap&&gap.gapMinutes>0)?"입고작업이 스트레칭보다 먼저 시작되고":"",(lb&&lb.level!=="good")?"평균 투입인원이 "+lb.avgPeople+"명에 그쳐":""].filter(Boolean).join(" ")
      +", 동일 유형 사고의 재발 가능성이 남아 있습니다.");
  }else if(open.length){
    out.push("과거 "+open[0].type+" 사고가 미조치 상태로 남아 있어 재발방지 조치를 우선 확인해야 합니다.");
  }
  if(unsharedAccidentVoices(s).length)out.push("사고사례 공유가 근로자에게 도달하지 않은 점도 함께 보완해야 합니다.");
  if(!out.length){
    var fc=(s.findings||[]).length;
    out.push(fc?"확인된 미흡사항 "+fc+"건은 현장에서 조치 가능한 수준으로, 조치 후 차기 점검에서 재확인합니다."
               :"현장 상태와 근로자 의견 모두 특이사항이 없어 현재 관리체계를 유지하면 됩니다.");
  }
  return out.join(" ");
}

/* ---------- 05 근로자 의견 (6건/장, 자동증가) ---------- */
function sheetsVoice(s){
  var list=s.workerOpinions||[];
  if(!list.length)return [];
  var per=6,out=[];
  for(var i=0;i<list.length;i+=per){
    var chunk=list.slice(i,i+per);
    var h=head("WORKER VOICE","근로자 의견청취",NO)+'<div class="sr-body">'
      +'<div class="sr-section-title"><div><small>ANONYMOUS</small><h2>양호하지 않은 응답</h2></div>'
      +'<span>'+(i+1)+'–'+Math.min(i+per,list.length)+' / '+list.length+'건 · 익명 응답</span></div>';
    chunk.forEach(function(o){
      h+='<div class="sr-voice"><small>근로자 '+esc(o.worker)+'</small>'
        +'<p>'+esc(o.question)+' → <strong>'+esc(o.answer)+'</strong></p></div>';
    });
    if(i+per>=list.length){
      var unshared=unsharedAccidentVoices(s);
      if(unshared.length){
        h+='<div class="sr-note"><b>사고사례 안내 미인지 '+unshared.length+'건</b> — 과거 사고가 있는 매장인데 근로자가 해당 사례를 안내받지 못했다고 답했습니다. TBM에서 사고사례를 실제로 공유하고 있는지 확인이 필요합니다.</div>';
      }
      (s.tbmCrossCheckFlags||[]).forEach(function(f){ h+='<div class="sr-note">'+esc(f.message)+'</div>'; });
    }
    h+=footer("근로자 의견은 이름·사번 없이 익명으로 수집",NO)+'</div>';
    out.push(sheet(out.length?"의견"+(out.length+1):"근로자 의견",h));
  }
  return out;
}

/* ---------- 06 사고조사 (1건/장, 자동증가) ---------- */
function sheetsAccident(s){
  var list=s.accidents||[];
  if(!list.length)return [];
  /* 미조치·위험등급 상을 앞으로 정렬한다. */
  var sorted=list.slice().sort(function(a,b){
    return rankAccident(b)-rankAccident(a);
  });
  return sorted.map(function(a,i){
    var doneCls=a.status==="조치완료"?"good":"";
    var h=head("ACCIDENT PREVENTION","사고 재발방지 조사",NO)+'<div class="sr-body">'
      +'<div class="sr-section-title"><div><small>CASE '+pad2(i+1)+' / '+pad2(sorted.length)+'</small>'
      +'<h2>'+esc(a.type||"사고")+' · '+esc(a.status||"확인 전")+'</h2></div>'
      +'<span class="sr-status '+doneCls+'">위험등급 '+esc(a.riskLevel||"-")+'</span></div>'
      +'<div class="sr-accident-summary">'
      +'<div><small>재해일자</small><b>'+dateDot(a.date)+'</b></div>'
      +'<div><small>재해유형</small><b>'+esc(a.type||"-")+(a.approved==="Y"?" (산재승인)":"")+'</b></div>'
      +'<div><small>기인물</small><b>'+esc(a.source||"미등록")+'</b></div>'
      +'<div><small>조치상태</small><b>'+esc(a.status||"확인 전")+'</b></div>'
      +'</div>'
      +'<div class="sr-accident-copy"><small>사고내용</small><p>'+esc(a.content||"등록된 사고내용이 없습니다.")+'</p></div>'
      +'<div class="sr-before-after">'
      +photoBox(a.beforePhotos,"조치 전","첨부된 조치 전 사진 없음")
      +'<div class="sr-arrow">→</div>'
      +photoBox(a.afterPhotos,"조치 후",a.status==="조치완료"?"첨부된 조치 후 사진 없음":"미조치 · 조치 후 사진 없음")
      +'</div>'
      +'<div class="sr-action-note">'
      +'<div><small>유해위험요인</small><b>'+esc(a.hazardText||"-")+'</b></div>'
      +'<div><small>'+(a.status==="조치완료"?"재발방지 조치":"조치계획")+'</small><b>'+esc(a.actionText||"-")+'</b></div>'
      +'</div>';
    /* 근골격계 사고는 이번 점검의 입고 인력부담 측정값과 직접 연결해 보여준다. */
    var lb=s.inboundLabor;
    if(lb&&lb.level!=="good"&&/근골격|무리한|중량/.test((a.type||"")+(a.content||"")+(a.hazardText||""))){
      h+='<div class="sr-note"><b>이번 점검의 입고 인력부담 측정값과 직접 연결됩니다.</b> '
        +'평균 투입인원 '+lb.avgPeople+'명, 도우미 공백비율 '+lb.gapRatioPct+'%로 '
        +(lb.level==="severe"?"위험(심각)":"위험(경미)")+' 판정되었습니다.</div>';
    }
    h+=footer("출퇴근 재해는 사고조사 대상에서 제외",NO)+'</div>';
    return sheet(sorted.length>1?"사고"+(i+1):"사고조사",h);
  });
}
function rankAccident(a){
  var r=0;
  if(a.status==="미조치")r+=10;
  if(a.riskLevel==="상")r+=5;
  if(a.status==="개선 진행 중")r+=3;
  if(a.approved==="Y")r+=1;
  return r;
}

/* ---------- 07 상세결과 (미흡사항 6건/장, 자동증가) ---------- */
function sheetsFindings(s){
  var fs=(s.findings||[]).slice().sort(function(a,b){ return rankFinding(b)-rankFinding(a) });
  var st=categoryStates(s);
  if(!fs.length){
    var h0=head("DETAILED FINDINGS","분야별 상세결과",NO)+'<div class="sr-body">'
      +'<div class="sr-note info">이번 점검에서 확인된 미흡사항이 없습니다. 전 분야 양호로 기록되었습니다.</div>'
      +sectionStateTable(s,st)
      +footer("양호 항목은 요약하고 위험·미흡 항목을 중심으로 기재",NO)+'</div>';
    return [sheet("상세결과",h0)];
  }
  var per=6,out=[];
  for(var i=0;i<fs.length;i+=per){
    var chunk=fs.slice(i,i+per);
    var h=head("DETAILED FINDINGS","분야별 상세결과",NO)+'<div class="sr-body">'
      +'<div class="sr-section-title"><div><small>FINDINGS</small><h2>이번 점검 미흡사항</h2></div>'
      +'<span>'+(i+1)+'–'+Math.min(i+per,fs.length)+' / '+fs.length+'건</span></div>'
      +'<table class="sr-findings"><thead><tr><th style="width:130px">점검분야</th><th style="width:270px">확인 결과</th><th>위험요인 및 개선방향</th><th style="width:96px">상태</th></tr></thead><tbody>';
    chunk.forEach(function(f){
      var sub=[];
      if(f.question)sub.push("문항: "+f.question);
      if(f.note)sub.push(f.note);
      h+='<tr><td>'+esc(f.category)+(f.area&&f.area!==f.category?'<div class="sr-sub">'+esc(f.area)+'</div>':"")+'</td>'
        +'<td>'+esc(f.title)+(sub.length?'<div class="sr-sub">'+esc(sub.join(" / "))+'</div>':"")+'</td>'
        +'<td>'+esc(improvementText(f))+hazPills(f.hazards||[])+'</td>'
        +'<td>'+dot("")+'미흡</td></tr>';
    });
    h+='</tbody></table>';
    /* 마지막 장에 분야별 상태 요약을 붙인다. */
    if(i+per>=fs.length)h+=sectionStateTable(s,st);
    h+=footer("양호 항목은 요약하고 위험·미흡 항목을 중심으로 기재",NO)+'</div>';
    out.push(sheet(out.length?"상세결과"+(out.length+1):"상세결과",h));
  }
  return out;
}
function rankFinding(f){
  var r=0,t=f.title||"";
  if(f.category==="소방")r+=5;
  if(f.category==="사다리")r+=4;
  if((f.hazards||[]).indexOf("떨어짐")>=0)r+=4;
  if((f.hazards||[]).indexOf("넘어짐")>=0)r+=3;
  if((f.hazards||[]).indexOf("근골격계")>=0)r+=3;
  if(t.indexOf("안전모")>=0)r+=2;
  if((f.photos||[]).length)r+=1;
  return r;
}
/* 분야별 상태 + 판정 근거 요약 표 */
function sectionStateTable(s,st){
  var sec=s.sections||{};
  var gap=s.tbmStretchGap;
  var acc=s.accidents||[];
  var open=acc.filter(function(a){return a.status==="미조치"}).length;
  var rows=[
    ["작업점검",findingsOf(s,"작업점검").length+"건 미흡",st.work],
    ["사다리",(sec.ladder||0)+"건 미흡"+(highRiskOwned(s).length?" · 고위험 유형 보유":""),st.ladder],
    ["공통·시설",(sec.common||0)+"건 미흡",st.common],
    ["소방",(sec.fire||0)+"건 미흡",st.fire],
    ["TBM",((sec.tbm||0)?sec.tbm+"건 미흡":"전 항목 양호")+" · "+(s.tbmConfirmMethod||"-")+(gap&&gap.gapMinutes>0?" · 입고 "+gap.gapMinutes+"분 선행":""),st.tbm]
  ];
  if(st.accident)rows.push(["사고 재발방지",acc.length+"건 중 "+open+"건 미조치",st.accident]);
  var h='<div class="sr-section-title"><div><small>SECTION STATUS</small><h2>분야별 상태 및 판정 근거</h2></div>'
    +'<span>점수 대신 상태 4단계(우수·양호·관리필요·위험)로 표기</span></div>'
    +'<table class="sr-findings"><thead><tr><th style="width:150px">분야</th><th>판정 근거</th><th style="width:110px">상태</th></tr></thead><tbody>';
  rows.forEach(function(r){
    h+='<tr><td>'+esc(r[0])+'</td><td>'+esc(r[1])+'</td><td>'+dot(r[2][1])+esc(r[2][0])+'</td></tr>';
  });
  return h+'</tbody></table>';
}

/* ---------- 08 개선조치 계획 (+ 사다리 보유현황 / 지난 지적사항) ---------- */
function sheetPlan(s){
  var pr=buildPriorities(s);
  var counts=(s.ladder&&s.ladder.counts)||{};
  var typeStatus=(s.ladder&&s.ladder.typeStatus)||{};
  var ladderF=findingsOf(s,"사다리");

  var h=head("ACTION PLAN","개선조치 계획",NO)+'<div class="sr-body">';

  h+='<div class="sr-section-title"><div><small>LADDER INVENTORY</small><h2>사다리 보유현황</h2></div>'
    +'<span>'+(highRiskOwned(s).length?"고위험 유형 보유 · 관리기준 강화 대상":"고위험 유형 미보유")+'</span></div>'
    +'<div class="sr-ladder">';
  LADDER_ORDER.forEach(function(t){
    var n=Number(counts[t]||0);
    var stt=typeStatus[t]||"";
    var mine=ladderF.filter(function(f){return f.area===t});
    var cls=n<=0?"off":(stt==="bad"?"bad":"");
    var note=n<=0?"대 · 미보유":(mine.length?"대 · "+mine.map(function(f){return esc(f.title)}).join(", ")+" 미흡":"대 · 양호");
    h+='<div class="'+cls+'"><small>'+esc(t)+(LADDER_HIGH_RISK.indexOf(t)>=0?" ⚠":"")+'</small><b>'+n+'</b> <i>'+note+'</i></div>';
  });
  h+='</div>';
  if(highRiskOwned(s).length){
    h+='<div class="sr-note"><b>고위험 유형 보유</b> — '+highRiskOwned(s).map(esc).join(", ")
      +'. 반복 파손이 확인된 유형이므로 사용 전 발판·체결상태 점검을 일상점검에 포함하고 교체계획을 함께 검토해 주세요.</div>';
  }

  h+='<div class="sr-section-title"><div><small>ACTION PLAN</small><h2>조치 계획</h2></div>'
    +'<span>담당·기한은 매장 협의 후 확정</span></div>';
  if(!pr.length){
    h+='<div class="sr-note info">별도 조치계획이 필요한 항목이 없습니다.</div>';
  }else{
    pr.forEach(function(p,i){
      var owner=p.status==="즉시조치"?"담당: 매장 자체조치 + 부서 협의 · 기한: 즉시"
              :(p.status==="확인필요"?"담당: 점검자 재확인 · 기한: 차기 방문":"담당: 매장 자체조치 · 기한: 7일 이내");
      h+='<div class="sr-priority"><i>'+pad2(i+1)+'</i><div><b>'+p.title+'</b><small>'+owner+'</small></div>'
        +'<span class="sr-status '+p.cls+'">'+esc(p.status)+'</span></div>';
    });
  }

  /* 지난 지적사항 조치확인 — 사진 데이터가 없는 구조이므로 장부형 목록으로 표시한다. */
  if((s.tasks||[]).length){
    h+='<div class="sr-section-title"><div><small>FOLLOW-UP</small><h2>지난 지적사항 조치확인</h2></div>'
      +'<span>'+(s.tasks||[]).length+'건</span></div>'
      +'<table class="sr-findings"><thead><tr><th style="width:240px">지적사항</th><th>현재 상태 / 조치내용</th><th style="width:150px">책임구분</th><th style="width:96px">상태</th></tr></thead><tbody>';
    (s.tasks||[]).forEach(function(t){
      h+='<tr><td>'+esc(t.title)+'<div class="sr-sub">'+dateDot(t.date)+'</div></td>'
        +'<td>'+esc(t.currentState||"-")+'<div class="sr-sub">'+esc(t.actionText||"-")+'</div></td>'
        +'<td>'+esc(t.owner||"-")+'</td>'
        +'<td>'+dot(t.status==="조치완료"?"good":"warn")+esc(t.status||"-")+'</td></tr>';
    });
    h+='</tbody></table>';
  }

  h+=footer("조치 완료 후 차기 점검에서 이행 여부를 재확인",NO)+'</div>';
  return sheet("조치계획",h);
}

/* ---------- 09 사진증빙 (4건/장, 자동증가) ---------- */
function sheetsEvidence(s){
  var items=[];
  (s.findings||[]).forEach(function(f){
    items.push({photos:f.photos,label:f.category,title:f.title,
      sub:[f.category,f.area&&f.area!==f.category?f.area:"",dateDot(s.store.date)].filter(Boolean).join(" · ")});
  });
  (s.accidents||[]).forEach(function(a){
    items.push({photos:a.beforePhotos,label:"사고조사 조치 전",title:(a.type||"사고")+" 조치 전",
      sub:"사고조사 · 조치 전 · "+dateDot(a.date)});
    items.push({photos:a.afterPhotos,label:"사고조사 조치 후",title:(a.type||"사고")+" 조치 후",
      sub:"사고조사 · "+(a.status||"확인 전")+" · "+dateDot(a.date)});
  });
  (s.tasks||[]).forEach(function(t){
    if((t.beforePhotos||[]).length)items.push({photos:t.beforePhotos,label:"지난 지적 조치 전",title:t.title+" 조치 전",sub:"조치확인 · 조치 전"});
    if((t.afterPhotos||[]).length)items.push({photos:t.afterPhotos,label:"지난 지적 조치 후",title:t.title+" 조치 후",sub:"조치확인 · 조치 후"});
  });
  if(!items.length)return [];

  var withPhoto=items.filter(function(x){return (x.photos||[]).some(function(p){return p&&p.dataUrl})}).length;
  var per=4,out=[];
  for(var i=0;i<items.length;i+=per){
    var chunk=items.slice(i,i+per);
    var h=head("PHOTO EVIDENCE","현장 사진 증빙",NO)+'<div class="sr-body">';
    if(!withPhoto&&i===0){
      h+='<div class="sr-note" style="margin-top:0"><b>첨부된 현장사진이 없습니다.</b> 미흡 답변에 사진을 첨부하면 아래 칸이 실제 이미지로 채워지고, 사진 수에 따라 페이지가 4장 단위로 자동 추가됩니다.</div>';
    }
    h+='<div class="sr-evidence" style="margin-top:14px">';
    chunk.forEach(function(x,j){
      h+='<figure>'+photoBox(x.photos,pad2(i+j+1)+" · "+x.label,"첨부된 사진 없음")
        +'<figcaption><b>'+esc(x.title)+'</b>'+esc(x.sub)+'</figcaption></figure>';
    });
    h+='</div>'+footer("등록된 모든 사진은 페이지당 최대 4장으로 자동 추가 · object-fit: contain",NO)+'</div>';
    out.push(sheet(out.length?"사진증빙"+(out.length+1):"사진증빙",h));
  }
  return out;
}

/* ============ 전체 조립 ============ */
function buildSheets(s){
  var list=[];
  list.push(sheetCover(s));
  list.push(sheetRoute(s));
  list.push(sheetWorkTypes(s));
  list.push(sheetRiskAnalysis(s));
  list=list.concat(sheetsVoice(s));
  list=list.concat(sheetsAccident(s));   /* 사고이력 없으면 통째로 생략 */
  list=list.concat(sheetsFindings(s));
  list.push(sheetPlan(s));
  list=list.concat(sheetsEvidence(s));

  /* 페이지 번호 치환 (전체 장수가 확정된 뒤) */
  var total=list.length;
  list.forEach(function(x,i){
    var no=pad2(i+1)+" / "+pad2(total);
    x.html=x.html.split(NO).join(no);
    x.no=i+1;
  });
  return list;
}
window.buildReportSheets=function(s){ return (!s||!s.store)?[]:buildSheets(s); };

/* app.js의 PDF 캡처가 쓰는 함수. 모든 장의 HTML을 이어붙여 돌려준다. */
function buildReportPages(s){
  if(!s||!s.store)return "";
  return buildSheets(s).map(function(x){
    return '<section class="sr-sheet'+(x.no===1?' sr-cover-dashboard':'')+'" data-sheet="'+x.no+'">'+x.html+'</section>';
  }).join("");
}
window.buildReportPages=buildReportPages;

/* ============ 화면 렌더링 (report.html 전용) ============ */
function render(){
  var deck=document.getElementById("deck");
  if(!deck)return; /* app.js가 이 파일을 불러쓸 때는 #deck이 없다. 그 경우 렌더링하지 않는다. */
  deck.className="sr-report";

  var s=loadSnapshot();
  if(!s||!s.store){
    deck.innerHTML='<div class="sr-empty-live"><b>보고서 데이터를 불러오지 못했습니다.</b>'
      +'<small>점검 결과화면에서 «결과보고서 보기» 버튼을 다시 눌러 주세요.<br>'
      +'브라우저가 팝업을 차단했거나, 결과화면을 거치지 않고 이 주소를 직접 열면 데이터가 없습니다.</small></div>';
    return;
  }

  var sheets=buildSheets(s);
  var nav='<div class="sr-toolbar"><strong>'+esc(s.store.name)+' 안전보건 현장진단 결과보고서</strong>'
    +'<div class="sr-pages" aria-label="보고서 페이지 선택">'
    +sheets.map(function(x,i){
      return '<button class="sr-page-btn" aria-pressed="'+(i===0?"true":"false")+'" data-page="'+x.no+'">'+esc(x.label)+'</button>';
    }).join("")
    +'<button class="sr-print-btn" onclick="window.print()">PDF/인쇄</button>'
    +'</div></div>';

  deck.innerHTML=nav+sheets.map(function(x,i){
    return '<section class="sr-sheet'+(i===0?" active sr-cover-dashboard":"")+'" data-sheet="'+x.no+'">'+x.html+'</section>';
  }).join("");

  var buttons=[].slice.call(deck.querySelectorAll(".sr-page-btn"));
  var sects=[].slice.call(deck.querySelectorAll(".sr-sheet"));
  buttons.forEach(function(button){
    button.addEventListener("click",function(){
      var page=button.getAttribute("data-page");
      buttons.forEach(function(item){ item.setAttribute("aria-pressed",String(item===button)) });
      sects.forEach(function(sec){ sec.classList.toggle("active",sec.getAttribute("data-sheet")===page) });
      window.scrollTo({top:0,behavior:"smooth"});
    });
  });
}
/* 예전 버튼(reportGo)에서 넘어오는 호출도 살려둔다. */
window.reportGo=function(n){
  var btn=document.querySelector('.sr-page-btn[data-page="'+n+'"]');
  if(btn)btn.click();
};
render();

})();
