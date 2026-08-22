/* app.js — 画面の組み立てと進行。
   ここは「どの設定でブロックを1本回し、結果を保存して見せるか」だけを持つ。
   刺激列の作り方 (core.js)、出し方・受け取り方 (modalities.js)、回し方 (runner.js) には踏み込まない。 */
(function (NB) {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.prototype.slice.call(document.querySelectorAll(sel));

  let settings = NB.store.loadSettings();
  let records = NB.store.load();
  let controller = null;      // 実行中のブロック
  let pendingSeed = null;     // 「同じ列で再挑戦」用
  let lastRecord = null;
  let historyFilter = 'all';
  let historyMode = 'all';

  const MODE_LABEL = { realtime: 'リアルタイム判定', paced: '自分のペース' };

  // ---- 画面切り替え -------------------------------------------------------
  function show(name) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    document.body.dataset.screen = name;
    window.scrollTo(0, 0);
  }

  // ---- 設定画面 -----------------------------------------------------------
  function buildSetup() {
    // モダリティの選択肢はレジストリから作る。第2段階で音を登録すれば自動で並ぶ。
    $('#modality').innerHTML = NB.modalityList()
      .filter(m => m.kind === 'visual')     // 第1段階は視覚のみ
      .map(m => '<option value="' + m.id + '">' + m.label + '</option>')
      .join('');

    // 自分のペースの課題も同じくレジストリから
    $('#paced-task').innerHTML = NB.paced.taskIds()
      .map(id => '<option value="' + id + '">' + NB.paced.label(id) + '</option>')
      .join('');

    syncSetupFromSettings();

    $('#n-minus').addEventListener('click', () => setN(settings.n - 1));
    $('#n-plus').addEventListener('click', () => setN(settings.n + 1));

    $('#modality').addEventListener('change', function () {
      settings.modalityId = this.value;
      persist();
      syncSetupFromSettings();
    });

    $('#paced-task').addEventListener('change', function () {
      settings.pacedTask = this.value;
      persist();
      syncSetupFromSettings();
    });

    $('#response-mode').addEventListener('change', function () {
      settings.responseMode = this.value;
      persist();
      syncSetupFromSettings();
    });

    bindNumber('#trials-extra', 'trialsExtra', 5, 200);
    bindNumber('#paced-answers', 'pacedAnswers', 3, 60);
    bindNumber('#stimulus-ms', 'stimulusMs', 100, 5000);
    bindNumber('#isi-ms', 'isiMs', 200, 10000);

    $('#target-rate').addEventListener('input', function () {
      settings.targetRate = Number(this.value) / 100;
      $('#target-rate-out').textContent = Math.round(settings.targetRate * 100) + '%';
      persist();
      updateSetupSummary();
    });

    $('#lure').addEventListener('change', function () {
      settings.lure = this.checked;
      persist();
      syncSetupFromSettings();
    });

    $('#exclude-center').addEventListener('change', function () {
      settings.excludeCenter = this.checked;
      persist();
      updateSetupSummary();
    });

    $('#reset-settings').addEventListener('click', function () {
      settings = Object.assign({}, NB.store.DEFAULT_SETTINGS, { n: settings.n });
      persist();
      syncSetupFromSettings();
    });

    $('#start').addEventListener('click', () => startBlock(null));
    $('#to-history').addEventListener('click', openHistory);
  }

  function bindNumber(sel, key, min, max) {
    const el = $(sel);
    el.addEventListener('change', function () {
      let v = Math.round(Number(el.value));
      if (isNaN(v)) v = NB.store.DEFAULT_SETTINGS[key];
      v = Math.min(max, Math.max(min, v));
      el.value = v;
      settings[key] = v;
      persist();
      syncSetupFromSettings();
    });
  }

  function setN(v) {
    settings.n = Math.min(9, Math.max(1, v));
    persist();
    syncSetupFromSettings();
  }

  function persist() { NB.store.saveSettings(settings); }

  function isPaced() { return settings.responseMode === 'paced'; }
  function isCalcTask() { return isPaced() && settings.pacedTask === 'calc-arith'; }

  // 自分のペース方式は 採点する問題数 を決め、出題は N + その数になる。
  // 最初の N 問は答える相手がいないので「覚えるだけ」。
  function pacedAnswers() {
    return Math.max(3, Math.min(60, settings.pacedAnswers));
  }

  function syncSetupFromSettings() {
    $('#n-value').textContent = settings.n;
    $('#modality').value = settings.modalityId;
    $('#response-mode').value = settings.responseMode;
    $('#trials-extra').value = settings.trialsExtra;
    $('#paced-answers').value = pacedAnswers();
    $('#paced-task').value = settings.pacedTask;
    $('#stimulus-ms').value = settings.stimulusMs;
    $('#isi-ms').value = settings.isiMs;
    $('#target-rate').value = Math.round(settings.targetRate * 100);
    $('#target-rate-out').textContent = Math.round(settings.targetRate * 100) + '%';
    $('#lure').checked = !!settings.lure;
    $('#exclude-center').checked = settings.excludeCenter !== false;

    // 中央マスを使うかは位置を扱うときだけ意味がある
    const usesPosition = isPaced()
      ? settings.pacedTask === 'paced-position'
      : settings.modalityId === 'visual-position';
    $('#row-exclude-center').hidden = !usesPosition;

    // 方式ごとに、意味のある設定だけ出す。
    // 自分のペース方式は刺激列の設定（ターゲット率・ひっかけ・提示時間）を使わない。
    $('#card-n').hidden = false;                 // N はどちらの方式でも難易度
    $('#row-modality').hidden = isPaced();
    $('#row-paced-task').hidden = !isPaced();
    $('#row-paced-answers').hidden = !isPaced();
    $('#row-trials-extra').hidden = isPaced();
    $('#row-target-rate').hidden = isPaced();
    $('#row-lure').hidden = false;               // ひっかけは全方式で設定できる
    $('#row-timing').hidden = isPaced();         // 自分のペースなので時間設定は無い

    // 計算だけは ひっかけ が効かないので、その場で断っておく
    $('#lure-calc-note').hidden = !isCalcTask();

    updateSetupSummary();
    updateSetupHelp();
  }

  function updateSetupSummary() {
    if (isPaced()) {
      const q = pacedAnswers();
      $('#setup-summary').textContent =
        (settings.n + q) + '問を出題 → ' + q + '問に回答（最初の ' + settings.n + ' 問は覚えるだけ）';
      let note;
      if (isCalcTask()) {
        note = '足し算・引き算・掛け算・割り算。割り算は割り切れるものだけ、答えはすべて一桁です。' +
          '時間制限はないので自分のペースで進められます。難しくするなら N を上げてください。';
      } else if (settings.pacedTask === 'paced-mixed') {
        note = '試行ごとに数字か位置かが切り替わります。種類と値の両方を覚える必要があるので、' +
          '同じ N でも単独より重くなります。時間制限はありません。';
      } else {
        note = '出たものを覚えて、N個前を答えます。時間制限はないので自分のペースで進められます。' +
          '難しくするなら N を上げてください。';
      }
      if (settings.lure) note = 'ひっかけ ON。' + note;
      $('#setup-note').textContent = note;
      $('#setup-note').hidden = false;
      return;
    }

    const trials = settings.n + settings.trialsExtra;
    const secs = Math.round(trials * (settings.stimulusMs + settings.isiMs) / 1000);
    const time = Math.floor(secs / 60) + '分' + (secs % 60) + '秒';
    const targets = Math.max(1, Math.round(settings.targetRate * settings.trialsExtra));
    $('#setup-summary').textContent =
      trials + '試行 / ターゲット約' + targets + '個 / 所要 約' + time;
    $('#setup-note').hidden = true;
  }

  function updateSetupHelp() {
    if (isPaced()) {
      const t = settings.pacedTask;
      const how = t === 'paced-position' ? '3×3グリッドの該当マスをタップ'
        : (t === 'paced-mixed' ? '左のグリッドか右の数字のどちらかをタップ'
          : '画面下の 0〜9 ボタンをタップ');
      const what = t === 'calc-arith' ? '式の答え'
        : (t === 'paced-position' ? '光ったマス'
          : (t === 'paced-mixed' ? '数字か光ったマス' : '数字'));
      $('#setup-help').innerHTML =
        NB.history.esc(what) + 'が1つずつ出ます。それを覚えておき、' + settings.n +
        ' 個前に出たものを ' + NB.history.esc(how) + 'して答えます。<br>' +
        '入力すると次に進みます。キーボードは使いません。';
      return;
    }
    $('#setup-help').innerHTML =
      '反応は画面下のボタンをタップ、またはスペースキー。<br>一致しないときは押さない。';
  }

  // ---- ブロック実行 -------------------------------------------------------
  function buildConfig(seed) {
    if (isPaced()) {
      // 自分のペース方式は刺激列の設定（ターゲット率・lure）を使わない
      return {
        n: settings.n,
        trials: settings.n + pacedAnswers(),
        responseMode: 'paced',
        task: settings.pacedTask,
        seed: (seed === null || seed === undefined) ? NB.core.randomSeed() : (seed >>> 0),
        lure: settings.lure,
        excludeCenter: settings.excludeCenter,
        answerMax: settings.calcAnswerMax || 9,
        answerDigits: 1,        // 計算の答えを2桁に広げるときはここを 2 にする
        ops: NB.paced.OPS
      };
    }
    return {
      n: settings.n,
      trials: settings.n + settings.trialsExtra,
      responseMode: 'realtime',
      targetRate: settings.targetRate,
      stimulusMs: settings.stimulusMs,
      isiMs: settings.isiMs,
      lure: settings.lure,
      excludeCenter: settings.excludeCenter,
      seed: (seed === null || seed === undefined) ? NB.core.randomSeed() : (seed >>> 0),
      // 第1段階はチャンネル1本。デュアルはここを2要素にするだけ。
      channels: [{ modalityId: settings.modalityId, key: 'SPACE' }]
    };
  }

  function startBlock(seed) {
    const config = buildConfig(seed);
    pendingSeed = config.seed;

    $('#run-n').textContent = config.n > 0 ? 'N' + config.n : config.trials + '問';
    $('#run-modality').textContent = config.responseMode === 'paced'
      ? NB.paced.label(config.task)
      : NB.modalities[config.channels[0].modalityId].label;
    $('#run-seed').textContent = 'seed ' + config.seed;
    $('#run-lure').hidden = !config.lure;
    setProgress(0, config.trials);
    setPhase(null);
    show('run');

    // 自分のペース方式はタイマーを使わないので、専用の実行部に渡す
    if (config.responseMode === 'paced') {
      controller = NB.paced.runBlock(
        { stage: $('#stage'), pad: $('#pad') },
        config,
        {
          onTrialStart: function (i, total) { setProgress(i + 1, total); },
          onFinish: function (record) {
            controller = null;
            lastRecord = record;
            records = NB.store.append(record);
            showResult(record);
          },
          onAbort: function () { controller = null; show('setup'); }
        }
      );
      countdown(3, function () { if (controller) controller.start(); });
      return;
    }

    controller = NB.runBlock(
      { stage: $('#stage'), pad: $('#pad') },
      config,
      {
        onTrialStart: function (i, total) { setProgress(i + 1, total); },
        onFinish: function (record) {
          controller = null;
          lastRecord = record;
          records = NB.store.append(record);
          showResult(record);
        },
        onAbort: function () {
          controller = null;
          show('setup');
        }
      }
    );

    countdown(3, function () { if (controller) controller.start(); });
  }

  function setPhase(text) {
    const el = $('#run-phase');
    el.textContent = text || '';
    el.hidden = !text;
  }

  function setProgress(done, total) {
    $('#progress-text').textContent = done + ' / ' + total;
    $('#progress-bar').style.width = (total ? (done / total) * 100 : 0) + '%';
  }

  function countdown(from, done) {
    const el = $('#countdown');
    let v = from;
    el.hidden = false;
    el.textContent = v;
    const tick = setInterval(function () {
      v--;
      if (v <= 0) {
        clearInterval(tick);
        el.hidden = true;
        done();
      } else {
        el.textContent = v;
      }
    }, 800);
  }

  // ---- 結果画面 -----------------------------------------------------------
  function isPacedRecord(r) {
    // v4 までの計算Nバックは responseMode が 'calc' だった
    return r.responseMode === 'paced' || r.responseMode === 'calc';
  }

  function showResult(r) {
    $('#result-head').textContent =
      'N' + r.n + ' / ' + NB.history.modalityLabel(r.modality) +
      ' / ' + (isPacedRecord(r) ? '自分のペース' : 'リアルタイム判定');
    $('#result-seed').textContent = String(r.seed);
    if (isPacedRecord(r)) showPacedResult(r); else showRealtimeResult(r);
    show('result');
  }

  function showRealtimeResult(r) {
    const pct = NB.history.pct;
    const suggested = NB.core.suggestNextN(r.n, r);
    const errors = r.misses + r.falseAlarms;

    $('#result-metrics').innerHTML = [
      metric('ヒット率', pct(r.hitRate), r.hits + ' / ' + r.targets + ' ターゲット', 'good'),
      metric('誤警報率', pct(r.faRate), r.falseAlarms + ' / ' + (r.trials - r.targets) + ' 非ターゲット', 'bad'),
      metric('d&prime;', NB.history.num(r.dPrime, 2), '弁別力', ''),
      metric('平均反応時間', r.meanRt === null ? '—' : r.meanRt + 'ms', 'ヒット時', ''),
      metric('ミス', r.misses, 'ターゲットを見逃した', ''),
      metric('正棄却', r.correctRejections, '正しく押さなかった', '')
    ].join('');

    $('#result-detail').innerHTML = '';

    // 適応的難易度は第2段階。今は目安の表示だけにしておく。
    let advice;
    if (suggested > r.n) advice = 'ミス＋誤警報 ' + errors + '件 → N' + suggested + ' に上げてよい水準';
    else if (suggested < r.n) advice = 'ミス＋誤警報 ' + errors + '件 → N' + suggested + ' に下げるのが目安';
    else advice = 'ミス＋誤警報 ' + errors + '件 → N' + r.n + ' のまま継続';
    $('#result-advice').textContent = advice;
  }

  // 自分のペース方式は正答率で見る。ヒット率・誤警報率は使わない。
  function showPacedResult(r) {
    const ch = r.channels[0];
    const esc = NB.history.esc;
    const fmt = sym => {
      if (sym === null || sym === undefined) return '—';
      const t = NB.paced.TASKS[r.modality];
      return esc(t ? t.format(sym) : sym);
    };

    $('#result-metrics').innerHTML = [
      metric('正答率', NB.history.pct(r.accuracy), r.correct + ' / ' + r.questions + ' 問', 'good'),
      metric('誤答', r.incorrect, '間違えた問題', r.incorrect ? 'bad' : ''),
      metric('連続正答', r.streak, '頭から続けて正解した数', ''),
      metric('平均反応時間', r.meanRt === null ? '—' : r.meanRt + 'ms', '1問あたり', '')
    ].join('');

    // どこで崩れたかが見たいので、1問ずつ並べる。計算なら式も出す。
    const rows = ch.expected.map(function (exp, i) {
      const ok = ch.correctFlags[i] === '1';
      const left = ch.problems ? esc(ch.problems[i]) + ' = ' + fmt(exp) : fmt(exp);
      return '<div class="recall-review-item ' + (ok ? 'ok' : 'ng') + '">' +
        '<span class="rri-no">' + (i + 1) + '</span>' +
        '<span class="rri-exp">' + left + '</span>' +
        '<span class="rri-mark">' + (ok ? '○' : '×') + '</span>' +
        '<span class="rri-got">' + fmt(ch.answers[i]) + '</span>' +
        '</div>';
    }).join('');

    $('#result-detail').innerHTML =
      '<section class="card"><h3>問題ごと（正解 → 回答）</h3>' +
      '<div class="recall-review' + (ch.problems ? ' recall-review-wide' : '') + '">' + rows + '</div></section>';

    // 問題数が可変なので、件数ではなく正答率で目安を出す
    const next = NB.core.suggestNextNByRate(r.n, r.accuracy);
    const head = '正答率 ' + NB.history.pct(r.accuracy) + '（誤答 ' + r.incorrect + '件）→ ';
    let advice;
    if (next > r.n) advice = head + 'N' + next + ' に上げてよい水準';
    else if (next < r.n) advice = head + 'N' + next + ' に下げるのが目安';
    else advice = head + 'N' + r.n + ' のまま継続';
    $('#result-advice').textContent = advice;
  }

  function metric(label, value, sub, tone) {
    return '<div class="metric ' + tone + '"><div class="metric-label">' + label + '</div>' +
      '<div class="metric-value">' + value + '</div>' +
      '<div class="metric-sub">' + sub + '</div></div>';
  }

  // ---- 履歴画面 -----------------------------------------------------------
  function openHistory() {
    renderHistory();
    show('history');
  }

  function renderHistory() {
    const sel = $('#history-filter');
    const present = Array.from(new Set(records.map(r => r.modality)));
    sel.innerHTML = '<option value="all">すべて</option>' +
      present.map(m => '<option value="' + m + '">' + NB.history.modalityLabel(m) + '</option>').join('');
    sel.value = present.indexOf(historyFilter) >= 0 ? historyFilter : 'all';
    historyFilter = sel.value;

    // 方式の選択肢は履歴の中身から作る。廃止した方式の記録を全部消せば選択肢も消える。
    const modeSel = $('#history-mode-filter');
    const keys = [];
    records.forEach(function (r) {
      const k = NB.history.sectionKey(r);
      if (keys.indexOf(k) < 0) keys.push(k);
    });
    modeSel.innerHTML = '<option value="all">すべて</option>' +
      keys.map(k => '<option value="' + NB.history.esc(k) + '">' +
        NB.history.esc(NB.history.sectionLabel(k)) + '</option>').join('');
    modeSel.value = keys.indexOf(historyMode) >= 0 ? historyMode : 'all';
    historyMode = modeSel.value;

    drawHistory();
    $('#history-count').textContent = records.length + ' ブロック';
  }

  function drawHistory() {
    NB.history.render($('#history-body'), records, {
      modality: historyFilter,
      responseMode: historyMode
    });
  }

  function buildHistoryUi() {
    $('#history-filter').addEventListener('change', function () {
      historyFilter = this.value;
      drawHistory();
    });

    $('#history-mode-filter').addEventListener('change', function () {
      historyMode = this.value;
      drawHistory();
    });

    $('#history-body').addEventListener('click', function (e) {
      const replay = e.target.closest('[data-replay]');
      if (replay) {
        const r = records.find(x => x.datetime === replay.dataset.replay);
        if (r) replayRecord(r);
        return;
      }
      const del = e.target.closest('[data-delete]');
      if (del) {
        if (!confirm('このブロックの記録を削除しますか？')) return;
        records = NB.store.remove(del.dataset.delete);
        renderHistory();
      }
    });

    $('#export').addEventListener('click', function () {
      if (!records.length) { alert('書き出す記録がありません。'); return; }
      NB.store.download(records);
    });

    $('#import').addEventListener('click', () => $('#import-file').click());

    $('#import-file').addEventListener('change', function () {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        const incoming = NB.store.fromJsonl(String(reader.result));
        if (!incoming.length) { alert('読み取れる行がありませんでした。'); return; }
        const res = NB.store.merge(records, incoming);
        records = res.records;
        renderHistory();
        alert(res.added + ' 件を追加しました（重複 ' + res.skipped + ' 件は無視' +
          (res.retired ? '、廃止した方式 ' + res.retired + ' 件は取り込まず' : '') + '）。');
      };
      reader.readAsText(file);
      this.value = '';
    });

    $('#clear-history').addEventListener('click', function () {
      if (!records.length) return;
      if (!confirm('履歴をすべて消します。書き出しは済んでいますか？')) return;
      NB.store.clear();
      records = [];
      renderHistory();
    });

    $$('.to-setup').forEach(b => b.addEventListener('click', () => show('setup')));
  }

  // 記録に残した設定とシードで、同じ列をもう一度走らせる
  function replayRecord(r) {
    if (r.responseMode === 'paced' || r.responseMode === 'calc') {
      settings.responseMode = 'paced';
      settings.pacedTask = r.task || r.modality;
      settings.n = r.n;
      settings.pacedAnswers = r.questions;
      settings.lure = !!(r.settings && r.settings.lure);
      if (r.settings && r.settings.excludeCenter !== undefined) {
        settings.excludeCenter = r.settings.excludeCenter !== false;
      }
      persist();
      syncSetupFromSettings();
      startBlock(r.seed);
      return;
    }

    // ここに来るのはリアルタイム判定の記録だけ。
    // 廃止した「提示後に入力」の記録は履歴側で再挑戦ボタンを出さない。
    settings.responseMode = 'realtime';
    settings.modalityId = (r.settings.channels && r.settings.channels[0])
      ? r.settings.channels[0].modalityId : r.modality;
    settings.n = r.n;
    settings.trialsExtra = r.trials - r.n;
    settings.targetRate = r.settings.targetRate;
    settings.stimulusMs = r.settings.stimulusMs;
    settings.isiMs = r.settings.isiMs;
    settings.lure = r.settings.lure;
    settings.excludeCenter = r.settings.excludeCenter !== false;
    persist();
    syncSetupFromSettings();
    startBlock(r.seed);
  }

  // ---- 起動 ---------------------------------------------------------------
  function init() {
    buildSetup();
    buildHistoryUi();

    $('#abort').addEventListener('click', function () {
      if (controller) controller.abort(); else show('setup');
    });

    $('#again').addEventListener('click', () => startBlock(null));
    $('#again-same').addEventListener('click', function () {
      startBlock(lastRecord ? lastRecord.seed : pendingSeed);
    });
    $('#result-history').addEventListener('click', openHistory);

    // 課題中にスペースで画面が動くと邪魔なので止める
    window.addEventListener('keydown', function (e) {
      if ((e.code === 'Space' || e.key === ' ') && document.body.dataset.screen === 'run') {
        e.preventDefault();
      }
    });

    show('setup');
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.NB = window.NB || {});
