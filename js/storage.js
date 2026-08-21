/* storage.js — 履歴と設定の保存。
   中身は1行1ブロックの JSON Lines と同じ形。localStorage に置いておき、
   .jsonl として書き出し／読み込みできるようにしてある。 */
(function (NB) {
  'use strict';

  const HISTORY_KEY = 'nback.history.v1';
  const SETTINGS_KEY = 'nback.settings.v1';

  function load() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.error('履歴の読み込みに失敗', e);
      return [];
    }
  }

  function save(records) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
  }

  function append(record) {
    const all = load();
    all.push(record);
    save(all);
    return all;
  }

  function remove(datetime) {
    const all = load().filter(r => r.datetime !== datetime);
    save(all);
    return all;
  }

  function clear() { localStorage.removeItem(HISTORY_KEY); }

  function toJsonl(records) {
    return records.map(r => JSON.stringify(r)).join('\n') + '\n';
  }

  function fromJsonl(text) {
    return text.split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(function (l) {
        try { return JSON.parse(l); } catch (e) { return null; }
      })
      .filter(Boolean);
  }

  // datetime をキーに重複を除いてマージする
  function merge(existing, incoming) {
    const seen = new Set(existing.map(r => r.datetime));
    const added = incoming.filter(r => r && r.datetime && !seen.has(r.datetime));
    const all = existing.concat(added);
    all.sort((a, b) => a.datetime < b.datetime ? -1 : 1);
    save(all);
    return { records: all, added: added.length, skipped: incoming.length - added.length };
  }

  function download(records) {
    const blob = new Blob([toJsonl(records)], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'nback-history-' + stamp + '.jsonl';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- 設定 ---------------------------------------------------------------
  const DEFAULT_SETTINGS = {
    n: 2,
    modalityId: 'visual-number',
    responseMode: 'realtime',   // 'realtime' = 提示中に押す / 'recall' = 提示後に入力 / 'calc' = 計算Nバック
    trialsExtra: 20,            // realtime: 1ブロック = N + 20 試行
    recallCount: 10,            // recall: 問題数。この数だけ提示して、この数だけ答える
    calcAnswers: 15,            // calc: 採点する問題数。出題は N + この数
    calcAnswerMax: 9,           // calc: 答えの上限。2桁に広げるならここを 99 にする
    targetRate: 0.28,
    stimulusMs: 500,
    isiMs: 2500,
    lure: false,
    excludeCenter: true
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return Object.assign({}, DEFAULT_SETTINGS, raw ? JSON.parse(raw) : {});
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  NB.store = {
    load, save, append, remove, clear,
    toJsonl, fromJsonl, merge, download,
    loadSettings, saveSettings, DEFAULT_SETTINGS
  };
})(window.NB = window.NB || {});
