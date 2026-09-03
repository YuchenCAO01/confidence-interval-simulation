'use strict';

/* ============================================================
   MATH  (kept together so it can be unit-tested in isolation)
   ============================================================ */
/* --- math:start --- */

/* Acklam's rational approximation of the inverse standard normal CDF.
   |relative error| < 1.15e-9 — this is the invNorm() of a graphics calculator. */
const AK_A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const AK_B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
const AK_C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
              -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const AK_D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
              3.754408661907416e+00];

function invNorm(area, mu, sigma) {
  mu = mu === undefined ? 0 : mu;
  sigma = sigma === undefined ? 1 : sigma;
  if (!(area > 0 && area < 1)) return area <= 0 ? -Infinity : Infinity;
  const LOW = 0.02425, HIGH = 1 - LOW;
  let x, q, r;
  if (area < LOW) {
    q = Math.sqrt(-2 * Math.log(area));
    x = (((((AK_C[0] * q + AK_C[1]) * q + AK_C[2]) * q + AK_C[3]) * q + AK_C[4]) * q + AK_C[5]) /
        ((((AK_D[0] * q + AK_D[1]) * q + AK_D[2]) * q + AK_D[3]) * q + 1);
  } else if (area <= HIGH) {
    q = area - 0.5; r = q * q;
    x = (((((AK_A[0] * r + AK_A[1]) * r + AK_A[2]) * r + AK_A[3]) * r + AK_A[4]) * r + AK_A[5]) * q /
        (((((AK_B[0] * r + AK_B[1]) * r + AK_B[2]) * r + AK_B[3]) * r + AK_B[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - area));
    x = -(((((AK_C[0] * q + AK_C[1]) * q + AK_C[2]) * q + AK_C[3]) * q + AK_C[4]) * q + AK_C[5]) /
         ((((AK_D[0] * q + AK_D[1]) * q + AK_D[2]) * q + AK_D[3]) * q + 1);
  }
  return mu + sigma * x;
}

/* tail area used by invNorm, e.g. C = 95  ->  0.025 */
function tailArea(confPct) { return (1 - confPct / 100) / 2; }

/* number of successes in n independent trials with probability p */
function drawSuccesses(n, p) {
  let x = 0;
  for (let i = 0; i < n; i++) if (Math.random() < p) x++;
  return x;
}

/* one-proportion z interval:  p-hat  +/-  z* sqrt(p-hat(1 - p-hat) / n) */
function buildInterval(x, n, confPct, p) {
  const phat = x / n;
  const z = invNorm(tailArea(confPct));      // negative, as invNorm returns it
  const zStar = Math.abs(z);
  const se = Math.sqrt(phat * (1 - phat) / n);
  const moe = zStar * se;
  const lo = phat - moe, hi = phat + moe;
  return { x: x, n: n, phat: phat, z: z, zStar: zStar, se: se, moe: moe,
           lo: lo, hi: hi, ok: lo <= p && p <= hi };
}

/* a "nice" axis step (1, 2, 5 x 10^k) close to the requested size */
function niceStep(raw) {
  if (!(raw > 0)) return 0.1;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / e;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e;
}
/* --- math:end --- */


/* ============================================================
   STATE
   ============================================================ */
const MAX_DRAWN = 50;    // intervals drawn on the plot at once
const MAX_ROWS  = 400;   // rows kept in the side list

const state = {
  p: 0.6,
  n: 50,
  C: 95,
  batch: 50,
  showWork: true,
  samples: [],   // every interval, newest last
  drawn: [],     // <= MAX_DRAWN of them, newest first
  nIn: 0,
  busy: false
};

/* ============================================================
   DOM
   ============================================================ */
const $ = (sel) => document.querySelector(sel);

const el = {
  pNum: $('#p-num'), pRange: $('#p-range'),
  nNum: $('#n-num'), nRange: $('#n-range'),
  cNum: $('#c-num'), cRange: $('#c-range'), cChips: $('#c-chips'),
  zOut: $('#zstar-out'), chip: $('#formula-chip'),
  btnOne: $('#btn-one'), btnMany: $('#btn-many'), btnClear: $('#btn-clear'),
  batchNum: $('#batch-num'), batchLabel: $('#batch-label'), batchChips: $('#batch-chips'),
  showWork: $('#show-work'),
  canvas: $('#canvas'), gridLines: $('#grid-lines'),
  oobLo: $('#oob-lo'), oobHi: $('#oob-hi'),
  pline: $('#pline'), pvalue: $('#pvalue'),
  intervals: $('#intervals'), axis: $('#axis'), emptyHint: $('#empty-hint'),
  statTotal: $('#stat-total'), statIn: $('#stat-in'), statOut: $('#stat-out'),
  statRate: $('#stat-rate'), meterFill: $('#meter-fill'), meterMark: $('#meter-mark'),
  meterMarkLabel: $('#meter-mark-label'), statNominal: $('#stat-nominal'),
  list: $('#list'), listCount: $('#list-count'),
  overlay: $('#overlay'), sheetId: $('#sheet-id'), steps: $('#steps'),
  btnSkip: $('#btn-skip'), sheetFoot: $('#sheet-foot')
};

const fx = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ============================================================
   CONTROLS
   ============================================================ */
function readNumber(input, fallback, lo, hi) {
  const v = parseFloat(input.value);
  return Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function setP(v, from) {
  state.p = Math.round(clamp(v, 0.01, 0.99) * 1000) / 1000;
  if (from !== 'num') el.pNum.value = String(state.p);
  if (from !== 'range') el.pRange.value = String(clamp(state.p, 0.01, 0.99));
  afterSettingChange();
}
function setN(v, from) {
  state.n = Math.round(clamp(v, 5, 5000));
  if (from !== 'num') el.nNum.value = String(state.n);
  if (from !== 'range') el.nRange.value = String(clamp(state.n, 10, 500));
  afterSettingChange();
}
function setC(v, from) {
  state.C = Math.round(clamp(v, 50, 99.9) * 10) / 10;
  if (from !== 'num') el.cNum.value = String(state.C);
  if (from !== 'range') el.cRange.value = String(state.C);
  markChips(el.cChips, 'c', state.C);
  afterSettingChange();
}
function setBatch(v, from) {
  state.batch = Math.round(clamp(v, 1, 1000));
  if (from !== 'num') el.batchNum.value = String(state.batch);
  el.batchLabel.textContent = String(state.batch);
  markChips(el.batchChips, 'b', state.batch);
}
function markChips(box, key, value) {
  box.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(parseFloat(b.dataset[key]) === value));
  });
}

/* every setting change starts a fresh run so all intervals share n and C */
function afterSettingChange() {
  clearSamples();
  el.zOut.textContent = fx(Math.abs(invNorm(tailArea(state.C))), 4);
  el.pvalue.textContent = fx(state.p, state.p * 1000 % 10 === 0 ? 2 : 3);
  el.statNominal.textContent = fx(state.C, state.C % 1 === 0 ? 0 : 1) + '%';
  el.meterMarkLabel.textContent = fx(state.C, state.C % 1 === 0 ? 0 : 1) + '%';
  el.meterMark.style.left = state.C + '%';
  renderAll();
}

el.pNum.addEventListener('input', () => setP(readNumber(el.pNum, state.p, 0.01, 0.99), 'num'));
el.pRange.addEventListener('input', () => setP(parseFloat(el.pRange.value), 'range'));
el.nNum.addEventListener('input', () => setN(readNumber(el.nNum, state.n, 5, 5000), 'num'));
el.nRange.addEventListener('input', () => setN(parseFloat(el.nRange.value), 'range'));
el.cNum.addEventListener('input', () => setC(readNumber(el.cNum, state.C, 50, 99.9), 'num'));
el.cRange.addEventListener('input', () => setC(parseFloat(el.cRange.value), 'range'));
el.cChips.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) setC(parseFloat(b.dataset.c), 'chip');
});
el.batchNum.addEventListener('input', () => setBatch(readNumber(el.batchNum, state.batch, 1, 1000), 'num'));
el.batchChips.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) setBatch(parseFloat(b.dataset.b), 'chip');
});
el.pNum.addEventListener('change', () => setP(readNumber(el.pNum, state.p, 0.01, 0.99), 'commit'));
el.nNum.addEventListener('change', () => setN(readNumber(el.nNum, state.n, 5, 5000), 'commit'));
el.cNum.addEventListener('change', () => setC(readNumber(el.cNum, state.C, 50, 99.9), 'commit'));
el.batchNum.addEventListener('change', () => setBatch(readNumber(el.batchNum, state.batch, 1, 1000), 'commit'));
el.showWork.addEventListener('change', () => { state.showWork = el.showWork.checked; });

el.btnOne.addEventListener('click', takeOne);
el.btnMany.addEventListener('click', () => takeMany(state.batch));
el.btnClear.addEventListener('click', () => { clearSamples(); renderAll(); });

/* ============================================================
   SAMPLING
   ============================================================ */
function clearSamples() {
  state.samples.length = 0;
  state.drawn.length = 0;
  state.nIn = 0;
}

/* Reservoir sampling keeps the drawn subset a fair sample of every interval
   taken, and keeps it stable between renders. */
function remember(s, forceVisible) {
  state.samples.push(s);
  if (s.ok) state.nIn++;

  const k = state.samples.length;
  if (state.drawn.length < MAX_DRAWN) {
    state.drawn.unshift(s);
  } else {
    const j = Math.floor(Math.random() * k);
    if (j < MAX_DRAWN) state.drawn[j] = s;
    if (forceVisible && state.drawn.indexOf(s) === -1) {
      state.drawn[Math.floor(Math.random() * MAX_DRAWN)] = s;
    }
    state.drawn.sort((a, b) => b.id - a.id);
  }
}

function nextSample() {
  const x = drawSuccesses(state.n, state.p);
  const s = buildInterval(x, state.n, state.C, state.p);
  s.id = state.samples.length + 1;
  return s;
}

function takeOne() {
  if (state.busy) return;
  const s = nextSample();
  if (state.showWork) {
    showWorking(s);
  } else {
    remember(s, true);
    renderAll({ flashId: s.id });
  }
}

function takeMany(count) {
  if (state.busy) return;
  for (let i = 0; i < count; i++) remember(nextSample(), false);
  renderAll({ stagger: true });
}

function setBusy(on) {
  state.busy = on;
  [el.btnOne, el.btnMany, el.btnClear].forEach((b) => { b.disabled = on; });
}

/* ============================================================
   SCALE
   ============================================================ */
function domain() {
  let lo, hi, dLo, dHi;                    /* d* = extent of the real data */
  if (state.drawn.length === 0) {
    /* room for a typical p-hat (about 2.8 SE out) plus its margin of error */
    const se = Math.sqrt(state.p * (1 - state.p) / state.n) || 0.05;
    const w = Math.max((2.8 + Math.abs(invNorm(tailArea(state.C)))) * se, 0.03);
    dLo = dHi = state.p;
    lo = state.p - w; hi = state.p + w;
  } else {
    dLo = state.p; dHi = state.p;
    for (const s of state.drawn) { if (s.lo < dLo) dLo = s.lo; if (s.hi > dHi) dHi = s.hi; }
    const pad = Math.max((dHi - dLo) * 0.07, 0.004);
    lo = dLo - pad; hi = dHi + pad;
  }
  /* padding never reaches outside 0..1 on its own — only real intervals do */
  const floorLo = Math.min(0, dLo), ceilHi = Math.max(1, dHi);
  lo = Math.max(lo, floorLo); hi = Math.min(hi, ceilHi);
  if (hi - lo < 0.01) { const m = (lo + hi) / 2; lo = m - 0.005; hi = m + 0.005; }

  const step = niceStep((hi - lo) / 7);
  lo = Math.max(Math.floor(lo / step - 1e-9) * step, floorLo);
  hi = Math.min(Math.ceil(hi / step + 1e-9) * step, ceilHi);
  const dec = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  return { lo: lo, hi: hi, step: step, dec: dec, span: hi - lo };
}

const pctOf = (d, v) => ((v - d.lo) / d.span) * 100;

/* ============================================================
   RENDER
   ============================================================ */
function renderAll(opt) {
  renderPlot(opt || {});
  renderStats();
  renderList(opt || {});
}

function renderPlot(opt) {
  const d = domain();
  const rows = state.drawn;

  /* number line */
  let ticks = '<div class="line"></div>';
  let lines = '';
  const first = Math.ceil(d.lo / d.step - 1e-9);
  const last = Math.floor(d.hi / d.step + 1e-9);
  for (let i = first; i <= last; i++) {
    const v = i * d.step;
    const x = pctOf(d, v).toFixed(3) + '%';
    ticks += '<div class="t" style="left:' + x + '"></div>' +
             '<div class="tl" style="left:' + x + '">' + v.toFixed(d.dec) + '</div>';
    lines += '<i style="left:' + x + '"></i>';
  }
  el.axis.innerHTML = ticks;
  el.gridLines.innerHTML = lines;

  /* shading for the impossible region outside 0..1 */
  const zeroPct = pctOf(d, 0), onePct = pctOf(d, 1);
  el.oobLo.style.left = '0';
  el.oobLo.style.width = Math.max(0, Math.min(100, zeroPct)) + '%';
  el.oobHi.style.left = Math.max(0, Math.min(100, onePct)) + '%';
  el.oobHi.style.width = Math.max(0, 100 - Math.max(0, Math.min(100, onePct))) + '%';

  /* dashed line at the true p */
  el.pline.style.left = pctOf(d, state.p).toFixed(3) + '%';

  /* intervals, newest on top of the stack */
  const avail = Math.max(120, el.intervals.clientHeight - 30);
  const rowH = rows.length ? clamp(Math.floor(avail / rows.length), 6, 34) : 18;
  const barW = clamp(Math.round(rowH * 0.2), 2, 4);
  const dot = clamp(Math.round(rowH * 0.62), 4, 11);
  const cap = clamp(Math.round(rowH * 0.85), 6, 17);
  el.intervals.style.setProperty('--row-h', rowH + 'px');
  el.intervals.style.setProperty('--bar-w', barW + 'px');
  el.intervals.style.setProperty('--dot', dot + 'px');
  el.intervals.style.setProperty('--cap', cap + 'px');

  let html = '';
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const a = pctOf(d, s.lo), b = pctOf(d, s.hi), m = pctOf(d, s.phat);
    html += '<div class="iv' + (s.ok ? '' : ' miss') + (s.id === opt.flashId ? ' flash' : '') +
            '" style="--lo:' + a.toFixed(3) + '%;--hi:' + b.toFixed(3) + '%;--mid:' + m.toFixed(3) +
            '%;--w:' + Math.max(0, b - a).toFixed(3) + '%;--i:' + i + '"' +
            ' title="#' + s.id + '  (' + fx(s.lo, 4) + ', ' + fx(s.hi, 4) + ')">' +
            '<div class="bar"></div><div class="cap l"></div><div class="cap r"></div><div class="dot"></div></div>';
  }
  el.intervals.classList.toggle('stagger', !!opt.stagger);
  el.intervals.innerHTML = html;
  el.emptyHint.hidden = rows.length > 0;
}

function renderStats() {
  const total = state.samples.length;
  const inn = state.nIn;
  el.statTotal.textContent = String(total);
  el.statIn.textContent = String(inn);
  el.statOut.textContent = String(total - inn);
  const rate = total ? (inn / total) * 100 : null;
  el.statRate.textContent = rate === null ? '—' : fx(rate, 1) + '%';
  el.meterFill.style.width = (rate === null ? 0 : rate) + '%';
}

function renderList(opt) {
  const total = state.samples.length;
  el.listCount.textContent = String(total);
  if (!total) {
    el.list.innerHTML = '<p class="list-empty">No samples yet.</p>';
    return;
  }
  const start = Math.max(0, total - MAX_ROWS);
  let html = '';
  for (let i = total - 1; i >= start; i--) {
    const s = state.samples[i];
    html += '<div class="row' + (s.ok ? '' : ' miss') + (s.id === opt.flashId ? ' new' : '') + '">' +
            '<span class="id">#' + s.id + '</span>' +
            '<span class="pv">' + fx(s.phat, 3) + '</span>' +
            '<span class="ci">(' + fx(s.lo, 4) + ', ' + fx(s.hi, 4) + ')</span></div>';
  }
  if (start > 0) html += '<p class="list-more">+ ' + start + ' earlier samples</p>';
  el.list.innerHTML = html;
  el.list.scrollTop = 0;
}

/* ============================================================
   MATHS TYPESETTING
   The radical and brackets are SVG paths stretched to the height of whatever
   they wrap, so they fit the expression instead of being a fixed-size glyph.
   Pass a {phat, z, n} of strings to substitute numbers, or nothing for the
   symbolic form — the page header and the working then read identically.
   ============================================================ */
const RT_SVG = '<svg class="rt-sign" viewBox="0 0 12 30" preserveAspectRatio="none" aria-hidden="true">' +
               '<path d="M0.4 17.6 L3.2 17.6 L6.6 28.8 L12 0"/></svg>';
const PAR_L = '<svg class="par l" viewBox="0 0 8 40" preserveAspectRatio="none" aria-hidden="true">' +
              '<path d="M6.6 0.7 C1.9 12 1.9 28 6.6 39.3"/></svg>';
const PAR_R = '<svg class="par r" viewBox="0 0 8 40" preserveAspectRatio="none" aria-hidden="true">' +
              '<path d="M1.4 0.7 C6.1 12 6.1 28 1.4 39.3"/></svg>';
const PHAT = '<span class="ph">p</span>';

const num = (t) => '<span class="mn">' + t + '</span>';
const frac = (a, b) => '<span class="fr"><span class="fr-n">' + a + '</span>' +
                       '<span class="fr-d">' + b + '</span></span>';
const sqrt = (inner) => '<span class="rt">' + RT_SVG + '<span class="rt-body">' + inner + '</span></span>';

/* one end of the interval:  p-hat  -/+  z sqrt( p-hat(1 - p-hat) / n ) */
function endpoint(sign, v) {
  const p = v ? num(v.phat) : PHAT;
  const z = v ? num(v.z) : '<i>z</i>';
  const n = v ? num(v.n) : '<i>n</i>';
  return '<span class="mth">' + p + '<span class="sg">' + sign + '</span>' + z +
         sqrt(frac(p + '(1&minus;' + p + ')', n)) + '</span>';
}

/* ( lower , upper ) */
function ciFormula(v) {
  return '<span class="mth">' + PAR_L + endpoint('&minus;', v) +
         '<span class="cm">,</span>' + endpoint('+', v) + PAR_R + '</span>';
}

/* ( 0.3815 , 0.6585 ) */
function ciResult(lo, hi) {
  return '<span class="mth">' + PAR_L + num(lo) + '<span class="cm">,</span>' +
         num(hi) + PAR_R + '</span>';
}

/* ============================================================
   STEP-BY-STEP WORKING
   ============================================================ */
const STEP_MS = 800;      // pause between steps of the working

let timers = [];
let pending = null;
let allShown = false;     // every step revealed — the next click closes the sheet

function clearTimers() { timers.forEach(clearTimeout); timers = []; }

function stepHTML(n, title, body) {
  return '<div class="step" data-step="' + n + '"><div class="step-n">' + n + '</div>' +
         '<div class="step-b"><div class="step-t">' + title + '</div>' +
         '<div class="step-m">' + body + '</div></div></div>';
}

function showWorking(s) {
  pending = s;
  setBusy(true);
  el.sheetId.textContent = '#' + s.id;

  const C = state.C, n = state.n, p = state.p;
  const cStr = fx(C / 100, C % 1 === 0 ? 2 : 3);
  const pStr = fx(p, p * 1000 % 10 === 0 ? 2 : 3);
  const dec = fx(C, C % 1 === 0 ? 0 : 1);
  const phatStr = fx(s.phat, 4), zStr = fx(s.zStar, 4);
  const loStr = fx(s.lo, 4), hiStr = fx(s.hi, 4);

  /* 1. the sample */
  let dots = '';
  if (n <= 150) {
    const seats = new Array(n);
    for (let i = 0; i < n; i++) seats[i] = i < s.x;          // x successes
    for (let i = n - 1; i > 0; i--) {                        // scatter them
      const j = Math.floor(Math.random() * (i + 1));
      const t = seats[i]; seats[i] = seats[j]; seats[j] = t;
    }
    dots = '<div class="dots">';
    for (let i = 0; i < n; i++) {
      dots += '<i class="' + (seats[i] ? 's' : '') + '" style="animation-delay:' +
              (i * (260 / n)).toFixed(0) + 'ms"></i>';
    }
    dots += '</div>';
  }
  const step1 = '<span><i>n</i> = <span class="v">' + n + '</span> people sampled from a population with ' +
                '<i>p</i> = <span class="v">' + pStr + '</span></span>' +
                '<div style="width:100%">Number of successes: <span class="big">X = ' + s.x + '</span>' + dots + '</div>';

  /* 2. sample proportion */
  const step2 = '<span class="mth">' + PHAT + '<span class="eqs">=</span>' + frac('<i>X</i>', '<i>n</i>') +
                '<span class="eqs">=</span>' + frac(num(s.x), num(n)) +
                '<span class="eqs">=</span><span class="big">' + phatStr + '</span></span>';

  /* 3. critical value */
  const step3 = '<span><i>z</i> = invNorm( (1 &minus; <span class="v">' + cStr + '</span>) / 2, 0, 1 ) = invNorm(<span class="v">' +
                fx(tailArea(C), 4) + '</span>) = <span class="big neg">' + fx(s.z, 4) + '</span></span>' +
                '<span style="width:100%">take its magnitude: <i>z</i> = <span class="big">' + zStr + '</span></span>';

  /* 4. straight into the interval formula */
  const mLo = Math.min(s.lo, p), mHi = Math.max(s.hi, p);
  const mPad = Math.max((mHi - mLo) * 0.16, 0.01);
  const dLo = mLo - mPad, dSpan = (mHi + mPad) - dLo;
  const at = (v) => (((v - dLo) / dSpan) * 100).toFixed(2) + '%';
  const mini = '<div class="mini' + (s.ok ? '' : ' miss') + '">' +
      '<div class="mline"></div>' +
      '<div class="mbar" style="left:' + at(s.lo) + ';right:' + (100 - parseFloat(at(s.hi))).toFixed(2) + '%"></div>' +
      '<div class="mcap" style="left:calc(' + at(s.lo) + ' - 1.5px)"></div>' +
      '<div class="mcap" style="left:calc(' + at(s.hi) + ' - 1.5px)"></div>' +
      '<div class="mdot" style="left:' + at(s.phat) + '"></div>' +
      '<div class="mp" style="left:' + at(p) + '"></div>' +
      '<div class="mlab" style="left:' + at(s.lo) + '">' + loStr + '</div>' +
      '<div class="mlab" style="left:' + at(s.hi) + '">' + hiStr + '</div>' +
      '</div>' +
      '<div class="verdict ' + (s.ok ? 'in' : 'out') + '"><span class="mark">' + (s.ok ? '&#10003;' : '&#10007;') +
      '</span>' + (s.ok ? 'This interval captures ' : 'This interval misses ') + 'p = ' + pStr +
      (s.ok ? '' : ' \u2014 it happens about ' + fx(100 - C, C % 1 === 0 ? 0 : 1) + '% of the time') + '</div>';

  const subs = { phat: phatStr, z: zStr, n: String(n) };
  const step4 = '<div class="plate">' + ciFormula() + '</div>' +
      '<div class="eps">' +
        '<div class="ep"><span class="ep-tag">Lower</span>' + endpoint('&minus;', subs) +
          '<span class="mth"><span class="eqs">=</span></span><span class="ep-out">' + loStr + '</span></div>' +
        '<div class="ep"><span class="ep-tag">Upper</span>' + endpoint('+', subs) +
          '<span class="mth"><span class="eqs">=</span></span><span class="ep-out">' + hiStr + '</span></div>' +
      '</div>' +
      '<div class="answer">' + ciResult(loStr, hiStr) + '</div>' + mini;

  el.steps.innerHTML =
      stepHTML(1, 'Take the sample', step1) +
      stepHTML(2, 'Sample proportion', step2) +
      stepHTML(3, 'Critical value for ' + dec + '%', step3) +
      stepHTML(4, dec + '% confidence interval', step4);

  allShown = false;
  el.btnSkip.textContent = 'Skip \u2192';
  el.sheetFoot.classList.remove('on');
  el.overlay.hidden = false;

  const steps = Array.from(el.steps.querySelectorAll('.step'));
  clearTimers();
  steps.forEach((node, i) => {
    timers.push(setTimeout(() => {
      node.classList.add('on');
      keepInView(node);
      if (i === steps.length - 1) markAllShown();
    }, 80 + i * STEP_MS));
  });
}

/* on a short screen the sheet scrolls; follow the working as it appears */
function keepInView(node) {
  if (node.scrollIntoView) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* the sheet waits for a click from here on — it never closes by itself */
function markAllShown() {
  allShown = true;
  el.btnSkip.textContent = 'Close \u2192';
  el.sheetFoot.classList.add('on');
}

function revealAll() {
  clearTimers();
  el.steps.querySelectorAll('.step').forEach((n) => n.classList.add('on'));
  keepInView(el.steps.lastElementChild);
  markAllShown();
}

function finishWorking() {
  clearTimers();
  el.overlay.hidden = true;
  setBusy(false);
  if (pending) {
    const s = pending; pending = null;
    remember(s, true);
    renderAll({ flashId: s.id });
  }
}

/* one handler for the whole screen, including the Skip / Close button that
   sits inside it: first click finishes the working, the next one closes. */
el.overlay.addEventListener('click', () => {
  if (allShown) finishWorking(); else revealAll();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.overlay.hidden) finishWorking();
});

/* ============================================================
   BOOT
   ============================================================ */
let rt = null;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => renderPlot({}), 120);
});

el.chip.innerHTML = ciFormula();
setP(0.6); setN(50); setC(95); setBatch(50);
renderAll();
