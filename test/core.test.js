/* core.js の単体テスト。 node test/core.test.js で実行する。
   core.js はブラウザ用の素の <script> なので、window を用意して読み込む。 */
const fs = require('fs');
const p = require('path');
global.window = {};
global.navigator = {};

// storage.js を読むための最小の localStorage
const mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
// 位置課題は提示を modalities.js に委譲しているので一緒に読む。
// どのファイルも読み込み時点では DOM を触らないので、Node でもそのまま評価できる。
eval(fs.readFileSync(p.join(__dirname, '..', 'js', 'core.js'), 'utf8'));
eval(fs.readFileSync(p.join(__dirname, '..', 'js', 'modalities.js'), 'utf8'));
eval(fs.readFileSync(p.join(__dirname, '..', 'js', 'paced.js'), 'utf8'));
eval(fs.readFileSync(p.join(__dirname, '..', 'js', 'storage.js'), 'utf8'));
const core = window.NB.core;
const paced = window.NB.paced;
const store = window.NB.store;

let fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.log('  NG  ' + msg); } else { console.log('  ok  ' + msg); }
}

console.log('--- 再現性 ---');
const a = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: '123456789'.split(''), seed: 42 });
const b = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: '123456789'.split(''), seed: 42 });
ok(a.symbols.join('') === b.symbols.join(''), '同じシードなら同じ列: ' + a.symbols.join(''));
const c = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: '123456789'.split(''), seed: 43 });
ok(c.symbols.join('') !== a.symbols.join(''), '違うシードなら違う列');

console.log('--- ターゲット率と整合性 ---');
for (const n of [1, 2, 3, 4, 5]) {
  for (const rate of [0.20, 0.25, 0.28, 0.30, 0.40]) {
    for (let s = 0; s < 60; s++) {
      const trials = n + 20;
      const seq = core.generateSequence({ n, trials, targetRate: rate, alphabet: '12345678'.split(''), seed: s });
      const expected = Math.max(1, Math.round(rate * (trials - n)));
      if (seq.targets !== expected) { fails++; console.log('  NG target count n=' + n + ' rate=' + rate); }
      // isTarget と実際の列が一致しているか
      for (let i = 0; i < trials; i++) {
        const actual = i >= n && seq.symbols[i] === seq.symbols[i - n];
        if (actual !== seq.isTarget[i]) { fails++; console.log('  NG isTarget mismatch i=' + i + ' n=' + n + ' seed=' + s); }
      }
      // lure OFF なら N±1 の一致がないこと
      if (seq.lures !== 0) { fails++; console.log('  NG lure leaked n=' + n + ' seed=' + s + ' count=' + seq.lures); }
      if (seq.isTarget.filter(Boolean).length !== expected) { fails++; console.log('  NG isTarget total'); }
    }
  }
}
ok(true, 'n=1..5 × rate 5種 × 60シード: ターゲット数・一致判定・lure混入なし');

console.log('--- ターゲット率の実測 ---');
{
  let tot = 0, tgt = 0;
  for (let s = 0; s < 300; s++) {
    const seq = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: '123456789'.split(''), seed: s });
    tot += 20; tgt += seq.targets;
  }
  const r = tgt / tot;
  ok(Math.abs(r - 0.28) < 0.03, '実測ターゲット率 ' + (r * 100).toFixed(1) + '% (設定 28%)');
}

console.log('--- ひっかけ (lure) ---');
{
  const A = '123456789'.split('');
  // OFF: 1件も生じない（偶然の一致も作らない）
  let off = 0;
  for (let s = 0; s < 300; s++) {
    off += core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: A, seed: s }).lures;
  }
  ok(off === 0, 'OFF: 300ブロックでひっかけ0件（偶然の一致も作らない）');

  // ON: 決まった割合で置かれ、ターゲット数は崩れない
  let on = 0, targets = 0, bad = 0;
  for (let s = 0; s < 300; s++) {
    const q = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: A, seed: s, lure: true });
    on += q.lures;
    targets += q.targets;
    if (q.isTarget.filter(Boolean).length !== q.targets) bad++;
    // 置いた位置と、実際に一致している位置が合っているか
    if (q.lurePositions.length !== q.lures) bad++;
    q.lurePositions.forEach(function (i) {
      if (q.isTarget[i]) bad++;
      const ok1 = (i - 1 >= 0 && q.symbols[i] === q.symbols[i - 1]);
      const ok3 = (i - 3 >= 0 && q.symbols[i] === q.symbols[i - 3]);
      if (!ok1 && !ok3) bad++;               // N=2 なので間隔は 1 か 3
    });
  }
  ok(on > 0, 'ON: ひっかけが置かれる（1ブロックあたり ' + (on / 300).toFixed(1) + '件）');
  ok(bad === 0, 'ON: 置いた位置は N±1 で一致し、ターゲットとは重ならない');
  ok(Math.abs(targets / 300 - 6) < 0.01, 'ON でもターゲット数は変わらない（' + (targets / 300).toFixed(1) + '件）');

  // 同じシード・同じ設定なら同じ列
  const a = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: A, seed: 7, lure: true });
  const b = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: A, seed: 7, lure: true });
  ok(a.symbols.join('') === b.symbols.join(''), 'ON でも同じシードなら同じ列');
  const c = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: A, seed: 7 });
  ok(a.symbols.join('') !== c.symbols.join(''), 'ON と OFF では列が変わる');
}

console.log('--- ひっかけ: 自分のペース方式 ---');
{
  const A = '0123456789'.split('');
  // ターゲットは置かないが、ひっかけは N±1 に置ける
  let off = 0, on = 0, leak = 0;
  for (let s = 0; s < 300; s++) {
    const o = core.generateSequence({ n: 2, trials: 17, targetRate: 0, alphabet: A, seed: s });
    const q = core.generateSequence({ n: 2, trials: 17, targetRate: 0, alphabet: A, seed: s, lure: true });
    off += o.lures;
    on += q.lures;
    if (o.targets !== 0 || q.targets !== 0) leak++;
    // N個前との一致は禁じない（禁じると「いま出ているものは答えではない」と分かってしまう）
  }
  ok(off === 0, 'OFF: ひっかけ0件');
  ok(on > 0, 'ON: ひっかけが置かれる（1ブロックあたり ' + (on / 300).toFixed(1) + '件）');
  ok(leak === 0, 'ターゲットは置かれない');

  // N個前との一致が起こりうること（起こらないと答えが絞られてしまう）
  let nbackMatches = 0;
  for (let s = 0; s < 300; s++) {
    const q = core.generateSequence({ n: 2, trials: 17, targetRate: 0, alphabet: A, seed: s });
    for (let i = 2; i < 17; i++) if (q.symbols[i] === q.symbols[i - 2]) nbackMatches++;
  }
  ok(nbackMatches > 0, 'N個前と同じ記号も出る（' + nbackMatches + '件）。禁じると答えが絞られる');
}

console.log('--- 判定 ---');
{
  const isTarget = [false, false, true, false, true, false];
  const resp = [
    { responded: false, rt: null },
    { responded: true, rt: 500 },    // 誤警報
    { responded: true, rt: 600 },    // ヒット
    { responded: false, rt: null },  // 正棄却
    { responded: false, rt: null },  // ミス
    { responded: false, rt: null }   // 正棄却
  ];
  const s = core.score(isTarget, resp);
  ok(s.hits === 1 && s.misses === 1 && s.falseAlarms === 1 && s.correctRejections === 3, 'ヒット/ミス/誤警報/正棄却 = 1/1/1/3');
  ok(s.hitRate === 0.5, 'ヒット率 = 1/2');
  ok(Math.abs(s.faRate - 0.25) < 1e-9, '誤警報率 = 1/4');
  ok(s.meanRt === 600, '平均反応時間はヒット時のみ = 600ms');
  ok(s.meanRtAll === 550, '押した全反応の平均 = 550ms');
}

console.log('--- 「全部押す」戦略が見抜けるか ---');
{
  const seq = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: '123456789'.split(''), seed: 7 });
  const allPress = seq.isTarget.map(() => ({ responded: true, rt: 400 }));
  const s = core.score(seq.isTarget, allPress);
  ok(s.hitRate === 1 && s.faRate === 1, '全押し: ヒット率100% だが誤警報率も100%');
  // 全押し/全無視は真の HR=FAR となり d' は原理的に定義できない。
  // 対数線形補正で有限値にしているので 0 ぴったりにはならないが、弁別できていないことは示せる。
  ok(Math.abs(s.dPrime) < 0.6, "全押しの d' は 0 近傍 → " + s.dPrime);
  const none = seq.isTarget.map(() => ({ responded: false, rt: null }));
  const s2 = core.score(seq.isTarget, none);
  ok(s2.hitRate === 0 && s2.faRate === 0, '全無視: ヒット率0% / 誤警報率0%');
  ok(Math.abs(s2.dPrime) < 0.6, "全無視の d' も 0 近傍 → " + s2.dPrime);
  const perfect = seq.isTarget.map(t => ({ responded: t, rt: t ? 450 : null }));
  const s3 = core.score(seq.isTarget, perfect);
  ok(s3.dPrime > 2.5, "完璧な回答の d' は大きい → " + s3.dPrime);
  ok(s3.dPrime - Math.abs(s.dPrime) > 2.5, "完璧 と 全押し は d' で明確に分かれる");
}

console.log('--- d\' の妥当性 ---');
ok(Math.abs(core.probit(0.5)) < 1e-9, 'probit(0.5) = 0');
ok(Math.abs(core.probit(0.975) - 1.95996) < 1e-4, 'probit(0.975) ≈ 1.95996');
ok(Math.abs(core.probit(0.025) + 1.95996) < 1e-4, 'probit(0.025) ≈ -1.95996');

console.log('--- 適応的難易度 (Jaeggi) ---');
ok(core.suggestNextN(2, { misses: 1, falseAlarms: 2 }) === 3, 'ミス+誤警報 3件 → N+1');
ok(core.suggestNextN(2, { misses: 2, falseAlarms: 2 }) === 2, '4件 → 据え置き');
ok(core.suggestNextN(2, { misses: 3, falseAlarms: 2 }) === 1, '5件 → N-1');
ok(core.suggestNextN(1, { misses: 9, falseAlarms: 9 }) === 1, 'N1 より下がらない');

console.log('--- 回答の集計（自分のペース方式で共通） ---');
{
  const expected = ['5', '2', '7', '2'];
  const answers = [
    { symbol: '5', rt: 900 },
    { symbol: '2', rt: 700 },
    { symbol: '1', rt: 1200 },   // 誤答
    { symbol: '2', rt: 800 }
  ];
  const s = core.scoreAnswers(expected, answers);
  ok(s.questions === 4 && s.correct === 3 && s.incorrect === 1, '4問中3問正解');
  ok(s.accuracy === 0.75, '正答率 = 3/4');
  ok(s.correctFlags.map(v => v ? 1 : 0).join('') === '1101', '正誤フラグの並び');
  ok(s.streak === 2, '頭から続けて正解した数 = 2');
  ok(s.meanRt === 900, '平均反応時間 = 900ms');
  ok(s.hitRate === undefined && s.faRate === undefined, 'ヒット率・誤警報率は算出しない');
}
{
  // 未回答（中断など）は誤答として数える
  const s = core.scoreAnswers(['1', '2', '3'], [{ symbol: '1', rt: 500 }]);
  ok(s.answered === 1 && s.correct === 1 && s.incorrect === 2, '未回答は誤答扱い');
  ok(Math.abs(s.accuracy - 1 / 3) < 1e-9, '正答率は問題数で割る');
}

console.log('--- 混合モダリティの記号列 ---');
{
  // 数字9種 + 位置8種（中央は数字の表示に使うので位置には回さない）
  const alphabet = ['1','2','3','4','5','6','7','8','9'].map(d => 'N' + d)
    .concat(['0','1','2','3','5','6','7','8'].map(c => 'P' + c));
  ok(alphabet.length === 17, '記号は17種');
  let bad = 0;
  const kinds = { N: 0, P: 0 };
  for (let seed = 0; seed < 100; seed++) {
    const seq = core.generateSequence({ n: 2, trials: 12, targetRate: 0.28, alphabet: alphabet, seed: seed });
    seq.symbols.forEach(function (sym) {
      if (alphabet.indexOf(sym) < 0) bad++;
      if (sym === 'P4') bad++;                  // 中央は出ない
      kinds[sym[0]]++;
    });
    for (let i = 0; i < 12; i++) {
      const actual = i >= 2 && seq.symbols[i] === seq.symbols[i - 2];
      if (actual !== seq.isTarget[i]) bad++;
    }
    if (seq.lures !== 0) bad++;
  }
  ok(bad === 0, '2文字の記号でも列の整合性が保たれる（100シード）');
  ok(kinds.N > 0 && kinds.P > 0, '数字と位置が両方混ざる（数字 ' + kinds.N + ' / 位置 ' + kinds.P + '）');
}

console.log('--- 音声モダリティ (audio-letter) ---');
{
  const audio = window.NB.modalities['audio-letter'];
  ok(!!audio, 'audio-letter が登録されている');
  ok(audio.kind === 'audio', "kind は 'audio'（設定画面の絞り込みがこれを見る）");

  const alphabet = audio.alphabet({});
  ok(alphabet.length === 8, '記号は8種: ' + alphabet.join(' '));
  ok(new Set(alphabet).size === 8, '重複が無い');

  // 記号名がそのままファイル名になる。取り違えると本番で無音になる。
  const dir = p.join(__dirname, '..', 'audio');
  const missing = alphabet.filter(s => !fs.existsSync(p.join(dir, s + '.mp3')));
  ok(missing.length === 0, '記号ぶんの mp3 が audio/ にある' +
    (missing.length ? '（無い: ' + missing.join(',') + '）' : ''));

  // sw.js に載っていないとオフラインで鳴らない
  const sw = fs.readFileSync(p.join(__dirname, '..', 'sw.js'), 'utf8');
  const notCached = alphabet.filter(s => sw.indexOf("'audio/" + s + ".mp3'") < 0);
  ok(notCached.length === 0, 'sw.js の ASSETS に8個とも入っている' +
    (notCached.length ? '（漏れ: ' + notCached.join(',') + '）' : ''));
  ok(sw.indexOf("'js/audio.js'") >= 0, 'sw.js の ASSETS に js/audio.js が入っている');

  ok(audio.format('shi') === 'し' && audio.format('tsu') === 'つ',
    '結果画面はかなで出る（shi→し, tsu→つ）');

  // core.js は記号が何かを知らないので、音でも列の作りは同じはず
  let bad = 0;
  for (let seed = 0; seed < 100; seed++) {
    const seq = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: alphabet, seed: seed });
    if (seq.symbols.length !== 22) bad++;
    seq.symbols.forEach(s => { if (alphabet.indexOf(s) < 0) bad++; });
    for (let i = 0; i < 22; i++) {
      const actual = i >= 2 && seq.symbols[i] === seq.symbols[i - 2];
      if (actual !== seq.isTarget[i]) bad++;
    }
  }
  ok(bad === 0, '8種の記号でも列とターゲット判定が整合する（100シード）');
}

console.log('--- ひっかけ: 音声モダリティ ---');
{
  const alphabet = window.NB.modalities['audio-letter'].alphabet({});
  let off = 0, on = 0, misplaced = 0, overlap = 0;
  for (let seed = 0; seed < 100; seed++) {
    const a = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: alphabet, seed: seed, lure: false });
    off += a.lures;

    const b = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: alphabet, seed: seed, lure: true });
    on += b.lures;
    b.lurePositions.forEach(function (i) {
      // ひっかけは N±1 の位置に同じ音を置いたもの。ターゲットとは重ならない。
      const back1 = i >= 1 && b.symbols[i] === b.symbols[i - 1];
      const back3 = i >= 3 && b.symbols[i] === b.symbols[i - 3];
      if (!back1 && !back3) misplaced++;
      if (b.isTarget[i]) overlap++;
    });
  }
  ok(off === 0, 'OFF: 100ブロックでひっかけ0件（偶然の一致も作らない）');
  ok(on > 0, 'ON: ひっかけが置かれる（1ブロックあたり ' + (on / 100).toFixed(1) + '件）');
  ok(misplaced === 0, 'ON: 置いた位置は N±1 で一致する');
  ok(overlap === 0, 'ON: ターゲットとは重ならない');
}

console.log('--- 課題の並び順（1か所で決まっているか）---');
{
  const want = ['calc', 'number', 'position', 'kana', 'mixed', 'mixed-kana'];
  ok(window.NB.ORDER.join(',') === want.join(','), '並び順の定義: ' + want.join(' → '));

  // リアルタイムのモダリティ
  const mods = window.NB.modalityList().map(m => m.id);
  ok(mods.join(',') === ['visual-number', 'visual-position', 'audio-letter',
    'mixed-number-position', 'mixed-number-position-kana'].join(','),
    'モダリティの並び: ' + mods.join(' → '));

  // 自分のペースの課題
  const tasks = paced.taskIds();
  ok(tasks.join(',') === ['calc-arith', 'paced-number', 'paced-position',
    'paced-kana', 'paced-mixed', 'paced-mixed-kana'].join(','),
    '課題の並び: ' + tasks.join(' → '));

  // 両方が同じ ORDER に従っていること。定義した順に引きずられていないか。
  const modOrder = window.NB.modalityList().map(m => m.order);
  const taskOrder = tasks.map(id => paced.TASKS[id].order);
  const rank = list => list.map(o => window.NB.ORDER.indexOf(o));
  const ascending = a => a.every((v, i) => i === 0 || a[i - 1] <= v);
  ok(ascending(rank(modOrder)), 'モダリティは ORDER の順に並ぶ');
  ok(ascending(rank(taskOrder)), '課題は ORDER の順に並ぶ');
  ok(taskOrder.every(o => window.NB.ORDER.indexOf(o) >= 0), '全課題が order を名乗っている');
  ok(modOrder.every(o => window.NB.ORDER.indexOf(o) >= 0), '全モダリティが order を名乗っている');
}

console.log('--- 混合3系統 (数字 + 位置 + かな) ---');
{
  const rt = window.NB.modalities['mixed-number-position-kana'];
  ok(!!rt, 'リアルタイムに登録されている');
  const rtAlpha = rt.alphabet({});
  ok(rtAlpha.length === 25, 'リアルタイムの記号は25種（数字9 + 位置8 + かな8）');
  ok(rtAlpha.filter(s => s === 'P4').length === 0, '中央マスは出ない（数字の表示に使うため）');
  ok(rtAlpha.filter(s => s[0] === 'K').length === 8, 'かなは8種');
  ok(rt.clips().length === 8, 'clips() が8個の音を返す（先読みに使う）');
  ok(rt.format('N5') === '数字5' && rt.format('K shi'.replace(' ', '')) === '音し' &&
    rt.format('P0') === '左上', '表記: 数字5 / 音し / 左上');

  const pc = paced.TASKS['paced-mixed-kana'];
  ok(!!pc, '自分のペースに登録されている');
  const pcAlpha = pc.alphabet({});
  ok(pcAlpha.length === 26, '自分のペースの記号は26種（数字10 + 位置8 + かな8）');
  ok(pcAlpha.filter(s => s[0] === 'N').length === 10, '数字は0から（paced-number と同じ範囲）');
  ok(pcAlpha.indexOf('P4') < 0, '中央マスは出ない');
  ok(pc.clips().length === 8, 'clips() が8個の音を返す');

  // 課題IDはモダリティIDと別にする（記録を後から読むときに取り違えない）
  ok(paced.taskIds().every(id => Object.keys(window.NB.modalities).indexOf(id) < 0),
    '課題IDはモダリティIDと重ならない');

  // 列の整合性
  let bad = 0;
  const kinds = { N: 0, P: 0, K: 0 };
  for (let seed = 0; seed < 100; seed++) {
    const seq = core.generateSequence({ n: 2, trials: 22, targetRate: 0.28, alphabet: rtAlpha, seed: seed });
    seq.symbols.forEach(s => { if (rtAlpha.indexOf(s) < 0) bad++; kinds[s[0]]++; });
    for (let i = 0; i < 22; i++) {
      const actual = i >= 2 && seq.symbols[i] === seq.symbols[i - 2];
      if (actual !== seq.isTarget[i]) bad++;
    }
  }
  ok(bad === 0, '3種類の記号が混ざっても列とターゲット判定が整合する（100シード）');
  ok(kinds.N > 0 && kinds.P > 0 && kinds.K > 0,
    '3種類とも混ざる（数字 ' + kinds.N + ' / 位置 ' + kinds.P + ' / かな ' + kinds.K + '）');
}

console.log('--- 自分のペース: かな ---');
{
  const t = paced.TASKS['paced-kana'];
  ok(!!t, 'paced-kana が登録されている');
  const alpha = t.alphabet({});
  ok(alpha.length === 8, '記号は8種: ' + alpha.join(' '));
  ok(alpha.join(',') === window.NB.modalities['audio-letter'].alphabet({}).join(','),
    'audio-letter と同じ音を使う（音声ファイルを共有する）');
  ok(t.format('shi') === 'し', '結果画面はかなで出る');

  // 毎試行が出題なのでターゲットは置かない
  let bad = 0;
  for (let seed = 0; seed < 100; seed++) {
    const seq = core.generateSequence({ n: 2, trials: 17, targetRate: 0,
      alphabet: alpha, seed: seed });
    if (seq.symbols.length !== 17) bad++;
    if (seq.targets !== 0) bad++;
    seq.symbols.forEach(s => { if (alpha.indexOf(s) < 0) bad++; });
  }
  ok(bad === 0, '出題数どおりの列ができ、ターゲットを作らない（100シード）');
}

console.log('--- ひっかけ: 新方式でも効くか ---');
{
  const cases = [
    ['混合3(リアルタイム)', window.NB.modalities['mixed-number-position-kana'].alphabet({}), 0.28],
    ['かな(自分のペース)', paced.TASKS['paced-kana'].alphabet({}), 0],
    ['混合3(自分のペース)', paced.TASKS['paced-mixed-kana'].alphabet({}), 0]
  ];
  cases.forEach(function (c) {
    const name = c[0], alpha = c[1], rate = c[2];
    let off = 0, on = 0, misplaced = 0, overlap = 0;
    for (let seed = 0; seed < 100; seed++) {
      const a = core.generateSequence({ n: 2, trials: 22, targetRate: rate,
        alphabet: alpha, seed: seed, lure: false });
      off += a.lures;
      const b = core.generateSequence({ n: 2, trials: 22, targetRate: rate,
        alphabet: alpha, seed: seed, lure: true });
      on += b.lures;
      b.lurePositions.forEach(function (i) {
        const back1 = i >= 1 && b.symbols[i] === b.symbols[i - 1];
        const back3 = i >= 3 && b.symbols[i] === b.symbols[i - 3];
        if (!back1 && !back3) misplaced++;
        if (b.isTarget[i]) overlap++;
      });
    }
    ok(off === 0, name + ' OFF: ひっかけ0件');
    ok(on > 0, name + ' ON: 置かれる（1ブロック ' + (on / 100).toFixed(1) + '件）');
    ok(misplaced === 0, name + ' ON: 位置は N±1 で一致する');
    ok(overlap === 0, name + ' ON: ターゲットとは重ならない');
  });
}

console.log('--- Nバック構造を作らない列 (n = 0) ---');
{
  // 自分のペース方式は毎試行が出題なので、ターゲットの概念がない。
  const alphabet = '0123456789'.split('');
  let bad = 0, repeats = 0;
  for (let seed = 0; seed < 200; seed++) {
    const seq = core.generateSequence({ n: 0, trials: 10, targetRate: 0, alphabet: alphabet, seed: seed });
    if (seq.symbols.length !== 10) bad++;
    if (seq.targets !== 0) bad++;
    if (seq.isTarget.filter(Boolean).length !== 0) bad++;
    seq.symbols.forEach(function (sym, i) {
      if (alphabet.indexOf(sym) < 0) bad++;
      if (i > 0 && sym === seq.symbols[i - 1]) repeats++;
    });
  }
  ok(bad === 0, 'n=0: 出題数どおりの列ができ、ターゲットを作らない（200シード）');
  ok(repeats === 0, 'n=0: 直前と同じ記号は続かない');
}

console.log('--- 自分のペース方式: 課題ごとの列 ---');
{
  const base = { n: 2, trials: 7, seed: 4242, answerMax: 9, ops: paced.OPS, excludeCenter: true };

  // 数字は 0〜9
  const num = paced.makeBlock(Object.assign({}, base, { task: 'paced-number' }));
  ok(num.symbols.length === 7, '数字: 出題数どおり');
  ok(num.symbols.every(v => Number(v) >= 0 && Number(v) <= 9), '数字: 0〜9 に収まる');
  ok(num.extras === null, '数字: 式などの付随データは無い');

  // 位置は中央を除いた8マス
  const pos = paced.makeBlock(Object.assign({}, base, { task: 'paced-position' }));
  ok(pos.symbols.every(v => v !== '4'), '位置: 中央マスは出ない');
  ok(pos.symbols.every(v => Number(v) >= 0 && Number(v) <= 8), '位置: 0〜8 のマス番号');

  // 計算は式が付く
  const calcB = paced.makeBlock(Object.assign({}, base, { task: 'calc-arith' }));
  ok(calcB.extras && calcB.extras.length === 7, '計算: 式が出題数ぶん付く');

  // 同じシードなら同じ列
  const again = paced.makeBlock(Object.assign({}, base, { task: 'paced-position' }));
  ok(pos.symbols.join('') === again.symbols.join(''), '同じシードなら同じ列');

  // 混合は数字0〜9 + 中央を除く8マス
  const mix = paced.makeBlock(Object.assign({}, base, { task: 'paced-mixed' }));
  ok(mix.symbols.every(v => /^N[0-9]$|^P[0-35-8]$/.test(v)), '混合: 記号は N0〜N9 と P0〜P8（中央除く）');
  ok(mix.symbols.every(v => v !== 'P4'), '混合: 中央マスは出ない（数字の表示に使うため）');
  {
    const all = paced.TASKS['paced-mixed'].alphabet({});
    ok(all.length === 18, '混合: 記号は18種（数字10 + 位置8）');
    ok(all.indexOf('N0') >= 0, '混合: 数字は0から（paced-number と同じ範囲）');
  }

  // 課題IDはリアルタイムのモダリティと衝突させない
  ok(paced.taskIds().every(id => Object.keys(window.NB.modalities).indexOf(id) < 0),
     '課題IDはモダリティIDと別（' + paced.taskIds().join(', ') + '）');
}

console.log('--- 自分のペース方式: 採点する範囲 ---');
{
  // 出題 N + 回答数。最初の N 問は覚えるだけなので採点しない。
  const n = 2, answers = 5;
  const block = paced.makeBlock({ task: 'paced-number', n: n, trials: n + answers, seed: 99, excludeCenter: true });
  const expected = block.symbols.slice(0, answers);
  ok(expected.length === 5, 'N2・回答数5 なら採点は5問');
  ok(core.scoreAnswers(expected, expected.map(v => ({ symbol: v, rt: 800 }))).accuracy === 1,
     '全部合っていれば正答率100%');
}

console.log('--- 計算Nバック: 式の作り方 ---');console.log('--- 計算Nバック: 式の作り方 ---');
{
  const rng = core.makeRng(12345);
  const opt = { maxOperand: 9, ops: paced.OPS };
  let bad = [];
  const opCount = { '+': 0, '-': 0, '\u00d7': 0, '\u00f7': 0 };

  for (let a = 0; a <= 9; a++) {
    for (let k = 0; k < 200; k++) {
      const pr = paced.makeProblem(a, rng, opt);
      opCount[pr.op]++;
      // 式を実際に計算して、狙った答えになるか
      let v;
      if (pr.op === '+') v = pr.left + pr.right;
      else if (pr.op === '-') v = pr.left - pr.right;
      else if (pr.op === '\u00d7') v = pr.left * pr.right;
      else v = pr.left / pr.right;
      if (v !== a) bad.push(pr.text + ' = ' + v + ' (期待 ' + a + ')');
      if (v < 0 || v > 9) bad.push('答えが一桁でない: ' + pr.text);
      if (pr.op === '\u00f7' && pr.left % pr.right !== 0) bad.push('割り切れない: ' + pr.text);
      if (pr.op === '\u00f7' && pr.right === 0) bad.push('0で割っている: ' + pr.text);
      if (pr.op === '-' && pr.right < 1) bad.push('0を引いている: ' + pr.text);
    }
  }
  ok(bad.length === 0, '答え0〜9 × 200回: 式の値が答えと一致し、一桁に収まる' + (bad.length ? ' / ' + bad[0] : ''));
  ok(Object.keys(opCount).every(o => opCount[o] > 0),
     '四則すべて出る（+' + opCount['+'] + ' -' + opCount['-'] + ' \u00d7' + opCount['\u00d7'] + ' \u00f7' + opCount['\u00f7'] + '）');
}

console.log('--- 計算Nバック: 割り算 ---');
{
  const rng = core.makeRng(777);
  let n = 0, bad = 0;
  for (let a = 0; a <= 9; a++) {
    paced.candidates(a, '\u00f7', 9).forEach(function (pair) {
      n++;
      if (pair[1] === 0) bad++;
      if (pair[0] % pair[1] !== 0) bad++;
      if (pair[0] / pair[1] !== a) bad++;
    });
  }
  ok(n > 0 && bad === 0, '割り算の候補は ' + n + ' 通り、すべて割り切れて答えが一致する');
}

console.log('--- 計算Nバック: ブロックの再現性 ---');
{
  const cfg = { task: 'calc-arith', n: 2, trials: 17, seed: 424242, answerMax: 9, ops: paced.OPS };
  const a = paced.makeBlock(cfg);
  const b = paced.makeBlock(cfg);
  ok(a.extras.map(p => p.text).join('|') === b.extras.map(p => p.text).join('|'),
     '同じシードなら同じ式が出る: ' + a.extras.slice(0, 3).map(p => p.text).join(', ') + ' …');
  const c = paced.makeBlock({ task: 'calc-arith', n: 2, trials: 17, seed: 424243, answerMax: 9, ops: paced.OPS });
  ok(a.extras.map(p => p.text).join('|') !== c.extras.map(p => p.text).join('|'), '違うシードなら違う式');
  ok(a.symbols.length === 17 && a.extras.length === 17, '出題数どおりの長さ');
  ok(a.symbols.every(v => Number(v) >= 0 && Number(v) <= 9), '答えはすべて一桁');
  let consec = 0;
  for (let i = 1; i < a.symbols.length; i++) if (a.symbols[i] === a.symbols[i - 1]) consec++;
  ok(consec === 0, '直前と同じ答えは連続しない');
}

console.log('--- 計算Nバック: 採点 ---');
{
  // 出題 N+回答数、採点対象は先頭 回答数 個（最初の N 問は覚えるだけ）
  const n = 2, answers = 5;
  const block = paced.makeBlock({ task: 'calc-arith', n: n, trials: n + answers, seed: 99, answerMax: 9, ops: paced.OPS });
  const expected = block.symbols.slice(0, answers);
  ok(expected.length === 5, 'N2・回答数5 なら採点は5問');

  const perfect = expected.map(v => ({ symbol: v, rt: 2000 }));
  ok(core.scoreAnswers(expected, perfect).accuracy === 1, '全部合っていれば正答率100%');

  const partial = expected.map((v, i) => ({ symbol: i < 3 ? v : 'X', rt: 2000 }));
  const sc = core.scoreAnswers(expected, partial);
  ok(sc.correct === 3 && sc.streak === 3, '3問目まで正解なら連続正答は3');
  ok(sc.hitRate === undefined && sc.faRate === undefined, 'ヒット率・誤警報率は算出しない');
}

console.log('--- 計算Nバック: N の増減の目安 ---');
// 問題数が可変なので、件数ではなく割合で判断する
ok(core.suggestNextNByRate(2, 1) === 3, '正答率100% → N+1');
ok(core.suggestNextNByRate(2, 0.9) === 3, '90% → N+1');
ok(core.suggestNextNByRate(2, 0.833) === 2, '83%（6問中1問誤答）→ 据え置き');
ok(core.suggestNextNByRate(2, 0.7) === 2, '70% → 据え置き');
ok(core.suggestNextNByRate(2, 0.6) === 1, '60% → N-1');
ok(core.suggestNextNByRate(1, 0) === 1, 'N1 より下がらない');

console.log('--- 計算Nバック: 2桁への拡張余地 ---');
{
  // answerMax を上げても同じ関数で作れること（今は使わないが、作りとして通ることを固定する）
  const block = paced.makeBlock({ task: 'calc-arith', n: 2, trials: 12, seed: 5, answerMax: 99, ops: paced.OPS });
  const vals = block.symbols.map(Number);
  ok(vals.some(v => v > 9), 'answerMax=99 なら2桁の答えも出る（最大 ' + Math.max.apply(null, vals) + '）');
  let bad = 0;
  block.extras.forEach(function (pr) {
    let v;
    if (pr.op === '+') v = pr.left + pr.right;
    else if (pr.op === '-') v = pr.left - pr.right;
    else if (pr.op === '\u00d7') v = pr.left * pr.right;
    else v = pr.left / pr.right;
    if (v !== pr.answer) bad++;
    if (pr.op === '\u00f7' && pr.left % pr.right !== 0) bad++;
  });
  ok(bad === 0, '2桁でも式の値と答えが一致し、割り算は割り切れる');
}


console.log('--- 廃止した方式の記録を残さない ---');
{
  const rt = { datetime: '2026-08-01T00:00:00.000Z', responseMode: 'realtime', n: 2 };
  const pc = { datetime: '2026-08-02T00:00:00.000Z', responseMode: 'paced', task: 'paced-number', n: 2 };
  const v1 = { datetime: '2026-08-03T00:00:00.000Z', n: 2 };                       // responseMode 無し
  const rc = { datetime: '2026-08-04T00:00:00.000Z', responseMode: 'recall', n: 0 };
  const cl = { datetime: '2026-08-05T00:00:00.000Z', responseMode: 'calc', n: 2 };  // v4 までの計算

  ok(store.isRetired(rc) === true, '廃止方式と判定される');
  ok([rt, pc, v1, cl].every(r => store.isRetired(r) === false), '現役の方式は残す（v1・v4の記録も含む）');

  // 読み込みの入口で落ちて、保存し直される
  localStorage.setItem('nback.history.v1', JSON.stringify([rt, rc, pc, cl, v1]));
  const loaded = store.load();
  ok(loaded.length === 4, '読み込み時に廃止方式だけ落ちる（5件 → ' + loaded.length + '件）');
  ok(loaded.every(r => r.responseMode !== 'recall'), '残った記録に廃止方式は無い');
  const onDisk = JSON.parse(localStorage.getItem('nback.history.v1'));
  ok(onDisk.length === 4, '保存し直されて localStorage からも消える');

  // .jsonl の読み込みからも入らない
  localStorage.setItem('nback.history.v1', JSON.stringify([rt]));
  const res = store.merge(store.load(), [pc, rc, cl]);
  ok(res.added === 2 && res.retired === 1, '読み込み: 現役2件を追加、廃止1件は取り込まない');
  ok(res.records.every(r => r.responseMode !== 'recall'), '古い .jsonl を読み込んでも戻らない');

  // 何も無いときに壊れない
  localStorage.removeItem('nback.history.v1');
  ok(store.load().length === 0, '履歴が空でも落ちない');
}


console.log('\n' + (fails === 0 ? 'すべて通過' : fails + ' 件 失敗'));
process.exit(fails ? 1 : 0);
