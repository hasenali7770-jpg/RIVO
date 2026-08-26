#!/usr/bin/env bash
#
# Checks that a pair of Mapbox tokens actually works, before you find out
# halfway through a demonstration that they do not.
#
#   export MAPBOX_PUBLIC_TOKEN=pk....
#   export MAPBOX_SECRET_TOKEN=sk....
#   ./infra/scripts/verify-mapbox.sh
#
# Calls the three things RIVO depends on — place search, reverse geocoding and
# traffic-aware routing — plus the SDK download endpoint the mobile build needs.
# It reads nothing from the repository and writes nothing; it only asks Mapbox.

set -uo pipefail

PASS=0; FAIL=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
note() { printf '    %s\n' "$1"; }

PUBLIC="${MAPBOX_PUBLIC_TOKEN:-}"
SECRET="${MAPBOX_SECRET_TOKEN:-}"
DOWNLOADS="${MAPBOX_DOWNLOADS_TOKEN:-$SECRET}"

[ -n "$PUBLIC" ] || { echo "MAPBOX_PUBLIC_TOKEN is not set."; exit 1; }
[ -n "$SECRET" ] || { echo "MAPBOX_SECRET_TOKEN is not set."; exit 1; }

printf '\n\033[1mMapbox credential check\033[0m\n\n'

case "$PUBLIC" in pk.*) pass "public token has the pk. prefix" ;;
  *) fail "MAPBOX_PUBLIC_TOKEN does not start with pk. — this is not a public token" ;;
esac
case "$SECRET" in sk.*) pass "server token has the sk. prefix" ;;
  *) fail "MAPBOX_SECRET_TOKEN does not start with sk. — a public token here would be shipped to clients by mistake" ;;
esac

# Both tokens must belong to the same account, or usage and billing split in two.
account_of() {
  local payload="${1#*.}"; payload="${payload%%.*}"
  while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="${payload}="; done
  printf '%s' "$payload" | tr '_-' '/+' | base64 -d 2>/dev/null | sed -n 's/.*"u":"\([^"]*\)".*/\1/p'
}
PUB_ACC="$(account_of "$PUBLIC")"; SEC_ACC="$(account_of "$SECRET")"
if [ -n "$PUB_ACC" ] && [ "$PUB_ACC" = "$SEC_ACC" ]; then
  pass "both tokens belong to the same account ($PUB_ACC)"
else
  fail "the tokens belong to different accounts (${PUB_ACC:-?} and ${SEC_ACC:-?})"
fi

printf '\n\033[1mThe three APIs RIVO calls\033[0m\n\n'

# 1. Place search — the destination box, and the map pin step when listing.
code=$(curl -s -o /tmp/mb-geocode.json -w '%{http_code}' --max-time 20 \
  "https://api.mapbox.com/geocoding/v5/mapbox.places/%D8%A7%D9%84%D9%85%D9%86%D8%B5%D9%88%D8%B1.json?access_token=${SECRET}&country=iq&language=ar&limit=3")
if [ "$code" = "200" ]; then
  n=$(grep -o '"place_name"' /tmp/mb-geocode.json | wc -l | tr -d ' ')
  pass "place search works — $n results for \"المنصور\" in Iraq"
  grep -o '"place_name_ar":"[^"]*"' /tmp/mb-geocode.json 2>/dev/null | head -1 | sed 's/^/    /' \
    || grep -o '"place_name":"[^"]*"' /tmp/mb-geocode.json | head -1 | sed 's/^/    /'
else
  fail "place search returned HTTP $code"
  head -c 200 /tmp/mb-geocode.json 2>/dev/null | sed 's/^/    /'; echo
fi

# 2. Reverse geocoding — turning a dropped pin into a district name.
code=$(curl -s -o /tmp/mb-rev.json -w '%{http_code}' --max-time 20 \
  "https://api.mapbox.com/geocoding/v5/mapbox.places/44.3462,33.3092.json?access_token=${SECRET}&language=ar&limit=1")
[ "$code" = "200" ] && pass "reverse geocoding works — a map pin resolves to a place name" \
                    || fail "reverse geocoding returned HTTP $code"

# 3. Traffic-aware routing — the whole point of خرائط.
code=$(curl -s -o /tmp/mb-dir.json -w '%{http_code}' --max-time 25 \
  "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/44.3661,33.3152;44.3462,33.3092?access_token=${SECRET}&alternatives=true&geometries=polyline6&overview=full&steps=true&language=ar")
if [ "$code" = "200" ]; then
  routes=$(grep -o '"weight_name"' /tmp/mb-dir.json | wc -l | tr -d ' ')
  dur=$(sed -n 's/.*"duration":\([0-9.]*\).*/\1/p' /tmp/mb-dir.json | head -1)
  pass "traffic-aware routing works — $routes route(s), first ETA ${dur%.*}s"
  [ "$routes" -gt 1 ] && note "alternative routes are being returned for this pair" \
                      || note "one route for this pair; alternatives depend on the road network"
  grep -q '"driving-traffic"' /tmp/mb-dir.json && note "the profile in use is driving-traffic, so ETAs account for congestion"
else
  fail "routing returned HTTP $code"
  head -c 200 /tmp/mb-dir.json 2>/dev/null | sed 's/^/    /'; echo
fi

printf '\n\033[1mThe mobile build credential\033[0m\n\n'

# Gradle and CocoaPods authenticate against this endpoint. A public token, or a
# secret token without Downloads:Read, gets a 401 here — and the mobile build
# fails with nothing but that number.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -u "mapbox:${DOWNLOADS}" \
  "https://api.mapbox.com/downloads/v2/releases/maven/com/mapbox/maps/android/maven-metadata.xml")
case "$code" in
  200) pass "the Downloads:Read scope is present — the Android and iOS builds can fetch the SDK" ;;
  401|403) fail "SDK download is refused (HTTP $code) — this token has no Downloads:Read scope"
           note "Create a token at https://account.mapbox.com/access-tokens/ and tick Downloads:Read"
           note "under Secret scopes. A secret token is shown only once, so copy it then." ;;
  *) fail "SDK download check returned HTTP $code" ;;
esac

printf '\n\033[1mResult\033[0m\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
