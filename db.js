// Data layer. Today it saves on THIS phone only (localStorage). Every call goes through this file,
// so switching to Supabase later means replacing these functions, not touching the page.
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

// outbox of everything that should reach the shared database once it exists
function log(type, data) { const o = read("outbox", []); o.push({ type, data, at: new Date().toISOString() }); write("outbox", o.slice(-500)); }
export const outbox = { get: () => read("outbox", []) };
