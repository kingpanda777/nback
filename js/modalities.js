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

     -- 入力（提示後に自分で入力する方式で使う） --
     mountInput(container, settings, onPick) -> handle
       onPick(symbol) を呼ぶ。handle.setEnabled(bool) を持つ。
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

  // 入力用の3×3パッド。labels[i] が null のマスは押せない。
  function makePad(labels, onPick, valueOf) {
    const pad = document.createElement('div');
    pad.className = 'input-grid';
    const buttons = [];
    labels.forEach(function (label, i) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'input-cell';
      b.dataset.index = String(i);
      if (label === null) {
        b.classList.add('blank');
        b.disabled = true;
      } else {
        b.textContent = label;
        bindTap(b, function () { onPick(valueOf(i)); });
      }
      pad.appendChild(b);
      buttons.push(b);
    });
    return { el: pad, buttons: buttons };
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

  function padEnabler(handles) {
    return function (on) {
      handles.forEach(function (h) {
        h.buttons.forEach(function (b) {
          if (b.classList.contains('blank')) return;
          b.disabled = !on;
        });
      });
    };
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

    // PC ではキーでも入力できる
    inputKeys: function () {
      const map = {};
      for (let d = 1; d <= 9; d++) map[String(d)] = String(d);
      return map;
    },

    mountInput: function (container, settings, onPick) {
      const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
      const pad = makePad(labels, onPick, i => labels[i]);
      const wrap = document.createElement('div');
      wrap.className = 'input-pane';
      wrap.appendChild(pad.el);
      container.appendChild(wrap);
      return { el: wrap, setEnabled: padEnabler([pad]) };
    }
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

    // 1〜9 を読み順（左上から右下）でマスに対応させる
    inputKeys: function (settings) {
      const usable = M['visual-position'].alphabet(settings);
      const map = {};
      for (let i = 0; i < 9; i++) {
        if (usable.indexOf(String(i)) >= 0) map[String(i + 1)] = String(i);
      }
      return map;
    },

    mountInput: function (container, settings, onPick) {
      const usable = M['visual-position'].alphabet(settings);
      const labels = [];
      for (let i = 0; i < 9; i++) labels.push(usable.indexOf(String(i)) >= 0 ? '' : null);
      const pad = makePad(labels, onPick, i => String(i));
      const wrap = document.createElement('div');
      wrap.className = 'input-pane';
      wrap.appendChild(pad.el);
      container.appendChild(wrap);
      return { el: wrap, setEnabled: padEnabler([pad]) };
    }
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

    // 数字は 1〜9、位置は QWE / ASD / ZXC をマスの並びに対応させる
    inputKeys: function () {
      const map = {};
      for (let d = 1; d <= 9; d++) map[String(d)] = 'N' + d;
      const keys = ['Q', 'W', 'E', 'A', 'S', 'D', 'Z', 'X', 'C'];
      keys.forEach(function (k, i) { if (i !== 4) map[k] = 'P' + i; });
      return map;
    },

    mountInput: function (container, settings, onPick) {
      // 位置と数字のパッドを並べる。どちらを押したかで「種類」も同時に決まる。
      const posLabels = [];
      for (let i = 0; i < 9; i++) posLabels.push(i === 4 ? null : '');
      const posPad = makePad(posLabels, onPick, i => 'P' + i);

      const numLabels = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
      const numPad = makePad(numLabels, onPick, i => 'N' + numLabels[i]);

      const wrap = document.createElement('div');
      wrap.className = 'input-pane input-pane-dual';
      wrap.appendChild(labelled('位置', posPad.el));
      wrap.appendChild(labelled('数字', numPad.el));
      container.appendChild(wrap);
      return { el: wrap, setEnabled: padEnabler([posPad, numPad]) };
    }
  };

  function labelled(text, el) {
    const box = document.createElement('div');
    box.className = 'input-group';
    const t = document.createElement('div');
    t.className = 'input-group-label';
    t.textContent = text;
    box.appendChild(t);
    box.appendChild(el);
    return box;
  }

  // ---- 第2段階の追加位置 ---------------------------------------------------
  // audio-letter は同じ形で M['audio-letter'] = { kind:'audio',
  //   alphabet: () => ['C','H','K','L','Q','R','S','T'],
  //   mount: () => ({}), show: (h,s) => playClip(s), hide: () => {},
  //   mountInput: 8個の文字ボタン } として登録する。
  // 事前録音した音声ファイルを使う方針（Web Speech API はブラウザ差が大きい）。
  // dual は「チャンネルを2本にする」だけで、runner はすでに複数チャンネルを回せる。

  NB.bindTap = bindTap;
  NB.tapFeedback = tapFeedback;
  NB.modalities = M;
  NB.modalityList = function () { return Object.keys(M).map(k => M[k]); };
  NB.cellNames = CELL_NAMES;
})(window.NB = window.NB || {});
