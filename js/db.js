// Data layer. Today it saves on THIS phone only (localStorage). Every call goes through this file,
// so switching to Supabase later means replacing these functions, not touching the page.
import { enabled, rpc } from "./supa.js";
const P = "vc:";
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(P + k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch { return false; } };

export const todayIST = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });   // YYYY-MM-DD
export const dayKey = (store, name, date = todayIST()) => `day:${date}:${store}:${name.trim().toLowerCase()}`;

export const profile = { get: () => read("profile", null), set: v => write("profile", v) };
export const consent = { get: () => read("consent", false), set: () => write("consent", true) };

// one person, one day: attempts (each with score), best, done flag
export const day = {
  get: (store, name) => read(dayKey(store, name), { attempts: [], done: false, best: null }),
  addAttempt(store, name, a) {
    const d = day.get(store, name); d.attempts.push(a);
    if (!d.best || a.pct > d.best.pct) d.best = a; write(dayKey(store, name), d);
    log("attempt", { store, name, date: todayIST(), ...a }); return d;
  },
  finish(store, name) { const d = day.get(store, name); d.done = true; write(dayKey(store, name), d); log("done", { store, name, date: todayIST(), best: d.best }); return d; },
};

// headcount per store per day (a nudge, never blocks a check-in)
export const headcount = {
  get: (store, date = todayIST()) => read(`hc:${date}:${store}`, null),
  set: (store, n, by) => { const v = { n, by, at: new Date().toISOString() }; write(`hc:${todayIST()}:${store}`, v); log("headcount", { store, date: todayIST(), n, by }); return v; },
  previous7(store) {
    const out = []; for (let i = 1; i <= 7; i++) { const d = todayIST(new Date(Date.now() - i * 864e5)); const v = read(`hc:${d}:${store}`, null); if (v) out.push(v.n); }
    return out;
  },
  receivedToday(store) {    // distinct people who finished today, as seen on this phone
    const date = todayIST(), pre = `${P}day:${date}:${store}:`; let n = 0;
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(pre)) { try { if (JSON.parse(localStorage.getItem(k)).attempts.length) n++; } catch {} } }
    return n;
  },
  suggested(store) {
    const prev = headcount.previous7(store), avg = prev.length ? Math.round(prev.reduce((a, b) => a + b, 0) / prev.length) : 0;
    return Math.max(headcount.receivedToday(store), avg, 1);
  },
};

// outbox: every attempt / headcount is queued here, then sent to Supabase. If the phone is offline it is retried next time.
// Only numbers and text are sent (never a photo).
function log(type, data) { const o = read("outbox", []); o.push({ type, data, at: new Date().toISOString(), sent: !enabled }); write("outbox", o.slice(-500)); flush(); }
let flushing = false;
export async function flush() {
  if (!enabled || flushing) return; flushing = true;
  try {
    for (;;) {
      const o = read("outbox", []), i = o.findIndex(x => !x.sent); if (i < 0) break;
      const x = o[i], d = x.data;
      try {
        if (x.type === "attempt") await rpc("submit_checkin", { p_day: d.date, p_store: d.store, p_person: d.name, p_role: d.role || null, p_pct: Math.round(d.pct * 100) / 100, p_total: d.total, p_max: d.max });
        else if (x.type === "headcount") await rpc("submit_headcount", { p_day: d.date, p_store: d.store, p_n: d.n, p_by: d.by || null });
      } catch (e) { if (e.status && e.status >= 400 && e.status < 500) { /* rejected for good: do not retry forever */ } else break; }
      const o2 = read("outbox", []), j = o2.findIndex(y => y.at === x.at && y.type === x.type); if (j >= 0) { o2[j].sent = true; write("outbox", o2); }
    }
  } finally { flushing = false; }
}
export const outbox = { get: () => read("outbox", []), pending: () => read("outbox", []).filter(x => !x.sent).length };
if (typeof addEventListener === "function") { addEventListener("online", flush); setTimeout(flush, 1500); }
