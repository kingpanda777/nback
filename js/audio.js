/* audio.js — 事前録音した音声の読み込みと再生。

   Nバックでは「鳴った瞬間」がそのまま反応時間の起点になる。
   出題のたびに読み込みが走ると鳴るタイミングがブレて課題が成立しないので、
   ブロックが始まる前に8個すべてをデコードして持っておき、
   本番はメモリ上の PCM を鳴らすだけにする。

   HTMLAudioElement (new Audio) ではなく Web Audio を使う。
   前者は play() が Promise で、読み込み済みでも発音までの遅れが端末ごとに揺れる。
   AudioBufferSourceNode なら start() が即座に鳴り、遅れが一定になる。

   ブラウザはユーザー操作より前に音を鳴らせない（自動再生の制限）。
   「開始」のタップの中で unlock() を呼んで AudioContext を起こす。
   iOS は context を作るだけでは足りず、操作の中で一度何かを鳴らすまで解錠されない。 */
(function (NB) {
  'use strict';

  const BASE = 'audio/';

  let ctx = null;
  let unlocked = false;
  const bytes = {};       // name -> ArrayBuffer（デコード前。fetch だけなら操作不要）
  const buffers = {};     // name -> AudioBuffer（デコード済み。これを鳴らす）
  let current = null;     // 鳴っている音。次が来たら止める

  function Ctor() { return window.AudioContext || window.webkitAudioContext; }
  function supported() { return typeof Ctor() === 'function'; }

  function context() {
    if (!ctx && supported()) ctx = new (Ctor())();
    return ctx;
  }

  /* ユーザー操作の中から同期的に呼ぶこと。
     非同期の後（await や setTimeout の先）で呼ぶと操作と見なされず解錠に失敗する。 */
  function unlock() {
    const c = context();
    if (!c) return false;
    if (c.state === 'suspended' && c.resume) c.resume();
    if (!unlocked) {
      // 1サンプルの無音。これを鳴らすことで iOS の自動再生制限が外れる。
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, 22050);
      s.connect(c.destination);
      s.start(0);
      unlocked = true;
    }
    return true;
  }

  // 取得だけなら AudioContext も操作も要らない。起動直後に呼んでおける。
  function prefetch(names) {
    return Promise.all(names.map(function (name) {
      if (bytes[name] || buffers[name]) return null;
      return fetch(BASE + name + '.mp3')
        .then(function (res) {
          if (!res.ok) throw new Error(name + ' が取れない (' + res.status + ')');
          return res.arrayBuffer();
        })
        .then(function (buf) { bytes[name] = buf; })
        .catch(function () { /* ここでは黙る。preload が本番前に必ずやり直す */ });
    }));
  }

  function decode(c, name, buf) {
    return new Promise(function (resolve, reject) {
      // decodeAudioData は ArrayBuffer を消費するので複製を渡す。
      // 失敗しても元を残しておけば、あとでやり直せる。
      const copy = buf.slice(0);
      const ret = c.decodeAudioData(copy, resolve, reject);
      if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
    }).then(function (audioBuffer) {
      buffers[name] = audioBuffer;
      return audioBuffer;
    });
  }

  /* 本番前に必ず通す。ここが解決したときには
     names のすべてがデコード済みで、以後の play() は読み込みを起こさない。 */
  function preload(names) {
    const c = context();
    if (!c) return Promise.resolve(false);
    return Promise.all(names.map(function (name) {
      if (buffers[name]) return true;
      const have = bytes[name]
        ? Promise.resolve(bytes[name])
        : fetch(BASE + name + '.mp3').then(function (res) {
            if (!res.ok) throw new Error(name + ' が取れない (' + res.status + ')');
            return res.arrayBuffer();
          }).then(function (b) { bytes[name] = b; return b; });
      return have.then(function (b) { return decode(c, name, b); }).then(function () { return true; });
    })).then(function () { return true; }, function () { return false; });
  }

  function ready(names) {
    return names.every(function (n) { return !!buffers[n]; });
  }

  function stop() {
    if (!current) return;
    try { current.stop(0); } catch (e) { /* 既に止まっている */ }
    current = null;
  }

  /* 鳴らす。読み込み済みが前提なので、ここでは fetch も decode もしない。
     前の音が残っていたら止める。重なると何の音か聞き分けられなくなる。 */
  function play(name) {
    const c = ctx;
    const buf = buffers[name];
    if (!c || !buf) return false;
    if (c.state === 'suspended' && c.resume) c.resume();
    stop();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.onended = function () { if (current === src) current = null; };
    src.start(0);
    current = src;
    return true;
  }

  // 一番長いクリップの長さ(ms)。提示時間の目安を出すのに使う。
  function longestMs(names) {
    let ms = 0;
    names.forEach(function (n) {
      if (buffers[n]) ms = Math.max(ms, buffers[n].duration * 1000);
    });
    return Math.round(ms);
  }

  NB.audio = {
    supported: supported,
    unlock: unlock,
    prefetch: prefetch,
    preload: preload,
    ready: ready,
    play: play,
    stop: stop,
    longestMs: longestMs
  };
})(window.NB = window.NB || {});
