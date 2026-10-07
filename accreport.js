/**
 * accreport.js — 팀 사고현황 «A4 세로 1장» 보고서
 *
 * 쓰는 곳
 *   메뉴 > 사고 이력 > 매장 상세 > [1장 보고서]
 *   매장 점검을 나가서 담당자에게 «우리 팀에 이런 사고가 있었다»를 종이로 보여 준다.
 *
 * 왜 한 장인가
 *   현장에서 담당자와 서서 보는 자료다. 넘기면 안 읽는다.
 *   그래서 794x1123px(A4 세로를 96dpi 로 환산) 안에 반드시 들어가게 만든다.
 *   사례 건수가 많아 넘치면 app.js 의 buildAccidentReportPdf 가 건수를 줄여 다시 그린다.
 *
 * 숫자와 문구의 출처가 다르다 (중요)
 *   숫자(건수·비율·손실일수)  : 사고 원장 집계
 *   «주의할 점» 문구          : 재해유형별_대책문구표.xlsx → measures.js
 *   그래서 대책이 «앱이 임의로 만든 것»이 아니다. 문구가 어색하면 엑셀만 고치면 된다.
 *
 * 개인정보
 *   원장에는 재해자명·주민번호가 있지만 **매장에 전달되는 문서라 출력하지 않는다.**
 *   재해일 / 매장 / 유형 / 기인물 / 사고내용 / 승인여부만 쓴다.
 *
 * 스타일은 style.css 의 «.ar-page» 블록에 있다(PDF 캡처 때 이미 로드되어 있어야 하므로).
 */
(function(){
  'use strict';

  function esc(x){
    return String(x==null?'':x).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function num(v){var n=Number(v);return isFinite(n)?n:0}

  /* {범위} 에 들어갈 말. 엑셀 «읽어보기» 시트에 적어 둔 예시와 같게 만든다. */
  function scopeWord(ctx){
    return ctx.level==='t' ? (ctx.scopeName+' 전체') : (ctx.scopeName+' 부서');
  }
  function periodText(ctx){
    if(!ctx.from)return '전체 기간';
    var today=new Date().toISOString().slice(0,10);
    return ctx.from+' ~ '+today+' ('+ctx.periodLabel+')';
  }

  /* 집계. app.js 의 adAgg 를 그대로 쓴다(대시보드와 숫자가 어긋나면 안 된다). */
  function aggregate(rows){
    if(typeof adAgg==='function')return adAgg(rows);
    /* adAgg 가 없을 일은 없지만, 없더라도 보고서가 비지 않게 최소 집계는 한다. */
    var byType={},byStore={};
    var approved=0,lost=0;
    rows.forEach(function(r){
      if(r.a==='Y')approved++;
      lost+=num(r.l);
      var t=String(r.y||'').trim()||'기타';byType[t]=(byType[t]||0)+1;
      if(!byStore[r.s])byStore[r.s]={store:r.s,n:0,lost:0,dept:r.p||'',team:r.t||''};
      byStore[r.s].n++;byStore[r.s].lost+=num(r.l);
    });
    return {
      total:rows.length,approved:approved,lost:lost,
      types:Object.keys(byType).map(function(k){return {name:k,n:byType[k]}}).sort(function(a,b){return b.n-a.n}),
      stores:Object.keys(byStore).map(function(k){return byStore[k]}).sort(function(a,b){return b.n-a.n}),
      byMonth:{}
    };
  }

  /* ---------- 주의할 점 (문구표에서 꺼내 숫자를 끼운다) ---------- */
  function fillTemplate(text,ctx,type,agg){
    var n=0,mine=0;
    (ctx.rows||[]).forEach(function(r){if((String(r.y||'').trim()||'기타')===type)n++});
    (ctx.storeRows||[]).forEach(function(r){if((String(r.y||'').trim()||'기타')===type)mine++});
    var pct=agg.total?Math.round(n/agg.total*100)+'%':'0%';
    return String(text)
      .replace(/\{범위\}/g,scopeWord(ctx))
      .replace(/\{건수\}/g,String(n))
      .replace(/\{비율\}/g,pct)
      .replace(/\{매장명\}/g,ctx.store)
      .replace(/\{매장건수\}/g,String(mine));
  }
  function measureLines(ctx,agg,limit){
    var table=window.MEASURES||{};
    var order=window.MEASURE_ORDER||[];
    /* 건수 많은 유형부터. 같으면 엑셀에 적힌 순서를 따른다. */
    var types=agg.types.slice().sort(function(a,b){
      if(b.n!==a.n)return b.n-a.n;
      var ia=order.indexOf(a.name),ib=order.indexOf(b.name);
      return (ia<0?999:ia)-(ib<0?999:ib);
    });
    var out=[];
    types.forEach(function(t){
      if(out.length>=limit)return;
      /* 원장 유형이 «넘어짐(전도)» 처럼 적혀 있어도 «넘어짐» 문구를 찾도록 포함 매칭한다. */
      var key=null;
      if(table[t.name])key=t.name;
      else{
        var plain=t.name.replace(/\s+/g,'');
        Object.keys(table).some(function(k){
          if(plain.indexOf(k.replace(/\s+/g,''))>=0){key=k;return true}
          return false;
        });
      }
      if(!key)return;                       /* 문구가 없는 유형은 건너뛴다 */
      var text=String(table[key]||'').trim();
      if(!text)return;                      /* 엑셀에서 비워 둔 유형도 건너뛴다 */
      out.push(fillTemplate(text,ctx,t.name,agg));
    });
    return out;
  }

  /* ---------- 조각들 ---------- */
  function head(ctx){
    var org=[ctx.org.v,ctx.org.p,ctx.org.t].filter(Boolean).join(' · ');
    return '<div class="rh"><div>'
      +'<div class="tt">ASUNG DAISO · SAFETY &amp; HEALTH</div>'
      +'<h1>'+esc(ctx.store)+' 사고현황 공유</h1>'
      +'<div class="sub">'+esc(org)+' &nbsp;|&nbsp; '+esc(scopeWord(ctx))+' 기준 &nbsp;|&nbsp; '+esc(periodText(ctx))+'</div>'
      +'</div></div>';
  }
  function kpi(ctx,agg){
    var mine=(ctx.storeRows||[]).length;
    return '<div class="kpi">'
      +'<div><b>'+agg.total+'</b><small>'+esc(ctx.scopeName)+' 전체 사고</small></div>'
      +'<div><b>'+agg.approved+'</b><small>산재승인</small></div>'
      +'<div><b>'+agg.lost+'</b><small>근로손실일수</small></div>'
      +'<div class="hl"><b>'+mine+'</b><small>우리 매장 사고</small></div>'
      +'</div>';
  }
  function typeBox(ctx,agg){
    var max=agg.types[0]?agg.types[0].n:1;
    var h='<div class="box"><h2>재해유형<em>'+esc(ctx.scopeName)+' 전체</em></h2>';
    if(!agg.types.length)h+='<p class="none">집계된 재해유형이 없습니다.</p>';
    agg.types.slice(0,5).forEach(function(t,i){
      var w=Math.max(6,Math.round(t.n/max*100));
      /* ★ 클래스명을 'bar' 로 쓰면 안 된다 ★
         style.css 에 작업점검 하단 진행바용 .bar{height:5px;overflow:hidden} 가 이미 있어서
         막대 한 줄(글자+막대)이 5px 로 눌려 PDF에서 글자가 겹쳐 나왔다(2026-10-07). */
      h+='<div class="tbar"><div class="l"><span>'+esc(t.name)+'</span><span>'+t.n+'건</span></div>'
        +'<div class="t"><i style="width:'+w+'%;background:'+barColor(i)+'"></i></div></div>';
    });
    return h+'</div>';
  }
  function barColor(i){return ['#13245a','#203a7a','#4a5f94','#7684a8','#9aa4bf'][i]||'#c9ced8'}

  function storeBox(ctx,agg){
    /* 우리 매장은 반드시 보여야 한다. 상위 5위 밖이면 자리를 비워 끼워 넣는다. */
    var list=agg.stores.slice(0,5);
    var has=list.some(function(x){return x.store===ctx.store});
    if(!has){
      var mineRow=agg.stores.filter(function(x){return x.store===ctx.store})[0];
      if(mineRow){list=agg.stores.slice(0,4);list.push(mineRow)}
    }
    var h='<div class="box"><h2>매장별 건수<em>우리 매장 강조</em></h2>';
    if(!list.length)h+='<p class="none">해당 범위에 사고가 없습니다.</p>';
    list.forEach(function(x){
      var me=x.store===ctx.store;
      var rank=agg.stores.indexOf(x)+1;
      h+='<div class="st'+(me?' me':'')+'"><div class="n">'+rank+'</div>'
        +'<div class="nm">'+esc(x.store)+'</div>'
        +'<div class="v">'+x.n+'건 · '+x.lost+'일</div></div>';
    });
    return h+'</div>';
  }
  function caseTable(ctx,limit){
    var rows=(ctx.rows||[]).slice(0,limit);
    var h='<div class="box"><h2>사고 사례<em>최근 '+rows.length+'건 · 우리 매장은 음영</em></h2>'
      +'<table><thead><tr>'
      +'<th class="w1">재해일</th><th class="w2">매장</th><th class="w3">유형</th>'
      +'<th class="w4">기인물</th><th>사고내용</th><th class="w5">승인</th>'
      +'</tr></thead><tbody>';
    rows.forEach(function(r){
      var me=r.s===ctx.store, ok=r.a==='Y';
      h+='<tr'+(me?' class="me"':'')+'>'
        +'<td>'+esc(r.d||'-')+'</td>'
        +'<td>'+esc(r.s)+'</td>'
        +'<td>'+esc(r.y||'-')+'</td>'
        +'<td>'+esc(r.c||'-')+'</td>'
        +'<td>'+esc(r.x||'-')+'</td>'
        +'<td><span class="tag'+(ok?' r':'')+'">'+(ok?'승인':'—')+'</span></td>'
        +'</tr>';
    });
    h+='</tbody></table>';
    if((ctx.rows||[]).length>rows.length){
      h+='<p class="more">최근 '+rows.length+'건만 실었습니다 (전체 '+ctx.rows.length+'건).</p>';
    }
    return h+'</div>';
  }
  function measureBox(ctx,agg){
    var lines=measureLines(ctx,agg,3);
    if(!lines.length)return '';
    return '<div class="msg"><h2>우리 매장이 특히 주의할 점<em>재해유형별 대책 문구표 기준</em></h2>'
      +'<ul>'+lines.map(function(t){return '<li>'+esc(t)+'</li>'}).join('')+'</ul></div>';
  }
  function foot(){
    return '<div class="rf">개인정보(재해자명·주민번호)는 표시하지 않습니다. 매장 외부 공유를 금합니다.</div>';
  }

  /**
   * ctx = {store, org:{v,p,t}, level:'t'|'p', scopeName, periodLabel, from,
   *        rows:[...], storeRows:[...], maxCases}
   */
  window.buildAccidentReport=function(ctx){
    if(!ctx||!ctx.rows)return '<div class="ar-page"></div>';
    var agg=aggregate(ctx.rows);
    var limit=Math.max(3,Number(ctx.maxCases)||10);
    return '<div class="ar-page">'
      +head(ctx)
      +kpi(ctx,agg)
      +'<div class="two">'+typeBox(ctx,agg)+storeBox(ctx,agg)+'</div>'
      +caseTable(ctx,limit)
      +measureBox(ctx,agg)
      +foot()
      +'</div>';
  };
})();
