/* core.js — 刺激列の生成と判定。DOM に一切触らない。
   モダリティは「どの記号集合を使うか」だけの違いとして扱い、
   提示方法（見せる／鳴らす）はここでは決めない。 */
(function (NB) {
  'use strict';

  // ---- 乱数 ---------------------------------------------------------------
  // mulberry32。シードを記録すれば同じ列を再現できる。
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    return (Math.random() * 0xFFFFFFFF) >>> 0;
  }

  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---- 刺激列の生成 -------------------------------------------------------
  /**
   * @param {object} opt
   *   n           : 何個前と比較するか
   *   trials      : 試行数
   *   targetRate  : ターゲット率。0 なら ターゲットを置かない
   *                 （自分のペース方式は毎試行が出題なのでターゲットの概念がない）
   *   alphabet    : 記号の配列（数字でも位置番号でも文字でも同じ扱い）
   *   seed        : 乱数シード
   *   lure        : ひっかけ（N±1 の位置に同じ記号）を置くか。既定 false
   *   lureRate    : lure:true のとき置く割合。既定 0.25
   * @returns {{symbols, isTarget, isLure, lures, lurePositions, seed, targets}}
   */
  function generateSequence(opt) {
    const n = opt.n;
    const trials = opt.trials;
    const alphabet = opt.alphabet;
    const lure = !!opt.lure;
    const lureRate = opt.lureRate === undefined ? 0.25 : opt.lureRate;
    const targetRate = opt.targetRate || 0;
    const seed = (opt.seed === undefined || opt.seed === null) ? randomSeed() : (opt.seed >>> 0);
    const rng = makeRng(seed);

    if (alphabet.length < 2) throw new Error('alphabet が短すぎる');
    if (trials < 1) throw new Error('trials は1以上必要');
    if (n > 0 && trials <= n) throw new Error('trials は n より多く必要');

    // n = 0 は「Nバック構造も ひっかけも作らない」指示。
    if (n === 0) {
      const plain = new Array(trials);
      for (let i = 0; i < trials; i++) {
        // 直前と同じ記号だけは避ける。2回出たのか1回だったのか分からなくなるため。
        const pool = i === 0 ? alphabet : alphabet.filter(s => s !== plain[i - 1]);
        plain[i] = pool[Math.floor(rng() * pool.length)];
      }
      return {
        symbols: plain, isTarget: new Array(trials).fill(false),
        isLure: new Array(trials).fill(false), lures: 0, lurePositions: [],
        seed: seed, targets: 0
      };
    }

    const plantTargets = targetRate > 0;

    // 最初の n 試行はターゲットになり得ない。残りから正確な個数を選ぶ。
    const eligible = [];
    for (let i = n; i < trials; i++) eligible.push(i);
    const targetCount = plantTargets ? Math.max(1, Math.round(targetRate * eligible.length)) : 0;
    const shuffledEligible = shuffled(eligible, rng);
    const targetSet = new Set(shuffledEligible.slice(0, targetCount));

    /* ひっかけを置く位置。ターゲット以外から選ぶ。
       ひっかけの間隔は N-1 と N+1。N=1 のとき N-1=0 は間隔にならないので外す。 */
    const lureLags = [n - 1, n + 1].filter(d => d >= 1 && d !== n);
    const lureSet = new Set();
    if (lure && lureLags.length) {
      const cand = shuffledEligible.filter(i =>
        !targetSet.has(i) && lureLags.some(d => i - d >= 0));
      const count = Math.max(1, Math.round(lureRate * cand.length));
      cand.slice(0, count).forEach(i => lureSet.add(i));
    }

    const symbols = new Array(trials);
    const isTarget = new Array(trials).fill(false);

    for (let i = 0; i < trials; i++) {
      if (targetSet.has(i)) {
        symbols[i] = symbols[i - n];
        isTarget[i] = true;
        continue;
      }

      // ひっかけを置く位置：N±1 の記号をそのまま持ってくる
      if (lureSet.has(i)) {
        const lags = shuffled(lureLags.filter(d => i - d >= 0), rng);
        let placed = false;
        for (const d of lags) {
          const v = symbols[i - d];
          // ターゲットを置く方式では、N個前と一致させてはいけない（ターゲットになってしまう）
          if (plantTargets && i - n >= 0 && v === symbols[i - n]) continue;
          symbols[i] = v;
          placed = true;
          break;
        }
        if (placed) continue;
        lureSet.delete(i);   // 置けなかった。通常の生成に落とす。
      }

      /* 通常の位置。ひっかけの間隔では一致させない。
         こうしておくと、実際に生じるひっかけは「意図的に置いたものだけ」になり、
         偶然の一致と混ざらない。lure が off なら1つも生じない。 */
      const banned = new Set();
      if (plantTargets && i - n >= 0) banned.add(symbols[i - n]);
      lureLags.forEach(function (d) { if (i - d >= 0) banned.add(symbols[i - d]); });
      // 直前と同じ記号も避ける（2回出たのか1回だったのか分からなくなるため）。
      // ただし N=1 のときの1個前は「答えそのもの」なので縛らない。
      if (n !== 1 && i - 1 >= 0) banned.add(symbols[i - 1]);

      let pool = alphabet.filter(s => !banned.has(s));
      if (pool.length === 0) {
        pool = plantTargets && i - n >= 0
          ? alphabet.filter(s => s !== symbols[i - n])
          : alphabet.slice();
      }
      symbols[i] = pool[Math.floor(rng() * pool.length)];
    }

    // 実際に生じたひっかけ位置。上の作りなので、置いた位置と一致するはず。
    const isLure = new Array(trials).fill(false);
    const lurePositions = [];
    for (let i = 0; i < trials; i++) {
      if (isTarget[i]) continue;
      for (const d of lureLags) {
        if (i - d >= 0 && symbols[i] === symbols[i - d]) {
          isLure[i] = true;
          lurePositions.push(i);
          break;
        }
      }
    }

    return {
      symbols: symbols, isTarget: isTarget, isLure: isLure,
      lures: lurePositions.length, lurePositions: lurePositions,
      seed: seed, targets: targetCount
    };
  }

  // ---- 判定 ---------------------------------------------------------------
  /**
   * 1チャンネル分の反応を集計する。
   * @param {boolean[]} isTarget
   * @param {Array<{responded:boolean, rt:number|null}>} responses 試行ごとの反応
   */
  function score(isTarget, responses) {
    let hits = 0, misses = 0, falseAlarms = 0, correctRejections = 0;
    const hitRts = [], allRts = [];

    for (let i = 0; i < isTarget.length; i++) {
      const r = responses[i] || { responded: false, rt: null };
      if (r.responded && r.rt !== null) allRts.push(r.rt);
      if (isTarget[i]) {
        if (r.responded) { hits++; if (r.rt !== null) hitRts.push(r.rt); }
        else misses++;
      } else {
        if (r.responded) falseAlarms++;
        else correctRejections++;
      }
    }

    const targets = hits + misses;
    const nonTargets = falseAlarms + correctRejections;
    // 正答率だけでは「全部押す」戦略を見抜けないので、必ず2つ別々に持つ。
    const hitRate = targets ? hits / targets : 0;
    const faRate = nonTargets ? falseAlarms / nonTargets : 0;

    return {
      trials: isTarget.length,
      targets, nonTargets,
      hits, misses, falseAlarms, correctRejections,
      hitRate, faRate,
      dPrime: dPrime(hits, targets, falseAlarms, nonTargets),
      meanRt: hitRts.length ? Math.round(mean(hitRts)) : null,       // ヒット時のみ
      meanRtAll: allRts.length ? Math.round(mean(allRts)) : null     // 押した全反応
    };
  }

  function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }

  // 対数線形補正つき d'。0%/100% でも無限大にならない。
  function dPrime(hits, targets, fa, nonTargets) {
    if (!targets || !nonTargets) return null;
    const h = (hits + 0.5) / (targets + 1);
    const f = (fa + 0.5) / (nonTargets + 1);
    return round2(probit(h) - probit(f));
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  // 標準正規分布の逆関数（Acklam の近似）
  function probit(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
               1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
               6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
               -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
               3.754408661907416e+00];
    const pl = 0.02425, ph = 1 - pl;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
    if (p > ph) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
              ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }

  // ---- 判定：自分のペースで進む方式 ---------------------------------------
  /**
   * 正解列と回答列を突き合わせる集計。自分のペースで進む方式すべてで使う。
   * @param {string[]} expected 正解の記号列
   * @param {Array<{symbol:string, rt:number|null}>} answers 実際の回答
   */
  function scoreAnswers(expected, answers) {
    const flags = [];
    const rts = [];
    let correct = 0;
    for (let i = 0; i < expected.length; i++) {
      const a = answers[i];
      const hit = !!a && a.symbol === expected[i];
      flags.push(hit);
      if (hit) correct++;
      if (a && a.rt !== null && a.rt !== undefined) rts.push(a.rt);
    }
    return {
      questions: expected.length,
      answered: answers.filter(a => !!a).length,
      correct: correct,
      incorrect: expected.length - correct,
      accuracy: expected.length ? correct / expected.length : 0,
      correctFlags: flags,
      meanRt: rts.length ? Math.round(mean(rts)) : null,
      // 最初の何問を続けて正解できたか。系列の頭がどこまで保つかを見る。
      streak: (function () {
        let k = 0;
        while (k < flags.length && flags[k]) k++;
        return k;
      })()
    };
  }

  // ---- 提示後に入力する方式の難易度 ---------------------------------------
  // この方式の難易度は問題数（＝提示数）そのもの。
  // Jaeggi の考え方を、20試行ではなく数問のブロックに合わせて縮めた。
  // 自分のペースで進む方式は1ブロックの問題数を自由に決められるので、
  // 件数の閾値だと問題数によって意味が変わってしまう。割合で見る。
  function suggestNextNByRate(currentN, accuracy) {
    if (accuracy === null || accuracy === undefined) return currentN;
    if (accuracy >= 0.9) return currentN + 1;
    if (accuracy < 0.7) return Math.max(1, currentN - 1);
    return currentN;
  }

  // ---- 適応的難易度（第2段階で使う。判定は今から持っておく） ---------------
  // Jaeggi ら: ミス+誤警報 が 3以下なら N+1、5以上なら N-1。
  function suggestNextN(currentN, s) {
    const errors = s.misses + s.falseAlarms;
    if (errors <= 3) return currentN + 1;
    if (errors >= 5) return Math.max(1, currentN - 1);
    return currentN;
  }

  NB.core = { makeRng, randomSeed, generateSequence, score, scoreAnswers,
              dPrime, probit, suggestNextN, suggestNextNByRate };
})(window.NB = window.NB || {});
