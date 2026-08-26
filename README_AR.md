# RIVO | ريفو — خرائط | داركم

منصّة عراقية واحدة تجمع الملاحة الذكية وسوق العقارات.

- **خرائط** — مسارات تراعي حالة الزحام، ومسارات بديلة، وملاحة خطوة بخطوة،
  وبلاغات من المستخدمين عن الحوادث والزحام والطرق المغلقة والأعمال الإنشائية
  والطرق المغمورة بالمياه.
- **داركم** — بيوت وشقق ومحال وعمارات وأراضٍ وعقارات تجارية، للبيع أو للإيجار،
  محدّدة على الخريطة، مع ٨ إلى ١٨ صورة، وريل اختياري بدقة ١٠٨٠p على الأقل،
  ورسوم نشر مقدارها ٣٬٠٠٠ دينار عراقي، ومراجعة إدارية قبل ظهور أي إعلان.

اللغة العربية هي لغة المنتج الأساسية، وكل الواجهات مبنية من اليمين إلى اليسار.

**English:** [README_EN.md](./README_EN.md)

---

## محتويات المستودع

```
apps/
  api/         NestJS 11 + Prisma 6 — الـAPI والعامل الخلفي والهجرات والاختبارات
  admin/       Next.js 15 — لوحة الإدارة (١٣ وحدة، مقيّدة بالصلاحيات)
  mobile/      Flutter 3.47 — تطبيق أندرويد و iOS
packages/
  config/      قواعد العمل والثوابت المشتركة (مصدر واحد للحقيقة)
  contracts/   مخططات zod مشتركة بين الـAPI ولوحة الإدارة
infra/
  docker/      ملفات Dockerfile للـapi والعامل ولوحة الإدارة
  nginx/       إعدادات الوكيل العكسي
  scripts/     backup.sh و restore.sh و acceptance.sh
docs/          التوثيق الكامل، انظر الجدول في آخر الصفحة
```

---

## المتطلبات

| | الإصدار | السبب |
| --- | --- | --- |
| Node.js | ٢٢ أو أحدث | الـAPI ولوحة الإدارة |
| PostgreSQL | ١٦ | |
| PostGIS | ٣٫٤ | كل استعلامات الخرائط تعتمد عليه |
| Redis | ٧ | الطوابير وعدّادات رمز التحقق والتخزين المؤقت |
| Flutter | ٣٫٤٧ | تطبيق الهاتف |
| Docker | ٢٤ أو أحدث | اختياري، لتشغيل المنظومة بأمر واحد |

---

## أول مرّة — أمر واحد

```bash
./infra/scripts/setup.sh
```

يفحص الأدوات، ينشئ `.env` بمفاتيح مولّدة، يجهّز قاعدة البيانات، يطبّق الهجرات،
يملأ محتوى العرض، ويشغّل كل شي. آمن للتكرار.

## وين وصلت؟

```bash
./infra/scripts/status.sh
```

تقرير عن الأدوات والإعدادات وقاعدة البيانات والخدمات: شنو جاهز، شنو ناقص، وأي
أمر يصلّحه. بلا مفاتيح ولا كلمات مرور، فآمن للنسخ والإرسال.

## التشغيل من Visual Studio Code

دليل خطوة بخطوة من نسخ المشروع حتى تشغيل التطبيق، بمسارين — Docker أو تشغيل
مباشر — لويندوز وماك ولينكس:
**[دليل التشغيل من VS Code](./docs/getting-started/VSCODE_AR.md)**

المشروع يحمل إعدادات تشغيل ومهام جاهزة، فأغلب الخطوات تصير من
`Ctrl+Shift+P` ← `Tasks: Run Task`.

## للعرض التقديمي — أمر واحد

```bash
./infra/scripts/demo.sh
```

ينشئ قاعدة بيانات خاصة به، ويملأها بإعلانات منشورة مع صور نموذجية وقائمة
مراجعة، ويشغّل الـAPI ولوحة الإدارة. لا يحتاج أي حساب Cloudflare أو دفع أو
رسائل. ولتظهر الخريطة الحيّة، احصل على مفتاح Mapbox المجاني أولاً وصدّر
`MAPBOX_PUBLIC_TOKEN` و `MAPBOX_SECRET_TOKEN` — خمس دقائق، بلا كلفة، وهو
الحساب الذي تحتاجه على أي حال.

## التشغيل عبر Docker

```bash
cp .env.example .env          # ثم املأ القيم — انظر قسم «بيانات الاعتماد»
npm run stack:up
npm run stack:logs
```

يشغّل هذا الأمر PostgreSQL+PostGIS و Redis والـAPI والعامل الخلفي ولوحة الإدارة،
وتُطبَّق الهجرات تلقائياً عند إقلاع الـAPI.

## التشغيل المباشر

```bash
cp .env.example .env
npm install

# ١. قاعدة البيانات
createdb rivo
psql rivo -c 'CREATE EXTENSION postgis;'
npm run api:migrate
npm run api:seed              # مفاتيح الميزات وحساب المدير الأول

# ٢. الـAPI والعامل الخلفي
set -a && . .env && set +a
npm run api:dev               # http://localhost:3000 والتوثيق على /api/docs
npm run worker:dev -w @rivo/api

# ٣. لوحة الإدارة
npm run admin:dev             # http://localhost:3002

# ٤. تطبيق الهاتف
cd apps/mobile
flutter pub get
flutter run --dart-define=RIVO_API_BASE_URL=http://10.0.2.2:3000/api/v1
```

كلمة مرور حساب المدير الأول هي `ADMIN_BOOTSTRAP_PASSWORD` من ملف `.env`،
ويجب تغييرها عند أول تسجيل دخول.

---

## الفحوصات

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e -w @rivo/api   # على قاعدة بيانات و Redis حقيقيين
cd apps/mobile && flutter analyze && flutter test

./infra/scripts/acceptance.sh   # قائمة اختبارات القبول (§٢١) على نظام يعمل فعلاً
```

اختبارات `test:e2e` تحذف كل الصفوف، ولذلك ترفض العمل على أي قاعدة بيانات
لا يدل اسمها على أنها قاعدة اختبار. أنشئ `rivo_test` أولاً:

```bash
createdb rivo_test && psql rivo_test -c 'CREATE EXTENSION postgis;'
DATABASE_URL='postgresql://postgres@127.0.0.1:5432/rivo_test?schema=public' \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

---

## بيانات الاعتماد

ملف `.env.example` يشرح ٧١ متغيّراً. لا يوجد أي مفتاح وهمي في المشروع: أي ميزة
ينقصها مفتاحها تُرجِع `503 INTEGRATION_NOT_CONFIGURED` وتذكر اسم المتغيّر
المطلوب بالضبط، والـAPI **يرفض الإقلاع** في بيئة الإنتاج بدون المفاتيح الإلزامية.

يجب فتح كل الحسابات باسم ريفو نفسها لا باسم أي مقاول أو مطوّر — القائمة الكاملة
مع الأسعار في
[docs/purchase-checklist/ACCOUNTS_AND_PURCHASES.md](./docs/purchase-checklist/ACCOUNTS_AND_PURCHASES.md).

| الميزة | المتغيّرات |
| --- | --- |
| الخريطة والبحث والمسارات | `MAPBOX_PUBLIC_TOKEN`, `MAPBOX_SECRET_TOKEN` |
| تخزين الصور | `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| الريلز | `CLOUDFLARE_STREAM_TOKEN` |
| تحسين الصور بالذكاء الاصطناعي | `AI_PROVIDER` ومفتاحه |
| رسائل رمز التحقق | `OTP_PROVIDER=http` وبيانات المزوّد |
| الدفع | `PAYMENT_PROVIDER` ومفتاحه و `PAYMENT_WEBHOOK_SECRET` |
| تقارير الأعطال | `SENTRY_DSN_API`, `SENTRY_DSN_MOBILE` |

---

## القواعد التي يفرضها الخادم

هذه ليست اقتراحات يمكن تجاوزها، بل مفروضة في الـAPI ومكرَّرة كقيود في قاعدة
البيانات، فلا يستطيع أي مسار — ولا حتى أمر SQL مباشر — الالتفاف عليها.

| القاعدة | موضع التنفيذ |
| --- | --- |
| من ٨ إلى ١٨ صورة قبل نشر أي إعلان | `properties_photo_count_chk` |
| الريل بدقة ١٠٨٠p على الأقل في **الضلع الأقصر** | `property_videos_min_1080p_chk` |
| رسوم النشر ٣٬٠٠٠ دينار بالضبط، يحدّدها الخادم لا العميل | `LISTING_FEE_IQD` |
| لا يُعتبر الدفع مكتملاً إلا بـwebhook موقّع أو تسوية مالية موثّقة | آلة حالات الدفع |
| لا يُنشر إعلان إلا بموافقة إدارية من حالة `PENDING_REVIEW` | آلة حالات الإعلان |
| سجل التدقيق يُضاف إليه فقط ولا يُعدَّل ولا يُحذف | `rivo_audit_logs_immutable()` |
| بيانات الموقع الخام بلا أي معرّف حساب، وتُحذف بعد ١٤ يوماً | المخطط + مهمة التنظيف |
| لا يُحتسب متوسط سرعة لمقطع طريق إلا من ٥ جلسات مختلفة على الأقل | `TELEMETRY_MIN_SAMPLES_PER_BUCKET` |

---

## التوثيق

| | |
| --- | --- |
| **[وثيقة التسليم](./HANDOVER.md)** | **أوامر التشغيل والبناء والنشر، والمخطط، والواجهات، والمشتريات المتبقية، وخارطة الطريق** |
| [المعمارية](./docs/architecture/ARCHITECTURE.md) | كيف تترابط الأجزاء ولماذا |
| [مرجع الـAPI](./docs/api/ENDPOINTS.md) | ١٠٣ عملية، مع `openapi.json` |
| [النشر](./docs/deployment/DEPLOYMENT.md) | إعداد الخادم وشهادات TLS وأول نشر |
| [النسخ الاحتياطي والاسترجاع](./docs/deployment/BACKUP_RESTORE.md) | نسخة يومية واسترجاع مُجرَّب |
| [تقرير القبول](./docs/acceptance-tests/ACCEPTANCE_REPORT.md) | ما جرى التحقق منه فعلياً |
| [الحسابات والمشتريات](./docs/purchase-checklist/ACCOUNTS_AND_PURCHASES.md) | ما يجب شراؤه وباسم من |
| [المسودات القانونية](./docs/legal/) | الخصوصية والشروط وسياسات النشر والذكاء الاصطناعي والمجتمع — للمراجعة القانونية |
| [قائمة النشر في المتاجر](./docs/store-release/STORE_CHECKLIST.md) | متطلبات آبل وغوغل |
| [التدقيق الأولي](./docs/architecture/AUDIT.md) | ما كان موجوداً عند البدء |
