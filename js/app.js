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

  const MODE_LABEL = { realtime: 'リアルタイム判定', recall: '提示後に入力' };

  // ---- 画面切り替え -------------------------------------------------------
  function show(name) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    document.body.dataset.screen = name;
    window.scrollTo(0, 0);
  }

  // ---- 設定画面 -----------------------------------------------------------
  function buildSetup() {
    // モダリティの選択肢はレジストリから作る。第2段階で音を登録すれば自動で並ぶ。
    const sel = $('#modality');
    sel.innerHTML = NB.modalityList()
      .filter(m => m.kind === 'visual')     // 第1段階は視覚のみ
      .map(m => '<option value="' + m.id + '">' + m.label + '</option>')
      .join('');

    syncSetupFromSettings();

    $('#n-minus').addEventListener('click', () => setN(settings.n - 1));
    $('#n-plus').addEventListener('click', () => setN(settings.n + 1));

    sel.addEventListener('change', function () {
      settings.modalityId = sel.value;
      persist();
      syncSetupFromSettings();
    });

    $('#response-mode').addEventListener('change', function () {
      settings.responseMode = this.value;
      persist();
      syncSetupFromSettings();
    });

    bindNumber('#trials-extra', 'trialsExtra', 5, 200);
    bindNumber('#recall-count', 'recallCount', 2, 30);
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

  function isRecall() { return settings.responseMode === 'recall'; }

  // 提示後に入力する方式は「問題数を決めて、その数だけ提示し、その数だけ答える」。
  // N は使わないので、この方式では列に N バック構造を作らない（core は n=0 で受ける）。
  function recallCount() {
    return Math.max(2, Math.min(30, settings.recallCount));
  }

  function syncSetupFromSettings() {
    $('#n-value').textContent = settings.n;
    $('#modality').value = settings.modalityId;
    $('#response-mode').value = settings.responseMode;
    $('#trials-extra').value = settings.trialsExtra;
    $('#recall-count').value = recallCount();
    $('#stimulus-ms').value = settings.stimulusMs;
    $('#isi-ms').value = settings.isiMs;
    $('#target-rate').value = Math.round(settings.targetRate * 100);
    $('#target-rate-out').textContent = Math.round(settings.targetRate * 100) + '%';
    $('#lure').checked = !!settings.lure;
    $('#exclude-center').checked = settings.excludeCenter !== false;

    // 混合モダリティは中央マスを数字の表示に使うので、位置には回せない
    $('#row-exclude-center').hidden = settings.modalityId !== 'visual-position';

    // 提示後に入力する方式では N・ターゲット率・ひっかけ・試行数は出番がない
    $('#card-n').hidden = isRecall();
    $('#row-recall-count').hidden = !isRecall();
    $('#row-trials-extra').hidden = isRecall();
    $('#row-target-rate').hidden = isRecall();
    $('#row-lure').hidden = isRecall();

    updateSetupSummary();
    updateSetupHelp();
  }

  function updateSetupSummary() {
    const trials = isRecall() ? recallCount() : settings.n + settings.trialsExtra;
    const secs = Math.round(trials * (settings.stimulusMs + settings.isiMs) / 1000);
    const time = Math.floor(secs / 60) + '分' + (secs % 60) + '秒';

    if (isRecall()) {
      $('#setup-summary').textContent =
        trials + '個を提示 → ' + trials + '問に回答 / 提示 約' + time;
      $('#setup-note').textContent =
        '出た順に全部答えます。Nバックではないので N は使いません。難しくするなら問題数を増やしてください。';
      $('#setup-note').hidden = false;
    } else {
      const targets = Math.max(1, Math.round(settings.targetRate * settings.trialsExtra));
      $('#setup-summary').textContent =
        trials + '試行 / ターゲット約' + targets + '個 / 所要 約' + time;
      $('#setup-note').hidden = true;
    }
  }

  function updateSetupHelp() {
    const mod = NB.modalities[settings.modalityId];
    if (isRecall()) {
      let how;
      if (settings.modalityId === 'visual-position') how = 'マスをタップして選ぶ（キーなら 1〜9 が読み順のマス）';
      else if (settings.modalityId === 'mixed-number-position') how = '位置のマスか数字のどちらかをタップ（キーなら数字は 1〜9、位置は Q W E / A S D / Z X C）';
      else how = '数字をタップ（キーなら 1〜9）';
      $('#setup-help').innerHTML =
        recallCount() + '個が順に提示されます。全部出たあと、出てきた順に ' +
        recallCount() + '問を思い出して入力します。<br>' +
        NB.history.esc(how) + '。押し間違えたら「1つ戻る」。';
    } else {
      $('#setup-help').innerHTML =
        '反応は画面下のボタンをタップ、またはスペースキー。<br>一致しないときは押さない。';
    }
  }

  // ---- ブロック実行 -------------------------------------------------------
  function buildConfig(seed) {
    return {
      // 提示後に入力する方式は Nバックではないので n = 0（列に N バック構造を作らない）
      n: isRecall() ? 0 : settings.n,
      trials: isRecall() ? recallCount() : settings.n + settings.trialsExtra,
      responseMode: settings.responseMode,
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
    $('#run-modality').textContent = NB.modalities[config.channels[0].modalityId].label;
    $('#run-seed').textContent = 'seed ' + config.seed;
    setProgress(0, config.trials);
    setPhase(null);
    show('run');

    controller = NB.runBlock(
      { stage: $('#stage'), pad: $('#pad') },
      config,
      {
        onPhase: function (phase) {
          if (config.responseMode !== 'recall') return;
          setPhase(phase === 'present' ? '覚える' : '答える');
        },
        onTrialStart: function (i, total) { setProgress(i + 1, total); },
        onQuestion: function (q, total) { setProgress(q, total); },
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
  function showResult(r) {
    const head = r.responseMode === 'recall'
      ? r.questions + '問 / ' + NB.history.modalityLabel(r.modality)
      : 'N' + r.n + ' / ' + NB.history.modalityLabel(r.modality);
    $('#result-head').textContent = head + ' / ' + MODE_LABEL[r.responseMode];
    $('#result-seed').textContent = String(r.seed);
    if (r.responseMode === 'recall') showRecallResult(r); else showRealtimeResult(r);
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

  function showRecallResult(r) {
    const ch = r.channels[0];
    const mod = NB.modalities[ch.modality];
    const esc = NB.history.esc;

    $('#result-metrics').innerHTML = [
      metric('正答率', NB.history.pct(r.accuracy), r.correct + ' / ' + r.questions + ' 問', 'good'),
      metric('誤答', r.incorrect, '間違えた問題', r.incorrect ? 'bad' : ''),
      metric('連続正答', r.streak, '頭から続けて正解した数', ''),
      metric('平均反応時間', r.meanRt === null ? '—' : r.meanRt + 'ms', '1問あたり', '')
    ].join('');

    // どこで崩れたかが見たいので、1問ずつ並べる
    const rows = ch.expected.map(function (exp, i) {
      const got = ch.answers[i];
      const okFlag = ch.correctFlags[i] === '1';
      return '<div class="recall-review-item ' + (okFlag ? 'ok' : 'ng') + '">' +
        '<span class="rri-no">' + (i + 1) + '</span>' +
        '<span class="rri-exp">' + esc(mod.format(exp)) + '</span>' +
        '<span class="rri-mark">' + (okFlag ? '○' : '×') + '</span>' +
        '<span class="rri-got">' + (got === null ? '—' : esc(mod.format(got))) + '</span>' +
        '</div>';
    }).join('');

    $('#result-detail').innerHTML =
      '<section class="card"><h3>問題ごと（正解 → 回答）</h3>' +
      '<div class="recall-review">' + rows + '</div></section>';

    const next = NB.core.suggestNextTrials(r.trials, r.n, r.incorrect);
    let advice;
    if (next > r.trials) advice = '誤答 ' + r.incorrect + '件 → 問題数を ' + next + ' に増やしてよい水準';
    else if (next < r.trials) advice = '誤答 ' + r.incorrect + '件 → 問題数を ' + next + ' に減らすのが目安';
    else advice = '誤答 ' + r.incorrect + '件 → 問題数 ' + r.trials + ' のまま継続';
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
    $('#history-mode-filter').value = historyMode;

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
        alert(res.added + ' 件を追加しました（重複 ' + res.skipped + ' 件は無視）。');
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
    settings.modalityId = (r.settings.channels && r.settings.channels[0])
      ? r.settings.channels[0].modalityId : r.modality;
    settings.responseMode = r.responseMode || 'realtime';
    if (settings.responseMode === 'recall') {
      settings.recallCount = r.trials;      // この方式は N を使わないので触らない
    } else {
      settings.n = r.n;
      settings.trialsExtra = r.trials - r.n;
    }
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
