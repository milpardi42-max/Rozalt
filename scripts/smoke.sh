#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Rosie Atelier — pre-launch smoke test.
#
#   ./scripts/smoke.sh                       # against http://localhost:3000
#   BASE_URL=https://your-domain.com ./scripts/smoke.sh
#
# Verifies: readiness probe, locale routing, the public storefront, and the
# admin authentication round-trip (login → session → guarded panel).
# Credentials are read from .env.local (or ADMIN_EMAIL / ADMIN_PASSWORD).
# Exit code 0 = everything green, 1 = at least one check failed.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(dirname "$0")/.."
BASE_URL="${BASE_URL:-http://localhost:${PORT:-3000}}"
BASE_URL="${BASE_URL%/}"

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a; source .env.local; set +a
fi

pass=0; fail=0
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '\033[1;31m  ✗\033[0m %s\n' "$1"; fail=$((fail + 1)); }

# code <path> → HTTP status, following no redirects
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$BASE_URL$1"; }
# location <path> → redirect target
location() { curl -s -o /dev/null -w '%{redirect_url}' --max-time 20 "$BASE_URL$1"; }

echo "▸ smoke testing $BASE_URL"

# ── readiness ────────────────────────────────────────────────────────────────
health="$(curl -s --max-time 20 "$BASE_URL/api/health" || true)"
if grep -q '"ok":true' <<<"$health"; then ok "GET /api/health → ok"; else bad "GET /api/health → $health"; fi
if grep -q '"configured":true' <<<"$health"; then ok "admin account configured"; else bad "admin not configured (set ADMIN_EMAIL / ADMIN_PASSWORD)"; fi
backend="$(sed -n 's/.*"backend":"\([a-z]*\)".*/\1/p' <<<"$health")"
case "$backend" in
  redis) ok "content backend: redis (persistent)";;
  file)  ok "content backend: file (data/content.json)";;
  *)     bad "unknown content backend: ${backend:-none}";;
esac

# ── routing & storefront ─────────────────────────────────────────────────────
[[ "$(code /)" == "307" || "$(code /)" == "308" ]] && ok "/ → locale redirect" || bad "/ did not redirect"
for path in /fa /en /fa/shop /fa/patterns /fa/artists /fa/academy /fa/portfolio \
            /fa/collections /fa/styles /fa/stories /fa/spaces /fa/projects \
            /fa/about /fa/contact /fa/faq /fa/login /fa/signup /fa/checkout \
            /fa/favorites /fa/creators/join /en/shop /robots.txt /sitemap.xml /api/search-index; do
  status="$(code "$path")"
  [[ "$status" == "200" ]] && ok "GET $path → 200" || bad "GET $path → $status"
done

# ── admin surface ────────────────────────────────────────────────────────────
[[ "$(code /admin/fa/login)" == "200" ]] && ok "admin login page reachable" || bad "admin login page not reachable"
[[ "$(code /admin/fa)" == "307" ]] && ok "guarded panel redirects anonymous visitors" || bad "panel not guarded ($(code /admin/fa))"
site_admin_status="$(code /fa/admin)"
case "$site_admin_status" in
  307|308) ok "/fa/admin → $(location /fa/admin)";;
  *)       bad "/fa/admin → $site_admin_status (expected a real redirect to /admin/fa)";;
esac
[[ "$(code /api/admin/content)" == "401" ]] && ok "content API rejects anonymous callers" || bad "content API leak ($(code /api/admin/content))"

# ── admin sign-in round-trip ─────────────────────────────────────────────────
if [[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]]; then
  jar="$(mktemp)"
  body="$(curl -s --max-time 20 -c "$jar" -X POST "$BASE_URL/api/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" || true)"
  if grep -q '"role":"admin"' <<<"$body"; then
    ok "admin login → signed session cookie"
    grep -q "$ADMIN_EMAIL" <<<"$(curl -s --max-time 20 -b "$jar" "$BASE_URL/api/auth/me" || true)" \
      && ok "GET /api/auth/me → session restored" || bad "session not restored"
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -b "$jar" "$BASE_URL/admin/fa")" == "200" ]] \
      && ok "authenticated /admin/fa → 200" || bad "authenticated panel failed"
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -b "$jar" "$BASE_URL/api/admin/content")" == "200" ]] \
      && ok "admin can read live content" || bad "admin content read failed"
  else
    bad "admin login failed → $body"
  fi
  rm -f "$jar"
else
  bad "ADMIN_EMAIL / ADMIN_PASSWORD not found (checked .env.local and the environment)"
fi

echo
printf '\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
[[ "$fail" == "0" ]]
