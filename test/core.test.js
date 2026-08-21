/* core.js の単体テスト。 node test/core.test.js で実行する。
   core.js はブラウザ用の素の <script> なので、window を用意して読み込む。 */
const fs = require('fs');
const p = require('path');
global.window = {};
global.navigator = {};
// 位置課題は提示を modalities.js に委譲しているので一緒に読む。
// どのファイルも読み込み時点では DOM を触らないので、Node でもそのまま評価できる。
eval(fs.readFileSync(p.join(__dirname, '..', 'js', 'core.js'), 'utf8'));
eval(fs.readFileSync(p.join(__dirname, '..', 'js', 'modalities.js'), 'utf8'));
eval(fs.readFileSync(p.join(__dirname, '..', 'js', 'paced.js'), 'utf8'));
const core = window.NB.core;
const paced = window.NB.paced;

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
      const lures = seq.isLure.filter(Boolean).length;
      if (lures !== 0) { fails++; console.log('  NG lure leaked n=' + n + ' seed=' + s + ' count=' + lures); }
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

console.log('--- lure ON ---');
{
  let lured = 0;
  for (let s = 0; s < 200; s++) {
    const seq = core.generateSequence({ n: 3, trials: 23, targetRate: 0.28, alphabet: '12345678'.split(''), seed: s, lure: true });
    lured += seq.isLure.filter(Boolean).length;
  }
  ok(lured > 0, 'lure:true で N±1 一致が生じる（合計 ' + lured + ' 件 / 200ブロック）');
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
    if (seq.isLure.filter(Boolean).length !== 0) bad++;
  }
  ok(bad === 0, '2文字の記号でも列の整合性が保たれる（100シード）');
  ok(kinds.N > 0 && kinds.P > 0, '数字と位置が両方混ざる（数字 ' + kinds.N + ' / 位置 ' + kinds.P + '）');
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

  // 課題IDはリアルタイムのモダリティと衝突させない
  ok(paced.taskIds().indexOf('visual-number') < 0 && paced.taskIds().indexOf('visual-position') < 0,
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


console.log('\n' + (fails === 0 ? 'すべて通過' : fails + ' 件 失敗'));
process.exit(fails ? 1 : 0);
