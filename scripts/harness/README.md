# Offline UI harness

The real web build (`dist/`), driven in WebKit (Safari's engine) at iPhone
size, with **every Supabase call answered locally** from a snapshot plus
fixtures. Nothing reaches the live database: requests to the project are
intercepted and never forwarded, the realtime socket is closed locally, the
service worker is blocked (it would route requests around the interception),
and storage files are local placeholders. Signing in as a real person is not
an option any more — one phone per account would sign their phone out.

    npx expo export -p web && npx serve dist -s -l 4173 &
    ./scripts/harness/snapshot.sh          # once: refresh .dev-session/harness-snapshot.json
    node scripts/harness/s1-dashboard.js   # screenshots land in .dev-session/harness/

Scenarios: s1 dashboard deadlines + record/excuse + update banner · s2 Staff
(folded shifts, schedule sheet, access switches) · s3 control panel (Safari
time boxes, push reach lines) · s4 branch map (zoom, My location) · s5
marination (Arabic digits, manager correction, day report PDF text).

The harness does not apply row-level security: every role sees every row.
