// Port of scoring.py: roles, reason tables, points. The vision step only supplies pass/fail + reason codes;
// points are always calculated here.
export const RETAIL_ROLES = ["Fun Consultant", "Section Supervisor", "BOH", "Commercial", "DySM", "Store Manager"];
export const PLAY_ROLES = ["Play Pal", "Play Wiz", "Play Chief"];
export const SCORED_ROLES = [...RETAIL_ROLES, ...PLAY_ROLES];
export const FAMILY = {
  "Fun Consultant": "polo", "Section Supervisor": "polo", "BOH": "polo", "Commercial": "polo",
  "DySM": "shirt", "Store Manager": "shirt", "Play Pal": "dungaree", "Play Wiz": "dungaree", "Play Chief": "blazer",
};
export const WEIGHTS = { face_hair: 5, top: 10, bottom: 10, belt: 10, footwear: 10, name_tag: 5 };
export const LABELS = { top: "Top", bottom: "Bottom", face_hair: "Face & Hair", footwear: "Footwear", name_tag: "Name tag", belt: "Belt" };
export const ORDER = ["face_hair", "top", "bottom", "belt", "footwear", "name_tag"];

export const applies = d => RETAIL_ROLES.includes(d) ? [...ORDER] : ORDER.filter(c => c !== "belt");
export const maxScore = d => applies(d).reduce((s, c) => s + WEIGHTS[c], 0);

const TOP = { not_tucked: ["Shirt/polo not tucked in", null], creased: ["Top visibly creased or unironed", null],
  wrong_top: ["Wrong uniform top for this role", null], other: ["Top does not meet the uniform standard", null] };
const BOTTOM_RETAIL = { baggy: ["Jeans not tapered fit: too baggy", null],
  faded: ["Jeans are very pale or washed: dark blue denim required", null],
  black_trousers: ["Black trousers not allowed for this role: wear blue jeans", null],
  wrong_bottom: ["Wrong bottom garment for this role", null], other: ["Bottom does not meet the uniform standard", null] };
const BOTTOM_PLAY = { wrong_bottom: ["Wrong bottom garment for this role", null], baggy: ["Trousers not tapered fit: too baggy", null],
  other: ["Bottom does not meet the uniform standard", null] };
const BELT = { brown: ["Belt is brown: must be black", null], not_black: ["Belt strap is clearly not black", null],
  missing: ["Belt not visible: keep your top tucked in and hands at your sides", null], other: ["Belt does not meet the uniform standard", null] };
const NAME_TAG = { not_visible: ["Name tag not visible", null] };
const FACE = { hair_not_tied: ["Hair not tied back", 3], hair_unkempt: ["Hair messy or out of place", 3],
  beard_neck: ["Beard on neck: trim the neckline", 3], beard_unkempt: ["Beard not neatly trimmed", 3],
  makeup_missing: ["Makeup required but not visible", 3], other: ["Grooming does not meet the standard", 3] };
const FOOT_SHOES = { too_much_white: ["Some white or colour on the shoe: shoes should be mostly black", 3],
  half_black: ["Shoe only about half black: shoes must be mostly black", 6], not_black: ["Shoes are not black", null],
  shoes_scuffed: ["Shoes scuffed or unpolished", 3] };
const FOOT_RETAIL = { ...FOOT_SHOES, socks_not_black: ["Socks not black: plain black socks required", 5],
  no_shoes: ["No shoes worn: black shoes required for this role", null], other: ["Footwear does not meet the uniform standard", null] };
const FOOT_PAL = { socks_not_grey: ["Socks not grey: required for this role", null], no_socks: ["No socks visible", null],
  shoes_not_allowed: ["Shoes worn: grey socks only for this role", null], other: ["Footwear does not meet the uniform standard", null] };
const FOOT_CHIEF = { ...FOOT_SHOES, socks_not_grey: ["Socks not grey: plain grey socks or black shoes required", null],
  no_socks: ["No socks or shoes visible", null], other: ["Footwear does not meet the uniform standard", null] };

export function reasonTable(d, c) {
  if (c === "top") return TOP;
  if (c === "name_tag") return NAME_TAG;
  if (c === "belt") return BELT;
  if (c === "bottom") return PLAY_ROLES.includes(d) ? BOTTOM_PLAY : BOTTOM_RETAIL;
  if (c === "footwear") return d === "Play Chief" ? FOOT_CHIEF : PLAY_ROLES.includes(d) ? FOOT_PAL : FOOT_RETAIL;
  if (c === "face_hair") {
    const allowed = new Set(["hair_unkempt", "beard_neck", "beard_unkempt", "other"]);
    if (PLAY_ROLES.includes(d)) allowed.add("hair_not_tied");
    if (d === "Play Chief") allowed.add("makeup_missing");
    return Object.fromEntries(Object.entries(FACE).filter(([k]) => allowed.has(k)));
  }
  throw new Error(c);
}

export function calculate(criteria, d) {
  const scores = {}, maxes = {}, pass = {}, feedback = [];
  for (const c of applies(d)) {
    const mx = WEIGHTS[c], raw = criteria[c], table = reasonTable(d, c);
    let lost = 0;
    if (c === "face_hair") {
      let codes = Array.isArray(raw.reasons) ? raw.reasons : [];
      codes = [...new Set(codes)].filter(x => x in table);
      for (const code of codes) {
        const step = Math.min(table[code][1] || 3, mx - lost);
        if (step <= 0) break;
        lost += step; feedback.push({ criterion: c, code, reason: table[code][0], points_lost: step });
      }
    } else if (raw.pass !== true) {
      let code = raw.reason in table ? raw.reason : "other";
      if (c === "name_tag") code = "not_visible";
      lost = Math.min(table[code][1] || mx, mx);
      feedback.push({ criterion: c, code, reason: table[code][0], points_lost: lost });
    }
    scores[c] = mx - lost; maxes[c] = mx; pass[c] = lost === 0;
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0), max = Object.values(maxes).reduce((a, b) => a + b, 0);
  return { total, max, scores, maxes, pass, feedback };
}
