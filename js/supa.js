import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
export const enabled = !!(SUPABASE_URL && SUPABASE_KEY);
export async function rpc(fn, body, timeoutMs = 15000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", signal: ctl.signal, headers: { apikey: SUPABASE_KEY, ...(SUPABASE_KEY.startsWith("eyJ") ? { Authorization: `Bearer ${SUPABASE_KEY}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) { const e = new Error((j && (j.message || j.hint)) || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(t); }
}
