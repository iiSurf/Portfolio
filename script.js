/*
  Runs the frozen lake (figure skaters practising axels, glowing skate marks, falling snow, the malamutes,
  eagle and parrot, the ski resort's chairlifts, the hidden secrets and the music box) and builds a shop in
  the village for every card in cards.js.
  You shouldn't need to edit this file to fill in a card; use cards.js.

  The file has two parts:
  1. The skater engine (createSkaterRink): small paper-cut figure skaters who glide, set up and try
     axel jumps, sometimes landing, sometimes two-footing, sometimes falling and getting back up.
  2. The page itself, which places the engine on the lake and runs everything else.
*/

/* ======================================================================================
   1. Skater engine
   ====================================================================================== */
/*
 * skaters.js - figure skaters practising axel jumps, for the portfolio hero.
 * Plain ES5, no dependencies. Defines one global function: createSkaterRink(opts).
 *
 * opts = {
 *   layer:     SVGGElement   skaters are drawn here
 *   reflLayer: SVGGElement   mirrored reflections are drawn here (give it a low opacity)
 *   ice: { icePolygon: [[x,y],...], horizonY, nearY, skaterHeightFar, skaterHeightNear, farY? }
 *              (viewBox units; farY is optional, when given skaterHeightFar applies at farY)
 *   count: 4, seed: 1, reduceMotion: false
 * }
 * returns rink = {
 *   step(nowMs)      advance + render (call every animation frame)
 *   setIce(ice)      new layout; skaters are kept and re-clamped into the new polygon
 *   blades()         [{x, y, onIce, scrape, color:"r,g,b"}] one per skater, this frame
 *   skaterAt(x, y)   index of the skater under a viewBox point, or -1
 *   trigger(i)       skater i attempts an axel as soon as possible; returns what the skater is doing now:
 *                    'setup' (the attempt starts within a few seconds), 'jumping' (one is under way, another
 *                    follows), 'getup' (after getting up from a fall), 'after' (right after this move), '' (none)
 *   elements()       each skater's root <g> (for click handlers; it is re-ordered for depth every frame)
 *   boxes()          [[x0, y0, x1, y1], ...] each skater's on-screen box this frame (viewBox units)
 *   setLite(on)      true: cheaper frames (slow device), false: full quality, null: decide by its own timing
 * }
 *
 * blades(): onIce is false in the air, while sliding / sitting / kneeling after a fall, and in
 * reduceMotion (nobody moves, so no marks are cut); scrape is true during the fall slide.
 * reduceMotion: skaters are placed once in still poses (one-leg glides, a landing pose) and
 * step() does nothing.
 *
 * How it works: each skater is a small 3D skeleton (pelvis, spine, head, two-bone IK legs
 * and arms) posed by blending numeric pose vectors. Every frame the skeleton is turned to
 * the skater's facing direction, projected, and the flat paper-cut parts (built once) are
 * moved by updating their transforms only (through the SVG DOM, SVGTransform.setMatrix /
 * setTranslate, with a setAttribute fallback); the DOM is never rebuilt. The skaters travel
 * on the ice in a perspective "world" plane recovered from the ice description, so far
 * skaters move slower and smaller, and steering keeps them inside the polygon and apart.
 *
 * Cost: about 0.15 ms per skater per frame on a laptop (~0.5 ms at 4x CPU throttle). The
 * faint reflection refreshes its limbs at 20 Hz (full rate in the air), and if step() keeps
 * costing more than ~3 ms, or the page calls setLite(true) because whole frames are slow (a slow
 * phone), it drops to 10 Hz and steering re-plans less often.
 * rink._debug holds testing hooks (force an outcome, freeze a pose, inspect state); it is
 * not part of the public contract.
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var PI = Math.PI, TAU = PI * 2;
  var RINK_ID = 0;

  /* ------------------------------------------------------------------ helpers */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function ease(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * t * (t * (t * 6 - 15) + 10); }
  function wrap(a) { a = (a + PI) % TAU; if (a <= 0) a += TAU; return a - PI; }
  function mulberry(s) {
    s = s >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function n2(v) { return Math.round(v * 100) / 100; }
  function n3(v) { return Math.round(v * 1000) / 1000; }
  function el(tag, at, parent) {
    var e = document.createElementNS(NS, tag);
    if (at) for (var k in at) if (at.hasOwnProperty(k)) e.setAttribute(k, at[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  var AK = {};
  function setA(e, k, v) { var c = AK[k] || (AK[k] = '_a' + k); if (e[c] !== v) { e.setAttribute(k, v); e[c] = v; } }
  function m6(m, a, b, c, d, e, f) { m[0] = a; m[1] = b; m[2] = c; m[3] = d; m[4] = e; m[5] = f; return m; }
  /* Transforms are written through the SVG DOM (SVGTransform.setMatrix) when available: no string
     building or parsing, about 2.5x cheaper than setAttribute('transform', ...). Unchanged values are
     skipped. Falls back to the attribute where the SVG DOM is missing. */
  var SVG_ROOT = null, SVG_M = null;
  function initSvgDom(node) {
    if (SVG_M) return;
    try {
      var svg = node && (node.ownerSVGElement || (node.tagName && node.tagName.toLowerCase() === 'svg' ? node : null));
      if (!svg || !svg.createSVGMatrix || !svg.createSVGTransform) return;
      // self-test on a detached element: both write paths must work and read back correctly
      var g = document.createElementNS(NS, 'g'), bl = g.transform.baseVal, m = svg.createSVGMatrix();
      bl.initialize(svg.createSVGTransform());
      var tf = bl.getItem(0);
      m.a = 2; m.b = 0.5; m.c = -0.5; m.d = 2; m.e = 7; m.f = -3;
      tf.setMatrix(m);
      var ok = Math.abs(tf.matrix.a - 2) < 1e-6 && Math.abs(tf.matrix.c + 0.5) < 1e-6 && Math.abs(tf.matrix.f + 3) < 1e-6;
      tf.setTranslate(4, 5);
      ok = ok && Math.abs(tf.matrix.e - 4) < 1e-6 && Math.abs(tf.matrix.f - 5) < 1e-6 && Math.abs(tf.matrix.a - 1) < 1e-6;
      if (ok) { SVG_ROOT = svg; SVG_M = m; }
    } catch (err) { SVG_ROOT = null; SVG_M = null; }
  }

  // a slot = one animated element + the last matrix written to it (plain objects: fast, monomorphic)
  function slot(e, idx, translateOnly) { return { e: e, i: idx, tr: !!translateOnly, m: [NaN, 0, 0, 0, 0, 0], tf: null }; }
  var TOL_T = 0.01, TOL_M = 4e-4;   // figure units (100 = skater height): far below a device pixel
  function setS(s, m) {
    var c = s.m;
    if (Math.abs(c[4] - m[4]) < TOL_T && Math.abs(c[5] - m[5]) < TOL_T && (s.tr || (Math.abs(c[0] - m[0]) < TOL_M &&
      Math.abs(c[1] - m[1]) < TOL_M && Math.abs(c[2] - m[2]) < TOL_M && Math.abs(c[3] - m[3]) < TOL_M))) return;
    c[0] = m[0]; c[1] = m[1]; c[2] = m[2]; c[3] = m[3]; c[4] = m[4]; c[5] = m[5];
    if (SVG_M) {
      var tf = s.tf;
      if (!tf) {
        var bl = s.e.transform.baseVal;
        bl.initialize(SVG_ROOT.createSVGTransform());
        tf = s.tf = bl.getItem(0);
      }
      if (s.tr) tf.setTranslate(m[4], m[5]);
      else { SVG_M.a = m[0]; SVG_M.b = m[1]; SVG_M.c = m[2]; SVG_M.d = m[3]; SVG_M.e = m[4]; SVG_M.f = m[5]; tf.setMatrix(SVG_M); }
    } else s.e.setAttribute('transform', s.tr ? 'translate(' + n2(m[4]) + ',' + n2(m[5]) + ')' : mtx(m[0], m[1], m[2], m[3], m[4], m[5]));
  }

  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbHex(c) {
    return '#' + ((1 << 24) | (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])).toString(16).slice(1);
  }
  function shade(h, t) {
    var a = hexRgb(h), b = [30, 18, 64];
    return rgbHex([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
  }
  function mtx(a, b, c, d, e, f) {
    return 'matrix(' + n3(a) + ',' + n3(b) + ',' + n3(c) + ',' + n3(d) + ',' + n2(e) + ',' + n2(f) + ')';
  }

  /* ------------------------------------------------------------------ skeleton
     Figure units: 100 = standing height including skates. Body frame: x forward,
     y up, z to the skater's left. Origin = point on the ice under the pelvis. */
  var ANK = 9, SHIN = 22, THIGH = 23, LEG = SHIN + THIGH;
  var HIPW = 4.2, HIPDY = -1;
  var SPINE = 30, SHW = 8.5, SHDY = -2.5;
  var UARM = 15.5, FARM = 13;
  var NECK = 3.6, HEADC = 5.6;

  /* ------------------------------------------------------------------ poses
     py   pelvis height          lift  (not blended, airborne offset)
     roll whole-body lean left+  bp    whole-body pitch forward+
     sp   spine pitch forward+   sr    spine side bend left+   tw torso twist left+
     hp   head pitch down+       hy    head yaw left+
     lx..ro feet: ankle target (x fwd, y = ankle height - 9, z left), t toe-down pitch, o toe yaw
     ax..bz left/right hand target relative to the shoulder in torso frame (hb=0)
           or absolute in body frame (hb=1)
     fl   skirt flare */
  var KEYS = ['py', 'lift', 'roll', 'bp', 'sp', 'sr', 'tw', 'hp', 'hy',
    'lx', 'ly', 'lz', 'lt', 'lo', 'rx', 'ry', 'rz', 'rt', 'ro',
    'ax', 'ay', 'az', 'bx', 'by', 'bz', 'hb', 'fl'];
  var NK = KEYS.length, K = {};
  for (var ki = 0; ki < NK; ki++) K[KEYS[ki]] = ki;

  var BASE_O = { py: 53, lift: 0, roll: 0, bp: 0, sp: 0.06, sr: 0, tw: 0, hp: 0.02, hy: 0,
    lx: 0.5, ly: 0, lz: 4.2, lt: 0, lo: 0.15, rx: 0.5, ry: 0, rz: -4.2, rt: 0, ro: -0.15,
    ax: 2, ay: -25, az: 6, bx: 2, by: -25, bz: -6, hb: 0, fl: 0 };

  function mkPose(o, base) {
    var a, k;
    if (base) a = base.slice();
    else { a = new Array(NK); for (k in BASE_O) a[K[k]] = BASE_O[k]; }
    for (k in o) if (o.hasOwnProperty(k)) a[K[k]] = o[k];
    return a;
  }
  function copyP(out, a) { for (var i = 0; i < NK; i++) out[i] = a[i]; return out; }
  function mixP(out, a, b, t) { for (var i = 0; i < NK; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; }
  function mirrorP(a, out) {
    var i;
    for (i = 0; i < NK; i++) out[i] = a[i];
    out[K.lx] = a[K.rx]; out[K.ly] = a[K.ry]; out[K.lz] = -a[K.rz]; out[K.lt] = a[K.rt]; out[K.lo] = -a[K.ro];
    out[K.rx] = a[K.lx]; out[K.ry] = a[K.ly]; out[K.rz] = -a[K.lz]; out[K.rt] = a[K.lt]; out[K.ro] = -a[K.lo];
    out[K.ax] = a[K.bx]; out[K.ay] = a[K.by]; out[K.az] = -a[K.bz];
    out[K.bx] = a[K.ax]; out[K.by] = a[K.ay]; out[K.bz] = -a[K.az];
    out[K.roll] = -a[K.roll]; out[K.sr] = -a[K.sr]; out[K.tw] = -a[K.tw]; out[K.hy] = -a[K.hy];
    return out;
  }

  var P_STAND = mkPose({});
  var P_TWO = mkPose({ py: 51, sp: 0.12, lx: 0.5, lz: 4, rx: 0.5, rz: -4, ax: 5, ay: -10, az: 23, bx: 5, by: -10, bz: -23 });
  var P_GLIDE_R = mkPose({ py: 49.5, sp: 0.2, rx: 1, ry: 0, rz: -1.5, ro: -0.05, lx: -24, ly: 6, lz: 4, lt: 0.55, lo: 0.45,
    ax: 6, ay: -7, az: 25, bx: 6, by: -7, bz: -25, hp: -0.05 });
  var P_GLIDE_L = mirrorP(P_GLIDE_R, new Array(NK));
  var P_THREE = mkPose({ py: 48.5, sp: 0.16, lx: 1, ly: 0, lz: 1.5, lo: 0.05, rx: -7, ry: 5, rz: -3, rt: 0.4, ro: -0.1,
    ax: 10, ay: -9, az: 18, bx: -6, by: -9, bz: -20, tw: 0.25 });
  var P_MOHAWK = mkPose({ py: 48.5, sp: 0.14, rx: 1, ry: 0, rz: -1.5, ro: -0.05, lx: -6, ly: 5, lz: 3, lt: 0.4, lo: 0.1,
    ax: -6, ay: -9, az: 20, bx: 10, by: -9, bz: -18, tw: -0.25 });
  // the long one-leg glide before the jump: the free boot is held well clear of the ice behind (about 15% of height)
  var P_LFO = mkPose({ py: 47, sp: 0.21, lx: 2, ly: 0, lz: 1.5, lo: 0.05, rx: -28, ry: 21, rz: -3.5, rt: 0.42, ro: -0.45,
    ax: -8, ay: -15, az: 18, bx: -13, by: -14, bz: -16, hp: -0.04 });
  var P_LOAD = mkPose({ py: 41, sp: 0.34, lx: 3, ly: 0, lz: 1.5, lo: 0.05, rx: -12, ry: 2.5, rz: -3.5, rt: 0.4, ro: -0.2,
    ax: -19, ay: -15, az: 10, bx: -19, by: -15, bz: -10, hp: 0.04 });
  var P_TAKEOFF = mkPose({ py: 56, sp: -0.04, lx: 0.5, ly: 0, lz: 1, lt: 0.75, lo: 0, rx: 13, ry: 23, rz: -3, rt: 0.35, ro: 0,
    ax: 13, ay: -3, az: 7, bx: 13, by: -3, bz: -7, hp: -0.1 });
  var P_AIR = mkPose({ py: 53.5, sp: 0.03, rx: 0, ry: 0.5, rz: -1.2, rt: 0.55, ro: 0, lx: 3, ly: 6, lz: -3.2, lt: 0.6, lo: -0.25,
    ax: 6, ay: -11, az: -8, bx: 6, by: -9, bz: 8, hp: -0.04, fl: 1 });
  var P_AIR_OPEN = mkPose({ py: 53.5, sp: 0.05, rx: 0, ry: 0, rz: -1.5, rt: 0.5, ro: 0, lx: -12, ly: 9, lz: 3.5, lt: 0.5, lo: 0.3,
    ax: 6, ay: -9, az: 18, bx: 6, by: -9, bz: -18, fl: 0.6 });
  var P_WALTZ_AIR = mkPose({ py: 53.5, sp: 0.05, rx: 10, ry: 12, rz: -3, rt: 0.5, lx: -16, ly: 8, lz: 3, lt: 0.6, lo: 0.2,
    ax: 8, ay: 4, az: 18, bx: 8, by: 4, bz: -18, fl: 0.5 });
  var P_LAND = mkPose({ py: 44, sp: 0.26, rx: 0.5, ry: 0, rz: -1.2, rt: 0, ro: -0.05, lx: -27, ly: 9, lz: 5, lt: 0.6, lo: 0.5,
    ax: 7, ay: -6, az: 25, bx: 7, by: -6, bz: -25, hp: -0.05, fl: 0.3 });
  var P_HOLD = mkPose({ py: 49.5, sp: 0.14, rx: 0.5, ry: 0, rz: -1.2, ro: -0.05, lx: -28, ly: 15, lz: 4.5, lt: 0.65, lo: 0.55,
    ax: 6, ay: -3, az: 26, bx: 6, by: -3, bz: -26, hp: -0.14 });
  var P_PROUD = mkPose({ py: 52, sp: 0, lx: 0.5, lz: 4, rx: 0.5, rz: -4, ax: 2, ay: 23, az: 12, bx: 2, by: 23, bz: -12, hp: -0.22 });
  var P_TWO_LAND = mkPose({ py: 40, sp: 0.36, lx: -3, ly: 0, lz: 6.5, rx: 4, ry: 0, rz: -6, lo: 0.3, ro: -0.3,
    ax: 6, ay: 6, az: 22, bx: 6, by: 6, bz: -22, fl: 0.4 });
  var P_STEADY = mkPose({ py: 49.5, sp: 0.14, lx: 0, lz: 5, rx: 1, rz: -5, ax: 5, ay: -5, az: 25, bx: 5, by: -5, bz: -25 });
  var P_EXHALE = mkPose({ py: 52.5, sp: 0.1, lx: 0.5, lz: 4, rx: 0, rz: -4, ax: 5, ay: -22, az: 9, bx: 5, by: -22, bz: -9, hp: 0.12 });
  var P_BAIL = mkPose({ py: 51.5, sp: 0.1, lx: 1.5, lz: 3.5, rx: -1, rz: -4, ax: 7, ay: -17, az: 13, bx: 7, by: -17, bz: -13 });
  var P_SHRUG = mkPose({ py: 52.5, sp: 0.05, lx: 1, lz: 4, rx: -0.5, rz: -4, ax: 11, ay: -15, az: 15, bx: 11, by: -15, bz: -15, hp: 0.06, sr: 0.06 });
  var P_SLIP = mkPose({ py: 33, bp: -0.22, sp: -0.12, rx: 15, ry: 0, rz: -2, rt: -0.3, lx: 9, ly: 7, lz: 6, lt: 0.2,
    ax: 9, ay: 17, az: 15, bx: 5, by: 13, bz: -18, hp: 0.25, fl: 0.4 });
  var P_SLIDE = mkPose({ py: 6, roll: 0.28, sp: -0.4, rx: 40, ry: -4, rz: -5, rt: -0.9, lx: 27, ly: -2, lz: 6, lt: -0.5,
    hb: 1, ax: -16, ay: 1.5, az: 13, bx: 6, by: 32, bz: -20, hp: 0.15, fl: 0.2 });
  var P_SIT = mkPose({ py: 6, roll: 0.1, sp: -0.55, rx: 42, ry: -5, rz: -5, rt: -1.0, lx: 24, ly: -3, lz: 6, lt: -0.5, lo: 0.2,
    hb: 1, ax: -18, ay: 1.5, az: 12, bx: -18, by: 1.5, bz: -12, hp: 0.12 });
  var P_KNEEL = mkPose({ py: 25.5, sp: 1.3, lx: -21, ly: -6, lz: 4.5, lt: 1.15, lo: 0, rx: -21, ry: -6, rz: -4.5, rt: 1.15, ro: 0,
    hb: 1, ax: 27, ay: 1.5, az: 7, bx: 27, by: 1.5, bz: -7, hp: -0.55 });
  var P_LUNGE = mkPose({ py: 28, sp: 0.5, rx: 15, ry: 0, rz: -5.5, rt: 0, ro: 0, lx: -20, ly: -6, lz: 5, lt: 1.15, lo: 0,
    hb: 1, ax: 20, ay: 31, az: -1, bx: 22, by: 30, bz: -7, hp: -0.25 });
  var P_RISE = mkPose({ py: 50, sp: 0.35, lx: 0.5, lz: 4.5, rx: 2, rz: -4.5, ax: 6, ay: -20, az: 9, bx: 6, by: -20, bz: -9 });
  var P_BRUSH = mkPose({ py: 46, sp: 1.1, lx: 0.5, lz: 4.5, rx: 0.5, rz: -4.5, hb: 1, ax: 13, ay: 34, az: 5, bx: 13, by: 34, bz: -5, hp: -0.3 });

  var POSES = { stand: P_STAND, two: P_TWO, glideR: P_GLIDE_R, glideL: P_GLIDE_L, three: P_THREE, mohawk: P_MOHAWK,
    lfo: P_LFO, load: P_LOAD, takeoff: P_TAKEOFF, air: P_AIR, airOpen: P_AIR_OPEN, waltzAir: P_WALTZ_AIR,
    land: P_LAND, hold: P_HOLD, proud: P_PROUD, twoLand: P_TWO_LAND, steady: P_STEADY, exhale: P_EXHALE,
    bail: P_BAIL, shrug: P_SHRUG, slip: P_SLIP, slide: P_SLIDE, sit: P_SIT, kneel: P_KNEEL, lunge: P_LUNGE,
    rise: P_RISE, brush: P_BRUSH };

  /* ------------------------------------------------------------------ stroke generators */
  var TMP_A = new Array(NK), TMP_B = new Array(NK), TMP_C = new Array(NK), TMP_M = new Array(NK);
  var F5 = [0, 0, 0, 0, 0], G5 = [0, 0, 0, 0, 0];

  // keyframe table rows: [u, x, y, z, toe, yaw]
  function kf(u, tab, out) {
    var n = tab.length, i, j, a, b, t;
    if (u <= tab[0][0]) { for (j = 1; j < 6; j++) out[j - 1] = tab[0][j]; return out; }
    for (i = 0; i < n - 1; i++) {
      if (u <= tab[i + 1][0]) {
        a = tab[i]; b = tab[i + 1];
        t = sstep((u - a[0]) / (b[0] - a[0]));
        for (j = 1; j < 6; j++) out[j - 1] = a[j] + (b[j] - a[j]) * t;
        return out;
      }
    }
    for (j = 1; j < 6; j++) out[j - 1] = tab[n - 1][j];
    return out;
  }
  function setFoot(o, side, f, zs) {
    if (side === 'l') { o[K.lx] = f[0]; o[K.ly] = f[1]; o[K.lz] = f[2] * zs; o[K.lt] = f[3]; o[K.lo] = f[4] * zs; }
    else { o[K.rx] = f[0]; o[K.ry] = f[1]; o[K.rz] = f[2] * zs; o[K.rt] = f[3]; o[K.ro] = f[4] * zs; }
  }

  // forward stroking. First half: glide on R, push with L. Second half mirrored.
  var STROKE_FREE = [[0, 1, 0, 3.5, 0, 0.1], [0.3, -7, 0, 16, 0, 0.55], [0.55, -22, 6, 9, 0.5, 0.35],
    [0.92, 2, 2.5, 3.5, 0.05, 0.1], [1, 1, 0, 3.5, 0, 0.1]];
  var STROKE_SUP = [[0, 1, 0, -3.5, 0, -0.1], [0.5, 1, 0, -1.5, 0, -0.1], [1, 1, 0, -3.5, 0, -0.1]];
  function strokeGen(ph, out) {
    var half = ph < 0.5 ? 0 : 1, u = (ph - half * 0.5) * 2, s = half ? -1 : 1;
    kf(u, STROKE_FREE, F5); kf(u, STROKE_SUP, G5);
    copyP(out, P_STAND);
    var push = Math.sin(PI * clamp(u / 0.45, 0, 1));
    out[K.py] = 50.2 - 2.6 * push; out[K.sp] = 0.24 + 0.04 * push;
    out[K.sr] = -s * 0.03 * push; out[K.tw] = s * 0.06 * Math.sin(PI * u);
    var sw = Math.sin(PI * u) * 3.5;
    out[K.ax] = 5 - s * sw; out[K.ay] = -9; out[K.az] = 24;
    out[K.bx] = 5 + s * sw; out[K.by] = -9; out[K.bz] = -24;
    out[K.hp] = 0;
    if (s > 0) { setFoot(out, 'l', F5, 1); setFoot(out, 'r', G5, 1); }
    else { setFoot(out, 'r', F5, -1); setFoot(out, 'l', G5, -1); }
    return out;
  }

  // forward crossovers turning left (CCW). First half: on R, L under-pushes. Second: on L, R crosses over.
  var CROSS_R = [[0, 2, 0, 4.5, 0, 0], [0.5, 0, 0, 1, 0, 0], [0.66, -4, 0, -13, 0, -0.4], [0.76, -5, 6, -10, 0.4, -0.2],
    [0.92, 6, 5, 3, 0.3, 0.1], [1, 2, 0, 4.5, 0, 0]];
  var CROSS_L = [[0, 0, 0, 1, 0, 0], [0.18, -3, 0, -12, 0, 0.1], [0.28, -6, 5, -8, 0.4, 0.1], [0.42, 1, 3, 5, 0.1, 0.05],
    [0.5, 1, 0, 4.5, 0, 0], [1, 0, 0, 1, 0, 0]];
  function crossCCW(ph, out) {
    kf(ph, CROSS_L, F5); kf(ph, CROSS_R, G5);
    copyP(out, P_STAND);
    var u = (ph * 2) % 1, push = Math.sin(PI * clamp(u / 0.4, 0, 1));
    out[K.py] = 49 - 2 * push; out[K.sp] = 0.22; out[K.tw] = 0.28; out[K.hy] = 0.25; out[K.hp] = 0;
    out[K.ax] = -8; out[K.ay] = -9; out[K.az] = 22; out[K.bx] = 12; out[K.by] = -9; out[K.bz] = -15;
    setFoot(out, 'l', F5, 1); setFoot(out, 'r', G5, 1);
    return out;
  }
  function crossGen(ph, dir, out) {
    if (dir > 0) return crossCCW(ph, out);
    crossCCW((ph + 0.5) % 1, TMP_M);
    return mirrorP(TMP_M, out);
  }

  // back crossovers, travelling CCW while facing backwards (inside = skater's right)
  var BX_L = [[0, 2, 0, -4.5, 0, 0], [0.5, 0, 0, -1, 0, 0], [0.66, 6, 0, 12, 0, 0.35], [0.76, 5, 5, 9, 0.3, 0.2],
    [0.92, 5, 4, -3, 0.2, 0], [1, 2, 0, -4.5, 0, 0]];
  var BX_R = [[0, 0, 0, -1, 0, 0], [0.18, 3, 0, 12, 0, -0.1], [0.28, 2, 5, 8, 0.3, 0], [0.42, -1, 3, -5, 0.1, 0],
    [0.5, -1, 0, -4.5, 0, 0], [1, 0, 0, -1, 0, 0]];
  function backCrossCCW(ph, out) {
    kf(ph, BX_L, F5); kf(ph, BX_R, G5);
    copyP(out, P_STAND);
    var u = (ph * 2) % 1, push = Math.sin(PI * clamp(u / 0.4, 0, 1));
    out[K.py] = 48.5 - 2 * push; out[K.sp] = 0.17; out[K.tw] = -0.32; out[K.hy] = -0.75; out[K.hp] = 0;
    out[K.ax] = 9; out[K.ay] = -8; out[K.az] = 22; out[K.bx] = -9; out[K.by] = -8; out[K.bz] = -21;
    setFoot(out, 'l', F5, 1); setFoot(out, 'r', G5, 1);
    return out;
  }
  function backCrossGen(ph, dir, out) {
    if (dir > 0) return backCrossCCW(ph, out);
    backCrossCCW((ph + 0.5) % 1, TMP_M);
    return mirrorP(TMP_M, out);
  }
  // backward swizzles (lemon drops), both blades on the ice. Everything is a smooth function of the
  // cycle (no wrap-around jump): the toes turn in while the feet slide apart and out while they close.
  function swizzleGen(ph, out) {
    var u = (ph * 2) % 1, w = 0.5 - 0.5 * Math.cos(TAU * u), toe = 0.35 * Math.sin(TAU * u);
    copyP(out, P_STAND);
    out[K.py] = 49.5 - 3 * w; out[K.sp] = 0.14; out[K.hy] = -0.45; out[K.tw] = -0.12;
    out[K.lx] = 1 - 3 * w; out[K.ly] = 0; out[K.lz] = 3.5 + 6 * w; out[K.lo] = -toe; out[K.lt] = 0;
    out[K.rx] = 1 - 3 * w; out[K.ry] = 0; out[K.rz] = -(3.5 + 6 * w); out[K.ro] = toe; out[K.rt] = 0;
    out[K.ax] = 5; out[K.ay] = -8; out[K.az] = 24; out[K.bx] = 5; out[K.by] = -8; out[K.bz] = -24;
    return out;
  }

  /* ------------------------------------------------------------------ overlays */
  function wobble(out, t, amp, ph) {
    out[K.ay] += amp * 7 * Math.sin(t * 9.1 + ph[0]);
    out[K.by] += amp * 7 * Math.sin(t * 10.3 + ph[1]);
    out[K.az] += amp * 4 * Math.sin(t * 6.7 + ph[2]);
    out[K.bz] -= amp * 4 * Math.sin(t * 7.9 + ph[3]);
    out[K.ax] += amp * 4 * Math.sin(t * 5.3 + ph[4]);
    out[K.bx] += amp * 4 * Math.sin(t * 5.9 + ph[5]);
    out[K.sr] += amp * 0.07 * Math.sin(t * 4.1 + ph[6]);
    out[K.roll] += amp * 0.045 * Math.sin(t * 3.3 + ph[7]);
    out[K.py] += amp * 1.4 * Math.sin(t * 5.1 + ph[10]);
    out[K.hp] += amp * 0.06 * Math.sin(t * 4.3 + ph[11]);
  }
  function freeFootWobble(out, t, amp, ph, side) {
    if (side === 'r') { out[K.ry] += amp * 2.5 * Math.sin(t * 4.6 + ph[8]); out[K.rx] += amp * 3 * Math.sin(t * 3.7 + ph[9]); }
    else { out[K.ly] += amp * 2.5 * Math.sin(t * 4.6 + ph[8]); out[K.lx] += amp * 3 * Math.sin(t * 3.7 + ph[9]); }
  }
  function windmill(out, t, amt) {
    var w = t * 13;
    out[K.ax] = lerp(out[K.ax], 3 + 13 * Math.cos(w), amt); out[K.ay] = lerp(out[K.ay], 4 + 14 * Math.sin(w), amt); out[K.az] = lerp(out[K.az], 15, amt);
    out[K.bx] = lerp(out[K.bx], 3 + 13 * Math.cos(w + 0.9), amt); out[K.by] = lerp(out[K.by], 4 + 14 * Math.sin(w + 0.9), amt); out[K.bz] = lerp(out[K.bz], -15, amt);
  }

  /* ------------------------------------------------------------------ outfits */
  var LOOKS = [
    { cut: 'dress', hair: 'bun', skin: '#f2cbae', hairC: '#3b2420', top: '#6c3fc8', sleeve: '#a88be4', skirt: '#7b4ad8',
      hem: '#dcc2ff', legs: '#eabd9d', brief: '#6c3fc8', acc: '#f3c34e', glow: '196,160,255' },
    { cut: 'jacket', hair: 'pony', skin: '#e6b08b', hairC: '#e8b85e', top: '#d8364b', sleeve: '#d8364b', legs: '#2b2458',
      brief: '#2b2458', trim: '#fff2e2', acc: '#fff2e2', glow: '255,128,138' },
    { cut: 'top', hair: 'short', skin: '#a9714f', hairC: '#1d1525', top: '#159fb0', sleeve: '#159fb0', legs: '#25347a',
      brief: '#25347a', trim: '#dfe7f4', acc: '#dfe7f4', glow: '110,228,255' },
    { cut: 'dress', hair: 'pony', skin: '#f6d8c2', hairC: '#9e3b25', top: '#ef8a2e', sleeve: '#ffd29e', skirt: '#f39a35',
      hem: '#ffe08a', legs: '#efc8ac', brief: '#ef8a2e', acc: '#ffe08a', glow: '255,196,112' },
    { cut: 'dress', hair: 'bun', skin: '#7d4c35', hairC: '#1c1320', top: '#f5f1ff', sleeve: '#cdc6ec', skirt: '#ffffff',
      hem: '#e6c264', legs: '#83533a', brief: '#f5f1ff', acc: '#e6c264', glow: '255,238,196' }
  ];
  var BOOT = '#faf8fd', BOOT_FAR = '#e2ddef', BOOT_EDGE = '#9a92c4', SOLE = '#cfc9e3', BLADE = '#c9d1e0', BLADE_FAR = '#aab2c6';

  /* ------------------------------------------------------------------ part shapes (local units) */
  var THIGH_D = 'M0,-3.7C.3,-3.95 .65,-2.9 1,-2.3L1,2.3C.65,2.9 .3,3.95 0,3.7Z';
  var SHIN_D = 'M0,-2.3C.22,-2.75 .5,-2.25 1,-1.7L1,1.7C.5,2.25 .22,2.75 0,2.3Z';
  var UARM_D = 'M0,-1.85L1,-1.4L1,1.4L0,1.85Z';
  var FARM_D = 'M0,-1.4C.35,-1.5 .7,-1.2 1,-1.05L1,1.05C.7,1.2 .35,1.5 0,1.4Z';
  var NECK_D = 'M0,-1.75L1,-1.55L1,1.55L0,1.75Z';
  var HAND_D = 'M-.4,-1.2C1.2,-1.5 3.3,-1.35 4.6,-.45C5.1,0 4.9,.7 4.3,.9C3,1.35 1.2,1.4 -.4,1.15Z';
  var BOOT_D = 'M-3.3,-4.6L2.5,-4.6L2.9,-1.2C3.6,.6 6.2,1.6 8,2.8C9.2,3.6 9.3,5.6 8.6,6.1L-3.6,6.1C-4.1,4 -3.9,0 -3.3,-4.6Z';
  var SOLE_D = 'M-3.6,6.1L8.6,6.1L8.4,6.9L-3.4,6.9Z';
  var BLADE_D = 'M-2.6,6.8L-1.4,6.8L-1.6,7.7L-2.4,7.7ZM5.6,6.8L6.8,6.8L6.6,7.7L5.8,7.7Z' +
    'M-4.6,7.6C-1,7.6 5,7.6 8.4,7.6C9.5,7.6 10.2,8.1 10,8.7L9.3,8.55L9.5,9.05L8.7,8.85C6,9.2 0,9.2 -4.2,8.7C-4.8,8.6 -4.9,7.8 -4.6,7.6Z';
  var TORSO_D = {
    dress: 'M0,-30.8C3,-30.8 6,-30.2 8.6,-29.2C10.8,-28.4 11,-26 10.2,-23.6C9.3,-20.8 8.2,-18 7.4,-15.4C6.6,-12.8 5.4,-11.4 5.3,-9.6' +
      'C5.3,-6 6.8,-3 7,0L7,2L-7,2L-7,0C-6.8,-3 -5.3,-6 -5.3,-9.6C-5.4,-11.4 -6.6,-12.8 -7.4,-15.4C-8.2,-18 -9.3,-20.8 -10.2,-23.6' +
      'C-11,-26 -10.8,-28.4 -8.6,-29.2C-6,-30.2 -3,-30.8 0,-30.8Z',
    jacket: 'M0,-30.8C3,-30.8 6.2,-30.2 8.8,-29.2C11,-28.4 11.3,-26 10.6,-23.6C9.8,-20.8 8.8,-18 8,-15.4C7.2,-12.8 6.2,-11 6.1,-8.8' +
      'C6.2,-4 7.6,0 7.9,5L-7.9,5C-7.6,0 -6.2,-4 -6.1,-8.8C-6.2,-11 -7.2,-12.8 -8,-15.4C-8.8,-18 -9.8,-20.8 -10.6,-23.6' +
      'C-11.3,-26 -11,-28.4 -8.8,-29.2C-6.2,-30.2 -3,-30.8 0,-30.8Z',
    top: 'M0,-30.9C3.4,-30.9 7,-30.3 9.8,-29.3C12,-28.5 12.2,-25.8 11.4,-23.2C10.6,-20.4 9.6,-17.6 8.6,-15C7.6,-12.4 6.6,-10.6 6.5,-8.6' +
      'C6.5,-5 6.9,-2 6.9,0L6.9,2.2L-6.9,2.2L-6.9,0C-6.9,-2 -6.5,-5 -6.5,-8.6C-6.6,-10.6 -7.6,-12.4 -8.6,-15C-9.6,-17.6 -10.6,-20.4 -11.4,-23.2' +
      'C-12.2,-25.8 -12,-28.5 -9.8,-29.3C-7,-30.3 -3.4,-30.9 0,-30.9Z'
  };
  var NECKLINE_D = 'M-3.3,-30.5C-2.3,-27.6 -1.1,-26.3 0,-25.9C1.1,-26.3 2.3,-27.6 3.3,-30.5C1.2,-31 -1.2,-31 -3.3,-30.5Z';
  var SPARKLE_D = 'M-2.6,-22.5a.6,.6 0 1,0 1.2,0a.6,.6 0 1,0 -1.2,0M1.6,-20.2a.5,.5 0 1,0 1,0a.5,.5 0 1,0 -1,0' +
    'M-.5,-17.4a.45,.45 0 1,0 .9,0a.45,.45 0 1,0 -.9,0M2.9,-25.2a.4,.4 0 1,0 .8,0a.4,.4 0 1,0 -.8,0Z';
  var BELT_D = 'M-5.6,-10.7L5.6,-10.7L5.5,-8.9L-5.5,-8.9Z';
  var ZIP_D = 'M-.38,-29.4L.38,-29.4L.38,5L-.38,5Z';
  var COLLAR_D = 'M-3.9,-31.2L3.9,-31.2L3.5,-28.8L-3.5,-28.8Z';
  var JHEM_D = 'M-7.9,3.4L7.9,3.4L7.9,5L-7.9,5Z';
  var SASH_D = 'M-9.4,-27.4L-7.2,-28.8L8.2,-13.6L6.6,-12.2Z';
  var JLOW_D = 'M-6.1,-6C-6.2,-4 -7.4,0 -7.9,5L7.9,5C7.4,0 6.2,-4 6.1,-6Z';
  var TLOW_D = 'M-6.5,-6C-6.6,-4 -6.9,-2 -6.9,0L-6.9,2.2L6.9,2.2L6.9,0C6.9,-2 6.6,-4 6.5,-6Z';
  var ZIPLOW_D = 'M-.38,-6.2L.38,-6.2L.38,5L-.38,5Z';
  var PELVIS_D = 'M-7.2,-3C-2.4,-3.6 2.4,-3.6 7.2,-3C7.9,0 7.8,2.6 6.8,4.6C3,6.6 -3,6.6 -6.8,4.6C-7.8,2.6 -7.9,0 -7.2,-3Z';
  var SKIRT_D = 'M-6.2,-4C-2,-4.4 2,-4.4 6.2,-4C8.5,1 10.5,6.5 11.2,10.6Q0,13.8 -11.2,10.6C-10.5,6.5 -8.5,1 -6.2,-4Z';
  var HEM_D = 'M-11.2,10.6Q0,13.8 11.2,10.6L10.9,9.1Q0,12.2 -10.9,9.1Z';
  var TAIL_D = 'M0,-1.9C2.5,-2.4 6,-2 9,-.6C10.6,.2 11.6,1.2 11.8,2C10,1.8 8,1.7 6,1.6C3.8,1.6 1.6,1.8 0,1.9Z';

  /* ------------------------------------------------------------------ 3D math */
  function ik2(A, T, l1, l2, pole, outJ, outE) {
    var dx = T[0] - A[0], dy = T[1] - A[1], dz = T[2] - A[2];
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) { dx = 0; dy = -1; dz = 0; d = 1e-6; }
    var nx = dx / d, ny = dy / d, nz = dz / d;
    var dc = clamp(d, Math.abs(l1 - l2) + 0.05, l1 + l2 - 0.02);
    var a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var px = pole[0], py = pole[1], pz = pole[2];
    var dot = px * nx + py * ny + pz * nz;
    px -= dot * nx; py -= dot * ny; pz -= dot * nz;
    var pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl < 1e-5) { px = -ny; py = nx; pz = 0; pl = Math.sqrt(px * px + py * py) || 1; }
    px /= pl; py /= pl; pz /= pl;
    outJ[0] = A[0] + nx * a + px * h; outJ[1] = A[1] + ny * a + py * h; outJ[2] = A[2] + nz * a + pz * h;
    outE[0] = A[0] + nx * dc; outE[1] = A[1] + ny * dc; outE[2] = A[2] + nz * dc;
  }
  function V() { return [0, 0, 0]; }
  // the lowest points of a boot and its blade (boot units: x towards the toe, y down from the ankle)
  var BOOT_LOW = [[-4.6, 8.75], [-2, 9.1], [2, 9.15], [6, 9.1], [8.7, 8.9], [10, 8.7], [-3.6, 6.1], [-3.3, -4.6], [2.5, -4.6]];
  // How far an ankle at (x, y, z) must rise so no part of the boot or blade dips below the ice, for a foot pitched
  // by lt (toe down) and turned by lo, in a body leaning by bp / roll, lifted by lift (0 on the ice).
  function bootSink(x, y, z, lt, lo, sb, cb, sr, cr, lift) {
    var cl = Math.cos(lt), sl = Math.sin(lt), co = Math.cos(lo), so = Math.sin(lo), low = 1e9;
    for (var i = 0; i < BOOT_LOW.length; i++) {
      var bx = BOOT_LOW[i][0], by = BOOT_LOW[i][1];
      var px = x + bx * cl * co - by * sl * co, py = y - bx * sl - by * cl, pz = z + bx * cl * so - by * sl * so;
      var h = -pz * sr + (-px * sb + py * cb) * cr + lift;
      if (h < low) low = h;
    }
    return low < -0.15 ? -low / Math.max(0.5, cb * cr) : 0;
  }

  /* ------------------------------------------------------------------ projection / ice */
  function makeProj(ice) {
    ice = ice || {};
    var poly = (ice.icePolygon && ice.icePolygon.length >= 3) ? ice.icePolygon : [[420, 560], [1180, 560], [1360, 960], [240, 960]];
    var hF = +ice.skaterHeightFar || 64, hN = +ice.skaterHeightNear || 200;
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, i;
    for (i = 0; i < poly.length; i++) {
      minx = Math.min(minx, poly[i][0]); maxx = Math.max(maxx, poly[i][0]);
      miny = Math.min(miny, poly[i][1]); maxy = Math.max(maxy, poly[i][1]);
    }
    var yN = ice.nearY != null ? +ice.nearY : maxy;
    var yF = ice.farY != null ? +ice.farY : (ice.horizonY != null ? +ice.horizonY : miny);
    var cx = (minx + maxx) / 2;
    var slope = (hN - hF) / Math.max(1, yN - yF);
    var P = { hN: hN, cx: cx, yN: yN, persp: false, yv: 0, H: 1, D: 1, _nx: 0, _nz: 0, _ei: 0 };
    if (slope > 0.02 && hF > 4) {
      P.persp = true; P.yv = yF - hF / slope; P.H = yN - P.yv; P.D = P.H / 0.36;
    }
    P.toW = function (x, y) {
      if (P.persp) { var p = Math.max(0.05, (y - P.yv) / P.H); return [(x - cx) / p, P.D / p]; }
      return [x - cx, (y - yN) / 0.36];
    };
    P.toS = function (wx, wz, out) {
      out = out || [0, 0, 0];
      if (P.persp) { var p = P.D / Math.max(P.D * 0.05, wz); out[0] = cx + wx * p; out[1] = P.yv + P.H * p; out[2] = p; }
      else { out[0] = cx + wx; out[1] = yN + wz * 0.36; out[2] = 1; }
      return out;
    };
    P.kD = function (p) { return P.persp ? (P.H / P.D) * p : 0.36; };
    var W = [];
    for (i = 0; i < poly.length; i++) W.push(P.toW(poly[i][0], poly[i][1]));
    var E = [];
    var bx0 = 1e18, bx1 = -1e18, bz0 = 1e18, bz1 = -1e18;
    for (i = 0; i < W.length; i++) {
      var a = W[i], b = W[(i + 1) % W.length];
      var dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9, l = Math.sqrt(l2);
      E.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], dx: dx, dz: dz, len2: l2, nx: -dz / l, nz: dx / l });
      bx0 = Math.min(bx0, a[0]); bx1 = Math.max(bx1, a[0]); bz0 = Math.min(bz0, a[1]); bz1 = Math.max(bz1, a[1]);
    }
    P.edges = E; P.W = W; P.bx0 = bx0; P.bx1 = bx1; P.bz0 = bz0; P.bz1 = bz1;
    var area = 0;
    for (i = 0; i < W.length; i++) { var w0 = W[i], w1 = W[(i + 1) % W.length]; area += w0[0] * w1[1] - w1[0] * w0[1]; }
    P.area = Math.abs(area) / 2 / (hN * hN);   // in skater-heights squared
    P.size = Math.sqrt((bx1 - bx0) * (bx1 - bx0) + (bz1 - bz0) * (bz1 - bz0)) || 1;
    // orient normals inward
    var e0 = E[0], mx = e0.ax + e0.dx * 0.5 + e0.nx * 1e-3 * P.size, mz = e0.az + e0.dz * 0.5 + e0.nz * 1e-3 * P.size;
    if (sdist(P, mx, mz) < 0) for (i = 0; i < E.length; i++) { E[i].nx = -E[i].nx; E[i].nz = -E[i].nz; }
    // preferred depth band, chosen in screen terms: the middle of the ice on screen,
    // where skaters are large enough to read but not cut off by the bottom edge
    var yTop = miny, yBot = Math.min(maxy, yN);
    P.zA = P.toW(cx, lerp(yTop, yBot, 0.82))[1];   // nearest preferred
    P.zB = P.toW(cx, lerp(yTop, yBot, 0.3))[1];    // farthest preferred
    P.zC = P.zB;
    // narrow (phone) ice: the far limit of a band that leans to the near half, where the figures read largest,
    // and the start of the far third (no more than two skaters should drift up there at once)
    P.zN = P.toW(cx, lerp(yTop, yBot, 0.36))[1];
    P.zF3 = P.toW(cx, lerp(yTop, yBot, 0.34))[1];
    var zMid = P.toW(cx, lerp(yTop, yBot, 0.58))[1];
    // width of the ice (in heights) across the middle of the band
    var wm = 0, xs;
    for (xs = 0; xs <= 40; xs++) { var xx = lerp(bx0, bx1, xs / 40); if (sdist(P, xx, zMid) > 0) wm += (bx1 - bx0) / 40; }
    P.midWidth = wm / hN;
    // open-space points
    var best = -1e18, bestH = -1e18, gx, gz, d, n = 24;
    P.pole = [(bx0 + bx1) / 2, (bz0 + bz1) / 2]; P.home = P.pole.slice();
    for (gx = 0; gx <= n; gx++) for (gz = 0; gz <= n; gz++) {
      var x = lerp(bx0, bx1, gx / n), z = lerp(bz0, bz1, gz / n);
      d = sdist(P, x, z);
      if (d > best) { best = d; P.pole = [x, z]; }
      var dh = Math.min(d, hN * 2.5) - Math.abs(z - zMid) * 0.6 - Math.abs(x) * 0.08;
      if (d > 0 && dh > bestH) { bestH = dh; P.home = [x, z]; }
    }
    return P;
  }
  function sdist(P, x, z) {
    var E = P.edges, best = 1e30, inside = false, bi = 0, i, e, t, px, pz, d;
    for (i = 0; i < E.length; i++) {
      e = E[i];
      if (((e.az > z) !== (e.bz > z)) && (x < (e.bx - e.ax) * (z - e.az) / (e.bz - e.az) + e.ax)) inside = !inside;
      t = ((x - e.ax) * e.dx + (z - e.az) * e.dz) / e.len2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      px = e.ax + e.dx * t - x; pz = e.az + e.dz * t - z;
      d = px * px + pz * pz;
      if (d < best) { best = d; bi = i; P._nx = px; P._nz = pz; }
    }
    P._ei = bi;
    return inside ? Math.sqrt(best) : -Math.sqrt(best);
  }
  function aniso(dx, dz) { return Math.sqrt(dx * dx + 0.2 * dz * dz); }

  /* ================================================================== the rink */
  function createSkaterRink(opts) {
    opts = opts || {};
    var layer = opts.layer, reflLayer = opts.reflLayer;
    var count = opts.count == null ? 4 : Math.max(0, Math.min(32, opts.count | 0));
    var seed = opts.seed == null ? 1 : (+opts.seed || 0);
    var reduce = !!opts.reduceMotion;
    var uid = 'skr' + (++RINK_ID) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    var rng = mulberry(Math.floor(seed * 9301) + 49297);
    var pj = null, sks = [], crowd = 1, kMax = 0.95, narrow = false;
    function useProj(P) {
      pj = P;
      var per = pj.area / Math.max(1, count);
      crowd = clamp(28 / Math.max(1, per), 1, 2.6);
      kMax = Math.min(1.5, 0.95 * Math.sqrt(crowd));
      narrow = pj.midWidth < 4.2;
      if (per < 18 || narrow) {   // little room: use all of the near ice, not only the middle band (on phones not the far shore either)
        pj.zA = pj.bz0; pj.zB = narrow ? Math.min(pj.bz1, pj.zN) : pj.bz1;
      }
    }
    useProj(makeProj(opts.ice));
    var simT = 0, lastNow = null, frameN = 0;
    // adaptive budget: if step() keeps costing more than ~3 ms (a slow phone), the faint reflection
    // refreshes at 10 Hz and steering re-plans every fourth frame until it is cheap again
    var cost = 0, lite = 0, liteLock = null;
    var clock = (root.performance && performance.now) ? function () { return performance.now(); } : function () { return Date.now(); };
    var tmpS = [0, 0, 0];

    initSvgDom(layer);
    var defs = el('defs', null, layer);
    var clip = el('clipPath', { id: uid + 'h' }, defs);
    el('ellipse', { rx: 5.2, ry: 5.95 }, clip);

    /* ---------------------------------------------------------------- DOM */
    function buildFig(look, parent, refl, i) {
      // all fields declared up front (same object shapes for every figure)
      var F = { root: null, shadow: null, hit: null, fig: null, legL: null, legR: null, armL: null, armR: null,
        body: null, hips: null, head: null, pony: null, parts: null, anim: null, frontS: null, rootS: null, cur: null };
      F.root = el('g', refl ? { 'class': 'skater-refl' } : { 'class': 'skater', 'data-skater': String(i) }, parent);
      if (!refl) {
        F.shadow = el('ellipse', { rx: 1, ry: 1, fill: '#150b35', opacity: 0.3 }, F.root);
        F.hit = el('rect', { x: -22, y: -106, width: 44, height: 110, fill: 'transparent' }, F.root);
      }
      F.fig = el('g', null, F.root);
      function leg() {
        var g = el('g', null, F.fig), o = { g: g, far: null, thigh: null, knee: null, shin: null, boot: null, bootB: null, blade: null };
        o.thigh = el('path', { d: THIGH_D }, g);
        if (!refl) o.knee = el('circle', { r: 2.3 }, g);   // joint discs are skipped in the faint reflection
        o.shin = el('path', { d: SHIN_D }, g);
        o.boot = el('g', null, g);
        o.bootB = el('path', { d: BOOT_D, fill: BOOT, stroke: BOOT_EDGE, 'stroke-width': 0.45, 'stroke-linejoin': 'round' }, o.boot);
        el('path', { d: SOLE_D, fill: SOLE }, o.boot);
        o.blade = el('path', { d: BLADE_D, fill: BLADE }, o.boot);
        return o;
      }
      function arm() {
        var g = el('g', null, F.fig), o = { g: g, far: null, sh: null, up: null, elb: null, fo: null, hand: null };
        if (!refl) o.sh = el('circle', { r: 2.0 }, g);
        o.up = el('path', { d: UARM_D }, g);
        if (!refl) o.elb = el('circle', { r: 1.42 }, g);
        o.fo = el('path', { d: FARM_D }, g);
        if (!refl) o.hand = el('path', { d: HAND_D }, g);
        return o;
      }
      F.legL = leg(); F.legR = leg(); F.armL = arm(); F.armR = arm();
      var b = { g: el('g', null, F.fig), pelvis: null, torso: null, front: null, neck: null };
      if (!refl) b.pelvis = el('path', { d: PELVIS_D, fill: look.brief }, b.g);   // hidden by the skirt / jacket in the faint reflection
      b.torso = el('g', null, b.g);
      el('path', { d: TORSO_D[look.cut], fill: look.top, stroke: shade(look.top, 0.25), 'stroke-width': 0.35 }, b.torso);
      if (look.cut === 'dress') el('path', { d: BELT_D, fill: look.acc }, b.torso);
      if (look.cut === 'jacket') { el('path', { d: JHEM_D, fill: shade(look.top, 0.18) }, b.torso); el('path', { d: COLLAR_D, fill: shade(look.top, 0.2) }, b.torso); }
      if (!refl) b.front = el('g', null, b.torso);
      if (refl) { /* the faint reflection skips chest details */ }
      else if (look.cut === 'dress') { el('path', { d: NECKLINE_D, fill: look.skin }, b.front); el('path', { d: SPARKLE_D, fill: look.acc }, b.front); }
      else if (look.cut === 'jacket') el('path', { d: ZIP_D, fill: look.trim }, b.front);
      else if (look.cut === 'top') { el('path', { d: SASH_D, fill: look.trim }, b.front); el('path', { d: NECKLINE_D, fill: look.skin, transform: 'translate(0,-.4) scale(.8,.55)' }, b.front); }
      b.neck = el('path', { d: NECK_D, fill: look.skin }, b.g);
      F.body = b;
      // hips: drawn above the legs so a thigh never covers the skirt / jacket hem
      var hp = { g: el('g', null, F.fig), skirt: null, band: null, zip: null };
      if (look.skirt) {
        hp.skirt = el('g', null, hp.g);
        el('path', { d: SKIRT_D, fill: look.skirt, stroke: shade(look.skirt, 0.25), 'stroke-width': 0.35 }, hp.skirt);
        el('path', { d: HEM_D, fill: look.hem }, hp.skirt);
      } else {
        hp.band = el('g', null, hp.g);
        el('path', { d: look.cut === 'jacket' ? JLOW_D : TLOW_D, fill: look.top }, hp.band);
        if (look.cut === 'jacket') { el('path', { d: JHEM_D, fill: shade(look.top, 0.18) }, hp.band); if (!refl) hp.zip = el('path', { d: ZIPLOW_D, fill: look.trim }, hp.band); }
      }
      F.hips = hp;
      var h = { g: el('g', null, F.fig), bunFront: false, bun: null, shape: null, fg: null, face: null };
      if (look.hair === 'bun' && !refl) {
        h.bun = el('g', null, h.g);
        el('circle', { r: 2.75, fill: look.hairC }, h.bun);
        el('ellipse', { cx: 0, cy: 2.0, rx: 2.1, ry: 0.85, fill: look.acc }, h.bun);
      }
      h.shape = el('ellipse', { rx: 5.2, ry: 5.95, fill: look.hairC }, h.g);
      h.fg = el('g', { 'clip-path': 'url(#' + uid + 'h)' }, h.g);
      h.face = el('ellipse', { rx: 4.5, ry: look.hair === 'short' ? 5.4 : 5.0, fill: look.skin }, h.fg);
      F.head = h;
      F.parts = [F.legL, F.legR, F.armL, F.armR, b, h, hp];
      if (look.hair === 'pony') {
        var p = { g: el('g', null, F.fig), t: null };
        p.t = el('g', null, p.g);
        el('path', { d: TAIL_D, fill: look.hairC }, p.t);
        el('circle', { r: 1.35, fill: look.acc }, p.t);
        F.pony = p; F.parts.push(p);
      }
      // animated elements, written each frame through slots (the reflection has fewer)
      var A = F.anim = [];
      function add(e, key, trOnly) { if (e) A.push(slot(e, TI[key], trOnly)); }
      add(F.legL.thigh, 'thighL'); add(F.legL.knee, 'kneeL', true); add(F.legL.shin, 'shinL'); add(F.legL.boot, 'bootL');
      add(F.legR.thigh, 'thighR'); add(F.legR.knee, 'kneeR', true); add(F.legR.shin, 'shinR'); add(F.legR.boot, 'bootR');
      add(F.armL.sh, 'shL', true); add(F.armL.up, 'upL'); add(F.armL.elb, 'elbL', true); add(F.armL.fo, 'foL'); add(F.armL.hand, 'handL');
      add(F.armR.sh, 'shR', true); add(F.armR.up, 'upR'); add(F.armR.elb, 'elbR', true); add(F.armR.fo, 'foR'); add(F.armR.hand, 'handR');
      add(b.pelvis, 'pelvis'); add(b.torso, 'torso'); add(b.neck, 'neck'); add(hp.skirt, 'skirt'); add(hp.band, 'torso');
      add(h.g, 'head'); add(h.face, 'face'); add(h.bun, 'bun', true); add(F.pony && F.pony.t, 'pony');
      add(F.shadow, 'shadow'); add(F.hit, 'hit', true);
      F.frontS = b.front ? slot(b.front, TI.front) : null;
      F.rootS = slot(F.root, -1);
      // current DOM order of F.parts inside F.fig (creation order: legs, arms, body, hips, head, pony)
      F.cur = F.pony ? [0, 1, 2, 3, 4, 6, 5, 7] : [0, 1, 2, 3, 4, 6, 5];
      return F;
    }
    function setLimbFill(F, look, which, far) {
      var o = F[which];
      if (o.far === far) return;
      o.far = far;
      if (which === 'legL' || which === 'legR') {
        var c = far ? shade(look.legs, 0.2) : look.legs;
        o.thigh.setAttribute('fill', c); if (o.knee) o.knee.setAttribute('fill', c); o.shin.setAttribute('fill', c);
        o.bootB.setAttribute('fill', far ? BOOT_FAR : BOOT); o.blade.setAttribute('fill', far ? BLADE_FAR : BLADE);
      } else {
        var s = far ? shade(look.sleeve, 0.2) : look.sleeve, k = far ? shade(look.skin, 0.18) : look.skin;
        if (o.sh) { o.sh.setAttribute('fill', s); o.elb.setAttribute('fill', s); }
        o.up.setAttribute('fill', s); o.fo.setAttribute('fill', s);
        if (o.hand) o.hand.setAttribute('fill', k);
      }
    }

    /* ---------------------------------------------------------------- skater objects */
    function makeSkater(i) {
      var r = mulberry(Math.floor(seed * 7919) + i * 104729 + 13);
      var look = LOOKS[i % LOOKS.length];
      var sk = { i: i, r: r, look: look };
      sk.skill = 0.25 + 0.55 * r(); sk.nerves = r(); sk.vC0 = 0.74 + 0.18 * r(); sk.wob = 0.6 + 0.6 * (1 - sk.skill);
      sk.vC = sk.vC0 / Math.sqrt(crowd);
      sk.ph = []; for (var k = 0; k < 12; k++) sk.ph.push(r() * TAU);
      sk.wf = [0.04 + 0.05 * r(), 0.09 + 0.08 * r(), r() * TAU, r() * TAU];
      sk.P = copyP(new Array(NK), P_STAND); sk.from = copyP(new Array(NK), P_STAND); sk.tgt = new Array(NK);
      sk.cr = { ph: r(), wL: 0, wR: 0, wG: 0, glide: 0, glideReq: 0, strokes: 3 + Math.floor(r() * 4), lastHalf: 0, gSide: 0 };
      sk.wx = 0; sk.wz = 0; sk.th = 0; sk.v = 0; sk.kH = 0; sk.kT = 0; sk.vx = 0; sk.vz = 0; sk.vTarget = 0; sk.vScale = 1;
      sk.yawOff = 0; sk.yaw0 = 0; sk.yawT = NaN; sk.lift = 0; sk.prevPhi = NaN; sk.yawRate = 0; sk.tailA = PI / 2;
      sk.queue = []; sk.seg = null; sk.segT = 0; sk.cool = 6; sk.hist = []; sk.attempts = 0; sk.chk = 0;
      sk.kE = 0.25; sk.kL = 0.2; sk.under = 0; sk.busy = false; sk.longHold = false; sk.trig = false; sk.forced = null;
      sk.onIce = true; sk.scrape = false; sk.frozen = null;
      sk.J = {}; sk.bbox = [0, 0, 0, 0]; sk.blade = { x: 0, y: 0, onIce: true, scrape: false, color: look.glow, al: NaN, lt: 0 };
      // every field the simulation touches later, declared up front (stable object shape = fast, no deopts)
      sk.T = makeT(); sk._keys = [0, 0, 0, 0, 0, 0, 0, 0]; sk.lbox = [0, 0, 0, 0]; sk.pred = [];
      sk._bladeB = [0, 0]; sk._bsL = 1; sk._bsR = 1; sk._supR = false; sk._dt = 0.016;
      sk.aborts = 0; sk.goal = null; sk.goalT = 0; sk.inAttempt = false; sk.outcome = ''; sk.pendingForce = null; sk.pinT = 0; sk.storyPick = ''; sk.setT = 0;
      sk.ready = false; sk.sx = 0; sk.sy = 0; sk.sc = 1; sk.steerDt = 0; sk.steerSeg = null; sk.tapAt = 99; sk.vCommit = 0;
      sk._lean = 0;   // curve lean currently added on top of the blended pose (kept out of the blend snapshot)
      sk.m = buildFig(look, layer, false, i);
      sk.rf = buildFig(look, reflLayer, true, i);
      return sk;
    }

    /* ---------------------------------------------------------------- segments */
    // every segment has the same fields in the same order, so the per-frame code stays monomorphic
    function Seg(name, dur) {
      this.name = name; this.dur = dur; this.blend = 0.25; this.kap = 'steer'; this.onIce = true; this.acc = 0.5;
      this.pose = null; this.vT = null; this.tick = null; this.start = null; this.end = null;
      this.yawTo = null; this.yawA = 0; this.yawB = 1; this.yawE = ''; this.lift = null;
      this.kk = ''; this.pv = 1; this.plan = false; this.goal = false; this.back = false; this.bias = 0; this.scrape = false;
    }
    function seg(name, dur, o) {
      var g = new Seg(name, dur);
      if (o) for (var k in o) if (o.hasOwnProperty(k) && o[k] != null) g[k] = o[k];
      return g;
    }
    function staticPose(P) { return function (sk, u, t, dt, out) { copyP(out, P); }; }
    function turnBy(delta) { return function (sk) { return sk.yawOff + delta; }; }
    function facingFwd(sk) { return Math.cos(sk.yawOff) > 0; }

    function cruiseGen(sk, dt, out, back) {
      var c = sk.cr, kH = sk.kH, a = Math.min(1, dt * 2.2);
      var tL = clamp((kH - 0.3) / 0.22, 0, 1), tR = clamp((-kH - 0.3) / 0.22, 0, 1);
      c.wL += (tL - c.wL) * a; c.wR += (tR - c.wR) * a;
      var rate = 0.5 + 0.28 * clamp(sk.v / sk.vC, 0, 1.4);
      var u = (c.ph * 2) % 1, half = c.ph < 0.5 ? 0 : 1;
      if (half !== c.lastHalf) {
        c.lastHalf = half; c.strokes--;
        if (c.strokes <= 0 && !back && c.wL + c.wR < 0.2) { c.glideReq = 0.9 + sk.r() * 1.3; c.strokes = 3 + Math.floor(sk.r() * 5); }
      }
      if (c.glideReq > 0 && u >= 0.44 && u < 0.52) { c.glide = c.glideReq; c.glideReq = 0; c.gSide = half; }
      if (c.glide > 0) { c.glide -= dt; if (c.wL + c.wR > 0.3) c.glide = 0; }
      c.wG += ((c.glide > 0 ? 1 : 0) - c.wG) * Math.min(1, dt * 3);
      if (!(c.glide > 0)) c.ph = (c.ph + rate * dt) % 1;
      if (back) {
        swizzleGen(c.ph, out);
        if (c.wL > 0.01) { backCrossGen(c.ph, 1, TMP_B); mixP(out, out, TMP_B, c.wL); }
        if (c.wR > 0.01) { backCrossGen(c.ph, -1, TMP_B); mixP(out, out, TMP_B, c.wR); }
      } else {
        strokeGen(c.ph, out);
        if (c.wL > 0.01) { crossGen(c.ph, 1, TMP_B); mixP(out, out, TMP_B, c.wL); }
        if (c.wR > 0.01) { crossGen(c.ph, -1, TMP_B); mixP(out, out, TMP_B, c.wR); }
        // the glide keeps the side it started on while it fades out, even after the stroke has switched feet
        if (c.wG > 0.01) { mixP(out, out, c.gSide === 0 ? P_GLIDE_R : P_GLIDE_L, c.wG * 0.85); }
      }
      return out;
    }
    function segCruise(dur, back) {
      return seg(back ? 'cruiseBack' : 'cruise', dur, {
        blend: 0.45, acc: 0.35, back: !!back,
        vT: function (s) { return back ? s.vC * 0.85 : s.vC; },
        pose: function (s, u, t, dt, out) { cruiseGen(s, dt, out, back); },
        tick: function (s, dt) { s.cool -= dt; if (s.trig || s.forced) s.segT = s.seg.dur; }
      });
    }
    function segTurnFB() {
      return seg('turnFB', 0.62, { blend: 0.22, yawTo: turnBy(PI), yawA: 0.12, yawB: 0.55, pose: staticPose(P_THREE) });
    }
    function segTurnBF() {
      return seg('turnBF', 0.6, { blend: 0.25, yawTo: function (s) { var d = wrap(0 - s.yawOff); if (Math.abs(d) < 0.05) d = 0; return s.yawOff + d; },
        yawA: 0.1, yawB: 0.5, pose: staticPose(P_MOHAWK), acc: 0.3 });
    }
    function segBackX(minT, maxT, trig) {
      return seg('backX', maxT, {
        blend: 0.4, acc: 0.45, bias: 0.34, goal: true, back: true, asked: !!trig,
        vT: function (s) { return s.vC * 1.12; },
        pose: function (s, u, t, dt, out) { cruiseGen(s, dt, out, true); },
        tick: function (s, dt) {
          if (s.segT < minT) return;
          s.chk -= dt;
          if (s.chk > 0) return;
          s.chk = 0.18;
          // on narrow ice (phones), after a couple of seconds also accept a path that runs closer to the edge; a jump a
          // visitor asked for takes that sooner, and in the end any path that stays on the ice (so it comes quickly)
          // the visit's very first try (desktop) also takes, almost at once, any path that keeps off the boards and clear of
          // the others even if it is not side-on or has a skater near it on screen (the others make room once it commits)
          var asked = trig || s.trig, first = story.n === 0 && !narrow;
          if (planOK(s) || ((narrow || asked) && s.segT > minT + (asked ? 0.8 : 2) && planOK(s, false, true)) ||
              (first && s.segT > minT + 0.3 && planOK(s, false, true, true)) ||
              (asked && s.segT > minT + 1.8 && planOK(s, true))) { s.ready = true; s.segT = s.seg.dur; }
        },
        end: function (s) {
          // asked = this set-up was built for a visitor's click, or someone clicked the skater during it
          var asked = trig || s.trig;
          if (s.ready || (asked && planOK(s, true))) { s.trig = false; return; }
          // the visit's very first try: keep circling backwards a while longer rather than give up (people are waiting)
          if (story.n === 0 && !asked && (s.setT += s.segT) < 10) { s.queue.unshift(segBackX(0, 1.5, false)); return; }
          s.setT = 0;
          storyReturn(s);   // called off: the next skater to set off gets this part of the story instead
          if (asked) { s.queue = []; s.trig = true; s.cool = 0; return; }   // no room yet: set up again straight away
          s.aborts++;
          s.queue = [segTurnBF()]; s.cool = 1.5 + 2 * s.r(); s.inAttempt = false;
          if (s.pendingForce) { s.forced = s.pendingForce; s.pendingForce = null; s.hist.pop(); }
        },
        start: function (s) { s.ready = false; s.chk = 0; }
      });
    }
    function segStep() {
      return seg('step', 0.45, { blend: 0.38, kap: 'plan', kk: 'kE', pv: 1, plan: true,
        yawTo: turnBy(-PI), yawA: 0.05, yawB: 0.85, pose: staticPose(P_LFO), acc: 0.2,
        start: function (s) {
          s.busy = true; s.pendingForce = null; s.vCommit = Math.max(0.7, s.v); s.vTarget = s.vCommit * 0.97;
          // committed to the jump (set-ups can still be abandoned before this): count it for the rink
          story.n++;
          story[s.outcome] = true;   // which kinds of try the rink has shown so far
          story.last2 = story.lastO; story.lastO = s.outcome;
          s.storyPick = '';
          story.miss = (s.outcome === 'clean' || s.outcome === 'waltz') ? 0 : story.miss + 1;
        } });
    }
    function segEdge(hold) {
      return seg('edge', hold, { blend: 0.22, kap: 'plan', kk: 'kE', pv: hold > 1.5 ? 0.78 : 0.93, plan: true, acc: hold > 1.5 ? 0.14 : 0.08,
        vT: function (s) { return s.vCommit * (s.longHold ? 0.68 : 0.88); },
        start: function (s) { s.tapAt = s.longHold ? 0.6 + s.r() * Math.max(0.2, s.seg.dur - 1.4) : 99; },
        pose: function (s, u, t, dt, out) {
          copyP(out, P_LFO);
          var amp = s.wob * (s.longHold ? (0.35 + 0.75 * Math.min(1, t / 1.5)) : 0.2);
          wobble(out, simT, amp, s.ph);
          freeFootWobble(out, simT, amp, s.ph, 'r');
          out[K.ry] = Math.max(out[K.ry], 16);   // however wobbly, the free boot stays well off the ice
          if (s.longHold) {
            // a nervous moment: the free toe dabs the ice for a split second and the arms flap
            var tap = Math.min(1, 1.6 * Math.sin(clamp((t - s.tapAt) / 0.45, 0, 1) * PI));
            out[K.ry] = lerp(out[K.ry], 3.5, tap); out[K.rx] = lerp(out[K.rx], -10, tap); out[K.rt] = lerp(out[K.rt], 0.55, tap);
            out[K.ay] += 9 * tap * Math.sin(simT * 15); out[K.by] -= 9 * tap * Math.sin(simT * 15 + 0.7);
            out[K.py] -= 2 * tap;
          }
        } });
    }
    function segLoad() {
      return seg('load', 0.3, { blend: 0.28, kap: 'plan', kk: 'kE', pv: 0.88, plan: true, pose: staticPose(P_LOAD) });
    }
    function segTakeoff() {
      return seg('takeoff', 0.16, { blend: 0.15, kap: 'plan', kk: 'kE', pv: 0.88, plan: true,
        yawTo: turnBy(0.35), yawA: 0.3, yawB: 1, yawE: 'in', pose: staticPose(P_TAKEOFF) });
    }
    function segAir(kind, T, H) {
      var rot = kind === 'waltz' ? PI : 3 * PI;
      return seg('air', T, { blend: 0.1, kap: 'hold', pv: 0.88, plan: true, onIce: false, acc: 0,
        yawTo: function (s) { return rot - s.under; }, yawE: 'rot',
        lift: function (u) { return H * 4 * u * (1 - u); },
        pose: function (s, u, t, dt, out) {
          if (kind === 'waltz') { mixP(out, P_WALTZ_AIR, P_AIR_OPEN, sstep((u - 0.55) / 0.45)); return; }
          if (u < 0.7) copyP(out, P_AIR);
          else mixP(out, P_AIR, P_AIR_OPEN, sstep((u - 0.7) / 0.3));
        },
        end: function (s) { s.attempts++; } });
    }
    function segLand() {
      return seg('land', 0.32, { blend: 0.07, kap: 'plan', kk: 'kL', pv: 0.8, plan: true, acc: 0.6,
        yawTo: function (s) { return s.yawOff + s.under; }, yawA: 0, yawB: 0.6,
        vT: function (s) { return s.v * 0.85; }, pose: staticPose(P_LAND) });
    }
    function segHold(d) {
      return seg('hold', d, { blend: 0.55, kap: 'plan', kk: 'kL', pv: 0.7, plan: true, acc: 0.15,
        vT: function (s) { return s.v * 0.8; },
        pose: function (s, u, t, dt, out) {
          copyP(out, P_HOLD);
          wobble(out, simT, s.wob * 0.12 * (1 - u), s.ph);
        },
        end: function (s) { s.busy = false; } });
    }
    function segProud() {
      return seg('proud', 1.1, { blend: 0.32, acc: 0.25, vT: function (s) { return s.v * 0.8; },
        pose: function (s, u, t, dt, out) {
          copyP(out, P_PROUD);
          var down = sstep((u - 0.62) / 0.38);
          out[K.py] += 1.2 * Math.sin(u * PI * 3) * (1 - down);
          mixP(out, out, P_TWO, down * 0.8);
        } });
    }
    function segShrug(d) {
      return seg('shrug', d || 1.0, { blend: 0.35, acc: 0.25, vT: function (s) { return s.v * 0.8; },
        pose: function (s, u, t, dt, out) {
          copyP(out, P_SHRUG);
          out[K.hy] += 0.32 * Math.sin(t * 13) * (1 - sstep((u - 0.5) / 0.5));
        },
        end: function (s) { s.busy = false; } });
    }
    function segBail1() {
      return seg('bail', 0.45, { blend: 0.35, kap: 'plan', kk: 'kE', pv: 0.8, plan: true, acc: 0.4,
        vT: function (s) { return s.v * 0.8; }, pose: staticPose(P_BAIL) });
    }
    function segLand2() {
      return seg('land2', 0.45, { blend: 0.06, kap: 'plan', kk: 'kL', pv: 0.55, plan: true, acc: 1.2,
        yawTo: function (s) { return s.yawOff + s.under; }, yawA: 0, yawB: 0.95, yawE: 'out',
        vT: function (s) { return s.v * 0.55; },
        pose: function (s, u, t, dt, out) {
          copyP(out, P_TWO_LAND);
          windmill(out, simT, sstep(u / 0.3));
          out[K.sr] += 0.1 * Math.sin(simT * 7); out[K.roll] += 0.05 * Math.sin(simT * 5.3);
        } });
    }
    function segSteady() {
      return seg('steady', 1.0, { blend: 0.3, kap: 'steer', acc: 0.4, vT: function (s) { return s.v * 0.8; },
        pose: function (s, u, t, dt, out) {
          copyP(out, P_STEADY);
          windmill(out, simT, 0.7 * (1 - sstep(u / 0.6)));
          wobble(out, simT, 1.1 * (1 - u), s.ph);
        },
        end: function (s) { s.busy = false; } });
    }
    function segExhale() {
      return seg('exhale', 0.7, { blend: 0.4, acc: 0.3, vT: function (s) { return s.v * 0.85; }, pose: staticPose(P_EXHALE) });
    }
    function segSlip() {
      return seg('slip', 0.32, { blend: 0.09, kap: 'hold', acc: 0.4, plan: true, pv: 0.7,
        yawTo: turnBy(0.35), yawA: 0, yawB: 1,
        vT: function (s) { return s.v * 0.85; },
        pose: function (s, u, t, dt, out) { copyP(out, P_SLIP); windmill(out, simT, 0.5); } });
    }
    function segSlide() {
      return seg('slide', 0.8, { blend: 0.2, kap: 'hold', onIce: false, scrape: true, plan: true, pv: 0.35,
        yawTo: turnBy(0.6), yawA: 0, yawB: 1, yawE: 'out',
        vT: 0, start: function (s) { s.seg.acc = Math.max(0.3, s.v / 0.7); },
        pose: function (s, u, t, dt, out) {
          copyP(out, P_SLIDE);
          out[K.bx] += 6 * Math.sin(simT * 9) * (1 - u); out[K.by] += 5 * Math.sin(simT * 11) * (1 - u);
        } });
    }
    function segSit(d) {
      return seg('sit', d, { blend: 0.4, kap: 'none', onIce: false, vT: 0, acc: 2,
        pose: function (s, u, t, dt, out) {
          copyP(out, P_SIT);
          out[K.hp] += 0.07 * Math.sin(t * 8) * (1 - u); out[K.hy] += 0.25 * Math.sin(t * 3.1) * u;
          out[K.sr] += 0.05 * Math.sin(t * 6);
        } });
    }
    // roll over onto hands and knees: the turn happens early and low (hips near the ice), so the
    // figure never pops up tall mid-turn; turn the way that ends closest to a side view, which reads best.
    // The turn eases in from rest (a seated skater never whips round at full speed in one frame).
    function segKneel() {
      return seg('kneel', 0.95, { blend: 0.75, kap: 'none', onIce: false, vT: 0, yawA: 0, yawB: 0.5, yawE: '',
        yawTo: function (s) {
          var ph = s.th + s.yawOff, a = 2.5;
          return s.yawOff + (Math.abs(Math.cos(ph + a)) >= Math.abs(Math.cos(ph - a)) ? a : -a);
        },
        pose: function (s, u, t, dt, out) {
          copyP(out, P_KNEEL);
          var up = sstep((u - 0.3) / 0.5);
          out[K.py] = lerp(9, P_KNEEL[K.py], up);
          out[K.sp] = lerp(0.6, P_KNEEL[K.sp], up);
          // the boots stay nearly flat while the hips are low, and only point their toe picks into the ice as the
          // skater comes up onto the knees (toe-down boots under low hips would have to dig into the ice)
          out[K.lt] = lerp(0.15, P_KNEEL[K.lt], up); out[K.rt] = lerp(0.15, P_KNEEL[K.rt], up);
        } });
    }
    function segLunge() {
      return seg('lunge', 0.6, { blend: 0.5, kap: 'none', onIce: false, vT: 0, pose: staticPose(P_LUNGE) });
    }
    function segRise() {
      return seg('rise', 0.65, { blend: 0.6, kap: 'none', onIce: true, vT: 0, pose: staticPose(P_RISE),
        end: function (s) { s.th = s.th + s.yawOff; s.yawOff = 0; s.yaw0 = 0; s.kH = 0; s.kT = 0; } });
    }
    function segBrush() {
      return seg('brush', 1.1, { blend: 0.35, kap: 'none', vT: 0,
        pose: function (s, u, t, dt, out) {
          copyP(out, P_BRUSH);
          var w = t * 15;
          out[K.ax] += 4 * Math.sin(w); out[K.ay] += 5 * Math.sin(w + 1);
          out[K.bx] += 4 * Math.sin(w + PI); out[K.by] += 5 * Math.sin(w + PI + 1);
          if (u > 0.75) mixP(out, out, P_STAND, sstep((u - 0.75) / 0.25) * 0.6);
        },
        end: function (s) { s.busy = false; } });
    }

    // across the whole rink: how many committed attempts so far, whether one of them was a clean axel yet, and
    // how many in a row ended without a landing (so visitors see a success early on, and now and then after);
    // also which other kinds of try have shown yet, so a pop, a fall and a bail all turn up in about the first minute
    var story = { n: 0, miss: 0, clean: false, twoFoot: false, waltz: false, fall: false, bail: false, k: 0, back: [], lastO: '', last2: '' };
    // the first minute's story, once the first clean axel is in: a fall, a clean landing, a pop (a single turn),
    // a bail, then another clean landing (kinds the rink has already shown are skipped). Each one is handed out when
    // a skater sets off to try it, so two skaters setting up at once never both get the same miss, and handed back
    // if that set-up is called off. After that the tries are left to chance (pickOutcome).
    var STORY = ['fall', 'clean', 'waltz', 'bail', 'clean'];
    function storyPick(sk, trig) {
      if (!story.clean) return '';
      while (!story.back.length && story.k < STORY.length && STORY[story.k] !== 'clean' && story[STORY[story.k]]) story.k++;
      var o = story.back.length ? story.back[story.back.length - 1] : (story.k < STORY.length ? STORY[story.k] : '');
      if (!o || (trig && o === 'bail')) return '';   // a visitor asked for a jump: never a bail
      if (story.back.length) story.back.pop(); else story.k++;
      sk.storyPick = o;
      return o;
    }
    function storyReturn(sk) {
      if (sk.storyPick) { story.back.push(sk.storyPick); sk.storyPick = ''; }
    }
    function pickOutcome(sk, trig) {
      var s = sk.skill;
      var w = { clean: 0.14 + 0.36 * s, twoFoot: 0.2, fall: 0.24 - 0.1 * s, waltz: 0.16, bail: 0.15 };
      if (trig) w.clean += 0.4;
      if (narrow) w.bail *= 0.7;            // one jumper at a time on a phone: keep the slot mostly for real jumps
      if (story.miss >= 3) w.clean *= 2;    // after three misses in a row, a landing gets more likely
      var last = sk.hist[sk.hist.length - 1], prev = sk.hist[sk.hist.length - 2];
      if (last) w[last] *= 0.4;
      if (last && last === prev) w[last] = 0;
      // and across the rink: a miss the last jumper just had is less likely (never three of the same in a row), and one
      // that a skater setting up right now is about to try is out, so the misses stay varied whoever takes the next turn
      if (story.lastO && story.lastO !== 'clean') w[story.lastO] *= story.lastO === story.last2 ? 0 : 0.35;
      for (var oi = 0; oi < sks.length; oi++) { var ot = sks[oi]; if (ot !== sk && ot.inAttempt && !ot.busy && ot.outcome !== 'clean' && w[ot.outcome]) w[ot.outcome] = 0; }
      if (sk.attempts === 0) w.bail = 0.02;
      // a visitor asked for a jump: always leave the ice (bails still happen in the skaters' own practice)
      if (trig) w.bail = 0;
      var tot = 0, k;
      for (k in w) tot += w[k];
      var x = sk.r() * tot;
      for (k in w) { x -= w[k]; if (x <= 0) return k; }
      return 'clean';
    }
    // everything after the set-up: the step forward, the long edge, then the jump (or the bail) and what follows it.
    // pre(): called between choosing the jump's shape and building its segments (the set-up draws its own length
    // there, so each skater's random numbers come in the same order as before the set-up was split off)
    function attemptTail(sk, outcome, longHold, pre) {
      var r = sk.r, q = [];
      sk.kE = 1 / (3.3 + 1.5 * r());
      sk.kL = 1 / (3.8 + 2.2 * r());
      sk.under = outcome === 'clean' ? 0.05 + 0.1 * r() : (outcome === 'twoFoot' ? 0.9 + 0.45 * r() :
        (outcome === 'fall' ? 0.75 + 0.5 * r() : 0.08 * r()));
      sk.longHold = !!longHold;
      sk.outcome = outcome;
      var hold = longHold ? 1.8 + 1.6 * r() : 0.5 + 0.35 * r();
      var airT = outcome === 'waltz' ? 0.44 + 0.06 * r() : 0.6 + 0.08 * r();
      var airH = outcome === 'waltz' ? 26 + 6 * r() : 41 + 8 * r();
      if (pre) pre(q);
      q.push(segStep());
      q.push(segEdge(hold));
      if (outcome === 'bail') {
        q.push(segBail1(), segShrug(1.2));
      } else {
        q.push(segLoad(), segTakeoff(), segAir(outcome, airT, airH));
        if (outcome === 'clean') q.push(segLand(), segHold(1.3 + 0.5 * r()), segProud(), segTurnBF());
        else if (outcome === 'waltz') q.push(segLand(), segHold(0.8), segShrug(1.0), segTurnBF());
        else if (outcome === 'twoFoot') q.push(segLand2(), segSteady(), segExhale(), segTurnBF());
        else q.push(segSlip(), segSlide(), segSit(0.8 + 0.6 * r()), segKneel(), segLunge(), segRise(), segBrush());
      }
      return q;
    }
    function buildAttempt(sk, outcome, longHold, trig) {
      var r = sk.r;
      var q = attemptTail(sk, outcome, longHold, function (q) {
        if (facingFwd(sk)) q.push(segTurnFB());
        // (the visit's first try on desktop starts looking for its moment straight away: the opening seconds are crowded)
        var minT = 1.2 + 1.2 * r();
        q.push(segBackX(trig ? 0.5 : (story.n === 0 && !narrow ? 0.6 : minT), trig ? 3.5 : 5.5, trig));
      });
      sk.hist.push(outcome); if (sk.hist.length > 4) sk.hist.shift();
      sk.inAttempt = true;
      var cd = { clean: 7, waltz: 3, bail: 3, twoFoot: 5, fall: 5 };
      sk.cool = cd[outcome] + 4 * r();
      return q;
    }
    function decideNext(sk) {
      var r = sk.r;
      if (sk.forced) {
        var f = sk.forced; sk.forced = null;
        sk.queue = buildAttempt(sk, f.outcome, f.longHold, false);
        sk.pendingForce = f;
        return;
      }
      var busyN = 0;
      for (var bi = 0; bi < sks.length; bi++) if (sks[bi] !== sk && sks[bi].inAttempt) busyN++;
      var maxAtt = (narrow || pj.area / Math.max(1, count) < 18) ? 1 : 2;
      if (sk.trig || (sk.cool <= 0 && busyN < maxAtt)) {
        var trig = sk.trig; sk.trig = false;
        // the second jump on the rink is a confident, clean axel unless the first one already was (and the next ones
        // until one is, if that try was called off), so a visitor sees a landing early on before the wobbles and falls
        var early = story.n >= 1 && !story.clean;
        var o = early ? 'clean' : (storyPick(sk, trig) || pickOutcome(sk, trig));
        var lh = !trig && !early && r() < (o === 'bail' ? 0.55 : 0.18 + 0.32 * sk.nerves);
        // the very first try of the visit always has the long, wobbly one-foot hold before it (the skater gathering
        // courage), so the learning shows from the first seconds on
        if (story.n === 0 && busyN === 0 && !trig) lh = true;
        sk.queue = buildAttempt(sk, o, lh, trig);
        return;
      }
      sk.inAttempt = false;
      var q = [], justTurned = sk.seg && sk.seg.name === 'turnBF';
      if (!facingFwd(sk)) q.push(segTurnBF());
      else if (!justTurned && r() < 0.16) { q.push(segTurnFB(), segCruise(2.5 + 2 * r(), true), segTurnBF()); }
      q.push(segCruise(sk.cool <= 0 ? 1 + r() : 2.5 + 3 * r(), false));
      sk.queue = q;
    }

    /* ---------------------------------------------------------------- planning & steering */
    var RADII = [[3.3, 4.0], [4.6, 5.2], [6.5, 7], [2.7, 3.4]];
    var PF = { wall: 0, head: 0, other: 0, ok: 0 };
    // lenient: only the boards count; soft: the boards may come closer; loose: other skaters count only if the jumper
    // would run into them (not for standing in front of the jump on screen), and the take-off need not be side-on
    function planOK(sk, lenient, soft, loose) {
      var k0 = sk.kE, l0 = sk.kL, off = Math.floor(sk.r() * RADII.length);
      for (var ri = 0; ri < RADII.length; ri++) {
        var rr = RADII[(ri + off) % RADII.length];
        sk.kE = 1 / rr[0]; sk.kL = 1 / rr[1];
        if (planTry(sk, lenient, soft, loose)) { PF.ok++; return true; }
      }
      sk.kE = k0; sk.kL = l0;
      return false;
    }
    function planTry(sk, lenient, soft, loose) {
      var x = sk.wx, z = sk.wz, th = sk.th, t = 0, hN = pj.hN, v0 = Math.max(0.7, sk.v);
      var marg = (lenient || soft ? 0.15 : 0.3) * hN, lastK = sk.kH, i, q, seg_, dd, tt, kk, vv;
      var showT = 0;   // time at which the load / take-off starts (the part people should see clearly)
      for (i = 0; i < sk.queue.length; i++) { if (sk.queue[i].name === 'load' || sk.queue[i].name === 'bail') break; showT += sk.queue[i].dur; }
      for (i = 0; i < sk.queue.length; i++) {
        q = sk.queue[i];
        if (!q.plan) break;
        // in the air the jumper rises up to about half a height: a skater just behind must clear the lifted figure too
        var air = q.name === 'air';
        // take off travelling across the view, so the jump reads in profile
        if (q.name === 'takeoff' && !lenient && !loose && !narrow && Math.abs(Math.cos(th)) < 0.45) { PF.head++; return false; }
        kk = q.kap === 'plan' ? sk[q.kk] : (q.kap === 'hold' ? lastK : 0);
        lastK = kk; vv = v0 * (q.pv || 1);
        var qd = q.name === 'hold' ? Math.min(q.dur, 0.6) : q.dur;
        for (tt = 0; tt < qd; tt += 0.15) {
          dd = Math.min(0.15, qd - tt);
          th += kk * vv * dd;
          x += Math.cos(th) * vv * hN * dd; z += Math.sin(th) * vv * hN * dd; t += dd;
          if (sdist(pj, x, z) < marg) { PF.wall++; return false; }
          if (lenient) continue;
          var up = air ? 2 * (tt + dd / 2) / qd * (1 - (tt + dd / 2) / qd) + 0.05 : 0;   // 0.05 .. 0.55 heights
          for (var oi = 0; oi < sks.length; oi++) {
            var o = sks[oi];
            if (o === sk) continue;
            var tp = Math.min(t, 1.5);
            var ox2 = o.wx + o.vx * tp, oz2 = o.wz + o.vz * tp;
            if (aniso(x - ox2, z - oz2) < 0.8 * hN) { PF.other++; return false; }
            if (!loose && t >= showT - 0.3 && t <= showT + 1.6 && visD(x - ox2, z - oz2, (z + oz2) / 2, up) < 0.85) { PF.other++; return false; }
          }
        }
      }
      return true;
    }
    // on-screen overlap measure in skater sizes: < 1 means the two figures overlap on screen. up: how far the first
    // figure is raised off the ice (in heights; a jumper), which moves it up the screen like a step away from us
    function visD(dx, dz, wzAvg, up) {
      var hN = pj.hN, k = pj.kD(pj.persp ? pj.D / Math.max(pj.D * 0.3, wzAvg) : 1);
      var a = dx / (0.62 * hN), b = k * dz / (1.05 * hN) + (up || 0) / 1.05;
      return Math.sqrt(a * a + b * b);
    }
    // roomiest point of the preferred band, away from other skaters (goal for the axel set-up; on narrow ice
    // anywhere, since a jump needs the room and the band there leans to the cramped near end)
    function openSpot(sk) {
      var hN = pj.hN, best = -1e18, g = null, n = 9, ix, iz;
      var z0 = narrow ? pj.bz0 : Math.max(pj.bz0, pj.zA), z1 = narrow ? pj.bz1 : Math.min(pj.bz1, pj.zB);
      for (ix = 0; ix <= n; ix++) for (iz = 0; iz <= n; iz++) {
        var x = lerp(pj.bx0, pj.bx1, ix / n), z = lerp(z0, z1, iz / n);
        var e = sdist(pj, x, z) / hN;
        if (e < 1.0) continue;
        var md = 3;
        for (var oi = 0; oi < sks.length; oi++) {
          var o = sks[oi];
          if (o === sk) continue;
          md = Math.min(md, aniso(x - (o.wx + o.vx), z - (o.wz + o.vz)) / hN);
        }
        var sc = md + Math.min(e, 2.5) * 0.6 - aniso(x - sk.wx, z - sk.wz) / hN * 0.15;
        if (sc > best) { best = sc; g = [x, z]; }
      }
      return g || pj.home;
    }
    // where each skater will be at the steering sample times, following its current arc
    var PRED_N = 7;
    function predictAll() {
      var T = narrow ? 2.2 : 2.8;
      for (var i = 0; i < sks.length; i++) {
        var o = sks[i], pr = o.pred || (o.pred = []);
        var vW = o.v * pj.hN, kw = o.kH / pj.hN;
        if (o.seg && (o.seg.kap === 'none' || o.seg.name === 'slide')) kw = 0;
        for (var j = 0; j <= PRED_N; j++) {
          var t = Math.min(T * j / PRED_N, 1.8), sd = vW * t, x, z;
          if (Math.abs(kw) < 1e-9) { x = o.wx + Math.cos(o.th) * sd; z = o.wz + Math.sin(o.th) * sd; }
          else { x = o.wx + (Math.sin(o.th + kw * sd) - Math.sin(o.th)) / kw; z = o.wz - (Math.cos(o.th + kw * sd) - Math.cos(o.th)) / kw; }
          pr[j] = pr[j] || [0, 0]; pr[j][0] = x; pr[j][1] = z;
        }
      }
    }
    function steer(sk, dt) {
      var sg = sk.seg, mode = sg.kap;
      if (sg.goal) { sk.goalT -= dt; if (sk.goalT <= 0 || !sk.goal) { sk.goal = openSpot(sk); sk.goalT = 0.8; } }
      if (mode === 'hold') return;
      if (mode === 'none') { sk.kH = 0; sk.kT = 0; return; }
      var hN = pj.hN, vW = Math.max(0.4, sk.v) * hN, T = narrow ? 2.2 : 2.8, NSM = 7;
      var pref, c0, span, nC, wPref, tight = 0;
      if (mode === 'plan') { c0 = sk[sg.kk]; span = sg.name === 'hold' ? 0.4 : 0.16; nC = sg.name === 'hold' ? 5 : 3; pref = c0; wPref = 2.5; }
      else {
        pref = (sg.bias || 0) + 0.3 * Math.sin(simT * sk.wf[0] * TAU + sk.wf[2]) + 0.2 * Math.sin(simT * sk.wf[1] * TAU + sk.wf[3]);
        c0 = 0; span = kMax; nC = 9; wPref = 0.5;
        // heading towards nearby boards: allow a much tighter, slower turn (a real skater would pivot)
        var e0 = sdist(pj, sk.wx, sk.wz) / hN, gl = Math.sqrt(pj._nx * pj._nx + pj._nz * pj._nz) || 1;
        var outw = e0 > 0 ? (Math.cos(sk.th) * pj._nx + Math.sin(sk.th) * pj._nz) / gl : 1;
        tight = clamp((1.1 - e0) / 0.8, 0, 1) * clamp((outw + 0.1) / 0.6, 0, 1);
        // heading into another skater close by: the same tighter turn, to pivot away instead of pushing into them
        var tO = 0;
        for (var qi = 0; qi < sks.length; qi++) {
          var oq = sks[qi]; if (oq === sk) continue;
          var rxq = oq.wx - sk.wx, rzq = oq.wz - sk.wz, dq = aniso(rxq, rzq) / hN;
          if (dq < 1.3) tO = Math.max(tO, clamp((1.3 - dq) / 0.6, 0, 1) * clamp(((rxq * Math.cos(sk.th) + rzq * Math.sin(sk.th)) / (Math.sqrt(rxq * rxq + rzq * rzq) || 1) - 0.2) / 0.5, 0, 1));
        }
        if (tight > 0 || tO > 0) { span = kMax * (1 + 1.5 * Math.max(tight, tO)); nC = 13; }
      }
      // spread out in depth: with two others already up on the far third of the ice, keep away from it too
      // (otherwise everyone can drift to the back where the ice is roomiest, and line up small along the shore)
      var ci, j, oi, farN = 0, zF = pj.zF3;
      if (mode !== 'plan') for (oi = 0; oi < sks.length; oi++) if (sks[oi] !== sk && sks[oi].wz > zF) farN++;
      var farW = farN >= 2 ? 2.5 : (farN === 1 && narrow ? 0.6 : 0);
      // phones: the ice is narrow near us, so the band leans hard to the near half and a skater out past it heads back
      var bandW = narrow ? 1.6 : 0.9;
      // on-screen clearance (visD) wanted around others, wider around a jump or a fall; desktop keeps more of it,
      // so one skater rarely stands in front of another there (phones have less room to give)
      var vR0 = narrow ? 1.3 : 1.5, vRB = narrow ? 1.5 : 1.8, vW0 = narrow ? 6 : 8, vWB = narrow ? 12 : 14, vH = narrow ? 0.95 : 1.0, vHW = narrow ? 18 : 24;
      // desktop, until the first jump of the visit is under way: the looser spacing of the opening seconds, so the first
      // skater's set-up finds its open ice and the first try (with its long, wobbly hold) comes within a few seconds
      var calm = !narrow && story.n === 0;
      if (calm) { vR0 = vRB = 1.2; vW0 = 4; vWB = 8; vH = 0; farW = 0; }
      // best: lowest total cost; bestB: the part of it that only says "outside the depth band" (that alone never slows a skater)
      var best = 1e18, bestK = pref, bestB = 0;
      for (ci = 0; ci < nC; ci++) {
        var kc = c0 + span * ((ci / (nC - 1)) * 2 - 1);
        var cost = wPref * Math.abs(kc - pref) / 0.5 + (mode === 'plan' ? 0 : 0.25 * kc * kc), bandC = 0;
        var kw = kc / hN, x = sk.wx, z = sk.wz, th = sk.th, px = x, pz = z;
        for (j = 1; j <= NSM; j++) {
          var tj = T * j / NSM, s = vW * tj;
          if (Math.abs(kw) < 1e-9) { px = x + Math.cos(th) * s; pz = z + Math.sin(th) * s; }
          else { px = x + (Math.sin(th + kw * s) - Math.sin(th)) / kw; pz = z - (Math.cos(th + kw * s) - Math.cos(th)) / kw; }
          var tw = 1 - 0.5 * (j - 1) / NSM;
          var e = sdist(pj, px, pz) / hN;
          if (e < 0) cost += 16 * tw + 6 * (-e);
          else if (e < 1.0) cost += 5 * (1 - e) * (1 - e) * tw;
          if (mode !== 'plan' && !(narrow && sg.goal)) {
            var c1 = cost;
            if (pz > pj.zB) cost += bandW * (pz - pj.zB) / hN;
            else if (pz < pj.zA) cost += 0.9 * (pj.zA - pz) / hN;
            if (farW && pz > zF) cost += farW * Math.min(6, (pz - zF) / hN) * tw;
            bandC += cost - c1;
          }
          for (oi = 0; oi < sks.length; oi++) {
            var o = sks[oi];
            if (o === sk) continue;
            var ox_ = o.pred[j][0], oz_ = o.pred[j][1];
            var d = aniso(px - ox_, pz - oz_) / hN;
            // (the opening seconds: everyone gives the skater setting up the visit's first try a wide berth, and that
            // skater itself only keeps from bumping into anyone, so it can make straight for its open ice)
            var R = o.busy ? (calm ? 1.75 : 2.1) : (o.inAttempt ? (calm ? 2.8 : 1.7) : 1.4);
            if (calm && sg.goal) {
              if (d < 0.95) cost += 40 * (0.95 - d) * tw;
              if (pz > oz_) { var vs = visD(px - ox_, pz - oz_, (pz + oz_) / 2, 0); if (vs < 1.1) cost += 6 * (1.1 - vs) * tw; }   // nor set up hidden behind a nearer skater
              continue;
            }
            if (d < R) cost += (14 * (1 - d / R) * (1 - d / R) + (d < 0.95 ? 40 * (0.95 - d) : 0)) * tw * (sk.busy ? 0.4 : 1);
            // keep clear on screen too (one figure standing in front of another), most of all around a jump or a fall:
            // not just behind a jumper (who rises up the screen) but above all in front of a jump and its landing, hold
            // and proud pose (a figure standing nearer would hide them)
            // (the visit's first set-up gets the full clearance on screen even in the opening seconds: its long, wobbly
            // hold comes right after, and a skater who drifts in front of it now would still be there)
            var on = o.seg.name, big = calm && o.inAttempt, shown = o.busy || LANDED[on] || big, vd;
            if ((calm && !big) || !(shown || JUMPING[on])) vd = visD(px - ox_, pz - oz_, (pz + oz_) / 2, 0);
            else vd = Math.min(visD(px - ox_, pz - oz_, (pz + oz_) / 2, 0.3), JUMPING[on] ? visD(px - ox_, pz - oz_, (pz + oz_) / 2, -0.45) : 1e9);
            var vR = big ? 1.8 : (shown ? vRB : vR0), vHo = big ? 1.0 : vH;
            if (vd < vR) cost += ((big ? 14 : (shown ? vWB : vW0)) * (vR - vd) + (vd < vHo ? vHW * (vHo - vd) : 0)) * tw * (sk.busy ? 0.3 : 1);
          }
        }
        // outside the depth band: prefer arcs that end heading back towards it (on phones also count a sideways
        // heading against it, or a skater out on the roomy far ice drifts along the shore instead of coming back)
        var thE = th + kw * vW * T, zb = pj.zB - 0.6 * hN, za = pj.zA + 0.6 * hN;
        if (mode === 'plan' || (narrow && sg.goal)) { /* committed edge (or a set-up on narrow ice): only walls and people matter */ }
        else if (pz > zb) { c1 = 3 * (narrow ? 1 + Math.sin(thE) : Math.max(0, Math.sin(thE))) * Math.min(2, (pz - zb) / hN); cost += c1; bandC += c1; }
        else if (pz < za) cost += 3 * Math.max(0, -Math.sin(thE)) * Math.min(2, (za - pz) / hN);
        // set-up: head for open ice (on phones firmly: the near end is too narrow for a jump, so a set-up must leave it;
        // firmer still for a jump a visitor asked for, so it does not loop round the near end first; firmly too for the
        // visit's first try on desktop)
        if (sg.goal && sk.goal) cost += (narrow || calm ? (sg.asked || sk.trig ? 3.2 : 1.6) : (sg.asked || sk.trig ? 0.6 : 0.35)) * Math.sqrt((px - sk.goal[0]) * (px - sk.goal[0]) + (pz - sk.goal[1]) * (pz - sk.goal[1])) / hN;
        if (cost < best) { best = cost; bestK = kc; bestB = bandC; }
      }
      sk.kT = bestK;
      // slow down when someone is close ahead
      var block = 1;
      for (oi = 0; oi < sks.length; oi++) {
        var ob = sks[oi];
        if (ob === sk) continue;
        var rx = ob.wx - sk.wx, rz = ob.wz - sk.wz;
        var ahead = rx * Math.cos(sk.th) + rz * Math.sin(sk.th);
        var dd2 = aniso(rx, rz) / hN;
        if (ahead > 0 && dd2 < 1.6) block = Math.min(block, 0.45 + 0.55 * (dd2 / 1.6));
      }
      // slow down in a crowd or near the boards (not merely for being out of the depth band: that kept skaters
      // crawling about the far ice, the one place they should leave; nor on the way to a jump a visitor asked for)
      sk.vScale = Math.min((calm ? best : best - bestB) > 9 && !(sg.goal && (sg.asked || sk.trig)) ? 0.65 : 1, block, 1 - 0.45 * Math.max(tight, tO));
    }

    /* ---------------------------------------------------------------- simulation */
    function startSeg(sk, sg) {
      sk.seg = sg;
      copyP(sk.from, sk.P);
      // sk.P includes the curve lean, which update() adds again every frame: blend from the pose without it,
      // or a leaning skater would snap twice as far over at the start of every segment
      sk.from[K.roll] -= sk._lean;
      sk.yawOff = wrap(sk.yawOff);
      sk.yaw0 = sk.yawOff;
      sk.yawT = sg.yawTo == null ? NaN : (typeof sg.yawTo === 'function' ? sg.yawTo(sk) : sg.yawTo);
      if (sg.start) sg.start(sk);
      if (sg.vT != null) sk.vTarget = typeof sg.vT === 'function' ? sg.vT(sk) : sg.vT;
    }
    function nextSeg(sk) {
      if (!sk.queue.length) decideNext(sk);
      startSeg(sk, sk.queue.shift());
    }
    function yawEase(kind, u) {
      if (kind === 'rot') return 0.22 * u + 0.78 * sstep(u);
      if (kind === 'in') return u * u;
      if (kind === 'out') return 1 - (1 - u) * (1 - u);
      return sstep(u);
    }
    function update(sk, dt) {
      sk.segT += dt;
      var sg = sk.seg;
      if (sg.tick) sg.tick(sk, dt);
      var guard = 0;
      while (sk.segT >= sk.seg.dur && guard++ < 8) {
        var over = sk.segT - sk.seg.dur;
        if (sk.seg.end) sk.seg.end(sk);
        nextSeg(sk);
        sk.segT = Math.min(over, 0.05);
      }
      sg = sk.seg;
      var u = sg.dur > 0 ? clamp(sk.segT / sg.dur, 0, 1) : 1;
      // speed + curvature + position
      // steering looks 2-3 s ahead, so re-planning every third frame (staggered across skaters) is plenty
      sk.steerDt += dt;
      if (sg !== sk.steerSeg || (frameN + sk.i) % (lite ? 4 : 3) === 0) { steer(sk, sk.steerDt); sk.steerDt = 0; sk.steerSeg = sg; }
      if (sg.kap !== 'hold') sk.kH += (sk.kT - sk.kH) * Math.min(1, dt * 3.5);
      var vt = sk.vTarget * (sg.kap === 'steer' ? sk.vScale : 1);
      sk.v += clamp(vt - sk.v, -sg.acc * dt - 1e-9, sg.acc * dt + 1e-9);
      if (sk.v < 0) sk.v = 0;
      sk.th += sk.kH * sk.v * dt;
      var vw = sk.v * pj.hN;
      sk.vx = Math.cos(sk.th) * vw; sk.vz = Math.sin(sk.th) * vw;
      sk.wx += sk.vx * dt; sk.wz += sk.vz * dt;
      // facing
      if (sk.yawT === sk.yawT) {   // not NaN
        var a = sg.yawA || 0, b = sg.yawB || 1;
        var yu = clamp((u - a) / Math.max(1e-6, b - a), 0, 1);
        sk.yawOff = sk.yaw0 + (sk.yawT - sk.yaw0) * yawEase(sg.yawE, yu);
      }
      // pose
      sg.pose(sk, u, sk.segT, dt, sk.tgt);
      var w = sg.blend > 0 ? ease(sk.segT / sg.blend) : 1;
      mixP(sk.P, sk.from, sk.tgt, w);
      // lean into curves (eased, so taking off or sitting down never straightens the body in one frame)
      var lean = clamp(Math.atan(3 * sk.v * sk.v * sk.kH / 5.9), -0.3, 0.3);
      var leanT = (sg.onIce && sg.kap !== 'none') ? lean * Math.cos(sk.yawOff) : 0;
      sk._lean += (leanT - sk._lean) * Math.min(1, dt * 9);
      sk.P[K.roll] += sk._lean;
      sk.lift = sg.lift ? sg.lift(u) : 0;
      sk.onIce = sg.onIce; sk.scrape = !!sg.scrape;
    }
    // distance from (x,z) to edge E (unsigned)
    function edgeD(E, x, z) {
      var t = clamp(((x - E.ax) * E.dx + (z - E.az) * E.dz) / E.len2, 0, 1), px = E.ax + E.dx * t - x, pz = E.az + E.dz * t - z;
      return Math.sqrt(px * px + pz * pz);
    }
    function constrain(dt) {
      var hN = pj.hN, i, j, m = 0.22 * hN;
      for (var it = 0; it < 2; it++) {
        for (i = 0; i < sks.length; i++) {
          var s = sks[i], e = sdist(pj, s.wx, s.wz);
          if (it === 0) s.pinT = Math.max(0, s.pinT - dt);
          if (e < m) {
            var ei = pj._ei, E = pj.edges[ei], nx = E.nx, nz = E.nz;
            if (e < 0) { var l = Math.sqrt(pj._nx * pj._nx + pj._nz * pj._nz) || 1; nx = pj._nx / l; nz = pj._nz / l; }
            s.wx += nx * (m - e); s.wz += nz * (m - e);
            var cdot = Math.cos(s.th) * nx + Math.sin(s.th) * nz;
            if (it === 0 && cdot < 0 && dt > 0 && s.seg && s.seg.name !== 'air') {
              // in a corner (two boards close) or pinned for a while: turn towards the middle of the rink
              var corner = false;
              for (var ej = 0; ej < pj.edges.length; ej++) if (ej !== ei && edgeD(pj.edges[ej], s.wx, s.wz) < m + 0.35 * hN) corner = true;
              s.pinT += 2 * dt;
              var tgt;
              if (corner || s.pinT > 0.5) tgt = Math.atan2(pj.home[1] - s.wz, pj.home[0] - s.wx);
              else {
                // glide along the boards instead of being shoved sideways, aiming a little inwards
                var tx = -nz, tz = nx;
                if (Math.cos(s.th) * tx + Math.sin(s.th) * tz < 0) { tx = -tx; tz = -tz; }
                tgt = Math.atan2(tz + 0.6 * nz, tx + 0.6 * nx);
              }
              var rate = corner || s.pinT > 0.5 ? 3.2 : 2.5;
              s.th += clamp(wrap(tgt - s.th), -rate * dt, rate * dt);
            }
          }
        }
        for (i = 0; i < sks.length; i++) for (j = i + 1; j < sks.length; j++) {
          var A = sks[i], B = sks[j], dx = B.wx - A.wx, dz = B.wz - A.wz, d = Math.sqrt(dx * dx + dz * dz), R = 0.6 * hN;
          if (d < R) {
            if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
            var p = (R - d) / 2 / d;
            A.wx -= dx * p; A.wz -= dz * p; B.wx += dx * p; B.wz += dz * p;
          }
        }
      }
    }

    /* ---------------------------------------------------------------- solve + render */
    var Jv = {}, names = ['pel', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR', 'top', 'shL', 'shR', 'elbL', 'elbR',
      'wrL', 'wrR', 'neckT', 'headC', 'tgt', 'fwd', 'up', 'lef', 'fH', 'upH', 'poleA', 'poleL', 'ponyA'];
    for (var ni = 0; ni < names.length; ni++) Jv[names[ni]] = V();
    var S2 = {}; for (ni = 0; ni < names.length; ni++) S2[names[ni]] = [0, 0, 0];
    var PRJ_NAMES = ['pel', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR', 'top', 'shL', 'shR', 'elbL', 'elbR', 'wrL', 'wrR', 'neckT', 'headC', 'ponyA'];
    var ctx = { cb: 1, sb: 0, cr: 1, sr: 0, cp: 1, sp: 0, lift: 0, k: 0.3 };
    function prj(v, out) {
      var x = v[0], y = v[1], z = v[2];
      var x1 = x * ctx.cb + y * ctx.sb, y1 = -x * ctx.sb + y * ctx.cb;
      var z2 = z * ctx.cr + y1 * ctx.sr, y2 = -z * ctx.sr + y1 * ctx.cr;
      var X = x1 * ctx.cp - z2 * ctx.sp, Z = x1 * ctx.sp + z2 * ctx.cp;
      out[0] = X; out[1] = -(y2 + ctx.lift) - Z * ctx.k; out[2] = Z;
      return out;
    }
    function prjDir(x, y, z, out) {
      var x1 = x * ctx.cb + y * ctx.sb, y1 = -x * ctx.sb + y * ctx.cb;
      var z2 = z * ctx.cr + y1 * ctx.sr, y2 = -z * ctx.sr + y1 * ctx.cr;
      var X = x1 * ctx.cp - z2 * ctx.sp, Z = x1 * ctx.sp + z2 * ctx.cp;
      out[0] = X; out[1] = -y2 - Z * ctx.k; out[2] = Z;
      return out;
    }
    var D1 = [0, 0, 0], D2 = [0, 0, 0], D3 = [0, 0, 0], RM = [1, 0, 0, 1, 0, 0];
    var T_KEYS = ['thighL', 'kneeL', 'shinL', 'thighR', 'kneeR', 'shinR', 'bootL', 'bootR', 'shL', 'upL', 'elbL', 'foL',
      'shR', 'upR', 'elbR', 'foR', 'handL', 'handR', 'pelvis', 'torso', 'front', 'skirt', 'neck', 'head', 'face', 'bun', 'pony',
      'shadow', 'hit'];
    var TI = {}; for (ni = 0; ni < T_KEYS.length; ni++) TI[T_KEYS[ni]] = ni;
    function makeT() {
      var T = { ord: [], m: [] };
      for (var i = 0; i < T_KEYS.length; i++) T[T_KEYS[i]] = T.m[i] = [1, 0, 0, 1, 0, 0];
      return T;
    }
    var BB_PTS = ['headC', 'ankL', 'ankR', 'wrL', 'wrR', 'kneeL', 'kneeR', 'pel', 'elbL', 'elbR'], B3 = [0, 0, 0];
    function limbT(a, b, m) {
      var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.sqrt(dx * dx + dy * dy), ux = 0, uy = 1;
      if (l > 1e-4) { ux = dx / l; uy = dy / l; }
      return m6(m, dx, dy, -uy, ux, a[0], a[1]);
    }
    function tr(p, m) { return m6(m, 1, 0, 0, 1, p[0], p[1]); }

    // computes the transform strings for one skater into T
    function solve(sk, phi, k) {
      var P = sk.P, J = Jv, S = S2, i;
      var py = P[K.py];
      var LL = LEG * 0.999;
      // ankle heights: a toe-down or heel-down boot is lifted until its blade and toe pick rest on the ice, never in it
      var sbp = Math.sin(P[K.bp]), cbp = Math.cos(P[K.bp]), srl = Math.sin(P[K.roll]), crl = Math.cos(P[K.roll]);
      // (but the ankle stays well under the hip line, so a low leg, as when kneeling or sitting, never flips its knee;
      // and a foot under or behind the hips lifts fully only once the hips are up, so rolling over onto the knees stays one
      // smooth move; while the hips are still low a foot well behind them may come up a little higher, so its boot never
      // sinks deep. A foot passing right under the low hips is not lifted: a raised ankle there folds the leg so tight that
      // the knee would flick over to its other side in a frame or two)
      var ayL = Math.max(P[K.ly] + ANK, 2.5), ayR = Math.max(P[K.ry] + ANK, 2.5), hipY = py + HIPDY - 2, hipsUp = sstep((py - 9) / 16);
      var cB = 0.5 - 0.35 * (1 - hipsUp), topL = hipY + (P[K.lx] < 0 ? cB : 0.22) * P[K.lx], topR = hipY + (P[K.rx] < 0 ? cB : 0.22) * P[K.rx];
      var upL = 1 - clamp((20 - P[K.lx]) / 14, 0, 1) * (1 - Math.max(hipsUp, 0.6 * clamp((-P[K.lx] - 4) / 6, 0, 1)));
      var upR = 1 - clamp((20 - P[K.rx]) / 14, 0, 1) * (1 - Math.max(hipsUp, 0.6 * clamp((-P[K.rx] - 4) / 6, 0, 1)));
      ayL = Math.max(ayL, Math.min(ayL + upL * bootSink(P[K.lx], ayL, P[K.lz], P[K.lt], P[K.lo], sbp, cbp, srl, crl, sk.lift), topL));
      ayR = Math.max(ayR, Math.min(ayR + upR * bootSink(P[K.rx], ayR, P[K.rz], P[K.rt], P[K.ro], sbp, cbp, srl, crl, sk.lift), topR));
      // keep low (planted) feet reachable: lower the pelvis if needed
      var fx = P[K.lx], fz = P[K.lz], dh2;
      if (ayL < 4.5 + ANK) { dh2 = fx * fx + (fz - HIPW) * (fz - HIPW); py = Math.min(py, ayL - HIPDY + Math.sqrt(Math.max(0, LL * LL - dh2))); }
      fx = P[K.rx]; fz = P[K.rz];
      if (ayR < 4.5 + ANK) { dh2 = fx * fx + (fz + HIPW) * (fz + HIPW); py = Math.min(py, ayR - HIPDY + Math.sqrt(Math.max(0, LL * LL - dh2))); }
      var pel = J.pel; pel[0] = 0; pel[1] = py; pel[2] = 0;
      J.hipL[0] = 0; J.hipL[1] = py + HIPDY; J.hipL[2] = HIPW;
      J.hipR[0] = 0; J.hipR[1] = py + HIPDY; J.hipR[2] = -HIPW;
      // torso frame
      var tw = P[K.tw], ct = Math.cos(tw), st = Math.sin(tw);
      var fw = J.fwd, up = J.up, lf = J.lef;
      fw[0] = ct; fw[1] = 0; fw[2] = st; up[0] = 0; up[1] = 1; up[2] = 0; lf[0] = -st; lf[1] = 0; lf[2] = ct;
      var c = Math.cos(P[K.sp]), s = Math.sin(P[K.sp]), t0, t1, t2;
      t0 = up[0] * c + fw[0] * s; t1 = up[1] * c + fw[1] * s; t2 = up[2] * c + fw[2] * s;
      fw[0] = fw[0] * c - up[0] * s; fw[1] = fw[1] * c - up[1] * s; fw[2] = fw[2] * c - up[2] * s;
      up[0] = t0; up[1] = t1; up[2] = t2;
      c = Math.cos(P[K.sr]); s = Math.sin(P[K.sr]);
      t0 = up[0] * c + lf[0] * s; t1 = up[1] * c + lf[1] * s; t2 = up[2] * c + lf[2] * s;
      lf[0] = lf[0] * c - up[0] * s; lf[1] = lf[1] * c - up[1] * s; lf[2] = lf[2] * c - up[2] * s;
      up[0] = t0; up[1] = t1; up[2] = t2;
      var top = J.top;
      for (i = 0; i < 3; i++) top[i] = pel[i] + up[i] * SPINE;
      for (i = 0; i < 3; i++) { J.shL[i] = top[i] + up[i] * SHDY + lf[i] * SHW; J.shR[i] = top[i] + up[i] * SHDY - lf[i] * SHW; }
      // head
      c = Math.cos(P[K.hp]); s = Math.sin(P[K.hp]);
      var uh = J.upH; for (i = 0; i < 3; i++) uh[i] = up[i] * c + fw[i] * s;
      for (i = 0; i < 3; i++) { J.neckT[i] = top[i] + uh[i] * NECK; J.headC[i] = J.neckT[i] + uh[i] * HEADC; }
      c = Math.cos(P[K.hy]); s = Math.sin(P[K.hy]);
      var fh = J.fH; for (i = 0; i < 3; i++) fh[i] = (fw[i] * Math.cos(P[K.hp]) - up[i] * Math.sin(P[K.hp])) * c + lf[i] * s;
      for (i = 0; i < 3; i++) J.ponyA[i] = J.headC[i] - fh[i] * 4.3 + uh[i] * 1.6;
      // arms
      var hb = P[K.hb], tg = J.tgt, pole = J.poleA;
      for (var side = 0; side < 2; side++) {
        var sh = side ? J.shR : J.shL, sg = side ? -1 : 1;
        var hx = P[side ? K.bx : K.ax], hy = P[side ? K.by : K.ay], hz = P[side ? K.bz : K.az];
        for (i = 0; i < 3; i++) tg[i] = (sh[i] + fw[i] * hx + up[i] * hy + lf[i] * hz) * (1 - hb);
        if (hb > 0) { tg[0] += hx * hb; tg[1] += hy * hb; tg[2] += hz * hb; }
        for (i = 0; i < 3; i++) pole[i] = -fw[i] * 0.8 - up[i] * 0.35 + lf[i] * 0.55 * sg;
        ik2(sh, tg, UARM, FARM, pole, side ? J.elbR : J.elbL, side ? J.wrR : J.wrL);
      }
      // legs
      var pl = J.poleL;
      for (side = 0; side < 2; side++) {
        var lx = P[side ? K.rx : K.lx], lz = P[side ? K.rz : K.lz], lo = P[side ? K.ro : K.lo];
        tg[0] = lx; tg[1] = side ? ayR : ayL; tg[2] = lz;
        pl[0] = Math.cos(lo); pl[1] = 0.25; pl[2] = Math.sin(lo);
        ik2(side ? J.hipR : J.hipL, tg, THIGH, SHIN, pl, side ? J.kneeR : J.kneeL, side ? J.ankR : J.ankL);
      }
      // projection context
      ctx.cb = Math.cos(P[K.bp]); ctx.sb = Math.sin(P[K.bp]);
      ctx.cr = Math.cos(P[K.roll]); ctx.sr = Math.sin(P[K.roll]);
      ctx.cp = Math.cos(phi); ctx.sp = Math.sin(phi);
      ctx.lift = sk.lift; ctx.k = k;
      for (i = 0; i < PRJ_NAMES.length; i++) prj(J[PRJ_NAMES[i]], S[PRJ_NAMES[i]]);
      var T = sk.T || (sk.T = makeT());
      // legs
      limbT(S.hipL, S.kneeL, T.thighL); tr(S.kneeL, T.kneeL); limbT(S.kneeL, S.ankL, T.shinL);
      limbT(S.hipR, S.kneeR, T.thighR); tr(S.kneeR, T.kneeR); limbT(S.kneeR, S.ankR, T.shinR);
      for (side = 0; side < 2; side++) {
        var lt = P[side ? K.rt : K.lt], lo2 = P[side ? K.ro : K.lo];
        var cl = Math.cos(lt), sl = Math.sin(lt), co = Math.cos(lo2), so = Math.sin(lo2);
        prjDir(cl * co, -sl, cl * so, D1);
        prjDir(-sl * co, -cl, -sl * so, D2);
        var fl = Math.sqrt(D1[0] * D1[0] + D1[1] * D1[1]);
        if (fl < 0.4) {
          if (fl < 1e-4) { D1[0] = (side ? sk._bsR : sk._bsL) || 1; D1[1] = 0; fl = 1; }
          D1[0] *= 0.4 / fl; D1[1] *= 0.4 / fl;
        }
        if (side) sk._bsR = D1[0] < 0 ? -1 : 1; else sk._bsL = D1[0] < 0 ? -1 : 1;
        var an = side ? S.ankR : S.ankL;
        m6(side ? T.bootR : T.bootL, D1[0], D1[1], D2[0], D2[1], an[0], an[1]);
      }
      // arms
      tr(S.shL, T.shL); limbT(S.shL, S.elbL, T.upL); tr(S.elbL, T.elbL); limbT(S.elbL, S.wrL, T.foL);
      tr(S.shR, T.shR); limbT(S.shR, S.elbR, T.upR); tr(S.elbR, T.elbR); limbT(S.elbR, S.wrR, T.foR);
      for (side = 0; side < 2; side++) {
        var e2 = side ? S.elbR : S.elbL, w2 = side ? S.wrR : S.wrL;
        var dx = w2[0] - e2[0], dy = w2[1] - e2[1], l = Math.sqrt(dx * dx + dy * dy), ux = 0, uy = 1;
        if (l > 1e-4) { ux = dx / l; uy = dy / l; }
        var rr = clamp(l / FARM, 0.45, 1);
        m6(side ? T.handR : T.handL, ux * rr, uy * rr, -uy, ux, w2[0], w2[1]);
      }
      // pelvis
      prjDir(0, -1, 0, D1);
      prjDir(0, 0, 1, D2);
      var wfP = Math.sqrt(0.3 + 0.7 * D2[0] * D2[0]);
      var dl = Math.sqrt(D1[0] * D1[0] + D1[1] * D1[1]) || 1;
      m6(T.pelvis, D1[1] / dl * wfP, -D1[0] / dl * wfP, D1[0], D1[1], S.pel[0], S.pel[1]);
      // torso
      var sx = S.top[0] - S.pel[0], sy = S.top[1] - S.pel[1], sl2 = Math.sqrt(sx * sx + sy * sy), vx, vy;
      if (sl2 > 3) { vx = sx / sl2; vy = sy / sl2; } else { vx = -D1[0] / dl; vy = -D1[1] / dl; }
      prjDir(lf[0], lf[1], lf[2], D3);
      var wfT = Math.sqrt(0.3 + 0.7 * D3[0] * D3[0]);
      m6(T.torso, -vy * wfT, vx * wfT, -sx / SPINE, -sy / SPINE, S.pel[0], S.pel[1]);
      // front details only when the chest faces the camera
      prjDir(fw[0], fw[1], fw[2], D3);
      var front = clamp(-D3[2] * 1.6 - 0.15, 0, 1);
      m6(T.front, Math.max(0.001, front), 0, 0, 1, 0, 0);
      T.frontOn = front > 0.02;
      // skirt hangs along the thighs
      if (sk.m.hips.skirt) {
        var kx = (J.kneeL[0] - J.hipL[0]) + (J.kneeR[0] - J.hipR[0]);
        var ky = (J.kneeL[1] - J.hipL[1]) + (J.kneeR[1] - J.hipR[1]) - 30;
        var kz = (J.kneeL[2] - J.hipL[2]) + (J.kneeR[2] - J.hipR[2]);
        var kl = Math.sqrt(kx * kx + ky * ky + kz * kz) || 1;
        prjDir(kx / kl, ky / kl, kz / kl, D1);
        var ql = Math.sqrt(D1[0] * D1[0] + D1[1] * D1[1]);
        if (ql < 0.35) { D1[0] = D1[0] / (ql || 1) * 0.35; D1[1] = (ql < 1e-4 ? 0.35 : D1[1] / ql * 0.35); ql = 0.35; }
        var flare = clamp(P[K.fl] + Math.min(1, Math.abs(sk.yawRate) / 14), 0, 1.4);
        var wS = (0.86 + 0.14 * Math.abs(D2[0])) * (1 + 0.38 * flare), hS = 1 - 0.16 * flare;
        m6(T.skirt, D1[1] / ql * wS, -D1[0] / ql * wS, D1[0] * hS, D1[1] * hS, S.pel[0], S.pel[1]);
      }
      // neck + head
      D3[0] = S.neckT[0] + (S.headC[0] - S.neckT[0]) * 0.45; D3[1] = S.neckT[1] + (S.headC[1] - S.neckT[1]) * 0.45;
      limbT(S.top, D3, T.neck);
      var nx = S.headC[0] - S.neckT[0] * 0.5 - S.top[0] * 0.5, ny = S.headC[1] - S.neckT[1] * 0.5 - S.top[1] * 0.5;
      var ang = Math.atan2(nx, -ny) * 180 / PI;
      var cA = Math.cos(ang * PI / 180), sA = Math.sin(ang * PI / 180);
      m6(T.head, cA, sA, -sA, cA, S.headC[0], S.headC[1]);
      prjDir(fh[0], fh[1], fh[2], D1);
      var FX = D1[0], FT = -D1[2];
      var wface = FT >= 0 ? 0.42 + 0.58 * FT : 0.42 * Math.max(0, 1 + 1.6 * FT);
      // face offset in screen space, rotated into the (tilted) head frame
      var off = 3.0 + 3.5 * Math.max(0, -FT), ox = FX * off, oy = D1[1] * off * 0.6;
      var ar = -ang * PI / 180, ca = Math.cos(ar), sa = Math.sin(ar);
      var lx_ = ox * ca - oy * sa, ly_ = ox * sa + oy * ca;
      var faceX = lx_, faceY = ly_ + (sk.look.hair === 'short' ? 0.5 : 1.15);
      var fa = (Math.abs(lx_) + Math.abs(ly_) > 1e-3) ? Math.atan2(ly_, lx_) * 180 / PI : 0;
      // translate(face) rotate(fa) scale(w,1) rotate(-fa): squash the face along its offset direction
      var wf = Math.max(0.001, wface), cF = Math.cos(fa * PI / 180), sF = Math.sin(fa * PI / 180);
      m6(T.face, wf * cF * cF + sF * sF, (wf - 1) * sF * cF, (wf - 1) * sF * cF, wf * sF * sF + cF * cF, faceX, faceY);
      m6(T.bun, 1, 0, 0, 1, -FX * 3.3, -4.5 + 0.6 * Math.abs(FT));
      T.bunFront = FT < -0.25;
      if (sk.m.pony) {
        var target = PI / 2 + (0.45 + Math.min(0.9, Math.abs(sk.yawRate) * 0.07)) * FX + ang * PI / 180;
        if (sk.lift > 2) target -= 0.4 * FX;
        sk.tailA += (target - sk.tailA) * Math.min(1, sk._dt * 10);
        m6(T.pony, Math.cos(sk.tailA), Math.sin(sk.tailA), -Math.sin(sk.tailA), Math.cos(sk.tailA), S.ponyA[0], S.ponyA[1]);
      }
      // which limbs are on the far side
      var zl = S.hipL[2] + S.kneeL[2] + S.ankL[2], zr = S.hipR[2] + S.kneeR[2] + S.ankR[2];
      var al = S.shL[2] + S.elbL[2] + S.wrL[2], ar = S.shR[2] + S.elbR[2] + S.wrR[2];
      T.legLfar = zl > zr; T.armLfar = al > ar;
      // draw order: larger key = farther = drawn first
      var bodyZ = (S.pel[2] + S.top[2]) / 2;
      var keys = sk._keys || (sk._keys = []);
      keys[0] = zl / 3 + 12; keys[1] = zr / 3 + 12; keys[2] = al / 3 + 1.5; keys[3] = ar / 3 + 1.5;
      keys[4] = bodyZ; keys[5] = Math.min(S.headC[2], bodyZ) - 0.6;
      keys[6] = Math.min(keys[0], keys[1], bodyZ) - 0.05;
      if (sk.m.pony) keys[7] = S.ponyA[2] + (FT > 0 ? 3 : -3);
      // farthest first (insertion sort: 7-8 items, no allocation)
      var ord = T.ord, nk = sk.m.pony ? 8 : 7, j, kv;
      ord.length = nk;
      for (i = 0; i < nk; i++) {
        kv = keys[i];
        for (j = i - 1; j >= 0 && keys[ord[j]] < kv; j--) ord[j + 1] = ord[j];
        ord[j + 1] = i;
      }
      // bounding box (figure units) for hit testing; shadow
      var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, pt;
      for (i = 0; i < BB_PTS.length; i++) {
        pt = S[BB_PTS[i]];
        if (pt[0] < mnx) mnx = pt[0]; if (pt[0] > mxx) mxx = pt[0];
        if (pt[1] < mny) mny = pt[1]; if (pt[1] > mxy) mxy = pt[1];
      }
      var lb = sk.lbox || (sk.lbox = [0, 0, 0, 0]);
      lb[0] = mnx - 6; lb[1] = mny - 8; lb[2] = mxx + 6; lb[3] = mxy + 10;
      var gx = (J.ankL[0] + J.ankR[0] + J.pel[0]) / 3, gz = (J.ankL[2] + J.ankR[2]) / 2;
      prjDir(gx, 0, gz, D1);
      var spread = Math.abs(S.ankL[0] - S.ankR[0]);
      var sitting = py < 20 ? 1 : 0;
      var rx = (15 + spread * 0.35 + sitting * 8) * (1 - Math.min(0.35, sk.lift / 130));
      m6(T.shadow, rx, 0, 0, rx * Math.max(0.13, k * 0.95), D1[0], D1[1] + 0.6);
      T.shadowOp = n2(0.3 * (1 - Math.min(0.6, sk.lift / 70)));
      m6(T.hit, 1, 0, 0, 1, 0, -sk.lift);
      // blade on the ice (support foot = lower ankle)
      var supR = J.ankR[1] < J.ankL[1] - 0.3 ? true : (J.ankL[1] < J.ankR[1] - 0.3 ? false : !!sk._supR);
      sk._supR = supR;
      var aj = supR ? J.ankR : J.ankL, lo3 = P[supR ? K.ro : K.lo];
      sk._bladeB[0] = aj[0] + Math.cos(lo3) * 2; sk._bladeB[1] = aj[2] + Math.sin(lo3) * 2;
      return T;
    }
    function applyFig(F, T, look, main) {
      var A = F.anim, Tm = T.m, i, j;
      for (i = 0; i < A.length; i++) setS(A[i], Tm[A[i].i]);
      var b = F.body, hp = F.hips, h = F.head;
      if (F.frontS) {
        if (T.frontOn) setS(F.frontS, T.front);
        setA(b.front, 'display', T.frontOn ? 'inline' : 'none');
      }
      if (hp.zip) setA(hp.zip, 'display', T.frontOn ? 'inline' : 'none');
      if (h.bun && h.bunFront !== T.bunFront) {
        h.bunFront = T.bunFront;
        if (T.bunFront) h.g.appendChild(h.bun); else h.g.insertBefore(h.bun, h.shape);
      }
      setLimbFill(F, look, 'legL', T.legLfar); setLimbFill(F, look, 'legR', !T.legLfar);
      setLimbFill(F, look, 'armL', T.armLfar); setLimbFill(F, look, 'armR', !T.armLfar);
      // draw order inside the figure: move only the parts that are out of place
      var cur = F.cur, want = T.ord, n = want.length;
      for (i = 0; i < n; i++) {
        if (cur[i] === want[i]) continue;
        F.fig.insertBefore(F.parts[want[i]].g, F.parts[cur[i]].g);
        for (j = i + 1; j < n && cur[j] !== want[i]; j++) { /* find it */ }
        for (; j > i; j--) cur[j] = cur[j - 1];
        cur[i] = want[i];
      }
      if (main) setA(F.shadow, 'opacity', T.shadowOp);
    }
    function render(sk, dt) {
      var S = pj.toS(sk.wx, sk.wz, tmpS), X = S[0], Y = S[1], p = S[2];
      var sc = pj.hN * p / 100, k = pj.kD(p);
      var phi = sk.frozen ? sk.frozen.phi : sk.th + sk.yawOff;
      if (sk.prevPhi === sk.prevPhi && dt > 0) sk.yawRate = lerp(sk.yawRate, (phi - sk.prevPhi) / dt, Math.min(1, dt * 20));
      sk.prevPhi = phi;
      sk._dt = dt || 0.016;
      var T = solve(sk, phi, k);
      applyFig(sk.m, T, sk.look, true);
      // the faint reflection's limbs refresh at 20 Hz (staggered across skaters; full rate in the air) to cut its DOM writes;
      // its root transform below still updates every frame, so it never drifts from the feet
      if (!(dt > 0) || sks.length < 3 || (frameN + sk.i) % (lite ? 6 : 3) === 0 || sk.lift > 0) applyFig(sk.rf, T, sk.look, false);
      setS(sk.m.rootS, m6(RM, sc, 0, 0, sc, X, Y));
      setS(sk.rf.rootS, m6(RM, sc, 0, 0, -sc * 0.86, X, Y));
      sk.sx = X; sk.sy = Y; sk.sc = sc;
      sk.bbox[0] = X + sk.lbox[0] * sc; sk.bbox[1] = Y + sk.lbox[1] * sc; sk.bbox[2] = X + sk.lbox[2] * sc; sk.bbox[3] = Y + sk.lbox[3] * sc;
      // blade point -> world -> screen
      var bb = sk._bladeB, cph = Math.cos(phi), sph = Math.sin(phi), u = pj.hN / 100;
      var bx, bz, ox = 0, oz = 0;
      if (!sk.scrape) { ox = (bb[0] * cph - bb[1] * sph) * u; oz = (bb[0] * sph + bb[1] * cph) * u; }
      // The traced line follows the skater's own path (the point under the pelvis), pulled a little and slowly
      // towards the gliding foot. Following the foot itself made the line hop across at every push and come out
      // as a jagged zigzag; this way it flows in smooth arcs like real tracings.
      var ct = Math.cos(sk.th), st = Math.sin(sk.th), al = ox * ct + oz * st, lt = -ox * st + oz * ct;
      al = clamp(al, -3 * u, 3 * u); lt = clamp(lt, -2.5 * u, 2.5 * u);
      var on = !!(sk.onIce && sk.lift < 0.5 && !sk.frozen);
      if (!(dt > 0) || !sk.blade.onIce || !on || sk.blade.al !== sk.blade.al) { sk.blade.al = al; sk.blade.lt = lt; }
      else {
        var kb = 1 - Math.exp(-dt / 0.45);
        sk.blade.al += (al - sk.blade.al) * kb;
        sk.blade.lt += (lt - sk.blade.lt) * kb;
      }
      bx = sk.wx + sk.blade.al * ct - sk.blade.lt * st; bz = sk.wz + sk.blade.al * st + sk.blade.lt * ct;
      var B = pj.toS(bx, bz, B3);
      var bl = sk.blade;
      bl.x = n2(B[0]); bl.y = n2(B[1]); bl.onIce = on; bl.scrape = !!sk.scrape; bl.color = sk.look.glow;
    }
    var layerOrder = [];   // skaters in current DOM order (back to front)
    function sortLayers() {
      var n = sks.length, i, j, s, changed = layerOrder.length !== n;
      if (changed) { layerOrder.length = 0; for (i = 0; i < n; i++) layerOrder.push(sks[i]); }
      // insertion sort by screen y (nearly sorted already, so this is O(n) most frames)
      for (i = 1; i < n; i++) {
        s = layerOrder[i];
        for (j = i - 1; j >= 0 && layerOrder[j].sy > s.sy; j--) { layerOrder[j + 1] = layerOrder[j]; changed = true; }
        layerOrder[j + 1] = s;
      }
      if (!changed) return;
      // a keyboard user may be on one of the skaters: never move that one (moving a node drops its focus),
      // re-order the others around it instead, and only move the nodes that are out of place
      var act = document.activeElement, pin = null;
      for (i = 0; i < n; i++) if (layerOrder[i].m.root === act) pin = act;
      var next = null, nextR = null, e, er;
      for (i = n - 1; i >= 0; i--) {
        e = layerOrder[i].m.root; er = layerOrder[i].rf.root;
        if (e !== pin && e.nextSibling !== next) layer.insertBefore(e, next);
        if (er.nextSibling !== nextR) reflLayer.insertBefore(er, nextR);
        next = e; nextR = er;
      }
      if (pin && document.activeElement !== pin && pin.focus) pin.focus({ preventScroll: true });
    }

    /* ---------------------------------------------------------------- placement */
    function placeAll(r) {
      var hN = pj.hN, pts = [], i, tries;
      for (i = 0; i < sks.length; i++) {
        var best = null, bestScore = -1e18;
        for (tries = 0; tries < 160; tries++) {
          var x = lerp(pj.bx0, pj.bx1, r()), z = lerp(Math.max(pj.bz0, pj.zA * 0.95), Math.min(pj.bz1, pj.zB), r());
          var e = sdist(pj, x, z);
          if (e < 0.7 * hN) continue;
          var md = 1e9;
          for (var j = 0; j < pts.length; j++) md = Math.min(md, aniso(x - pts[j][0], z - pts[j][1]), visD(x - pts[j][0], z - pts[j][1], (z + pts[j][1]) / 2) * 0.9 * hN);
          var score = Math.min(md, 2.4 * hN) + Math.min(e, 1.2 * hN) * 0.3;
          if (score > bestScore) { bestScore = score; best = [x, z]; }
        }
        if (!best) best = [pj.pole[0] + (r() - 0.5) * hN, pj.pole[1] + (r() - 0.5) * hN];
        pts.push(best);
        var s = sks[i];
        s.wx = best[0]; s.wz = best[1];
        var toHome = Math.atan2(pj.home[1] - s.wz, pj.home[0] - s.wx);
        s.th = toHome + (r() - 0.5) * 2.2 + PI / 2 * (r() < 0.5 ? 1 : -1) * 0.5;
      }
    }

    /* ---------------------------------------------------------------- reduced motion */
    function staticScene() {
      var r = mulberry(Math.floor(seed * 131) + 7);
      placeAll(r);
      var poses = [[P_GLIDE_L, -0.5], [P_HOLD, PI + 0.55], [P_TWO, 0.4], [P_GLIDE_R, PI - 0.4], [P_HOLD, -0.3]];
      for (var i = 0; i < sks.length; i++) {
        var s = sks[i], pp = poses[i % poses.length];
        copyP(s.P, pp[0]);
        s.lift = 0; s.onIce = true; s.scrape = false;
        s.frozen = { phi: pp[1] };
        render(s, 0);
      }
      sortLayers();
    }

    /* ---------------------------------------------------------------- init */
    for (var si = 0; si < count; si++) sks.push(makeSkater(si));
    placeAll(rng);
    for (si = 0; si < sks.length; si++) {
      var sk0 = sks[si];
      sk0.v = sk0.vC * (0.8 + 0.2 * sk0.r());
      sk0.vTarget = sk0.vC;
      sk0.cool = si === 0 ? 0 : 3.5 + si * 3 + sk0.r() * 3;
      startSeg(sk0, segCruise(si === 0 ? 0.6 : 1 + 2 * sk0.r(), false));
      cruiseGen(sk0, 0, sk0.P, false);
      copyP(sk0.from, sk0.P);   // blend from the stroke pose drawn at start-up, so frame 1 does not snap
    }
    if (reduce) staticScene();
    else { for (si = 0; si < sks.length; si++) render(sks[si], 0); sortLayers(); }

    /* ---------------------------------------------------------------- API */
    function step(nowMs) {
      if (reduce) return;
      var c0 = clock();
      if (nowMs == null) nowMs = c0;
      var dt = lastNow == null ? 0 : (nowMs - lastNow) / 1000;
      lastNow = nowMs;
      dt = clamp(dt, 0, 0.05);
      frameN++;
      if (dt > 0) {
        simT += dt;
        predictAll();
        for (var i = 0; i < sks.length; i++) if (!sks[i].frozen) update(sks[i], dt);
        constrain(dt);
      }
      for (i = 0; i < sks.length; i++) render(sks[i], dt);
      sortLayers();
      if (dt > 0) {
        // slow average (~1 s) of clipped samples, so a lone GC / JIT spike or the first two
        // seconds of warm-up never switch it on: only a steadily slow device does
        cost += (Math.min(5, clock() - c0) - cost) * 0.02;
        if (liteLock != null) lite = liteLock;
        else if (!lite && cost > 3.2 && frameN > 120) lite = 1;
        else if (lite && cost < 1.6) lite = 0;
      }
    }
    function setIce(ice) {
      var old = pj;
      useProj(makeProj(ice));
      for (var k2 = 0; k2 < sks.length; k2++) sks[k2].vC = sks[k2].vC0 / Math.sqrt(crowd);
      for (var i = 0; i < sks.length; i++) {
        var s = sks[i];
        var u = (s.wx - old.bx0) / Math.max(1, old.bx1 - old.bx0), w = (s.wz - old.bz0) / Math.max(1, old.bz1 - old.bz0);
        s.wx = lerp(pj.bx0, pj.bx1, clamp(u, 0, 1));
        s.wz = lerp(pj.bz0, pj.bz1, clamp(w, 0, 1));
      }
      for (var it = 0; it < 6; it++) constrain(0);
      if (reduce) { staticScene(); return; }
      for (i = 0; i < sks.length; i++) render(sks[i], 0);
      sortLayers();
    }
    function blades() {
      var out = [];
      for (var i = 0; i < sks.length; i++) {
        var b = sks[i].blade;
        out.push({ x: b.x, y: b.y, onIce: b.onIce, scrape: b.scrape, color: b.color });
      }
      return out;
    }
    function skaterAt(x, y) {
      var order = sks.slice().sort(function (a, b) { return b.sy - a.sy; });
      for (var i = 0; i < order.length; i++) {
        var bb = order[i].bbox;
        if (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3]) return order[i].i;
      }
      return -1;
    }
    var JUMPING = { step: 1, edge: 1, load: 1, takeoff: 1, air: 1 }, LANDED = { land: 1, hold: 1, proud: 1, land2: 1, steady: 1 }, GETUP ={ slip: 1, slide: 1, sit: 1, kneel: 1, lunge: 1, rise: 1, brush: 1 };
    // the unhurried beats after a jump (a proud pose, a breath, turning forward again), skipped when a visitor is waiting
    var AFTER = { proud: 1, exhale: 1, turnBF: 1 };
    function trigger(i) {
      var s = sks[i];
      if (!s || reduce) return '';
      var n = s.seg ? s.seg.name : '';
      if (n === 'cruise' || n === 'cruiseBack' || n === 'turnFB' || n === 'turnBF') { s.trig = true; s.queue = []; if (n === 'cruise' || n === 'cruiseBack') s.segT = s.seg.dur; return 'setup'; }
      // already setting up (the set-up's end() makes sure a jump follows, even if it runs out of room),
      // mid-jump or getting up: try (again) right after
      s.trig = true;
      if (n === 'backX') {
        // this set-up was going to end in a bail: make it a real jump instead, as the visitor asked
        if (s.outcome === 'bail') { storyReturn(s); s.hist.pop(); s.queue = attemptTail(s, pickOutcome(s, true), false); s.hist.push(s.outcome); }
        return 'setup';
      }
      // the next set-up follows straight after this jump's landing (skating backwards out of it, as skaters do)
      s.queue = s.queue.filter(function (q) { return !AFTER[q.name]; });
      return JUMPING[n] ? 'jumping' : (GETUP[n] ? 'getup' : 'after');
    }
    function elements() { var out = []; for (var i = 0; i < sks.length; i++) out.push(sks[i].m.root); return out; }
    function boxes() { var out = []; for (var i = 0; i < sks.length; i++) out.push(sks[i].bbox.slice()); return out; }
    function setLite(v) { liteLock = v == null ? null : (v ? 1 : 0); if (liteLock != null) lite = liteLock; }

    var rink = { step: step, setIce: setIce, blades: blades, skaterAt: skaterAt, trigger: trigger, elements: elements, boxes: boxes, setLite: setLite };
    // testing hooks (not part of the public contract)
    rink._debug = {
      sks: sks,
      poses: POSES,
      force: function (i, outcome, longHold) {
        var s = sks[i]; if (!s) return;
        s.forced = { outcome: outcome, longHold: !!longHold };
        s.queue = [];
        if (s.seg && (s.seg.name === 'cruise' || s.seg.name === 'cruiseBack')) s.segT = s.seg.dur;
      },
      info: function (i) {
        var s = sks[i];
        return { seg: s.seg && s.seg.name, segT: s.segT, x: s.sx, y: s.sy, sc: s.sc, wx: s.wx, wz: s.wz, v: s.v, kH: s.kH,
          yawOff: s.yawOff, th: s.th, lift: s.lift, outcome: s.outcome, cool: s.cool, queue: s.queue.map(function (q) { return q.name; }),
          bbox: s.bbox.slice(), inside: sdist(pj, s.wx, s.wz) / pj.hN, aborts: s.aborts || 0, attempts: s.attempts, lh: s.longHold };
      },
      pose: function (i, name, yawDeg, lift) {
        var s = sks[i];
        copyP(s.P, POSES[name] || P_STAND);
        s.lift = lift || 0;
        s.frozen = { phi: (yawDeg || 0) * PI / 180 };
        render(s, 0); sortLayers();
      },
      place: function (i, x, y, headingDeg) {
        var s = sks[i], w = pj.toW(x, y);
        s.wx = w[0]; s.wz = w[1];
        if (headingDeg != null) s.th = headingDeg * PI / 180;
        render(s, 0); sortLayers();
      },
      unfreeze: function (i) { sks[i].frozen = null; },
      proj: function () { return pj; },
      crowd: function () { return { crowd: crowd, kMax: kMax, narrow: narrow, area: pj.area, midWidth: pj.midWidth }; },
      time: function () { return simT; },
      budget: function () { return { cost: cost, lite: lite }; },
      lockLite: setLite,
      lite: function () { return lite; },
      pf: PF
    };
    return rink;
  }

  root.createSkaterRink = createSkaterRink;
})(typeof window !== 'undefined' ? window : this);

/* ======================================================================================
   2. The page
   ====================================================================================== */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (id) { return document.getElementById(id); };

  // Seeded random so the village stars look the same on every visit.
  var seed = 21;
  function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function el(name, attrs, parent) {
    var node = document.createElementNS(SVGNS, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }
  function f(n) { return Math.round(n * 10) / 10; }

  /* ---------- The lake: a wide crop and a tall (phone) crop of the same paper scene ---------- */

  // Where skaters may glide (they never leave this polygon) and how tall they are near and far.
  // Measured from the artwork: no part of the front layer covers either polygon.
  var SCENE = {
    wide: {
      viewBox: [0, 0, 1600, 1000],
      ice: {
        icePolygon: [[440, 632], [1160, 632], [1280, 650], [1262, 760], [1240, 880], [1224, 990], [384, 990], [362, 880], [344, 760], [332, 650]],
        horizonY: 590, farY: 640, nearY: 990, skaterHeightFar: 64, skaterHeightNear: 210
      },
      // the two malamutes walk along the edge of the ice, just in front of the far shore
      dogPath: { y: 621, x0: 430, x1: 1170 },
      // the eagle's lap when it is tapped: a small ellipse standing on its perch (it stays under the lanterns)
      eagleLoop: { rx: 44, ry: 10 }
    },
    tall: {
      viewBox: [0, -200, 1600, 1200],
      ice: {
        icePolygon: [[580, 636], [1028, 636], [1030, 700], [1004, 740], [1002, 830], [986, 930], [956, 990], [650, 990], [632, 930], [628, 820], [596, 780], [590, 700]],
        horizonY: 590, farY: 640, nearY: 990, skaterHeightFar: 64, skaterHeightNear: 200
      },
      dogPath: { y: 621, x0: 615, x1: 1005 },   // between the big phone-only pines
      eagleLoop: { rx: 46, ry: 15 }   // over the hut, clear of the bell
    }
  };
  // The open ice below the far shore and the side banks; skate marks are clipped to it.
  var ICE_SURFACE = "M-200,790 L0,704 L90,666 L180,636 L270,612 L360,596 L440,592 L1170,592 L1250,596 L1340,614 L1430,638 L1520,670 L1600,708 L1800,800 L1800,1200 L-200,1200 Z";
  var HERO_SVGS = ["heroBack", "heroNear", "heroSkaters", "heroFront"];
  // Same test as the CSS that swaps the wide and tall titles, so the crop and the title always agree.
  var tallQuery = window.matchMedia ? window.matchMedia("(max-aspect-ratio: 3/4)") : null;
  var layout = SCENE.wide, layoutName = "";
  var rink = null;

  function applyLayout() {
    var name = (tallQuery ? tallQuery.matches : window.innerWidth / window.innerHeight <= 0.75) ? "tall" : "wide";
    if (name === layoutName) return;
    layoutName = name;
    layout = SCENE[name];
    var vb = layout.viewBox.join(" ");
    HERO_SVGS.forEach(function (id) { var s = $(id); if (s) s.setAttribute("viewBox", vb); });
    trails = []; chips = []; iceKey = "";
    // Tab goes left to right: the eagle's perch (the pine right of the hut, or the hut roof on phones) is right of the
    // bell on both crops, so it comes after the bell (it never meets the title, so painting it last changes nothing)
    var eagle = $("eagle"), bellG = $("h4-bell");
    if (eagle && bellG && bellG.nextSibling !== eagle) {
      var had = document.activeElement === eagle;
      bellG.parentNode.insertBefore(eagle, bellG.nextSibling);
      if (had) eagle.focus();
    }
    if (eagleFlight) landEagle();
  }

  /* ---------- Fitting the hero drawings to the screen ---------- */

  var view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
  function measure() {
    applyLayout();
    var r = $("heroBack").getBoundingClientRect();
    var vb = layout.viewBox;
    view.w = r.width; view.h = r.height;
    view.s = Math.max(view.w / vb[2], view.h / vb[3]);
    view.ox = (view.w - vb[2] * view.s) / 2 - vb[0] * view.s;
    view.oy = (view.h - vb[3] * view.s) / 2 - vb[1] * view.s;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    var c = $("marks");
    c.width = Math.round(view.w * view.dpr);
    c.height = Math.round(view.h * view.dpr);
    sizeSnow();
    iceClip = null;
    par.dirty = true;
    fitDogs();
    sizeHits();
    fitTitle();
    updateIce();
    if (reduceMotion) { drawStillMarks(); drawSnow(0); }
  }
  // The malamutes walk only where both are fully on screen (phones crop the sides of the scene).
  var dogRange = { x0: 430, x1: 1170 };
  function fitDogs() {
    var p = layout.dogPath, half = 62, l = (0 - view.ox) / view.s + half, r = (view.w - view.ox) / view.s - half;
    dogRange.x0 = Math.max(p.x0, l); dogRange.x1 = Math.min(p.x1, r);
    if (dogRange.x1 < dogRange.x0) dogRange.x0 = dogRange.x1 = (dogRange.x0 + dogRange.x1) / 2;
    dogs.x = Math.max(dogRange.x0, Math.min(dogRange.x1, dogs.x));
    dogs.target = dogs.x;
    placeDogs(performance.now());
  }
  // The animals are small (true to scale), but each one's invisible tap target (and the bell's) stays at least 48 px across.
  var HITS = { owl: 16, eagle: 20, parrot: 22, malamutes: 0, bell: 34 };
  var HIT_X = { parrot: 0 };   // where the parrot's target sits (it may move in from the screen's edge on narrow phones)
  function sizeHits() {
    var min = 24 / view.s, hero = $("top").getBoundingClientRect();
    for (var id in HITS) {
      var n = $(id), c = n && n.firstElementChild;
      if (!c) continue;
      if (id === "malamutes") { c.setAttribute("rx", f(Math.max(46, min))); c.setAttribute("ry", f(Math.max(19, min))); }
      else c.setAttribute("r", f(Math.max(HITS[id], min)));
      if (id in HIT_X) {
        // the phones' lamp post stands near the right edge: keep the whole target on screen
        c.setAttribute("cx", HIT_X[id]);
        var q = c.getBoundingClientRect(), over = q.right - (hero.right - 2);
        if (over > 0) c.setAttribute("cx", f(HIT_X[id] - over / view.s));
      }
      // the parrot's tap target in the back layer matches the focus ring round it
      var tap = $(id + "Tap"), tc = tap && tap.firstElementChild;
      if (tc) { tc.setAttribute("r", c.getAttribute("r")); tc.setAttribute("cx", c.getAttribute("cx") || 0); }
    }
  }

  // Fit the title banner to the screen: shrink it if the words would not fit across (they keep 18 px from both
  // screen edges), keep the navigation pills off the words, and on wide screens let the banner rise as far as the
  // pills allow (its top scallops may run under the pills or off the screen) so the mountains under it get more sky.
  var titleBoxes = [], titleBottom = 0, titlePaper = null;   // each title word, the banner's lower edge and its box, in px from the top of the lake
  function fitTitle() {
    var tall = layoutName === "tall";
    var g = document.querySelector(tall ? ".title-tall" : ".title-wide"), nav = document.querySelector(".nav");
    if (!g || !nav || !g.getBBox) return;
    // banner geometry in scene units (getBBox ignores the banner's own transforms and its drop-in animation);
    // a word's own transform (the tilted "my") is applied to its corners, so they count too
    var boxOf = function (n) {
      var q = n.getBBox(), tl = n.transform && n.transform.baseVal, m = null, r = { l: 1e9, t: 1e9, r: -1e9, b: -1e9 };
      if (tl) for (var i = 0; i < tl.numberOfItems; i++) m = m ? m.multiply(tl.getItem(i).matrix) : tl.getItem(i).matrix;
      [[q.x, q.y], [q.x + q.width, q.y], [q.x, q.y + q.height], [q.x + q.width, q.y + q.height]].forEach(function (c) {
        var x = m ? m.a * c[0] + m.c * c[1] + m.e : c[0], y = m ? m.b * c[0] + m.d * c[1] + m.f : c[1];
        r.l = Math.min(r.l, x); r.t = Math.min(r.t, y); r.r = Math.max(r.r, x); r.b = Math.max(r.b, y);
      });
      return r;
    };
    var union = function (list) {
      var r = { l: 1e9, t: 1e9, r: -1e9, b: -1e9 };
      list.forEach(function (q) { r.l = Math.min(r.l, q.l); r.t = Math.min(r.t, q.t); r.r = Math.max(r.r, q.r); r.b = Math.max(r.b, q.b); });
      return r;
    };
    var each = Array.prototype.map.call(g.querySelectorAll(".h4-letters text"), boxOf);
    var words = union(each), paper = union(Array.prototype.map.call(g.querySelectorAll(".h4-banner"), boxOf));
    if (words.r < words.l || paper.r < paper.l) return;
    var s = view.s, oy = tall ? 40 : 230;
    var px = function (y) { return view.oy + y * s; };            // scene y -> px from the top of the lake
    var navBottom = nav.getBoundingClientRect().bottom - $("top").getBoundingClientRect().top;
    // the words are scaled around the middle of the screen (scene x 800), so the wider half sets the size
    var half = view.w / s / 2 - 18 / s, k = Math.min(1, half / Math.max(800 - words.l, words.r - 800, 1)), ty = 0;
    if (tall) k = Math.min(k, (view.w / s - 24) / (paper.r - paper.l));
    for (; ; k -= 0.02) {
      // scene units: the words clear the navigation by 12 px
      var clear = (navBottom + 12 - px(oy + (words.t - oy) * k)) / s;
      if (tall) ty = Math.max(0, clear, (4 - px(oy + (paper.t - oy) * k)) / s);   // phones: the whole cloud stays on screen
      // wide screens: the banner may rise until only its top scallops tuck under the navigation pills (their lilac
      // edge keeps them distinct on the cream paper), so the summits and the lantern string below it stay in view
      else ty = Math.max(clear, -70);
      // wide screens: shrink until the banner sits above the hanging lanterns (scene y 375) and the top 38% of the screen;
      // on desktop-sized screens a little more (down to 88%) so the mountain summits under it stay in view (scene y 325)
      var bottom = oy + (paper.b - oy) * k + ty;
      if (tall || k <= 0.62 || (bottom <= 375 && px(bottom) <= view.h * 0.38 && (bottom <= 325 || view.h < 600 || k <= 0.88))) break;
    }
    g.style.transformBox = "view-box";
    g.style.transformOrigin = "800px " + oy + "px";
    g.style.transform = "translateY(" + f(ty) + "px) scale(" + f(k * 100) / 100 + ")";
    // where the words end up on the page: the snow skips them and the toast keeps clear of them
    var X = function (x) { return view.ox + (800 + (x - 800) * k) * s; }, Y = function (y) { return px(oy + (y - oy) * k + ty); };
    titleBoxes = each.map(function (q) { return { l: X(q.l), t: Y(q.t), r: X(q.r), b: Y(q.b) }; });
    titleBottom = Y(paper.b);
    titlePaper = { l: X(paper.l), t: Y(paper.t), r: X(paper.r), b: Y(paper.b) };
    // wide screens: the mountains rise until the main summit (scene y 346) sits just under the banner's scallops,
    // so the peaks read tall (the lanterns' string then hangs below the summits, not across them)
    var mt = $("h4-mtns");
    if (mt) {
      var km = tall ? 1 : Math.max(1, Math.min(1.3, (620 - (oy + (paper.b - oy) * k + ty) - 14) / (620 - 346)));
      if (km > 1.001) mt.setAttribute("transform", "matrix(1 0 0 " + Math.round(km * 1000) / 1000 + " 0 " + f(620 * (1 - km)) + ")");
      else mt.removeAttribute("transform");
    }
    placeToast();
  }

  // Keep the skaters where people can see them: inside the visible crop and above the scroll cue.
  var iceKey = "";
  function clipPolygon(pts, x0, x1, y1) {
    [function (p) { return p[0] - x0; }, function (p) { return x1 - p[0]; }, function (p) { return y1 - p[1]; }].forEach(function (d) {
      var out = [];
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length], da = d(a), db = d(b);
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) { var t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
      pts = out;
    });
    return pts.map(function (p) { return [Math.round(p[0]), Math.round(p[1])]; });
  }
  function visibleIce() {
    var ice = layout.ice, s = view.s, hero = $("top").getBoundingClientRect();
    var bottom = view.h, cue = document.querySelector(".scroll-cue");
    if (cue) bottom = Math.min(bottom, cue.getBoundingClientRect().top - hero.top - 4);
    var poly = clipPolygon(ice.icePolygon, (16 - view.ox) / s, (view.w - 16 - view.ox) / s, (bottom - view.oy) / s);
    var out = {};
    for (var k in ice) out[k] = ice[k];
    if (poly.length >= 3) out.icePolygon = poly;
    return out;
  }
  function updateIce() {
    if (!rink) return;
    var ice = visibleIce(), key = JSON.stringify(ice.icePolygon);
    if (key !== iceKey) { iceKey = key; rink.setIce(ice); }
  }

  /* ---------- Figure skaters practising axels (engine at the top of this file) ---------- */

  var SKATER_LINES = [
    "Watch: an axel attempt, just for you.",
    "One and a half turns in the air. Here goes!",
    "Back crossovers, a long glide, and... axel!",
    "Set-up, glide, jump..."
  ];
  // when the skater is busy, say what happens next instead
  var SKATER_NEXT = {
    jumping: "Watch this try! They'll go again straight after.",
    getup: "Falling is part of learning. Up again, then another axel!",
    after: "Another axel coming up next."
  };
  var skaterLine = 0, skaterKeys = [], skaterKeyFocused = false;
  function buildSkaters() {
    if (!window.createSkaterRink) return;
    var small = Math.min(window.innerWidth, window.innerHeight) < 600 || layoutName === "tall";
    var ice = visibleIce();
    iceKey = JSON.stringify(ice.icePolygon);
    rink = window.createSkaterRink({
      layer: $("skaterLayer"),
      reflLayer: $("skaterRefl"),
      ice: ice,
      count: small ? 4 : 5,
      seed: 11,
      reduceMotion: reduceMotion
    });
    // The figures are re-ordered for depth every frame, so they are not the keyboard stops: each skater gets a
    // stable, invisible button in label order that follows the figure, and lights the figure up when focused.
    var keys = el("g", { id: "skaterKeys" }, $("heroSkaters"));
    rink.elements().forEach(function (g, i) {
      var key = el("g", { "class": "skater-key", tabindex: "0", role: "button", "aria-label": "Figure skater " + (i + 1) + ": ask them to try an axel" }, keys);
      var box = el("rect", { x: 0, y: 0, width: 1, height: 1, fill: "none" }, key);
      skaterKeys.push({ key: key, box: box, at: "" });
      function go(e) {
        e.stopPropagation();
        var now = rink.trigger(i);
        discover("skater");
        say(reduceMotion ? "The skaters are resting between jumps." : (SKATER_NEXT[now] || SKATER_LINES[skaterLine++ % SKATER_LINES.length]));
      }
      g.addEventListener("click", go);
      key.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e); } });
      key.addEventListener("focus", function () {
        var vis = true;
        try { vis = key.matches(":focus-visible"); } catch (err) { /* older browsers: always show it */ }
        if (vis) g.classList.add("kb");
        skaterKeyFocused = true;
        placeSkaterKeys();
      });
      key.addEventListener("blur", function () { g.classList.remove("kb"); skaterKeyFocused = false; });
    });
    placeSkaterKeys();
  }
  function placeSkaterKeys() {
    if (!rink || !rink.boxes) return;
    rink.boxes().forEach(function (b, i) {
      var k = skaterKeys[i];
      if (!k) return;
      var at = f(b[0]) + "," + f(b[1]) + "," + f(Math.max(1, b[2] - b[0])) + "," + f(Math.max(1, b[3] - b[1]));
      if (at === k.at) return;
      k.at = at; at = at.split(",");
      k.box.setAttribute("x", at[0]); k.box.setAttribute("y", at[1]); k.box.setAttribute("width", at[2]); k.box.setAttribute("height", at[3]);
    });
  }

  /* ---------- Skate marks: glowing lines the blades carve into the ice ---------- */

  var LIFE = 8000, trails = [], chips = [], iceClip = null;
  function getIceClip() {
    if (!iceClip && window.Path2D) iceClip = new Path2D(ICE_SURFACE);
    return iceClip;
  }
  // 0 at the far edge of the skating area, 1 at the near edge: marks get wider closer to us
  function depthAt(y) {
    var ice = layout.ice;
    return Math.max(0, Math.min(1, (y - ice.farY) / (ice.nearY - ice.farY)));
  }
  function burst(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = 20 + Math.random() * 60;
      chips.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.45 - 22, t: performance.now(), color: color });
    }
  }
  // How a tracing is drawn, widest first: [width, colour ("" = the skater's own), opacity]. Mostly white and
  // silver, like lines cut into the ice, with only a faint glow in the skater's colour.
  var MARK = [[10, "", 0.12], [3.2, "226,234,255", 0.34], [1.3, "255,255,255", 0.85]];
  var SCRAPE = [[16, "255,255,255", 0.2], [6, "236,244,255", 0.45]];
  function a3(v) { return Math.round(v * 1000) / 1000; }
  // Follow each blade: a new line starts after every jump (no marks in the air) and a fall leaves a scrape.
  // A "pen" trails the blade by a few scene units, so a bump against the edge of the ice comes out as a
  // rounded turn instead of a sharp corner; its points are kept a few units apart and drawn as one smooth curve.
  var PEN = 8;
  function trackBlades(now) {
    var list = rink.blades(), gap = layoutName === "tall" ? 8 : 7;
    for (var i = 0; i < list.length; i++) {
      var b = list[i], tr = trails[i] || (trails[i] = { segs: [], cur: null, offAt: 0, on: true });
      var kind = b.scrape ? "scrape" : (b.onIce ? "blade" : "");
      if (!kind) {
        if (tr.on) { tr.on = false; tr.offAt = now; }
        tr.cur = null;
        continue;
      }
      var c = tr.cur, last = c && c.pts[c.pts.length - 1];
      if (!c || c.kind !== kind || (last && Math.abs(b.x - last.x) + Math.abs(b.y - last.y) > 60)) {
        if (!tr.on && kind === "blade" && now - tr.offAt < 1500) burst(b.x, b.y, 9, b.color); // landing
        if (kind === "scrape" && (!c || c.kind !== "scrape")) burst(b.x, b.y, 14, "255,255,255"); // a fall
        c = tr.cur = { kind: kind, color: b.color, pts: [], head: null, pen: { x: b.x, y: b.y }, bx: b.x, by: b.y };
        tr.segs.push(c);
        last = null;
      }
      tr.on = true;
      // the pen moves towards the blade by a share of the distance the blade travelled (none while standing still)
      var pen = c.pen, ds = Math.sqrt((b.x - c.bx) * (b.x - c.bx) + (b.y - c.by) * (b.y - c.by)), kp = 1 - Math.exp(-ds / PEN);
      pen.x += (b.x - pen.x) * kp; pen.y += (b.y - pen.y) * kp; c.bx = b.x; c.by = b.y;
      if (!last || Math.sqrt((pen.x - last.x) * (pen.x - last.x) + (pen.y - last.y) * (pen.y - last.y)) >= gap) c.pts.push({ x: pen.x, y: pen.y, t: now });
      c.head = { x: b.x, y: b.y, t: now };   // the live end of the line, under the boot
      if (kind === "scrape" && Math.random() < 0.35) burst(b.x, b.y, 1, "255,255,255");
    }
  }
  function beginMarks() {
    var c = $("marks"), ctx = c.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(view.s * view.dpr, 0, 0, view.s * view.dpr, view.ox * view.dpr, view.oy * view.dpr);
    ctx.save();
    var clip = getIceClip();
    if (clip) ctx.clip(clip);
    ctx.lineCap = "butt"; ctx.lineJoin = "round";
    return ctx;
  }
  // One layer of a tracing: a smooth curve through the points (quadratic pieces joined at the midpoints),
  // stroked in short runs so older parts can fade. Runs meet at a midpoint with the same direction and
  // flat ends, so they never overlap: no bright knots along the line.
  function traceLayer(ctx, P, now, spec, color) {
    var n = P.length, CH = 5, i0, i1, i, mid, fade, k;
    var style = function (q) {
      fade = Math.pow(Math.max(0, 1 - (now - q.t) / LIFE), 1.4);
      k = 0.45 + depthAt(q.y) * 0.9;
      ctx.strokeStyle = "rgba(" + (spec[1] || color) + "," + a3(spec[2] * fade) + ")";
      ctx.lineWidth = spec[0] * k;
    };
    if (n === 2) {
      style(P[0]);
      ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(P[1].x, P[1].y); ctx.stroke();
      return;
    }
    for (i0 = 1; i0 <= n - 2; i0 += CH) {
      i1 = Math.min(i0 + CH - 1, n - 2);
      mid = P[(i0 + i1) >> 1];
      style(mid);
      if (fade <= 0.002) continue;
      ctx.beginPath();
      if (i0 === 1) ctx.moveTo(P[0].x, P[0].y);
      else ctx.moveTo((P[i0 - 1].x + P[i0].x) / 2, (P[i0 - 1].y + P[i0].y) / 2);
      for (i = i0; i <= i1; i++) ctx.quadraticCurveTo(P[i].x, P[i].y, (P[i].x + P[i + 1].x) / 2, (P[i].y + P[i + 1].y) / 2);
      if (i1 === n - 2) ctx.lineTo(P[n - 1].x, P[n - 1].y);
      ctx.stroke();
    }
  }
  var marksEmpty = false;
  function drawMarks(now) {
    var any = chips.length > 0;
    for (var ti = 0; ti < trails.length && !any; ti++) if (trails[ti] && trails[ti].segs.length) any = true;
    if (!any && marksEmpty) return;   // nothing on the ice, and the canvas is already clear
    marksEmpty = !any;
    var ctx = beginMarks();
    trails.forEach(function (tr) {
      tr.segs = tr.segs.filter(function (s) {
        while (s.pts.length && now - s.pts[0].t > LIFE) s.pts.shift();
        return s.pts.length > 0 || s === tr.cur;
      });
      tr.segs.forEach(function (s) {
        var P = s.pts, h = s.head, l = P[P.length - 1];
        if (!P.length) return;
        if (h && l && Math.abs(h.x - l.x) + Math.abs(h.y - l.y) > 0.5) P = P.concat([h]);
        if (P.length < 2) return;
        var specs = s.kind === "scrape" ? SCRAPE : MARK;
        for (var pass = 0; pass < specs.length; pass++) traceLayer(ctx, P, now, specs[pass], s.color);
      });
    });
    // ice chips thrown up by landings and falls
    chips = chips.filter(function (s) { return now - s.t < 800; });
    chips.forEach(function (s) {
      var age = (now - s.t) / 1000;
      ctx.fillStyle = "rgba(" + s.color + "," + f(0.9 * (1 - age / 0.8)) + ")";
      ctx.beginPath();
      ctx.arc(s.x + s.vx * age, s.y + s.vy * age + 60 * age * age, 1.3 + depthAt(s.y), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }
  // Reduced motion: nobody moves, so draw one soft, finished curve leading to each resting skater.
  function drawStillMarks() {
    if (!rink) return;
    var ctx = beginMarks();
    ctx.lineCap = "round";
    rink.blades().forEach(function (b, i) {
      var k = 0.45 + depthAt(b.y) * 0.9, dir = i % 2 ? 1 : -1;
      var x0 = b.x + dir * 150 * k, y0 = b.y + 22 * k, cx = b.x + dir * 60 * k, cy = b.y - 30 * k;
      MARK.forEach(function (p) {
        ctx.strokeStyle = "rgba(" + (p[1] || b.color) + "," + p[2] + ")"; ctx.lineWidth = p[0] * k;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke();
      });
    });
    ctx.restore();
  }

  /* ---------- Parallax: far layers drift slower than the page, the near pines follow the pointer ---------- */

  var par = { scroll: 0, mx: 0, dirty: true };
  function applyParallax() {
    if (!par.dirty) return;
    par.dirty = false;
    var u = par.scroll / view.s;
    var set = function (id, ky, kx) { var g = $(id); if (g) g.setAttribute("transform", "translate(" + f(par.mx * kx) + "," + f(u * ky) + ")"); };
    set("h4-pSky", 0.5, 0);
    set("h4-pFar", 0.35, -3);
    set("h4-pMid", 0.2, -6);
    set("h4-pNear", 0, -8);
    set("h4-nearAnimals", 0, -8);   // the parrot stays on its lamp post
    set("h4-parrotTapP", 0, -8);
  }
  function bindParallax() {
    if (reduceMotion) return;
    window.addEventListener("scroll", function () { par.scroll = Math.min(window.scrollY, view.h); par.dirty = true; }, { passive: true });
    if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
      window.addEventListener("pointermove", function (e) { par.mx = (e.clientX / window.innerWidth) * 2 - 1; par.dirty = true; }, { passive: true });
    }
  }

  /* ---------- Snow ---------- */

  var flakes = [], wind = 0, snowDpr = 1, pageScroll = 0;
  window.addEventListener("scroll", function () { pageScroll = window.scrollY || window.pageYOffset || 0; }, { passive: true });
  // the shop signs ("ARTIFACT 2") stay clear of flakes, like the title words: their boxes in page coordinates
  var signBoxes = [];
  function measureSigns() {
    var y0 = window.scrollY || window.pageYOffset || 0;
    signBoxes = Array.prototype.map.call(document.querySelectorAll(".shop .shop-sign"), function (n) {
      var q = n.getBoundingClientRect();
      return { l: q.left, t: q.top + y0, r: q.right, b: q.bottom + y0 };
    });
  }
  // on narrow screens the shop row scrolls sideways, which moves the signs
  var streetEl = document.getElementById("street"), signsQueued = false;
  if (streetEl) streetEl.addEventListener("scroll", function () {
    if (signsQueued) return;
    signsQueued = true;
    requestAnimationFrame(function () { signsQueued = false; measureSigns(); });
  }, { passive: true });
  function sizeSnow() {
    measureSigns();
    var sc = $("snow");
    snowDpr = perf.lite ? 1 : view.dpr;
    sc.width = Math.round(window.innerWidth * snowDpr);
    sc.height = Math.round(window.innerHeight * snowDpr);
  }
  function initSnow() {
    var n = Math.min(220, Math.round((window.innerWidth * window.innerHeight) / 8000));
    if (reduceMotion) n = Math.round(n * 0.5);
    for (var i = 0; i < n; i++) {
      flakes.push({ x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.75, phase: Math.random() * 6.28, tint: Math.random() < 0.12 ? (Math.random() > 0.5 ? "255,200,230" : "170,235,255") : "255,255,255", vy: 0 });
    }
  }
  function tickSnow(now, dt) {
    wind *= 0.97;
    var W = window.innerWidth, H = window.innerHeight;
    flakes.forEach(function (fl) {
      fl.vy *= 0.97;
      fl.x += ((Math.sin(now / 2400 + fl.phase) * 12 * fl.z + wind * fl.z) * dt) / W;
      fl.y += ((16 + fl.z * 44 + fl.vy) * dt) / H;
      if (fl.y > 1.02) { fl.y = -0.02; fl.x = Math.random(); }
      if (fl.y < -0.05) fl.y = 1;
      if (fl.x > 1.02) fl.x = -0.02;
      if (fl.x < -0.02) fl.x = 1.02;
    });
    drawSnow(now);
  }
  function drawSnow(now) {
    var c = $("snow"), ctx = c.getContext("2d"), W = window.innerWidth, H = window.innerHeight;
    ctx.setTransform(snowDpr, 0, 0, snowDpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    flakes.forEach(function (fl) {
      var r = 0.7 + fl.z * 2.4;
      var a = 0.45 + fl.z * 0.45;
      if (fl.tint !== "255,255,255") a *= 0.6 + 0.4 * Math.sin((now || 0) / 300 + fl.phase);
      ctx.fillStyle = "rgba(" + fl.tint + "," + f(a) + ")";
      ctx.beginPath(); ctx.arc(fl.x * W, fl.y * H, r, 0, Math.PI * 2); ctx.fill();
    });
    // no flakes on the title words (the navigation pills sit above the snow in style.css)
    var top = -pageScroll;
    if (top + titleBottom > 0) titleBoxes.forEach(function (q) { ctx.clearRect(q.l - 3, top + q.t - 3, q.r - q.l + 6, q.b - q.t + 6); });
    // nor on the shop signs (with room above for the lift on hover)
    signBoxes.forEach(function (q) { var y = top + q.t; if (y < H && y + q.b - q.t > -12) ctx.clearRect(q.l - 3, y - 11, q.r - q.l + 6, q.b - q.t + 14); });
  }
  function gust(x) {
    if (reduceMotion) return;
    wind = (x < window.innerWidth / 2 ? 1 : -1) * (150 + Math.random() * 120);
    flakes.forEach(function (fl) { fl.vy = -30 - Math.random() * 110; });
  }

  /* ---------- Ski resort on the far mountains: chairs ride the three lifts, skiers wind down the floodlit runs ---------- */

  // It is far away, so everything is tiny and slow. It moves only while the lake does (frame() calls stepResort), all in
  // one step 10 times a second (each step repaints the slopes), and stands still under reduced motion and in lite mode:
  // chairs hang on the cables, skiers are halfway down. The ice reflects #h4-mtns, so the resort lives outside it
  // (#h4-rSki) and is drawn once; only its warm haze (#h4-resort) is part of the mountains, so the ice shows a soft glow.
  var resort = { sets: {}, t: 7, last: 0, tmp: [0, 0, 0, 0] };
  var RIDE = 5, CHAIR_GAP = 22, CAB = 1.8;    // chair speed (scene units a second), room between chairs, half the cable gap
  var SKI_INK = ["#24305e", "#24305e", "#1d1420", "#24305e", "#b8433f", "#6b4aa8"];
  var RIDER_INK = ["#24305e", "#24305e", "#b8433f", "#e0457a", "#6b4aa8", "#1d1420"];
  function resortLine(str) {
    var a = String(str || "").split(/[\s,]+/).map(Number), p = [], l = [0], i;
    for (i = 0; i + 1 < a.length; i += 2) p.push([a[i], a[i + 1]]);
    for (i = 1; i < p.length; i++) l.push(l[i - 1] + Math.sqrt(Math.pow(p[i][0] - p[i - 1][0], 2) + Math.pow(p[i][1] - p[i - 1][1], 2)));
    return { p: p, l: l, len: l[l.length - 1] || 0 };
  }
  // the point d units down a run, and the run's direction there
  function alongRun(run, d, out) {
    var l = run.l, p = run.p, i = 1;
    while (i < l.length - 1 && l[i] < d) i++;
    var seg = (l[i] - l[i - 1]) || 1, u = Math.max(0, Math.min(1, (d - l[i - 1]) / seg));
    out[2] = (p[i][0] - p[i - 1][0]) / seg; out[3] = (p[i][1] - p[i - 1][1]) / seg;
    out[0] = p[i - 1][0] + out[2] * seg * u; out[1] = p[i - 1][1] + out[3] * seg * u;
    return out;
  }
  function resortTf(o, x, y) {
    var s = "translate(" + Math.round(x * 100) / 100 + " " + Math.round(y * 100) / 100 + ")";
    if (s !== o.tf) { o.tf = s; o.e.setAttribute("transform", s); }
  }
  // a skier (or a snowboarder: slower, longer turns) leaves the top of a run
  function launchSkier(k, midway) {
    var board = Math.random() < 0.35;
    k.v = board ? 7 + Math.random() * 3 : 9 + Math.random() * 5;
    k.wave = board ? 30 + Math.random() * 14 : 15 + Math.random() * 10;
    k.amp = 0.5 + Math.random() * 0.45;
    k.ph = Math.random() * 6.283;
    k.d = midway ? k.run.len * (0.15 + Math.random() * 0.7) : 0;
    k.wait = midway ? 0 : 0.8 + Math.random() * 5;
    k.e.setAttribute("fill", SKI_INK[Math.floor(Math.random() * SKI_INK.length)]);
  }
  function buildResort() {
    var live = $("h4-rSki"), mt = $("h4-mtns");
    if (!live || !mt) return;
    // on wide screens fitTitle stretches the mountains a little taller; the chairs and skiers stretch with them
    var sync = function () { var t = mt.getAttribute("transform"); if (t) live.setAttribute("transform", t); else live.removeAttribute("transform"); };
    sync();
    if (window.MutationObserver) new MutationObserver(sync).observe(mt, { attributes: true, attributeFilter: ["transform"] });
    ["W", "T"].forEach(function (key) {
      var g = $("h4-rSki" + key), set = { chairs: [], skiers: [] };
      if (!g) return;
      // chairs: up the right-hand cable (most carry a rider), back down the left one (mostly empty)
      Array.prototype.forEach.call(g.querySelectorAll(".h4-rLift"), function (lg) {
        var b = lg.getAttribute("data-b").split(" ").map(Number), t = lg.getAttribute("data-t").split(" ").map(Number);
        var len = Math.sqrt(Math.pow(t[0] - b[0], 2) + Math.pow(t[1] - b[1], 2)), n = Math.max(4, Math.round(len / CHAIR_GAP)), gap = len / n;
        var L = { b: b, t: t, len: len, ux: (t[0] - b[0]) / len, uy: (t[1] - b[1]) / len };
        for (var i = 0; i < 2 * n; i++) {
          var up = i < n, c = { lift: L, up: up, o: (i % n) * gap + (up ? 0 : gap / 2), lap: 0, rider: Math.random() < (up ? 0.7 : 0.12), tf: "" };
          c.e = el("use", { href: c.rider ? "#h4-rChairR" : "#h4-rChair", fill: RIDER_INK[i % RIDER_INK.length] }, lg);
          set.chairs.push(c);
        }
      });
      // skiers: two to a run, spread out so a few are always on the way down
      var sk = g.querySelector(".h4-rSkiers");
      (g.getAttribute("data-runs") || "").split(" ").forEach(function (id) {
        var path = $(id);
        if (!path || !sk) return;
        var run = resortLine(path.getAttribute("data-c")), w = (path.getAttribute("data-w") || "3 7").split(" ").map(Number);
        if (!(run.len > 0)) return;
        run.w0 = w[0]; run.w1 = w[1];
        for (var i = 0; i < 2; i++) {
          var k = { run: run, tf: "", op: -1, e: el("circle", { r: 1.6 }, sk) };
          launchSkier(k, true);
          if (i) k.d = (k.d + run.len / 2) % run.len;
          set.skiers.push(k);
        }
      });
      resort.sets[key] = set;
      moveResort(set, 0);
    });
    sizeResort();
    window.addEventListener("resize", function () { setTimeout(sizeResort, 0); });   // after measure() has picked the crop
  }
  // about 2.5 px dots and readable chairs at every screen size
  function sizeResort() {
    var m = $("heroBack") && $("heroBack").getScreenCTM && $("heroBack").getScreenCTM(), s = m && m.a > 0 ? m.a : 1;
    var r = String(Math.round(Math.max(1.3, Math.min(2.4, 1.25 / s)) * 100) / 100), k = Math.max(1, Math.min(1.5, 0.7 / s));
    for (var key in resort.sets) resort.sets[key].skiers.forEach(function (q) { q.e.setAttribute("r", r); });
    ["h4-rChair", "h4-rChairR"].forEach(function (id) { var c = $(id); if (c) c.setAttribute("transform", "scale(" + Math.round(k * 100) / 100 + ")"); });
  }
  function moveResort(set, dt) {
    var i, a = resort.tmp;
    for (i = 0; i < set.chairs.length; i++) {
      var c = set.chairs[i], L = c.lift, q = c.o + RIDE * resort.t, lap = Math.floor(q / L.len);
      q -= lap * L.len;
      if (lap !== c.lap) {   // round the bullwheel inside a station: someone may board (or stay on)
        c.lap = lap;
        var r = Math.random() < (c.up ? 0.7 : 0.12);
        if (r !== c.rider) { c.rider = r; c.e.setAttribute("href", r ? "#h4-rChairR" : "#h4-rChair"); }
        if (r) c.e.setAttribute("fill", RIDER_INK[Math.floor(Math.random() * RIDER_INK.length)]);
      }
      if (c.up) resortTf(c, L.b[0] + L.ux * q + CAB, L.b[1] + L.uy * q);
      else resortTf(c, L.t[0] - L.ux * q - CAB, L.t[1] - L.uy * q);
    }
    for (i = 0; i < set.skiers.length; i++) {
      var k = set.skiers[i], run = k.run;
      if (k.wait > 0) { k.wait -= dt; if (k.op !== 0) { k.op = 0; k.e.setAttribute("opacity", "0"); } continue; }
      k.d += k.v * dt;
      if (k.d >= run.len) { launchSkier(k, false); continue; }
      alongRun(run, k.d, a);
      // gentle S-turns across the run, never past its edges
      var u = k.d / run.len, hw = (run.w0 + (run.w1 - run.w0) * Math.pow(u, 0.9)) / 2 - 0.9;
      var off = Math.max(0, hw) * k.amp * Math.sin(k.d / k.wave * 6.283 + k.ph);
      resortTf(k, a[0] - a[3] * off, a[1] + a[2] * off);
      // fade in below the top station, out where the run disappears into the trees
      var op = Math.round(Math.max(0, Math.min(1, k.d / 6, (run.len - k.d) / 10)) * 10) / 10;
      if (op !== k.op) { k.op = op; k.e.setAttribute("opacity", String(op)); }
    }
  }
  function stepResort(now) {
    if (perf.lite) { resort.last = now; return; }   // lite mode: a still picture
    var ms = now - resort.last;
    if (ms < 96) return;
    resort.last = now;
    var dt = Math.min(ms, 120) / 1000, set = resort.sets[layoutName === "tall" ? "T" : "W"];
    resort.t += dt;
    if (set) moveResort(set, dt);
  }

  /* ---------- Main loop ---------- */

  // The lake only animates while it is on screen; the falling snow keeps going over the village.
  var heroVisible = true, lastFrame = 0;
  // Lite mode for slow devices, keyed on real frame time (requestAnimationFrame intervals, so canvas and paint
  // work count, not only the skaters' own code): on when the median frame over ~1.5 s is slower than 25 fps,
  // off again only above ~45 fps (so it does not flip back and forth). It keeps the look: the skaters' faint
  // reflections refresh less often, the snow is drawn at 1x, the skate marks every other frame, the lanterns stop flickering.
  var perf = { d: [], n: 0, lite: false, odd: false };
  function watchFrames(ms) {
    if (!(ms > 0) || ms > 250) return;        // first frame, or back from another tab
    perf.d.push(ms); if (perf.d.length > 90) perf.d.shift();
    if (++perf.n % 30 || perf.d.length < 45) return;
    var med = perf.d.slice().sort(function (a, b) { return a - b; })[perf.d.length >> 1];
    if (perf.lite ? med < 22 : med > 40) setLite(!perf.lite);
  }
  function setLite(on) {
    perf.lite = on; perf.d.length = 0;
    document.documentElement.classList.toggle("lite", on);
    if (rink && rink.setLite) rink.setLite(on ? true : null);
    sizeSnow();
  }
  function watchHero() {
    if (!window.IntersectionObserver) return;
    // the top edge of the screen is moved down 1 px, so a lake whose bottom edge only touches the top of the screen
    // (the page parked at the village, where "Visit the village" and "Artifacts" land) counts as hidden
    new IntersectionObserver(function (entries) { heroVisible = entries[entries.length - 1].isIntersecting; }, { rootMargin: "-1px 0px 0px 0px" }).observe($("top"));
  }
  function frame(now) {
    var ms = lastFrame ? now - lastFrame : 0, dt = lastFrame ? Math.min(ms / 1000, 0.05) : 0.016;
    lastFrame = now;
    var inShop = document.documentElement.classList.contains("in-shop");
    // also checked against the scroll position: inside a cross-origin frame the observer ignores rootMargin
    if (heroVisible && !inShop && (window.scrollY || window.pageYOffset || 0) < view.h - 0.5) {
      watchFrames(ms);
      if (rink) { rink.step(now); trackBlades(now); if (skaterKeyFocused) placeSkaterKeys(); }
      perf.odd = !perf.odd;
      if (!perf.lite || perf.odd) drawMarks(now);
      stepAnimals(now);
      stepResort(now);
      applyParallax();
    }
    if (!inShop) tickSnow(now, dt);   // an open shop covers the whole screen
  }

  /* ---------- The animals: drawn true to scale for where they stand, with small, calm movements ---------- */

  // Each drawing is in centimetres inside a group scaled to its distance (see index.html and style.css).
  // setT() only touches a part when its transform really changes (resting animals cost nothing to draw);
  // rot() turns a part round a point of its own drawing.
  var lastT = {};
  function setT(id, t) { if (lastT[id] === t) return; var n = $(id); if (n) { n.setAttribute("transform", t); lastT[id] = t; } }
  function rot(id, deg, x, y) { setT(id, Math.abs(deg) > 0.05 ? "rotate(" + f(deg) + " " + x + " " + y + ")" : ""); }
  // a gentle ease in and out between 0 and 1
  function ease(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  // Two malamutes walk the edge of the ice together, stop for a while (a sniff, a slow wag), and turn back.
  var dogs = { x: 780, dir: 1, target: 780, restUntil: 0, wagUntil: 0, phase: 0, sniffAt: 0, sniffUntil: 0 };
  function placeDogs(now) {
    var node = $("malamutes"), pair = $("malPair");
    if (!node || !pair) return;
    setT("malamutes", "translate(" + f(dogs.x) + "," + layout.dogPath.y + ")");
    setT("malPair", dogs.dir < 0 ? "scale(-1,1)" : "");
    var hit = node.firstElementChild;
    if (hit && +hit.getAttribute("cx") !== 22 * dogs.dir) hit.setAttribute("cx", 22 * dogs.dir);
    var walking = dogs.target !== dogs.x && !reduceMotion, wag = now < dogs.wagUntil;
    ["mal1", "mal2"].forEach(function (p, i) {
      var ph = dogs.phase + i * 1.4, a = walking ? Math.sin(ph) * 17 : 0;
      rot(p + "Lf1", a, 23, -42); rot(p + "Lh2", a * 0.8, -20, -46);
      rot(p + "Lf2", -a, 17, -42); rot(p + "Lh1", -a * 0.8, -26, -46);
      // tails: a slow sway, a happy fast wag when tapped
      var t = reduceMotion ? 0 : (wag ? Math.sin(now / 55 + i) * 16 : Math.sin(now / (walking ? 260 : 520) + i * 2) * (walking ? 7 : 4));
      rot(p + "Tail", t, -33, -58);
      // heads: up and looking our way while wagging, now and then a sniff at the snow while resting
      var h = 0;
      if (wag) h = -9 * ease((now - (dogs.wagUntil - 2600)) / 300);
      else if (!walking && i === (dogs.sniffAt & 1) && now < dogs.sniffUntil) h = 16 * Math.sin(Math.PI * Math.min(1, (dogs.sniffUntil - now) / 1800));
      rot(p + "Head", h, 24, -58);
    });
  }
  function stepDogs(now, dt) {
    var p = dogRange;
    if (dogs.target === dogs.x) {
      if (now > dogs.restUntil) {
        // pick somewhere new along the visible shore, a good walk away
        var t = p.x0 + Math.random() * (p.x1 - p.x0), far = Math.min(160, (p.x1 - p.x0) / 3);
        if (Math.abs(t - dogs.x) < far) t = dogs.x < (p.x0 + p.x1) / 2 ? p.x1 - Math.random() * far / 2 : p.x0 + Math.random() * far / 2;
        dogs.target = t;
        dogs.dir = t > dogs.x ? 1 : -1;
      } else if (now > dogs.sniffUntil + 2500 && Math.random() < dt * 0.25) {
        dogs.sniffAt++; dogs.sniffUntil = now + 1800;
      }
    } else {
      var step = 26 * dt * dogs.dir;
      dogs.phase += dt * 6.2;
      if (Math.abs(dogs.target - dogs.x) <= Math.abs(step)) { dogs.x = dogs.target; dogs.restUntil = now + 6000 + Math.random() * 9000; }
      else dogs.x += step;
    }
    placeDogs(now);
  }

  // The eagle looks round now and then; tapped, it lifts off, circles once and lands back on its perch.
  var eagle = { lookFrom: 0, lookUntil: 0, nextLook: 4000, ruffleAt: 9000 }, eagleFlight = null;
  function stepEagle(now) {
    if (eagleFlight) { flyEagle(now); return; }
    if (now > eagle.nextLook) { eagle.lookFrom = now; eagle.lookUntil = now + 1800 + Math.random() * 1800; eagle.nextLook = eagle.lookUntil + 4000 + Math.random() * 6000; }
    // looking back over its shoulder: the white head turns round its neck
    var k = now < eagle.lookUntil ? ease(Math.min(now - eagle.lookFrom, eagle.lookUntil - now) / 350) : 0;
    setT("eagleHead", k > 0.001 ? "translate(" + f(16 * k) + " 0) scale(" + f((1 - 2 * k) * 100) / 100 + " 1)" : "");
    // a feather ruffle: the folded wing lifts a little and settles
    var r = now - eagle.ruffleAt;
    if (r > 700) { eagle.ruffleAt = now + 9000 + Math.random() * 9000; r = 0; }
    rot("eagleWing", r > 0 ? -5 * Math.sin(Math.PI * r / 700) : 0, 0, -48);
  }
  // How big the eagle is, in scene units per centimetre of its drawing: a far-off speck on the wide crop, a little
  // bigger on the hut roof on phones (style.css sets the perched size to match).
  function eagleK() { return layoutName === "tall" ? 0.25 : 0.15; }
  function eagleHome() {
    // the perch in scene units (style.css sets it: the tip of a shore pine away from the lifts, or the hut's roof ridge on phones)
    return layoutName === "tall" ? { x: 955, y: 466, face: -1 } : { x: 1134, y: 457, face: -1 };
  }
  function liftEagle(now) {
    if (eagleFlight || reduceMotion) return;
    eagleFlight = { t0: now, dur: 5600, last: now, fa: eagleHome().face };
    $("eagleSit").setAttribute("display", "none");
    $("eagleFly").setAttribute("display", "inline");
    flyEagle(now);
  }
  function landEagle() {
    eagleFlight = null;
    var sit = $("eagleSit"), fly = $("eagleFly");
    if (sit) sit.setAttribute("display", "inline");
    if (fly) fly.setAttribute("display", "none");
  }
  // Where the middle of the flying eagle is t (0..1) into its flight, relative to its feet on the perch: one lap round
  // a small ellipse that stands on the perch, starting in the direction the eagle faces and quickest in the middle.
  // The lap is one smooth curve, so it only turns round at the two ends of the ellipse (never at take-off or landing).
  function eaglePath(t) {
    var P = eagleHome(), L = layout.eagleLoop, y0 = -30 * eagleK();
    var s = t + (ease(t) - t) * 0.65, a = Math.PI / 2 - P.face * 2 * Math.PI * s;
    return { x: L.rx * Math.cos(a), y: y0 - L.ry + L.ry * Math.sin(a) };
  }
  function flyEagle(now) {
    var fly = $("eagleFly"), F = eagleFlight, t = (now - F.t0) / F.dur;
    if (t >= 1 || !fly) { landEagle(); return; }
    var p = eaglePath(t), q = eaglePath(Math.min(1, t + 0.01)), vx = q.x - p.x, vy = q.y - p.y, k = eagleK();
    // it faces where it flies: it swings round through edge-on over about a tenth of a second at each end of the lap
    // (one smooth turn, not a jump) and keeps its facing while it hardly moves sideways
    var want = vx > 0.02 ? 1 : (vx < -0.02 ? -1 : (F.want || F.fa));
    F.want = want;
    F.fa += (want - F.fa) * (1 - Math.exp(-Math.min(0.1, (now - F.last) / 1000) / 0.06));
    F.last = now;
    // big wingbeats on the way up and down, a long glide round the circle with a few easy beats; the nose follows the climb
    var beat = t < 0.2 || t > 0.82 || (t > 0.45 && t < 0.53), a = beat ? -85 + 62 * Math.sin(now / 75) : -58 + 4 * Math.sin(now / 420);
    var pitch = Math.max(-14, Math.min(14, Math.atan2(-vy, Math.max(Math.abs(vx), 0.001)) * 57.3)) * Math.max(-1, Math.min(1, F.fa * 3));
    setT("eagleFly", "translate(" + f(p.x) + " " + f(p.y) + ") scale(" + f(F.fa * k * 100) / 100 + " " + f(k * 100) / 100 + ") rotate(" + f(-pitch) + ")");
    setT("eagleWingN", "translate(-1 -6) rotate(" + f(a) + ")");
    setT("eagleWingF", "translate(3 -9) rotate(" + f(a + 16) + ")");
  }
  // the box the eagle's flight covers, in scene units (the toast keeps clear of it)
  function eagleLoopBox() {
    var L = layout.eagleLoop, P = eagleHome();
    return [P.x - L.rx - 28, P.y - 30 * eagleK() - 2 * L.ry - 26, P.x + L.rx + 28, P.y + 10];
  }

  // The parrot tilts its head now and then; tapped, it bobs up and down.
  var parrot = { tiltFrom: 0, tiltUntil: 0, nextTilt: 2500, tilt: 12, bobUntil: 0 };
  function stepParrot(now) {
    if (now > parrot.nextTilt) {
      parrot.tiltFrom = now;
      parrot.tiltUntil = now + 1400 + Math.random() * 1400;
      parrot.nextTilt = parrot.tiltUntil + 2500 + Math.random() * 4500;
      parrot.tilt = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 8);
    }
    var k = now < parrot.tiltUntil ? ease(Math.min(now - parrot.tiltFrom, parrot.tiltUntil - now) / 260) : 0;
    var bob = now < parrot.bobUntil ? Math.abs(Math.sin((parrot.bobUntil - now) / 1400 * 4 * Math.PI)) : 0;
    rot("parrotHead", parrot.tilt * k + bob * 14, -1, -19);
    setT("parrotBody", bob > 0.01 ? "translate(0 " + f(-3 * bob) + ")" : "");
    rot("parrotTail", bob ? -8 * bob : 0, 2, -5);
  }

  // They are small and far away, so about 30 steps a second look just as smooth and cost fewer repaints of the
  // big back layer; only the flying eagle (it moves the furthest) keeps every frame.
  var animalsLast = 0;
  function stepAnimals(now) {
    var ms = now - animalsLast;
    if (eagleFlight) stepEagle(now);
    if (ms >= 0 && ms < 25) return;
    animalsLast = now;
    stepDogs(now, Math.min(ms / 1000, 0.07));
    if (!eagleFlight) stepEagle(now);
    stepParrot(now);
  }

  /* ---------- Secrets ---------- */

  var SECRETS = ["bell", "owl", "malamutes", "eagle", "parrot", "skater"];
  var SPOTS = ["eagle", "owl", "malamutes", "bell", "parrot"];   // the secrets you tap in the scene (the skaters have their own keys)
  var SPOT_ART = { eagle: ".eagle-art", owl: "#owl > g", malamutes: "#malPair", parrot: ".parrot-art" };   // the animals' drawings
  var found = {};
  try { found = JSON.parse(localStorage.getItem("nic-village-found") || "{}") || {}; } catch (e) { found = {}; }
  var toastTimer;
  // Park the toast where it hides the least. It never covers the title words, the navigation pills, the bell, the
  // animal that was just found (and the eagle's flight) or the scroll cue, and it stays below the title. It covers as
  // little as it can of the owl, the malamutes, the eagle, the parrot and the bell, the hut, the chairlifts,
  // the skaters (where they are now, and the ice they will skate across) and the banner. It tries a grid of spots:
  // under the banner in the middle first, then the sides and lower down.
  function placeToast() {
    var t = $("toast"), hero = $("top");
    if (!t || !hero) return;
    var hr = hero.getBoundingClientRect(), W = hero.clientWidth, H = hero.clientHeight, s = view.s;
    var rel = function (n, pad) { var q = n.getBoundingClientRect(); pad = pad || 0; return { l: q.left - hr.left - pad, r: q.right - hr.left + pad, t: q.top - hr.top - pad, b: q.bottom - hr.top + pad }; };
    var scene = function (l, tp, r, b, pad) { pad = pad || 0; return { l: view.ox + l * s - pad, t: view.oy + tp * s - pad, r: view.ox + r * s + pad, b: view.oy + b * s + pad }; };
    var hard = titleBoxes.slice(), soft = [], navB = 0, wordsB = 0, hot = toastFor && $(toastFor);
    titleBoxes.forEach(function (q) { wordsB = Math.max(wordsB, q.b); });
    Array.prototype.forEach.call(document.querySelectorAll(".nav .logo, .nav nav, .nav .found"), function (n) { var q = rel(n, 4); hard.push(q); navB = Math.max(navB, q.b); });
    var bell = document.querySelector("#bell .bell-body");
    if (bell) hard.push(rel(bell, 8));
    // the other animals by their drawings and the bell by its hit area, with room round them (a far animal's tap target
    // is much bigger than its drawing, and the toast lets taps through); the one just found by its whole tap target
    SPOTS.forEach(function (id) {
      var n = SPOT_ART[id] ? document.querySelector(SPOT_ART[id]) : $(id), q;
      if (n && !SPOT_ART[id]) n = n.firstElementChild || n;
      q = n && rel(n, 12);
      if (q && q.r - q.l > 24) soft.push([q, 8]);
    });
    if (hot) hard.push(rel(hot.firstElementChild || hot, 10));
    if (toastFor === "eagle" && eagleFlight) { var e = eagleLoopBox(); hard.push(scene(e[0], e[1], e[2], e[3], 6)); }
    soft.push([scene(875, 425, 1035, 600, 4), 3]);                     // the hut
    // the three chairlifts on the far slopes (the crop that is not drawn has no size)
    Array.prototype.forEach.call(document.querySelectorAll("#h4-rSki .h4-rLift"), function (n) { var q = rel(n, 4); if (q.r - q.l > 8) soft.push([q, 2]); });
    if (rink && rink.boxes) rink.boxes().forEach(function (b) { soft.push([scene(b[0], b[1], b[2], b[3], 8), 3]); });
    soft.push([scene(-1e4, layout.ice.farY - layout.ice.skaterHeightFar, 1e4, 1e4), 0.4]);   // the ice, from the far skaters' heads down
    if (titlePaper) soft.push([titlePaper, 1]);
    var cue = document.querySelector(".scroll-cue"), cueT = cue ? rel(cue).t : H;
    var iceT = view.oy + (layout.ice.farY - layout.ice.skaterHeightFar) * s;
    var spot = function (offIce) {
      var tw = Math.min(t.offsetWidth, W - 8), th = t.offsetHeight;
      var over = function (q, l, top) { return Math.max(0, Math.min(l + tw, q.r) - Math.max(l, q.l)) * Math.max(0, Math.min(top + th, q.b) - Math.max(top, q.t)); };
      var top0 = Math.max(navB + 4, wordsB + 8), top1 = cueT - th - 8, pref = Math.max(top0, titleBottom + 10);
      var tops = [pref], step = Math.max(8, th / 3);
      for (var y = top0; y <= top1; y += step) tops.push(y);
      var side = Math.max(0, W / 2 - 16 - tw / 2), mids = [W / 2, W / 2 - side, W / 2 + side, W / 2 - side / 2, W / 2 + side / 2];
      var best = null, bestCost = 1e18;
      tops.forEach(function (top) {
        if (offIce && top + th > iceT) return;
        mids.forEach(function (cx) {
          var l = cx - tw / 2, cost = 0, bad = 0;
          hard.forEach(function (q) { bad += over(q, l, top); });
          soft.forEach(function (q) { cost += q[1] * over(q[0], l, top); });
          if (top < top0 || top > top1) bad += 1e4;
          cost += 1e4 * bad + 4 * Math.abs(cx - W / 2) + 2 * Math.abs(top - pref);   // otherwise, under the banner in the middle
          if (cost < bestCost - 0.5) { best = [cx, top, bad]; bestCost = cost; }
        });
      });
      return best && { cx: best[0], top: best[1], cost: bestCost, clean: !best[2], onIce: best[1] + th > iceT };
    };
    // On short screens the cheapest spot can be down on the ice, where the skaters would skate under it. Then it takes
    // the best clear spot off the ice instead, on one line or on two (beside the bell), even if that hides a little of
    // a lift or another animal for those few seconds.
    t.style.maxWidth = "";
    var best = spot(), one, two;
    if (best && best.onIce) {
      one = spot(true);
      t.style.maxWidth = Math.ceil(t.offsetWidth * 0.6) + "px";
      two = spot(true);
      if (two && two.clean && !(one && one.clean && one.cost <= two.cost)) best = two;
      else { t.style.maxWidth = ""; if (one && one.clean) best = one; }
    }
    if (best) { t.style.left = Math.round(best.cx) + "px"; t.style.top = Math.round(best.top) + "px"; }
  }
  var toastFor = "";   // the secret the toast is about: it never covers that one
  function say(text, about) {
    var t = $("toast");
    toastFor = about || "";
    t.textContent = text;
    placeToast();
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 4500);
  }
  function updateFound() {
    var n = SECRETS.filter(function (k) { return found[k]; }).length;
    $("foundCount").textContent = n;
    if (n === SECRETS.length) { $("found").classList.add("all"); $("found").innerHTML = "All <b>" + n + "</b> found"; }
  }
  function discover(id) {
    if (!found[id]) {
      found[id] = true;
      try { localStorage.setItem("nic-village-found", JSON.stringify(found)); } catch (e) { /* storage off */ }
      updateFound();
    }
  }
  var PARROT_LINES = ["\u201CNice axel!\u201D", "\u201CHello, skaters!\u201D", "\u201CPretty bird!\u201D"], parrotLine = 0;
  var actions = {
    owl: function () {
      var h = $("owlHead"); h.classList.add("turn");
      setTimeout(function () { h.classList.remove("turn"); }, 1600);
      say("The owl has been watching the skaters all evening.", "owl");
    },
    malamutes: function () {
      // they stop where they are and wag (and walk on after a little rest)
      var now = performance.now();
      dogs.target = dogs.x; dogs.wagUntil = now + 2600; dogs.restUntil = now + 4000; dogs.sniffUntil = 0;
      placeDogs(now);
      say(reduceMotion ? "Two malamutes in matching purple scarves say hello." : "Two malamutes in matching purple scarves stop to wag hello.", "malamutes");
    },
    eagle: function () {
      liftEagle(performance.now());
      say(reduceMotion ? "A bald eagle keeps watch over the lake." :
        "The eagle lifts off, circles once and lands back on " + (layoutName === "tall" ? "the hut roof." : "its pine."), "eagle");
    },
    parrot: function () {
      parrot.bobUntil = performance.now() + 1400;
      say((reduceMotion ? "The parrot chirps: " : "The parrot bobs and chirps: ") + PARROT_LINES[parrotLine++ % PARROT_LINES.length], "parrot");
    },
    bell: function () {
      var b = $("bell");
      b.classList.remove("ringing"); void b.getBBox(); b.classList.add("ringing");
      music.toggle();
    }
  };
  function bindSecrets() {
    SPOTS.forEach(function (id) {
      var node = $(id), tap = $(id + "Tap");
      function go(e) { e.stopPropagation(); actions[id](); discover(id); }
      node.addEventListener("click", go);
      node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e); } });
      // a tap target of its own under the skaters (the parrot's): it answers taps and lights the drawing up on hover
      if (tap) {
        tap.addEventListener("click", go);
        tap.addEventListener("mouseenter", function () { node.classList.add("hover"); });
        tap.addEventListener("mouseleave", function () { node.classList.remove("hover"); });
      }
    });
    $("heroBack").addEventListener("click", function (e) { gust(e.clientX); });
    updateFound();
  }

  /* ---------- Music box (generated in the browser, original tune) ---------- */

  var music = (function () {
    var NOTE = { D3: 50, "F#3": 54, G3: 55, A3: 57, B3: 59, "C#4": 61, D4: 62, E4: 64, "F#4": 66, G4: 67, A4: 69, B4: 71, "C#5": 73, D5: 74, E5: 76, "F#5": 78, G5: 79, A5: 81, B5: 83, D6: 86 };
    var melody = [
      ["A5", 1], ["F#5", 1], ["D5", 1], ["E5", 1.5], ["F#5", 0.5], ["E5", 1],
      ["D5", 1], ["F#5", 1], ["B5", 1], ["A5", 2], ["G5", 1],
      ["F#5", 1], ["A5", 1], ["D6", 1], ["B5", 1.5], ["A5", 0.5], ["G5", 1],
      ["E5", 1], ["F#5", 1], ["G5", 1], ["A5", 3],
      ["A5", 1], ["B5", 0.5], ["A5", 0.5], ["F#5", 1], ["E5", 1], ["C#5", 1], ["E5", 1],
      ["F#5", 1], ["D5", 1], ["B4", 1], ["C#5", 1.5], ["D5", 0.5], ["E5", 1],
      ["D5", 1], ["B4", 1], ["G5", 1], ["F#5", 2], ["A5", 1],
      ["G5", 1], ["E5", 1], ["C#5", 1], ["D5", 3]
    ];
    var chords = [
      ["D3", "F#4", "A4"], ["A3", "E4", "C#5"], ["B3", "D4", "F#4"], ["G3", "D4", "B4"],
      ["D3", "F#4", "A4"], ["G3", "D4", "B4"], ["A3", "E4", "C#5"], ["A3", "E4", "G4"],
      ["D3", "F#4", "A4"], ["A3", "E4", "C#5"], ["B3", "D4", "F#4"], ["F#3", "C#4", "A4"],
      ["G3", "D4", "B4"], ["D3", "F#4", "A4"], ["A3", "E4", "G4"], ["D3", "F#4", "A4"]
    ];
    var beat = 60 / 88;
    var ctx, master, delay, playing = false, timer, noteTimer, nextTime = 0, step = 0, events = [];
    function freq(n) { return 440 * Math.pow(2, (NOTE[n] - 69) / 12); }
    function ping(n, when, vol, len) {
      var fr = freq(n);
      [[1, 1], [4.02, 0.12], [2, 0.18]].forEach(function (p) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = fr * p[0];
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(vol * p[1], when + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, when + len / (p[0] > 1 ? 2.5 : 1));
        o.connect(g); g.connect(master); g.connect(delay);
        o.start(when); o.stop(when + len + 0.05);
      });
    }
    function schedule() {
      while (nextTime < ctx.currentTime + 0.4) {
        var bl = step % 48;
        events.forEach(function (e) { if (e.at >= bl && e.at < bl + 0.5) ping(e.n, nextTime + (e.at - bl) * beat, 0.16, 2.2); });
        if (bl % 1 === 0) {
          var c = chords[Math.floor(bl / 3) % 16], pos = bl % 3;
          if (pos === 0) ping(c[0], nextTime, 0.11, 2.6);
          else { ping(c[1], nextTime, 0.035, 1.2); ping(c[2], nextTime, 0.035, 1.2); }
        }
        nextTime += beat * 0.5; step += 0.5;
      }
    }
    function floatNote() {
      if (!playing || reduceMotion) return;
      var t = el("text", { x: f(10 + Math.random() * 14), y: 10, class: "note" }, $("notes"));
      t.textContent = Math.random() > 0.5 ? "♪" : "♫";
      setTimeout(function () { t.remove(); }, 3700);
    }
    function start() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { say("This browser can't play the music box."); return; }
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0;
        var tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 5200;
        master.connect(tone); tone.connect(ctx.destination);
        delay = ctx.createDelay(); delay.delayTime.value = beat * 0.75;
        var fb = ctx.createGain(); fb.gain.value = 0.32;
        var wet = ctx.createGain(); wet.gain.value = 0.22;
        delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
        var t = 0;
        events = melody.map(function (m) { var e = { n: m[0], at: t }; t += m[1]; return e; });
      }
      ctx.resume();
      playing = true;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.5);
      nextTime = ctx.currentTime + 0.1; step = 0;
      timer = setInterval(schedule, 100); schedule();
      noteTimer = setInterval(floatNote, 1300);
      setState(true);
      say("Music on. Ring the bell again to stop.");
    }
    function stop() {
      playing = false;
      clearInterval(timer); clearInterval(noteTimer);
      if (ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
        setTimeout(function () { if (!playing) ctx.suspend(); }, 2600);
      }
      setState(false);
      say("Music off.");
    }
    function setState(on) {
      var b = $("bell");
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.setAttribute("aria-label", on ? "Golden bell: stop music" : "Golden bell: play music");
    }
    return { toggle: function () { playing ? stop() : start(); } };
  })();

  /* ---------- Shops: one for each card ---------- */

  var ART = {
    mountain:
      '<path d="M8,64 L36,26 L50,42 L66,18 L96,64 Z" fill="#cfe3ff"/>' +
      '<path d="M66,18 L74,30 L68,28 L62,34 L58,28 Z M36,26 L42,34 L36,32 L31,36 Z" fill="#ffffff"/>' +
      '<path d="M4,64 H116" stroke="#7be3ff" stroke-width="1.6"/>' +
      '<path d="M14,74 Q60,66 106,74 M30,82 Q60,76 90,82" stroke="#7be3ff" stroke-width="1.2" fill="none" opacity=".8"/>' +
      '<path d="M40,78 C55,70 80,72 72,79 C66,84 50,82 58,76" stroke="#ffffff" stroke-width="1.2" fill="none"/>' +
      '<path d="M100,40 L101.5,44 L106,45 L101.5,46.5 L100,51 L98.5,46.5 L94,45 L98.5,44 Z" fill="#fff2c8"/>',
    tracker:
      '<rect x="14" y="10" width="92" height="70" rx="8" fill="rgba(255,255,255,.08)" stroke="#d8e0f2" stroke-width="1.2"/>' +
      '<path d="M26,66 H94" stroke="#d8e0f2" stroke-opacity=".5"/>' +
      '<rect x="30" y="52" width="9" height="14" rx="2" fill="#7be3ff"/>' +
      '<rect x="45" y="46" width="9" height="20" rx="2" fill="#c79be6"/>' +
      '<rect x="60" y="40" width="9" height="26" rx="2" fill="#e0457a"/>' +
      '<rect x="75" y="30" width="9" height="36" rx="2" fill="#f2b83f"/>' +
      '<path d="M34,48 L49,42 L64,35 L79,24" stroke="#fff2c8" stroke-width="1.5" fill="none" stroke-dasharray="3 3"/>' +
      '<path d="M79,15 L81,20 L86,20 L82,23 L84,28 L79,25 L74,28 L76,23 L72,20 L77,20 Z" fill="#fff2c8"/>',
    coach:
      '<g stroke="#7be3ff" stroke-width="1.8" fill="none" stroke-linecap="round"><path d="M60,74 L61,56 L59,40 L76,30 M59,40 L44,30 L30,22 M76,30 L90,28 M75,31 L66,20"/></g>' +
      '<g fill="#fff2c8"><circle cx="60" cy="74" r="2.6"/><circle cx="61" cy="56" r="2.6"/><circle cx="59" cy="40" r="2.6"/><circle cx="76" cy="30" r="2.6"/><circle cx="44" cy="30" r="2.6"/><circle cx="30" cy="22" r="2.6"/><circle cx="90" cy="28" r="2.6"/><circle cx="66" cy="20" r="2.6"/></g>' +
      '<circle cx="82" cy="24" r="4" fill="none" stroke="#fff2c8" stroke-width="1.4"/>' +
      '<path d="M60,80 V8" stroke="#f2b83f" stroke-dasharray="3 4" stroke-width="1"/>' +
      '<path d="M60,58 A18,18 0 0 0 46,48" stroke="#e0457a" stroke-width="1.6" fill="none"/>',
    language:
      '<path d="M14,16 H70 Q76,16 76,22 V46 Q76,52 70,52 H34 L24,62 V52 H20 Q14,52 14,46 V22 Q14,16 20,16 Z" fill="rgba(199,155,230,.35)" stroke="#c79be6" stroke-width="1.6"/>' +
      '<text x="45" y="42" text-anchor="middle" font-family="Unbounded, Arial Black, sans-serif" font-size="17" font-weight="800" fill="#fff2c8">Aa</text>' +
      '<path d="M50,40 H100 Q106,40 106,46 V66 Q106,72 100,72 H96 V80 L88,72 H56 Q50,72 50,66 V46 Q50,40 56,40 Z" fill="rgba(123,227,255,.25)" stroke="#7be3ff" stroke-width="1.6"/>' +
      '<text x="78" y="62" text-anchor="middle" font-family="Nunito, sans-serif" font-size="15" font-weight="800" fill="#ffffff">Hi!</text>',
    calendar:
      '<rect x="16" y="14" width="88" height="66" rx="8" fill="rgba(255,255,255,.08)" stroke="#d8e0f2" stroke-width="1.2"/>' +
      '<path d="M16,30 H104" stroke="#d8e0f2" stroke-opacity=".6"/>' +
      '<path d="M36,8 V20 M84,8 V20" stroke="#f2b83f" stroke-width="2.4" stroke-linecap="round"/>' +
      (function () {
        var s = "";
        for (var r = 0; r < 4; r++) for (var c = 0; c < 6; c++) {
          var hot = (r === 1 && c === 3) || (r === 2 && c === 1) || (r === 3 && c === 4);
          s += '<rect x="' + (24 + c * 13.5) + '" y="' + (38 + r * 10) + '" width="9" height="6" rx="1.5" fill="' + (hot ? "#f2b83f" : "rgba(216,224,242,.35)") + '"/>';
        }
        return s;
      })()
  };
  ART.castle = ART.globe = ART.mountain;

  var NEON = {
    mountain: "M-12,8 L-3,-5 L2,1 L6,-4 L13,8 Z",
    tracker: "M-10,9 V1 M-3,9 V-4 M4,9 V-9 M11,9 V-2",
    coach: "M0,-13 Q2,-2 13,0 Q2,2 0,13 Q-2,2 -13,0 Q-2,-2 0,-13 Z",
    language: "M-12,-9 H12 V5 H-2 L-8,11 V5 H-12 Z",
    calendar: "M-11,-7 H11 V10 H-11 Z M-11,-2 H11 M-5,-12 V-5 M5,-12 V-5",
    // the skate fitting shop: a figure skate (boot, blade with its toe pick curling up at the front)
    skate: "M-9,-11 V3 H8 Q12,3 12,0 Q12,-3 7,-4 L1,-6 V-11 Z M-12,9 H9 Q13,9 13,5 M-6,3 V9 M6,3 V9"
  };
  NEON.castle = NEON.globe = NEON.mountain;

  var PALETTE = [
    { wall: "#b8433f", trim: "#fbe9d0", awn: "#e0457a", door: "#5a2430", neon: "#ffd36b" },
    { wall: "#3d5bb5", trim: "#eef2ff", awn: "#2b3f8f", door: "#24305e", neon: "#ff8fc8" },
    { wall: "#6b4aa8", trim: "#f3ebff", awn: "#8f6bd6", door: "#3a2660", neon: "#7be3ff" },
    { wall: "#d9773a", trim: "#fff1e0", awn: "#c0532a", door: "#5a2c18", neon: "#9fb8ff" },
    { wall: "#2f7f8f", trim: "#e6fbff", awn: "#1f5f6f", door: "#173f4a", neon: "#ffd36b" }
  ];
  // the skate fitting shop when it is an extra shop of its own (inside an artifact's shop it keeps that shop's colours)
  var FIT_PALETTE = { wall: "#c4507f", trim: "#fff0f6", awn: "#6b4aa8", door: "#4a2350", neon: "#7be3ff" };

  // One shop front. A special shop (the skate fitting shop) can swap parts through o: pal (colours), round (roof),
  // chimney, id (prefix for the gradients), sign (the words on the sign), win (the shop window) and neon (over the door).
  function shopSVG(a, i, o) {
    o = o || {};
    var p = o.pal || PALETTE[i % PALETTE.length], round = o.round != null ? o.round : i % 2 === 1, id = o.id || "s" + i;
    var art = ART[a && a.art] || ART.mountain, neon = o.neon || NEON[a && a.art] || NEON.mountain;
    var chimney = o.chimney != null ? o.chimney : i % 2 === 0;
    var bulbs = "", colors = ["#ffd36b", "#ff8fc8", "#7be3ff", "#ff7a59"];
    for (var b = 0; b < 13; b++) {
      bulbs += '<circle class="bulb" style="animation-delay:' + f(b * 0.23) + 's" cx="' + (24 + b * 16) + '" cy="' + (round ? 132 : 130) + '" r="3.4" fill="' + colors[b % 4] + '"/>';
    }
    var stripes = "";
    for (var s = 0; s < 8; s++) {
      stripes += '<path d="M' + (28 + s * 15.5) + ',178 h15.5 v20 a7.75,7.75 0 0 1 -15.5,0 Z" fill="' + (s % 2 ? p.trim : p.awn) + '"/>';
    }
    var roof = round
      ? '<path d="M12,128 Q12,44 120,44 Q228,44 228,128 Z" fill="' + p.door + '"/>' +
        '<path d="M4,132 Q4,32 120,32 Q236,32 236,132 Q226,144 212,134 Q198,146 182,136 Q166,148 150,136 Q134,148 118,136 Q102,148 86,136 Q70,146 54,134 Q38,144 24,132 Q12,142 4,132 Z" fill="#ffffff"/>' +
        '<path d="M14,120 Q60,104 120,104 Q180,104 226,120" stroke="#c9d8f5" stroke-width="5" fill="none" opacity=".8"/>'
      : '<path d="M8,128 L120,40 L232,128 Z" fill="' + p.door + '"/>' +
        '<path d="M0,132 Q2,116 18,110 L120,26 L222,110 Q238,116 240,132 Q228,144 214,134 Q200,146 184,136 Q168,148 150,136 Q134,148 118,136 Q100,148 84,136 Q68,146 52,134 Q36,144 24,132 Q10,142 0,132 Z" fill="#ffffff"/>' +
        '<path d="M30,116 L120,46 L210,116" stroke="#c9d8f5" stroke-width="5" fill="none" opacity=".7"/>';
    return '<svg viewBox="0 0 240 330" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + 'in" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2a4a"/><stop offset="1" stop-color="#22142e"/></linearGradient>' +
      '<radialGradient id="' + id + 'gl" cx=".5" cy=".2" r=".75"><stop offset="0" stop-color="#ffd58a" stop-opacity=".95"/><stop offset=".55" stop-color="#ff9f6a" stop-opacity=".35"/><stop offset="1" stop-color="#ff9f6a" stop-opacity="0"/></radialGradient></defs>' +
      (chimney ? '<rect x="166" y="46" width="20" height="56" fill="#3a2a40"/><rect x="162" y="40" width="28" height="9" rx="3" fill="#ffffff"/><g class="smoke"><circle cx="176" cy="30" r="6"/><circle cx="182" cy="14" r="8"/><circle cx="178" cy="-4" r="10"/></g>' : "") +
      roof +
      '<rect x="18" y="128" width="204" height="202" fill="' + p.wall + '"/>' +
      '<path d="M44,128 V330 M74,128 V330 M104,128 V330 M134,128 V330 M164,128 V330 M194,128 V330" stroke="#000" stroke-opacity=".08" stroke-width="2"/>' +
      bulbs +
      '<rect class="shop-sign" x="48" y="142" width="144" height="28" rx="5" fill="' + p.trim + '"/>' +
      (o.sign || (a && a.status === "done" && isText(a.shopName || a.title) ? signText(String(a.shopName || a.title).trim(), p.wall) :
        '<text x="120" y="161" text-anchor="middle" font-family="Unbounded, Arial Black, sans-serif" font-size="12" font-weight="800" letter-spacing="1.5" fill="' + p.wall + '">ARTIFACT ' + (a.number) + '</text>')) +
      stripes +
      '<rect x="30" y="200" width="116" height="96" fill="url(#' + id + 'in)"/>' +
      '<rect class="win-glow" x="30" y="200" width="116" height="96" fill="url(#' + id + 'gl)"/>' +
      (o.win || (a && a.status === "done" ? doneWindowArt(a, p) : '<svg x="34" y="206" width="108" height="82" viewBox="0 0 120 90">' + art + '</svg>' +
        '<path d="M30,200 h116 v96 h-116 Z M88,200 V296 M30,248 H146" fill="none" stroke="' + p.trim + '" stroke-width="5"/>')) +
      '<rect x="24" y="294" width="128" height="10" rx="5" fill="#ffffff"/>' +
      '<path class="door-light" d="M162,330 V230 Q162,206 186,206 Q210,206 210,230 V330 Z" fill="#ffd58a"/>' +
      '<g class="shop-door"><path d="M162,330 V230 Q162,206 186,206 Q210,206 210,230 V330 Z" fill="' + p.door + '"/>' +
      '<path d="M172,256 V234 Q172,220 186,220 Q200,220 200,234 V256 Z" fill="#ffd58a" opacity=".9"/>' +
      '<circle cx="202" cy="290" r="3" fill="#f2b83f"/></g>' +
      '<g transform="translate(186,188)" filter="url(#fNeon)"><path d="' + neon + '" fill="none" stroke="' + p.neon + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>' +
      '<ellipse cx="88" cy="328" rx="78" ry="9" fill="#ffc46b" opacity=".35"/>' +
      '<path d="M-6,330 Q40,312 90,322 Q140,312 190,322 Q226,314 246,326 V334 H-6 Z" fill="#ffffff"/>' +
      "</svg>";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; });
  }

  /* ---------- The skate fitting shop: About me and the resume (window.ABOUT in cards.js) ---------- */

  // Used when cards.js has no ABOUT block, or for any field that is missing or broken, so About always finds nic.
  var ABOUT_DEFAULT = {
    fittingShop: 1,
    shopName: "Skate Fitting",
    greeting: "Hi, I'm Nick",
    about: "I have a passion for figure skating, ask me about how to join the UW Figure Skating Team. I'm learning to build websites and apps. This quarter I'm making five projects,and each one gets its own little shop in the village by the lake.",
    traits: ["Hardworking", "Not afraid to fail", "Attentive"],
    keeperSays: "Welcome in! Let's find you the perfect fit.",
    resumeLinkLabel: "Download my resume"
  };
  function isText(v) { return (typeof v === "string" && v.trim() !== "") || (typeof v === "number" && isFinite(v)); }
  function textOr(v, def) { return isText(v) ? String(v).trim() : def; }
  function textList(v) { return (Array.isArray(v) ? v : isText(v) ? [v] : []).filter(isText).map(function (t) { return String(t).trim(); }); }
  // Tidy up window.ABOUT field by field, so one slip in cards.js never hides the shop or the page
  function readAbout(src) {
    var d = ABOUT_DEFAULT;
    if (!src || typeof src !== "object") src = {};
    var resume = Array.isArray(src.resume) ? src.resume : (src.resume && typeof src.resume === "object" ? [src.resume] : []);
    return {
      fittingShop: src.fittingShop === undefined ? d.fittingShop : src.fittingShop,
      shopName: textOr(src.shopName, d.shopName),
      greeting: textOr(src.greeting, d.greeting),
      about: textOr(src.about, d.about),
      traits: src.traits === undefined ? d.traits : textList(typeof src.traits === "string" ? src.traits.split(",") : src.traits),
      keeperSays: textOr(src.keeperSays, d.keeperSays),
      resume: resume.map(function (sec) {
        return sec && typeof sec === "object" ? { heading: textOr(sec.heading, ""), items: textList(sec.items) } : null;
      }).filter(function (sec) { return sec && (sec.heading || sec.items.length); }),
      resumeLink: textOr(src.resumeLink, ""),
      resumeLinkLabel: textOr(src.resumeLinkLabel, d.resumeLinkLabel)
    };
  }

  // The street: one shop per artifact card. The skate fitting shop is either one of them (ABOUT.fittingShop is an
  // artifact number; that card stays inside on its own tab) or an extra shop at the start of the street ("extra" or 0,
  // or a number that matches no card). data-i on each shop is its place on the street.
  var ABOUT = null, SHOPS = [];
  function buildShopList() {
    try { ABOUT = readAbout(window.ABOUT); } catch (e) { ABOUT = readAbout({}); }
    var list = Array.isArray(window.ARTIFACTS) ? window.ARTIFACTS : [], want = ABOUT.fittingShop, host = -1;
    if (isText(want) && +want > 0) {
      for (var k = 0; k < list.length; k++) if (list[k] && +list[k].number === +want) { host = k; break; }
    }
    SHOPS = list.map(function (a, ai) { return { a: a, ai: ai, fit: ai === host }; });
    if (host < 0) SHOPS.unshift({ a: null, ai: -1, fit: true });
  }
  function fitIndex() {
    for (var i = 0; i < SHOPS.length; i++) if (SHOPS[i].fit) return i;
    return -1;
  }
  function fitPalette(s) { return s.a ? PALETTE[s.ai % PALETTE.length] : FIT_PALETTE; }

  // The words on a shop sign, made smaller (and at worst squeezed) until they fit the 144 x 28 sign
  function signText(t, fill) {
    var size = 12, ls = 1.5, room = 130;
    var width = function () { return t.length * size * 0.8 + (t.length - 1) * ls; };   // a little wider than Unbounded really is
    while (width() > room && size > 8.5) { size -= 0.5; ls = Math.max(0.5, ls - 0.2); }
    return '<text x="120" y="' + f(156 + size * 0.41) + '" text-anchor="middle" font-family="Unbounded, Arial Black, sans-serif" font-size="' + f(size) +
      '" font-weight="800" letter-spacing="' + f(ls) + '" fill="' + fill + '"' + (width() > room ? ' textLength="' + room + '" lengthAdjust="spacingAndGlyphs"' : "") +
      ">" + esc(t.toUpperCase()) + "</text>";
  }

  // A white figure skate with a soft shadow (inside a 120 x 90 window box), shared by the shop windows that show one
  function windowSkate() {
    return '<ellipse cx="44" cy="77.5" rx="34" ry="3.6" fill="#ff8fc8" opacity=".35"/>' +
      '<path d="M22,14 C21,30 19,46 18,60 L18,66 L60,66 C66,66 69,63 68,58 C67,53 62,51 56,49 C50,47 45,42 43,34 L42,14 Z" fill="#ffffff"/>' +
      '<path d="M22,14 C21,30 19,46 18,60 L18,66 L24,66 L24,60 C25,46 26.5,30 27.5,14 Z" fill="#e2ddef"/>' +
      '<rect x="20" y="10.5" width="25" height="6" rx="3" fill="#f3eefe"/>' +
      '<path d="M41.5,17.5 L35.5,21 L42,23.5 L36,27 L42.8,29.5 L37.5,33 L45.5,35.5 L41.5,39 L51,41.5" fill="none" stroke="#ff8fc8" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M41,13 c-6,-6.5 -10,.5 0,0 c6,-6.5 10,.5 0,0" fill="none" stroke="#ff8fc8" stroke-width="1.4"/>' +
      '<rect x="18" y="59.5" width="10" height="6.5" rx="1" fill="#cfc9e3"/><rect x="18" y="66" width="46" height="2.8" rx="1.2" fill="#cfc9e3"/>' +
      '<path d="M21,68.5 h9 l-1,5.2 h-7 Z M50,68.5 h10 l-1,5.2 h-8 Z" fill="#c9d1e0"/>' +
      '<path d="M14,73.5 H65 C70,73.5 73,71.2 73.4,67.2 L75.6,67.2 C76.6,73.4 72.6,77.2 65.6,77.2 H16 C13,77.2 12.4,73.5 14,73.5 Z" fill="#e8edf6"/>' +
      '<path d="M15,76.2 H65.5" stroke="#aab2c6" stroke-width="1"/><path d="M75.2,66.8 l2.4,.9 l-2,1 l2.2,1.1 l-2,1" fill="none" stroke="#c9d1e0" stroke-width="1"/>' +
      '<path d="M64,18 L65.3,21.7 L69,23 L65.3,24.3 L64,28 L62.7,24.3 L59,23 L62.7,21.7 Z" fill="#fff2c8"/>';
  }

  // The fitting shop's window display (a 120 x 90 box like ART): a white figure skate on a little shelf,
  // and two soft blade guards hanging from a brass rail, a bunny and a strawberry
  function fitWindowArt(p) {
    var bunny =
      '<path d="M97,13 V24" stroke="#f2b83f" stroke-width="1.2"/>' +
      '<ellipse cx="104.5" cy="21" rx="2.2" ry="5.4" transform="rotate(-12 104.5 21)" fill="#ffe3ee"/><ellipse cx="109.5" cy="21" rx="2.2" ry="5.4" transform="rotate(12 109.5 21)" fill="#ffe3ee"/>' +
      '<ellipse cx="104.6" cy="21.6" rx="1" ry="3.4" transform="rotate(-12 104.6 21.6)" fill="#ff8fc8"/><ellipse cx="109.4" cy="21.6" rx="1" ry="3.4" transform="rotate(12 109.4 21.6)" fill="#ff8fc8"/>' +
      '<rect x="80" y="24" width="35" height="11" rx="5.5" fill="#ffe3ee"/><circle cx="80.5" cy="29.5" r="2.6" fill="#ffffff"/>' +
      '<circle cx="104" cy="29" r=".95" fill="#1d1420"/><circle cx="110" cy="29" r=".95" fill="#1d1420"/><ellipse cx="107" cy="31.2" rx="1" ry=".7" fill="#e0457a"/>' +
      '<ellipse cx="102.2" cy="31.4" rx="1.6" ry=".9" fill="#ff8fc8" opacity=".6"/><ellipse cx="111.8" cy="31.4" rx="1.6" ry=".9" fill="#ff8fc8" opacity=".6"/>';
    var berry =
      '<path d="M103,13 V44" stroke="#f2b83f" stroke-width="1.2"/>' +
      '<rect x="82" y="44" width="33" height="11" rx="5.5" fill="#e0457a"/><rect x="84" y="45.5" width="28" height="2.6" rx="1.3" fill="#ff8fc8" opacity=".55"/>' +
      '<g fill="#ffd36b"><ellipse cx="90" cy="51" rx=".7" ry="1"/><ellipse cx="95" cy="48.6" rx=".7" ry="1"/><ellipse cx="100" cy="51.4" rx=".7" ry="1"/><ellipse cx="105" cy="48.8" rx=".7" ry="1"/><ellipse cx="110" cy="51" rx=".7" ry="1"/></g>' +
      '<path d="M82,49.5 L78.5,45.5 L83.5,47 L84,43 L86,47.5 L89.5,45.8 L87.5,49.5 L89.5,53.2 L86,51.5 L84,56 L83.5,52 L78.5,53.5 Z" fill="#2f9a6a"/>';
    return windowPane(p, SHELF + '<rect x="77" y="10.5" width="40" height="2.6" rx="1.3" fill="#f2b83f"/>' + windowSkate() + bunny + berry);
  }

  // One big display pane (a 120 x 90 box in the shop window) with a frame and no bars across the display
  function windowPane(p, inner) {
    return '<svg x="34" y="206" width="108" height="82" viewBox="0 0 120 90">' + inner + "</svg>" +
      '<path d="M30,200 h116 v96 h-116 Z" fill="none" stroke="' + p.trim + '" stroke-width="5"/>';
  }
  var SHELF = '<rect x="0" y="80" width="120" height="6" rx="1.5" fill="#a8794a"/><rect x="0" y="80" width="120" height="1.6" fill="#c79a63"/>';
  var SPARKLE = '<path d="M98,56 L99.3,59.7 L103,61 L99.3,62.3 L98,66 L96.7,62.3 L93,61 L96.7,59.7 Z" fill="#fff2c8"/>';

  // A finished card's shop window is lit and open like the fitting shop's: one pane, a display on a shelf, no window bars.
  // MySkate (art "tracker") shows its skate beside a gold medal and a little bar chart hanging from a brass rail; any
  // other finished card shows its concept picture in a frame on the shelf.
  var DONE_DISPLAY = {
    tracker: function () {
      return '<rect x="77" y="10.5" width="40" height="2.6" rx="1.3" fill="#f2b83f"/>' +
        windowSkate() +
        // the gold medal on its ribbon
        '<path d="M82,13 H94 L91,31 H85 Z" fill="#e0457a"/><path d="M86,13 H90 L89,31 H87 Z" fill="#ff8fc8"/>' +
        '<circle cx="88" cy="38" r="9" fill="#f2b83f" stroke="#c48a1e" stroke-width="1.2"/><circle cx="88" cy="38" r="6.2" fill="none" stroke="#ffe9a8" stroke-width="1"/>' +
        '<path d="M88,33.4 L89.4,36.5 L92.7,36.8 L90.2,39 L91,42.2 L88,40.5 L85,42.2 L85.8,39 L83.3,36.8 L86.6,36.5 Z" fill="#fff6d4"/>' +
        // the bar chart tag
        '<path d="M103,13 L108,24 M113,13 L108,24" stroke="#f2b83f" stroke-width="1" fill="none"/>' +
        '<rect x="98" y="24" width="20" height="26" rx="3" fill="#fff8f3"/>' +
        '<rect x="100" y="39" width="3.2" height="7" rx="1" fill="#7be3ff"/><rect x="104.8" y="34" width="3.2" height="12" rx="1" fill="#c79be6"/>' +
        '<rect x="109.6" y="30" width="3.2" height="16" rx="1" fill="#e0457a"/><rect x="114.4" y="27" width="2.4" height="19" rx="1" fill="#f2b83f"/>' +
        SPARKLE;
    }
  };
  function doneWindowArt(a, p) {
    var show = DONE_DISPLAY[a && a.art];
    return windowPane(p, SHELF + (show ? show() :
      '<rect x="14" y="8" width="92" height="68" rx="6" fill="rgba(14,10,18,.55)" stroke="#f2b83f" stroke-width="2"/>' +
      '<g transform="translate(17,10) scale(.72)">' + (ART[a && a.art] || ART.mountain) + "</g>" + SPARKLE));
  }

  // The fitting shop's front: the same shop as the others, with its own sign, window display and neon skate
  function fitShopSVG(s) {
    var p = fitPalette(s);
    return shopSVG(s.a, s.a ? s.ai : 0, {
      pal: p, id: "sf",
      round: s.a ? s.ai % 2 === 1 : true,   // as an extra shop it is round, beside the pointed roof of shop 1
      chimney: s.a ? s.ai % 2 === 0 : false,
      sign: signText(ABOUT.shopName, p.wall),
      win: fitWindowArt(p),
      neon: NEON.skate
    });
  }

  function artifactShopHTML(s, i) {
    var a = s.a, done = a.status === "done";
    return '<button type="button" class="shop" data-i="' + i + '" aria-label="Artifact ' + esc(a.number) + ': ' + esc(a.title) + '. Step inside">' +
      shopSVG(a, s.ai) +
      // a finished shop has its name on the sign, so "Artifact N" moves under the title (like "+ Artifact 1" in the fitting shop)
      '<span class="shop-label"><span class="shop-head"><span class="shop-num">' + (done ? "Try it" : "Artifact " + esc(a.number)) + '</span><span class="chip ' + (done ? "done" : "idea") + '">' + (done ? "Open" : "Idea") + "</span></span>" +
      '<span class="shop-title">' + esc(a.title) + "</span>" +
      (done ? '<span class="shop-also">Artifact ' + esc(a.number) + "</span>" : "") +
      '<span class="shop-open">Step inside &rarr;</span></span>' +
      "</button>";
  }
  function fitShopHTML(s, i) {
    var a = s.a, also = a ? "Artifact " + esc(a.number) + ": " + esc(a.title) : "";
    return '<button type="button" class="shop shop-fit" data-i="' + i + '" aria-label="' + esc(ABOUT.shopName) + " shop: About me and resume" + (a ? ", and " + also : "") + '. Step inside">' +
      fitShopSVG(s) +
      '<span class="shop-label"><span class="shop-head"><span class="shop-num">Start here</span><span class="chip done">Open</span></span>' +
      '<span class="shop-title">About me &amp; resume</span>' +
      (a ? '<span class="shop-also">+ ' + also + "</span>" : "") +
      '<span class="shop-open">Step inside &rarr;</span></span>' +
      "</button>";
  }

  function renderShops() {
    var box = $("street");
    buildShopList();
    var cards = Array.isArray(window.ARTIFACTS) && window.ARTIFACTS.length;
    box.style.setProperty("--shops", Math.max(5, SHOPS.length));   // one column per shop, never wider than a fifth
    box.innerHTML = (cards ? "" : '<p class="load-note">No cards found. Check cards.js for a missing quote or comma.</p>') +
      SHOPS.map(function (s, i) { return s.fit ? fitShopHTML(s, i) : artifactShopHTML(s, i); }).join("");
    box.addEventListener("click", function (e) {
      var btn = e.target.closest(".shop");
      if (btn) enterShop(+btn.getAttribute("data-i"), true);
    });
  }

  /* ---------- Inside a shop: the shopkeeper and the menu board ---------- */

  var KEEPERS = [
    { skin: "#f1c7a5", hair: "#5a2e1c", top: "#fbe9d0", style: "beanie", hat: "#e0457a" },
    { skin: "#8d5a3c", hair: "#1d1420", top: "#f2b83f", style: "bun", hat: "" },
    { skin: "#e3b08a", hair: "#2a1b30", top: "#7be3ff", style: "curly", hat: "" },
    { skin: "#5b3a2a", hair: "#151018", top: "#fff1e0", style: "glasses", hat: "" },
    { skin: "#f5d3b8", hair: "#c98a4a", top: "#e6fbff", style: "earmuffs", hat: "#e0457a" }
  ];

  // An original, friendly shopkeeper drawn from the waist up (the counter hides the rest).
  function keeperSVG(i) {
    var k = KEEPERS[i % KEEPERS.length], p = PALETTE[i % PALETTE.length];
    var hairBack = "", hairFront = "", extra = "";
    if (k.style === "beanie") {
      hairBack = '<path d="M60,118 C56,150 64,170 74,176 L146,176 C156,170 164,150 160,118 Z" fill="' + k.hair + '"/>';
      hairFront = '<path d="M60,104 C58,52 162,52 160,104 Z" fill="' + k.hat + '"/><rect x="56" y="96" width="108" height="18" rx="9" fill="#fbe9d0"/>' +
        '<path d="M70,96 V112 M84,96 V114 M98,96 V114 M112,96 V114 M126,96 V114 M140,96 V114 M154,96 V112" stroke="#e8cfae" stroke-width="3"/><circle cx="110" cy="48" r="13" fill="#fbe9d0"/>';
    } else if (k.style === "bun") {
      hairFront = '<circle cx="110" cy="56" r="20" fill="' + k.hair + '"/><path d="M62,112 C56,64 164,64 158,112 C150,88 132,78 110,80 C88,78 70,88 62,112 Z" fill="' + k.hair + '"/>';
    } else if (k.style === "curly") {
      for (var c = 0; c < 11; c++) {
        var ang = Math.PI * (1.05 + c * 0.09), cx = 110 + Math.cos(ang) * 50, cy = 104 + Math.sin(ang) * 50;
        hairFront += '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="15" fill="' + k.hair + '"/>';
      }
      hairBack = '<circle cx="64" cy="124" r="15" fill="' + k.hair + '"/><circle cx="156" cy="124" r="15" fill="' + k.hair + '"/>';
    } else if (k.style === "glasses") {
      hairFront = '<path d="M62,108 C58,60 162,60 158,108 C146,90 124,84 104,88 C86,90 70,96 62,108 Z" fill="' + k.hair + '"/>';
      extra = '<g fill="none" stroke="#f2b83f" stroke-width="3"><circle cx="92" cy="114" r="11"/><circle cx="128" cy="114" r="11"/><path d="M103,114 H117"/></g>';
    } else {
      hairBack = '<path d="M60,110 C54,160 62,186 70,196 L150,196 C158,186 166,160 160,110 Z" fill="' + k.hair + '"/>';
      hairFront = '<path d="M62,110 C58,62 162,62 158,110 C150,92 128,82 110,84 C92,82 70,92 62,110 Z" fill="' + k.hair + '"/>';
      extra = '<path d="M60,112 C60,56 160,56 160,112" fill="none" stroke="' + k.hat + '" stroke-width="7"/><circle cx="60" cy="118" r="15" fill="#fbe9d0"/><circle cx="160" cy="118" r="15" fill="#fbe9d0"/>';
    }
    return '<svg class="keeper-svg" viewBox="0 0 220 280" aria-hidden="true">' +
      hairBack +
      '<path d="M22,280 C22,206 58,184 110,184 C162,184 198,206 198,280 Z" fill="' + k.top + '"/>' +
      '<path d="M66,200 L154,200 L162,280 L58,280 Z" fill="' + p.wall + '"/>' +
      '<path d="M66,200 L88,186 M154,200 L132,186" stroke="' + p.wall + '" stroke-width="6" stroke-linecap="round"/>' +
      '<rect x="88" y="234" width="44" height="26" rx="6" fill="#000" opacity=".14"/>' +
      '<g transform="translate(110,224)" filter="url(#fNeon)"><path d="' + (NEON[(window.ARTIFACTS[i] || {}).art] || NEON.mountain) + '" fill="none" stroke="' + p.neon + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>' +
      '<rect x="98" y="150" width="24" height="40" rx="10" fill="' + k.skin + '"/>' +
      '<circle cx="62" cy="118" r="10" fill="' + k.skin + '"/><circle cx="158" cy="118" r="10" fill="' + k.skin + '"/>' +
      '<circle cx="110" cy="112" r="49" fill="' + k.skin + '"/>' +
      '<g class="keeper-eyes"><ellipse cx="92" cy="115" rx="4.5" ry="5.5" fill="#1d1420"/><ellipse cx="128" cy="115" rx="4.5" ry="5.5" fill="#1d1420"/></g>' +
      '<ellipse cx="80" cy="132" rx="9" ry="5" fill="#ff7aa8" opacity=".45"/><ellipse cx="140" cy="132" rx="9" ry="5" fill="#ff7aa8" opacity=".45"/>' +
      '<path d="M98,134 Q110,146 122,134" fill="none" stroke="#5a2430" stroke-width="3.5" stroke-linecap="round"/>' +
      hairFront + extra +
      "</svg>";
  }

  function interiorHTML(a, i) {
    var p = PALETTE[i % PALETTE.length], done = a.status === "done";
    var link = a.link
      ? '<a class="board-link" href="' + esc(a.link) + '"' + (/^https?:/.test(a.link) ? ' target="_blank" rel="noopener"' : "") + ">" + esc(a.linkLabel || "Open the artifact") + " &rarr;</a>"
      : '<span class="board-link pending">Link coming when it\'s built</span>';
    var say = done ? "Welcome in! Everything about this one is on the board." : "Welcome! This shop is still an idea. Here's the plan.";
    return '<div class="int-wall" style="--wall:' + p.wall + ";--neon:" + p.neon + ";--awn:" + p.awn + '">' +
      '<svg class="int-decor" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<defs><radialGradient id="gLamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd58a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd58a" stop-opacity="0"/></radialGradient>' +
        '<linearGradient id="gNight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f5a"/><stop offset="1" stop-color="#6a4fae"/></linearGradient></defs>' +
        // window with the snowy lake outside
        '<rect x="40" y="170" width="250" height="470" rx="8" fill="url(#gNight)"/>' +
        '<path d="M40,520 L110,430 L150,470 L210,390 L290,500 V640 H40 Z" fill="#cfe0ff"/><path d="M40,590 H290 V640 H40 Z" fill="#7be3ff" opacity=".6"/>' +
        '<g class="int-snow" fill="#fff"><circle cx="80" cy="220" r="3"/><circle cx="150" cy="260" r="2.4"/><circle cx="230" cy="210" r="3"/><circle cx="120" cy="330" r="2"/><circle cx="250" cy="300" r="2.6"/><circle cx="190" cy="360" r="2"/></g>' +
        '<path d="M40,170 h250 v470 h-250 Z M165,170 V640 M40,400 H290" fill="none" stroke="#8a6238" stroke-width="14"/>' +
        '<rect x="24" y="636" width="282" height="18" rx="4" fill="#a8794a"/>' +
        // pendant lamps
        [560, 1180].map(function (x) {
          return '<circle cx="' + x + '" cy="80" r="170" fill="url(#gLamp)"/><path d="M' + x + ',0 V44" stroke="#1a1418" stroke-width="3"/>' +
            '<path d="M' + (x - 30) + ',80 L' + (x - 12) + ',42 H' + (x + 12) + ' L' + (x + 30) + ',80 Z" fill="#f2b83f"/><circle cx="' + x + '" cy="85" r="9" fill="#fff4d6"/>';
        }).join("") +
        // shelf with jars on the right
        '<rect x="1330" y="330" width="250" height="14" rx="3" fill="#a8794a"/>' +
        '<rect x="1350" y="276" width="40" height="54" rx="8" fill="#9fb8ff" opacity=".85"/><rect x="1404" y="292" width="34" height="38" rx="6" fill="#ffd36b" opacity=".9"/>' +
        '<path d="M1460,330 V300 Q1460,286 1474,286 H1494 Q1508,286 1508,300 V330 Z" fill="#fbe9d0"/><circle cx="1540" cy="312" r="18" fill="#e0457a"/>' +
        // hanging plant
        '<path d="M1480,0 V120" stroke="#1a1418" stroke-width="3"/><path d="M1450,120 H1510 L1500,160 H1460 Z" fill="#c0532a"/>' +
        '<g fill="#2f9a6a"><ellipse cx="1452" cy="176" rx="12" ry="26" transform="rotate(20 1452 176)"/><ellipse cx="1468" cy="200" rx="10" ry="30"/><ellipse cx="1492" cy="190" rx="11" ry="28" transform="rotate(-10 1492 190)"/><ellipse cx="1512" cy="172" rx="12" ry="24" transform="rotate(-24 1512 172)"/></g>' +
      "</svg>" +
      '<button type="button" class="int-back" id="intBack"><span aria-hidden="true">&larr;</span> Back to the village</button>' +
      // the same board as the fitting shop's: the top (name, title and the link) stays put and the words scroll under it
      '<section class="board card-board" aria-labelledby="boardTitle">' +
        '<div class="fit-top">' +
          '<div class="row head"><span>Artifact ' + esc(a.number) + '</span><span class="tag">' + (done ? "&#9733; Open" : "&#9825; Idea") + "</span></div>" +
          '<h2 class="row title" id="boardTitle">' + esc(a.title) + "</h2>" +
          '<div class="row card-go">' + link + "</div>" +
        "</div>" +
        '<div class="fit-scroll">' +
          '<div class="row label">' + (done ? "Reflection" : "The idea") + "</div>" +
          '<p class="board-text">' + esc(a.reflection) + "</p>" +
        "</div>" +
      "</section>" +
      '<div class="keeper"><p class="keeper-say">' + say + "</p>" + keeperSVG(i) + "</div>" +
      '<div class="counter" aria-hidden="true">' +
        '<svg class="counter-bell" viewBox="0 0 60 44"><path d="M8,36 Q8,10 30,10 Q52,10 52,36 Z" fill="#f2b83f"/><rect x="2" y="36" width="56" height="7" rx="3" fill="#c48a1e"/><circle cx="30" cy="7" r="5" fill="#f2b83f"/></svg>' +
        '<svg class="counter-mug" viewBox="0 0 60 70"><path class="steam" d="M22,20 Q16,12 22,4 M34,20 Q28,12 34,4" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="8" y="26" width="36" height="40" rx="7" fill="#fbe9d0"/><path d="M44,34 Q56,34 56,46 Q56,56 44,56" stroke="#fbe9d0" stroke-width="6" fill="none"/></svg>' +
        '<svg class="counter-plant" viewBox="0 0 70 90"><g fill="#2f9a6a"><ellipse cx="22" cy="34" rx="9" ry="22" transform="rotate(-24 22 34)"/><ellipse cx="35" cy="26" rx="9" ry="25"/><ellipse cx="48" cy="34" rx="9" ry="22" transform="rotate(24 48 34)"/></g><path d="M14,56 H56 L50,88 H20 Z" fill="#c0532a"/></svg>' +
      "</div>" +
    "</div>";
  }

  /* ====== FITTING SHOP ART ==========================================================================
     The drawings inside the skate fitting shop, all called from fitInteriorHTML() below and sized by their wrappers
     in style.css:
       fitWallArt()   the pieces on the slatwall: framed pictures and blades, the wall of boots, the soft guards on hooks,
                      the tall unit of stacked boot boxes and a stack of boxes on the floor (one <svg> each)
       fitSceneSVG()  the bench, the skater and the kneeling shopkeeper lacing a new skate, viewBox 0 0 640 420
     Their little animations (a swinging guard, a glinting blade, the lace tug, blinks, a heart) are CSS only. */

  /* ---------- The fitting shop's slatwall: boots, boxes, blades and soft guards ---------- */

  // Everything that hangs on (or stands against) the fitting shop's slatwall. The slatwall itself is CSS (.fit-slat in
  // style.css); each piece is its own <svg>, so style.css can place it for any screen. Returns their markup:
  //   defs    a sprite that takes no room: the boots, boot box, peg and guard shapes the other pieces reuse with <use>
  //   frames  three little framed pictures (a skate, a snowflake, a heart) over a row of blades on pegs, viewBox 452 x 132
  //   boots   the wall of figure skate boots: 4 rows of 7 on little clear shelves, a size strip under each, viewBox 452 x 384
  //   hooks   two rows of animal and fruit soft guards on brass hooks and a row of pastel gloves, viewBox 452 x 156
  //   boxes   a tall wooden shelf unit of boot boxes stacked two high, viewBox 240 x 660 (boxesShort: 4 shelves, 240 x 456)
  //   stack   a chair and boxes stacked on the floor beside the fitting bench, viewBox 364 x 200
  // Pass an optional suffix only if two walls share one page (keeps ids unique).
  function fitWallArt(sfx) {
    var S = sfx ? String(sfx) : "";
    function id(n) { return "fw-" + n + S; }
    function ref(n) { return "url(#" + id(n) + ")"; }
    function n1(v) { return Math.round(v * 10) / 10; }
    function g(tf, inner, cls) { return "<g" + (cls ? ' class="' + cls + '"' : "") + ' transform="' + tf + '">' + inner + "</g>"; }
    function use(n, extra) { return '<use href="#' + id(n) + '"' + (extra || "") + "/>"; }

    var WOOD = { frame: "#a8794a", top: "#c79a63", dark: "#8a6238", back: "#7c5636" };
    var BRASS = { base: "#f2b83f", dark: "#c48a1e", hi: "#ffe39a" };

    /* -- a figure skate blade, toe pick to the right (local 0..114 x 0..29) -- */
    // heel stanchion, the open arch, a front stanchion with a window, the serrated toe pick, a rockered runner
    var BLADE_D = "M6,3.5 H30 C28,10 25,14 24,19.6 Q40,21.4 56,21.2 C58,16 58,8 58,3.5 H106 L110.5,5 L107,8 L112,9.5 L108,12.5 L113,14 L109,17 L113.5,18.5 L108.5,22.5 Q104,26 96,26.4 Q55,29.6 8,25 Q1,24.4 2,21.4 Q3,19.4 8,19.8 C11,15 8,9 6,3.5 Z " +
      "M68,8.5 H94 Q98.5,8.5 98.5,12.5 Q98.5,16.5 94,16.5 H68 Q63.5,16.5 63.5,12.5 Q63.5,8.5 68,8.5 Z";
    var SILVER = { body: "#dfe6ef", shade: "#a9b5c6", plate: "#8a97a9", hi: "#ffffff" };
    var GOLD = { body: "#f2b83f", shade: "#c48a1e", plate: "#a8781a", hi: "#ffe39a" };

    function bladeParts(b, glint) {
      var d = "", sc = [9, 18, 27, 62, 78, 94, 104];
      for (var i = 0; i < sc.length; i++) d += "M" + (sc[i] - 1.1) + ",1.9a1.1,1.1 0 1,0 2.2,0a1.1,1.1 0 1,0 -2.2,0";
      return '<path d="M4,0 H32 Q34,0 34,2 V3.8 H2 V2 Q2,0 4,0 Z M54,0 H108 Q110,0 110,2 V3.8 H52 V2 Q52,0 54,0 Z" fill="' + b.plate + '"/>' +
        '<path d="' + d + '" fill="' + b.shade + '"/>' +
        '<path d="' + BLADE_D + '" fill="' + b.body + '" fill-rule="evenodd"/>' +
        // toe pick teeth a shade darker; the steel edge is a bright line above a darker rim
        '<path d="M104,3.8 L110.5,5 L107,8 L112,9.5 L108,12.5 L113,14 L109,17 L113.5,18.5 L108.5,22.5 Q104,26 98,26.3 L100,14 Z" fill="' + b.shade + '" opacity=".6"/>' +
        '<path d="M8,25 Q55,29.6 96,26.4" fill="none" stroke="' + b.shade + '" stroke-width="1.6"/>' +
        '<path d="M9,22.6 Q55,27 97,23.8 M10,6 C12,10 12,14 11,17" fill="none" stroke="' + b.hi + '" stroke-width="1.3" stroke-linecap="round"/>' +
        (glint ? '<g clip-path="' + ref("gclip") + '"><path class="fw-glint" d="M-10,-2 H-2 L-9,32 H-17 Z" fill="' + ref("glintg") + '"/></g>' : "");
    }

    /* -- soft guards (soakers): terry-cloth blade covers -- */
    // hanging guard, hook at 0,0, toe end to the right; animals add a round head at that end
    var SK_D = "M-60,14 H56 C66,14 72,24 72,35 C72,50 63,57 52,57 Q0,63 -56,55 C-66,53 -71,45 -71,35 C-71,23 -68,14 -60,14 Z";
    var HEAD_D = "M27,35 a23,23 0 1,1 46,0 a23,23 0 1,1 -46,0 Z";
    // a guard worn on a mounted blade (blade-local coordinates)
    var SKB_D = "M7,11 H94 C101,11 105,3.5 111.5,3.5 C118,3.5 120.5,10 119.5,19 C118.5,28 110,31 100,31 Q55,35 9,30 Q-1,28 -1,20 Q-1,11 7,11 Z";

    // the gathered elastic opening along the top of a guard
    function band(col, x1, x2, y) {
      var d = "";
      for (var x = x1 + 3; x < x2 - 1; x += 5) d += "M" + x + "," + n1(y - 2.6) + "v5.2";
      return '<path d="M' + x1 + "," + y + " H" + x2 + '" stroke="' + col + '" stroke-width="7"/>' +
        '<path d="' + d + '" stroke="#000" stroke-opacity=".13" stroke-width="1.1"/>';
    }
    function loop(col) { return '<path d="M-5,17 C-6,3 6,3 5,17" fill="none" stroke="' + col + '" stroke-width="3.2"/>'; }
    // body + shadow + clipped prints with the terry texture on top
    function guard(col, head, behind, prints, front, loopCol) {
      var shape = head ? "skph" : "skp";
      return use(shape, ' x="3" y="4" fill="#000" opacity=".22"') + behind + loop(loopCol) + use(shape, ' fill="' + col + '"') +
        '<g clip-path="' + ref(head ? "skh" : "skc") + '">' + prints + '<rect x="-80" y="0" width="160" height="70" fill="' + ref("terry") + '"/></g>' +
        front + use("peg");
    }
    function eyes(y) {
      return '<path d="M40.5,' + y + 'a2.5,3.1 0 1,0 5,0a2.5,3.1 0 1,0 -5,0M54.5,' + y + 'a2.5,3.1 0 1,0 5,0a2.5,3.1 0 1,0 -5,0" fill="#1d1420"/>' +
        '<path d="M42.6,' + n1(y - 1.6) + 'a.9,.9 0 1,0 .1,0M56.6,' + n1(y - 1.6) + 'a.9,.9 0 1,0 .1,0" fill="#fff"/>';
    }
    function cheeks(y) { return '<path d="M32.8,' + y + 'a4.2,2.5 0 1,0 8.4,0a4.2,2.5 0 1,0 -8.4,0M58.8,' + y + 'a4.2,2.5 0 1,0 8.4,0a4.2,2.5 0 1,0 -8.4,0" fill="#ff7aa8" opacity=".5"/>'; }
    function smile(y, col) { return '<path d="M50,' + y + ' q-2,2.8 -4.4,1.2 M50,' + y + ' q2,2.8 4.4,1.2" fill="none" stroke="' + (col || "#5a2430") + '" stroke-width="1.3" stroke-linecap="round"/>'; }
    function whiskers(y, col) { return '<path d="M63,' + y + ' h9 M63,' + (y + 3) + ' l8,2.4 M37,' + y + ' h-9 M37,' + (y + 3) + ' l-8,2.4" stroke="' + col + '" stroke-width="1" stroke-linecap="round"/>'; }
    var NECK = '<path d="M30,18 Q24,35 30,52" fill="none" stroke-width="2" stroke=';
    // a tidy scatter of teardrop seeds (k scales each seed)
    function seeds(x1, x2, y1, y2, sx, sy, k, col) {
      var d = "", row = 0, a = n1(1.5 * k), b = n1(2.1 * k), c = n1(3.8 * k), e = n1(1.7 * k);
      for (var y = y1; y <= y2; y += sy, row++) {
        for (var x = x1 + (row % 2 ? sx / 2 : 0); x <= x2; x += sx) d += "M" + n1(x) + "," + n1(y) + "q" + a + "," + b + " 0," + c + "q-" + a + ",-" + e + " 0,-" + c + "z";
      }
      return '<path d="' + d + '" fill="' + col + '"/>';
    }
    function leaf(cx, cy, rot, len) {
      return g("translate(" + cx + "," + cy + ") rotate(" + rot + ")", '<path d="M0,0 Q' + n1(len / 2) + ",-" + n1(len / 3) + " " + len + ",0 Q" + n1(len / 2) + "," + n1(len / 3) + ' 0,0 Z" fill="#2f9a6a"/><path d="M1,0 H' + (len - 2) + '" stroke="#5fc48e" stroke-width="1"/>');
    }
    // round citrus slices printed on the fabric
    function slices(pts, r, rind, flesh) {
      var dr = "", df = "", dl = "";
      pts.forEach(function (p) {
        var cx = p[0], cy = p[1];
        dr += "M" + (cx - r) + "," + cy + "a" + r + "," + r + " 0 1,0 " + 2 * r + ",0a" + r + "," + r + " 0 1,0 -" + 2 * r + ",0";
        df += "M" + n1(cx - r + 1.8) + "," + cy + "a" + n1(r - 1.8) + "," + n1(r - 1.8) + " 0 1,0 " + n1(2 * r - 3.6) + ",0a" + n1(r - 1.8) + "," + n1(r - 1.8) + " 0 1,0 -" + n1(2 * r - 3.6) + ",0";
        for (var k = 0; k < 3; k++) {
          var a = k * Math.PI / 3, dx = Math.cos(a) * (r - 2.4), dy = Math.sin(a) * (r - 2.4);
          dl += "M" + n1(cx - dx) + "," + n1(cy - dy) + "L" + n1(cx + dx) + "," + n1(cy + dy);
        }
      });
      return '<path d="' + dr + '" fill="' + rind + '"/><path d="' + df + '" fill="' + flesh + '"/><path d="' + dl + '" stroke="' + rind + '" stroke-width="1.2"/>';
    }

    // each design returns its parts in hook-local coordinates: guard(colour, head?, behind, prints, front, loop colour)
    var GUARDS = {
      bunny: function () {
        var c = "#ffe6ef", pink = "#ff9fc0";
        return guard(c, true,
          '<circle cx="-70" cy="37" r="9" fill="#fff8f3"/>' +
          '<path d="M34.7,1.6 a6.5,17 -14 1,0 12.6,-3.1 a6.5,17 -14 1,0 -12.6,3.1 Z M52.6,-2.4 a6.5,17 12 1,0 12.7,2.7 a6.5,17 12 1,0 -12.7,-2.7 Z" fill="' + c + '"/>' +
          '<path d="M37.9,2.8 a3.2,12 -14 1,0 6.2,-1.6 a3.2,12 -14 1,0 -6.2,1.6 Z M55.9,.3 a3.2,12 12 1,0 6.3,1.3 a3.2,12 12 1,0 -6.3,-1.3 Z" fill="' + pink + '"/>',
          NECK + '"#f4c3d6"/>' + band("#f7cddd", -64, 28, 17.5),
          eyes(33) + '<path d="M47.6,37.6 h4.8 l-2.4,2.8 z" fill="#e0457a"/>' + smile(40.4) + cheeks(40) + whiskers(38, "#d9a6ba"),
          "#f4c3d6");
      },
      cat: function () {
        var c = "#c4b0ea", sh = "#a48bd8";
        return guard(c, true,
          '<path d="M-68,44 C-86,46 -90,26 -80,16" fill="none" stroke="' + c + '" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="M-84.2,23 C-84.6,19.6 -83,17 -80,16" fill="none" stroke="' + sh + '" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="M31,24 L34,3 L49,15 Z M51,15 L66,3 L69,24 Z" fill="' + c + '"/><path d="M35.5,17 L36.6,8 L44,14.6 Z M56,14.6 L63.4,8 L64.5,17 Z" fill="#ff9fc0"/>',
          '<path d="M-44,19 q5,10 0,19 M-26,19 q5,10 0,19 M-8,19 q5,10 0,19 M10,19 q5,10 0,19 M46,12 v7 M54,12 v7" fill="none" stroke="' + sh + '" stroke-width="4" stroke-linecap="round"/>' +
            NECK + '"' + sh + '"/>' + band("#b39ce2", -64, 28, 17.5),
          eyes(34) + '<path d="M47.8,38.6 h4.4 l-2.2,2.6 z" fill="#ff7aa8"/>' + smile(41.2, "#4a3a6a") + cheeks(41) + whiskers(39, "#5b4a7a"),
          sh);
      },
      panda: function () {
        var c = "#fbf7f2", k = "#2a2230";
        return guard(c, true,
          '<path d="M-75.5,37 a5.5,5.5 0 1,0 11,0 a5.5,5.5 0 1,0 -11,0 M25,16 a8,8 0 1,0 16,0 a8,8 0 1,0 -16,0 M59,16 a8,8 0 1,0 16,0 a8,8 0 1,0 -16,0" fill="' + k + '"/>',
          '<ellipse cx="-14" cy="60" rx="48" ry="8" fill="#e9e2da"/>' +
            '<path d="M7,56 a11,9 0 1,0 22,0 a11,9 0 1,0 -22,0 M-59,55 a11,8 0 1,0 22,0 a11,8 0 1,0 -22,0" fill="' + k + '"/>' +
            NECK + '"#e4ddd5"/>' + band("#ece5de", -64, 26, 17.5),
          '<ellipse cx="42" cy="34" rx="6" ry="7.6" transform="rotate(-28 42 34)" fill="' + k + '"/><ellipse cx="58" cy="34" rx="6" ry="7.6" transform="rotate(28 58 34)" fill="' + k + '"/>' +
            '<path d="M41,33 a2,2 0 1,0 4,0 a2,2 0 1,0 -4,0 M55,33 a2,2 0 1,0 4,0 a2,2 0 1,0 -4,0" fill="#fff"/>' +
            '<ellipse cx="50" cy="40" rx="3.2" ry="2.2" fill="' + k + '"/>' + smile(42) + cheeks(42),
          "#d9d2cc");
      },
      penguin: function () {
        var c = "#2c3a72", sh = "#1d2550";
        return guard(c, true,
          '<path d="M-69,46 L-82,52 L-67,55 Z" fill="' + sh + '"/>',
          '<ellipse cx="-8" cy="58" rx="60" ry="13" fill="#fff8f3"/>' +
            '<path d="M6,22 C-1,32 1,46 12,51 C10,40 11,31 6,22 Z" fill="' + sh + '"/>' + band(sh, -64, 26, 17.5),
          '<path d="M50,30 C46,23 33,25 34,37 C35,48 44,52 50,52 C56,52 65,48 66,37 C67,25 54,23 50,30 Z" fill="#fff8f3"/>' +
            eyes(36) + '<path d="M46.5,40 h7 l-3.5,5 z" fill="' + BRASS.base + '"/>' + cheeks(43) +
            '<path d="M36.5,58.5 a5.5,2.8 0 1,0 11,0 a5.5,2.8 0 1,0 -11,0 M52.5,58.5 a5.5,2.8 0 1,0 11,0 a5.5,2.8 0 1,0 -11,0" fill="' + BRASS.base + '"/>',
          sh);
      },
      fox: function () {
        var c = "#ee7a3a", sh = "#c95f26", w = "#fff1e0", dk = "#5a2430";
        return guard(c, true,
          '<ellipse cx="-72" cy="22" rx="10" ry="19" transform="rotate(-28 -72 22)" fill="' + c + '"/><circle cx="-79.5" cy="8" r="6.4" fill="' + w + '"/>' +
          '<path d="M30,24 L32,-2 L49,14 Z M51,14 L68,-2 L70,24 Z" fill="' + c + '"/>' +
          '<path d="M31.4,6 L32,-2 L38.6,4.4 Z M61.4,4.4 L68,-2 L68.6,6 Z" fill="' + dk + '"/><path d="M35,17 L36,7 L43.4,14 Z M56.6,14 L64,7 L65,17 Z" fill="' + w + '"/>',
          '<ellipse cx="-6" cy="58" rx="58" ry="10" fill="' + w + '"/>' + NECK + '"' + sh + '"/>' + band(sh, -64, 26, 17.5),
          '<path d="M27,38 C33,46 42,49 50,44 C58,49 67,46 73,38 C73,52 63,58 50,58 C37,58 27,52 27,38 Z" fill="' + w + '"/>' +
            eyes(33) + '<ellipse cx="50" cy="44.5" rx="3" ry="2.1" fill="#1d1420"/>' + cheeks(40),
          sh);
      },
      strawberry: function () {
        var lv = "";
        for (var k = 0; k < 5; k++) {
          var a = (-64 + k * 32) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
          lv += "M-68,35 Q" + n1(-68 + ca * 9 - sa * 5) + "," + n1(35 + sa * 9 + ca * 5) + " " + n1(-68 + ca * 19) + "," + n1(35 + sa * 19) +
            " Q" + n1(-68 + ca * 9 + sa * 5) + "," + n1(35 + sa * 9 - ca * 5) + " -68,35 Z";
        }
        return guard("#e8455a", false, "",
          seeds(-48, 66, 25, 54, 11, 8.5, 1, "#ffd36b") + '<ellipse cx="6" cy="24" rx="34" ry="3.4" fill="#fff" opacity=".28"/>' + band("#c42f46", -64, 60, 17.5),
          '<path d="M-70,35 L-83,30" stroke="#2f9a6a" stroke-width="3.4" stroke-linecap="round"/>' +
            '<path d="' + lv + '" fill="#2f9a6a"/><circle cx="-68" cy="35" r="3.4" fill="#5fc48e"/>',
          "#c42f46");
      },
      watermelon: function () {
        // dark rind, a pale band, then pink flesh: the same outline with its bottom lifted
        return guard("#2f9a6a", false, "",
          '<path d="M-72,10 H74 V36 C72,48 63,54 52,54 Q0,60 -56,52 C-66,50 -72,44 -72,36 Z" fill="#b8e68a"/>' +
            '<path d="M-72,10 H74 V34 C72,45 63,50 52,50 Q0,56 -56,48 C-66,46 -72,41 -72,34 Z" fill="#ff6584"/>' +
            seeds(-50, 62, 24, 41, 14, 8.5, 1.5, "#2a1b30") + band("#e8506f", -64, 60, 17.5),
          "", "#d94a68");
      },
      lemon: function () {
        var c = "#ffd84d";
        return guard(c, false, '<ellipse cx="73" cy="35" rx="6" ry="5" fill="' + c + '"/>',
          slices([[-36, 38], [2, 39], [40, 37]], 10, "#fff6c4", "#ffe066") +
            '<path d="M-18,28 h.1 M20,49 h.1 M-52,48 h.1 M58,24 h.1 M-6,53 h.1 M60,50 h.1" stroke="#fff6c4" stroke-width="3" stroke-linecap="round"/>' + band("#e8b92a", -64, 60, 17.5),
          '<path d="M-70,29 L-76,21" stroke="#8a6238" stroke-width="2.6" stroke-linecap="round"/>' + leaf(-75.5, 21.5, -84, 16),
          "#e8b92a");
      },
      kiwi: function () {
        return guard("#8a6238", false, "",
          // a brown fuzzy rim, bright green flesh, a pale core and a ring of black seeds
          '<path d="M-60,17.5 H56 C64,17.5 69,26 69,35 C69,48 61,54 52,54 Q0,59.5 -56,52 C-64,50.5 -68,44 -68,35 C-68,25 -66,17.5 -60,17.5 Z" fill="#8fcf4f"/>' +
            '<path d="M-60,21 L-50,30 M-30,21 L-24,29 M0,20 V28 M30,21 L24,29 M58,24 L48,31 M-58,51 L-48,45 M0,55 V47 M54,51 L46,45" stroke="#b5e283" stroke-width="1.6" stroke-linecap="round"/>' +
            '<ellipse cx="0" cy="37" rx="52" ry="5.5" fill="#f4f0c8"/>' +
            seeds(-44, 46, 26.4, 26.4, 10, 9, 1.3, "#1d1420") + seeds(-39, 51, 43.4, 43.4, 10, 9, 1.3, "#1d1420") +
            band("#7a5532", -64, 60, 17.5),
          "", "#6b4a2a");
      },
      cherry: function () {
        var stems = "", fruit = "", hi = "", leaves = "";
        [[-44, 30], [-2, 34], [40, 30]].forEach(function (p) {
          var x = p[0], y = p[1];
          stems += "M" + (x - 5) + "," + (y + 12) + " Q" + (x - 3) + "," + (y + 2) + " " + (x + 3) + "," + (y - 4) + " Q" + (x + 4) + "," + (y + 5) + " " + (x + 7) + "," + (y + 11);
          fruit += "M" + (x - 10.2) + "," + (y + 15) + "a5.2,5.2 0 1,0 10.4,0a5.2,5.2 0 1,0 -10.4,0M" + (x + 1.8) + "," + (y + 14) + "a5.2,5.2 0 1,0 10.4,0a5.2,5.2 0 1,0 -10.4,0";
          hi += "M" + (x - 7) + "," + (y + 13) + "h.1M" + (x + 5) + "," + (y + 12) + "h.1";
          leaves += leaf(x + 3, y - 4, -20, 10);
        });
        return guard("#ffc4d6", false, "",
          '<path d="' + stems + '" fill="none" stroke="#2f9a6a" stroke-width="1.6" stroke-linecap="round"/><path d="' + fruit + '" fill="#d6284e"/>' + leaves +
            '<path d="' + hi + '" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' + band("#f7a8c2", -64, 60, 17.5),
          "", "#f29ab6");
      }
    };

    // guards worn on a mounted blade (blade-local coordinates)
    function bladeGuard(kind) {
      var s = '<path d="' + SKB_D + '" transform="translate(2,3)" fill="#000" opacity=".2"/>';
      if (kind === "strawberry") {
        s += '<path d="' + SKB_D + '" fill="#e8455a"/><g clip-path="' + ref("skb") + '">' +
          seeds(4, 100, 19, 30, 10, 7.5, 0.9, "#ffd36b") + band("#c42f46", -2, 92, 14) +
          '<rect x="-4" y="6" width="128" height="34" fill="' + ref("terry") + '"/></g>' + leaf(112, 6, -60, 10) + leaf(114, 7, -10, 10);
      } else if (kind === "panda") {
        s += '<path d="M101.6,3 a5.5,5.5 0 1,0 11,0 a5.5,5.5 0 1,0 -11,0" fill="#2a2230"/>' +
          '<path d="' + SKB_D + '" fill="#fbf7f2"/><g clip-path="' + ref("skb") + '">' + band("#ece5de", -2, 92, 14) +
          '<rect x="-4" y="6" width="128" height="34" fill="' + ref("terry") + '"/></g>' +
          '<ellipse cx="104" cy="19" rx="4" ry="5.2" transform="rotate(-25 104 19)" fill="#2a2230"/><ellipse cx="115" cy="19" rx="4" ry="5.2" transform="rotate(25 115 19)" fill="#2a2230"/>' +
          '<path d="M103,18.4 a1.5,1.5 0 1,0 3,0 a1.5,1.5 0 1,0 -3,0 M113,18.4 a1.5,1.5 0 1,0 3,0 a1.5,1.5 0 1,0 -3,0" fill="#fff"/>' +
          '<ellipse cx="109.5" cy="25" rx="2.4" ry="1.7" fill="#2a2230"/>';
      } else if (kind === "orange") {
        s += '<path d="' + SKB_D + '" fill="#ff9a3c"/><g clip-path="' + ref("skb") + '">' +
          slices([[22, 25], [48, 27], [74, 27], [98, 25]], 7, "#fff1e0", "#ffc27a") + band("#e97f22", -2, 92, 14) +
          '<rect x="-4" y="6" width="128" height="34" fill="' + ref("terry") + '"/></g>' + leaf(113, 5, -50, 11);
      } else {
        // frog: green with eye bumps at the toe end
        s += '<path d="M96.6,6 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0 M107.6,5 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0" fill="#5cc27e"/>' +
          '<path d="' + SKB_D + '" fill="#5cc27e"/><g clip-path="' + ref("skb") + '">' +
          '<ellipse cx="50" cy="37" rx="56" ry="6" fill="#a6e3b0"/><path d="M20.6,22 a3.4,3.4 0 1,0 6.8,0 a3.4,3.4 0 1,0 -6.8,0 M41.6,26 a2.4,2.4 0 1,0 4.8,0 a2.4,2.4 0 1,0 -4.8,0 M61,21 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0" fill="#2f9a6a"/>' +
          band("#3fa866", -2, 88, 14) + '<rect x="-4" y="6" width="128" height="34" fill="' + ref("terry") + '"/></g>' +
          '<path d="M99,6 a3.6,3.6 0 1,0 7.2,0 a3.6,3.6 0 1,0 -7.2,0 M110,5 a3.6,3.6 0 1,0 7.2,0 a3.6,3.6 0 1,0 -7.2,0" fill="#fff"/>' +
          '<path d="M101,6.4 a1.9,1.9 0 1,0 3.8,0 a1.9,1.9 0 1,0 -3.8,0 M112,5.4 a1.9,1.9 0 1,0 3.8,0 a1.9,1.9 0 1,0 -3.8,0" fill="#1d1420"/>' +
          '<path d="M99,19 Q107,25 116,17" fill="none" stroke="#1d6b45" stroke-width="1.5" stroke-linecap="round"/>';
      }
      return s;
    }

    /* -- a figure skate boot, toe to the right (local 0..124 x 0..146; a blade adds 29 below) -- */
    // high leather boot leaning slightly forward, padded collar, tongue, laces, speed hooks, stacked heel
    var BOOT_D = "M22,8 C20,40 24,62 18,88 C13,106 8,118 12,130 L44,130 C50,130 52,140 60,140 L112,140 C124,140 126,118 110,110 C94,104 80,96 72,76 C67,60 68,32 72,12 C58,5 36,4 22,8 Z";
    var BOOTS = {
      white: { body: "#fff8f3", shade: "#eadfd2", deep: "#c9b8a5", strip: "#e2d4c4", lace: "#ffffff", sole: "#8a6238", heel: "#a8794a" },
      cream: { body: "#fbe9d0", shade: "#ecd3b1", deep: "#c9a87e", strip: "#e6cba6", lace: "#fff8f3", sole: "#8a6238", heel: "#a8794a" },
      tan: { body: "#dcae7e", shade: "#c79560", deep: "#8f6238", strip: "#c08a55", lace: "#fbe9d0", sole: "#5c3e24", heel: "#6b4a2a" },
      black: { body: "#2e2636", shade: "#221b29", deep: "#6b5f78", strip: "#463c50", lace: "#fff8f3", sole: "#1d1420", heel: "#2a2230" },
      lilac: { body: "#dccbf3", shade: "#c8b3ea", deep: "#8f6bd6", strip: "#cbb6ec", lace: "#ffffff", sole: "#6b4aa8", heel: "#8f6bd6" },
      pink: { body: "#ffd6e5", shade: "#f6bcd1", deep: "#e0457a", strip: "#f7c3d6", lace: "#ffffff", sole: "#b8433f", heel: "#e07a9b" }
    };
    function boot(c, o) {
      var s = "", x = "", lace = [[103, 112.5], [95, 108], [87, 102.5], [80, 96], [74.5, 88.5], [70.5, 80.5], [68, 71.5]];
      // its soft shadow on the slats behind
      s += '<g fill="#3a2a20" opacity=".2"><path d="' + BOOT_D + '" transform="translate(6,4)"/>' + (o.blade ? '<path d="' + BLADE_D + '" transform="translate(14,150)" fill-rule="evenodd"/>' : "") + "</g>";
      if (o.blade) s += g("translate(8,146)", bladeParts(o.blade, false) + (o.guard ? bladeGuard(o.guard) : ""));
      for (var i = 0; i < lace.length; i++) x += "M" + n1(lace[i][0] - 2.8) + "," + n1(lace[i][1] - 2.8) + "l5.6,5.6m0,-5.6l-5.6,5.6";
      s += '<path d="' + BOOT_D + '" fill="' + c.body + '"/>' +
        '<path d="M18,88 C13,106 8,118 12,130 H42 C38,113 32,98 18,88 Z M96,140 C93,126 99,115 110,110 C126,118 124,140 112,140 Z" fill="' + c.shade + '"/>' +
        '<path d="M24,11 C36,7 56,7 70,13" fill="none" stroke="' + c.shade + '" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="M29,24 C29,44 30,62 26,80" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M19,84 C32,92 40,111 44,128 M93,139 C90,125 97,113 108,108" fill="none" stroke="' + c.deep + '" stroke-width="1.2" stroke-dasharray="2.5 2"/>' +
        '<path d="M106,114.5 C92,108 80,99.5 68,80 C63,62 64,34 67,13" fill="none" stroke="' + c.strip + '" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M62.5,24 C61,12 62,2 69,0 C76,-2 79,4 76.5,13 C75,19 73,23 71.5,26 Z" fill="' + c.strip + '"/>' +
        '<path d="M66,4 C69,1.5 73,1.5 75,4" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="' + x + 'M68,67 L67,61 L71,55 L67,50 L71,44 L67,39 L71,33 L67,28 L70,20" fill="none" stroke="' + c.lace + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M67,61 q5,0 6.5,-3.4 M67,50 q5,0 6.5,-3.4 M67,39 q5,0 6.5,-3.4 M67,28 q5,0 6.5,-3.4" fill="none" stroke="' + BRASS.dark + '" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M70,18 C62,10 60,21 70,18 C79,12 81,23 70,18 M70,18 L66,27 M70,18 L75,28" fill="none" stroke="' + c.lace + '" stroke-width="1.8" stroke-linecap="round"/>' +
        '<path d="M12,128 H44 L42,146 H17 Q12,146 12,141 Z" fill="' + c.heel + '"/>' +
        '<path d="M56,138 H113 Q123,138 122,143 Q121,146 116,146 H60 Q56,146 56,142 Z" fill="' + c.sole + '"/>';
      return s;
    }

    /* -- the sprite: shapes the pieces below reuse with <use> -- */
    // one <g> per kind of boot on the wall: [colours, options]; kindH() says how far below its top its lowest point is
    var KINDS = {
      w: [BOOTS.white, {}], wb: [BOOTS.white, { blade: SILVER }], wg: [BOOTS.white, { blade: GOLD }],
      c: [BOOTS.cream, {}], cb: [BOOTS.cream, { blade: SILVER }], tb: [BOOTS.tan, { blade: SILVER }],
      kb: [BOOTS.black, { blade: SILVER }], l: [BOOTS.lilac, { blade: SILVER }], p: [BOOTS.pink, {}],
      wf: [BOOTS.white, { blade: SILVER, guard: "frog" }], wo: [BOOTS.white, { blade: SILVER, guard: "orange" }],
      cs: [BOOTS.cream, { blade: SILVER, guard: "strawberry" }], kp: [BOOTS.black, { blade: SILVER, guard: "panda" }]
    };
    function kindH(k) { var o = KINDS[k][1]; return o.guard ? 182 : o.blade ? 176 : 146; }
    var bootDefs = "";
    for (var kk in KINDS) if (KINDS.hasOwnProperty(kk)) bootDefs += '<g id="' + id("b-" + kk) + '">' + boot(KINDS[kk][0], KINDS[kk][1]) + "</g>";

    // a boot box seen end on (0..70 x 0..44): the box takes the <use>'s fill, its lid the <use>'s color,
    // and its end label a little skate (the size is written over it by box())
    var SKATE_ICON = "M17,22.5 H22.6 V27.4 L28,29.6 Q30.6,30.8 30.6,33.4 H17 Z M16.4,34.6 H31 V36 H16.4 Z";
    var defs = '<svg class="fit-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
      '<pattern id="' + id("terry") + '" width="4.5" height="4.5" patternUnits="userSpaceOnUse"><circle cx="1.1" cy="1.1" r=".8" fill="#fff" fill-opacity=".2"/><circle cx="3.4" cy="3.4" r=".8" fill="#000" fill-opacity=".06"/></pattern>' +
      '<path id="' + id("skp") + '" d="' + SK_D + '"/>' +
      '<path id="' + id("skph") + '" d="' + SK_D + " " + HEAD_D + '"/>' +
      '<clipPath id="' + id("skc") + '"><path d="' + SK_D + '"/></clipPath>' +
      '<clipPath id="' + id("skh") + '"><path d="' + SK_D + " " + HEAD_D + '"/></clipPath>' +
      '<clipPath id="' + id("skb") + '"><path d="' + SKB_D + '"/></clipPath>' +
      '<clipPath id="' + id("gclip") + '"><path d="' + BLADE_D + '" clip-rule="evenodd"/></clipPath>' +
      '<g id="' + id("peg") + '"><circle cx="0" cy="6" r="4.4" fill="' + BRASS.dark + '"/><circle cx="-.6" cy="5.2" r="3.2" fill="' + BRASS.base + '"/><circle cx="-1.4" cy="4.4" r="1.1" fill="' + BRASS.hi + '"/></g>' +
      '<linearGradient id="' + id("bdim") + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".25"/><stop offset=".2" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>' +
      '<linearGradient id="' + id("glintg") + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<g id="' + id("box") + '"><rect x="1" y="8" width="68" height="36" rx="2"/>' +
        '<rect x="61" y="13" width="8" height="31" fill="#000" opacity=".12"/><rect x="1" y="13" width="68" height="2.6" fill="#000" opacity=".2"/>' +
        '<rect width="70" height="13" rx="2.5" fill="currentColor"/><rect x="2" y="1.4" width="66" height="2" rx="1" fill="#fff" opacity=".28"/>' +
        '<rect x="11" y="19.5" width="45" height="18" rx="2" fill="#fff8f3"/><path d="' + SKATE_ICON + '" fill="#24305e"/></g>' +
      // a knitted glove hanging fingers down (it takes the <use>'s fill), ribbed cuff on top
      '<g id="' + id("glove") + '"><rect x="-8" y="10" width="16" height="11" rx="2"/><rect x="-9" y="19" width="18" height="16" rx="5"/>' +
        '<rect x="-9" y="29" width="4.3" height="13" rx="2.1"/><rect x="-4.5" y="29" width="4.3" height="16.5" rx="2.1"/><rect x="0" y="29" width="4.3" height="15.5" rx="2.1"/><rect x="4.5" y="29" width="4.3" height="12" rx="2.1"/>' +
        '<rect x="-15" y="21" width="4.6" height="12" rx="2.3" transform="rotate(28 -12.7 22)"/>' +
        '<path d="M-5,11 V20 M-2,11 V20 M1,11 V20 M4,11 V20" stroke="#000" stroke-opacity=".14" stroke-width="1"/></g>' +
      bootDefs +
      "</defs></svg>";

    // a box at x, y: [box colour, lid colour] and the size on its label
    var BOX = { navy: ["#2f3d75", "#24305e"], pink: ["#ff8fc8", "#e0457a"], cream: ["#f3dcbc", "#fbe9d0"], lilac: ["#b9a2ea", "#8f6bd6"], red: ["#d0605a", "#b8433f"] };
    function box(x, y, col, size) {
      return '<use href="#' + id("box") + '" x="' + x + '" y="' + y + '" fill="' + BOX[col][0] + '" color="' + BOX[col][1] + '"/>' +
        '<text x="' + (x + 43.5) + '" y="' + (y + 32.4) + '" text-anchor="middle">' + size + "</text>";
    }
    var SIZES = ["4", "4&#189;", "5", "5&#189;", "6", "6&#189;", "7", "7&#189;", "8"];
    var TXT = ' font-family="Nunito, sans-serif" font-weight="800" fill="#5a2430"';
    function svgOpen(cls, w, h) { return '<svg class="' + cls + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true" focusable="false">'; }

    /* -- the wall of boots: 4 rows of 7 on little clear shelves, a size strip under each -- */
    var GRID = [
      ["wb", "w", "wb", "c", "wb", "kb", "w"],
      ["w", "wf", "wb", "l", "wb", "w", "cb"],
      ["c", "wb", "wo", "w", "tb", "wb", "p"],
      ["wb", "kp", "w", "cs", "wb", "w", "wg"]
    ];
    var STRIPE = ["#e0457a", "#7be3ff", "#f2b83f", "#8f6bd6"];
    var CW = 62, RH = 94, BK = 0.43, gBoots = "", shelves = "", tags = "", stripes = "", sizes = "";
    GRID.forEach(function (row, r) {
      var sy = 82 + r * RH, st = "";
      row.forEach(function (k, i) {
        var x = 9 + i * CW;
        gBoots += '<use href="#' + id("b-" + k) + '" transform="translate(' + (x + 4) + "," + n1(sy - kindH(k) * BK) + ") scale(" + BK + ')"/>';
        shelves += "M" + (x + 1) + "," + sy + "h60v4h-60z";
        tags += "M" + (x + 4) + "," + (sy + 6) + "h54v10.5h-54z";
        st += "M" + (x + 4) + "," + (sy + 6) + "h7v10.5h-7z";
        sizes += '<text x="' + (x + 35) + '" y="' + (sy + 14.3) + '">' + SIZES[i + (r % 2)] + "</text>";
      });
      stripes += '<path d="' + st + '" fill="' + STRIPE[r] + '"/>';
    });
    var boots = svgOpen("fw-boots", 452, 384) +
      // each shelf: a clear ledge with a bright front edge and a soft shadow on the slats under it
      '<path d="' + shelves + '" transform="translate(2,4)" fill="#3a2a20" opacity=".16"/>' + gBoots +
      '<path d="' + shelves + '" fill="#f4fbff" fill-opacity=".62"/>' +
      '<path d="' + shelves.replace(/v4h-60z/g, "v1.2h-60z") + '" fill="#fff"/>' +
      '<path d="' + tags + '" fill="#fff8f3"/>' + stripes +
      '<g font-size="7.6" text-anchor="middle"' + TXT + ">" + sizes + "</g></svg>";

    /* -- above the boots: three little framed pictures and a row of blades on brass pegs -- */
    function frame(x, y, w, h, mat, art) {
      return '<path d="M' + (x + w / 2) + "," + (y - 16) + " L" + (x + 8) + "," + y + " M" + (x + w / 2) + "," + (y - 16) + " L" + (x + w - 8) + "," + y + '" stroke="#5c3e24" stroke-width="1.4" fill="none"/>' +
        '<circle cx="' + (x + w / 2) + '" cy="' + (y - 17) + '" r="3" fill="' + BRASS.dark + '"/>' +
        '<rect x="' + (x + 4) + '" y="' + (y + 5) + '" width="' + w + '" height="' + h + '" rx="3" fill="#3a2a20" opacity=".2"/>' +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="' + WOOD.frame + '"/>' +
        '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="' + (w - 4) + '" height="3" rx="1.5" fill="' + WOOD.top + '"/>' +
        '<rect x="' + (x + 7) + '" y="' + (y + 7) + '" width="' + (w - 14) + '" height="' + (h - 14) + '" fill="' + mat + '"/>' +
        g("translate(" + (x + w / 2) + "," + (y + h / 2) + ")", art);
    }
    var flake = "";
    for (var fa = 0; fa < 6; fa++) flake += '<path d="M0,0 V-19 M0,-12 L-5,-16 M0,-12 L5,-16" transform="rotate(' + fa * 60 + ')"/>';
    var frames = svgOpen("fw-frames", 452, 132) +
      frame(46, 26, 92, 70, "#ffd9e6", '<use href="#' + id("b-wb") + '" transform="translate(-20,-28) scale(.31)"/>') +
      frame(186, 20, 80, 80, "#24305e", '<g stroke="#fff8f3" stroke-width="3" stroke-linecap="round" fill="none">' + flake + "</g>" + '<circle r="3.4" fill="#7be3ff"/>') +
      frame(314, 30, 92, 62, "#fbe9d0", '<path d="M0,15 C-24,0 -22,-19 -10,-19 C-5,-19 0,-15 0,-9 C0,-15 5,-19 10,-19 C22,-19 24,0 0,15 Z" fill="#e0457a"/><path d="M-12,-11 q-4,3 -3,9" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".7"/>');
    // blades hung by the arch, the middle one gold with a glint running along it
    var BX = [58, 142, 226, 310, 394], bladeK = 0.6;
    BX.forEach(function (cx, i) {
      var x0 = n1(cx - 57 * bladeK), top = 108;
      frames += '<path d="' + BLADE_D + '" fill-rule="evenodd" fill="#3a2a20" opacity=".16" transform="translate(' + n1(x0 + 2.5) + "," + (top + 3) + ") scale(" + bladeK + ')"/>' +
        g("translate(" + x0 + "," + top + ") scale(" + bladeK + ")", bladeParts(i === 2 ? GOLD : SILVER, i === 2)) +
        '<use href="#' + id("peg") + '" transform="translate(' + n1(x0 + 41 * bladeK) + "," + n1(top + 3.6 * bladeK - 4) + ') scale(.8)"/>';
    });
    frames += "</svg>";

    /* -- below the boots: two rows of animal and fruit soft guards on brass hooks, then pastel gloves -- */
    // fruit in the columns the skater's head can land on, so no dark guard or animal face sits by her head
    var GROWS = [["bunny", "fox", "panda", "strawberry", "lemon"], ["cat", "penguin", "kiwi", "cherry", "watermelon"]], gk = 0.55, hooks = "";
    GROWS.forEach(function (row, r) {
      row.forEach(function (kind, i) {
        var inner = GUARDS[kind]();
        hooks += g("translate(" + (48 + i * 84 + (r ? 20 : 0)) + "," + (2 + r * 50) + ") scale(" + gk + ")", kind === "strawberry" ? '<g class="fw-swing">' + inner + "</g>" : inner);
      });
    });
    // knitted gloves in pairs, each pair clipped to a little card on a hook
    var GLOVES = [["#c4b0ea", "#a48bd8"], ["#ffb3cf", "#f08fb4"], ["#a8dcf0", "#7fc4e0"], ["#fbe9d0", "#e3c8a2"], ["#a6e3b0", "#7ccb8e"], ["#8f6bd6", "#6b4aa8"], ["#ffb3cf", "#f08fb4"], ["#c4b0ea", "#a48bd8"], ["#a8dcf0", "#7fc4e0"]];
    GLOVES.forEach(function (c, i) {
      hooks += g("translate(" + (30 + i * 49) + ",106)", '<use href="#' + id("glove") + '" x="-4" y="3" fill="' + c[1] + '"/><use href="#' + id("glove") + '" x="3" fill="' + c[0] + '"/>' +
        '<rect x="-10" y="1" width="20" height="10" rx="2" fill="#fff8f3"/><circle cx="0" cy="4.4" r="1.5" fill="#5a2430"/><path d="M-6,8 H6" stroke="' + c[1] + '" stroke-width="1.6"/>');
    });
    hooks = svgOpen("fw-hooks", 452, 156) + hooks + "</svg>";

    /* -- the boot boxes: a wooden shelf unit, its shelves full of boxes stacked two high, three across -- */
    // n shelves: 6 for the tall unit of wide screens (viewBox 240 x 660), 4 for tall screens (240 x 456)
    var BAYS = [["navy", "navy"], ["pink", "cream"], ["lilac", "lilac"], ["red", "navy"], ["cream", "cream"], ["pink", "lilac"]];
    function boxUnit(n, cls) {
      var H = 48 + n * 102, bx = "", boards = "";
      for (var b = 0; b < n; b++) {
        var top = 18 + b * 102, bay = BAYS[b];
        for (var tier = 0; tier < 2; tier++) {
          for (var c = 0; c < 3; c++) bx += box(14 + c * 72, top + 6 + tier * 45, bay[tier], SIZES[(b * 2 + tier * 3 + c * 2) % SIZES.length]);
        }
        boards += '<rect x="0" y="' + (top + 96) + '" width="240" height="9" fill="' + WOOD.frame + '"/><rect x="0" y="' + (top + 96) + '" width="240" height="2.6" fill="' + WOOD.top + '"/>' +
          '<rect x="10" y="' + (top + 105) + '" width="220" height="5" fill="#000" opacity=".2"/>';
      }
      return svgOpen(cls, 240, H) +
        '<rect x="0" y="12" width="240" height="' + (H - 24) + '" fill="' + WOOD.back + '"/>' +
        '<rect x="0" y="12" width="240" height="' + (H - 24) + '" fill="url(#' + id("bdim") + ')"/>' +
        '<g font-size="9"' + TXT + ">" + bx + "</g>" + boards +
        // the frame: two posts, a crown on top and a plinth on the floor
        '<rect x="0" y="0" width="11" height="' + H + '" fill="' + WOOD.frame + '"/><rect x="229" y="0" width="11" height="' + H + '" fill="' + WOOD.frame + '"/>' +
        '<rect x="2.5" y="0" width="3" height="' + H + '" fill="' + WOOD.top + '" opacity=".8"/><rect x="231.5" y="0" width="3" height="' + H + '" fill="' + WOOD.top + '" opacity=".8"/>' +
        '<rect x="-4" y="0" width="248" height="16" rx="3" fill="' + WOOD.frame + '"/><rect x="-4" y="0" width="248" height="4" rx="2" fill="' + WOOD.top + '"/><rect x="0" y="14" width="240" height="3" fill="' + WOOD.dark + '"/>' +
        '<rect x="-2" y="' + (H - 22) + '" width="244" height="22" rx="2" fill="' + WOOD.dark + '"/><rect x="-2" y="' + (H - 22) + '" width="244" height="3" fill="' + WOOD.frame + '"/>' +
        "</svg>";
    }

    /* -- on the floor beside the fitting bench: boxes stacked three high and two high, and a padded chair to wait in -- */
    // the chair is drawn 108 x 142 and stands a little larger than that, next to the bench
    var floor = '<ellipse cx="92" cy="194" rx="94" ry="6" fill="#1d1420" opacity=".3"/><ellipse cx="288" cy="194" rx="76" ry="6" fill="#1d1420" opacity=".3"/>' +
      '<g transform="translate(210,-7) scale(1.42)"><path d="M22,84 h6 v56 h-6z M80,84 h6 v56 h-6z" fill="#1a2350"/>' +
      '<rect x="18" y="8" width="72" height="66" rx="13" fill="#2b3a75"/><rect x="24" y="14" width="60" height="52" rx="10" fill="#e0457a"/>' +
      '<rect x="28" y="17" width="52" height="6" rx="3" fill="#ff8fc8" opacity=".7"/>' +
      '<path d="M41.6,40 a2.4,2.4 0 1,0 4.8,0 a2.4,2.4 0 1,0 -4.8,0 M61.6,40 a2.4,2.4 0 1,0 4.8,0 a2.4,2.4 0 1,0 -4.8,0" fill="#b8325f"/>' +
      '<rect x="4" y="70" width="100" height="22" rx="9" fill="#c93d6e"/><rect x="8" y="71" width="92" height="7" rx="3.5" fill="#ff8fc8"/>' +
      '<path d="M10,90 h7 v52 h-7z M91,90 h7 v52 h-7z" fill="#24305e"/><path d="M10,116 H98" stroke="#24305e" stroke-width="4"/></g>';
    [["navy", 2, 152], ["pink", 5, 112], ["cream", 0, 72], ["red", 94, 152], ["lilac", 97, 112]].forEach(function (s) {
      floor += g("translate(" + s[1] + "," + s[2] + ")", '<rect x="0" y="6" width="86" height="34" rx="2" fill="' + BOX[s[0]][0] + '"/>' +
        '<rect x="76" y="12" width="10" height="28" fill="#000" opacity=".12"/>' +
        '<rect width="86" height="12" rx="2.5" fill="' + BOX[s[0]][1] + '"/><rect x="0" y="12" width="86" height="2.4" fill="#000" opacity=".2"/>' +
        '<rect x="2" y="1.4" width="82" height="2" rx="1" fill="#fff" opacity=".28"/>' +
        '<rect x="24" y="18" width="34" height="16" rx="2" fill="#fff8f3"/>' + g("translate(13.6,-3.6)", '<path d="' + SKATE_ICON + '" fill="#24305e"/>'));
    });
    var stack = svgOpen("fw-stack", 364, 200) + floor + "</svg>";

    return { defs: defs, frames: frames, boots: boots, hooks: hooks, boxes: boxUnit(6, "fw-boxes"), boxesShort: boxUnit(4, "fw-boxes"), stack: stack };
  }

  /* ---------- Fitting shop: a skater trying on new skates (background scene) ---------- */

  // An original illustration of the shopkeeper (the same friendly person as KEEPERS[0]) kneeling to lace
  // a skater's brand-new skate. Everything is drawn in one 640 x 420 box, standing on a little rug.
  // Ids start with "fs-", classes with "fs-"; the gentle motion lives in style.css.
  function fitSceneSVG() {
    // small private helpers for building SVG text
    function P(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '"' + (more || "") + "/>"; }
    function S(d, color, w, more) {
      return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"' + (more || "") + "/>";
    }
    function C(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '"' + (more || "") + "/>"; }
    function E(x, y, rx, ry, fill, more) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '"' + (more || "") + "/>"; }
    function G(more, inner) { return "<g" + more + ">" + inner + "</g>"; }
    // a simple mitten hand: fingers point along angle a (degrees); flip puts the thumb on the other side
    function hand(x, y, a, flip, skinC, lineC) {
      return G(' transform="translate(' + x + "," + y + ") rotate(" + a + ")" + (flip ? " scale(1,-1)" : "") + '"',
        P("M-8,-5.5 Q2,-8.5 8,-5.5 Q12.5,-2.5 11.5,2 Q10,6.5 2,6.8 L-8,5.5 Z", skinC) +
        P("M-3,-5 Q1,-12 6,-9.5 Q6,-6 2,-4 Z", skinC) +
        S("M4,-1.5 H9.5 M3.5,2.2 H9", lineC, 1.2));
    }

    // One figure skate, pointing right. (x, y) is the back of the boot's sole; foot length is about 60 at s = 1.
    // o.worn draws an old, creased pair with a strawberry soft guard over the blade.
    function skate(x, y, s, o) {
      var lace = "", k;
      for (k = 0; k < 5; k++) {           // criss-cross laces down the front of the boot
        var t = k / 4, ax = 19 + t * 21, ay = -52 + t * 28;
        lace += S("M" + (ax - 1) + "," + (ay - 2) + " L" + (ax + 5) + "," + (ay + 3) + " M" + (ax - 1) + "," + (ay + 3) + " L" + (ax + 5) + "," + (ay - 2), o.lace, 1.6);
      }
      var hooks = C(23.6, -51, 1.7, o.metal) + C(24.4, -45.5, 1.7, o.metal) + C(25.8, -40, 1.7, o.metal) +
        C(29, -34.5, 1.4, o.metal) + C(33, -30.2, 1.4, o.metal) + C(37.6, -26.6, 1.4, o.metal) + C(42.4, -23.6, 1.4, o.metal);
      var blade = o.worn
        // a fluffy fruit-theme soft guard: a strawberry with seeds and a leafy cap at the toe
        ? P("M-9,6 Q-10,2 -5,2 H56 Q66,1 68,7 Q69,14 60,15 Q50,17 40,15 Q30,17 20,15 Q10,17 0,15 Q-9,15 -9,6 Z", "#e0457a") +
          C(4, 9, 1.1, "#fff2c8") + C(14, 11, 1.1, "#fff2c8") + C(24, 9, 1.1, "#fff2c8") + C(34, 11, 1.1, "#fff2c8") + C(44, 9, 1.1, "#fff2c8") + C(52, 12, 1.1, "#fff2c8") +
          P("M58,2 Q64,-3 70,1 Q66,3 68,7 Q63,4 58,6 Z", "#2f9a6a")
        : P("M0,2.5 H12 L10.5,9 H1.5 Z M36,2.5 H56 L54,9 H38 Z", o.bladeShade) +
          P("M-7,9 Q-7,7 -5,7 H58 Q61,7 61,9.5 Q60,12 56,12 Q26,13.6 -3,12 Q-7,11.5 -7,9 Z", o.blade) +
          P("M55,2.5 H62 Q66.5,2.5 67,5.4 L64.4,6.3 L66.6,8 L63.6,8.9 L65,10.6 L61.4,11.5 L58.5,11.9 Z", o.blade) +   // the toe pick and its teeth
          P("M60.5,4 H62 Q64.8,4.2 65.3,5.5 L63,6.3 L64.9,7.9 L62.3,8.7 L63.4,10.2 L60.5,10.8 Z", o.bladeShade) +
          S("M-3,8.6 H54", o.glint, 0.9, ' opacity=".9"');
      var worn = o.worn
        ? S("M2,-31 Q11,-34 20,-30 M1,-26 Q9,-29 18,-25 M44,-14 Q50,-15 54,-12", o.crease, 1.3) +
          E(52, -8, 4, 2.2, o.crease, ' opacity=".6"') +
          S("M23,-53 C31,-48 33,-37 29,-28 M24,-50 C34,-44 37,-30 33,-22", o.lace, 1.5)    // loose laces hanging down
        : S("M3,-50 C1,-40 2,-30 5,-22", "#ffffff", 2, ' opacity=".8"');                   // shine on the new leather
      return G(' transform="translate(' + x + "," + y + ") scale(" + s + ')"',
        P("M17,-55 Q19,-67 29,-63 Q34,-61 31,-54 L27,-40 Z", o.boot) + S("M18,-56 Q20,-66 29,-62 Q33,-60 31,-54", o.shade, 1.6) +   // tongue
        P("M0,0 C-6,-4 -7,-16 -4,-24 C-2,-29 1,-33 1,-39 C1,-45 -2,-49 -2,-55 Q10,-59 23,-56 C23,-50 24,-44 27,-38 C31,-31 37,-25 47,-21 C57,-18 63,-13 63,-6 Q63,0 57,0 Z", o.boot) +
        P("M0,0 C-6,-4 -7,-16 -4,-24 C-2,-29 1,-33 1,-39 C1,-45 -2,-49 -2,-55 Q2,-56 6,-56 C5,-48 6,-42 6,-36 C5,-26 4,-14 9,0 Z", o.shade) +
        P("M-2,-55 Q10,-59 23,-56 L23,-52 Q10,-55 -1,-51 Z", o.shade) +              // padded collar
        P("M18,-55 C19,-47 21,-41 25,-35 C30,-28 36,-24 43,-21 L47,-22 C39,-25 33,-30 29,-37 C26,-43 25,-49 24,-56 Z", o.shade) +
        lace + hooks + worn +
        P("M-3,0 H58 Q62,0 62,2.8 H-3 Z", o.sole) + P("M-3,0 H13 V4 H-3 Z", o.heel) +
        blade);
    }

    var svg = "";

    // ---- the little oval rug, and soft shadows on it ----
    svg += E(330, 401, 306, 19, "#fbe9d0") + E(330, 401, 294, 15.5, "#e0457a") + E(330, 401, 278, 12.5, "#6b4aa8") +
      '<ellipse cx="330" cy="401" rx="286" ry="14" fill="none" stroke="#fbe9d0" stroke-width="1.4" stroke-dasharray="2 6" opacity=".55"/>';
    svg += G(' fill="#1d1420" opacity=".3"',
      E(154, 398, 112, 6) + E(288, 398, 44, 4) + E(420, 398, 70, 5) + E(330, 395, 26, 3) + E(52, 399, 40, 4));

    // ---- the padded fitting bench ----
    svg += P("M78,326 H88 V392 H78 Z M220,326 H230 V392 H220 Z", "#6e4e2c") +            // back legs
      P("M58,326 H70 V398 H58 Z M238,326 H250 V398 H238 Z M64,364 H244 V371 H64 Z", "#8a6238") +
      '<rect x="50" y="316" width="208" height="12" rx="3" fill="#a8794a"/>' +
      P("M44,300 Q44,288 58,288 H250 Q264,288 264,300 V308 Q264,320 252,320 H56 Q44,320 44,308 Z", "#f2b83f") +
      P("M48,297 Q49,289 60,289 H248 Q259,289 260,297 Z", "#ffd36b") +
      G(' fill="#c48a1e"', C(78, 307, 2.6) + C(120, 307, 2.6) + C(162, 307, 2.6)) +
      S("M72,302 L78,307 L72,312 M84,302 L78,307 L84,312 M114,302 L120,307 L114,312 M126,302 L120,307 L126,312 M156,302 L162,307 L156,312", "#e0a32e", 1.2);

    // ---- old, worn skates beside the bench ----
    var old = { boot: "#d9c4a6", shade: "#bfa684", lace: "#efe4d0", metal: "#a58b6a", crease: "#a3875f", sole: "#6e4e2c", heel: "#5a3e22", worn: true };
    svg += skate(50, 381, 0.84, old) + skate(10, 387, 0.9, old);

    // ---- the open skate box: lid propped behind, tissue paper puffing out ----
    svg += G(' transform="rotate(-7 160 360)"',
      '<rect x="108" y="326" width="100" height="42" rx="4" fill="#2b3a75"/><rect x="108" y="326" width="100" height="42" rx="4" fill="none" stroke="#f2b83f" stroke-width="2.4"/>' +
      S("M158,336 V358 M148,341 L168,353 M148,353 L168,341", "#fbe9d0", 2, ' opacity=".85"'));   // a plain snowflake, no brand
    svg += P("M116,368 Q124,346 140,354 Q148,338 162,350 Q176,336 186,352 Q200,346 206,366 Z", "#fff8f3") +
      P("M124,368 Q132,354 144,360 Q154,350 166,360 Q176,352 184,364 L188,368 Z", "#ff8fc8") +
      P("M114,366 L206,366 L214,358 L122,358 Z", "#1a2350") +
      P("M114,366 H206 V398 H114 Z", "#24305e") + P("M206,366 L214,358 V390 L206,398 Z", "#1a2350") +
      P("M114,366 H206 V371 H114 Z", "#f2b83f") +
      P("M150,366 Q160,350 172,360 Q178,354 186,364 L188,366 Z", "#fff8f3", ' opacity=".95"');

    // ---- the skater's free foot in a pink sock, swinging a little ----
    svg += G(' class="fs-swing"',
      S("M260,292 L232,362", "#a87455", 18) +
      P("M225,342 L243,349 L235,366 Q247,372 250,382 Q250,390 240,388 Q230,385 223,372 Q218,362 225,342 Z", "#ff8fc8") +
      S("M226,344 L243,351", "#fff8f3", 4) + C(231, 360, 1.6, "#fff8f3") + C(238, 377, 1.6, "#fff8f3"));

    // ---- the skater: sitting on the bench, hands clasped, so excited ----
    var skin = "#a9714f", tights = "#b98262", hair = "#3b2420";
    svg += S("M196,282 L270,288", tights, 25);                                          // thigh on the cushion
    svg += P("M182,262 C180,240 182,222 190,208 Q206,196 222,204 C228,222 226,242 218,262 Z", "#6c3fc8") +   // bodice
      P("M180,258 C168,268 160,282 162,292 Q174,299 190,294 Q206,301 222,293 Q236,297 250,288 C240,276 228,264 218,256 Z", "#7b4ad8") +   // skirt over the lap
      S("M163,291 Q174,298 190,293 Q206,300 222,292 Q236,296 249,288", "#dcc2ff", 3.4) +
      P("M180,254 Q200,260 219,254 L218,262 Q200,267 181,262 Z", "#f3c34e") +            // sparkly belt
      C(193, 236, 1.6, "#f3c34e") + C(203, 226, 1.3, "#f3c34e") + C(209, 242, 1.3, "#f3c34e");
    // far forearm peeking from behind, then the near arm with clasped hands under the chin
    svg += S("M222,238 L238,208", "#8f74d0", 13) +
      S("M210,212 L222,248 L238,210", "#a88be4", 14) +
      E(240, 202, 9.5, 10.5, skin) + E(234, 206, 7, 8, skin) + S("M236,198 Q240,196 244,198", "#8c5a3c", 1.5);
    // head: neck, hair, face
    svg += S("M214,196 L220,184", skin, 15) +
      C(214, 112, 15, hair) + P("M202,122 Q214,114 226,122 L224,128 Q214,122 204,128 Z", "#ff8fc8") +      // bun and scrunchie
      P("M196,150 C190,170 194,186 206,190 L214,170 Z", hair) +
      C(226, 158, 31, skin) +
      C(199, 162, 7, skin) + C(199, 162, 3.4, "#8c5a3c", ' opacity=".5"') +
      P("M196,156 C192,128 220,118 240,128 C252,134 258,144 257,154 C246,148 232,140 222,146 C214,150 206,154 196,166 Z", hair) +
      S("M213,134 Q226,128 238,134", "#5a3a30", 2.4, ' opacity=".8"') +
      S("M198,152 C195,132 214,122 234,126", "#7a4e3c", 2, ' opacity=".9"') + S("M203,106 Q208,99 216,98", "#7a4e3c", 2, ' opacity=".9"') +
      G(' class="fs-eyes"', E(230, 160, 3.4, 4.3, "#1d1420") + E(248, 160, 3, 4.1, "#1d1420") + C(231.2, 158.4, 1.2, "#fff") + C(249, 158.4, 1.1, "#fff")) +
      S("M225,150 Q230,147 235,150 M244,150 Q248,147 252,150", hair, 2) +
      E(222, 171, 6.5, 3.8, "#ff7aa8", ' opacity=".45"') + E(254, 171, 4.5, 3.4, "#ff7aa8", ' opacity=".45"') +
      P("M231,172 Q239,184 247,172 Z", "#5a2430") + P("M234,177 Q239,174 244,177 Q239,182 234,177 Z", "#ff7aa8");

    // ---- the shopkeeper (KEEPERS[0]) kneeling to lace the skate ----
    var kSkin = "#f1c7a5", kHair = "#5a2e1c", top = "#fbe9d0", apron = "#b8433f", pants = "#2f7f8f";
    // far leg: knee up, foot planted beside the skate
    svg += S("M402,316 L334,300", "#256673", 26) + S("M334,300 L337,376", "#256673", 22) +
      P("M314,390 Q314,380 324,378 H344 Q352,378 352,386 V394 H314 Z", "#4a1e28") + S("M316,394 H351", "#e8cfae", 2);
    // far arm (in shade): comes forward from the far shoulder, its elbow just clear of the near arm, and holds the
    // lace ends up
    svg += G(' class="fs-tug"',
      S("M372,250 L341,283", "#e6cfb0", 15) + S("M339,286 L312,315", kSkin, 11.5) + S("M343,280 L335,290", "#e6cfb0", 14) +
      S("M284,330 Q292,318 302,315 M285,333 Q295,325 305,321", "#ffffff", 1.6) +
      hand(306, 316, 155, true, kSkin, "#d9a585"));
    // near leg: knee on the floor, toes tucked under
    svg += S("M408,318 L414,384", pants, 28) + S("M414,386 L486,374", pants, 22) +
      P("M480,368 Q484,358 494,360 Q503,362 503,372 L500,392 Q500,398 492,398 L484,398 Q478,396 479,388 Z", "#5a2430") + S("M502,372 L500,393", "#e8cfae", 2) +
      E(414, 318, 22, 17, pants);
    // body: cream jumper leaning toward the skate
    svg += P("M386,324 C374,308 360,290 354,272 C350,258 354,246 364,240 C376,233 394,236 405,249 C417,265 427,292 433,322 Z", top) +
      P("M405,249 C417,265 427,292 433,322 L423,322 C418,297 409,273 397,257 Z", "#f0d9bb") +
      // red apron: bib, waist ties with a bow at the back, a pocket with a shoehorn peeking out
      P("M355,256 Q362,246 375,243 C386,262 398,290 410,318 L426,352 Q408,362 391,359 L386,324 C374,308 360,290 354,272 Z", apron) +
      S("M361,256 Q366,250 373,248 M376,250 C386,268 396,292 406,316 L420,348", "#fbe9d0", 1.3, ' stroke-dasharray="3 3" opacity=".7"') +
      S("M394,355 Q408,358 421,351", "#fbe9d0", 1.3, ' stroke-dasharray="3 3" opacity=".7"') +
      S("M408,318 L433,318", apron, 4) +
      S("M433,318 Q444,308 448,317 Q444,325 433,318 Q441,328 438,337 M433,318 Q426,328 429,337", "#9a3634", 3.2) +
      P("M397,332 L417,329 L420,347 L400,350 Z", "#9a3634") +
      S("M404,334 L400,316", "#a8794a", 5) + S("M400,316 L398,305 Q397,299 402,300 Q406,301 404,306", "#dfe7f4", 2);   // lacing hook
    // head: tilted down toward the laces
    svg += S("M368,246 L357,233", kSkin, 15) +
      P("M352,200 C384,198 390,226 381,244 C373,250 362,248 356,242 Z", kHair) +
      C(346, 214, 30, kSkin) +
      C(372, 220, 7, kSkin) + C(372, 220, 3.2, "#d9a585", ' opacity=".6"') +
      G(' class="fs-keyes"', E(330, 222, 2.9, 3.5, "#1d1420") + E(346, 223, 2.9, 3.5, "#1d1420")) +
      E(325, 233, 5.5, 3.2, "#ff7aa8", ' opacity=".45"') + E(352, 234, 5.5, 3.2, "#ff7aa8", ' opacity=".45"') +
      S("M331,236 Q337,242 343,236", "#5a2430", 2.4) +
      G(' transform="rotate(-14 346 214)"',
        P("M314,206 C312,170 380,170 378,206 Z", "#e0457a") +
        '<rect x="310" y="198" width="72" height="13" rx="6.5" fill="#fbe9d0"/>' +
        S("M320,199 V210 M330,199 V211 M340,199 V211 M350,199 V211 M360,199 V211 M370,199 V210", "#e8cfae", 2) +
        C(346, 172, 9, "#fbe9d0"));

    // ---- the new skate: crisp white boot, shiny blade ----
    svg += P("M260,290 C256,306 258,320 261,334 L282,334 C283,320 284,304 283,290 Z", tights) + C(271, 289, 12.6, tights) +
      skate(258, 382, 1, { boot: "#fff8f3", shade: "#e6dcea", lace: "#ffffff", metal: "#f2b83f", sole: "#a8794a", heel: "#8a6238",
        blade: "#e8eef8", bladeShade: "#b9c6da", glint: "#7be3ff" });

    // ---- near arm: hand pressing the laces at the hooks ----
    svg += G(' class="fs-press"',
      S("M348,298 L307,337", kSkin, 12) +
      S("M380,252 L346,300", "#dcc29f", 19) + S("M380,252 L346,300", top, 15.5) + S("M350,295 L343,304", "#f3dfc4", 15.5) +
      hand(301, 342, 136, true, kSkin, "#d9a585"));

    // ---- props in front: a foot-measuring device and a lacing hook ----
    svg += P("M500,410 L590,410 L606,396 L516,396 Z", "#6b7590") + P("M502,407 L588,407 L602,395 L516,395 Z", "#c7d2e3") +
      S("M520,395 Q506,396 505,402 Q505,408 513,409", "#9fb0c8", 4.5) +
      S("M530,405 L533,402 M536,405 L537.5,403.5 M542,405 L545,402 M548,405 L549.5,403.5 M566,405 L569,402 M572,405 L573.5,403.5 M578,405 L581,402 M584,405 L585.5,403.5", "#24305e", 1.3) +
      P("M556,395 H564 L556,407 H548 Z", "#e0457a") +
      P("M424,406 Q450,402 470,403 Q486,400 495,404 Q488,411 470,410 Q450,410 424,409 Q420,407.5 424,406 Z", "#f2b83f") +   // shoehorn
      C(429, 407.5, 1.6, "#8a6238") + S("M474,404.6 Q484,403 491,405", "#ffd36b", 1.3);

    // ---- a little heart and a sparkle over the new skate ----
    svg += G(' transform="translate(300,292)"', G(' class="fs-heart"',
      P("M0,6 C-11,-1 -11,-11 -5,-11 C-2.4,-11 0,-8.6 0,-6 C0,-8.6 2.4,-11 5,-11 C11,-11 11,-1 0,6 Z", "#ff8fc8")));
    svg += G(' transform="translate(322,368)"', G(' class="fs-glint"',
      P("M0,-8 Q1,-1 8,0 Q1,1 0,8 Q-1,1 -8,0 Q-1,-1 0,-8 Z", "#fff2c8")));

    return '<svg class="fs-scene" viewBox="0 0 640 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' + svg + "</svg>";
  }
  /* ====== END OF FITTING SHOP ART ==================================================================== */

  // A window onto the snowy mountains with snow falling past the glass, which is w x h (the big one is 250 x 470,
  // like the window in the other shops). The flakes fall the whole height of the glass and start spread out, so
  // the snow never stops; with reduced motion they simply hang in the air.
  function snowWindowSVG(w, h, n, key) {
    var id = "win" + key, seedW = 7 + n, rnd = function () { seedW = (seedW * 16807) % 2147483647; return (seedW - 1) / 2147483646; };
    var flakes = "";
    for (var k = 0; k < n; k++) {
      var r = 1.3 + rnd() * 2.2, y = rnd() * h, dur = 9 - r * 1.4 + rnd() * 2;
      flakes += '<circle cx="' + f(rnd() * w) + '" cy="' + f(y) + '" r="' + f(r) + '" style="--y:' + f(y) + "px;--dx:" + f(4 + rnd() * 12) + "px;--d:" + f(dur) + "s;animation-delay:" + f(-((y + 12) / (h + 24)) * dur) + 's"/>';
    }
    var X = function (t) { return f(w * t); }, Y = function (t) { return f(h * t); };
    var bars = "M" + f(w / 2) + ",0 V" + h + (h > w ? " M0," + Y(0.49) + " H" + w : "");
    return '<svg viewBox="-12 -12 ' + (w + 24) + " " + (h + 32) + '" aria-hidden="true" focusable="false">' +
      '<defs><clipPath id="' + id + 'c"><rect width="' + w + '" height="' + h + '"/></clipPath>' +
      '<linearGradient id="' + id + 'n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f5a"/><stop offset="1" stop-color="#6a4fae"/></linearGradient></defs>' +
      '<g clip-path="url(#' + id + 'c)">' +
        '<rect width="' + w + '" height="' + h + '" fill="url(#' + id + 'n)"/>' +
        '<path d="M0,' + Y(0.745) + " L" + X(0.28) + "," + Y(0.553) + " L" + X(0.44) + "," + Y(0.638) + " L" + X(0.68) + "," + Y(0.468) + " L" + w + "," + Y(0.702) + " V" + h + ' H0 Z" fill="#cfe0ff"/>' +
        '<path d="M' + X(0.28) + "," + Y(0.553) + " L" + X(0.33) + "," + Y(0.6) + " L" + X(0.28) + "," + Y(0.59) + " L" + X(0.23) + "," + Y(0.61) + " Z M" + X(0.68) + "," + Y(0.468) + " L" + X(0.74) + "," + Y(0.52) + " L" + X(0.68) + "," + Y(0.51) + " L" + X(0.62) + "," + Y(0.53) + ' Z" fill="#ffffff"/>' +
        '<rect y="' + Y(0.894) + '" width="' + w + '" height="' + Y(0.106) + '" fill="#7be3ff" opacity=".6"/>' +
        '<g class="fit-snow" fill="#fff" style="--h:' + h + 'px">' + flakes + "</g>" +
      "</g>" +
      '<path d="M0,0 H' + w + " V" + h + " H0 Z " + bars + '" fill="none" stroke="#8a6238" stroke-width="14"/>' +
      '<rect x="-12" y="' + (h + 2) + '" width="' + (w + 24) + '" height="16" rx="4" fill="#a8794a"/>' +
      "</svg>";
  }

  // Text from cards.js with every [placeholder] marked as still to fill in
  function withTodos(t) {
    return esc(t).replace(/\[[^\]]*\]/g, function (m) { return '<span class="todo">' + m + "</span>"; });
  }
  function boardLink(href, label) {
    href = String(href).trim();
    if (/^(javascript|data|vbscript):/i.test(href)) return "";
    return '<a class="board-link" href="' + esc(href) + '"' + (/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : "") + ">" + esc(label) + " &rarr;</a>";
  }

  // Inside the skate fitting shop: the snowy window on the left, a slatwall with the boots at eye level, guards, blades
  // and a tall unit of boot boxes, the shopkeeper fitting a skater with new skates in front, and a letter board with tabs
  // for About me, the resume and (in an artifact's shop) its card.
  function fitInteriorHTML(s) {
    var A = ABOUT, a = s.a, p = fitPalette(s), done = a && a.status === "done";
    var tabs = [["about", "About me"], ["resume", "Resume"]];
    if (a) tabs.push(["art", "Artifact " + a.number]);
    var todo = A.resume.some(function (sec) { return /\[[^\]]*\]/.test(sec.heading + sec.items.join(" ")); });
    var panel = function (key, inner) {
      return '<div class="fit-panel" id="fitPanel-' + key + '" role="tabpanel" aria-labelledby="fitTab-' + key + '" tabindex="0">' + inner + "</div>";
    };
    var about = panel("about",
      '<h3 class="row label fit-plabel">About me</h3>' +
      '<p class="board-text">' + withTodos(A.about) + "</p>" +
      (A.traits.length ? '<ul class="fit-traits" aria-label="What I\'m like">' + A.traits.map(function (t) { return "<li>" + withTodos(t) + "</li>"; }).join("") + "</ul>" : ""));
    var resume = panel("resume",
      '<h3 class="row label fit-plabel">Resume</h3>' +
      (todo ? '<p class="fit-note"><span aria-hidden="true">&#9998;</span> Still being filled in</p>' : "") +
      (A.resume.length ? A.resume.map(function (sec) {
        return (sec.heading ? '<h4 class="row label fit-rhead">' + withTodos(sec.heading) + "</h4>" : "") +
          (sec.items.length ? '<ul class="fit-list">' + sec.items.map(function (t) { return "<li>" + withTodos(t) + "</li>"; }).join("") + "</ul>" : "");
      }).join("") : '<p class="board-text">My resume is coming soon.</p>') +
      (A.resumeLink && boardLink(A.resumeLink, A.resumeLinkLabel) ? '<div class="row foot">' + boardLink(A.resumeLink, A.resumeLinkLabel) + "</div>" : ""));
    var art = a ? panel("art",
      '<div class="row head"><span>Artifact ' + esc(a.number) + '</span><span class="tag">' + (done ? "&#9733; Open" : "&#9825; Idea") + "</span></div>" +
      '<h3 class="row title">' + esc(a.title) + "</h3>" +
      '<div class="row label">' + (done ? "Reflection" : "The idea") + "</div>" +
      '<p class="board-text">' + esc(a.reflection) + "</p>" +
      '<div class="row foot">' + (a.link && boardLink(a.link, a.linkLabel || "Open the artifact") || '<span class="board-link pending">Link coming when it\'s built</span>') + "</div>") : "";
    var W = fitWallArt();
    var hook = '<svg viewBox="0 0 24 40" focusable="false"><rect x="5" y="0" width="14" height="6" rx="2" fill="#c48a1e"/><rect x="10" y="4" width="4" height="9" fill="#c48a1e"/>' +
      '<g fill="none" stroke="#f2b83f" stroke-width="2.4"><ellipse cx="12" cy="17" rx="3.4" ry="5"/><ellipse cx="12" cy="26" rx="3.4" ry="5"/><ellipse cx="12" cy="35" rx="3.4" ry="5"/></g></svg>';
    return '<div class="int-wall fit-room" style="--wall:' + p.wall + ";--neon:" + p.neon + ";--awn:" + p.awn + '">' + W.defs +
      // the back wall: a pale slatwall from the floor almost to the ceiling, right of the window
      '<div class="fit-slat" aria-hidden="true"></div>' +
      // pendant lamps, one over the letter board and one over the wall of boots; style.css hangs them above those two
      // (wide screens only: on tall ones they would hang behind the Back button)
      ["board", "wall"].map(function (k) {
        return '<div class="fit-lamp fit-lamp-' + k + '" aria-hidden="true"><svg viewBox="0 0 340 260" focusable="false">' +
          '<path d="M170,0 V44" stroke="#1a1418" stroke-width="3"/><path d="M140,80 L158,42 H182 L200,80 Z" fill="#f2b83f"/><circle cx="170" cy="85" r="9" fill="#fff4d6"/></svg></div>';
      }).join("") +
      // the snowy window: tall on the left of wide screens, a small one at the top right of tall and narrow screens
      '<div class="fit-window fit-window-big" aria-hidden="true">' + snowWindowSVG(250, 470, 26, "B") + "</div>" +
      '<div class="fit-window fit-window-small" aria-hidden="true">' + snowWindowSVG(220, 96, 14, "S") + "</div>" +
      // on the slatwall: framed pictures and blades, the boots at eye level, the soft guards, the unit of boot boxes
      '<div class="fit-art fit-frames" aria-hidden="true">' + W.frames + "</div>" +
      '<div class="fit-art fit-boots" aria-hidden="true">' + W.boots + "</div>" +
      '<div class="fit-art fit-hooks" aria-hidden="true">' + W.hooks + "</div>" +
      '<div class="fit-floor" aria-hidden="true">' +
        '<svg class="fit-plant" viewBox="0 0 70 90"><g fill="#2f9a6a"><ellipse cx="22" cy="34" rx="9" ry="22" transform="rotate(-24 22 34)"/><ellipse cx="35" cy="26" rx="9" ry="25"/><ellipse cx="48" cy="34" rx="9" ry="22" transform="rotate(24 48 34)"/></g><path d="M14,56 H56 L50,88 H20 Z" fill="#c0532a"/></svg>' +
      "</div>" +
      '<div class="fit-art fit-boxes fit-boxes-tall" aria-hidden="true">' + W.boxes + "</div>" +
      '<div class="fit-art fit-boxes fit-boxes-short" aria-hidden="true">' + W.boxesShort + "</div>" +
      '<div class="fit-art fit-stack" aria-hidden="true">' + W.stack + "</div>" +
      '<div class="fit-scene"><p class="keeper-say fit-say">' + esc(A.keeperSays) + "</p>" + fitSceneSVG() + "</div>" +
      '<button type="button" class="int-back" id="intBack"><span aria-hidden="true">&larr;</span> Back to the village</button>' +
      // the letter board hangs from the slatwall on two brass hooks and chains
      '<div class="fit-hang" aria-hidden="true">' + hook + hook + "</div>" +
      '<section class="board fit-board" aria-labelledby="boardTitle">' +
        '<div class="fit-top">' +
          '<div class="row head"><span>' + esc(A.shopName) + '</span><span class="tag">&#9733; About me</span></div>' +
          '<h2 class="row title" id="boardTitle">' + withTodos(A.greeting) + "</h2>" +
          '<div class="row fit-tabs" role="tablist" aria-label="On the board">' + tabs.map(function (t) {
            return '<button type="button" class="fit-tab" role="tab" id="fitTab-' + t[0] + '" data-tab="' + t[0] + '" aria-controls="fitPanel-' + t[0] + '" aria-selected="false" tabindex="-1">' + esc(t[1]) + "</button>";
          }).join("") + "</div>" +
        "</div>" +
        '<div class="fit-scroll">' + about + resume + art + "</div>" +
      "</section>" +
    "</div>";
  }

  // The board's tabs. Until this runs (or if it ever fails) there are no tabs and every section shows, one under another.
  function wireTabs(box, first) {
    var board = box.querySelector(".fit-board");
    if (!board) return;
    var tabs = Array.prototype.slice.call(board.querySelectorAll(".fit-tab")), scroller = board.querySelector(".fit-scroll");
    var pick = function (t, focus) {
      tabs.forEach(function (b) {
        var on = b === t, panel = $(b.getAttribute("aria-controls"));
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
        if (panel) panel.classList.toggle("on", on);
      });
      if (scroller) scroller.scrollTop = 0;
      if (focus) t.focus();
    };
    tabs.forEach(function (b, k) {
      b.addEventListener("click", function () { pick(b, false); });
      // arrow keys move between the tabs (and show them), Home and End jump to the first and last
      b.addEventListener("keydown", function (e) {
        var n = tabs.length, j = { ArrowRight: (k + 1) % n, ArrowLeft: (k + n - 1) % n, Home: 0, End: n - 1 }[e.key];
        if (j === undefined) return;
        e.preventDefault();
        pick(tabs[j], true);
      });
    });
    pick(tabs.filter(function (b) { return b.getAttribute("data-tab") === first; })[0] || tabs[0], false);
    board.classList.add("tabbed");
  }

  var shopState = { open: -1, pushed: false, busy: false, later: false, backPending: false, backTimer: 0 };
  function doorRect(i) {
    var btn = document.querySelector('.shop[data-i="' + i + '"]');
    var door = btn && btn.querySelector(".shop-door");
    return door ? door.getBoundingClientRect() : null;
  }
  function insetFrom(r) {
    var W = window.innerWidth, H = window.innerHeight;
    return "inset(" + f(Math.max(0, r.top)) + "px " + f(Math.max(0, W - r.right)) + "px " + f(Math.max(0, H - r.bottom)) + "px " + f(Math.max(0, r.left)) + "px round 24px 24px 0 0)";
  }
  function setInert(on) {
    ["top", "village"].forEach(function (id) { var n = $(id); if (n) { if (on) n.setAttribute("inert", ""); else n.removeAttribute("inert"); } });
    var ft = document.querySelector(".footer");
    if (ft) { if (on) ft.setAttribute("inert", ""); else ft.removeAttribute("inert"); }
  }

  // i is the shop's place on the street (data-i). tab picks the fitting shop's first tab: "about", "resume" or "art".
  function enterShop(i, animate, tab) {
    var s = SHOPS[i];
    if (!s || shopState.busy || shopState.open === i) return;
    var box = $("interior");
    box.innerHTML = s.fit ? fitInteriorHTML(s) : interiorHTML(s.a, s.ai);
    if (s.fit) safely("board tabs", function () { wireTabs(box, tab || "about"); });
    $("intBack").addEventListener("click", function () { leaveShop(true); });
    shopState.open = i;
    if (animate) {
      try { history.pushState({ shop: i }, "", shopHash(s)); shopState.pushed = true; } catch (e) { shopState.pushed = false; }
    }
    var btn = document.querySelector('.shop[data-i="' + i + '"]');
    var r = doorRect(i);
    var finish = function () {
      document.documentElement.classList.add("in-shop");
      setInert(true);
      shopState.busy = false;
      $("intBack").focus({ preventScroll: true });
      syncLater();
    };
    box.hidden = false;
    if (!animate || reduceMotion || !r || !box.animate) { box.style.clipPath = ""; finish(); return; }
    shopState.busy = true;
    if (btn) btn.classList.add("opening");
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var vil = $("village"), vr = vil.getBoundingClientRect();
    vil.style.transformOrigin = f(cx - vr.left) + "px " + f(cy - vr.top) + "px";
    box.style.clipPath = insetFrom(r);
    box.style.opacity = "0";
    setTimeout(function () {
      vil.animate([{ transform: "scale(1)" }, { transform: "scale(2.6)" }], { duration: 750, easing: "cubic-bezier(.5,0,.2,1)" });
      var anim = box.animate([
        { clipPath: insetFrom(r), opacity: 0.4 },
        { clipPath: insetFrom(r), opacity: 1, offset: 0.25 },
        { clipPath: "inset(0px 0px 0px 0px round 0px 0px 0 0)", opacity: 1 }
      ], { duration: 750, easing: "cubic-bezier(.5,0,.2,1)" });
      anim.onfinish = function () {
        box.style.clipPath = ""; box.style.opacity = "";
        if (btn) btn.classList.remove("opening");
        finish();
      };
    }, 320);
  }

  function leaveShop(fromButton) {
    if (shopState.open < 0 || shopState.busy) return;
    if (fromButton && shopState.pushed) {
      // popstate brings us back here. Only one step back, however often the button is pressed (a double click or a
      // held Enter key would otherwise go back twice and leave the portfolio); if no popstate comes, close anyway.
      if (shopState.backPending) return;
      shopState.backPending = true;
      clearTimeout(shopState.backTimer);
      shopState.backTimer = setTimeout(function () {
        if (!shopState.backPending) return;
        shopState.backPending = false;
        if (shopState.open >= 0 && !shopState.busy) { shopState.pushed = false; leaveShop(false); }
      }, 1200);
      history.back();
      return;
    }
    var i = shopState.open, box = $("interior");
    var btn = document.querySelector('.shop[data-i="' + i + '"]');
    document.documentElement.classList.remove("in-shop");
    setInert(false);
    var done = function () {
      box.hidden = true; box.innerHTML = ""; box.style.clipPath = ""; box.style.opacity = "";
      shopState.open = -1; shopState.busy = false; shopState.pushed = false;
      if (btn) btn.focus({ preventScroll: true });
      syncLater();
    };
    // closed without going back through history (a deep link, or the history entry was not ours): tidy the URL
    try { if (/^#(artifact-|about$)/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search + "#village"); } catch (e) {}
    // Bring the shop on screen first (a deep link opens it with the page at the top of the lake, far above the shop),
    // so the door zooms shut onto a shop people can see and the focus comes back to a visible button. The jump is
    // instant: html scrolls smoothly, and the door's place is measured straight after.
    var br = btn && btn.getBoundingClientRect(), root = document.documentElement;
    if (!btn || br.bottom < 0 || br.top > window.innerHeight || br.right < 0 || br.left > window.innerWidth) {
      root.style.scrollBehavior = "auto";
      if (btn) btn.scrollIntoView({ block: "center", inline: "nearest" }); else $("village").scrollIntoView();
      root.style.scrollBehavior = "";
    }
    var r = doorRect(i);
    if (reduceMotion || !r || !box.animate) { done(); return; }
    shopState.busy = true;
    var anim = box.animate([
      { clipPath: "inset(0px 0px 0px 0px round 0px 0px 0 0)", opacity: 1 },
      { clipPath: insetFrom(r), opacity: 1, offset: 0.8 },
      { clipPath: insetFrom(r), opacity: 0 }
    ], { duration: 600, easing: "cubic-bezier(.5,0,.2,1)" });
    anim.onfinish = done;
  }

  // The address of a shop, and the shop an address points at: #artifact-N (in the fitting shop that is its artifact
  // tab), or #about for the skate fitting shop
  function shopHash(s) { return s.fit ? "#about" : "#artifact-" + s.a.number; }
  function shopFromHash(h) {
    var m = /^#artifact-(\d+)/.exec(h || "");
    if (m) for (var i = 0; i < SHOPS.length; i++) if (SHOPS[i].a && +SHOPS[i].a.number === +m[1]) return { i: i, tab: "art" };
    if (h === "#about" && fitIndex() >= 0) return { i: fitIndex(), tab: "about" };
    return null;
  }

  // Match the shop to the address after Back / Forward. While a door is still zooming open or shut, wait for it.
  function syncShop() {
    shopState.backPending = false; clearTimeout(shopState.backTimer);
    if (shopState.busy) { shopState.later = true; return; }
    var t = shopFromHash(location.hash);
    if (t) {
      enterShop(t.i, false, t.tab);
      // Forward into a shop we opened earlier: its entry is ours again, so closing goes back through history
      if (shopState.open >= 0 && history.state && history.state.shop === shopState.open) shopState.pushed = true;
    }
    else if (shopState.open >= 0) { shopState.pushed = false; leaveShop(false); }
  }
  function syncLater() { if (shopState.later) { shopState.later = false; syncShop(); } }
  function bindShops() {
    window.addEventListener("popstate", syncShop);
    // a typed or linked #about then scrolls the page behind to its #about spot, which takes the focus off Back: give it back
    window.addEventListener("hashchange", function () {
      if (shopState.open >= 0 && document.documentElement.classList.contains("in-shop") && (!document.activeElement || document.activeElement === document.body)) $("intBack").focus({ preventScroll: true });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && shopState.open >= 0) leaveShop(true);
    });
    var t = shopFromHash(location.hash);
    if (t) {
      enterShop(t.i, false, t.tab);
      // with #about the browser then jumps to the #about spot on the page, which takes the focus off Back: give it back
      var refocus = function () {
        if (shopState.open >= 0 && (!document.activeElement || document.activeElement === document.body)) $("intBack").focus({ preventScroll: true });
      };
      document.addEventListener("DOMContentLoaded", function () { setTimeout(refocus, 0); });
      window.addEventListener("load", refocus);
    }
  }

  // "About" links (the navigation and the village text) open the skate fitting shop: the page glides down to its
  // door, then the door zooms open as usual. Without script.js they still jump down to the street (#about).
  var aboutWait = 0;
  function bindAboutLinks() {
    document.addEventListener("click", function (e) {
      var link = e.target.closest && e.target.closest('a[href="#about"]');
      if (!link || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var i = fitIndex();
      if (i < 0 || !document.querySelector('.shop[data-i="' + i + '"]')) return;   // no shop to open: just follow the link
      e.preventDefault();
      openFitShop(i);
    });
  }
  function openFitShop(i) {
    if (shopState.open >= 0 || shopState.busy || aboutWait) return;
    var btn = document.querySelector('.shop[data-i="' + i + '"]'), root = document.documentElement;
    var onScreen = function () {
      var r = doorRect(i);
      return r && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    };
    if (onScreen()) { enterShop(i, true, "about"); return; }
    if (reduceMotion) {
      root.style.scrollBehavior = "auto";
      btn.scrollIntoView({ block: "center", inline: "center" });
      root.style.scrollBehavior = "";
      enterShop(i, true, "about");
      return;
    }
    btn.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    // wait until the scrolling has settled with the door on screen (or give up waiting after a moment)
    var t0 = Date.now(), last = "", still = 0, street = $("street");
    var wait = function () {
      var now = Math.round(window.scrollY || window.pageYOffset || 0) + "," + Math.round(street ? street.scrollLeft : 0);
      still = now === last ? still + 1 : 0;
      last = now;
      if ((still >= 3 && onScreen()) || Date.now() - t0 > 1600) { aboutWait = 0; enterShop(i, true, "about"); }
      else aboutWait = requestAnimationFrame(wait);
    };
    aboutWait = requestAnimationFrame(wait);
  }

  function buildVillageStars() {
    var g = document.getElementById("vStars");
    if (!g) return;
    for (var i = 0; i < 90; i++) {
      var c = el("circle", { cx: f(rand() * 1600), cy: f(rand() * 420), r: f(0.6 + rand() * 1.4), fill: "#ffffff", class: "star" }, g);
      c.style.animationDelay = f(rand() * 4) + "s";
    }
  }

  /* ---------- Start ---------- */

  // Each part starts on its own, so a problem in one never hides the shops.
  function safely(name, fn) {
    try { fn(); } catch (e) { if (window.console) console.error("Portfolio: " + name + " failed", e); }
  }
  safely("shops", renderShops);
  safely("shop interiors", bindShops);
  safely("about links", bindAboutLinks);
  safely("village", buildVillageStars);
  safely("layout", measure);
  safely("skaters", buildSkaters);
  safely("resort", buildResort);
  var onLayoutChange = function () { safely("layout", measure); };
  window.addEventListener("resize", onLayoutChange);
  if (tallQuery) {
    if (tallQuery.addEventListener) tallQuery.addEventListener("change", onLayoutChange);
    else if (tallQuery.addListener) tallQuery.addListener(onLayoutChange);
  }
  safely("secrets", bindSecrets);
  safely("snow", initSnow);
  safely("parallax", bindParallax);
  safely("hero watch", watchHero);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { safely("title", fitTitle); safely("signs", measureSigns); });
  setTimeout(function () { safely("title", fitTitle); safely("signs", measureSigns); }, 1500);

  if (!reduceMotion) {
    var failed = false;
    var loop = function (now) {
      try { frame(now); } catch (e) { if (!failed && window.console) console.error("Portfolio: animation failed", e); failed = true; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } else {
    // A still picture: skaters resting in their poses, finished marks on the ice, snow hanging in the air.
    safely("still scene", function () {
      placeDogs(0);
      drawStillMarks();
      drawSnow(0);
    });
  }
})();
