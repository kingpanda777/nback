/* paced.js — 自分のペースで進むNバック課題。

   刺激が1つ出る → その内容を覚える → N個前に出た内容を入力する → 次が出る。
   タイマーは使わない。入力した瞬間に次へ進む。

   3つの課題が同じ流れを共有する。違うのは「何を出すか」と「どう答えさせるか」だけなので、
   TASKS に1つ足せば課題が増える。実行部・採点・記録は共通。

     calc-arith      式が出る → 答えを 0〜9 で入力
     paced-number    数字が出る → その数字を 0〜9 で入力
     paced-position  マスが光る → そのマスを3×3グリッドで入力

   課題のIDはリアルタイム判定のモダリティとは別にしてある。
   同じ 'visual-number' でも、リアルタイムは1〜9、こちらは0〜9で記号集合が違う。
   同じIDにすると記録を後から読むときに取り違える。

   N がそのまま難易度。毎試行で新しい刺激を処理しながら N 個ぶん保持し続ける。

   将来 計算の答えを2桁に広げるとき:
     - config.answerMax を 99 にする
     - config.answerDigits を 2 にすると、入力パッドは2桁そろってから確定する
       （pushValue がすでにその形になっている）
*/
(function (NB) {
  'use strict';

  const OPS = ['+', '-', '×', '÷'];

  // ---- 計算課題の式づくり -------------------------------------------------
  /**
   * 答えから逆算して式を作る。割り算は割り切れるものしか作らない。
   * @returns {Array<[number, number]>} [左辺, 右辺] の候補
   */
  function candidates(answer, op, maxOperand) {
    const a = answer;
    const out = [];

    if (op === '+') {
      // 項は答えを超えないので上限を掛けない。
      // これで足し算だけは必ず1つ以上作れる（他の演算子が作れないときの逃げ道になる）。
      for (let x = 0; x <= a; x++) out.push([x, a - x]);
      const nz = out.filter(p => p[0] > 0 && p[1] > 0);   // 0 を含む式は読むまでもない
      return nz.length ? nz : out;
    }

    if (op === '-') {
      // x - y = a。引く数は1以上。引かれる数は答えより大きくなるので桁が増える。
      for (let y = 1; y <= maxOperand; y++) out.push([a + y, y]);
      return out;
    }

    if (op === '×') {
      const top = Math.max(maxOperand, a);
      for (let x = 0; x <= top; x++) {
        for (let y = 0; y <= maxOperand; y++) {
          if (x * y === a) out.push([x, y]);
        }
      }
      // 1倍は答えがそのまま見えてしまう。他に選べるなら外す。
      // 答えが素数だと 1×a しか作れないので、そのときは諦める。
      const nt = out.filter(p => p[0] > 1 && p[1] > 1);
      return nt.length ? nt : out;
    }

    // ÷ : x ÷ y = a。x = a×y なので必ず割り切れる。
    // 割られる数が大きくなりすぎると暗算にならないので、そこだけ抑える。
    for (let y = 2; y <= maxOperand; y++) {
      const x = a * y;
      if (x <= 999) out.push([x, y]);
    }
    return out;
  }

  function makeProblem(answer, rng, opt) {
    const usable = opt.ops.filter(op => candidates(answer, op, opt.maxOperand).length > 0);
    // 足し算は必ず作れるので、ここが空になることはない。念のための保険。
    const op = usable.length ? usable[Math.floor(rng() * usable.length)] : '+';
    const pool = candidates(answer, op, opt.maxOperand);
    const pair = pool[Math.floor(rng() * pool.length)];
    return {
      text: pair[0] + ' ' + op + ' ' + pair[1],
      op: op, left: pair[0], right: pair[1], answer: answer
    };
  }

  // ---- 入力パッド ---------------------------------------------------------
  // 0〜9 のテンキー。0 は横いっぱいに置く。
  function digitPad(container, symbols, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'paced-pad paced-pad-digits';
    const buttons = [];
    const order = symbols.slice().sort((a, b) => Number(a) - Number(b));
    const rest = order.filter(s => s !== '0');
    rest.concat(order.indexOf('0') >= 0 ? ['0'] : []).forEach(function (sym) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'input-cell paced-digit';
      if (sym === '0') b.classList.add('paced-zero');
      b.textContent = sym;
      b.dataset.value = sym;
      NB.bindTap(b, function () { onPick(sym); });
      wrap.appendChild(b);
      buttons.push(b);
    });
    container.appendChild(wrap);
    return { el: wrap, buttons: buttons };
  }

  // 3×3グリッド。数字ボタンには置き換えない（位置は位置で答える）。
  function gridPad(container, symbols, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'paced-pad paced-pad-grid';
    const buttons = [];
    for (let i = 0; i < 9; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'input-cell paced-cell';
      b.dataset.value = String(i);
      if (symbols.indexOf(String(i)) < 0) {
        b.classList.add('blank');
        b.disabled = true;                 // 出題に使わないマスは押させない
      } else {
        NB.bindTap(b, function () { onPick(String(i)); });
      }
      wrap.appendChild(b);
      buttons.push(b);
    }
    container.appendChild(wrap);
    return { el: wrap, buttons: buttons };
  }

  /* 位置と数字を左右に並べたパッド。どちらを押したかで「種類」も同時に決まるので、
     混合でも1タップで答えられる。 */
  function dualPad(container, symbols, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'paced-pad-dual';
    const buttons = [];

    const posGroup = document.createElement('div');
    posGroup.className = 'paced-group';
    posGroup.innerHTML = '<div class="paced-group-label">位置</div>';
    const pos = gridPad(posGroup, symbols.filter(s => s[0] === 'P').map(s => s.slice(1)),
      cell => onPick('P' + cell));
    wrap.appendChild(posGroup);

    const numGroup = document.createElement('div');
    numGroup.className = 'paced-group';
    numGroup.innerHTML = '<div class="paced-group-label">数字</div>';
    const num = digitPad(numGroup, symbols.filter(s => s[0] === 'N').map(s => s.slice(1)),
      d => onPick('N' + d));
    wrap.appendChild(numGroup);

    container.appendChild(wrap);
    return { el: wrap, buttons: buttons.concat(pos.buttons, num.buttons) };
  }

  // ---- 課題の定義 ---------------------------------------------------------
  /* 各課題が持つもの:
       label       画面表示名
       alphabet(config)              出題に使う記号
       prepare(config, symbols)      追加データ（式など）。無ければ null
       mount(container)              提示用の DOM
       show(handle, symbol, extra)   刺激を出す
       pad(container, symbols, cb)   入力パッド
       format(symbol)                結果画面での表記
       askLabel(n)                   設問の文言 */
  const TASKS = {
    'calc-arith': {
      label: '計算 (四則演算)',
      alphabet: function (config) {
        const out = [];
        for (let v = 0; v <= (config.answerMax || 9); v++) out.push(String(v));
        return out;
      },
      prepare: function (config, symbols) {
        // 式は別の乱数で振る。シードから決まるので再挑戦でも同じ式が出る。
        const rng = NB.core.makeRng((config.seed ^ 0x5bf03635) >>> 0);
        const opt = {
          maxOperand: (config.answerMax || 9) <= 9 ? 9 : 12,
          ops: (config.ops && config.ops.length) ? config.ops : OPS
        };
        return symbols.map(s => makeProblem(Number(s), rng, opt));
      },
      mount: function (container) {
        const el = document.createElement('div');
        el.className = 'paced-problem';
        container.appendChild(el);
        return { el: el };
      },
      show: function (h, symbol, extra) { h.el.textContent = extra.text; },
      pad: digitPad,
      format: function (s) { return s; },
      askLabel: function (n) { return n + ' 個前の答えは？'; },
      memoLabel: 'この式の答えを覚えて「次へ」'
    },

    'paced-number': {
      label: '数字 (0〜9)',
      alphabet: function () {
        const out = [];
        for (let v = 0; v <= 9; v++) out.push(String(v));
        return out;
      },
      prepare: function () { return null; },
      mount: function (container) {
        const el = document.createElement('div');
        el.className = 'paced-problem';
        container.appendChild(el);
        return { el: el };
      },
      show: function (h, symbol) { h.el.textContent = symbol; },
      pad: digitPad,
      format: function (s) { return s; },
      askLabel: function (n) { return n + ' 個前の数字は？'; },
      memoLabel: 'この数字を覚えて「次へ」'
    },

    'paced-mixed': {
      label: '混合 (数字 + 位置)',
      /* 数字は 0〜9、位置は中央を除く8マス。中央は数字の表示に使うので位置には回せない。
         数字の範囲は paced-number と揃えてある（リアルタイムの混合は 1〜9 で別物）。 */
      alphabet: function () {
        const nums = [];
        for (let v = 0; v <= 9; v++) nums.push('N' + v);
        return nums.concat(['0', '1', '2', '3', '5', '6', '7', '8'].map(c => 'P' + c));
      },
      prepare: function () { return null; },
      // 提示は既存の混合モダリティをそのまま使う
      mount: function (container) { return NB.modalities['mixed-number-position'].mount(container); },
      show: function (h, symbol) {
        NB.modalities['mixed-number-position'].hide(h);
        NB.modalities['mixed-number-position'].show(h, symbol);
      },
      pad: dualPad,
      format: function (s) {
        return s[0] === 'N' ? '数字' + s.slice(1) : NB.cellNames[Number(s.slice(1))];
      },
      askLabel: function (n) { return n + ' 個前に出たものは？'; },
      memoLabel: 'これを覚えて「次へ」'
    },

    'paced-position': {
      label: '位置 (3×3グリッド)',
      // 提示は既存のモダリティをそのまま使う（中央を除くかどうかも同じ設定）
      alphabet: function (config) { return NB.modalities['visual-position'].alphabet(config); },
      prepare: function () { return null; },
      mount: function (container) { return NB.modalities['visual-position'].mount(container); },
      show: function (h, symbol) {
        NB.modalities['visual-position'].hide(h);
        NB.modalities['visual-position'].show(h, symbol);
      },
      pad: gridPad,
      format: function (s) { return NB.cellNames[Number(s)]; },
      askLabel: function (n) { return n + ' 個前に光ったマスは？'; },
      memoLabel: 'このマスを覚えて「次へ」'
    }
  };

  // ---- ブロックの生成 -----------------------------------------------------
  function makeBlock(config) {
    const task = TASKS[config.task];
    /* 毎試行が出題なのでターゲットは置かない（targetRate 0）。
       ただし N は渡す。ひっかけを N±1 の位置に置くのに要るため。
       N個前との一致は禁じない。禁じると「いま出ているものは答えではない」と
       分かってしまい、選択肢が狭まる。 */
    const seq = NB.core.generateSequence({
      n: config.n, trials: config.trials, targetRate: 0,
      alphabet: task.alphabet(config), seed: config.seed,
      lure: !!config.lure
    });
    return { symbols: seq.symbols, extras: task.prepare(config, seq.symbols), seq: seq };
  }

  // ---- 実行 ---------------------------------------------------------------
  /**
   * @param {object} els {stage, pad}
   * @param {object} config {task, n, trials, seed, ...課題ごとの設定}
   * @param {object} cb {onTrialStart, onFinish, onAbort}
   */
  function runBlock(els, config, cb) {
    cb = cb || {};
    const stage = els.stage;
    const pad = els.pad;
    const task = TASKS[config.task];
    const n = config.n;
    const trials = config.trials;
    const questions = trials - n;
    const answerDigits = config.answerDigits || 1;

    const block = makeBlock(config);
    const given = new Array(questions).fill(null);

    let trial = -1;
    let shownAt = 0;
    let entry = '';            // 2桁以降に広げるときの入力バッファ
    let finished = false;
    let wakeLock = null;

    // 前のブロックの画面を消す
    stage.className = 'stage stage-paced';
    stage.innerHTML = '';
    pad.className = 'pad pad-paced';
    pad.innerHTML = '';
    pad.hidden = false;

    // --- 画面 ---
    const askEl = document.createElement('div');
    askEl.className = 'paced-ask';
    stage.appendChild(askEl);

    const slot = document.createElement('div');
    slot.className = 'paced-slot';
    stage.appendChild(slot);
    const handle = task.mount(slot);

    const noteEl = document.createElement('div');
    noteEl.className = 'paced-note';
    stage.appendChild(noteEl);

    // --- 入力 ---
    const padHandle = task.pad(pad, task.alphabet(config), pushValue);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'primary paced-next';
    nextBtn.textContent = '次へ';
    NB.bindTap(nextBtn, function () { advance(); });
    pad.appendChild(nextBtn);

    /* 1つ受け取る。1桁のうちは押した時点で確定。
       answerDigits を 2 にすれば、2桁そろってから確定する。 */
    function pushValue(v) {
      if (finished || trial < n) return;
      entry += v;
      if (entry.length < answerDigits) {
        noteEl.textContent = '入力中: ' + entry;
        return;
      }
      const value = answerDigits > 1 ? String(Number(entry)) : entry;   // '07' → '7'
      entry = '';
      given[trial - n] = { symbol: value, rt: Math.round(performance.now() - shownAt) };
      advance();
    }

    function advance() {
      trial++;
      entry = '';
      if (trial >= trials) { finish(); return; }
      render();
      if (cb.onTrialStart) cb.onTrialStart(trial, trials);
    }

    function render() {
      const memorising = trial < n;
      task.show(handle, block.symbols[trial], block.extras ? block.extras[trial] : null);
      askEl.textContent = memorising
        ? '覚えるだけ（あと ' + (n - trial) + ' 問）'
        : task.askLabel(n);
      noteEl.textContent = memorising
        ? task.memoLabel
        : '第 ' + (trial - n + 1) + ' 問 / 全 ' + questions + ' 問';
      // 覚えるだけの間は答えさせない
      padHandle.el.hidden = memorising;
      nextBtn.hidden = !memorising;
      shownAt = performance.now();
    }

    // ---- 画面を消さない ---------------------------------------------------
    // 考えている間は触らないので、自分のペース方式ほど消灯しやすい
    function acquireWakeLock() {
      if (!navigator.wakeLock) return;
      navigator.wakeLock.request('screen')
        .then(function (l) { wakeLock = l; })
        .catch(function () { /* 拒否されても課題は続く */ });
    }
    function releaseWakeLock() {
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    }

    // 回答はボタンのみ。キーは中止だけ受ける。
    function onKeyDown(e) { if (e.key === 'Escape') abort(); }

    function teardown() {
      document.removeEventListener('keydown', onKeyDown);
      padHandle.buttons.forEach(b => b.disabled = true);
      nextBtn.disabled = true;
      releaseWakeLock();
    }

    function finish() {
      if (finished) return;
      finished = true;
      teardown();
      if (cb.onFinish) cb.onFinish(buildRecord());
    }

    function abort() {
      if (finished) return;
      finished = true;
      teardown();
      if (cb.onAbort) cb.onAbort();
    }

    function buildRecord() {
      const expected = block.symbols.slice(0, questions);
      const s = NB.core.scoreAnswers(expected, given);
      const channel = {
        modality: config.task,
        seed: config.seed,
        lures: block.seq.lures,
        lurePositions: block.seq.lurePositions,
        symbols: block.symbols.join(','),
        expected: expected,
        answers: given.map(a => a ? a.symbol : null),
        rts: given.map(a => a ? a.rt : null),
        correctFlags: s.correctFlags.map(v => v ? 1 : 0).join(''),
        questions: s.questions, correct: s.correct, incorrect: s.incorrect,
        accuracy: s.accuracy, streak: s.streak, meanRt: s.meanRt
      };
      if (block.extras) channel.problems = block.extras.map(e => e.text);

      return {
        version: 3,
        datetime: new Date().toISOString(),
        responseMode: 'paced',
        task: config.task,
        n: n,
        modality: config.task,
        trials: trials,
        questions: s.questions,
        correct: s.correct,
        incorrect: s.incorrect,
        accuracy: Math.round(s.accuracy * 1000) / 1000,
        streak: s.streak,
        meanRt: s.meanRt,
        // この方式では使わない指標。履歴が同じ形で扱えるように null で置く。
        hitRate: null, faRate: null, dPrime: null,
        seed: config.seed,
        lure: !!config.lure,
        lures: block.seq.lures,
        settings: {
          task: config.task,
          lure: !!config.lure,
          answerMax: config.answerMax || null,
          answerDigits: answerDigits,
          ops: config.task === 'calc-arith' ? (config.ops || OPS) : null,
          excludeCenter: config.excludeCenter !== false,
          channels: [{ modalityId: config.task }]
        },
        channels: [channel]
      };
    }

    return {
      start: function () {
        acquireWakeLock();
        document.addEventListener('keydown', onKeyDown);
        advance();
      },
      abort: abort
    };
  }

  NB.paced = {
    TASKS: TASKS,
    OPS: OPS,
    taskIds: function () { return Object.keys(TASKS); },
    label: function (id) { return TASKS[id] ? TASKS[id].label : id; },
    candidates: candidates,
    makeProblem: makeProblem,
    makeBlock: makeBlock,
    runBlock: runBlock
  };
})(window.NB = window.NB || {});
