#!/usr/bin/env bash
#
# تهيئة RIVO من الصفر — أمر واحد.
#
#   ./infra/scripts/setup.sh
#
# يفحص الأدوات، ينشئ .env بمفاتيح مولّدة، يجهّز قاعدة البيانات، ينصّب الحزم،
# يطبّق الهجرات، يملأ محتوى العرض، ثم يشغّل كل شي.
#
# آمن للتكرار: لا يستبدل .env موجوداً بدون سؤالك، ولا يحذف قاعدة بيانات.
#
# RIVO first-run bootstrap. Checks prerequisites, writes a .env with generated
# secrets, prepares the database, installs, migrates, seeds and starts.
# Re-runnable: never replaces an existing .env without asking, never drops a
# database.

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
no()   { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m•\033[0m %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }
step() { printf '\n\033[1m▪ %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$1"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
# Reads a line from the terminal. When there is no terminal — a CI run, a task
# with no console — the redirect itself errors before 2>/dev/null can apply, so
# check first and fall back to the default.
ask() {
  local __var="$1" __default="${2:-}"
  # /dev/tty can exist and be readable and still fail to open with ENXIO when
  # the process has no controlling terminal, so attempt the open rather than
  # testing the file.
  if ( : </dev/tty ) 2>/dev/null; then
    local __in; read -r __in </dev/tty || __in="$__default"
    printf -v "$__var" '%s' "${__in:-$__default}"
  else
    printf -v "$__var" '%s' "$__default"
    printf '(لا توجد طرفية تفاعلية — استُخدمت القيمة الافتراضية)\n'
  fi
}

printf '\n\033[1m════ تهيئة RIVO ════\033[0m\n'
printf '  هذا الأمر يجهّز كل شي ويشغّله. أول مرّة تأخذ ٥–١٥ دقيقة.\n'

# ── ١. الأدوات ──────────────────────────────────────────────────────────────
step 'فحص الأدوات'

MISSING=0
if have node; then
  NV="$(node -v)"; MAJ="${NV#v}"; MAJ="${MAJ%%.*}"
  if [ "$MAJ" -ge 22 ]; then ok "Node.js $NV"
  else no "Node.js $NV — المطلوب 22 أو أحدث: https://nodejs.org/"; MISSING=1; fi
else
  no 'Node.js غير مثبّت — نزّله من https://nodejs.org/ ثم أعد تشغيل هذا الأمر'
  MISSING=1
fi
[ "$MISSING" = "1" ] && die 'أكمل التنصيب أعلاه أولاً.'

USE_DOCKER=0
if have docker && docker info >/dev/null 2>&1; then
  USE_DOCKER=1
  ok 'Docker شغّال — راح نستخدمه لقاعدة البيانات و Redis'
elif have psql && have redis-cli; then
  ok 'PostgreSQL و Redis مثبّتان محلياً'
else
  no 'لا يوجد Docker شغّال، ولا PostgreSQL+Redis محليّان'
  info ''
  info 'الأسهل: ثبّت Docker Desktop وشغّله، ثم أعد هذا الأمر'
  info '        https://www.docker.com/products/docker-desktop/'
  info ''
  info 'أو ثبّت الاثنين محلياً:'
  info '        PostgreSQL 16 + PostGIS — https://www.postgresql.org/download/'
  info '        Redis 7 — عبر WSL على ويندوز، أو brew install redis على ماك'
  die 'أكمل التنصيب أعلاه أولاً.'
fi

# ── ٢. ملف الإعدادات ────────────────────────────────────────────────────────
step 'ملف الإعدادات (.env)'

secret() {
  if have openssl; then openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-50
  else node -e "console.log(require('crypto').randomBytes(48).toString('base64url').slice(0,50))"; fi
}

WRITE_ENV=1
if [ -f .env ]; then
  warn 'ملف .env موجود مسبقاً'
  printf '    هل تريد استبداله بواحد جديد؟ سيُحفظ القديم باسم .env.backup  [y/N] '
  ask ans n
  case "$ans" in
    [yY]*) cp .env .env.backup; ok 'حُفظ القديم في .env.backup' ;;
    *) WRITE_ENV=0; ok 'أبقينا .env كما هو' ;;
  esac
fi

if [ "$WRITE_ENV" = "1" ]; then
  printf '\n    مفاتيح Mapbox — بدونها كل شي يشتغل ما عدا الخريطة والمسارات.\n'
  printf '    اتركهما فارغين واضغط Enter إذا ما عندك مفاتيح الآن.\n\n'
  printf '    المفتاح العام  (pk...): '
  ask MB_PUB ""
  printf '    المفتاح السرّي (sk...): '
  ask MB_SEC ""

  ADMIN_PASS="Rivo-$(secret | cut -c1-12)-2026"

  if [ "$USE_DOCKER" = "1" ]; then
    DB="postgresql://rivo:rivo_local_dev@postgres:5432/rivo?schema=public"
    RD="redis://redis:6379"
  else
    DB="postgresql://${PGUSER:-postgres}@127.0.0.1:5432/rivo?schema=public"
    RD="redis://127.0.0.1:6379"
  fi

  cp .env.example .env
  set_env() {
    # يستبدل السطر كاملاً إن وُجد، وإلا يضيفه بالنهاية.
    local key="$1" val="$2"
    if grep -qE "^${key}=" .env; then
      python3 - "$key" "$val" <<'PY'
import sys, pathlib, re
key, val = sys.argv[1], sys.argv[2]
p = pathlib.Path('.env'); lines = p.read_text().splitlines()
out = [f'{key}={val}' if re.match(rf'^{re.escape(key)}=', l) else l for l in lines]
p.write_text('\n'.join(out) + '\n')
PY
    else
      printf '%s=%s\n' "$key" "$val" >> .env
    fi
  }

  set_env APP_ENV development
  set_env DATABASE_URL "$DB"
  set_env REDIS_URL "$RD"
  set_env JWT_ACCESS_SECRET "$(secret)"
  set_env JWT_REFRESH_SECRET "$(secret)"
  set_env ADMIN_BOOTSTRAP_EMAIL 'admin@rivo.local'
  set_env ADMIN_BOOTSTRAP_PASSWORD "$ADMIN_PASS"
  set_env OTP_PROVIDER console
  set_env PAYMENT_PROVIDER manual
  set_env AI_PROVIDER none
  set_env RIVO_SEED_DEMO_PUBLISHED true
  set_env R2_PUBLIC_BASE_URL 'http://localhost:3000/demo-media'
  set_env API_BASE_URL 'http://localhost:3000'
  set_env ADMIN_URL 'http://localhost:3002'
  set_env NEXT_PUBLIC_API_BASE_URL 'http://localhost:3000'
  [ -n "$MB_PUB" ] && set_env MAPBOX_PUBLIC_TOKEN "$MB_PUB"
  [ -n "$MB_SEC" ] && set_env MAPBOX_SECRET_TOKEN "$MB_SEC"
  [ -n "$MB_PUB" ] && set_env NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN "$MB_PUB"

  ok 'أُنشئ .env بمفاتيح مولّدة عشوائياً'
  [ -n "$MB_SEC" ] && ok 'مفاتيح Mapbox مضبوطة — الخريطة والمسارات راح تشتغل' \
                   || warn 'بلا مفاتيح Mapbox — الخريطة راح تعرض «غير متاحة»'
  printf '\n    \033[1mكلمة مرور لوحة الإدارة:\033[0m %s\n' "$ADMIN_PASS"
  printf '    (محفوظة بـ .env — راح يطلب تغييرها بأول دخول)\n'
fi

# ── تحميل الإعدادات ─────────────────────────────────────────────────────────
# لازم قبل أي أمر يقرأ متغيّرات البيئة. Prisma تحمّل .env لنفسها، لكن البذرة
# والـAPI يقرآن process.env، فبدون هذا السطر يقلعان بلا إعدادات.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# ── ٣. الحزم ────────────────────────────────────────────────────────────────
step 'تنصيب الحزم'
if [ -d node_modules ]; then ok 'منصّبة مسبقاً'
else
  npm install --no-audit --no-fund 2>&1 | tail -3
  [ -d node_modules ] && ok 'تم' || die 'فشل npm install — راجع الخطأ أعلاه'
fi

# ── ٤. التشغيل ──────────────────────────────────────────────────────────────
if [ "$USE_DOCKER" = "1" ]; then
  step 'تشغيل المنظومة بـ Docker'
  info 'أول مرّة تبني الصور — قد تأخذ ١٠ دقائق. اصبر.'
  docker compose up -d --build || die 'فشل docker compose — راجع الخطأ أعلاه'
  ok 'الحاويات شغّالة'
  info 'الهجرات والبذرة تنفّذ تلقائياً قبل إقلاع الـAPI'

  printf '\n    ننتظر الـAPI'
  for _ in $(seq 1 60); do
    curl -sf http://localhost:3000/api/v1/health >/dev/null 2>&1 && break
    printf '.'; sleep 3
  done
  printf '\n'
  curl -sf http://localhost:3000/api/v1/health >/dev/null 2>&1 \
    && ok 'الـAPI يستجيب' \
    || { warn 'الـAPI ما استجاب بعد'; info 'شوف السجلّ: docker compose logs api'; }
else
  step 'تجهيز قاعدة البيانات'
  DBURL_RAW="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
  DBURL="${DBURL_RAW%%\?*}"
  DBNAME="${DBURL##*/}"
  SRV="${DBURL%/*}"

  pg_isready -h 127.0.0.1 >/dev/null 2>&1 || die 'PostgreSQL متوقف. ويندوز: Services ← postgresql-x64-16 ← Start'
  if psql "$SRV/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname='$DBNAME'" 2>/dev/null | grep -q 1; then
    ok "قاعدة البيانات $DBNAME موجودة"
  else
    if psql "$SRV/postgres" -qc "CREATE DATABASE \"$DBNAME\";" >/dev/null 2>&1; then
      ok "أُنشئت قاعدة البيانات $DBNAME"
    else
      no "تعذّر إنشاء $DBNAME"
      info "جرّب يدوياً وشوف الرسالة:"
      info "  psql \"$SRV/postgres\" -c 'CREATE DATABASE $DBNAME;'"
      die 'غالباً اسم المستخدم أو كلمة المرور بـ DATABASE_URL غير صحيحة.'
    fi
  fi
  psql "$DBURL" -qc 'CREATE EXTENSION IF NOT EXISTS postgis;' >/dev/null 2>&1 \
    && ok 'إضافة PostGIS جاهزة' \
    || die 'تعذّر تثبيت PostGIS — تأكّد من تثبيتها مع PostgreSQL عبر Stack Builder'

  redis-cli ping >/dev/null 2>&1 || { redis-server --daemonize yes >/dev/null 2>&1; sleep 2; }
  redis-cli ping >/dev/null 2>&1 && ok 'Redis شغّال' || die 'Redis متوقف — شغّل: redis-server'

  step 'الهجرات والمحتوى'
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma >/dev/null 2>&1 \
    && ok 'الهجرات مطبَّقة' || die 'فشلت الهجرات — شغّل: npm run api:migrate وشوف الرسالة'
  npm run build -w @rivo/config >/dev/null 2>&1
  npm run build -w @rivo/contracts >/dev/null 2>&1
  npm run build -w @rivo/api >/dev/null 2>&1 || die 'فشل بناء الـAPI'
  ok 'الـAPI مبني'
  if npm run seed -w @rivo/api > /tmp/rivo-seed.log 2>&1; then
    grep -E '✓|·' /tmp/rivo-seed.log | sed 's/^/  /'
  else
    no 'فشلت البذرة'
    tail -20 /tmp/rivo-seed.log | sed 's/^/    /'
    die 'راجع الخطأ أعلاه.'
  fi

  step 'تشغيل الخدمات'
  node apps/api/dist/main.js > /tmp/rivo-api.log 2>&1 &
  API_PID=$!
  for _ in $(seq 1 30); do
    curl -sf http://localhost:3000/api/v1/health >/dev/null 2>&1 && break
    sleep 2
  done
  curl -sf http://localhost:3000/api/v1/health >/dev/null 2>&1 \
    && ok 'الـAPI شغّال على المنفذ 3000' \
    || { cat /tmp/rivo-api.log; die 'الـAPI ما اشتغل — السجلّ أعلاه'; }

  npm run dev -w @rivo/admin > /tmp/rivo-admin.log 2>&1 &
  ADMIN_PID=$!
  for _ in $(seq 1 60); do
    curl -sf http://localhost:3002 >/dev/null 2>&1 && break
    sleep 2
  done
  curl -sf http://localhost:3002 >/dev/null 2>&1 \
    && ok 'لوحة الإدارة شغّالة على المنفذ 3002' \
    || warn 'لوحة الإدارة ما استجابت بعد — السجلّ: /tmp/rivo-admin.log'

  cleanup() {
    printf '\n\033[1mإيقاف الخدمات…\033[0m\n'
    kill "$API_PID" "$ADMIN_PID" 2>/dev/null || true
    wait "$API_PID" "$ADMIN_PID" 2>/dev/null || true
    printf 'تم الإيقاف. قاعدة البيانات وملف .env باقيان كما هما.\n'
  }
  trap cleanup EXIT INT TERM
  KEEP_RUNNING=1
fi

# ── ٥. الخلاصة ───────────────────────────────────────────────────────────────
STOP_HINT="$( [ "${KEEP_RUNNING:-0}" = "1" ] && echo 'Ctrl-C' || echo 'docker compose down' )"
ADMIN_EMAIL="$(grep -E '^ADMIN_BOOTSTRAP_EMAIL=' .env | cut -d= -f2-)"
ADMIN_PW="$(grep -E '^ADMIN_BOOTSTRAP_PASSWORD=' .env | cut -d= -f2-)"

cat <<INFO

$(printf '\033[1m═══ RIVO جاهز ═══\033[0m')

  لوحة الإدارة    http://localhost:3002
  توثيق الـAPI     http://localhost:3000/api/docs
  الإعلانات        http://localhost:3000/api/v1/properties

  الدخول          ${ADMIN_EMAIL}
                  ${ADMIN_PW}

  للتحقّق من الحالة بأي وقت:  ./infra/scripts/status.sh
  للإيقاف:                     ${STOP_HINT}

INFO

# المسار المحلي يبقى بالمقدّمة حتى يوقف الخدمات عند Ctrl-C.
[ "${KEEP_RUNNING:-0}" = "1" ] && { printf '  اضغط Ctrl-C للإيقاف.\n\n'; wait; }
