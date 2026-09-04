/* ============================================================
   안전보건 현장진단 결과보고서 (sr- 레이아웃 · 시안D 확정흐름 구현본)

   ── 이 파일이 쓰이는 곳 (두 군데에서 같은 HTML을 만든다)
     1) report.html — 점검자가 화면으로 보는 결과보고서
     2) app.js      — 최종 제출 시 같은 화면을 캡처해 PDF로 만들어 드라이브에 저장
     그래서 페이지 생성 함수를 window.buildReportPages()로 노출한다.
     화면과 PDF가 100% 같은 모양이 되는 이유가 이것이다.

   ── 확정된 흐름 (사용자 승인 · 변경 금지)
     1p 표지 → 2p 목차 → [챕터 구분장 → 상세…] × 전 챕터 → 마지막 조치계획
     챕터 순서
       00 점검결과 요약   01 작업점검   02 사다리   03 공통·시설   04 소방
       05 TBM             06 근로자 의견청취        07 기타사항
       08 지난 지적사항 조치확인       09 사고조사  10 개선조치 계획
     규칙
       · 모든 챕터는 스킵 없음. 미흡 0건이면 구분장 + "양호" 한 줄만 남기고 상세는 만들지 않는다.
       · 예외: 사다리·사고조사는 미흡/이력이 0건이어도 보유현황·이력요약을 항상 노출한다.
         (구형 사다리(검정)·A형 보유 자체가 떨어짐 위험 노출이고, 사고이력은 재발방지 확인 대상)
       · 상세는 2문항/페이지 고정. 짝수는 좌우 반반 + 가운데 주름선.
         홀수로 1개만 남으면 왼쪽정렬 금지 → 가운데정렬 + 사진 확대.
       · 여백 금지. 페이지가 880px 고정이므로 남는 높이는 사진 영역이 flex로 흡수한다.
       · 상세페이지 왼쪽에는 그 분야 전체 체크리스트를 양호/미흡으로 표기하고,
         지금 보고 있는 항목을 하이라이트한다.

   ── 데이터
     1순위: 부모창(앱 화면)의 getLandscapeReportSnapshot() 직접 호출 — 사진 실데이터까지 온다.
     2순위: localStorage 캐시 — 팝업 차단·새로고침 대비. 단 사진(dataUrl)은 저장되지 않는다.

   ── 반드시 지키는 규칙
     · 점수·등급 숫자(84, B 등)를 화면에 절대 노출하지 않는다.
     · 사고·미흡사항·근로자 의견은 개수 제한 없이 전부 싣는다.
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

/* ============ 개선방향 문구 (카테고리·키워드 기반 자동 생성) ============
   ※ 위험요인별 해결방안 1~3안은 현장 문구를 확정한 뒤 넣기로 했다(사용자 결정).
      그때까지는 아래 규칙 기반 한 줄을 '개선방향'으로 싣는다. AI가 임의로 안을 늘리지 않는다. */
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
  if(hasNow)return{label:"우선관리 필요",sub:priorities.slice(0,2).map(function(p){return p.key}).join(" · ")};
  if(hasAny)return{label:"관리 필요",sub:priorities.slice(0,2).map(function(p){return p.key}).join(" · ")};
  return{label:"양호 유지",sub:"현재 관리상태 지속"};
}
function verdictHeadline(priorities){
  if(!priorities.length)return "전반적으로 관리되고 있어<br>현재 상태를 유지하면 됩니다.";
  var keys=[];
  priorities.forEach(function(p){ if(keys.indexOf(p.key)<0)keys.push(p.key) });
  if(keys.length===1)return esc(keys[0])+"을(를)<br><span class=\"sr-hl\">우선 관리</span>해야 합니다.";
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
  if(open.length&&((gap&&gap.gapMinutes>0)||(lb&&lb.level!=="good"))){
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

/* ============ 위험등급 ============ */
/* 작업유형 하나의 위험등급(상/중/하).
   건수만 보면 "미흡 1건"이 전부 같아 보이지만, 이 매장에서 실제로 사고가 났던 재해유형이면
   같은 1건도 훨씬 위험하다. 그래서 아래 신호를 합산해 등급을 낸다.
     미흡 건수            건당 1
     넘어짐·근골격계      건당 +1.5  (실제 사고 비율 최상위 두 유형)
     이 매장 사고이력과 같은 재해유형  +3
     입고 인력부담 위험   +3(심각) / +1(경미)
     스트레칭 없이 작업 시작          +1.5
   합계 5 이상 상 · 2.5 이상 중 · 그 아래 하. */
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
/* 미흡사항 하나의 위험등급. 작업유형(workRiskGrade)과 같은 사고방식이다. */
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
function riskLevelCls(level){
  return level==="상"?"risk":(level==="중"?"warn":(level==="하"?"good":""));
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
/* 그 분야에서 첫 번째로 나오는 사진 (요약본 썸네일용) */
function firstPhotoOf(list){
  var out=[];
  (list||[]).some(function(f){
    var ps=(f.photos||f.beforePhotos||[]).filter(function(p){return p&&p.dataUrl});
    if(ps.length){out=[ps[0]];return true}
    return false;
  });
  return out;
}

/* ============ 페이지 조립 기본 도구 ============ */
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
/* 목차의 "몇 페이지" 표시도 전체 조립이 끝난 뒤 치환한다. */
function tocMark(key){ return "__SR_TOC_"+key+"__"; }

/* 머리글 + 본문(남는 높이를 본문이 흡수) 형태의 한 장 */
function pageSheet(label,kicker,title,bodyHtml,footerText){
  return sheet(label,'<div class="sr-page">'+head(kicker,title,NO)
    +'<div class="sr-body">'+bodyHtml+footer(footerText,NO)+'</div></div>');
}

/* ============================================================
   1p 표지
   ============================================================ */
function sheetCover(s){
  var pr=buildPriorities(s),dg=diagnosisLabel(s,pr);
  var h='<div class="sr-cover2">'
    +'<small class="sr-cover2-kicker">SAFETY INSPECTION REPORT</small>'
    +'<h1>안전보건 현장진단<br>결과보고서</h1>'
    +'<p class="sr-cover2-sub">위험을 발견하고, 조치로 연결합니다.</p>'
    +'<div class="sr-cover2-rule"></div>'
    +'<div class="sr-cover2-verdict"><small>종합 진단결과 · '+esc(dg.label)+'</small>'
    +'<b>'+verdictHeadline(pr)+'</b>'
    +'<p>'+esc(verdictBody(s))+'</p></div>'
    +'<div class="sr-cover2-meta">'
    +'<div>영업본부<b>'+esc(s.store.hq||"-")+'</b></div>'
    +'<div>부서<b>'+esc(s.store.dept||"-")+'</b></div>'
    +'<div>팀<b>'+esc(s.store.team||"-")+'</b></div>'
    +'<div>매장<b>'+esc(s.store.name)+'</b></div>'
    +'<div>점검일<b>'+esc(dateDot(s.store.date)||"-")+'</b></div>'
    +'<div>점검자<b>'+esc(s.store.inspector||"-")+'</b></div>'
    +'</div></div>';
  return sheet("표지",h);
}

/* ============================================================
   2p 목차 — 챕터 목록과 각 챕터의 시작 페이지, 건수를 함께 보여준다.
   ============================================================ */
function sheetToc(s,chapters){
  var rows=chapters.map(function(c){
    var tag=c.tocTag||{text:"",cls:""};
    return '<div class="sr-toc-row"><i>'+c.no+'</i><span>'+esc(c.title)+'</span>'
      +(tag.text?'<em class="'+tag.cls+'">'+esc(tag.text)+'</em>':"")
      +'<em>p.'+tocMark(c.key)+'</em></div>';
  }).join("");
  var h='<div class="sr-toc"><div class="sr-toc-side"></div><div class="sr-toc-main">'
    +'<small class="sr-cover2-kicker">CONTENTS</small><h1>목 차</h1>'
    +'<div class="sr-toc-list">'+rows+'</div>'
    +'<div class="sr-toc-foot">'
    +esc(s.store.name)+' · '+esc(dateDot(s.store.date))+' · 점검자 '+esc(s.store.inspector||"-")+'<br>'
    +'모든 챕터는 생략 없이 표시됩니다. 미흡사항이 없는 챕터는 «양호»로만 표기되고 상세 페이지가 없습니다.<br>'
    +'사다리·사고조사는 이상항목이 없어도 보유현황·이력요약을 항상 함께 확인합니다.'
    +'</div></div></div>';
  return sheet("목차",h);
}

/* ============================================================
   챕터 구분장
   cfg={no,key,title,kicker,sub:[{i,text,tag,cls}],note,good,counts:[{label,value,bad}],foot}
   ============================================================ */
function chapterSheet(cfg){
  var h='<div class="sr-chapter"><div class="sr-chapter-side"><b>'+esc(cfg.no)+'</b></div>'
    +'<div class="sr-chapter-main">'
    +'<small>'+esc(cfg.kicker||"CHAPTER")+'</small>'
    +'<h1>'+esc(cfg.title)+'</h1>'
    +'<div class="sr-chapter-rule"></div>';
  if(cfg.sub&&cfg.sub.length){
    /* 항목이 많으면 글자·여백을 줄여 한 장(880px)을 넘기지 않게 한다. */
    var dense=cfg.sub.length>16?" dense2":(cfg.sub.length>11?" dense":"");
    h+='<div class="sr-chapter-sub'+dense+'">'+cfg.sub.map(function(x){
      return '<div><i>'+esc(x.i)+'</i><span>'+esc(x.text)+'</span>'
        +(x.tag?'<em class="'+(x.cls||"")+'">'+esc(x.tag)+'</em>':"")+'</div>';
    }).join("")+'</div>';
  }
  if(cfg.counts&&cfg.counts.length){
    h+='<div class="sr-chapter-count">'+cfg.counts.map(function(x){
      return '<div class="'+(x.bad?"bad":"")+'"><small>'+esc(x.label)+'</small><b>'+esc(x.value)+'</b></div>';
    }).join("")+'</div>';
  }
  if(cfg.good)h+='<div class="sr-chapter-good">✓ '+esc(cfg.good)+'</div>';
  if(cfg.note)h+='<div class="sr-chapter-note">'+cfg.note+'</div>';
  h+='<div class="sr-chapter-foot">'+esc(cfg.foot||"")+'</div>';
  h+='</div></div>';
  var sh=sheet(cfg.no+" "+cfg.title,h);
  sh.tocKey=cfg.key;   /* 목차 페이지번호 치환에 쓴다 */
  return sh;
}

/* ============================================================
   사이드바형 상세 페이지 (2문항/페이지 고정)

   이 한 함수가 작업점검·공통·시설·소방·TBM·의견청취·기타사항 상세를 모두 만든다.
   작업점검은 «문항», 나머지는 «항목»이라 데이터 모양이 다르지만,
   호출하는 쪽에서 아래 공통 모양으로 바꿔 넘기면 된다.

   cfg={
     label, kicker, title, footerText,
     sideTitle, sideKicker,
     sideItems:[{text,state:'good'|'bad'|'na'}],
     sideFoot,
     cards:[{sideIndex,num,title,answer,answerGood,meta,hazards,photos,fix,quote}],
     lead
   }
   · 카드 2개 = 한 장(좌우 반반 + 가운데 주름선)
   · 홀수로 1개만 남으면 .sr-solo (가운데정렬 + 사진 확대). 왼쪽정렬은 하지 않는다.
   ============================================================ */
var SIDE_MAX=18;   /* 한 장 사이드바에 넣을 수 있는 최대 줄 수(880px 기준) */

function sideBar(cfg,activeIdx){
  var items=cfg.sideItems||[];
  var shown=items,cut=0;
  if(items.length>SIDE_MAX){
    /* 항목이 많으면 지금 보고 있는 항목 주변만 보여준다(잘려 사라지는 것 방지). */
    var start=Math.max(0,Math.min((activeIdx.length?activeIdx[0]:0)-3,items.length-SIDE_MAX));
    shown=items.slice(start,start+SIDE_MAX);
    cut=items.length-shown.length;
  }
  var offset=items.length>SIDE_MAX?items.indexOf(shown[0]):0;
  /* 항목이 많으면 글자·여백을 줄인다. 사이드바는 overflow:hidden이라 넘치면 잘려 사라진다. */
  var dense=shown.length>15?" dense2":(shown.length>10?" dense":"");
  var h='<div class="sr-side'+dense+'"><div class="sr-side-head">'+esc(cfg.sideKicker||"CHECKLIST")
    +'<b>'+esc(cfg.sideTitle||"")+'</b></div>';
  shown.forEach(function(x,i){
    var real=offset+i;
    var on=activeIdx.indexOf(real)>=0;
    var tag=x.state==="bad"?"미흡":(x.state==="na"?"해당없음":"양호");
    h+='<div class="sr-side-item'+(on?" on":"")+(x.state==="na"?" na":"")+'">'
      +'<span>'+esc(x.text)+'</span><i class="'+(x.state==="bad"?"bad":(x.state==="na"?"na":""))+'">'+tag+'</i></div>';
  });
  if(cut>0)h+='<div class="sr-side-more">그 밖의 항목 '+cut+'개는 앞뒤 페이지에서 확인</div>';
  h+='<div class="sr-side-foot">'+esc(cfg.sideFoot||"«미흡»으로 표기된 항목만 오른쪽에 사진과 함께 상세로 싣습니다.")+'</div>';
  return h+'</div>';
}
function fixBox(fix){
  if(!fix)return "";
  var list=Array.isArray(fix)?fix:[fix];
  if(!list.length)return "";
  var h='<div class="sr-fix"><div class="sr-fix-title">위험요인에 관한 개선방향</div>';
  list.forEach(function(t,i){
    h+='<div class="sr-fix-opt" data-n="'+(list.length>1?(i+1)+"안.":"→")+'">'+esc(t)+'</div>';
  });
  return h+'</div>';
}
function cardBody(c,solo){
  var h='<div class="sr-qnum">'+esc(c.num||"")+'</div>'
    +'<h3 class="sr-qtitle">'+esc(c.title||"")+'</h3>';
  if(c.answer)h+='<p class="sr-qanswer'+(c.answerGood?" good":"")+'">'+esc(c.answer)+'</p>';
  if(c.meta)h+='<p class="sr-qmeta">'+esc(c.meta)+'</p>';
  if(c.quote){
    /* 사진이 없는 항목(근로자 의견 등)은 빈 사진칸 대신 인용 박스가 높이를 채운다. */
    h+='<div class="sr-qquote"><b>“'+esc(c.quote)+'”</b>'+(c.quoteSub?'<small>'+esc(c.quoteSub)+'</small>':"")+'</div>';
  }else{
    h+='<div class="sr-qphoto">'+photoBox(c.photos,c.photoLabel||c.num||"현장사진","첨부된 사진 없음")+'</div>';
  }
  if((c.hazards||[]).length)h+=hazPills(c.hazards);
  h+=fixBox(c.fix);
  return h;
}
function detailSheets(cfg){
  var cards=cfg.cards||[];
  if(!cards.length)return [];
  var out=[],i;
  for(i=0;i<cards.length;i+=2){
    var pair=cards.slice(i,i+2);
    var activeIdx=pair.map(function(c){return c.sideIndex}).filter(function(n){return typeof n==="number"});
    var inner;
    if(pair.length===2){
      inner='<div class="sr-split2">'
        +'<div class="sr-qcol">'+cardBody(pair[0])+'</div>'
        +'<div class="sr-qcol">'+cardBody(pair[1])+'</div>'
        +'</div>';
    }else{
      /* 1개만 남았다 → 가운데정렬 + 사진 확대 (왼쪽에 붙이지 않는다) */
      inner='<div class="sr-split2 one"><div class="sr-solo">'
        +'<span class="sr-solo-badge">'+esc(cfg.soloBadge||"단독 페이지 · 사진 확대")+'</span>'
        +cardBody(pair[0],true)+'</div></div>';
    }
    var range=cards.length>2?((i+1)+(pair.length>1?"–"+(i+pair.length):"")+" / "+cards.length):"";
    var mainHead='<div class="sr-main-head"><div><small>'+esc(cfg.kicker)+'</small>'
      +'<h2>'+esc(cfg.title)+(range?' <span style="font-size:11px;color:#70747b">'+esc(range)+'</span>':"")+'</h2></div>'
      +'<span class="sr-page-no">'+NO+'</span></div>';
    var lead=(i===0&&cfg.lead)?'<div class="sr-main-lead">'+cfg.lead+'</div>':"";
    out.push(sheet(cfg.label+(cards.length>2?"-"+(out.length+1):""),
      '<div class="sr-detail">'+sideBar(cfg,activeIdx)
      +'<div class="sr-main">'+mainHead+lead+inner
      +footer(cfg.footerText||"",NO)+'</div></div>'));
  }
  return out;
}

/* ============================================================
   챕터 00 · 점검결과 요약
   구분장 → 요약본(진단결과 블랙박스 + 동선요약 건수 + 사진 1장) → 위험분석·종합의견
   ============================================================ */
/* 요약본의 동선 요약 한 줄. 모든 분야를 빠짐없이 넣는다(스킵 없음 규칙). */
function summaryRows(s){
  var acc=s.accidents||[],open=acc.filter(function(a){return a.status==="미조치"}).length;
  var works=s.work||[],riskWorks=works.filter(function(w){return +w.risk>0});
  var tasks=s.tasks||[],doneT=tasks.filter(function(t){return t.status==="조치완료"}).length;
  var voices=s.workerOpinions||[];
  var lb=s.inboundLabor;
  var rows=[];
  rows.push({
    name:"작업점검",
    desc:works.length+"개 유형 중 "+riskWorks.length+"개 미흡"
      +(lb&&lb.level!=="good"?", 입고·하차 인력부담 "+(lb.level==="severe"?"위험(심각)":"위험(경미)"):""),
    count:findingsOf(s,"작업점검").length,
    photos:firstPhotoOf(findingsOf(s,"작업점검"))
  });
  var ladderF=findingsOf(s,"사다리"),owned=highRiskOwned(s);
  rows.push({
    name:"사다리",
    desc:(owned.length?"고위험 유형 보유("+owned.join(", ")+")":"고위험 유형 미보유")
      +(ladderF.length?" · 이상 "+ladderF.length+"건":" · 이상항목 없음"),
    count:ladderF.length,alwaysBad:owned.length>0,
    photos:firstPhotoOf(ladderF)
  });
  [["공통·시설","주요 시설상태 양호"],["소방","피난·소화설비 상태 양호"],["TBM","전 항목 양호"]].forEach(function(p){
    var list=findingsOf(s,p[0]);
    rows.push({
      name:p[0],
      desc:list.length?list.slice(0,2).map(function(f){return f.title}).join(" · ")+(list.length>2?" 등":""):p[1],
      count:list.length,photos:firstPhotoOf(list)
    });
  });
  rows.push({
    name:"근로자 의견",
    desc:voices.length?"양호하지 않은 응답 "+voices.length+"건"
      +(unsharedAccidentVoices(s).length?" · 사고사례 안내 미인지 "+unsharedAccidentVoices(s).length+"건":"")
      :"특이의견 없음",
    count:voices.length,photos:[]
  });
  var etc=findingsOf(s,"기타사항");
  rows.push({
    name:"기타사항",
    desc:etc.length?etc.slice(0,2).map(function(f){return f.title}).join(" · ")+(etc.length>2?" 등":""):"등록된 특이사항 없음",
    count:etc.length,photos:firstPhotoOf(etc)
  });
  rows.push({
    name:"조치확인",
    desc:tasks.length?"확인 "+tasks.length+"건 중 조치완료 "+doneT+"건"
      +(tasks.filter(function(t){return t.notObserved}).length?" · 확인 못함 "+tasks.filter(function(t){return t.notObserved}).length+"건":"")
      :"지난 지적사항 없음",
    count:tasks.length-doneT,photos:firstPhotoOf(tasks.map(function(t){return {photos:t.afterPhotos||t.beforePhotos}}))
  });
  rows.push({
    name:"사고이력",
    desc:acc.length?acc.map(function(a){return (a.type||"사고")+"("+(a.status||"확인 전")+")"}).join(" · ")
      :"등록된 사고이력 없음 (출퇴근 재해 제외)",
    count:acc.length,alwaysBad:open>0,
    photos:firstPhotoOf(acc.map(function(a){return {photos:(a.beforePhotos||[]).concat(a.afterPhotos||[])}}))
  });
  return rows;
}
function sheetSummary(s){
  var pr=buildPriorities(s),dg=diagnosisLabel(s,pr);
  var rows=summaryRows(s);
  var h='<div class="sr-sum-box">'
    +'<div class="sr-sum-black"><small>종합 진단결과</small><b>'+esc(dg.label)+'</b><span>'+esc(dg.sub)+'</span></div>'
    +'<div class="sr-sum-black"><p>'+esc(verdictBody(s))+'</p></div>'
    +'</div>';
  h+='<div class="sr-sum-title">현장점검 동선 요약 <em>분야별 미흡건수 · 대표사진 1장</em></div>';
  h+='<div class="sr-sum-rows">';
  rows.forEach(function(r){
    var cls=(r.count>0||r.alwaysBad)?"bad":"good";
    h+='<div class="sr-sum-row '+cls+'"><b>'+esc(r.name)+'</b><span>'+esc(r.desc)+'</span>'
      +'<span class="sr-cnt">'+r.count+'건</span>'
      +photoBox(r.photos,r.name,"사진 없음")+'</div>';
  });
  h+='</div>';
  return pageSheet("요약본","SUMMARY","점검결과 요약",h,esc(s.store.name)+" · 상세 내용은 각 챕터에서 확인");
}
function sheetRiskAnalysis(s){
  var pr=buildPriorities(s),cards=pr.slice(0,3);
  var h="";
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
  var unshared=unsharedAccidentVoices(s),flags=(s.tbmCrossCheckFlags||[]);
  if(unshared.length||flags.length){
    h+='<div class="sr-section-title"><div><small>CROSS CHECK</small><h2>TBM 실효성 교차확인</h2></div>'
      +'<span>관리자 점검결과 vs 근로자 응답</span></div>';
    flags.forEach(function(f){ h+='<div class="sr-note">'+esc(f.message)+'</div>' });
    if(unshared.length){
      h+='<div class="sr-note"><b>TBM 점검은 '+((s.sections&&s.sections.tbm)?"미흡 "+s.sections.tbm+"건으로":"전 항목 \u0027양호\u0027로")+' 기록됐지만</b>, '
        +'확인방법이 "'+esc(s.tbmConfirmMethod||"-")+'"이고 근로자는 과거 사고 '+unshared.length+'건에 대해 모두 "안내받지 못함"으로 응답했습니다. '
        +'사고사례 공유가 실제로 이루어지는지 다음 방문 시 직접참관으로 확인이 필요합니다.</div>';
    }
  }
  h+='<div class="sr-section-title"><div><small>MANAGEMENT NOTE</small><h2>점검자 종합의견</h2></div></div>'
    +'<div class="sr-verdict"><p>'+esc(managementNote(s))+'</p></div>';
  if(s.resultNote)h+='<div class="sr-note info"><b>점검자 메모</b> — '+esc(s.resultNote)+'</div>';
  h+='<div class="sr-plan-fill"></div>';
  return pageSheet("위험분석","RISK ANALYSIS","핵심 위험요인 분석",h,"위험도는 현장상태와 사고이력을 종합하여 산정");
}
function chapterSummary(s){
  var pr=buildPriorities(s);
  var out=[chapterSheet({
    no:"00",key:"summary",title:"점검결과 요약",
    sub:[{i:"01",text:"점검결과 요약"},{i:"02",text:"핵심 위험요인 분석 · 점검자 종합의견"}],
    counts:[
      {label:"점검 미흡",value:(s.findings||[]).length+"건",bad:(s.findings||[]).length>0},
      {label:"사고이력",value:(s.accidents||[]).length+"건"},
      {label:"미조치 사고",value:(s.accidents||[]).filter(function(a){return a.status==="미조치"}).length+"건",bad:(s.accidents||[]).some(function(a){return a.status==="미조치"})},
      {label:"우선 조치사항",value:pr.length+"건",bad:pr.length>0}
    ],
    foot:esc(s.store.name)+" · "+esc(dateDot(s.store.date))
  })];
  out.push(sheetSummary(s));
  out.push(sheetRiskAnalysis(s));
  return out;
}

/* ============================================================
   챕터 01 · 작업점검
   구분장(01~11 전체 유형 + 양호/미흡 표기) → 미흡이 있는 유형만 상세
   상세는 유형별로 새 페이지에서 시작하고, 문항 2개씩 배치한다.
   ============================================================ */
function workChapter(s){
  var works=s.work||[];
  var detail=s.workDetail||[];
  var out=[];

  var sub=works.map(function(w,i){
    var tag=w.status==="na"?"해당없음":(+w.risk>0?"미흡 "+w.risk+"건":"양호");
    var cls=w.status==="na"?"na":(+w.risk>0?"bad":"");
    return {i:pad2(i+1),text:w.name,tag:tag,cls:cls};
  });
  var badWorks=works.filter(function(w){return +w.risk>0});
  var high=[],mid=[];
  works.forEach(function(w,i){
    var g=workRiskGrade(s,w);
    if(g[1]==="risk")high.push(pad2(i+1)+" "+w.name);
    else if(g[1]==="warn")mid.push(pad2(i+1)+" "+w.name);
  });
  var note=badWorks.length
    ? '<b>미흡이 확인된 '+badWorks.length+'개 유형만 상세 페이지로 싣습니다.</b> 양호한 유형은 위 목록의 «양호» 표기로 확인하시면 됩니다.'
      +(high.length?'<br>위험등급 «상»: '+esc(high.join(" · ")):"")
      +(mid.length?'<br>위험등급 «중»: '+esc(mid.join(" · ")):"")
    : "";
  out.push(chapterSheet({
    no:"01",key:"work",title:"작업점검",
    sub:sub,
    good:badWorks.length?"":"전 작업유형 양호",
    note:note,
    foot:"위험등급은 미흡 건수뿐 아니라 이 매장 사고이력·측정된 작업부담을 함께 반영"
  }));

  works.forEach(function(w,wi){
    if(+w.risk<=0)return;
    var wd=detail.filter(function(x){return x.name===w.name})[0];
    var g=workRiskGrade(s,w);
    var sideItems=[],cards=[];
    if(wd&&(wd.questions||[]).length){
      sideItems=wd.questions.map(function(q){
        return {text:q.q,state:q.risk?"bad":(q.answered?"good":"na")};
      });
      wd.questions.forEach(function(q,qi){
        if(!q.risk)return;
        cards.push({
          sideIndex:qi,num:"문항 "+(qi+1),
          title:q.q,answer:"- "+(q.answer||"미흡 확인"),
          photos:q.photos,hazards:q.hazards,
          photoLabel:w.name+" 문항"+(qi+1),
          fix:improvementText({category:"작업점검",title:q.answer||q.q})
        });
      });
    }else{
      /* 예전 캐시(사진 없는 localStorage 사본 등)에는 문항 원본이 없다. 미흡목록만으로 만든다. */
      var list=findingsOf(s,"작업점검").filter(function(f){return f.area===w.name});
      sideItems=list.map(function(f){return {text:f.question||f.title,state:"bad"}});
      list.forEach(function(f,i){
        cards.push({
          sideIndex:i,num:"미흡 "+(i+1),
          title:f.question||f.title,answer:"- "+f.title,
          photos:f.photos,hazards:f.hazards,
          photoLabel:w.name+" "+(i+1),
          fix:improvementText(f)
        });
      });
    }
    out=out.concat(detailSheets({
      label:pad2(wi+1)+" "+w.name,
      kicker:pad2(wi+1)+" · 작업점검",
      title:w.name,
      sideKicker:"점검 체크리스트 · "+pad2(wi+1),
      sideTitle:w.name,
      sideItems:sideItems,
      sideFoot:"«미흡» 문항만 오른쪽에 사진·개선방향과 함께 싣습니다.",
      cards:cards,
      lead:'<b>위험등급 '+esc(g[0])+'</b> — '+esc(g[2])
        +(w.name==="입고·하차"&&inboundFacts(s)?'<br>'+esc(inboundFacts(s)):""),
      soloBadge:"이 유형은 미흡 "+cards.length+"건 · 단독 페이지",
      footerText:"작업점검 "+pad2(wi+1)+" "+w.name
    }));
  });
  return out;
}

/* ============================================================
   챕터 02 · 사다리 (항상 노출)
   구분장 → 보유현황(항상) → 이상항목 상세
   ============================================================ */
function ladderChapter(s){
  var counts=(s.ladder&&s.ladder.counts)||{};
  var typeStatus=(s.ladder&&s.ladder.typeStatus)||{};
  var ladderF=findingsOf(s,"사다리");
  var owned=highRiskOwned(s);
  var total=LADDER_ORDER.reduce(function(a,t){return a+Number(counts[t]||0)},0);
  var out=[];

  out.push(chapterSheet({
    no:"02",key:"ladder",title:"사다리",
    sub:[{i:"01",text:"사다리 보유현황",tag:total?total+"대":"미보유",cls:total?"":"na"},
         {i:"02",text:"사다리 이상항목",tag:ladderF.length?"미흡 "+ladderF.length+"건":"양호",cls:ladderF.length?"bad":""}],
    counts:[{label:"보유 대수",value:total+"대"},
            {label:"고위험 유형",value:owned.length+"종",bad:owned.length>0},
            {label:"이상항목",value:ladderF.length+"건",bad:ladderF.length>0}],
    note:'<b>이상항목이 없어도 항상 표시되는 챕터입니다.</b> 구형 사다리(검정)·A형은 보유 자체가 떨어짐 위험에 노출된 것으로 보기 때문에, '
      +'이상항목 유무와 별개로 보유현황을 반드시 함께 확인합니다.'
      +(owned.length?'<br>이 매장은 고위험 유형 <b>'+esc(owned.join(", "))+'</b>을 보유하고 있습니다.':'<br>이 매장은 고위험 유형을 보유하지 않았습니다.'),
    foot:"고위험 유형(구형 검정·A형)은 사용 전 발판·체결상태 점검 필수"
  }));

  /* 보유현황 장 — 유형별 한 줄이 페이지 높이를 나눠 채우므로 아래 여백이 생기지 않는다. */
  var h='<div class="sr-ladder2">';
  LADDER_ORDER.forEach(function(t){
    var n=Number(counts[t]||0),stt=typeStatus[t]||"";
    var mine=ladderF.filter(function(f){return f.area===t});
    var cls=n<=0?"off":((stt==="bad"||mine.length)?"bad":"");
    var note=n<=0?"미보유":(mine.length?"이상 "+mine.length+"건":"양호");
    h+='<div class="'+cls+'"><small>'+esc(t)+(LADDER_HIGH_RISK.indexOf(t)>=0?" ⚠":"")+'</small><b>'+n+'</b><i>대 · '+esc(note)+'</i></div>';
  });
  h+='</div>';
  if(owned.length){
    h+='<div class="sr-note"><b>고위험 유형 보유</b> — '+esc(owned.join(", "))
      +'. 반복 파손이 확인된 유형이므로 사용 전 발판·체결상태 점검을 일상점검에 포함하고 교체계획을 함께 검토해 주세요.</div>';
  }else{
    h+='<div class="sr-note info">고위험 유형(구형 사다리(검정)·A형)을 보유하지 않아 떨어짐 위험 노출이 낮습니다.</div>';
  }
  h+='<div class="sr-sum-title">유형별 상태 <em>'+(ladderF.length?"이상 "+ladderF.length+"건":"전 유형 양호")+'</em></div>';
  h+='<div class="sr-sum-rows">';
  LADDER_ORDER.forEach(function(t){
    var n=Number(counts[t]||0);
    var mine=ladderF.filter(function(f){return f.area===t});
    var desc=n<=0?"보유하지 않은 유형입니다."
      :(mine.length?mine.map(function(f){return f.title}).join(" · ")+" 확인"
        :"보유 "+n+"대 전부 양호로 확인되었습니다."+(LADDER_HIGH_RISK.indexOf(t)>=0?" 다만 고위험 유형이므로 사용 전 점검이 필요합니다.":""));
    h+='<div class="sr-sum-row '+(mine.length?"bad":"good")+'"><b>'+esc(t)+'</b><span>'+esc(desc)+'</span>'
      +'<span class="sr-cnt">'+n+'대</span>'+photoBox(firstPhotoOf(mine),t,n?"사진 없음":"미보유")+'</div>';
  });
  h+='</div>';
  out.push(pageSheet("사다리 보유현황","LADDER INVENTORY · 항상 노출","사다리 보유현황",h,
    "보유현황은 이상항목이 없어도 항상 표시됩니다"));

  if(ladderF.length){
    out=out.concat(detailSheets({
      label:"사다리 이상",
      kicker:"02 · 사다리",
      title:"사다리 이상항목",
      sideKicker:"사다리 유형별 상태",
      sideTitle:"보유 "+total+"대",
      sideItems:LADDER_ORDER.map(function(t){
        var n=Number(counts[t]||0);
        var mine=ladderF.filter(function(f){return f.area===t});
        return {text:t+" ("+n+"대)",state:n<=0?"na":(mine.length?"bad":"good")};
      }),
      sideFoot:"⚠ 구형 사다리(검정)·A형은 보유 자체가 고위험 유형입니다.",
      cards:ladderF.map(function(f){
        var g=findingRiskGrade(s,f);
        return {
          sideIndex:LADDER_ORDER.indexOf(f.area),
          num:"이상항목 · 위험 "+g[0],
          title:f.area+" "+f.title,
          answer:f.note||"떨어짐 위험",
          meta:g[2],
          photos:f.photos,hazards:f.hazards,
          photoLabel:f.area,
          fix:improvementText(f)
        };
      }),
      soloBadge:"이상항목 1건 · 단독 페이지",
      footerText:"사다리 이상항목은 사용 중지 후 조치"
    }));
  }
  return out;
}

/* ============================================================
   챕터 03·04·05 · 공통·시설 / 소방 / TBM
   구분장(전체 항목 + 양호/미흡) → 미흡 항목만 상세
   ============================================================ */
var CHECKLIST_META={
  common:{no:"03",title:"공통·시설",kicker:"COMMON & FACILITY",foot:"시설 이상은 사용 전 안전상태 확인 후 조치"},
  fire:{no:"04",title:"소방",kicker:"FIRE SAFETY",foot:"소방설비는 화재 시 대피에 직결 · 즉시 조치 대상"},
  tbm:{no:"05",title:"TBM",kicker:"TBM",foot:"TBM은 실시 여부와 함께 근로자 인지 여부를 교차확인"}
};
function checklistChapter(s,k){
  var meta=CHECKLIST_META[k];
  var items=((s.checklists||{})[k])||[];
  var list=findingsOf(s,meta.title);
  var out=[];

  /* 스냅샷에 전체 항목이 없으면(예전 캐시) 미흡목록만으로 대체한다. */
  if(!items.length&&list.length){
    items=list.map(function(f){return {name:f.title,state:"bad",note:f.note||"",photos:f.photos}});
  }
  var bad=items.filter(function(x){return x.state==="bad"});
  var na=items.filter(function(x){return x.state==="na"});
  var extraNote="";
  if(k==="tbm"){
    var gap=s.tbmStretchGap;
    extraNote='확인방법 «'+esc(s.tbmConfirmMethod||"-")+'»'
      +(activeTbmTime(s)?" · 실시시각 "+esc(activeTbmTime(s)):"")
      +(gap&&gap.gapMinutes>0?'<br><b>입고작업이 스트레칭(TBM)보다 '+gap.gapMinutes+'분 먼저 시작됩니다.</b> 스트레칭 없이 중량물 작업이 이뤄지고 있습니다.':"");
    if(unsharedAccidentVoices(s).length){
      extraNote+='<br>근로자 '+unsharedAccidentVoices(s).length+'건이 과거 사고사례를 «안내받지 못함»으로 응답했습니다.';
    }
  }
  out.push(chapterSheet({
    no:meta.no,key:k,title:meta.title,kicker:meta.kicker,
    sub:items.map(function(x,i){
      return {i:pad2(i+1),text:x.name,
        tag:x.state==="bad"?"미흡":(x.state==="na"?"해당없음":"양호"),
        cls:x.state==="bad"?"bad":(x.state==="na"?"na":"")};
    }),
    good:bad.length?"":"전 항목 양호",
    note:(bad.length?'<b>미흡 '+bad.length+'건만 상세 페이지로 싣습니다.</b> 나머지 항목은 위 목록의 «양호» 표기로 확인하시면 됩니다.':"")
      +(na.length?(bad.length?'<br>':"")+'해당 설비가 없어 «해당 없음»으로 기록한 항목 '+na.length+'건은 점수에서 제외됩니다.':"")
      +(extraNote?((bad.length||na.length)?'<br>':"")+extraNote:""),
    foot:meta.foot
  }));

  if(bad.length){
    out=out.concat(detailSheets({
      label:meta.title,
      kicker:meta.no+" · "+meta.title,
      title:meta.title+" 미흡사항",
      sideKicker:"점검 체크리스트 · "+meta.no,
      sideTitle:meta.title+" "+items.length+"항목",
      sideItems:items.map(function(x){return {text:x.name,state:x.state}}),
      sideFoot:"«미흡» 항목만 오른쪽에 사진·개선방향과 함께 싣습니다.",
      cards:bad.map(function(x){
        var f=list.filter(function(y){return y.title===x.name})[0]||{category:meta.title,title:x.name,hazards:[],photos:x.photos};
        var g=findingRiskGrade(s,f);
        return {
          sideIndex:items.indexOf(x),
          num:"미흡 · 위험 "+g[0],
          title:x.name,
          answer:x.note||f.note||"현장에서 미흡 확인",
          meta:g[2],
          photos:x.photos&&x.photos.length?x.photos:f.photos,
          hazards:f.hazards,
          photoLabel:meta.title+" "+x.name,
          fix:improvementText({category:meta.title,title:x.name,hazards:f.hazards})
        };
      }),
      soloBadge:"미흡 1건 · 단독 페이지",
      footerText:meta.foot
    }));
  }
  return out;
}

/* ============================================================
   챕터 06 · 근로자 의견청취
   구분장 → 양호하지 않은 응답만 상세(근로자별). 사진이 없으므로 인용 박스로 높이를 채운다.
   ============================================================ */
function voiceChapter(s){
  var detail=s.voiceDetail||[];
  var voices=s.workerOpinions||[];
  var out=[];
  var unshared=unsharedAccidentVoices(s);

  /* 구분장 하위목록: 근로자별 양호/미흡 응답 수 */
  var sub=detail.length?detail.map(function(d,i){
    var badN=d.answers.filter(function(a){return a.answered&&!a.good}).length;
    return {i:pad2(i+1),text:"근로자 "+d.worker,tag:badN?"미흡 응답 "+badN+"건":"전 문항 양호",cls:badN?"bad":""};
  }):[{i:"01",text:"근로자 의견 응답",tag:voices.length?"미흡 응답 "+voices.length+"건":"전 문항 양호",cls:voices.length?"bad":""}];

  out.push(chapterSheet({
    no:"06",key:"voice",title:"근로자 의견청취",kicker:"WORKER VOICE",
    sub:sub,
    good:voices.length?"":"전 문항 양호 응답",
    counts:[{label:"참여 근로자",value:(detail.length||0)+"명"},
            {label:"양호하지 않은 응답",value:voices.length+"건",bad:voices.length>0},
            {label:"사고사례 안내 미인지",value:unshared.length+"건",bad:unshared.length>0}],
    note:'의견은 이름·사번 없이 <b>익명</b>으로 수집합니다.'
      +(voices.length?'<br>양호하지 않은 응답 '+voices.length+'건만 상세 페이지로 싣습니다.':"")
      +(unshared.length?'<br><b>과거 사고사례를 안내받지 못했다는 응답이 '+unshared.length+'건</b> 있습니다. TBM 공유가 실제로 도달하는지 확인이 필요합니다.':""),
    foot:"근로자 의견은 익명 수집 · 관리자 점검결과와 교차확인"
  }));

  if(detail.length){
    detail.forEach(function(d){
      var cards=[];
      d.answers.forEach(function(a,qi){
        if(!a.answered||a.good)return;
        cards.push({
          sideIndex:qi,num:"문항 "+(qi+1),
          title:a.q,
          quote:a.answer||"응답 확인",
          quoteSub:"근로자 "+d.worker+" 응답 · 익명 수집",
          fix:/사고사례/.test(a.q)
            ?"TBM에서 과거 사고사례를 실제로 공유하고 있는지 직접참관으로 확인합니다."
            :"근로자가 지적한 내용을 현장에서 확인해 작업방법·시설·안내체계를 보완합니다."
        });
      });
      if(!cards.length)return;
      out=out.concat(detailSheets({
        label:"근로자"+d.worker+" 의견",
        kicker:"06 · 근로자 의견청취",
        title:"근로자 "+d.worker+" 응답",
        sideKicker:"의견청취 문항 · 근로자 "+d.worker,
        sideTitle:d.answers.length+"문항",
        sideItems:d.answers.map(function(a){
          return {text:a.q,state:!a.answered?"na":(a.good?"good":"bad")};
        }),
        sideFoot:"첫 번째 보기가 가장 양호한 응답입니다. 다르게 답한 문항만 상세로 싣습니다.",
        cards:cards,
        soloBadge:"이 근로자 미흡 응답 1건 · 단독 페이지",
        footerText:"근로자 의견은 이름·사번 없이 익명으로 수집"
      }));
    });
  }else if(voices.length){
    /* 예전 캐시 대비: 근로자별 전 문항이 없으면 미흡 응답만으로 만든다. */
    out=out.concat(detailSheets({
      label:"근로자 의견",
      kicker:"06 · 근로자 의견청취",
      title:"양호하지 않은 응답",
      sideKicker:"의견청취 응답",
      sideTitle:voices.length+"건",
      sideItems:voices.map(function(o){return {text:o.question,state:"bad"}}),
      cards:voices.map(function(o,i){
        return {sideIndex:i,num:"근로자 "+o.worker,title:o.question,
          quote:o.answer,quoteSub:"익명 수집",
          fix:"근로자가 지적한 내용을 현장에서 확인해 작업방법·시설·안내체계를 보완합니다."};
      }),
      soloBadge:"미흡 응답 1건 · 단독 페이지",
      footerText:"근로자 의견은 이름·사번 없이 익명으로 수집"
    }));
  }
  return out;
}

/* ============================================================
   챕터 07 · 기타사항 (점검자가 정해진 문항 외로 기록한 특이사항)
   ============================================================ */
function otherChapter(s){
  var list=findingsOf(s,"기타사항");
  var out=[chapterSheet({
    no:"07",key:"other",title:"기타사항",kicker:"INSPECTOR NOTE",
    sub:list.length?list.map(function(f,i){return {i:pad2(i+1),text:f.title,tag:"확인",cls:"bad"}})
      :[{i:"01",text:"점검자 기타 특이사항",tag:"없음",cls:"na"}],
    good:list.length?"":"등록된 기타 특이사항 없음",
    note:list.length?'<b>정해진 문항 외에 점검자가 현장에서 확인한 특이사항 '+list.length+'건입니다.</b>':"",
    foot:"기타사항은 개선과제 후보로 검토 후 차기 점검에서 재확인"
  })];
  if(list.length){
    out=out.concat(detailSheets({
      label:"기타사항",
      kicker:"07 · 기타사항",
      title:"점검자 기타 특이사항",
      sideKicker:"기타사항 목록",
      sideTitle:list.length+"건",
      sideItems:list.map(function(f){return {text:f.title,state:"bad"}}),
      sideFoot:"정해진 문항 외 현장 특이사항입니다.",
      cards:list.map(function(f,i){
        var g=findingRiskGrade(s,f);
        return {sideIndex:i,num:"기타 "+(i+1)+" · 위험 "+g[0],
          title:f.title,answer:f.note||"현장 확인 특이사항",meta:g[2],
          photos:f.photos,hazards:f.hazards,photoLabel:"기타 "+(i+1),
          fix:improvementText(f)};
      }),
      soloBadge:"기타사항 1건 · 단독 페이지",
      footerText:"기타사항은 개선과제 후보로 검토"
    }));
  }
  return out;
}

/* ============================================================
   챕터 08 · 지난 지적사항 조치확인
   구분장 → 1건/페이지(과거 지적사진 ↔ 조치 후 사진 좌우 배치)
   전·후 사진 2장이 나란히 들어가야 하므로 이 챕터만 1건/페이지다.
   사진이 높이를 flex로 흡수하므로 여백은 생기지 않는다.
   ============================================================ */
function taskChapter(s){
  var list=s.tasks||[];
  var done=list.filter(function(t){return t.status==="조치완료"}).length;
  var unseen=list.filter(function(t){return t.notObserved}).length;
  var open=list.length-done-unseen;
  var out=[chapterSheet({
    no:"08",key:"task",title:"지난 지적사항 조치확인",kicker:"FOLLOW-UP",
    sub:list.length?list.map(function(t,i){
      return {i:pad2(i+1),text:t.title,
        tag:t.notObserved?"확인 못함":(t.status==="조치완료"?"조치완료":"미조치"),
        cls:t.notObserved?"na":(t.status==="조치완료"?"":"bad")};
    }):[{i:"01",text:"지난 점검에서 남은 지적사항",tag:"없음",cls:"na"}],
    good:list.length?"":"지난 지적사항 없음",
    counts:list.length?[{label:"확인 대상",value:list.length+"건"},
            {label:"조치완료",value:done+"건"},
            {label:"미조치",value:open+"건",bad:open>0},
            {label:"확인 못함",value:unseen+"건",bad:unseen>0}]:null,
    note:list.length?'미조치·확인 못함 항목은 다음 방문에 다시 표시됩니다.':"",
    foot:"조치완료 여부는 조치 후 사진으로 확인"
  })];
  list.slice().sort(function(a,b){
    function rank(t){return t.notObserved?1:(t.status==="조치완료"?0:2)}
    return rank(b)-rank(a);
  }).forEach(function(t,i){
    var cls=t.notObserved?"warn":(t.status==="조치완료"?"done":"");
    var badge=t.notObserved?"확인 못함":(t.status||"미조치");
    var h='<div class="sr-main-lead"><b>'+esc(badge)+'</b> · 최초 지적 '+esc(dateDot(t.date))
      +(t.currentState&&t.currentState!==t.title?' · 현재 상태: '+esc(t.currentState):"")+'</div>';
    h+='<div class="sr-ba">'
      +'<div class="sr-ba-col"><small>과거 지적 당시</small>'
      +'<div class="sr-qphoto">'+photoBox(t.beforePhotos,"과거 지적","첨부된 과거 사진 없음")+'</div>'
      +'<p>'+esc(t.title)+'</p></div>'
      +'<div class="sr-ba-col"><small>'+(t.status==="조치완료"?"조치 후":"이번 방문 확인")+'</small>'
      +'<div class="sr-qphoto">'+photoBox(t.afterPhotos,t.status==="조치완료"?"조치 후":"현재 상태",
          t.notObserved?"이번 방문에 확인하지 못함":(t.status==="조치완료"?"첨부된 조치 후 사진 없음":"미조치 · 조치 후 사진 없음"))+'</div>'
      +'<p>'+esc(t.notObserved?"이번 방문에 확인하지 못했습니다. 미조치로 유지되어 다음 방문에 다시 확인합니다."
          :((t.status==="조치완료"?"조치내용: ":"조치계획: ")+(t.actionText||"-")))+'</p></div>'
      +'</div>';
    out.push(pageSheet("조치확인"+(i+1),"08 · 조치확인 "+(i+1)+" / "+list.length,
      t.title,h,"미조치 항목은 다음 방문에 다시 확인"));
  });
  return out;
}

/* ============================================================
   챕터 09 · 사고조사 (항상 노출)
   구분장 → 사고이력 요약(항상) → 사고 1건/페이지
   ============================================================ */
function accidentChapter(s){
  var list=s.accidents||[];
  var open=list.filter(function(a){return a.status==="미조치"}).length;
  var unseen=list.filter(function(a){return a.status==="확인 못함"}).length;
  var out=[];

  out.push(chapterSheet({
    no:"09",key:"accident",title:"사고조사",kicker:"ACCIDENT PREVENTION",
    sub:list.length?list.map(function(a,i){
      return {i:pad2(i+1),text:(a.type||"사고")+" · "+dateDot(a.date),
        tag:a.status||"확인 전",
        cls:a.status==="조치완료"?"":(a.status==="확인 못함"?"na":"bad")};
    }):[{i:"01",text:"과거 사고이력",tag:"없음",cls:"na"}],
    counts:[{label:"사고이력",value:list.length+"건"},
            {label:"미조치",value:open+"건",bad:open>0},
            {label:"확인 못함",value:unseen+"건",bad:unseen>0}],
    note:'<b>이력이 없어도 항상 표시되는 챕터입니다.</b> 과거 사고가 있으면 조치완료 여부와 무관하게 재발방지 확인 차원에서 이력 요약을 항상 함께 보여줍니다.'
      +(list.length?"":'<br>이 매장은 등록된 과거 사고이력이 없습니다. (출퇴근 재해는 사고조사 대상에서 제외)'),
    foot:"출퇴근 재해는 사고조사 대상에서 제외"
  }));

  /* 이력 요약 장 — 이력이 0건이어도 만든다(항상 노출 규칙). */
  var h="";
  /* 사고가 많으면 카드 요약을 접고 아래 표만 남긴다(한 장을 넘기지 않게 하려는 것). */
  if(list.length&&list.length<=4){
    h+='<div class="sr-acc-hist">';
    list.slice().sort(function(a,b){return rankAccident(b)-rankAccident(a)}).slice(0,4).forEach(function(a){
      var cls=a.status==="조치완료"?"done":(a.status==="확인 못함"?"warn":"");
      h+='<div class="sr-acc-card"><div class="sr-acc-top"><span>'+esc(a.type||"사고")+' · '+esc(dateDot(a.date))+'</span>'
        +'<em class="'+cls+'">'+esc(a.status||"확인 전")+'</em></div>'
        +'<p>'+esc(a.content||"등록된 사고내용이 없습니다.")+'</p></div>';
    });
    h+='</div>';
    if(open){
      h+='<div class="sr-note"><b>미조치 '+open+'건 재확인 필요</b> — 재발방지 조치가 확인되지 않은 사고입니다. '
        +'이번 점검에서 확인된 같은 재해유형의 미흡사항과 함께 조치해 주세요.</div>';
    }else{
      h+='<div class="sr-note info">등록된 사고 전 건이 조치완료로 확인되었습니다. 동일 유형 재발 여부를 차기 점검에서 계속 확인합니다.</div>';
    }
  }
  h+='<div class="sr-sum-title">사고이력 상세요약 <em>'+(list.length?list.length+"건":"이력 없음")+'</em></div>';
  h+='<div class="sr-sum-rows">';
  if(!list.length){
    h+='<div class="sr-sum-row good"><b>사고이력</b><span>등록된 과거 사고이력이 없습니다. 출퇴근 재해는 사고조사 대상에서 제외됩니다. '
      +'이력이 없어도 이 챕터는 재발방지 확인 목적으로 항상 표시됩니다.</span>'
      +'<span class="sr-cnt">0건</span>'+photoBox([],"사고이력","해당 없음")+'</div>';
  }else{
    list.slice().sort(function(a,b){return rankAccident(b)-rankAccident(a)}).forEach(function(a){
      var bad=a.status==="미조치"||a.riskLevel==="상";
      h+='<div class="sr-sum-row '+(bad?"bad":"good")+'"><b>'+esc(a.type||"사고")+'</b>'
        +'<span>'+esc(dateDot(a.date))+" · 기인물 "+esc(a.source||"미등록")
        +" · 위험등급 "+esc(a.riskLevel||"-")+" · "+esc(a.status||"확인 전")
        +(a.hazardText?" · "+esc(a.hazardText):"")+'</span>'
        +'<span class="sr-cnt">'+esc(a.riskLevel||"-")+'</span>'
        +photoBox((a.beforePhotos||[]).concat(a.afterPhotos||[]),a.type||"사고","사진 없음")+'</div>';
    });
  }
  h+='</div>';
  out.push(pageSheet("사고이력 요약","ACCIDENT · 항상 노출","사고이력 및 재발방지",h,
    "사고이력은 조치완료 여부와 무관하게 항상 표시"));

  /* 사고 1건씩 상세 (조치 전·후 사진 좌우) */
  list.slice().sort(function(a,b){return rankAccident(b)-rankAccident(a)}).forEach(function(a,i){
    var h2='<div class="sr-main-lead"><b>'+esc(a.status||"확인 전")+' · 위험등급 '+esc(a.riskLevel||"-")+'</b> · '
      +esc(dateDot(a.date))+' · 기인물 '+esc(a.source||"미등록")+(a.approved==="Y"?" · 산재승인":"")
      +'<br>'+esc(a.content||"등록된 사고내용이 없습니다.")+'</div>';
    h2+='<div class="sr-ba">'
      +'<div class="sr-ba-col"><small>조치 전 · 현재 상태</small>'
      +'<div class="sr-qphoto">'+photoBox(a.beforePhotos,"조치 전","첨부된 조치 전 사진 없음")+'</div>'
      +'<p>유해위험요인: '+esc(a.hazardText||"-")+'</p></div>'
      +'<div class="sr-ba-col"><small>'+(a.status==="조치완료"?"조치 후":"조치계획")+'</small>'
      +'<div class="sr-qphoto">'+photoBox(a.afterPhotos,"조치 후",
          a.status==="조치완료"?"첨부된 조치 후 사진 없음":"미조치 · 조치 후 사진 없음")+'</div>'
      +'<p>'+esc((a.status==="조치완료"?"재발방지 조치: ":"조치계획: ")+(a.actionText||"-"))+'</p></div>'
      +'</div>';
    var lb=s.inboundLabor;
    if(lb&&lb.level!=="good"&&/근골격|무리한|중량/.test((a.type||"")+(a.content||"")+(a.hazardText||""))){
      h2+='<div class="sr-note"><b>이번 점검의 입고 인력부담 측정값과 직접 연결됩니다.</b> '
        +'평균 투입인원 '+lb.avgPeople+'명, 도우미 공백비율 '+lb.gapRatioPct+'%로 '
        +(lb.level==="severe"?"위험(심각)":"위험(경미)")+' 판정되었습니다.</div>';
    }
    out.push(pageSheet("사고 "+(i+1),"09 · 사고조사 "+(i+1)+" / "+list.length,
      (a.type||"사고")+" · "+dateDot(a.date),h2,"출퇴근 재해는 사고조사 대상에서 제외"));
  });
  return out;
}

/* ============================================================
   챕터 10 · 개선조치 계획 (마지막 장)
   ============================================================ */
function planChapter(s){
  var pr=buildPriorities(s);
  var out=[chapterSheet({
    no:"10",key:"plan",title:"개선조치 계획",kicker:"ACTION PLAN",
    sub:pr.length?pr.map(function(p,i){return {i:pad2(i+1),text:p.key,tag:p.status,cls:p.status==="즉시조치"?"bad":""}})
      :[{i:"01",text:"별도 조치계획",tag:"없음",cls:"na"}],
    good:pr.length?"":"별도 조치가 필요한 항목 없음",
    note:pr.length?'담당·기한은 매장 협의 후 확정합니다. 조치 완료 후 차기 점검에서 이행 여부를 재확인합니다.':"",
    foot:esc(s.store.name)+" · "+esc(dateDot(s.store.date))
  })];
  var h="";
  if(!pr.length){
    h+='<div class="sr-note info">별도 조치계획이 필요한 항목이 없습니다. 현재 관리상태를 유지해 주세요.</div>'
      +'<div class="sr-plan-fill"></div>';
  }else{
    h+='<div class="sr-plan-rows">';
    pr.forEach(function(p,i){
      var owner=p.status==="즉시조치"?"담당: 매장 자체조치 + 부서 협의 · 기한: 즉시"
              :(p.status==="확인필요"?"담당: 점검자 재확인 · 기한: 차기 방문":"담당: 매장 자체조치 · 기한: 7일 이내");
      h+='<div class="sr-plan-row"><i>'+pad2(i+1)+'</i><div><b>'+p.title+'</b><small>'+p.detail+'</small>'
        +'<small>'+esc(owner)+'</small></div>'
        +'<span class="sr-status '+p.cls+'">'+esc(p.status)+'</span></div>';
    });
    h+='<div class="sr-plan-fill"></div></div>';
  }
  out.push(pageSheet("조치계획","ACTION PLAN","개선조치 계획",h,"조치 완료 후 차기 점검에서 이행 여부를 재확인"));
  return out;
}

/* ============================================================
   지적사항 재점검 전용 모드
   전체 체크리스트를 실시한 것이 아니므로 종합점수·분야별 양호판정을 만들지 않고,
   확인한 지적사항만 표지 + 요약 + 상세로 출력한다.
   ============================================================ */
function buildFollowupOnly(s){
  var list=s.tasks||[];
  var done=list.filter(function(t){return t.status==="조치완료"}).length;
  var unseen=list.filter(function(t){return t.notObserved}).length;
  var open=list.length-done-unseen;
  var out=[];

  out.push(sheet("표지",'<div class="sr-cover2">'
    +'<small class="sr-cover2-kicker">FOLLOW-UP ONLY REPORT</small>'
    +'<h1>지난 지적사항<br>재점검 결과보고서</h1>'
    +'<p class="sr-cover2-sub">전체 체크리스트 미실시 · 지적사항만 재확인</p>'
    +'<div class="sr-cover2-rule"></div>'
    +'<div class="sr-cover2-verdict"><small>재점검 결과</small>'
    +'<b>확인 '+list.length+'건 중 조치완료 '+done+'건</b>'
    +'<p>미조치 '+open+'건, 확인 못함 '+unseen+'건입니다. 미조치·확인 못함 항목은 다음 방문에 다시 표시됩니다.</p></div>'
    +'<div class="sr-cover2-meta">'
    +'<div>매장<b>'+esc(s.store.name)+'</b></div>'
    +'<div>점검일<b>'+esc(dateDot(s.store.date)||"-")+'</b></div>'
    +'<div>점검자<b>'+esc(s.store.inspector||"-")+'</b></div>'
    +'<div>기준 점검<b>'+esc(s.sourceInspectionId||"-")+'</b></div>'
    +'</div></div>'));

  var h='<div class="sr-sum-title">항목별 확인 결과 <em>'+list.length+'건</em></div><div class="sr-sum-rows">';
  if(!list.length){
    h+='<div class="sr-sum-row good"><b>재점검 대상</b><span>재점검 대상 지적사항이 없습니다.</span>'
      +'<span class="sr-cnt">0건</span>'+photoBox([],"대상","해당 없음")+'</div>';
  }else{
    list.forEach(function(t){
      var bad=!t.notObserved&&t.status!=="조치완료";
      h+='<div class="sr-sum-row '+(bad?"bad":"good")+'"><b>'+esc(t.notObserved?"확인 못함":(t.status||"미조치"))+'</b>'
        +'<span>'+esc(t.title)+' · 최초 지적 '+esc(dateDot(t.date))+'</span>'
        +'<span class="sr-cnt">'+esc(t.notObserved?"—":(t.status==="조치완료"?"완료":"미조치"))+'</span>'
        +photoBox((t.afterPhotos||[]).concat(t.beforePhotos||[]),t.title,"사진 없음")+'</div>';
    });
  }
  h+='</div>';
  out.push(pageSheet("재점검 요약","FOLLOW-UP SUMMARY","지난 지적사항 재점검 결과",h,
    "전체 체크리스트 미실시 · 지적사항만 재확인"));

  /* 상세는 본 보고서와 같은 형태(전·후 사진 좌우)로 만든다. */
  taskChapter(s).slice(1).forEach(function(x){out.push(x)});
  return out;
}

/* ============================================================
   전체 조립
   ============================================================ */
function buildSheets(s){
  var list=[];

  if(s.followupOnly){
    list=buildFollowupOnly(s);
  }else{
    /* 각 챕터를 만들고 나서 목차를 만든다(목차에 건수·시작페이지를 넣기 위함). */
    var chapters=[
      {key:"summary",no:"00",title:"점검결과 요약",sheets:chapterSummary(s),
       tocTag:tagOf((s.findings||[]).length,"미흡 "+(s.findings||[]).length+"건","양호")},
      {key:"work",no:"01",title:"작업점검",sheets:workChapter(s),
       tocTag:tagOf(findingsOf(s,"작업점검").length,"미흡 "+findingsOf(s,"작업점검").length+"건","전 유형 양호")},
      {key:"ladder",no:"02",title:"사다리",sheets:ladderChapter(s),
       tocTag:tagOf(findingsOf(s,"사다리").length,"이상 "+findingsOf(s,"사다리").length+"건",
              highRiskOwned(s).length?"고위험 보유":"양호",highRiskOwned(s).length>0)},
      {key:"common",no:"03",title:"공통·시설",sheets:checklistChapter(s,"common"),
       tocTag:tagOf(findingsOf(s,"공통·시설").length,"미흡 "+findingsOf(s,"공통·시설").length+"건","양호")},
      {key:"fire",no:"04",title:"소방",sheets:checklistChapter(s,"fire"),
       tocTag:tagOf(findingsOf(s,"소방").length,"미흡 "+findingsOf(s,"소방").length+"건","양호")},
      {key:"tbm",no:"05",title:"TBM",sheets:checklistChapter(s,"tbm"),
       tocTag:tagOf(findingsOf(s,"TBM").length,"미흡 "+findingsOf(s,"TBM").length+"건","양호")},
      {key:"voice",no:"06",title:"근로자 의견청취",sheets:voiceChapter(s),
       tocTag:tagOf((s.workerOpinions||[]).length,(s.workerOpinions||[]).length+"건","양호")},
      {key:"other",no:"07",title:"기타사항",sheets:otherChapter(s),
       tocTag:tagOf(findingsOf(s,"기타사항").length,findingsOf(s,"기타사항").length+"건","없음")},
      {key:"task",no:"08",title:"지난 지적사항 조치확인",sheets:taskChapter(s),
       tocTag:tagOf((s.tasks||[]).filter(function(t){return t.status!=="조치완료"}).length,
              "미조치 "+(s.tasks||[]).filter(function(t){return t.status!=="조치완료"}).length+"건",
              (s.tasks||[]).length?"전 건 완료":"없음")},
      {key:"accident",no:"09",title:"사고조사",sheets:accidentChapter(s),
       tocTag:tagOf((s.accidents||[]).filter(function(a){return a.status==="미조치"}).length,
              "미조치 "+(s.accidents||[]).filter(function(a){return a.status==="미조치"}).length+"건",
              (s.accidents||[]).length?"전 건 완료":"이력 없음")},
      {key:"plan",no:"10",title:"개선조치 계획",sheets:planChapter(s),
       tocTag:tagOf(buildPriorities(s).length,buildPriorities(s).length+"건","없음")}
    ];
    list.push(sheetCover(s));
    list.push(sheetToc(s,chapters));
    chapters.forEach(function(c){ c.sheets.forEach(function(x){list.push(x)}) });
  }

  /* 페이지 번호 치환 (전체 장수가 확정된 뒤) */
  var total=list.length;
  var tocPages={};
  list.forEach(function(x,i){
    x.no=i+1;
    if(x.tocKey)tocPages[x.tocKey]=i+1;
  });
  list.forEach(function(x,i){
    var no=pad2(i+1)+" / "+pad2(total);
    x.html=x.html.split(NO).join(no);
    /* 목차의 시작 페이지 표시 치환 */
    Object.keys(tocPages).forEach(function(k){
      x.html=x.html.split(tocMark(k)).join(String(tocPages[k]));
    });
    /* 혹시 남은 표시(챕터가 만들어지지 않은 경우)는 '-'로 지운다 */
    x.html=x.html.replace(/__SR_TOC_[a-zA-Z]+__/g,"-");
  });
  return list;
}
function tagOf(count,badText,goodText,forceBad){
  return count>0||forceBad?{text:badText,cls:"bad"}:{text:goodText,cls:"good"};
}

window.buildReportSheets=function(s){ return (!s||!s.store)?[]:buildSheets(s); };

/* app.js의 PDF 캡처가 쓰는 함수. 모든 장의 HTML을 이어붙여 돌려준다. */
function buildReportPages(s){
  if(!s||!s.store)return "";
  return buildSheets(s).map(function(x){
    return '<section class="sr-sheet" data-sheet="'+x.no+'">'+x.html+'</section>';
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
  var nav='<div class="sr-toolbar"><strong>'+esc(s.store.name)+' 안전보건 현장진단 결과보고서 · '+sheets.length+'장</strong>'
    +'<div class="sr-pages" aria-label="보고서 페이지 선택">'
    +sheets.map(function(x,i){
      return '<button class="sr-page-btn" aria-pressed="'+(i===0?"true":"false")+'" data-page="'+x.no+'">'+esc(x.label)+'</button>';
    }).join("")
    +'<button class="sr-print-btn" onclick="window.print()">PDF/인쇄</button>'
    +'</div></div>';

  deck.innerHTML=nav+sheets.map(function(x,i){
    return '<section class="sr-sheet'+(i===0?" active":"")+'" data-sheet="'+x.no+'">'+x.html+'</section>';
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
