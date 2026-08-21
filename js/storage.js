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
    responseMode: 'realtime',   // 'realtime' = 提示中に押す / 'paced' = 自分のペースで進む
    pacedTask: 'calc-arith',    // paced のとき何をやるか（paced.js の TASKS のID）
    trialsExtra: 20,            // realtime: 1ブロック = N + 20 試行
    pacedAnswers: 15,           // paced: 採点する問題数。出題は N + この数
    calcAnswerMax: 9,           // calc: 答えの上限。2桁に広げるならここを 99 にする
    targetRate: 0.28,
    stimulusMs: 500,
    isiMs: 2500,
    lure: false,
    excludeCenter: true
  };

  function loadSettings() {
    let saved = {};
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) saved = JSON.parse(raw) || {};
    } catch (e) { saved = {}; }
    return migrateSettings(Object.assign({}, DEFAULT_SETTINGS, saved), saved);
  }

  /* 保存済みの設定を今の形に寄せる。
     'recall'（すべて覚えて最後に全部答える方式）は廃止した。
     'calc' は「自分のペース」方式のひとつという扱いに変わった。
     saved は既定値とマージする前の生の保存値。旧キーの有無を見るのに要る。 */
  function migrateSettings(s, saved) {
    if (s.responseMode === 'calc') {
      s.responseMode = 'paced';
      s.pacedTask = 'calc-arith';
    }
    if (s.responseMode !== 'realtime' && s.responseMode !== 'paced') s.responseMode = 'realtime';
    // 旧 calcAnswers を引き継ぐ（既定値とマージ済みの s ではなく saved を見る）
    if (saved && saved.pacedAnswers === undefined && saved.calcAnswers !== undefined) {
      s.pacedAnswers = saved.calcAnswers;
    }
    delete s.calcAnswers;
    delete s.recallCount;
    if (!s.pacedTask) s.pacedTask = DEFAULT_SETTINGS.pacedTask;
    return s;
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
