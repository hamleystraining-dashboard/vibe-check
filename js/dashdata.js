// Dashboard data layer. ONE function decides where numbers come from: load().
// Today: (a) check-ins saved on THIS phone/browser, or (b) generated sample data for previews.
// Later (Supabase): replace the body of load() with two queries and return the same shape:
//   records:    [{ date:'YYYY-MM-DD', code:'THE0', name:'Asha', role:'Fun Consultant', pct:86.0 }]   best score per person per day
//   headcounts: [{ date:'YYYY-MM-DD', code:'THE0', n:12 }]
import { outbox, todayIST } from './db.js';
import { enabled, rpc } from './supa.js';

export function fromLocal() {
  const best = new Map(), hc = new Map();
  for (const o of outbox.get()) {
    const d = o.data || {};
    if (o.type === "attempt" && d.store && d.name && d.date) {
      const k = `${d.date}|${d.store}|${d.name.trim().toLowerCase()}`, cur = best.get(k);
      if (!cur || d.pct > cur.pct) best.set(k, { date: d.date, code: d.store, name: d.name.trim(), role: d.role || "", pct: d.pct });
    } else if (o.type === "headcount" && d.store && d.date) hc.set(`${d.date}|${d.store}`, { date: d.date, code: d.store, n: d.n });
  }
  return { records: [...best.values()], headcounts: [...hc.values()] };
}

// Sample data so the layout can be reviewed. Seeded, so it looks the same every time.
export function sample(stores, endDate) {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const roles = ["Fun Consultant", "Fun Consultant", "Fun Consultant", "Section Supervisor", "BOH", "DySM", "Store Manager"], playRoles = ["Play Pal", "Play Wiz", "Play Chief"];
  const first = ["Asha", "Ravi", "Meena", "Imran", "Kavya", "Rohit", "Sana", "Vikram", "Neha", "Arjun", "Pooja", "Karan", "Divya", "Sameer", "Isha", "Manoj"];
  const records = [], headcounts = [], end = new Date(endDate + "T00:00:00Z");
  stores.forEach((s, si) => {
    if (rnd() < 0.18) return;                                   // some stores never check in
    const team = 4 + Math.floor(rnd() * 9), quality = 0.74 + rnd() * 0.24;
    const people = Array.from({ length: team }, (_, i) => ({ name: first[(si * 3 + i) % first.length] + (i > 7 ? " K." : ""), role: s.type === "Play" || (s.type === "Retail/Play" && i % 3 === 0) ? playRoles[i % 3] : roles[i % roles.length], skill: quality + (rnd() - 0.5) * 0.25 }));
    for (let back = 0; back < 35; back++) {
      const d = new Date(end - back * 864e5).toISOString().slice(0, 10);
      if (rnd() < 0.12) continue;                               // store missed this day
      let got = 0;
      for (const p of people) if (rnd() < 0.85) { got++; records.push({ date: d, code: s.code, name: p.name, role: p.role, pct: Math.round(Math.max(40, Math.min(100, (p.skill + (rnd() - 0.5) * 0.25) * 100)) * 10) / 10 }); }
      if (got && rnd() < 0.9) headcounts.push({ date: d, code: s.code, n: team });
    }
  });
  return { records, headcounts };
}

// Supabase: needs the dashboard passcode. Throws Error('denied') when it is wrong.
export async function fromSupabase(pass, from, to) {
  const j = await rpc("dashboard_data", { p_pass: pass, p_from: from, p_to: to }, 30000);
  return { records: (j.records || []).map(r => ({ ...r, pct: Number(r.pct) })), headcounts: j.headcounts || [] };
}
export const sharedEnabled = enabled;
export async function load({ stores, demo, endDate, pass, from, to }) {
  if (demo) return sample(stores, endDate || todayIST());
  return enabled ? fromSupabase(pass, from, to) : fromLocal();
}
