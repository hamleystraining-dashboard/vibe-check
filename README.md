# Hamleys Vibe Check (v2)
Static site, no server and no AI key. Upload the folder contents to the GitHub repo (replace existing files).
- index.html      the staff page: store + name + designation, live camera only, 3 attempts a day, Done for the day, headcount
- js/db.js        data layer. Saves on the phone only for now; swap these functions for Supabase to share data
- js/rules.js     scoring tables and points   - js/analyze.js  the photo checks (thresholds in T)
- data_stores.js  the 124 stores

## Dashboard
Open `dashboard.html` (add `?demo=1` for sample data). Today it reads check-ins saved on the same phone; to show every store, replace the body of `load()` in `js/dashdata.js` with Supabase queries.

## Supabase
Connection details are in `js/config.js`. Tables and functions are created by the SQL in the project notes; the dashboard needs the passcode stored in `app_settings`.
