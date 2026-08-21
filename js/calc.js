/* calc.js — 計算Nバック。既存の2方式（リアルタイム判定 / 提示後に入力）とは独立した課題。

   式が1問ずつ出る。その答えを覚えておき、N個前の答えを入力する。
   タイマーは使わない。入力すると次の問題に進む（自分のペース）。

   N がそのまま難易度になる。計算をしながら答えを N 個ぶん保持し続けるので、
   提示後入力（記憶スパン）とは負荷のかかり方が違う。

   将来 答えを2桁に広げるとき:
     - config.answerMax を 99 にする（記号の集合が '0'〜'99' に広がる）
     - config.answerDigits を 2 にすると、入力パッドは2桁ぶん受け付けてから確定する
       （pushDigit がすでにその形になっている）
     - maxOperand は answerMax から決めているので、式の作り方は触らなくてよい
*/
(function (NB) {
  'use strict';

  const MODALITY = { id: 'calc-arith', label: '計算 (四則演算)' };
  const OPS = ['+', '-', '×', '÷'];

  // ---- 式の生成 -----------------------------------------------------------
  /**
   * 答えから逆算して式を作る。割り算は割り切れるものしか作らない。
   * @param {number} answer 求めさせたい答え
   * @param {string} op 演算子
   * @param {number} maxOperand 項の上限
   * @returns {Array<[number, number]>} [左辺, 右辺] の候補
   */
  function candidates(answer, op, maxOperand) {
    const a = answer;
    const out = [];

    if (op === '+') {
      // 項は答えを超えないので上限を掛けない。
      // これで足し算だけは必ず1つ以上作れる（他の演算子が作れないときの逃げ道になる）。
      for (let x = 0; x <= a; x++) out.push([x, a - x]);
      // 0 を含む式は読むまでもないので、他に選べるなら外す
      const nz = out.filter(p => p[0] > 0 && p[1] > 0);
      return nz.length ? nz : out;
    }

    if (op === '-') {
      // x - y = a。引く数は1以上。引かれる数は答えより大きくなるので桁が増える。
      for (let y = 1; y <= maxOperand; y++) out.push([a + y, y]);
      return out;
    }

    if (op === '×') {
      // 素数の答えだと 1×a しか作れない。a が上限を超えるなら掛け算は作れない。
      const top = Math.max(maxOperand, a);
      for (let x = 0; x <= top; x++) {
        for (let y = 0; y <= maxOperand; y++) {
          if (x * y === a) out.push([x, y]);
        }
      }
      // 1倍は答えがそのまま見えてしまう。他に選べるなら外す。
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

  /**
   * 答え1つぶんの問題を作る。
   * @returns {{text:string, op:string, left:number, right:number, answer:number}}
   */
  function makeProblem(answer, rng, opt) {
    const maxOperand = opt.maxOperand;
    const ops = opt.ops;
    // 演算子は一様に選ぶ。その答えで作れない演算子だけ避ける。
    const usable = ops.filter(op => candidates(answer, op, maxOperand).length > 0);
    // 足し算は必ず作れるので、ここが空になることはない。念のための保険。
    const op = usable.length ? usable[Math.floor(rng() * usable.length)] : '+';
    const pool = candidates(answer, op, maxOperand);
    const pair = pool[Math.floor(rng() * pool.length)];
    return {
      text: pair[0] + ' ' + op + ' ' + pair[1],
      op: op, left: pair[0], right: pair[1], answer: answer
    };
  }

  /**
   * ブロック1本ぶんの問題列を作る。同じシードなら同じ列になる。
   * @returns {{answers:string[], problems:Array}}
   */
  function makeBlock(config) {
    const answerMax = config.answerMax;
    const alphabet = [];
    for (let v = 0; v <= answerMax; v++) alphabet.push(String(v));

    // 答えの列。Nバック構造は要らないので n = 0 で作る（直前と同じ答えだけ避ける）。
    const seq = NB.core.generateSequence({
      n: 0, trials: config.trials, targetRate: 0,
      alphabet: alphabet, seed: config.seed
    });

    // 式のほうは別の乱数で振る。シードから決まるので再挑戦でも同じ式が出る。
    const rng = NB.core.makeRng((config.seed ^ 0x5bf03635) >>> 0);
    const opt = {
      maxOperand: answerMax <= 9 ? 9 : 12,
      ops: config.ops && config.ops.length ? config.ops : OPS
    };
    const problems = seq.symbols.map(s => makeProblem(Number(s), rng, opt));

    return { answers: seq.symbols, problems: problems };
  }

  // ---- 実行 ---------------------------------------------------------------
  /**
   * @param {object} els {stage, pad}
   * @param {object} config {n, trials, seed, answerMax, answerDigits, ops}
   * @param {object} cb {onTrialStart, onFinish, onAbort}
   */
  function runBlock(els, config, cb) {
    cb = cb || {};
    const stage = els.stage;
    const pad = els.pad;
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
    stage.classList.remove('stage-recall');
    stage.classList.add('stage-calc');
    stage.innerHTML = '';
    pad.classList.remove('pad-input');
    pad.classList.add('pad-calc');
    pad.innerHTML = '';
    pad.hidden = false;

    // --- 画面 ---
    const head = document.createElement('div');
    head.className = 'calc-head';
    head.innerHTML = '<div class="calc-ask"></div>';
    stage.appendChild(head);

    const problemEl = document.createElement('div');
    problemEl.className = 'calc-problem';
    stage.appendChild(problemEl);

    const noteEl = document.createElement('div');
    noteEl.className = 'calc-note';
    stage.appendChild(noteEl);

    const askEl = head.querySelector('.calc-ask');

    // 数字パッド（0〜9）とキーの代わりの「次へ」。キーボードは使わない。
    const padWrap = document.createElement('div');
    padWrap.className = 'calc-pad';
    const digitBtns = [];
    for (let d = 1; d <= 9; d++) digitBtns.push(makeDigit(String(d)));
    const zero = makeDigit('0');
    zero.classList.add('calc-zero');
    digitBtns.push(zero);
    digitBtns.forEach(b => padWrap.appendChild(b));
    pad.appendChild(padWrap);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'primary calc-next';
    nextBtn.textContent = '次へ';
    NB.bindTap(nextBtn, function () { advance(); });
    pad.appendChild(nextBtn);

    function makeDigit(d) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'input-cell calc-digit';
      b.textContent = d;
      b.dataset.digit = d;
      NB.bindTap(b, function () { pushDigit(d); });
      return b;
    }

    /* 桁を1つ受け取る。1桁のうちは押した時点で確定。
       answerDigits を 2 にすれば、2桁そろってから確定する。 */
    function pushDigit(d) {
      if (finished || trial < n) return;
      entry += d;
      if (entry.length < answerDigits) {
        noteEl.textContent = '入力中: ' + entry;
        return;
      }
      const value = String(Number(entry));   // '07' → '7'
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
      problemEl.textContent = block.problems[trial].text;
      askEl.textContent = memorising
        ? '覚えるだけ（あと ' + (n - trial) + ' 問）'
        : n + ' 個前の答えは？';
      noteEl.textContent = memorising
        ? 'この式の答えを覚えて「次へ」'
        : '第 ' + (trial - n + 1) + ' 問 / 全 ' + questions + ' 問';
      // 覚えるだけの間は数字を押させない
      padWrap.hidden = memorising;
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

    function onKeyDown(e) {
      // 回答はボタンのみ。キーは中止だけ受ける。
      if (e.key === 'Escape') abort();
    }

    function teardown() {
      document.removeEventListener('keydown', onKeyDown);
      digitBtns.forEach(b => b.disabled = true);
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
      const expected = block.answers.slice(0, questions);
      const s = NB.core.scoreRecall(expected, given);
      return {
        version: 2,
        datetime: new Date().toISOString(),
        responseMode: 'calc',
        n: n,
        modality: MODALITY.id,
        trials: trials,
        questions: s.questions,
        correct: s.correct,
        incorrect: s.incorrect,
        accuracy: Math.round(s.accuracy * 1000) / 1000,
        streak: s.streak,
        meanRt: s.meanRt,
        // この方式では使わない指標。履歴側が同じ形で扱えるように null で置く。
        hitRate: null, faRate: null, dPrime: null,
        seed: config.seed,
        settings: {
          answerMax: config.answerMax,
          answerDigits: answerDigits,
          ops: config.ops || OPS,
          channels: [{ modalityId: MODALITY.id }]
        },
        channels: [{
          modality: MODALITY.id,
          seed: config.seed,
          problems: block.problems.map(p => p.text),
          symbols: block.answers.join(','),
          expected: expected,
          answers: given.map(a => a ? a.symbol : null),
          rts: given.map(a => a ? a.rt : null),
          correctFlags: s.correctFlags.map(v => v ? 1 : 0).join(''),
          questions: s.questions, correct: s.correct, incorrect: s.incorrect,
          accuracy: s.accuracy, streak: s.streak, meanRt: s.meanRt
        }]
      };
    }

    return {
      start: function () { acquireWakeLock(); document.addEventListener('keydown', onKeyDown); advance(); },
      abort: abort
    };
  }

  NB.calc = {
    MODALITY: MODALITY,
    OPS: OPS,
    candidates: candidates,
    makeProblem: makeProblem,
    makeBlock: makeBlock,
    runBlock: runBlock
  };
})(window.NB = window.NB || {});
