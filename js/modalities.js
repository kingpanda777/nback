/* modalities.js — 提示方法と入力方法。core.js が作った記号列を「どう出し、どう受け取るか」だけを持つ。
   どのモダリティも同じ形をしているので、第2段階で audio を足すときは
   このファイルに1つ登録するだけで済む（判定側は触らない）。

   共通の形:
     id        文字列ID（記録にそのまま残す）
     label     画面表示名
     kind      'visual' | 'audio'
     alphabet(settings) -> 記号の配列
     format(symbol)     -> 人が読める表記（結果画面用）

     -- 提示 --
     mount(container) -> handle
     show(handle, symbol)
     hide(handle)
     unmount(handle)

   入力パッドはここには置かない。自分のペースで進む方式が paced.js に自前で持つ。
   ここは「どう出すか」だけ。
*/
(function (NB) {
  'use strict';

  const M = {};

  // 3×3グリッドのマス番号 → 位置名
  const CELL_NAMES = ['左上', '上', '右上', '左', '中央', '右', '左下', '下', '右下'];

  function makeGrid(className) {
    const grid = document.createElement('div');
    grid.className = className;
    const cells = [];
    for (let i = 0; i < 9; i++) {
      const c = document.createElement('div');
      c.className = 'cell';
      c.dataset.index = String(i);
      grid.appendChild(c);
      cells.push(c);
    }
    return { grid: grid, cells: cells };
  }

  /* タップとクリックの両方から同じ処理に入れる。
     pointerdown は「押した瞬間」を拾えるので基本はこちら。
     click は Pointer Events が無い環境向けの保険で、
     直前に pointerdown が来ていたら二重に数えない。 */
  function bindTap(el, run) {
    let lastPointer = 0;
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (el.disabled) return;
      lastPointer = Date.now();
      tapFeedback(el);
      run();
    });
    el.addEventListener('click', function (e) {
      e.preventDefault();
      if (el.disabled) return;
      if (Date.now() - lastPointer < 700) return;
      tapFeedback(el);
      run();
    });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  // 押したことが分かるように、色を変えて対応端末では軽く振動させる
  function tapFeedback(el) {
    el.classList.add('pressed');
    setTimeout(function () { el.classList.remove('pressed'); }, 140);
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* 無視 */ } }
  }

  // ---- 1〜9の数字を中央に表示 ---------------------------------------------
  M['visual-number'] = {
    id: 'visual-number',
    label: '数字 (1〜9)',
    kind: 'visual',
    defaultKey: 'SPACE',

    alphabet: function () {
      return ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    },
    format: function (s) { return s; },

    mount: function (container) {
      const el = document.createElement('div');
      el.className = 'stim-number';
      container.appendChild(el);
      return { el: el };
    },
    show: function (h, symbol) { h.el.textContent = symbol; h.el.classList.add('on'); },
    hide: function (h) { h.el.textContent = ''; h.el.classList.remove('on'); },
    unmount: function (h) { h.el.remove(); },
  };

  // ---- 3×3グリッドの位置 ---------------------------------------------------
  M['visual-position'] = {
    id: 'visual-position',
    label: '位置 (3×3グリッド)',
    kind: 'visual',
    defaultKey: 'SPACE',

    alphabet: function (settings) {
      const cells = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];
      // 中央を除いた8マスを使うのが標準
      return (settings && settings.excludeCenter === false) ? cells : cells.filter(c => c !== '4');
    },
    format: function (s) { return CELL_NAMES[Number(s)]; },

    mount: function (container) {
      const g = makeGrid('stim-grid');
      container.appendChild(g.grid);
      return { el: g.grid, cells: g.cells };
    },
    show: function (h, symbol) { h.cells[Number(symbol)].classList.add('on'); },
    hide: function (h) { h.cells.forEach(c => c.classList.remove('on')); },
    unmount: function (h) { h.el.remove(); },
  };

  // ---- 数字と位置が混ざったもの -------------------------------------------
  // 記号は 'N5'（数字の5）と 'P3'（位置の3）の2種類。
  // 試行ごとにどちらかが出る。一致判定は種類と値の両方が同じときだけ。
  // 数字は3×3グリッドの中央に出す。中央マスは位置刺激には使わないので取り違えない。
  M['mixed-number-position'] = {
    id: 'mixed-number-position',
    label: '混合 (数字 + 位置)',
    kind: 'visual',
    defaultKey: 'SPACE',

    alphabet: function () {
      const nums = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => 'N' + d);
      const pos = ['0', '1', '2', '3', '5', '6', '7', '8'].map(c => 'P' + c);  // 中央は数字用に空ける
      return nums.concat(pos);
    },
    format: function (s) {
      return s[0] === 'N' ? '数字' + s.slice(1) : CELL_NAMES[Number(s.slice(1))];
    },

    mount: function (container) {
      const wrap = document.createElement('div');
      wrap.className = 'stim-mixed';
      const g = makeGrid('stim-grid');
      const digit = document.createElement('div');
      digit.className = 'stim-mixed-digit';
      wrap.appendChild(g.grid);
      wrap.appendChild(digit);
      container.appendChild(wrap);
      return { el: wrap, cells: g.cells, digit: digit };
    },
    show: function (h, symbol) {
      if (symbol[0] === 'N') {
        h.digit.textContent = symbol.slice(1);
        h.digit.classList.add('on');
      } else {
        h.cells[Number(symbol.slice(1))].classList.add('on');
      }
    },
    hide: function (h) {
      h.digit.textContent = '';
      h.digit.classList.remove('on');
      h.cells.forEach(c => c.classList.remove('on'));
    },
    unmount: function (h) { h.el.remove(); },
  };

  // ---- 読み上げられるかな -------------------------------------------------
  /* 事前録音した音声ファイル（audio/*.mp3）。記号名がそのままファイル名。
     英字の子音（C,H,K,L,...）ではなくかなにしたのは、聞き分けやすく
     口に出して復唱しやすいため。互いに似ていない8音を選んである。

     読み込みと再生は audio.js が持つ。ここは「いつ鳴らすか」だけ。 */
  const KANA = { a: 'あ', ka: 'か', shi: 'し', tsu: 'つ', ne: 'ね', ho: 'ほ', mu: 'む', ro: 'ろ' };
  const CLIPS = ['a', 'ka', 'shi', 'tsu', 'ne', 'ho', 'mu', 'ro'];

  M['audio-letter'] = {
    id: 'audio-letter',
    label: '音声 (かな)',
    kind: 'audio',
    defaultKey: 'SPACE',

    alphabet: function () { return CLIPS.slice(); },
    format: function (s) { return KANA[s] || s; },

    mount: function (container) {
      const el = document.createElement('div');
      el.className = 'stim-audio';
      // 鳴っていることだけを示す。何が鳴ったかは出さない。
      el.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M4 9h3.5L12 4.5v15L7.5 15H4z"/>' +
        '<path class="wave w1" d="M15.5 8.5a5 5 0 0 1 0 7"/>' +
        '<path class="wave w2" d="M18 6a8.5 8.5 0 0 1 0 12"/>' +
        '</svg>';
      container.appendChild(el);
      return { el: el };
    },

    /* 見た目は8音とも同じにすること。音ごとに変えると
       耳を使わずに目だけで解けてしまい、音のNバックにならない。 */
    show: function (h, symbol) {
      NB.audio.play(symbol);
      h.el.classList.add('on');
    },
    // 音は途中で切らない。切ると何の音か分からなくなる。
    // 次の音が鳴るときに audio.js 側が前の音を止める。
    hide: function (h) { h.el.classList.remove('on'); },
    unmount: function (h) { NB.audio.stop(); h.el.remove(); },
  };

  // ---- 第2段階の残り -------------------------------------------------------
  // dual は「チャンネルを2本にする」だけで、runner はすでに複数チャンネルを回せる。
  // 自分のペースで音を答えさせるなら、入力パッドは paced.js の TASKS 側に足す。

  NB.bindTap = bindTap;
  NB.tapFeedback = tapFeedback;
  NB.modalities = M;
  NB.modalityList = function () { return Object.keys(M).map(k => M[k]); };
  NB.cellNames = CELL_NAMES;
})(window.NB = window.NB || {});
