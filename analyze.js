// On-device grooming analysis. Input: a canvas holding the photo + Human detection result. No network, no photo leaves the phone.
// Output: pass/fail + reason codes per criterion, plus measurements (m) used for tuning and a debug list of regions.
import { PLAY_ROLES, RETAIL_ROLES } from "./rules.js";

export const T = {            // tunable thresholds (tweak with more example photos)
  blurVar: 25,                // variance of Laplacian on a 512px luma image below this = blurry
  minFaceFrac: 0.035,         // face height / image height below this = face too small
  dark: 0.30,                 // V below this counts as "black" for shoes/belt
  shoeBlackPass: 0.80,        // >=80% black = pass (your 20% white/colour rule)
  shoeBlack1: 0.62, shoeBlack2: 0.42,   // 0.62-0.80 too_much_white(-3), 0.42-0.62 half_black(-6), below not_black
  fadedV: 0.62, fadedS: 0.30, // jeans lighter+greyer than this = faded
  baggyRatio: 0.88,           // shin width / thigh width above this (and wide) = baggy
  baggyWide: 0.75,            // ...and shin width / shoulder width above this
  beardNeck: 0.20,            // dark facial hair below the chin, as fraction of face height
  hairVolume: 1.6,           // head hair width / face width above this = messy
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export function analyze(canvas, human, designation, opt = {}) {
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext("2d", { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, W, H).data;
  const dbg = [], m = {};
  const px = (x, y) => { x = clamp(Math.round(x), 0, W - 1); y = clamp(Math.round(y), 0, H - 1); const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const region = (x0, y0, x1, y1, label, color) => {
    x0 = clamp(Math.round(Math.min(x0, x1)), 0, W - 1); x1 = clamp(Math.round(Math.max(x0, x1)), 0, W);
    y0 = clamp(Math.round(Math.min(y0, y1)), 0, H - 1); y1 = clamp(Math.round(Math.max(y0, y1)), 0, H);
    if (label) dbg.push({ x0, y0, x1, y1, label, color: color || "#0f0" });
    return { x0, y0, x1, y1 };
  };
  // sample a region on a grid; returns array of [r,g,b,h,s,v]
  const sample = (r, step = 3) => {
    const out = [];
    for (let y = r.y0; y < r.y1; y += step) for (let x = r.x0; x < r.x1; x += step) { const [R, G, B] = px(x, y); out.push([R, G, B, ...rgb2hsv(R, G, B)]); }
    return out;
  };
  const stat = s => ({ n: s.length, r: med(s.map(p => p[0])), g: med(s.map(p => p[1])), b: med(s.map(p => p[2])), h: med(s.map(p => p[3])), s: med(s.map(p => p[4])), v: med(s.map(p => p[5])) });

  // ---------------------------------------------------------------- landmarks
  const faces = [...(human.face || [])].sort((a, b) => b.box[3] - a.box[3]), face = faces[0], body = human.body?.[0];
  const kp = {}; (body?.keypoints || []).forEach(k => { if (k) kp[k.part] = { x: k.positionRaw[0] * W, y: k.positionRaw[1] * H, s: k.score }; });  // positionRaw: Human's jitter cache can leave stale pixel positions
  const res = { criteria: {}, m, dbg, retake: null, detected: "unclear" };

  // photo usable?
  const small = document.createElement("canvas"); const sc = 512 / Math.max(W, H); small.width = Math.round(W * sc); small.height = Math.round(H * sc);
  small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
  { const d = small.getContext("2d").getImageData(0, 0, small.width, small.height).data, w = small.width, h = small.height, L = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let s = 0, s2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const v = L[y * w + x - 1] + L[y * w + x + 1] + L[(y - 1) * w + x] + L[(y + 1) * w + x] - 4 * L[y * w + x]; s += v; s2 += v * v; n++; }
    m.blurVar = +(s2 / n - (s / n) ** 2).toFixed(1); }
  if (!face || face.box[3] / H < T.minFaceFrac) { res.retake = "face_not_clear"; return res; }
  if (faces[1] && faces[1].box[3] >= 0.5 * face.box[3]) { res.retake = "multiple_people"; return res; }
  if (m.blurVar < T.blurVar) { res.retake = "blurry"; return res; }
  const ank = ["leftAnkle", "rightAnkle"].map(k => kp[k]).filter(k => k && k.s > 0.15);
  let fb = { x: face.box[0], y: face.box[1], w: face.box[2], h: face.box[3] };
  if (face.mesh && face.mesh.length > 454) { const M = face.mesh, w = Math.abs(M[454][0] - M[234][0]), h = M[152][1] - M[10][1]; if (w > 10 && h > 10) fb = { x: Math.min(M[234][0], M[454][0]), y: M[10][1], w, h }; }   // tight face rectangle from the mesh (the detector box is padded)
  const fH = fb.h, fcx = fb.x + fb.w / 2;
  const sh = [kp.leftShoulder, kp.rightShoulder];
  m.kpdbg = { body: !!body, sh: sh.map(k => k && [Math.round(k.x), Math.round(k.y), k.s]), hip: !!kp.leftHip };
  if (!body || sh.some(k => !k || k.s < 0.2) || !kp.leftHip || !kp.rightHip) { res.retake = "body_cut_off"; return res; }
  const shW = Math.abs(sh[0].x - sh[1].x), shY = (sh[0].y + sh[1].y) / 2, shX = (sh[0].x + sh[1].x) / 2;
  const bu = shW * 0.78;   // body unit (≈ a head height), from shoulder width: more stable than the face box
  // hips: trust keypoints if plausible, else proportions
  let hipY = (kp.leftHip.y + kp.rightHip.y) / 2;
  if (!(hipY > shY + 0.8 * shW && hipY < shY + 3.2 * shW)) hipY = shY + 1.5 * shW;
  const hipX = (kp.leftHip.x + kp.rightHip.x) / 2, hipW = Math.max(Math.abs(kp.leftHip.x - kp.rightHip.x), shW * 0.5);
  let ankY = ank.length ? ank.reduce((a, k) => a + k.y, 0) / ank.length : null;
  if (ankY == null || ankY < hipY + 1.2 * shW) ankY = Math.min(H * 0.93, hipY + 2.3 * shW);
  // person mid x: use ankle/hip/shoulder midpoint
  const cx = ank.length ? (ank.reduce((a, k) => a + k.x, 0) / ank.length + hipX) / 2 : hipX;
  if (ankY > H * 0.985 || ankY - hipY < 0.9 * shW) { res.retake = "body_cut_off"; return res; }
  Object.assign(m, { bu: Math.round(bu), shW: Math.round(shW), hipY: Math.round(hipY), ankY: Math.round(ankY) });

  const roleFamily = PLAY_ROLES.includes(designation) ? (designation === "Play Chief" ? "blazer" : "dungaree") : "retail";

  // ---------------------------------------------------------------- TOP
  {
    const r = region(shX - shW * 0.30, shY + 0.45 * bu, shX + shW * 0.30, hipY - 0.35 * bu, "top", "#06f");
    const s = sample(r), st = stat(s); m.top = { h: Math.round(st.h), s: +st.s.toFixed(2), v: +st.v.toFixed(2) };
    const black = s.filter(p => p[5] < 0.32 || (p[5] < 0.52 && p[4] < 0.30)).length / s.length, red = s.filter(p => (p[3] < 20 || p[3] > 340) && p[4] > 0.5 && p[5] > 0.35).length / s.length;
    const grey = s.filter(p => p[4] < 0.34 && p[5] > 0.25 && p[5] < 0.82).length / s.length;
    m.top.black = +black.toFixed(2); m.top.red = +red.toFixed(2); m.top.grey = +grey.toFixed(2);
    let detected = "unclear";
    if (black > 0.45) detected = "polo"; else if (grey > 0.35) detected = (red > 0.04 ? "dungaree" : "blazer"); else if (red > 0.45) detected = "dungaree";
    res.detected = detected;
    let pass = true, reason = "";
    if (roleFamily === "retail") {
      const redPolo = (designation === "Fun Consultant" || designation === "Section Supervisor") && red > 0.40;      // red Hamleys T-shirt: approved for these two roles
      if (redPolo) res.detected = "polo";
      else if (black < 0.45) { pass = false; reason = "wrong_top"; } }
    else if (roleFamily === "dungaree") { const rr = region(shX - shW * 0.5, shY + 0.1 * bu, shX + shW * 0.5, shY + 0.7 * bu, "tee", "#f80"); const s2 = sample(rr);
      const rd = s2.filter(p => (p[3] < 22 || p[3] > 338) && p[4] > 0.45 && p[5] > 0.3).length / s2.length; m.top.tee = +rd.toFixed(2); if (rd < 0.08 || grey < 0.2) { pass = false; reason = "wrong_top"; } }
    else { if (grey < 0.25 && red < 0.08) { pass = false; reason = "wrong_top"; } }
    res.criteria.top = { pass, reason };
  }

  // ---------------------------------------------------------------- BOTTOM
  const legLen = ankY - hipY;
  const lAnk = kp.leftAnkle && kp.leftAnkle.s > 0.15 ? kp.leftAnkle.x : kp.leftHip.x, rAnk = kp.rightAnkle && kp.rightAnkle.s > 0.15 ? kp.rightAnkle.x : kp.rightHip.x;
  const legX = (side, t) => { const hx = side === "l" ? kp.leftHip.x : kp.rightHip.x, ax = side === "l" ? lAnk : rAnk; return hx + (ax - hx) * t; };
  let legRef = null;
  {
    const strip = [];
    for (const side of ["l", "r"]) for (let t = 0.22; t <= 0.9; t += 0.04) {
      const y = hipY + legLen * t, x = legX(side, t), hw = shW * 0.075;
      for (let yy = y - 6; yy <= y + 6; yy += 3) for (let xx = x - hw; xx <= x + hw; xx += 3) { const [R, G, B] = px(xx, yy); strip.push([R, G, B, ...rgb2hsv(R, G, B)]); }
    }
    dbg.push({ x0: legX("l", 0.5) - 8, y0: hipY + legLen * 0.5, x1: legX("l", 0.5) + 8, y1: hipY + legLen * 0.5 + 16, label: "legL", color: "#06f" });
    const st = stat(strip), sorted = [...strip].sort((p, q) => q[5] - p[5]), bright = sorted.slice(0, Math.max(5, Math.round(strip.length * 0.3)));
    const bB = bright.reduce((a, p) => a + p[2] - p[0], 0) / bright.length, bS = bright.reduce((a, p) => a + p[4], 0) / bright.length, bV = bright.reduce((a, p) => a + p[5], 0) / bright.length;
    legRef = [st.r, st.g, st.b];
    m.bottom = { v: +st.v.toFixed(2), s: +st.s.toFixed(2), h: Math.round(st.h), rgb: [Math.round(st.r), Math.round(st.g), Math.round(st.b)], brightBlue: +bB.toFixed(1), brightS: +bS.toFixed(2), brightV: +bV.toFixed(2) };
    // outer width of the legs: scan outwards from each leg line while the colour stays close to the leg colour
    const spanAt = t => {
      const y = hipY + legLen * t; let best = null;
      for (const yy of [y - 4, y, y + 4]) {
        const near = (x) => { const [R, G, B] = px(x, yy); return Math.hypot(R - legRef[0], G - legRef[1], B - legRef[2]) < 34 + 0.35 * Math.hypot(legRef[0], legRef[1], legRef[2]); };
        const xl = Math.min(legX("l", t), legX("r", t)), xr = Math.max(legX("l", t), legX("r", t));
        let l = xl, r = xr, miss = 0;
        for (let x = xl; x > 0 && miss < 12; x -= 2) { if (near(x)) { l = x; miss = 0; } else miss += 2; }
        miss = 0; for (let x = xr; x < W && miss < 12; x += 2) { if (near(x)) { r = x; miss = 0; } else miss += 2; }
        if (!best || r - l > best.w) best = { w: r - l, x0: l, x1: r };
      }
      return best;
    };
    // per-leg width measured along each leg (hip -> knee -> ankle keypoints), edge to edge from the leg centre; used for "baggy below the knee"
    {
      const legPts = side => { const hip = side === "l" ? kp.leftHip : kp.rightHip, kn = side === "l" ? kp.leftKnee : kp.rightKnee, an = side === "l" ? kp.leftAnkle : kp.rightAnkle;
        const kk = kn && kn.s > 0.15 ? kn : { x: (hip.x + legX(side, 1)) / 2, y: (hip.y + ankY) / 2 }; const aa = an && an.s > 0.15 ? an : { x: legX(side, 1), y: ankY }; return { hip, kk, aa }; };
      const widthAt = (side, y) => {
        const { hip, kk, aa } = legPts(side); let cx; if (y < kk.y) cx = hip.x + (kk.x - hip.x) * ((y - hip.y) / Math.max(1, kk.y - hip.y)); else cx = kk.x + (aa.x - kk.x) * ((y - kk.y) / Math.max(1, aa.y - kk.y));
        const other = side === "l" ? legPts("r") : legPts("l"); let ox; { const q = other; if (y < q.kk.y) ox = q.hip.x + (q.kk.x - q.hip.x) * ((y - q.hip.y) / Math.max(1, q.kk.y - q.hip.y)); else ox = q.kk.x + (q.aa.x - q.kk.x) * ((y - q.kk.y) / Math.max(1, q.aa.y - q.kk.y)); }
        const ref = [0, 0, 0]; { let n = 0; for (let dx = -3; dx <= 3; dx += 3) for (let dy = -3; dy <= 3; dy += 3) { const c = px(cx + dx, y + dy); ref[0] += c[0]; ref[1] += c[1]; ref[2] += c[2]; n++; } ref[0] /= n; ref[1] /= n; ref[2] /= n; }
        const tol = 38 + 0.3 * Math.hypot(...ref), lim = Math.abs(ox - cx) / 2 || shW * 0.6, maxd = Math.min(lim, shW * 0.9);
        const go = dir => { let d = 0, bad = 0; for (let t = 2; t <= maxd; t += 2) { const c = px(cx + dir * t, y); if (Math.hypot(c[0] - ref[0], c[1] - ref[1], c[2] - ref[2]) > tol) { bad++; if (bad >= 2) break; } else { d = t; bad = 0; } } return d; };
        return go(-1) + go(1);
      };
      const lA = legPts("l"), rA = legPts("r"), kneeY = (lA.kk.y + rA.kk.y) / 2, shinY = kneeY + (ankY - kneeY) * 0.62, thighY = hipY + (kneeY - hipY) * 0.55;
      const avg = y => { let a = 0, n = 0; for (const sd of ["l", "r"]) for (const yy of [y - 6, y, y + 6]) { a += widthAt(sd, yy); n++; } return a / n; };
      const thighLeg = avg(thighY), shinLeg = avg(shinY);
      m.bottom.legThigh = +(thighLeg / shW).toFixed(2); m.bottom.legShin = +(shinLeg / shW).toFixed(2); m.bottom.legRatio = +(shinLeg / Math.max(1, thighLeg)).toFixed(2);
      dbg.push({ x0: lA.kk.x - shinLeg / 2, y0: shinY, x1: lA.kk.x + shinLeg / 2, y1: shinY + 3, label: "shinLeg", color: "#0ff" });
    }
    const th = spanAt(0.35), sn = spanAt(0.85);
    m.bottom.thighW = Math.round(th.w); m.bottom.shinW = Math.round(sn.w); m.bottom.shinOverThigh = +(sn.w / Math.max(th.w, 1)).toFixed(2);
    m.bottom.shinOverShoulder = +(sn.w / shW).toFixed(2); m.bottom.thighOverShoulder = +(th.w / shW).toFixed(2);
    dbg.push({ x0: th.x0, y0: hipY + legLen * 0.35, x1: th.x1, y1: hipY + legLen * 0.35 + 3, label: "thighW", color: "#f0f" }); dbg.push({ x0: sn.x0, y0: hipY + legLen * 0.85, x1: sn.x1, y1: hipY + legLen * 0.85 + 3, label: "shinW", color: "#f0f" });
    let pass = true, reason = "";
    const blue = bB > 3 || (st.h > 195 && st.h < 255 && st.s > 0.3), warmBlack = bB < -3;
    m.bottom.blue = blue;
    if (roleFamily === "retail") {
      // dark navy that photographs near-black passes (benefit of the doubt); a clearly neutral/warm black or other colour fails
      if (bB < -20 && bV > 0.45) { pass = false; reason = "wrong_bottom"; }
      else if (bB < -20) { pass = false; reason = "black_trousers"; }      // only clearly neutral/warm black; dark navy that photographs black passes
      else if (blue && bV > 0.86 && bS < 0.22) { pass = false; reason = "faded"; }      // very light fade is fine; only nearly white denim fails
      else if (m.bottom.legThigh <= 0.55 && ((m.bottom.legShin >= 0.40 && m.bottom.legRatio >= 0.84) || (m.bottom.legShin >= 0.34 && m.bottom.legThigh >= 0.47 && m.bottom.legThigh <= 0.505 && m.bottom.legRatio >= 0.70))) { pass = false; reason = "baggy"; }      // wide below the knee (wide-leg / straight-baggy); tapering jeans pass
    } else {
      const grey = st.s < 0.38 && st.v > 0.25 && st.v < 0.85 && !(bB > 8);
      if (!grey) { pass = false; reason = "wrong_bottom"; }
    }
    res.criteria.bottom = { pass, reason };
  }

  // ---------------------------------------------------------------- BELT (retail only): colour of strap; missing strap cannot be judged reliably
  if (RETAIL_ROLES.includes(designation)) {
    const r = region(hipX - hipW * 0.7, hipY - 0.55 * bu, hipX + hipW * 0.7, hipY + 0.15 * bu, "belt", "#f90");
    const s = sample(r, 2);
    const brown = s.filter(p => p[3] > 8 && p[3] < 38 && p[4] > 0.40 && p[5] > 0.15 && p[5] < 0.50).length / s.length;
    m.belt = { brown: +brown.toFixed(3) };
    const mid = sample(region(hipX - hipW * 0.5, hipY - 0.45 * bu, hipX + hipW * 0.5, hipY + 0.05 * bu, "beltMid", "#fc0"), 2);
    const skinPx = mid.filter(p => p[3] >= 5 && p[3] <= 38 && p[4] >= 0.18 && p[4] <= 0.75 && p[5] >= 0.30).length / mid.length; m.belt.skin = +skinPx.toFixed(2);
    res.criteria.belt = brown > 0.08 ? { pass: false, reason: "brown" } : skinPx > 0.22 ? { pass: false, reason: "missing" } : { pass: true, reason: "" };
  }

  // ---------------------------------------------------------------- FOOTWEAR
  {
    const fy0 = ankY - 0.3 * bu, fy1 = Math.min(H - 1, ankY + 1.35 * bu);
    const xs = [lAnk, rAnk];
    const r = region(Math.min(...xs) - 0.65 * bu, fy0, Math.max(...xs) + 0.65 * bu, fy1, "feet", "#f0f");
    // rows that contain real black pixels = the shoe; within the shoe's horizontal span count black vs white/bright/coloured. Mid-tones (shadow, texture) are ignored; the sole (bottom 15% of the shoe) is ignored.
    const rowInfo = [];
    for (let y = r.y0; y < r.y1; y += 2) {
      const xsDark = []; for (let x = r.x0; x < r.x1; x += 2) { const [R, G, B] = px(x, y); if (Math.max(R, G, B) / 255 < 0.30) xsDark.push(x); }
      // split into separate shoes: a gap wider than 0.15 body units (the floor between the feet) is not part of any shoe
      const segs = []; for (const x of xsDark) { const sg = segs[segs.length - 1]; if (sg && x - sg.last <= 0.15 * bu) { sg.last = x; sg.cnt++; } else segs.push({ first: x, last: x, cnt: 1 }); }
      rowInfo.push({ y, segs: segs.filter(g => g.cnt >= 2), cnt: xsDark.length });
    }
    const shoeRows = rowInfo.filter(q => q.cnt >= 3 && q.segs.length);
    let black = 0, bright = 0, darkPx = 0, blackS = 0, brightS = 0;
    if (shoeRows.length) {
      const yTop = shoeRows[0].y, yBot = shoeRows[shoeRows.length - 1].y, yCut = yBot - 0.15 * (yBot - yTop);
      for (const q of shoeRows) { darkPx += q.cnt;
        for (const g of q.segs) for (let x = g.first; x <= g.last; x += 2) { const [R, G, B] = px(x, q.y), [h, sat, v] = rgb2hsv(R, G, B);
          const bl = v < 0.40, br = !bl && (v > 0.62 || (sat > 0.5 && v > 0.35));
          if (bl) blackS++; else if (br) brightS++;
          if (q.y <= yCut) { if (bl) black++; else if (br) bright++; } } }
    }
    const blackFrac = black + bright ? black / (black + bright) : 0;
    const darkArea = darkPx / (((r.x1 - r.x0) / 2) * ((r.y1 - r.y0) / 2));
    m.foot = { blackFrac: +blackFrac.toFixed(2), withSole: +(blackS + brightS ? blackS / (blackS + brightS) : 0).toFixed(2), darkArea: +darkArea.toFixed(3) };
    const sockR = region(Math.min(...xs) - 0.12 * bu, ankY + 0.12 * bu, Math.max(...xs) + 0.12 * bu, ankY + 0.55 * bu, "socks", "#0cf");
    const sst = stat(sample(sockR, 2)); m.foot.sock = { h: Math.round(sst.h), s: +sst.s.toFixed(2), v: +sst.v.toFixed(2) };
    const hasShoes = darkArea > 0.05 && darkPx > 120;
    let pass = true, reason = "";
    const shoeGrade = () => blackFrac >= T.shoeBlackPass ? "" : blackFrac >= T.shoeBlack1 ? "too_much_white" : blackFrac >= T.shoeBlack2 ? "half_black" : "not_black";
    const sockGrade = () => {
      const whiteLike = sst.v > 0.80 && sst.s < 0.30, skinLike = sst.h >= 8 && sst.h <= 32 && sst.s >= 0.28 && sst.s <= 0.65 && sst.v > 0.45;
      if (sst.v < 0.25) return "socks_not_grey"; if (whiteLike) return "socks_not_grey"; if (skinLike) return "no_socks"; if (sst.s > 0.5) return "socks_not_grey"; return "";
    };
    if (roleFamily === "retail") {
      if (!hasShoes) { pass = false; reason = darkArea > 0.01 ? "not_black" : "no_shoes"; }
      else { const g = shoeGrade(); if (g) { pass = false; reason = g; } }
    } else {      // Play Pal, Play Wiz and Play Chief: grey socks only, no shoes
      if (hasShoes) { pass = false; reason = "shoes_not_allowed"; } else { const g = sockGrade(); if (g) { pass = false; reason = g; } }
    }
    if (roleFamily === "retail" && pass) {      // roller gliders or other bright attachments strapped to the shoes
      let rr = []; for (const ax of xs) rr = rr.concat(sample(region(ax - 0.5 * bu, ankY - 0.1 * bu, ax + 0.5 * bu, ankY + 0.6 * bu, "glider", "#f00"), 2));
      const redPx = rr.filter(p => (p[3] < 20 || p[3] > 340) && p[4] > 0.55 && p[5] > 0.40).length / rr.length; m.foot.red = +redPx.toFixed(3);
      if (redPx > 0.05) { pass = false; reason = "gliders"; }
    }
    res.criteria.footwear = { pass, reason };
  }

  // ---------------------------------------------------------------- FACE & HAIR
  {
    const reasons = [];
    const mesh = face.mesh, chin = mesh ? { x: mesh[152][0], y: mesh[152][1] } : { x: fcx, y: fb.y + fb.h * 0.96 };
    // beard / neck: dark hair-coloured pixels below the chin point
    const rn = region(chin.x - fb.w * 0.28, chin.y + 0.02 * fH, chin.x + fb.w * 0.28, chin.y + 0.40 * fH, "neck", "#f33");
    const rows = []; let lastDarkRow = -1;
    const skin = sample(region(fb.x + fb.w * 0.3, fb.y + fb.h * 0.45, fb.x + fb.w * 0.7, fb.y + fb.h * 0.55), 2); const sk = stat(skin);
    for (let y = rn.y0; y < rn.y1; y += 2) { let d = 0, n = 0; for (let x = rn.x0; x < rn.x1; x += 2) { const [R, G, B] = px(x, y); const v = Math.max(R, G, B) / 255; n++; if (v < 0.30 && sk.v > 0.42) d++; } rows.push(d / n); }
    // beard extent below chin = rows from the top of the band that stay mostly dark, stopping at first light (skin) row
    let run = 0; for (let i = 0; i < rows.length; i++) { if (rows[i] > 0.55) run = i + 1; else break; }
    const beardBelow = run * 2 / fH; m.face = { beardBelowChin: +beardBelow.toFixed(2), skinV: +sk.v.toFixed(2) };
    // hair volume: dark pixels above the forehead and at the sides of the head
    const hr = region(fb.x - fb.w * 0.6, fb.y - fb.h * 0.7, fb.x + fb.w * 1.6, fb.y + fb.h * 0.45, "hair", "#f33");
    let turban = false;
    { const top = stat(sample(region(fb.x + fb.w * 0.25, fb.y - fb.h * 0.35, fb.x + fb.w * 0.75, fb.y - fb.h * 0.05), 2)); m.face.topS = +top.s.toFixed(2); m.face.topV = +top.v.toFixed(2); m.face.topH = Math.round(top.h);
      turban = top.s > 0.35 && top.v > 0.12 && top.h > 200 && top.h < 260; }
    // width of dark head-hair mass at three heights above/around brow
    const widths = [];
    for (const f of [-0.12, 0.05, 0.22]) {
      const y = fb.y + fb.h * f, cxh = fb.x + fb.w / 2, dk = x => Math.max(...px(x, y)) / 255 < 0.26;
      if (!dk(cxh) && !dk(cxh - fb.w * 0.2) && !dk(cxh + fb.w * 0.2)) { widths.push(0); continue; }
      let l = cxh, r2 = cxh, miss = 0;
      for (let x = cxh; x > 0 && miss < 8; x -= 2) { if (dk(x)) { l = x; miss = 0; } else miss += 2; }
      miss = 0; for (let x = cxh; x < W && miss < 8; x += 2) { if (dk(x)) { r2 = x; miss = 0; } else miss += 2; }
      widths.push((r2 - l) / fb.w);
    }
    m.face.hairW = widths.map(w => +w.toFixed(2)); m.face.turban = turban;
    const hairW = Math.max(...widths);
    if (!turban && !opt.female && hairW > T.hairVolume) reasons.push("hair_unkempt");
    const lowFace = sample(region(fb.x + fb.w * 0.25, fb.y + fb.h * 0.62, fb.x + fb.w * 0.75, fb.y + fb.h * 0.95, "lowface", "#f33"), 2);
    const facialHair = lowFace.filter(p => p[5] < 0.30).length / lowFace.length; m.face.facialHair = +facialHair.toFixed(2);
    if (facialHair > 0.30 && beardBelow > T.beardNeck) reasons.push("beard_neck");
    res.criteria.face_hair = { pass: reasons.length === 0, reasons };
  }

  // ---------------------------------------------------------------- name tag: confirmed by the person (never scored from pixels)
  // ---------------------------------------------------------------- NAME TAG: a small red or white badge on the chest (either side)
  {
    const x0 = Math.round(shX - shW * 0.46), x1 = Math.round(shX + shW * 0.46), y0 = Math.round(shY + 0.05 * bu), y1 = Math.round(hipY - 0.25 * bu), st = 2;
    region(x0, y0, x1, y1, "tag zone", "#fa0");
    const gw = Math.ceil((x1 - x0) / st), gh = Math.ceil((y1 - y0) / st), mask = new Uint8Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const [R, G, B] = px(x0 + i * st, y0 + j * st), [h, sa, v] = rgb2hsv(R, G, B);
      const red = (h < 24 || h > 336) && sa > 0.42 && v > 0.36, white = sa < 0.22 && v > 0.78;
      mask[j * gw + i] = red ? 1 : white ? 2 : 0; }
    const seen = new Uint8Array(gw * gh); let best = null;
    for (let k = 0; k < mask.length; k++) { if (!mask[k] || seen[k]) continue;
      const kind = mask[k], q = [k]; seen[k] = 1; let n = 0, mnx = 1e9, mxx = -1, mny = 1e9, mxy = -1;
      while (q.length) { const c = q.pop(), cx = c % gw, cy = (c / gw) | 0; n++; mnx = Math.min(mnx, cx); mxx = Math.max(mxx, cx); mny = Math.min(mny, cy); mxy = Math.max(mxy, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue; const nk = ny * gw + nx; if (mask[nk] === kind && !seen[nk]) { seen[nk] = 1; q.push(nk); } } }
      const w = (mxx - mnx + 1) * st, h = (mxy - mny + 1) * st, fill = n * st * st / (w * h);
      if (n > 8) (m.tagDbg = m.tagDbg || []).push({ k: kind, n, w, h, fill: +fill.toFixed(2), x: x0 + mnx * st, y: y0 + mny * st });
      if (w >= 0.07 * shW && w <= 0.65 * shW && h >= 0.035 * shW && h <= 0.45 * shW && fill > 0.35 && w / h > 0.6 && w / h < 5) {
        // the badge must sit on the garment: its surroundings (a ring around it) must be dark for a black polo, and never the same colour as the badge
        let ringN = 0, ringOk = 0, ringRed = 0; const bx0 = x0 + mnx * st, by0 = y0 + mny * st, pad = Math.max(6, 0.35 * Math.min(w, h));
        for (let yy = by0 - pad; yy <= by0 + h + pad; yy += 3) for (let xx = bx0 - pad; xx <= bx0 + w + pad; xx += 3) { if (xx >= bx0 - 1 && xx <= bx0 + w + 1 && yy >= by0 - 1 && yy <= by0 + h + 1) continue; const [R, G, B] = px(xx, yy), [hh, sa, v] = rgb2hsv(R, G, B); ringN++;
          const isRed = (hh < 24 || hh > 336) && sa > 0.42 && v > 0.36; if (isRed) ringRed++;
          const sameKind = kind === 1 ? isRed : (sa < 0.22 && v > 0.78);
          if (!sameKind && (roleFamily !== "retail" || v < 0.45 || isRed)) ringOk++; }
        if (ringN < 12 || ringOk / ringN < 0.7) continue;
        if (kind === 2 && ringRed / ringN < 0.12) continue;      // a white strip must sit on a red card
        // a real name tag is a red card with a white name strip: both colours must be present together (the embroidered logo is red only)
        let bn = 0, br = 0, bw = 0; for (let yy = by0 - 3; yy <= by0 + h + 3; yy += 2) for (let xx = bx0 - 8; xx <= bx0 + w + 8; xx += 2) { const [R, G, B] = px(xx, yy), [hh, sa, v] = rgb2hsv(R, G, B); bn++; if ((hh < 22 || hh > 338) && sa > 0.45 && v > 0.35) br++; else if (sa < 0.28 && v > 0.70) bw++; }
        const compact = w / h > 0.6 && w / h < 1.9 && fill >= 0.5;
        if (!(br / bn >= 0.12 && bw / bn >= 0.07) && !compact) continue; if (!best || n > best.n) best = { kind: kind === 1 ? "red" : "white", n, w: Math.round(w), h: Math.round(h), fill: +fill.toFixed(2), x0: x0 + mnx * st, y0: y0 + mny * st }; } }
    m.tag = best || { none: true };
    res.criteria.name_tag = best ? { pass: true, reason: "" } : { pass: false, reason: "not_visible" };
  }
  return res;
}
