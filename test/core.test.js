/* core.js の単体テスト。 node test/core.test.js で実行する。
   core.js はブラウザ用の素の <script> なので、window を用意して読み込む。 */
const fs = require('fs');
const p = require('path');
global.window = {};
eval(fs.readFileSync(p.join(__dirname, '..', 'js', 'core.js'), 'utf8'));
const core = window.NB.core;

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

console.log('--- 提示後に入力する方式の集計 ---');
{
  const expected = ['5', '2', '7', '2'];
  const answers = [
    { symbol: '5', rt: 900 },
    { symbol: '2', rt: 700 },
    { symbol: '1', rt: 1200 },   // 誤答
    { symbol: '2', rt: 800 }
  ];
  const s = core.scoreRecall(expected, answers);
  ok(s.questions === 4 && s.correct === 3 && s.incorrect === 1, '4問中3問正解');
  ok(s.accuracy === 0.75, '正答率 = 3/4');
  ok(s.correctFlags.map(v => v ? 1 : 0).join('') === '1101', '正誤フラグの並び');
  ok(s.streak === 2, '頭から続けて正解した数 = 2');
  ok(s.meanRt === 900, '平均反応時間 = 900ms');
}
{
  // 未回答（中断など）は誤答として数える
  const s = core.scoreRecall(['1', '2', '3'], [{ symbol: '1', rt: 500 }]);
  ok(s.answered === 1 && s.correct === 1 && s.incorrect === 2, '未回答は誤答扱い');
  ok(Math.abs(s.accuracy - 1 / 3) < 1e-9, '正答率は問題数で割る');
}

console.log('--- 提示数の増減の目安 ---');
ok(core.suggestNextTrials(8, 2, 0) === 9, '全問正解 → 提示数 +1');
ok(core.suggestNextTrials(8, 2, 1) === 8, '誤答1 → 据え置き');
ok(core.suggestNextTrials(8, 2, 3) === 7, '誤答3以上 → 提示数 -1');
ok(core.suggestNextTrials(3, 2, 5) === 3, 'N+1 より短くはしない');

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
  // 提示後に入力する方式は「出た順に全部答える」だけなので、列に N バック構造は要らない。
  const alphabet = '123456789'.split('');
  let bad = 0, repeats = 0;
  for (let seed = 0; seed < 200; seed++) {
    const seq = core.generateSequence({ n: 0, trials: 10, targetRate: 0.28, alphabet: alphabet, seed: seed });
    if (seq.symbols.length !== 10) bad++;
    if (seq.targets !== 0) bad++;
    if (seq.isTarget.filter(Boolean).length !== 0) bad++;
    if (seq.isLure.filter(Boolean).length !== 0) bad++;
    seq.symbols.forEach(function (sym, i) {
      if (alphabet.indexOf(sym) < 0) bad++;
      if (i > 0 && sym === seq.symbols[i - 1]) repeats++;   // 直前と同じは避ける
    });
  }
  ok(bad === 0, 'n=0: 提示数どおりの列ができ、ターゲットもひっかけも作らない（200シード）');
  ok(repeats === 0, 'n=0: 直前と同じ記号は続かない');

  const a = core.generateSequence({ n: 0, trials: 10, targetRate: 0.28, alphabet: alphabet, seed: 99 });
  const b = core.generateSequence({ n: 0, trials: 10, targetRate: 0.28, alphabet: alphabet, seed: 99 });
  ok(a.symbols.join('') === b.symbols.join(''), 'n=0 でも同じシードなら同じ列: ' + a.symbols.join(''));

  // 離れた位置の重複は許す（10問を9種類から作るので必ず起きる）
  const many = core.generateSequence({ n: 0, trials: 12, targetRate: 0.28, alphabet: alphabet, seed: 3 });
  ok(new Set(many.symbols).size < 12, '離れた位置の重複は許す');
}

console.log('--- 出た順に全部答える ---');
{
  const alphabet = '123456789'.split('');
  const seq = core.generateSequence({ n: 0, trials: 10, targetRate: 0.28, alphabet: alphabet, seed: 5 });
  // 正解列 = 提示された列そのもの。10問なら10題出て10問答える。
  const expected = seq.symbols.slice(0, 10 - 0);
  ok(expected.length === 10, '10問と決めたら10問答える');
  ok(expected.join('') === seq.symbols.join(''), '正解列 = 提示された列そのもの ' + expected.join(''));

  const perfect = expected.map(sym => ({ symbol: sym, rt: 800 }));
  const s1 = core.scoreRecall(expected, perfect);
  ok(s1.correct === 10 && s1.accuracy === 1, '全部合っていれば正答率100%');

  // 途中から崩れた場合
  const partial = expected.map((sym, i) => ({ symbol: i < 6 ? sym : 'X', rt: 800 }));
  const s2 = core.scoreRecall(expected, partial);
  ok(s2.correct === 6 && s2.streak === 6, '6問目まで正解なら連続正答は6');
}

console.log('--- 問題数の増減の目安 (n = 0) ---');
ok(core.suggestNextTrials(10, 0, 0) === 11, '全問正解 → 問題数 +1');
ok(core.suggestNextTrials(10, 0, 1) === 10, '誤答1 → 据え置き');
ok(core.suggestNextTrials(10, 0, 4) === 9, '誤答4 → 問題数 -1');
ok(core.suggestNextTrials(2, 0, 9) === 2, '2問より短くはしない');

console.log('\n' + (fails === 0 ? 'すべて通過' : fails + ' 件 失敗'));
process.exit(fails ? 1 : 0);
