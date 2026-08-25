#!/usr/bin/env bash
#
# RIVO acceptance run — Master Plan §21.
#
# Drives a real listing through its whole life against a running API and a real
# PostgreSQL+PostGIS, and prints PASS/FAIL for each checklist item. Nothing here
# is mocked: every assertion is made against an HTTP response or a row in the
# database.
#
#   ./infra/scripts/acceptance.sh
#
# Requirements: the API running (default http://localhost:3000), DATABASE_URL
# set, and ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD naming a working
# Super Admin. Each run creates its own staff accounts and listing, so it is
# safe to run repeatedly; it never truncates anything.
#
# Checks that need a credential the deployment does not have (Mapbox, R2,
# Cloudflare Stream) report SKIP with the variable that would enable them,
# rather than passing on a stub.

set -uo pipefail

API="${RIVO_API_URL:-http://localhost:3000}/api/v1"
RUN_ID="$(date -u +%H%M%S)-$RANDOM"
PASS=0; FAIL=0; SKIP=0

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL + 1)); }
skip() { printf '  \033[33mSKIP\033[0m  %s — %s\n' "$1" "$2"; SKIP=$((SKIP + 1)); }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Asserts an HTTP status. check <expected> <label> <curl args...>
check() {
  local want="$1" label="$2"; shift 2
  local got; got="$(curl -s -o /tmp/rivo-acc-body.json -w '%{http_code}' "$@")"
  if [ "$got" = "$want" ]; then pass "$label"; else fail "$label (expected HTTP $want, got $got)"; fi
}

# Asserts the error code inside the envelope. check_code <status> <code> <label> <curl args...>
check_code() {
  local want="$1" code="$2" label="$3"; shift 3
  local got; got="$(curl -s -o /tmp/rivo-acc-body.json -w '%{http_code}' "$@")"
  local actual; actual="$(jq -r '.error.code // "none"' /tmp/rivo-acc-body.json 2>/dev/null)"
  if [ "$got" = "$want" ] && [ "$actual" = "$code" ]; then
    pass "$label"
  else
    fail "$label (expected HTTP $want/$code, got $got/$actual)"
  fi
}

# libpq rejects Prisma-only URL parameters; strip them. Same helper as backup.sh.
libpq_url() {
  local url="${DATABASE_URL:?DATABASE_URL is not set}"
  local base="${url%%\?*}" query="${url#*\?}" kept=""
  [ "$query" = "$url" ] && { printf '%s' "$base"; return; }
  local IFS='&'
  for pair in $query; do
    case "${pair%%=*}" in
      schema|connection_limit|pool_timeout|pgbouncer|connect_timeout|socket_timeout) ;;
      *) kept="${kept:+$kept&}$pair" ;;
    esac
  done
  printf '%s%s' "$base" "${kept:+?$kept}"
}

sql() { psql "$(libpq_url)" -t -A -c "$1" 2>/dev/null; }
sql_fails() { psql "$(libpq_url)" -q -c "$1" >/dev/null 2>&1 && return 1 || return 0; }

command -v jq >/dev/null || { echo "jq is required"; exit 1; }
curl -sf "$API/health" >/dev/null || { echo "API is not answering at $API — start it first"; exit 1; }

printf '\033[1mRIVO acceptance run\033[0m  %s  api=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$API"

CAPS="$(curl -s "$API/health/capabilities")"
has() { [ "$(printf '%s' "$CAPS" | jq -r ".$1")" = "true" ]; }

# --- staff accounts --------------------------------------------------------
ADMIN_TOKEN="$(curl -s -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_BOOTSTRAP_EMAIL:?}\",\"password\":\"${ADMIN_BOOTSTRAP_PASSWORD:?}\"}" | jq -r '.token // empty')"
[ -n "$ADMIN_TOKEN" ] || { echo "Could not sign in as ADMIN_BOOTSTRAP_EMAIL — check the credentials or wait out the login rate limit"; exit 1; }

STAFF_PASSWORD="Acceptance-$RUN_ID-Aa1!"
declare -A STAFF
for role in MODERATOR FINANCE SUPPORT; do
  email="acc-${role,,}-${RUN_ID}@rivo.local"
  curl -s -X POST "$API/admin/admins" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"displayName\":\"acceptance $role\",\"role\":\"$role\",\"temporaryPassword\":\"$STAFF_PASSWORD\"}" >/dev/null
  STAFF[$role]="$(curl -s -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$STAFF_PASSWORD\"}" | jq -r '.token // empty')"
done

# --- seller sign-in --------------------------------------------------------
SELLER_PHONE="+96477${RANDOM:0:2}${RANDOM:0:6}"
OTP="$(curl -s -X POST "$API/auth/request-otp" -H 'Content-Type: application/json' -d "{\"phone\":\"$SELLER_PHONE\"}")"
DEV_CODE="$(printf '%s' "$OTP" | jq -r '.devCode // empty')"
if [ -z "$DEV_CODE" ]; then
  echo "No devCode in the OTP response — this deployment uses a real SMS provider, so the seller leg cannot be automated."
  echo "Run the seller steps by hand, or point the script at a staging deployment with OTP_PROVIDER=console."
  exit 1
fi
SELLER="$(curl -s -X POST "$API/auth/verify-otp" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$SELLER_PHONE\",\"challengeToken\":\"$(printf '%s' "$OTP" | jq -r .challengeToken)\",\"code\":\"$DEV_CODE\",\"platform\":\"android\"}" \
  | jq -r '.accessToken')"
SELLER_AUTH=(-H "Authorization: Bearer $SELLER")

section 'Darcom — listing lifecycle'

PROP="$(curl -s -X POST "$API/properties" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' -d '{
  "type":"APARTMENT","purpose":"SALE","title":"شقة اختبار القبول في المنصور",
  "description":"إعلان اختباري أنشأه سكربت القبول للتحقق من دورة حياة الإعلان بالكامل.",
  "priceIqd":"185000000","areaSqm":180,"bedrooms":3,"bathrooms":2,
  "governorate":"BAGHDAD","district":"المنصور","lat":33.3092,"lng":44.3462}')"
PID="$(printf '%s' "$PROP" | jq -r '.id // empty')"
[ -n "$PID" ] && pass "listing created (reference $(printf '%s' "$PROP" | jq -r .reference))" \
              || { fail "listing could not be created: $(printf '%s' "$PROP" | jq -c .error)"; exit 1; }

media_rows() {
  sql "INSERT INTO property_media (property_id,kind,object_key,bucket,mime_type,size_bytes,width,height,position,upload_confirmed)
       SELECT '$PID','ORIGINAL','acceptance/$PID/$RUN_ID-'||g||'.jpg','rivo-media','image/jpeg',420000,1600,1200,g-1,true
         FROM generate_series($1,$2) g;" >/dev/null
}

check_code 422 PHOTO_COUNT_TOO_LOW "0 photos cannot be submitted" \
  -X POST "$API/properties/$PID/submit" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' -d '{}'

media_rows 1 7
[ "$(sql "SELECT photo_count FROM properties WHERE id='$PID';")" = "7" ] \
  && pass "photo_count trigger tracks uploads (7)" || fail "photo_count trigger did not update"
check_code 422 PHOTO_COUNT_TOO_LOW "7 photos cannot be submitted" \
  -X POST "$API/properties/$PID/submit" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' -d '{}'

media_rows 8 8
check 200 "8 photos can proceed" \
  -X POST "$API/properties/$PID/submit" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' -d '{}'
[ "$(jq -r .status /tmp/rivo-acc-body.json)" = "AWAITING_PAYMENT" ] \
  && pass "submitted listing waits for payment" || fail "unexpected status after submit"

media_rows 9 18
[ "$(sql "SELECT photo_count FROM properties WHERE id='$PID';")" = "18" ] \
  && pass "18 photos are accepted" || fail "18 photos were rejected"

if sql_fails "INSERT INTO property_media (property_id,kind,object_key,bucket,mime_type,size_bytes,position,upload_confirmed)
              VALUES ('$PID','ORIGINAL','acceptance/$PID/$RUN_ID-19.jpg','rivo-media','image/jpeg',420000,18,true);"; then
  pass "19 photos are refused by the database, not only the API"
else
  fail "a 19th photo was accepted"
fi

ENHANCED="$(sql "INSERT INTO property_media (property_id,kind,object_key,bucket,mime_type,size_bytes,position,upload_confirmed,source_media_id)
                 SELECT '$PID','ENHANCED','acceptance/$PID/$RUN_ID-enh.jpg','rivo-media','image/jpeg',430000,0,true,id
                   FROM property_media WHERE property_id='$PID' AND kind='ORIGINAL' ORDER BY position LIMIT 1
                 RETURNING id;")"
if [ -n "$ENHANCED" ] && [ "$(sql "SELECT count(*) FROM property_media WHERE property_id='$PID' AND kind='ORIGINAL';")" = "18" ]; then
  pass "original and enhanced photos are stored as separate rows"
else
  fail "enhanced photo did not keep the original"
fi
if sql_fails "INSERT INTO property_media (property_id,kind,object_key,bucket,mime_type,size_bytes,position,upload_confirmed)
              VALUES ('$PID','ENHANCED','acceptance/$PID/$RUN_ID-orphan.jpg','rivo-media','image/jpeg',430000,1,true);"; then
  pass "an enhanced photo cannot exist without its original"
else
  fail "an orphan ENHANCED row was accepted"
fi

section 'Darcom — Reels'

if sql_fails "INSERT INTO property_videos (property_id,status,stream_uid,width,height,short_edge,duration_seconds)
              VALUES ('$PID','READY','acc-$RUN_ID-720',1280,720,720,24);"; then
  pass "a 720p Reel cannot be published"
else
  fail "a 720p Reel was published"
fi
if sql "INSERT INTO property_videos (property_id,status,stream_uid,width,height,short_edge,duration_seconds)
        VALUES ('$PID','READY','acc-$RUN_ID-1080',1080,1920,1080,24);" >/dev/null 2>&1; then
  pass "a 1080x1920 Reel passes validation (the rule is on the short edge)"
  sql "DELETE FROM property_videos WHERE stream_uid='acc-$RUN_ID-1080';" >/dev/null
else
  fail "a 1080p Reel was rejected"
fi
if sql_fails "INSERT INTO property_videos (property_id,status,stream_uid,width,height,short_edge,duration_seconds)
              VALUES (NULL,'READY','acc-$RUN_ID-orphan',1080,1920,1080,24);"; then
  pass "a Reel must be linked to exactly one property"
else
  fail "a Reel with no property was accepted"
fi

section 'Payments'

PAY="$(curl -s -X POST "$API/payments/listing/create" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' -d "{\"propertyId\":\"$PID\"}")"
PAY_ID="$(printf '%s' "$PAY" | jq -r '.id // empty')"
[ "$(printf '%s' "$PAY" | jq -r .amountIqd)" = "3000" ] \
  && pass "listing fee is exactly 3,000 IQD" || fail "listing fee is $(printf '%s' "$PAY" | jq -r .amountIqd) IQD"

check_code 402 PAYMENT_REQUIRED "an unpaid listing cannot be published" \
  -X POST "$API/admin/properties/$PID/approve" -H "Authorization: Bearer ${STAFF[MODERATOR]}" \
  -H 'Content-Type: application/json' -d '{"note":"محاولة قبل الدفع"}'

check_code 401 PAYMENT_SIGNATURE_INVALID "a webhook with a bad signature cannot settle a payment" \
  -X POST "$API/payments/webhook/${RIVO_PAYMENT_PROVIDER:-manual}" -H 'Content-Type: application/json' \
  -H 'X-Signature: forged' -d "{\"merchantRef\":\"$(printf '%s' "$PAY" | jq -r .merchantRef)\",\"status\":\"PAID\",\"amount\":3000}"
[ "$(sql "SELECT status FROM listing_payments WHERE id='$PAY_ID';")" = "PENDING" ] \
  && pass "the forged webhook left the payment PENDING" || fail "the forged webhook changed payment state"

check 403 "a moderator cannot settle a payment" \
  -X POST "$API/admin/payments/$PAY_ID/settle" -H "Authorization: Bearer ${STAFF[MODERATOR]}" \
  -H 'Content-Type: application/json' -d '{"reference":"X","note":"محاولة غير مصرح بها"}'
check 200 "finance can settle a payment received offline" \
  -X POST "$API/admin/payments/$PAY_ID/settle" -H "Authorization: Bearer ${STAFF[FINANCE]}" \
  -H 'Content-Type: application/json' -d "{\"reference\":\"ACC-$RUN_ID\",\"note\":\"استلام نقدي - اختبار القبول\"}"
[ "$(sql "SELECT status FROM properties WHERE id='$PID';")" = "PENDING_REVIEW" ] \
  && pass "a paid listing enters admin moderation" || fail "a paid listing did not enter moderation"

section 'Moderation and RBAC'

check 403 "support cannot approve a listing"   -X POST "$API/admin/properties/$PID/approve" -H "Authorization: Bearer ${STAFF[SUPPORT]}"  -H 'Content-Type: application/json' -d '{"note":"محاولة من الدعم"}'
check 403 "finance cannot approve a listing"   -X POST "$API/admin/properties/$PID/approve" -H "Authorization: Bearer ${STAFF[FINANCE]}"  -H 'Content-Type: application/json' -d '{"note":"محاولة من المالية"}'
check 401 "an admin route rejects no token"    -X POST "$API/admin/properties/$PID/approve" -H 'Content-Type: application/json' -d '{"note":"بدون هوية"}'

REJECT_REASON="الصور لا تُظهر واجهة العقار. يرجى إضافة صورة للواجهة الأمامية."
check 200 "a moderator can reject with a reason" \
  -X POST "$API/admin/properties/$PID/reject" -H "Authorization: Bearer ${STAFF[MODERATOR]}" \
  -H 'Content-Type: application/json' -d "{\"reason\":\"$REJECT_REASON\"}"
check_code 400 VALIDATION_FAILED "a rejection without a reason is refused" \
  -X POST "$API/admin/properties/$PID/reject" -H "Authorization: Bearer ${STAFF[MODERATOR]}" \
  -H 'Content-Type: application/json' -d '{}'
SEEN="$(curl -s "$API/properties/$PID/edit" "${SELLER_AUTH[@]}" | jq -r '.. | strings' | grep -F "$REJECT_REASON" | head -1)"
[ -n "$SEEN" ] && pass "the rejection reason is visible to the seller" || fail "the seller cannot see why the listing was rejected"

curl -s -X POST "$API/properties/$PID/reopen" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' -d '{}' >/dev/null
curl -s -X POST "$API/properties/$PID/submit" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' -d '{}' >/dev/null
check 200 "a moderator can approve a paid listing" \
  -X POST "$API/admin/properties/$PID/approve" -H "Authorization: Bearer ${STAFF[MODERATOR]}" \
  -H 'Content-Type: application/json' -d '{"note":"مطابق. تم القبول."}'
[ "$(sql "SELECT status FROM properties WHERE id='$PID';")" = "PUBLISHED" ] \
  && pass "admin approval publishes the listing" || fail "approval did not publish the listing"

section 'Search'

curl -s "$API/properties?governorate=BAGHDAD&purpose=SALE" | jq -e --arg id "$PID" '.items | map(.id) | index($id)' >/dev/null \
  && pass "the published listing appears in an anonymous search" || fail "the published listing is not searchable"
curl -s "$API/properties?purpose=RENT" | jq -e --arg id "$PID" '.items | map(.id) | index($id) | not' >/dev/null \
  && pass "the sale/rent filter excludes it from rentals" || fail "a SALE listing appeared under RENT"
curl -s "$API/properties?type=LAND" | jq -e --arg id "$PID" '.items | map(.id) | index($id) | not' >/dev/null \
  && pass "the property-type filter works" || fail "an APARTMENT appeared under LAND"
curl -s "$API/properties?lat=33.3092&lng=44.3462&radiusM=3000&sort=distance" | jq -e --arg id "$PID" '.items | map(.id) | index($id)' >/dev/null \
  && pass "PostGIS radius search finds it within 3 km" || fail "radius search missed the listing"
curl -s "$API/properties?lat=30.5081&lng=47.7835&radiusM=3000" | jq -e --arg id "$PID" '.items | map(.id) | index($id) | not' >/dev/null \
  && pass "radius search excludes it from 400 km away" || fail "radius search matched a distant listing"
curl -s "$API/properties/map?bbox=44.2,33.2,44.5,33.4" | jq -e '.' >/dev/null \
  && pass "map pins endpoint answers for a viewport" || fail "map pins endpoint failed"

section 'Maps and traffic'

if has maps; then
  check 200 "destination search returns locations" "$API/maps/search?q=%D8%A7%D9%84%D9%85%D9%86%D8%B5%D9%88%D8%B1"
  check 200 "a traffic-aware route is calculated" -X POST "$API/maps/route" -H 'Content-Type: application/json' \
    -d '{"from":{"lat":33.3152,"lng":44.3661},"to":{"lat":33.3092,"lng":44.3462},"alternatives":true}'
  jq -e '.routes[0].durationSeconds and .routes[0].distanceMeters' /tmp/rivo-acc-body.json >/dev/null \
    && pass "route ETA and distance are returned" || fail "route response lacks ETA or distance"
  jq -e '.routes | length > 1' /tmp/rivo-acc-body.json >/dev/null \
    && pass "an alternative route is offered" || skip "alternative route" "the provider returned a single route for this pair"
else
  for label in "destination search returns locations" "a traffic-aware route is calculated" \
               "route ETA and distance are returned" "an alternative route is offered"; do
    skip "$label" "set MAPBOX_SECRET_TOKEN"
  done
  check_code 503 INTEGRATION_NOT_CONFIGURED "maps refuse clearly when unconfigured instead of returning stub data" \
    "$API/maps/search?q=test"
fi

INC="$(curl -s -X POST "$API/traffic/incidents" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"type":"ROAD_CLOSURE","lat":33.3140,"lng":44.3600,"note":"الطريق مغلق بسبب أعمال"}')"
INC_ID="$(printf '%s' "$INC" | jq -r '.id // empty')"
nearby()  { curl -s "$API/traffic/incidents?lat=33.3140&lng=44.3600&radiusM=2000"; }
faraway() { curl -s "$API/traffic/incidents?lat=30.5081&lng=47.7835&radiusM=2000"; }

if [ -n "$INC_ID" ]; then
  pass "an incident report is saved with coordinates"
  [ "$(sql "SELECT round(lat::numeric,4)||','||round(lng::numeric,4) FROM road_incidents WHERE id='$INC_ID';")" = "33.3140,44.3600" ] \
    && pass "the incident's coordinates round-trip through PostGIS" || fail "incident coordinates did not round-trip"

  nearby | jq -e --arg id "$INC_ID" '.incidents | map(.id) | index($id) | not' >/dev/null \
    && pass "an unmoderated report is not yet shown to other drivers" || fail "an unmoderated report was published immediately"

  check 200 "a moderator can publish a held report" \
    -X POST "$API/admin/incidents/$INC_ID/approve" -H "Authorization: Bearer ${STAFF[MODERATOR]}" \
    -H 'Content-Type: application/json' -d '{"note":"تم التحقق من البلاغ."}'

  nearby | jq -e --arg id "$INC_ID" '.incidents | map(.id) | index($id)' >/dev/null \
    && pass "the incident appears to a nearby driver after moderation" || fail "a nearby driver cannot see the moderated incident"
  faraway | jq -e --arg id "$INC_ID" '.incidents | map(.id) | index($id) | not' >/dev/null \
    && pass "the incident does not appear 400 km away" || fail "a distant driver was shown the incident"
  nearby | jq -e --arg id "$INC_ID" '.incidents[] | select(.id==$id) | has("reportedBy") | not' >/dev/null \
    && pass "the reporter is not identified to other drivers" || fail "the incident response names its reporter"
else
  fail "an incident report could not be saved: $(printf '%s' "$INC" | jq -c '.error')"
fi

section 'Privacy'

[ -z "$(sql "SELECT string_agg(column_name,',') FROM information_schema.columns WHERE table_name='road_speed_samples' AND column_name LIKE '%user%';")" ] \
  && pass "raw telemetry carries no account identifier" || fail "telemetry rows can be traced to a user"
check 403 "telemetry is refused for an account that has not opted in" \
  -X POST "$API/traffic/telemetry/batch" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' \
  -d "{\"sessionKey\":\"acc-$RUN_ID\",\"consent\":true,\"samples\":[{\"lat\":33.31,\"lng\":44.36,\"speedKph\":40,\"recordedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]}"
[ "$(sql "SELECT count(*) FROM information_schema.columns WHERE table_name='properties' AND column_name='is_demo';")" = "1" ] \
  && pass "demo content is labelled in the schema" || fail "no is_demo marker on properties"

section 'Security'

otp_status=""
for n in 1 2 3 4 5 6 7; do
  otp_status="$(curl -s -o /tmp/rivo-acc-body.json -w '%{http_code}' -X POST "$API/auth/request-otp" \
    -H 'Content-Type: application/json' -d "{\"phone\":\"+96477099990$n\"}")"
  [ "$otp_status" = "429" ] && break
done
[ "$otp_status" = "429" ] \
  && pass "the OTP endpoint is rate-limited" || fail "7 OTP requests in a row were all accepted"

jq -e '.error.messageAr' /tmp/rivo-acc-body.json >/dev/null \
  && pass "the throttled response is bilingual" || fail "the 429 has no Arabic message"

check_code 400 VALIDATION_FAILED "the API returns documented validation errors" \
  -X POST "$API/properties" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"type":"CASTLE","purpose":"SALE","title":"x","priceIqd":"1","areaSqm":1,"governorate":"BAGHDAD","lat":33.3,"lng":44.3}'
jq -e '.error.details.violations | length > 0' /tmp/rivo-acc-body.json >/dev/null \
  && pass "validation errors name the offending fields" || fail "validation errors are not itemised"

check_code 400 VALIDATION_FAILED "uploads validate content type and size" \
  -X POST "$API/uploads/images/presign" "${SELLER_AUTH[@]}" -H 'Content-Type: application/json' \
  -d "{\"propertyId\":\"$PID\",\"files\":[{\"contentType\":\"application/x-msdownload\",\"contentLength\":42}]}"

sql_fails "UPDATE audit_logs SET action='tampered' WHERE id=(SELECT id FROM audit_logs LIMIT 1);" \
  && pass "the audit trail refuses UPDATE" || fail "an audit row was modified"
sql_fails "DELETE FROM audit_logs WHERE id=(SELECT id FROM audit_logs LIMIT 1);" \
  && pass "the audit trail refuses DELETE" || fail "an audit row was deleted"
[ "$(sql "SELECT count(*) FROM audit_logs a JOIN admin_users u ON u.id=a.admin_id WHERE a.entity_id='$PID' AND a.action='property.approve';")" -ge 1 ] \
  && pass "the approval is recorded against a named admin" || fail "the approval was not audited"

section 'Result'
printf '  %d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ]
