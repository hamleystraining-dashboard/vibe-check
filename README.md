# Hamleys Vibe Check (v1, on-phone scoring)
Static site: no server, no AI key. Upload the whole folder to a GitHub repo and turn on Pages (Settings > Pages > main branch, root).
Open https://<org>.github.io/<repo>/ in Chrome or Safari. Photos are analysed on the phone and never uploaded.

- js/rules.js     scoring tables and points (port of scoring.py). Pass mark: PASS_PERCENT in index.html.
- js/analyze.js   the checks. Thresholds are in the T object at the top: tune them with more example photos.
- models/, lib/, wasm/  free vision models and runtime, bundled so nothing loads from outside (fonts excepted).
Not built yet: attempts per day, streaks, dashboard, admin (need Supabase).
