/* runner.js — 1ブロックを回す。
   チャンネル（提示系統）の配列を受け取り、それぞれ独立に列を生成・判定する。
   第1段階は1本、デュアルは2本。runner 自身はどちらでも同じコードで動く。

   応答方式が2つある:
     realtime — 提示中に「一致したら押す」(no-go)。押さないことも回答。
     recall   — 提示を一通り見てから、出た順に思い出して入力する。

   反応入力はキーとタップの2経路があるが、どちらも1か所に集約してある。 */
(function (NB) {
  'use strict';

  // KeyboardEvent を 'SPACE' / 'A' / 'L' のようなトークンに正規化する
  function keyToken(e) {
    if (e.code === 'Space' || e.key === ' ') return 'SPACE';
    if (e.key && e.key.length === 1) return e.key.toUpperCase();
    return (e.key || '').toUpperCase();
  }
  NB.keyToken = keyToken;
  NB.keyLabel = function (token) { return token === 'SPACE' ? 'スペース' : token + ' キー'; };

  /**
   * @param {object} els {stage, pad} 提示先と操作部の置き場
   * @param {object} config
   * @param {object} cb {onTrialStart, onResponse, onPhase, onQuestion, onFinish, onAbort}
   */
  function runBlock(els, config, cb) {
    cb = cb || {};
    const stage = els.stage;
    const pad = els.pad;
    const mode = config.responseMode || 'realtime';
    const trialMs = config.stimulusMs + config.isiMs;

    // --- 準備：チャンネルごとに列を作る ---
    const channels = config.channels.map(function (chCfg, idx) {
      const mod = NB.modalities[chCfg.modalityId];
      const seq = NB.core.generateSequence({
        n: config.n,
        trials: config.trials,
        targetRate: config.targetRate,
        alphabet: mod.alphabet(config),
        lure: config.lure,
        // チャンネルごとに列をずらす。1本なら seed そのもの。
        seed: (config.seed + idx * 0x9E3779B1) >>> 0
      });
      return {
        index: idx, cfg: chCfg, mod: mod, key: chCfg.key, seq: seq, handle: null,
        responses: new Array(config.trials).fill(null).map(() => ({ responded: false, rt: null })),
        answers: []        // recall 方式で使う
      };
    });

    // 前のブロックの画面をここで消す。start() はカウントダウンのあとなので、
    // それまで待つと前回の刺激や入力パッドが裏に見えたままになる。
    stage.classList.remove('stage-recall');
    stage.innerHTML = '';
    pad.innerHTML = '';
    pad.classList.remove('pad-input');
    pad.hidden = mode === 'recall';

    const multi = channels.length > 1;
    let trial = -1;
    let onset = 0;
    let timers = [];
    let finished = false;
    let wakeLock = null;
    let keyHandler = null;

    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function setKeyHandler(fn) {
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      keyHandler = fn;
      if (fn) document.addEventListener('keydown', fn);
    }

    // ---- 提示 -------------------------------------------------------------
    function buildStage() {
      stage.classList.remove('stage-recall');
      stage.innerHTML = '';
      pad.classList.remove('pad-input');
      channels.forEach(function (ch) {
        const box = document.createElement('div');
        box.className = 'channel' + (ch.mod.kind === 'audio' ? ' channel-audio' : '');
        const slot = document.createElement('div');
        slot.className = 'channel-slot';
        box.appendChild(slot);
        stage.appendChild(box);
        ch.box = box;
        ch.handle = ch.mod.mount(slot);
      });
    }

    function nextTrial() {
      trial++;
      if (trial >= config.trials) { endPresentation(); return; }
      onset = performance.now();
      channels.forEach(ch => ch.mod.show(ch.handle, ch.seq.symbols[trial]));
      if (cb.onTrialStart) cb.onTrialStart(trial, config.trials);
      timers.push(setTimeout(function () {
        channels.forEach(ch => ch.mod.hide(ch.handle));
      }, config.stimulusMs));
      // realtime では反応の受付は次の刺激が出るまで
      timers.push(setTimeout(nextTrial, trialMs));
    }

    function endPresentation() {
      if (mode === 'recall') startRecall(); else finish();
    }

    // ---- realtime 方式 ----------------------------------------------------
    function buildRealtimePad() {
      pad.hidden = false;
      pad.innerHTML = '';
      channels.forEach(function (ch) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'respond-btn';
        btn.innerHTML = '<span class="respond-main">一致</span>' +
          '<span class="respond-sub">' + (multi ? ch.mod.label + ' / ' : '') +
          NB.keyLabel(ch.key) + '</span>';
        // タップでもキーでも同じ respond() に入る
        NB.bindTap(btn, function () { respond(ch); });
        pad.appendChild(btn);
        ch.btn = btn;
      });
    }

    function respond(ch) {
      if (trial < 0 || finished) return;
      const r = ch.responses[trial];
      if (r.responded) return;           // 同一試行内の二重押しは無視
      r.responded = true;
      r.rt = Math.round(performance.now() - onset);
      // キーで押されたときもボタンが光るようにしておく
      if (ch.btn && !ch.btn.classList.contains('pressed')) NB.tapFeedback(ch.btn);
      if (cb.onResponse) cb.onResponse(ch.index, trial, r.rt);
    }

    function onRealtimeKey(e) {
      if (e.key === 'Escape') { abort(); return; }
      if (e.repeat) return;
      const ch = channels.find(c => c.key === keyToken(e));
      if (!ch) return;
      e.preventDefault();
      respond(ch);
    }

    // ---- recall 方式 ------------------------------------------------------
    // 提示された順に全部答える（n = 0）。n > 0 のときは末尾 n 個を除いた分だけ答える。
    let recall = null;

    function startRecall() {
      clearTimers();
      setKeyHandler(null);
      const questions = config.trials - config.n;

      recall = {
        q: 0,
        questions: questions,
        askedAt: 0,
        inputs: channels.map(() => null)
      };

      stage.innerHTML = '';
      stage.classList.add('stage-recall');
      pad.hidden = false;
      pad.innerHTML = '';
      pad.classList.add('pad-input');

      // 上：何問目かと、これまでの回答
      const head = document.createElement('div');
      head.className = 'recall-head';
      head.innerHTML = '<div class="recall-q"></div><div class="recall-hint"></div>';
      stage.appendChild(head);
      recall.qEl = head.querySelector('.recall-q');
      recall.hintEl = head.querySelector('.recall-hint');

      const foot = document.createElement('div');
      foot.className = 'recall-foot';
      foot.innerHTML = '<div class="recall-answers"></div>';
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'ghost recall-undo';
      undo.textContent = '1つ戻る';
      NB.bindTap(undo, undoAnswer);
      foot.appendChild(undo);
      stage.appendChild(foot);
      recall.answersEl = foot.querySelector('.recall-answers');
      recall.undoEl = undo;

      // 下：入力パッド。親指が届く位置に置く。
      // チャンネルが2本になれば、そのまま左右に並ぶ。
      const paneRow = document.createElement('div');
      paneRow.className = 'recall-panes';
      pad.appendChild(paneRow);

      channels.forEach(function (ch, i) {
        const holder = document.createElement('div');
        holder.className = 'recall-channel';
        if (multi) {
          const t = document.createElement('div');
          t.className = 'recall-channel-label';
          t.textContent = ch.mod.label;
          holder.appendChild(t);
        }
        paneRow.appendChild(holder);
        recall.inputs[i] = ch.mod.mountInput(holder, config, function (symbol) {
          pick(ch, symbol);
        });
      });

      setKeyHandler(onRecallKey);
      if (cb.onPhase) cb.onPhase('recall');
      askQuestion();
    }

    function askQuestion() {
      const q = recall.q;
      recall.qEl.textContent = '第 ' + (q + 1) + ' 問 / 全 ' + recall.questions + ' 問';
      recall.hintEl.textContent = config.n > 0
        ? '第 ' + (config.n + q + 1) + ' 試行の ' + config.n + ' 個前は？'
        : (q + 1) + ' 番目に出たものは？';
      recall.askedAt = performance.now();
      recall.undoEl.disabled = q === 0;
      renderAnswers();
      if (cb.onQuestion) cb.onQuestion(q, recall.questions);
    }

    function pick(ch, symbol) {
      if (finished || !recall) return;
      const q = recall.q;
      if (q >= recall.questions) return;
      ch.answers[q] = { symbol: symbol, rt: Math.round(performance.now() - recall.askedAt) };
      // 複数チャンネルのときは全チャンネルが答えるまで次に進まない
      const ready = channels.every(c => c.answers[q]);
      if (!ready) { renderAnswers(); return; }
      recall.q++;
      if (recall.q >= recall.questions) finish();
      else askQuestion();
    }

    function undoAnswer() {
      if (finished || !recall || recall.q === 0) return;
      recall.q--;
      channels.forEach(c => { c.answers[recall.q] = null; });
      askQuestion();
    }

    function renderAnswers() {
      const html = [];
      for (let i = 0; i < recall.questions; i++) {
        const a = channels[0].answers[i];
        const cls = 'answer-chip' + (i === recall.q ? ' current' : '') + (a ? ' filled' : '');
        const text = a
          ? channels.map(c => c.answers[i] ? c.mod.format(c.answers[i].symbol) : '').join(' / ')
          : (i + 1);
        html.push('<span class="' + cls + '">' + text + '</span>');
      }
      recall.answersEl.innerHTML = html.join('');
      const cur = recall.answersEl.querySelector('.current');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    function onRecallKey(e) {
      if (e.key === 'Escape') { abort(); return; }
      if (e.repeat) return;
      if (e.key === 'Backspace') { e.preventDefault(); undoAnswer(); return; }
      const tok = keyToken(e);
      for (const ch of channels) {
        const map = ch.mod.inputKeys ? ch.mod.inputKeys(config) : null;
        if (map && map[tok]) { e.preventDefault(); pick(ch, map[tok]); return; }
      }
    }

    // ---- 画面を消さない ---------------------------------------------------
    // 途中で消灯すると1ブロック無駄になる
    function acquireWakeLock() {
      if (!navigator.wakeLock) return;
      navigator.wakeLock.request('screen')
        .then(function (l) { wakeLock = l; })
        .catch(function () { /* 拒否されても課題は続行できる */ });
    }
    function releaseWakeLock() {
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    }

    function teardown() {
      clearTimers();
      setKeyHandler(null);
      channels.forEach(function (ch) {
        if (ch.handle) ch.mod.hide(ch.handle);
        if (ch.btn) ch.btn.disabled = true;
      });
      if (recall) recall.inputs.forEach(h => h && h.setEnabled && h.setEnabled(false));
      releaseWakeLock();
    }

    // ---- 終了 -------------------------------------------------------------
    function finish() {
      if (finished) return;
      finished = true;
      teardown();
      if (cb.onFinish) cb.onFinish(mode === 'recall' ? recordRecall() : recordRealtime());
    }

    function abort() {
      if (finished) return;
      finished = true;
      teardown();
      if (cb.onAbort) cb.onAbort();
    }

    function recordRealtime() {
      const perChannel = channels.map(function (ch) {
        const s = NB.core.score(ch.seq.isTarget, ch.responses);
        return Object.assign({
          modality: ch.mod.id, key: ch.key, seed: ch.seq.seed,
          lures: ch.seq.isLure.filter(Boolean).length,
          symbols: ch.seq.symbols.join(','),
          isTarget: ch.seq.isTarget.map(v => v ? 1 : 0).join(''),
          rts: ch.responses.map(r => r.rt)
        }, s);
      });
      return buildRecord(config, perChannel, 'realtime');
    }

    function recordRecall() {
      const perChannel = channels.map(function (ch) {
        const expected = ch.seq.symbols.slice(0, config.trials - config.n);
        const s = NB.core.scoreRecall(expected, ch.answers);
        return Object.assign({
          modality: ch.mod.id, seed: ch.seq.seed,
          lures: ch.seq.isLure.filter(Boolean).length,
          symbols: ch.seq.symbols.join(','),
          isTarget: ch.seq.isTarget.map(v => v ? 1 : 0).join(''),
          expected: expected,
          answers: ch.answers.map(a => a ? a.symbol : null),
          rts: ch.answers.map(a => a ? a.rt : null)
        }, s, { correctFlags: s.correctFlags.map(v => v ? 1 : 0).join('') });
      });
      return buildRecord(config, perChannel, 'recall');
    }

    // ---- 開始 -------------------------------------------------------------
    // 画面はカウントダウンの前に組み立てておく。
    // start() まで待つと、数えている間ずっと下が空っぽで、
    // どこを見てどこを押すのか分からない。
    buildStage();
    if (mode === 'realtime') {
      buildRealtimePad();          // 押しても trial < 0 の間は無視される
      setKeyHandler(onRealtimeKey);
    } else {
      // 提示中は入力させない
      pad.hidden = true;
      pad.innerHTML = '';
      setKeyHandler(function (e) { if (e.key === 'Escape') abort(); });
    }

    return {
      start: function () {
        acquireWakeLock();
        if (cb.onPhase) cb.onPhase('present');
        nextTrial();
      },
      abort: abort,
      channels: channels
    };
  }

  // 記録用のレコードを組み立てる。
  // 単一チャンネルのときは先頭チャンネルの指標をトップレベルにも出しておく
  // （履歴画面と集計をチャンネル数に依存させないため）。
  function buildRecord(config, perChannel, mode) {
    const head = perChannel[0];
    const rec = {
      version: 2,
      datetime: new Date().toISOString(),
      responseMode: mode,
      n: config.n,
      modality: perChannel.length === 1 ? head.modality : 'dual',
      trials: config.trials,
      seed: config.seed,
      settings: {
        stimulusMs: config.stimulusMs,
        isiMs: config.isiMs,
        targetRate: config.targetRate,
        lure: !!config.lure,
        excludeCenter: config.excludeCenter !== false,
        channels: config.channels.map(c => ({ modalityId: c.modalityId, key: c.key }))
      },
      channels: perChannel
    };

    if (mode === 'realtime') {
      rec.targets = head.targets;
      rec.hits = head.hits;
      rec.misses = head.misses;
      rec.falseAlarms = head.falseAlarms;
      rec.correctRejections = head.correctRejections;
      rec.hitRate = round3(head.hitRate);
      rec.faRate = round3(head.faRate);
      rec.dPrime = head.dPrime;
      rec.meanRt = head.meanRt;
      rec.accuracy = null;
    } else {
      rec.questions = head.questions;
      rec.correct = head.correct;
      rec.incorrect = head.incorrect;
      rec.accuracy = round3(head.accuracy);
      rec.streak = head.streak;
      rec.meanRt = head.meanRt;
      rec.hitRate = null;
      rec.faRate = null;
      rec.dPrime = null;
    }
    return rec;
  }

  function round3(v) { return Math.round(v * 1000) / 1000; }

  NB.runBlock = runBlock;
})(window.NB = window.NB || {});
