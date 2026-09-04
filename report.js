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
  /* 확인 못한 건은 "위험"으로 내리지 않는다. 매장 상태를 나쁘게 본 게 아니라
     이번 방문에 못 본 것이므로, 점수에서 빠지고 상태는 "확인필요"로 남는다. */
  if(st.accident&&(s.accidents||[]).some(function(a){return a.status!=="확인 못함"&&(a.status==="미조치"||a.riskLevel==="상")}))st.accident=["위험","risk"];
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

/* ============ 자동 페이지 나누기 ============
   한 장은 1240x880 고정이고 .sr-capture .sr-sheet에 overflow:hidden이 걸려 있다.
   그래서 내용이 넘치면 다음 장으로 가지 않고 그대로 잘려 사라진다(작업유형 09~11 유실 사례).
   항목 개수로 어림잡아 나누면 글이 길 때 또 잘리고 짧을 때는 빈 공간이 남는다.
   그래서 화면 밖에 실제와 같은 폭·스타일의 측정용 장을 만들어 두고,
   블록을 하나씩 넣어 보며 넘치는 순간 다음 장으로 넘긴다.
   (report.html 화면과 PDF 캡처 모두 CSS가 붙은 뒤에 호출되므로 측정값이 실제와 일치한다) */
var MEASURE=null;
function measureBox(){
  if(MEASURE!==null)return MEASURE;
  try{
    if(typeof document==="undefined"||!document.body||!document.createElement)return MEASURE=false;
    var box=document.createElement("div");
    box.className="sr-report sr-capture";
    box.setAttribute("aria-hidden","true");
    box.style.cssText="position:fixed;left:-30000px;top:0;width:1240px;visibility:hidden;pointer-events:none";
    box.innerHTML='<section class="sr-sheet" style="height:auto;min-height:0;overflow:visible">'
      +'<header class="sr-page-head"><div><small>MEASURE</small><h2>측정</h2></div><span class="sr-page-no">00 / 00</span></header>'
      +'<div class="sr-body" data-measure-body></div></section>';
    document.body.appendChild(box);
    var body=box.querySelector("[data-measure-body]");
    var headEl=box.querySelector(".sr-page-head");
    if(!body||typeof body.offsetHeight!=="number"||!headEl)return MEASURE=false;
    var headH=headEl.offsetHeight||96;
    /* 측정이 실제로 동작하는지 확인한다(가짜 DOM·서버 렌더 환경에서는 항상 0이 나온다). */
    body.innerHTML='<div style="height:120px"></div>';
    if(body.offsetHeight<100)return MEASURE=false;
    return MEASURE={body:body,limit:880-headH};
  }catch(e){return MEASURE=false}
}
function fitsInPage(html){
  var m=measureBox();
  if(!m)return true;
  m.body.innerHTML=html;
  return m.body.offsetHeight<=m.limit;
}
/* 섹션 하나를 필요한 만큼의 장으로 나눠 만든다.
   cfg = {
     label, kicker, title, footerText,
     titleBar: function(range){...},  // 매 장 위에 붙는 섹션 제목줄(범위 표시)
     blocks: [html],                  // 항목 하나 = 블록 하나. 이 단위로만 페이지가 나뉜다
     tail: html,                      // 섹션 종합(마지막 장 끝. 안 들어가면 장을 하나 더 만든다)
     perFallback: n                    // 높이 측정이 불가능한 환경에서 한 장에 담을 개수
   } */
function buildPagedSheets(cfg){
  var m=measureBox();
  var per=cfg.perFallback||4;
  var groups=[],i,cur;
  if(!m){
    for(i=0;i<cfg.blocks.length;i+=per)groups.push(cfg.blocks.slice(i,i+per));
  }else{
    cur=[];i=0;
    while(i<cfg.blocks.length){
      cur.push(cfg.blocks[i]);
      if(cur.length>1&&!fitsInPage(cfg.titleBar("")+cur.join("")+footer(cfg.footerText,NO))){
        cur.pop();groups.push(cur);cur=[];continue;
      }
      i++;
    }
    if(cur.length)groups.push(cur);
  }
  if(!groups.length)groups=[[]];
  /* 종합 요약을 마지막 장에 붙여도 되는지 확인한다. */
  var tailOwnPage=false;
  if(cfg.tail&&m){
    var last=groups[groups.length-1];
    if(!fitsInPage(cfg.titleBar("")+last.join("")+cfg.tail+footer(cfg.footerText,NO)))tailOwnPage=true;
  }
  var out=[],done=0,multi=groups.length+(tailOwnPage?1:0)>1;
  groups.forEach(function(g,gi){
    var range=(cfg.blocks.length&&groups.length>1)?((done+1)+"–"+(done+g.length)+" / "+cfg.blocks.length):"";
    done+=g.length;
    var inner=cfg.titleBar(range)+g.join("");
    if(cfg.tail&&!tailOwnPage&&gi===groups.length-1)inner+=cfg.tail;
    out.push(sheet(multi?cfg.label+(out.length+1):cfg.label,
      head(cfg.kicker,cfg.title,NO)+'<div class="sr-body">'+inner+footer(cfg.footerText,NO)+'</div>'));
  });
  if(tailOwnPage){
    out.push(sheet(cfg.label+(out.length+1),
      head(cfg.kicker,cfg.title,NO)+'<div class="sr-body">'+cfg.tail+footer(cfg.footerText,NO)+'</div>'));
  }
  return out;
}

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
      desc:(s.tasks||[]).map(function(t){return esc(t.title)+"("+esc(t.notObserved?"확인 못함":(t.status||"-"))+")"}).join(" · "),
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
/* 작업유형 하나의 위험등급(상/중/하)을 매긴다.
   건수만 보면 "미흡 1건"이 전부 같아 보이지만, 이 매장에서 실제로 사고가 났던 재해유형이면
   같은 1건도 훨씬 위험하다. 그래서 아래 신호를 합산해 등급을 낸다.
     미흡 건수            건당 1
     넘어짐·근골격계      건당 +1.5  (실제 사고 비율 최상위 두 유형)
     이 매장 사고이력과 같은 재해유형  +3
     입고 인력부담 위험   +3(심각) / +1(경미)
     스트레칭 없이 작업 시작          +1.5
   합계 5 이상 상 · 2.5 이상 중 · 그 아래 하.
   반환: [등급, 색상클래스, 판정근거 문장] */
function workRiskGrade(s,w){
  if(w.status==="na")return["해당없음","none","해당 작업 없음"];
  var list=findingsOf(s,"작업점검").filter(function(f){return f.area===w.name});
  if(!list.length)return["하","good","확인된 미흡사항 없음"];
  var why=[],score=list.length;
  var hz=w.hazards||[];
  var heavy=hz.filter(function(h){return h==="넘어짐"||h==="근골격계"});
  if(heavy.length){score+=1.5*heavy.length;why.push(heavy.join("·")+" 위험요인")}
  /* 이 매장 사고이력과 같은 재해유형이면 재발 가능성이 실제로 확인된 것이다. */
  var accTypes=(s.accidents||[]).map(function(a){return String(a.type||"")}).filter(Boolean);
  var match=hz.filter(function(h){
    return accTypes.some(function(t){return t.indexOf(h)>=0||h.indexOf(t)>=0});
  });
  if(match.length){score+=3;why.push("이 매장 "+match.join("·")+" 사고이력과 동일")}
  if(w.name==="입고·하차"){
    var lb=s.inboundLabor,gap=s.tbmStretchGap;
    if(lb&&lb.level==="severe"){score+=3;why.push("입고 인력부담 위험(심각) · 평균 "+lb.avgPeople+"명")}
    else if(lb&&lb.level==="minor"){score+=1;why.push("입고 인력부담 위험(경미) · 평균 "+lb.avgPeople+"명")}
    if(gap&&gap.gapMinutes>0){score+=1.5;why.push("스트레칭 없이 "+gap.gapMinutes+"분 먼저 작업 시작")}
  }
  var grade=score>=5?["상","risk"]:(score>=2.5?["중","warn"]:["하","good"]);
  if(!why.length)why.push(list.length+"건 미흡");
  return [grade[0],grade[1],why.join(" · ")];
}
/* 작업유형 한 개 = 카드 한 블록. 이 단위로만 페이지가 나뉘므로 카드가 쪼개지지 않는다. */
function workCard(s,w,idx){
  var g=workRiskGrade(s,w);
  var list=findingsOf(s,"작업점검").filter(function(f){return f.area===w.name});
  var note=w.status==="na"?"해당 작업 없음":(list.length?list.map(function(f){return esc(f.title)}).join(" · "):"특이사항 없음");
  /* 사진은 그 작업유형 미흡에 붙은 것만, 최대 3장까지 같은 카드에 함께 싣는다. */
  var photos=[];
  list.forEach(function(f){
    (f.photos||[]).forEach(function(p){if(p&&p.dataUrl&&photos.length<3)photos.push(p)});
  });
  var h='<div class="sr-wcard '+g[1]+'">'
    +'<div class="sr-wcard-head"><b>'+pad2(idx+1)+' '+esc(w.name)+'</b>'
    +'<span class="sr-wgrade '+g[1]+'">'+(g[1]==="none"?"":"위험 ")+esc(g[0])+'</span></div>'
    +'<p class="sr-wcard-note">'+note+'</p>'
    +'<p class="sr-wcard-why">'+esc(g[2])+'</p>';
  if((w.hazards||[]).length)h+=hazPills(w.hazards);
  /* 입고·하차는 판정 근거가 되는 측정 원본값을 함께 남긴다. */
  if(w.name==="입고·하차"&&inboundFacts(s))h+='<p class="sr-wcard-facts">'+esc(inboundFacts(s))+'</p>';
  if(photos.length){
    h+='<div class="sr-wcard-photos">';
    photos.forEach(function(p,pi){h+=photoBox([p],pad2(idx+1)+" "+w.name+" "+(pi+1),"첨부된 사진 없음")});
    h+='</div>';
  }
  return h+'</div>';
}
/* 섹션 종합. 어떤 작업이 위험한지와 이 매장에서 반복되는 재해유형을 한 번에 정리한다. */
function workTail(s){
  var works=s.work||[];
  var high=[],mid=[];
  works.forEach(function(w,i){
    var g=workRiskGrade(s,w);
    if(g[1]==="risk")high.push(pad2(i+1)+" "+w.name);
    else if(g[1]==="warn")mid.push(pad2(i+1)+" "+w.name);
  });
  var hz={};
  findingsOf(s,"작업점검").forEach(function(f){(f.hazards||[]).forEach(function(x){hz[x]=(hz[x]||0)+1})});
  var top=Object.keys(hz).sort(function(a,b){return hz[b]-hz[a]}).slice(0,4)
    .map(function(k){return k+" "+hz[k]+"건"});
  var h='<div class="sr-section-title"><div><small>KEY POINT</small><h2>작업점검 종합</h2></div>'
    +'<span>위험 '+high.length+' · 주의 '+mid.length+' · 양호 '+(works.length-high.length-mid.length)+'</span></div>'
    +'<div class="sr-wsum">';
  h+='<div class="'+(high.length?"risk":"")+'"><small>즉시 관리가 필요한 작업</small><b>'
    +(high.length?esc(high.join(" · ")):"없음")+'</b></div>';
  h+='<div class="'+(mid.length?"warn":"")+'"><small>주의 관찰이 필요한 작업</small><b>'
    +(mid.length?esc(mid.join(" · ")):"없음")+'</b></div>';
  h+='<div><small>이 매장에서 많이 나온 재해유형</small><b>'
    +(top.length?esc(top.join(" · ")):"확인된 위험요인 없음")+'</b></div>';
  h+='</div>';
  if(high.length){
    h+='<div class="sr-note"><b>'+esc(high[0].replace(/^\d+\s/,""))+'</b>부터 조치해 주세요. '
      +'위험등급은 미흡 건수뿐 아니라 이 매장 사고이력·측정된 작업부담을 함께 반영한 결과입니다.</div>';
  }
  return h;
}
function sheetsWorkTypes(s){
  var works=s.work||[];
  if(!works.length)return [];
  var high=0,mid=0;
  works.forEach(function(w){var g=workRiskGrade(s,w);if(g[1]==="risk")high++;else if(g[1]==="warn")mid++});
  return buildPagedSheets({
    label:"작업유형",
    kicker:"WORK TYPE STATUS",
    title:"작업유형별 현황",
    footerText:"위험등급은 미흡 건수·재해유형·이 매장 사고이력을 함께 반영",
    titleBar:function(range){
      return '<div class="sr-section-title"><div><small>SUMMARY</small><h2>'+works.length+'개 작업유형 점검결과</h2></div>'
        +'<span>'+(range?esc(range)+" · ":"")+'위험 '+high+' · 주의 '+mid+' · 양호 '+(works.length-high-mid)+'</span></div>';
    },
    blocks:works.map(function(w,i){return workCard(s,w,i)}),
    tail:workTail(s),
    perFallback:3
  });
}

/* 미흡사항 하나의 위험등급. 작업유형(workRiskGrade)과 같은 사고방식이다.
   항목 1건 기준이라 시작점이 1이고, 아래 신호를 더해 상/중/하를 낸다.
     넘어짐·근골격계·떨어짐 위험요인   건당 +1.5
     소방(화재 시 대피에 직결)          +2
     사다리 이상                        +1.5
     이 매장 사고이력과 같은 재해유형   +3 */
function findingRiskGrade(s,f){
  var why=[],score=1,hz=f.hazards||[];
  var heavy=hz.filter(function(h){return h==="넘어짐"||h==="근골격계"||h==="떨어짐"});
  if(heavy.length){score+=1.5*heavy.length;why.push(heavy.join("·")+" 위험요인")}
  if(f.category==="소방"){score+=2;why.push("소방설비 · 화재 시 대피에 직결")}
  if(f.category==="사다리"){score+=1.5;why.push("사다리 이상 · 떨어짐 위험")}
  var accTypes=(s.accidents||[]).map(function(a){return String(a.type||"")}).filter(Boolean);
  var match=hz.filter(function(h){
    return accTypes.some(function(t){return t.indexOf(h)>=0||h.indexOf(t)>=0});
  });
  if(match.length){score+=3;why.push("이 매장 "+match.join("·")+" 사고이력과 동일")}
  var g=score>=5?["상","risk"]:(score>=2.5?["중","warn"]:["하","good"]);
  if(!why.length)why.push("확인된 미흡사항");
  return [g[0],g[1],why.join(" · ")];
}
/* 미흡사항 한 건 = 카드 한 블록. 사진을 항목 안에 함께 실어서
   뒤쪽에 사진증빙 장을 따로 두지 않는다(앞뒤로 넘겨보지 않게 하려는 것). */
function findingCard(s,f,idx){
  var g=findingRiskGrade(s,f);
  var photos=(f.photos||[]).filter(function(p){return p&&p.dataUrl}).slice(0,3);
  var sub=[];
  if(f.question)sub.push("문항: "+f.question);
  if(f.note)sub.push(f.note);
  var area=(f.area&&f.area!==f.category)?f.area:"";
  var h='<div class="sr-wcard '+g[1]+'">'
    +'<div class="sr-wcard-head"><b>'+pad2(idx+1)+' '+esc(f.title)+'</b>'
    +'<span class="sr-wgrade '+g[1]+'">위험 '+esc(g[0])+'</span></div>'
    +'<p class="sr-wcard-cat">'+esc(f.category)+(area?" · "+esc(area):"")+'</p>';
  if(sub.length)h+='<p class="sr-wcard-note">'+esc(sub.join(" / "))+'</p>';
  h+='<p class="sr-wcard-why">'+esc(g[2])+'</p>'
    +'<p class="sr-wcard-fix"><b>개선방향</b> '+esc(improvementText(f))+'</p>';
  if((f.hazards||[]).length)h+=hazPills(f.hazards);
  if(photos.length){
    h+='<div class="sr-wcard-photos">';
    photos.forEach(function(p,pi){h+=photoBox([p],pad2(idx+1)+" "+f.category+" "+(pi+1),"첨부된 사진 없음")});
    h+='</div>';
  }
  return h+'</div>';
}
/* 지난 지적사항 한 건 = 카드 한 블록. 과거 사진과 조치 후 사진을 나란히 싣는다. */
function taskCard(s,t,idx){
  var cls=t.notObserved?"warn":(t.status==="조치완료"?"good":"risk");
  var badge=t.notObserved?"확인 못함":(t.status||"미조치");
  var h='<div class="sr-wcard '+cls+'">'
    +'<div class="sr-wcard-head"><b>'+pad2(idx+1)+' '+esc(t.title)+'</b>'
    +'<span class="sr-wgrade '+cls+'">'+esc(badge)+'</span></div>'
    +'<p class="sr-wcard-cat">최초 지적 '+dateDot(t.date)+'</p>';
  if(t.notObserved){
    h+='<p class="sr-wcard-note">이번 방문에 확인하지 못했습니다. 미조치로 유지되어 다음 방문에 다시 확인합니다.</p>';
  }else{
    /* 현재 상태가 지적사항 제목과 같으면(자동 기입값 그대로) 위 제목과 겹치므로 생략한다. */
    if(t.currentState&&t.currentState!==t.title)h+='<p class="sr-wcard-note">'+esc(t.currentState)+'</p>';
    h+='<p class="sr-wcard-why">'+esc((t.status==="조치완료"?"조치내용: ":"조치계획: ")+(t.actionText||"-"))+'</p>';
  }
  var before=(t.beforePhotos||[]).filter(function(p){return p&&p.dataUrl}).slice(0,2);
  var after=(t.afterPhotos||[]).filter(function(p){return p&&p.dataUrl}).slice(0,2);
  if(before.length||after.length){
    h+='<div class="sr-wcard-photos">';
    before.forEach(function(p,i){h+=photoBox([p],"과거 지적 "+(i+1),"첨부된 사진 없음")});
    after.forEach(function(p,i){h+=photoBox([p],"조치 후 "+(i+1),"첨부된 사진 없음")});
    h+='</div>';
  }
  return h+'</div>';
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
/* 근로자 의견 + 지난 지적사항 조치확인을 한 섹션으로 묶는다.
   둘 다 "현장에서 확인한 사람·이력" 이야기라 같이 보는 편이 맥락이 이어진다.
   조치확인은 표 대신 카드로 만들어 과거 사진과 조치 후 사진을 그 안에 함께 싣는다. */
function sheetsVoiceFollowup(s){
  var voices=s.workerOpinions||[];
  var tasks=s.tasks||[];
  if(!voices.length&&!tasks.length)return [];
  var blocks=[];
  if(voices.length){
    blocks.push('<div class="sr-section-title"><div><small>ANONYMOUS</small><h2>근로자 의견청취</h2></div>'
      +'<span>양호하지 않은 응답 '+voices.length+'건 · 익명 수집</span></div>');
    voices.forEach(function(o){
      blocks.push('<div class="sr-voice"><small>근로자 '+esc(o.worker)+'</small>'
        +'<p>'+esc(o.question)+' → <strong>'+esc(o.answer)+'</strong></p></div>');
    });
    var unshared=unsharedAccidentVoices(s);
    if(unshared.length){
      blocks.push('<div class="sr-note"><b>사고사례 안내 미인지 '+unshared.length+'건</b> — 과거 사고가 있는 매장인데 근로자가 해당 사례를 안내받지 못했다고 답했습니다. TBM에서 사고사례를 실제로 공유하고 있는지 확인이 필요합니다.</div>');
    }
    (s.tbmCrossCheckFlags||[]).forEach(function(f){ blocks.push('<div class="sr-note">'+esc(f.message)+'</div>'); });
  }
  if(tasks.length){
    var done=tasks.filter(function(t){return t.status==="조치완료"}).length;
    var unseen=tasks.filter(function(t){return t.notObserved}).length;
    blocks.push('<div class="sr-section-title"><div><small>FOLLOW-UP</small><h2>지난 지적사항 조치확인</h2></div>'
      +'<span>'+tasks.length+'건 · 조치완료 '+done+' · 미조치 '+(tasks.length-done-unseen)+' · 확인 못함 '+unseen+'</span></div>');
    tasks.forEach(function(t,i){blocks.push(taskCard(s,t,i))});
  }
  return buildPagedSheets({
    label:(voices.length&&tasks.length)?"의견·조치확인":(voices.length?"근로자 의견":"조치확인"),
    kicker:"VOICE & FOLLOW-UP",
    title:(voices.length&&tasks.length)?"근로자 의견 · 조치확인":(voices.length?"근로자 의견청취":"지난 지적사항 조치확인"),
    footerText:"근로자 의견은 이름·사번 없이 익명으로 수집 · 미조치 항목은 다음 방문에 다시 확인",
    titleBar:function(){return ""},
    blocks:blocks,
    perFallback:4
  });
}

/* 사고 위험등급(상/중/하)을 작업유형·미흡사항 카드와 같은 배지 색으로 맞춘다. */
function riskLevelCls(level){
  return level==="상"?"risk":(level==="중"?"warn":(level==="하"?"good":""));
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
    var h=head("ACCIDENT PREVENTION","사고 재발방지 조사",NO)+'<div class="sr-body">'
      +'<div class="sr-section-title"><div><small>CASE '+pad2(i+1)+' / '+pad2(sorted.length)+'</small>'
      +'<h2>'+esc(a.type||"사고")+' · '+esc(a.status||"확인 전")+'</h2></div>'
      +'<span class="sr-wgrade '+riskLevelCls(a.riskLevel)+'">위험 '+esc(a.riskLevel||"-")+'</span></div>'
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
  /* 확인 못한 건도 다음 방문에 다시 봐야 하므로 뒤로 밀리지 않게 조금 올린다. */
  if(a.status==="확인 못함")r+=3;
  if(a.approved==="Y")r+=1;
  return r;
}

/* ---------- 사다리 현황 (보유표 + 이상 항목 카드) ----------
   예전에는 개선조치 계획 장 위쪽에 얹혀 있어서 사다리 사진이 뒤쪽 증빙 장으로 밀려 있었다.
   독립 섹션으로 떼어내고 이상 항목을 카드로 만들어 사진을 그 안에 함께 싣는다. */
function sheetsLadder(s){
  var counts=(s.ladder&&s.ladder.counts)||{};
  var typeStatus=(s.ladder&&s.ladder.typeStatus)||{};
  var ladderF=findingsOf(s,"사다리");
  var total=LADDER_ORDER.reduce(function(a,t){return a+Number(counts[t]||0)},0);
  /* 보유도 없고 미흡도 없으면 장을 만들지 않는다. */
  if(!total&&!ladderF.length)return [];

  var inv='<div class="sr-section-title"><div><small>LADDER INVENTORY</small><h2>사다리 보유현황</h2></div>'
    +'<span>'+(highRiskOwned(s).length?"고위험 유형 보유 · 관리기준 강화 대상":"고위험 유형 미보유")+'</span></div>'
    +'<div class="sr-ladder">';
  LADDER_ORDER.forEach(function(t){
    var n=Number(counts[t]||0);
    var stt=typeStatus[t]||"";
    var mine=ladderF.filter(function(f){return f.area===t});
    var cls=n<=0?"off":(stt==="bad"?"bad":"");
    var note=n<=0?"대 · 미보유":(mine.length?"대 · "+mine.map(function(f){return esc(f.title)}).join(", ")+" 미흡":"대 · 양호");
    inv+='<div class="'+cls+'"><small>'+esc(t)+(LADDER_HIGH_RISK.indexOf(t)>=0?" ⚠":"")+'</small><b>'+n+'</b> <i>'+note+'</i></div>';
  });
  inv+='</div>';
  if(highRiskOwned(s).length){
    inv+='<div class="sr-note"><b>고위험 유형 보유</b> — '+highRiskOwned(s).map(esc).join(", ")
      +'. 반복 파손이 확인된 유형이므로 사용 전 발판·체결상태 점검을 일상점검에 포함하고 교체계획을 함께 검토해 주세요.</div>';
  }

  /* 보유현황표를 첫 블록으로 넣는다. 그래야 첫 장에만 나오고 이후 장은 카드로만 채워진다. */
  var blocks=[inv];
  if(ladderF.length){
    blocks.push('<div class="sr-section-title"><div><small>FINDINGS</small><h2>사다리 이상 항목</h2></div>'
      +'<span>'+ladderF.length+'건</span></div>');
    ladderF.forEach(function(f,i){blocks.push(findingCard(s,f,i))});
  }else if(total){
    blocks.push('<div class="sr-note info">보유 사다리 '+total+'대 전부 양호로 확인되었습니다.</div>');
  }
  return buildPagedSheets({
    label:"사다리",
    kicker:"LADDER STATUS",
    title:"사다리 현황",
    footerText:"고위험 유형(구형 검정·A형)은 사용 전 발판·체결상태 점검 필수",
    titleBar:function(){return ""},
    blocks:blocks,
    perFallback:2
  });
}

/* ---------- 분야별 상세결과 (공통·시설 / 소방 / TBM / 기타) ----------
   작업점검은 작업유형 장, 사다리는 사다리 장에서 이미 다뤘으므로 여기서는 제외한다.
   표를 카드로 바꿔 위험등급·개선방향·사진을 한 항목 안에 모았다. */
function sheetsFindings(s){
  var st=categoryStates(s);
  var tail=sectionStateTable(s,st);
  var fs=(s.findings||[]).filter(function(f){
    return f.category!=="작업점검"&&f.category!=="사다리";
  }).slice().sort(function(a,b){ return rankFinding(b)-rankFinding(a) });
  if(!fs.length){
    return [sheet("상세결과",head("DETAILED FINDINGS","분야별 상세결과",NO)+'<div class="sr-body">'
      +'<div class="sr-note info">공통·시설, 소방, TBM, 기타사항에서 확인된 미흡사항이 없습니다.</div>'
      +tail+footer("분야별 상태는 점수 대신 4단계로 표기",NO)+'</div>')];
  }
  return buildPagedSheets({
    label:"상세결과",
    kicker:"DETAILED FINDINGS",
    title:"분야별 상세결과",
    footerText:"공통·시설 / 소방 / TBM / 기타사항 · 사진은 항목 안에 함께 표시",
    titleBar:function(range){
      return '<div class="sr-section-title"><div><small>FINDINGS</small><h2>이번 점검 미흡사항</h2></div>'
        +'<span>'+(range?esc(range):fs.length+"건")+'</span></div>';
    },
    blocks:fs.map(function(f,i){return findingCard(s,f,i)}),
    tail:tail,
    perFallback:3
  });
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
  /* 확인 못한 건은 미조치와 따로 센다. 점수에서 빠진 건이 몇 건인지 근거로 보여준다. */
  var unseenAcc=acc.filter(function(a){return a.status==="확인 못함"}).length;
  var rows=[
    ["작업점검",findingsOf(s,"작업점검").length+"건 미흡",st.work],
    ["사다리",(sec.ladder||0)+"건 미흡"+(highRiskOwned(s).length?" · 고위험 유형 보유":""),st.ladder],
    ["공통·시설",(sec.common||0)+"건 미흡",st.common],
    ["소방",(sec.fire||0)+"건 미흡",st.fire],
    ["TBM",((sec.tbm||0)?sec.tbm+"건 미흡":"전 항목 양호")+" · "+(s.tbmConfirmMethod||"-")+(gap&&gap.gapMinutes>0?" · 입고 "+gap.gapMinutes+"분 선행":""),st.tbm]
  ];
  if(st.accident)rows.push(["사고 재발방지",acc.length+"건 중 "+open+"건 미조치"
    +(unseenAcc?" · "+unseenAcc+"건 확인 못함(점수 제외)":""),st.accident]);
  var h='<div class="sr-section-title"><div><small>SECTION STATUS</small><h2>분야별 상태 및 판정 근거</h2></div>'
    +'<span>점수 대신 상태 4단계(우수·양호·관리필요·위험)로 표기</span></div>'
    +'<table class="sr-findings"><thead><tr><th style="width:150px">분야</th><th>판정 근거</th><th style="width:110px">상태</th></tr></thead><tbody>';
  rows.forEach(function(r){
    h+='<tr><td>'+esc(r[0])+'</td><td>'+esc(r[1])+'</td><td>'+dot(r[2][1])+esc(r[2][0])+'</td></tr>';
  });
  return h+'</tbody></table>';
}

/* ---------- 마지막 장: 개선조치 계획 ----------
   사다리 보유현황은 사다리 장으로, 지난 지적사항은 의견·조치확인 장으로 옮겼다.
   이 장은 "그래서 무엇부터 하면 되는가"만 담는다. */
function sheetsPlan(s){
  var pr=buildPriorities(s);
  var blocks=[];
  blocks.push('<div class="sr-section-title"><div><small>ACTION PLAN</small><h2>조치 계획</h2></div>'
    +'<span>담당·기한은 매장 협의 후 확정</span></div>');
  if(!pr.length){
    blocks.push('<div class="sr-note info">별도 조치계획이 필요한 항목이 없습니다.</div>');
  }else{
    pr.forEach(function(p,i){
      var owner=p.status==="즉시조치"?"담당: 매장 자체조치 + 부서 협의 · 기한: 즉시"
              :(p.status==="확인필요"?"담당: 점검자 재확인 · 기한: 차기 방문":"담당: 매장 자체조치 · 기한: 7일 이내");
      blocks.push('<div class="sr-priority"><i>'+pad2(i+1)+'</i><div><b>'+p.title+'</b><small>'+owner+'</small></div>'
        +'<span class="sr-status '+p.cls+'">'+esc(p.status)+'</span></div>');
    });
  }
  return buildPagedSheets({
    label:"조치계획",
    kicker:"ACTION PLAN",
    title:"개선조치 계획",
    footerText:"조치 완료 후 차기 점검에서 이행 여부를 재확인",
    titleBar:function(){return ""},
    blocks:blocks,
    perFallback:8
  });
}

/* 지적사항 재점검은 전체 체크리스트를 실시한 것이 아니므로 종합점수·분야별 양호판정을
   만들지 않고, 확인한 지적사항만 별도 결과표로 출력한다. */
function sheetsFollowupOnly(s){
  var list=s.tasks||[];
  var done=list.filter(function(t){return t.status==="조치완료"}).length;
  var unseen=list.filter(function(t){return t.notObserved}).length;
  var blocks=[
    '<div class="sr-section-title"><div><small>FOLLOW-UP SUMMARY</small><h2>'+esc(s.store.name)+' · '+dateDot(s.store.date)+'</h2></div>'
      +'<span>기준 점검 '+esc(s.sourceInspectionId||"-")+'</span></div>'
    +'<div class="sr-kpi"><div><small>확인 대상</small><b>'+list.length+'건</b></div>'
      +'<div><small>조치완료</small><b>'+done+'건</b></div>'
      +'<div><small>미조치</small><b>'+(list.length-done-unseen)+'건</b></div>'
      +'<div><small>확인 못함</small><b>'+unseen+'건</b></div></div>'
  ];
  if(!list.length){
    blocks.push('<div class="sr-note info">재점검 대상 지적사항이 없습니다.</div>');
  }else{
    blocks.push('<div class="sr-section-title"><div><small>FOLLOW-UP ITEMS</small><h2>항목별 확인 결과</h2></div>'
      +'<span>전체 체크리스트 미실시 · 지적사항만 재확인</span></div>');
    list.forEach(function(t,i){blocks.push(taskCard(s,t,i))});
  }
  return buildPagedSheets({
    label:"재점검 결과",
    kicker:"FOLLOW-UP ONLY",
    title:"지난 지적사항 재점검 결과",
    footerText:"지적사항 재점검 전용 · 미조치/확인 못함 항목은 다음 방문에 다시 표시",
    titleBar:function(){return ""},
    blocks:blocks,
    perFallback:3
  });
}

/* 예전에 있던 sheetsEvidence(사진증빙 몰아넣기 장)는 없앴다.
   사진이 항목 카드 안으로 들어가서, 보는 사람이 앞뒤로 넘겨가며 대조할 필요가 없어졌다. */

/* ============ 전체 조립 ============ */
function buildSheets(s){
  var list=[];
  if(s.followupOnly){
    list=sheetsFollowupOnly(s);
    var followupTotal=list.length;
    list.forEach(function(x,i){var no=pad2(i+1)+" / "+pad2(followupTotal);x.html=x.html.split(NO).join(no);x.no=i+1});
    return list;
  }
  /* 목차 순서: 요약 → 동선 → 작업유형 → 위험분석 → 사고조사 → 사다리 → 분야별 상세
     → 의견·조치확인 → 조치계획.
     사진은 각 섹션 항목 안에 들어가므로 뒤쪽에 사진증빙 장을 따로 두지 않는다. */
  list.push(sheetCover(s));
  list.push(sheetRoute(s));
  /* 항목마다 사진과 위험등급이 붙어 분량이 크다. 필요한 만큼 장이 자동으로 늘어난다. */
  list=list.concat(sheetsWorkTypes(s));
  list.push(sheetRiskAnalysis(s));
  list=list.concat(sheetsAccident(s));   /* 사고이력 없으면 통째로 생략 */
  list=list.concat(sheetsLadder(s));     /* 보유·미흡 모두 없으면 생략 */
  list=list.concat(sheetsFindings(s));
  list=list.concat(sheetsVoiceFollowup(s));
  list=list.concat(sheetsPlan(s));

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
