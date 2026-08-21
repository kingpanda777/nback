/* runner.js — 1ブロックを回す。
   チャンネル（提示系統）の配列を受け取り、それぞれ独立に列を生成・判定する。
   第1段階は1本、デュアルは2本。runner 自身はどちらでも同じコードで動く。

   ここが受け持つのはリアルタイム判定（no-go）だけ。
   提示中に「一致したら押す」。押さないことも回答。
   自分のペースで進む方式はタイマーを使わないので paced.js が別に持つ。

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
        responses: new Array(config.trials).fill(null).map(() => ({ responded: false, rt: null }))
      };
    });

    // 前のブロックの画面をここで消す。start() はカウントダウンのあとなので、
    // それまで待つと前回の刺激や入力パッドが裏に見えたままになる。
    stage.className = 'stage';
    stage.innerHTML = '';
    pad.className = 'pad';
    pad.innerHTML = '';
    pad.hidden = false;

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
      stage.innerHTML = '';
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

    function endPresentation() { finish(); }

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
      releaseWakeLock();
    }

    // ---- 終了 -------------------------------------------------------------
    function finish() {
      if (finished) return;
      finished = true;
      teardown();
      if (cb.onFinish) cb.onFinish(recordRealtime());
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
      return buildRecord(config, perChannel);
    }

    // ---- 開始 -------------------------------------------------------------
    // 画面はカウントダウンの前に組み立てておく。
    // start() まで待つと、数えている間ずっと下が空っぽで、
    // どこを見てどこを押すのか分からない。
    buildStage();
    buildRealtimePad();          // 押しても trial < 0 の間は無視される
    setKeyHandler(onRealtimeKey);

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
  function buildRecord(config, perChannel) {
    const head = perChannel[0];
    const rec = {
      version: 3,
      datetime: new Date().toISOString(),
      responseMode: 'realtime',
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
      channels: perChannel,
      targets: head.targets,
      hits: head.hits,
      misses: head.misses,
      falseAlarms: head.falseAlarms,
      correctRejections: head.correctRejections,
      hitRate: round3(head.hitRate),
      faRate: round3(head.faRate),
      dPrime: head.dPrime,
      meanRt: head.meanRt,
      accuracy: null
    };
    return rec;
  }

  function round3(v) { return Math.round(v * 1000) / 1000; }

  NB.runBlock = runBlock;
})(window.NB = window.NB || {});
