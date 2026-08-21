/* history.js — 履歴の集計と描画。
   見たいのは「日付ごとの最高N」と「モダリティ別の推移」。 */
(function (NB) {
  'use strict';

  const COLORS = {
    'visual-number':   '#6ea8ff',
    'visual-position': '#6fd6a8',
    'mixed-number-position': '#e6b95c',
    'audio-letter':    '#c9a0ff',
    'dual':            '#d98ce0'
  };
  function colorFor(m) { return COLORS[m] || '#9aa4b2'; }

  function modalityLabel(id) {
    if (id === 'dual') return 'デュアル';
    const m = NB.modalities[id];
    return m ? m.label : id;
  }

  function localDate(iso) {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function localTime(iso) {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // ---- 日付ごとの集計 -----------------------------------------------------
  function byDate(records) {
    const map = new Map();
    records.forEach(function (r) {
      const d = localDate(r.datetime);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(r);
    });
    const out = [];
    map.forEach(function (rs, date) {
      out.push({
        date: date,
        blocks: rs.length,
        maxN: Math.max.apply(null, [0].concat(rs.filter(r => r.n > 0).map(r => r.n))),
        hitRate: avg(rs.map(r => r.hitRate)),
        faRate: avg(rs.map(r => r.faRate)),
        accuracy: avg(rs.map(r => r.accuracy)),
        dPrime: avg(rs.map(r => r.dPrime)),
        maxRecallCount: Math.max.apply(null, [0].concat(
          rs.filter(r => mode(r) === 'recall').map(r => r.trials))),
        modalities: Array.from(new Set(rs.map(r => r.modality)))
      });
    });
    out.sort((a, b) => a.date < b.date ? 1 : -1);   // 新しい日が上
    return out;
  }

  function avg(a) {
    const v = a.filter(x => typeof x === 'number' && !isNaN(x));
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  }

  // v1 の記録には responseMode がない。当時はリアルタイム判定しかなかった。
  function mode(r) { return r.responseMode || 'realtime'; }
  const MODE_LABEL = { realtime: 'リアルタイム', recall: '提示後に入力' };

  function pct(v) { return (v === null || v === undefined) ? '—' : Math.round(v * 100) + '%'; }

  function num(v, d) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return v.toFixed(d);
  }

  // ---- 折れ線グラフ -------------------------------------------------------
  /**
   * series: [{label, color, points:[{x, y, title}]}]
   * x は 0..xMax の連番（時系列順のブロック番号）
   */
  function lineChart(opt) {
    const W = 640, H = 200;
    const pad = { l: 44, r: 14, t: 14, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const xMax = opt.xMax;
    const yMin = opt.yMin, yMax = opt.yMax;
    const sx = x => xMax <= 0 ? pad.l + iw / 2 : pad.l + (x / xMax) * iw;
    const sy = y => pad.t + ih - ((y - yMin) / (yMax - yMin)) * ih;

    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
              esc(opt.title || '') + '">';

    (opt.yTicks || []).forEach(function (t) {
      const y = sy(t.v);
      svg += '<line class="grid" x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y + '"/>';
      svg += '<text class="tick" x="' + (pad.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
             esc(t.label) + '</text>';
    });

    (opt.xLabels || []).forEach(function (l) {
      svg += '<text class="tick" x="' + sx(l.x).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' +
             (l.anchor || 'middle') + '">' + esc(l.label) + '</text>';
    });

    opt.series.forEach(function (s) {
      if (!s.points.length) return;
      // 方式の違う記録が間に挟まると点が飛ぶ。飛んだところは線を繋がない。
      if (s.points.length > 1) {
        let d = '';
        s.points.forEach(function (p, i) {
          const cont = i > 0 && p.x === s.points[i - 1].x + 1;
          d += (cont ? 'L' : (i ? ' M' : 'M')) + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1) + ' ';
        });
        svg += '<path class="line" d="' + d.trim() + '" stroke="' + s.color + '"/>';
      }
      s.points.forEach(function (p) {
        svg += '<circle class="dot" cx="' + sx(p.x).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) +
               '" r="3.5" fill="' + s.color + '"><title>' + esc(p.title || '') + '</title></circle>';
      });
    });

    return svg + '</svg>';
  }

  function legend(series) {
    return '<div class="legend">' + series.map(s =>
      '<span class="legend-item"><i style="background:' + s.color + '"></i>' + esc(s.label) + '</span>'
    ).join('') + '</div>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function xLabelsFor(rs) {
    if (rs.length < 2) return [{ x: 0, label: localDate(rs[0].datetime) }];
    return [
      { x: 0, label: localDate(rs[0].datetime), anchor: 'start' },
      { x: rs.length - 1, label: localDate(rs[rs.length - 1].datetime), anchor: 'end' }
    ];
  }

  // ---- 描画 ---------------------------------------------------------------
  function render(container, records, opts) {
    opts = opts || {};

    if (!records.length) {
      container.innerHTML = '<p class="empty">まだ記録がありません。1ブロック走らせると、ここに残ります。</p>';
      return;
    }

    let rs = records.slice().sort((a, b) => a.datetime < b.datetime ? -1 : 1);
    if (opts.modality && opts.modality !== 'all') rs = rs.filter(r => r.modality === opts.modality);
    if (opts.responseMode && opts.responseMode !== 'all') rs = rs.filter(r => mode(r) === opts.responseMode);

    if (!rs.length) {
      container.innerHTML = '<p class="empty">この絞り込みに該当する記録はありません。</p>';
      return;
    }

    const hasRealtime = rs.some(r => mode(r) === 'realtime');
    const hasRecall = rs.some(r => mode(r) === 'recall');

    let html = '';

    // --- N の推移（モダリティ別） ---
    // 提示後に入力する方式は Nバックではない（n = 0）ので、この図には出さない。
    const mods = Array.from(new Set(rs.map(r => r.modality)));
    const hasN = rs.some(r => r.n > 0);
    if (hasN) {
      const nSeries = mods.map(function (m) {
        return {
          label: modalityLabel(m),
          color: colorFor(m),
          points: rs.map((r, i) => ({ r: r, i: i }))
            .filter(o => o.r.modality === m && o.r.n > 0)
            .map(o => ({ x: o.i, y: o.r.n, title: localDate(o.r.datetime) + '  N' + o.r.n }))
        };
      }).filter(sr => sr.points.length);
      const nMax = Math.max.apply(null, rs.filter(r => r.n > 0).map(r => r.n));
      const nTop = Math.max(nMax, 3);
      const nTicks = [];
      for (let v = 1; v <= nTop; v++) nTicks.push({ v: v, label: 'N' + v });

      html += '<section class="card"><h3>N の推移</h3>' +
        lineChart({
          title: 'N の推移', series: nSeries, xMax: rs.length - 1,
          yMin: 0.5, yMax: nTop + 0.5, yTicks: nTicks, xLabels: xLabelsFor(rs)
        }) + legend(nSeries) + '</section>';
    }

    // --- 提示後に入力する方式では、問題数が難易度そのものなので併せて出す ---
    if (hasRecall) {
      const tSeries = [{
        label: '問題数', color: '#d98ce0',
        points: rs.map((r, i) => ({ r: r, i: i })).filter(o => mode(o.r) === 'recall')
          .map(o => ({ x: o.i, y: o.r.trials, title: localDate(o.r.datetime) + '  ' + o.r.trials + '問' }))
      }];
      const tMax = Math.max.apply(null, tSeries[0].points.map(p => p.y));
      const tTop = Math.max(tMax, 4);
      const tTicks = [];
      for (let v = 2; v <= tTop; v += (tTop > 12 ? 4 : 2)) tTicks.push({ v: v, label: v + '問' });
      html += '<section class="card"><h3>問題数の推移（提示後に入力）</h3>' +
        lineChart({
          title: '問題数の推移', series: tSeries, xMax: rs.length - 1,
          yMin: 1, yMax: tTop + 1, yTicks: tTicks, xLabels: xLabelsFor(rs)
        }) + '</section>';
    }

    // --- 成績 ---
    // リアルタイム判定では正答率ひとつにまとめない。「一致と思ったら全部押す」戦略はここで見える。
    const rateSeries = [];
    if (hasRealtime) {
      rateSeries.push({ label: 'ヒット率', color: '#6fd6a8',
        points: rs.map((r, i) => ({ r: r, i: i })).filter(o => mode(o.r) === 'realtime')
          .map(o => ({ x: o.i, y: o.r.hitRate, title: localDate(o.r.datetime) + '  ヒット ' + pct(o.r.hitRate) })) });
      rateSeries.push({ label: '誤警報率', color: '#e08585',
        points: rs.map((r, i) => ({ r: r, i: i })).filter(o => mode(o.r) === 'realtime')
          .map(o => ({ x: o.i, y: o.r.faRate, title: localDate(o.r.datetime) + '  誤警報 ' + pct(o.r.faRate) })) });
    }
    if (hasRecall) {
      rateSeries.push({ label: '正答率', color: '#6ea8ff',
        points: rs.map((r, i) => ({ r: r, i: i })).filter(o => mode(o.r) === 'recall')
          .map(o => ({ x: o.i, y: o.r.accuracy, title: localDate(o.r.datetime) + '  正答 ' + pct(o.r.accuracy) })) });
    }
    const rateTitle = hasRealtime && hasRecall ? 'ヒット率 / 誤警報率 / 正答率'
      : (hasRealtime ? 'ヒット率 / 誤警報率' : '正答率');
    html += '<section class="card"><h3>' + rateTitle + '</h3>' +
      lineChart({
        title: rateTitle, series: rateSeries, xMax: rs.length - 1,
        yMin: 0, yMax: 1,
        yTicks: [{ v: 0, label: '0%' }, { v: 0.5, label: '50%' }, { v: 1, label: '100%' }],
        xLabels: xLabelsFor(rs)
      }) + legend(rateSeries) + '</section>';

    // --- 日付ごとの最高N ---
    html += '<section class="card"><h3>日付ごと</h3><div class="table-scroll">' +
      '<table class="grid-table"><thead><tr>' +
      '<th>日付</th><th>ブロック</th>' +
      (hasN ? '<th>最高N</th>' : '') +
      (hasRecall ? '<th>最多問題数</th>' : '') +
      (hasRealtime ? '<th>ヒット率</th><th>誤警報率</th><th>d&prime;</th>' : '') +
      (hasRecall ? '<th>正答率</th>' : '') +
      '</tr></thead><tbody>' +
      byDate(rs).map(d =>
        '<tr><td>' + d.date + '</td><td>' + d.blocks + '</td>' +
        (hasN ? '<td class="strong">' + (d.maxN ? 'N' + d.maxN : '—') + '</td>' : '') +
        (hasRecall ? '<td class="strong">' + (d.maxRecallCount ? d.maxRecallCount + '問' : '—') + '</td>' : '') +
        (hasRealtime ? '<td>' + pct(d.hitRate) + '</td><td>' + pct(d.faRate) + '</td><td>' + num(d.dPrime, 2) + '</td>' : '') +
        (hasRecall ? '<td>' + pct(d.accuracy) + '</td>' : '') +
        '</tr>'
      ).join('') + '</tbody></table></div></section>';

    // --- ブロック一覧 ---
    // 方式で意味のある列が違うので、該当しないところは — にする。
    html += '<section class="card"><h3>ブロック一覧</h3><div class="table-scroll">' +
      '<table class="grid-table"><thead><tr>' +
      '<th>日時</th>' + (hasN ? '<th>N</th>' : '') +
      '<th>モダリティ</th><th>方式</th><th>長さ</th><th>成績</th>' +
      (hasRealtime ? '<th>ヒット率</th><th>誤警報率</th><th>d&prime;</th>' : '') +
      (hasRecall ? '<th>正答率</th>' : '') +
      '<th>平均RT</th><th>シード</th><th></th>' +
      '</tr></thead><tbody>' +
      rs.slice().reverse().map(function (r) {
        const m = mode(r);
        const score = m === 'realtime'
          ? 'ヒット ' + r.hits + '/' + r.targets + ' ・誤警報 ' + r.falseAlarms
          : '正答 ' + r.correct + '/' + r.questions;
        const length = m === 'realtime' ? r.trials + '試行' : r.trials + '問';
        return '<tr>' +
          '<td class="nowrap">' + localDate(r.datetime) + ' ' + localTime(r.datetime) + '</td>' +
          (hasN ? '<td class="strong">' + (r.n > 0 ? 'N' + r.n : '—') + '</td>' : '') +
          '<td class="nowrap">' + esc(modalityLabel(r.modality)) + '</td>' +
          '<td class="nowrap">' + MODE_LABEL[m] + '</td>' +
          '<td class="nowrap">' + length + '</td>' +
          '<td class="nowrap">' + score + '</td>' +
          (hasRealtime ? '<td>' + pct(r.hitRate) + '</td><td>' + pct(r.faRate) + '</td><td>' + num(r.dPrime, 2) + '</td>' : '') +
          (hasRecall ? '<td>' + pct(r.accuracy) + '</td>' : '') +
          '<td>' + (r.meanRt === null || r.meanRt === undefined ? '—' : r.meanRt + 'ms') + '</td>' +
          '<td class="mono">' + r.seed + '</td>' +
          '<td class="row-actions nowrap">' +
          '<button class="mini" data-replay="' + esc(r.datetime) + '">再挑戦</button>' +
          '<button class="mini danger" data-delete="' + esc(r.datetime) + '">削除</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table></div></section>';

    container.innerHTML = html;
  }

  NB.history = { render, byDate, modalityLabel, colorFor, localDate, localTime, pct, num, esc, mode, MODE_LABEL };
})(window.NB = window.NB || {});
