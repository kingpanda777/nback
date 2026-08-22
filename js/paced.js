/* paced.js — 自分のペースで進むNバック課題。

   刺激が1つ出る → その内容を覚える → N個前に出た内容を入力する → 次が出る。
   回答の区間はタイマーを使わない。入力した瞬間に次へ進む。

   最初の N 問（覚えるだけの区間）はリアルタイム方式と同じく自動で流れる。
   答える相手がいない区間で「次へ」を押させても操作が増えるだけなため。

   どの課題も同じ流れを共有する。違うのは「何を出すか」と「どう答えさせるか」だけなので、
   TASKS に1つ足せば課題が増える。実行部・採点・記録は共通。

     calc-arith        式が出る → 答えを 0〜9 で入力
     paced-number      数字が出る → その数字を 0〜9 で入力
     paced-position    マスが光る → そのマスを3×3グリッドで入力
     paced-kana        音が鳴る → その音をかなボタンで入力
     paced-mixed       数字かマス → 数字パッドかグリッドで入力
     paced-mixed-kana  数字かマスか音 → 3種類のパッドで入力

   音を鳴らす課題は clips(config) を持つ。app.js がこれを見て
   ブロックの前に読み込んでおく（出題のたびに読み込むと発音がずれる）。

   並び順は order で名乗る。順番の定義は modalities.js の ORDER 1か所だけ。

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

  /* 覚える区間の自動送り。1問あたりの長さと、次の前に消す長さ。
     消す時間が無いと、ひっかけ ON で同じ刺激が続いたとき
     画面が変わらず、1問流れたことに気づけない。 */
  const MEMO_MS = 2000;
  const MEMO_GAP_MS = 400;

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

  // かな8個。2行×4列に並べる。
  function kanaPad(container, symbols, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'paced-pad paced-pad-kana';
    const buttons = [];
    // 音の並びは音声ファイルの登録順に合わせる（毎回同じ位置にあるほうが押しやすい）
    const order = NB.kanaClips.filter(k => symbols.indexOf(k) >= 0);
    order.forEach(function (k) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'input-cell paced-kana';
      b.textContent = NB.kanaLabels[k] || k;
      b.dataset.value = k;
      NB.bindTap(b, function () { onPick(k); });
      wrap.appendChild(b);
      buttons.push(b);
    });
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

  /* かな8個を位置と同じ3×3の枠に収める。8音なので右下が1つ空く。
     位置グリッドと同じ大きさ・同じ形にすることで、
     26個あっても3つの塊として一目で見分けられる。 */
  function kanaGridPad(container, symbols, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'paced-pad paced-pad-grid';
    const buttons = [];
    const order = NB.kanaClips.filter(k => symbols.indexOf(k) >= 0);
    for (let i = 0; i < 9; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'input-cell paced-cell paced-kana';
      if (i < order.length) {
        const k = order[i];
        b.textContent = NB.kanaLabels[k] || k;
        b.dataset.value = k;
        NB.bindTap(b, function () { onPick(k); });
      } else {
        b.classList.add('blank');
        b.disabled = true;               // 空きマス。位置グリッドの中央と同じ扱い
      }
      wrap.appendChild(b);
      buttons.push(b);
    }
    container.appendChild(wrap);
    return { el: wrap, buttons: buttons };
  }

  /* 位置・数字・かなの3種類。
     左列に位置とかなを縦に（どちらも同じ3×3）、右列に数字を置く。
     かなを横一列に伸ばすと入力パッド全体が縦に長くなり、
     刺激や「もう一度聞く」に重なってしまう。 */
  function triPad(container, symbols, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'paced-pad-tri';

    const left = document.createElement('div');
    left.className = 'paced-tri-col';

    const posGroup = document.createElement('div');
    posGroup.className = 'paced-group';
    posGroup.innerHTML = '<div class="paced-group-label">位置</div>';
    const pos = gridPad(posGroup, symbols.filter(s => s[0] === 'P').map(s => s.slice(1)),
      cell => onPick('P' + cell));
    left.appendChild(posGroup);

    const kanaGroup = document.createElement('div');
    kanaGroup.className = 'paced-group';
    kanaGroup.innerHTML = '<div class="paced-group-label">かな</div>';
    const kana = kanaGridPad(kanaGroup, symbols.filter(s => s[0] === 'K').map(s => s.slice(1)),
      k => onPick('K' + k));
    left.appendChild(kanaGroup);
    wrap.appendChild(left);

    const right = document.createElement('div');
    right.className = 'paced-tri-col';
    const numGroup = document.createElement('div');
    numGroup.className = 'paced-group';
    numGroup.innerHTML = '<div class="paced-group-label">数字</div>';
    const num = digitPad(numGroup, symbols.filter(s => s[0] === 'N').map(s => s.slice(1)),
      d => onPick('N' + d));
    right.appendChild(numGroup);
    wrap.appendChild(right);

    container.appendChild(wrap);
    return { el: wrap, buttons: pos.buttons.concat(num.buttons, kana.buttons) };
  }

  // ---- 音の提示まわり -----------------------------------------------------
  /* 「もう一度聞く」は いま出ている刺激 だけを鳴らし直す。
     視覚の課題は答えるまで刺激が画面に出たままなので、これは同じ条件に
     揃えるためのもので、廃止した「1つ戻る」とは別物。
     前の刺激には決して戻さないこと。戻すと見直しの時間を与えて課題が変わる。 */
  function makeReplay(h) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost paced-replay';
    btn.textContent = 'もう一度聞く';
    NB.bindTap(btn, function () {
      if (h.symbol) playAndPulse(h, h.symbol, true);
    });
    h.replay = btn;
    return btn;
  }

  // かなの試行でだけ出す。数字や位置のときに出ていても押せず、紛らわしい。
  function syncReplay(h) {
    if (h.replay) h.replay.hidden = !h.symbol;
  }

  function playAndPulse(h, symbol, isReplay) {
    h.symbol = symbol;
    NB.audio.play(symbol);
    const el = h.speaker || h.el;
    el.classList.remove('on');
    // クラスを付け直してアニメーションを再生させる
    void el.offsetWidth;
    el.classList.add('on');
    if (!isReplay) syncReplay(h);
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
      order: 'calc',
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
      hide: function (h) { h.el.textContent = ''; },
      pad: digitPad,
      format: function (s) { return s; },
      askLabel: function (n) { return n + ' 個前の答えは？'; },
      memoLabel: 'この式の答えを覚える（自動で進みます）',
      memoMs: 3000     // 式を計算してから覚えるので、他の課題より長めに取る
    },

    'paced-number': {
      label: '数字 (0〜9)',
      order: 'number',
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
      hide: function (h) { h.el.textContent = ''; },
      pad: digitPad,
      format: function (s) { return s; },
      askLabel: function (n) { return n + ' 個前の数字は？'; },
      memoLabel: 'この数字を覚える（自動で進みます）'
    },

    'paced-mixed': {
      label: '混合 (数字 + 位置)',
      order: 'mixed',
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
      hide: function (h) { NB.modalities['mixed-number-position'].hide(h); },
      pad: dualPad,
      format: function (s) {
        return s[0] === 'N' ? '数字' + s.slice(1) : NB.cellNames[Number(s.slice(1))];
      },
      askLabel: function (n) { return n + ' 個前に出たものは？'; },
      memoLabel: 'これを覚える（自動で進みます）'
    },

    'paced-position': {
      label: '位置 (3×3グリッド)',
      order: 'position',
      // 提示は既存のモダリティをそのまま使う（中央を除くかどうかも同じ設定）
      alphabet: function (config) { return NB.modalities['visual-position'].alphabet(config); },
      prepare: function () { return null; },
      mount: function (container) { return NB.modalities['visual-position'].mount(container); },
      show: function (h, symbol) {
        NB.modalities['visual-position'].hide(h);
        NB.modalities['visual-position'].show(h, symbol);
      },
      hide: function (h) { NB.modalities['visual-position'].hide(h); },
      pad: gridPad,
      format: function (s) { return NB.cellNames[Number(s)]; },
      askLabel: function (n) { return n + ' 個前に光ったマスは？'; },
      memoLabel: 'このマスを覚える（自動で進みます）'
    },

    'paced-kana': {
      label: 'かな (音声)',
      order: 'kana',
      /* 音は audio-letter と同じ8個をそのまま使う。
         リアルタイムと違って記号集合が同じなので迷うところはないが、
         課題IDは分けてある（記録を後から読むときに取り違えないため）。 */
      alphabet: function () { return NB.kanaClips.slice(); },
      clips: function () { return NB.kanaClips.slice(); },
      prepare: function () { return null; },
      mount: function (container) {
        const wrap = document.createElement('div');
        wrap.className = 'paced-audio';
        const speaker = NB.makeSpeaker('stim-audio');
        wrap.appendChild(speaker);
        const h = { el: wrap, speaker: speaker, symbol: null };
        wrap.appendChild(makeReplay(h));
        container.appendChild(wrap);
        return h;
      },
      show: function (h, symbol) { playAndPulse(h, symbol); },
      hide: function (h) { h.speaker.classList.remove('on'); },
      pad: kanaPad,
      format: function (s) { return NB.kanaLabels[s] || s; },
      askLabel: function (n) { return n + ' 個前に聞こえた音は？'; },
      memoLabel: 'この音を覚える（自動で進みます）'
    },

    'paced-mixed-kana': {
      label: '混合 (数字 + 位置 + かな)',
      order: 'mixed-kana',
      /* 数字は 0〜9、位置は中央を除く8マス、かなは8音。
         数字と位置はどちらも視覚なので一本の列として覚えられるが、
         ここに音が入ると音韻ループと視空間スケッチパッドをまたぐ列になる。
         同じ N でも 混合(数字+位置) より重い。 */
      alphabet: function () {
        const nums = [];
        for (let v = 0; v <= 9; v++) nums.push('N' + v);
        const pos = ['0', '1', '2', '3', '5', '6', '7', '8'].map(c => 'P' + c);
        return nums.concat(pos, NB.kanaClips.map(k => 'K' + k));
      },
      clips: function () { return NB.kanaClips.slice(); },
      prepare: function () { return null; },
      mount: function (container) {
        const mod = NB.modalities['mixed-number-position-kana'];
        const h = mod.mount(container);
        h.symbol = null;
        /* かなの試行だけ聞き直せるようにする。数字と位置は出たままなので要らない。
           刺激の箱の中に絶対配置で置くと入力パッドに重なるので、
           刺激の下（通常のフロー）に並べる。 */
        container.appendChild(makeReplay(h));
        return h;
      },
      show: function (h, symbol) {
        const mod = NB.modalities['mixed-number-position-kana'];
        mod.hide(h);
        h.symbol = symbol[0] === 'K' ? symbol.slice(1) : null;
        mod.show(h, symbol);
        syncReplay(h);
      },
      hide: function (h) { NB.modalities['mixed-number-position-kana'].hide(h); },
      pad: triPad,
      format: function (s) { return NB.modalities['mixed-number-position-kana'].format(s); },
      askLabel: function (n) { return n + ' 個前に出たものは？'; },
      memoLabel: 'これを覚える（自動で進みます）'
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
    let timers = [];         // 覚える区間の自動送りにだけ使う

    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

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
      // 覚える区間は自動で流れるので、聞き直している暇はない
      if (handle.replay) handle.replay.hidden = memorising || !handle.symbol;
      shownAt = performance.now();

      /* 覚える区間は自動で次へ。手前で一度消すのは、
         同じ刺激が続いたとき（ひっかけ ON で起きる）に
         画面が変わらず1問流れたことに気づけないため。 */
      if (memorising) {
        const memoMs = task.memoMs || MEMO_MS;
        timers.push(setTimeout(function () {
          if (task.hide) task.hide(handle);
        }, memoMs - MEMO_GAP_MS));
        timers.push(setTimeout(advance, memoMs));
      }
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
      clearTimers();
      document.removeEventListener('keydown', onKeyDown);
      padHandle.buttons.forEach(b => b.disabled = true);
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
    // 並び順は modalities.js の ORDER が決める。TASKS に書いた順ではない。
    taskIds: function () {
      const items = Object.keys(TASKS).map(id => ({ id: id, order: TASKS[id].order }));
      return NB.sortByOrder(items).map(o => o.id);
    },
    label: function (id) { return TASKS[id] ? TASKS[id].label : id; },
    candidates: candidates,
    makeProblem: makeProblem,
    makeBlock: makeBlock,
    runBlock: runBlock
  };
})(window.NB = window.NB || {});
