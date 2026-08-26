#!/usr/bin/env bash
#
# تقرير حالة RIVO — يقول لك بالضبط وين وصلت وشنو الناقص.
#
#   ./infra/scripts/status.sh
#
# اطبع الناتج وانسخه كما هو. لا يطبع أي مفتاح ولا كلمة مرور — يقول فقط
# هل هي مضبوطة أم لا، وأي نوع، حتى تقدر تشاركه بأمان.
#
# RIVO status report. Prints what is installed, configured and running, and
# what is still missing. Never prints a secret value — only whether it is set
# and what kind it is — so the output is safe to paste anywhere.

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

READY=0; MISSING=0
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; READY=$((READY + 1)); }
no()    { printf '  \033[31m✗\033[0m %s\n' "$1"; MISSING=$((MISSING + 1)); }
warn()  { printf '  \033[33m•\033[0m %s\n' "$1"; }
info()  { printf '    %s\n' "$1"; }
head2() { printf '\n\033[1m▪ %s\033[0m\n' "$1"; }

printf '\n\033[1m════ RIVO — تقرير الحالة ════\033[0m\n'
printf '  %s\n' "$(date -u '+%Y-%m-%d %H:%M UTC')"
printf '  %s\n' "$(pwd)"

# ── المستودع ────────────────────────────────────────────────────────────────
head2 'المستودع  ·  repository'
if git rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH="$(git branch --show-current 2>/dev/null || echo '؟')"
  ok "الفرع: $BRANCH"
  [ "$BRANCH" = "claude/rivo-maps-realestate-fhipsh" ] \
    || warn "الفرع المتوقّع: claude/rivo-maps-realestate-fhipsh"
  info "آخر تعديل: $(git log --oneline -1 2>/dev/null | cut -c1-72)"
  CHANGED="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  [ "$CHANGED" = "0" ] && info 'لا توجد تعديلات غير محفوظة' \
                       || warn "$CHANGED ملف معدّل ولم يُحفظ بـ git"
  BEHIND="$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)"
  [ "${BEHIND:-0}" != "0" ] && warn "متأخّر $BEHIND تعديلاً عن الخادم — شغّل: git pull"
else
  no 'هذا ليس مستودع git — استخدم Git: Clone بدل تنزيل ملف مضغوط'
fi

# ── الأدوات ────────────────────────────────────────────────────────────────
head2 'الأدوات المطلوبة  ·  tools'
v() { command -v "$1" >/dev/null 2>&1; }

if v node; then
  NV="$(node -v)"; MAJ="${NV#v}"; MAJ="${MAJ%%.*}"
  [ "$MAJ" -ge 22 ] && ok "Node.js $NV" || no "Node.js $NV — المطلوب 22 أو أحدث"
else no 'Node.js غير مثبّت — nodejs.org'; fi

v npm && ok "npm $(npm -v)" || no 'npm غير موجود'

if v psql; then ok "PostgreSQL client $(psql --version | grep -oE '[0-9]+\.[0-9]+' | head -1)"
else no 'psql غير مثبّت — مطلوب للتشغيل المباشر، وغير مطلوب مع Docker'; fi

v redis-cli && ok 'Redis client موجود' \
             || no 'redis-cli غير مثبّت — مطلوب للتشغيل المباشر، وغير مطلوب مع Docker'

if v flutter; then ok "Flutter $(flutter --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
else warn 'Flutter غير مثبّت — مطلوب فقط لتشغيل تطبيق الهاتف'; fi

if v docker; then
  if docker info >/dev/null 2>&1; then ok 'Docker شغّال'
  else warn 'Docker مثبّت لكن الخدمة متوقفة — افتح Docker Desktop وانتظر الأيقونة الخضراء'; fi
else warn 'Docker غير مثبّت — مطلوب فقط للمسار الأول'; fi

v jq && ok 'jq موجود' || warn 'jq غير مثبّت — تحتاجه سكربتات الفحص'

[ -d node_modules ] && ok 'الحزم منصّبة (node_modules)' \
                    || no 'الحزم غير منصّبة — شغّل: npm install'

# ── الإعدادات ──────────────────────────────────────────────────────────────
head2 'ملف الإعدادات  ·  .env'
if [ ! -f .env ]; then
  no 'ملف .env غير موجود — انسخ .env.example وسمّه .env'
else
  ok 'ملف .env موجود'
  val() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }
  # يطبع الحالة فقط، ولا يطبع القيمة أبداً.
  need() {
    local v; v="$(val "$1")"
    if [ -n "$v" ]; then ok "$1 مضبوط${3:+  ($3)}"; else
      if [ "${2:-}" = "req" ]; then no "$1 فارغ — $4"; else warn "$1 فارغ — $4"; fi
    fi
  }
  need DATABASE_URL req '' 'بدونه ما تشتغل أي قاعدة بيانات'
  need REDIS_URL req '' 'بدونه ما تشتغل الطوابير'
  need JWT_ACCESS_SECRET req '' 'بدونه يرفض الـAPI الإقلاع'
  need JWT_REFRESH_SECRET req '' 'بدونه يرفض الـAPI الإقلاع'
  need ADMIN_BOOTSTRAP_EMAIL req '' 'ما راح تكدر تدخل لوحة الإدارة'
  need ADMIN_BOOTSTRAP_PASSWORD req '' 'ما راح تكدر تدخل لوحة الإدارة'

  MPUB="$(val MAPBOX_PUBLIC_TOKEN)"; MSEC="$(val MAPBOX_SECRET_TOKEN)"
  case "$MPUB" in
    pk.*) ok 'MAPBOX_PUBLIC_TOKEN مضبوط  (pk.)' ;;
    '')   warn 'MAPBOX_PUBLIC_TOKEN فارغ — الخريطة راح تعرض «غير متاحة»' ;;
    *)    no 'MAPBOX_PUBLIC_TOKEN لا يبدأ بـ pk. — هذا ليس مفتاحاً عاماً' ;;
  esac
  case "$MSEC" in
    sk.*) ok 'MAPBOX_SECRET_TOKEN مضبوط  (sk.)' ;;
    '')   warn 'MAPBOX_SECRET_TOKEN فارغ — البحث والمسارات معطّلة' ;;
    *)    no 'MAPBOX_SECRET_TOKEN لا يبدأ بـ sk. — مفتاح عام هنا يُسرَّب للتطبيق' ;;
  esac

  [ -n "$(val R2_ACCESS_KEY_ID)" ] && ok 'Cloudflare R2 مضبوط — رفع الصور الحقيقي يشتغل' \
    || warn 'Cloudflare R2 غير مضبوط — رفع الصور معطّل (الصور النموذجية تشتغل)'
  [ -n "$(val CLOUDFLARE_STREAM_TOKEN)" ] && ok 'Cloudflare Stream مضبوط — الريلز تشتغل' \
    || warn 'Cloudflare Stream غير مضبوط — الريلز مخفية'
  [ "$(val OTP_PROVIDER)" = 'console' ] \
    && warn 'OTP_PROVIDER=console — رمز الدخول يُطبع بالسجلّ بدل رسالة SMS (للتطوير فقط)' \
    || ok "OTP_PROVIDER=$(val OTP_PROVIDER)"
  [ "$(val PAYMENT_PROVIDER)" = 'manual' ] \
    && warn 'PAYMENT_PROVIDER=manual — الرسوم تُسوّى يدوياً من لوحة الإدارة' \
    || ok "PAYMENT_PROVIDER=$(val PAYMENT_PROVIDER)"
  [ "$(val RIVO_SEED_DEMO_PUBLISHED)" = 'true' ] && ok 'محتوى العرض مفعّل (إعلانات منشورة بصور نموذجية)'
  info "APP_ENV=$(val APP_ENV)"
fi

# ── قاعدة البيانات ─────────────────────────────────────────────────────────
head2 'قاعدة البيانات  ·  database'
libpq_url() {
  local url="${1:-}" base query kept="" pair
  [ -n "$url" ] || return 1
  base="${url%%\?*}"; query="${url#*\?}"
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

DB_URL=""
[ -f .env ] && DB_URL="$(libpq_url "$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')" 2>/dev/null)"

if ! v psql; then
  warn 'لا يمكن الفحص بدون psql — إذا تستخدم Docker شغّل: docker compose ps'
elif [ -z "$DB_URL" ]; then
  no 'DATABASE_URL غير موجود بـ .env'
elif ! psql "$DB_URL" -tAc 'SELECT 1' >/dev/null 2>&1; then
  no 'تعذّر الاتصال بقاعدة البيانات'
  info 'PostgreSQL متوقف، أو الاسم/كلمة المرور بـ DATABASE_URL غير صحيحة'
  info 'ويندوز: Services ← postgresql-x64-16 ← Start'
else
  ok 'الاتصال بقاعدة البيانات ناجح'
  psql "$DB_URL" -tAc "SELECT 1 FROM pg_extension WHERE extname='postgis'" 2>/dev/null | grep -q 1 \
    && ok 'إضافة PostGIS مثبّتة' \
    || no 'PostGIS غير مثبّتة — شغّل: psql "<DATABASE_URL>" -c "CREATE EXTENSION postgis;"'

  T="$(psql "$DB_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\\_prisma%' AND tablename<>'spatial_ref_sys'" 2>/dev/null || echo 0)"
  if [ "${T:-0}" -ge 30 ]; then ok "الهجرات مطبَّقة — $T جدولاً"
  elif [ "${T:-0}" -gt 0 ]; then no "$T جدولاً فقط — الهجرات ناقصة. شغّل مهمّة: Database: apply migrations"
  else no 'لا توجد جداول — شغّل مهمّة: Database: apply migrations'; fi

  if [ "${T:-0}" -gt 0 ]; then
    A="$(psql "$DB_URL" -tAc 'SELECT count(*) FROM admin_users' 2>/dev/null || echo 0)"
    [ "${A:-0}" -gt 0 ] && ok "$A حساب إدارة" \
                        || no 'لا يوجد حساب إدارة — شغّل مهمّة: Database: seed'
    P="$(psql "$DB_URL" -tAc "SELECT count(*) FROM properties WHERE status='PUBLISHED'" 2>/dev/null || echo 0)"
    R="$(psql "$DB_URL" -tAc "SELECT count(*) FROM properties WHERE status='PENDING_REVIEW'" 2>/dev/null || echo 0)"
    info "الإعلانات: $P منشور · $R بانتظار المراجعة"
    [ "${P:-0}" = "0" ] && [ "${R:-0}" = "0" ] \
      && warn 'لا توجد إعلانات — للعرض حطّ RIVO_SEED_DEMO_PUBLISHED=true وأعد البذرة'
  fi
fi

# ── الخدمات ────────────────────────────────────────────────────────────────
head2 'الخدمات الشغّالة  ·  running'
if v redis-cli && redis-cli ping >/dev/null 2>&1; then ok 'Redis شغّال'
elif v redis-cli; then no 'Redis متوقف — شغّل: redis-server'
else warn 'redis-cli غير موجود، لا يمكن الفحص'; fi

if curl -sf --max-time 4 http://localhost:3000/api/v1/health >/dev/null 2>&1; then
  ok 'الـAPI شغّال على المنفذ 3000'
  CAPS="$(curl -s --max-time 4 http://localhost:3000/api/v1/health/capabilities 2>/dev/null)"
  cap() { printf '%s' "$CAPS" | grep -o "\"$1\":[a-z]*" | cut -d: -f2; }
  info "الخريطة: $( [ "$(cap maps)" = true ] && echo 'مفعّلة' || echo 'غير مفعّلة' )  ·  رفع الصور: $( [ "$(cap photoUploads)" = true ] && echo 'مفعّل' || echo 'غير مفعّل' )  ·  الريلز: $( [ "$(cap reels)" = true ] && echo 'مفعّلة' || echo 'غير مفعّلة' )"
else
  warn 'الـAPI غير شغّال — F5 من لوحة التشغيل، أو مهمّة: Docker: start the stack'
fi

curl -sf --max-time 4 http://localhost:3002 >/dev/null 2>&1 \
  && ok 'لوحة الإدارة شغّالة على المنفذ 3002' \
  || warn 'لوحة الإدارة غير شغّالة'

# ── الخلاصة ────────────────────────────────────────────────────────────────
head2 'الخلاصة  ·  summary'
printf '  %d جاهز  ·  %d ناقص\n\n' "$READY" "$MISSING"
if [ "$MISSING" -eq 0 ]; then
  printf '  \033[32mكل الأساسيات جاهزة.\033[0m\n'
else
  printf '  \033[31mعالج السطور المعلّمة ✗ أعلاه بالترتيب، ثم أعد تشغيل هذا الأمر.\033[0m\n'
fi
printf '\n  انسخ كل ما فوق وأرسله كما هو — ما بيه أي مفتاح ولا كلمة مرور.\n\n'
