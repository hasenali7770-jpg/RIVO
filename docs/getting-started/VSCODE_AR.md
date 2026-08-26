# تشغيل RIVO من Visual Studio Code

دليل خطوة بخطوة من الصفر حتى تشوف المنصّة شغّالة على جهازك.

اختر مسارك:

| | متى تختاره | الوقت |
|---|---|---|
| **[المسار الأول: Docker](#المسار-الأول-docker--الأسهل)** | تريد تشوف المنتج بأسرع وقت، وخصوصاً على ويندوز | ~١٥ دقيقة |
| **[المسار الثاني: تشغيل مباشر](#المسار-الثاني-تشغيل-مباشر--للتطوير)** | راح تعدّل على الكود وتحتاج إعادة تحميل فورية وتنقيح | ~٤٥ دقيقة |

---

## قبل أي شي: نزّل المشروع

افتح VS Code ← اضغط **`Ctrl+Shift+P`** (أو `Cmd+Shift+P` على ماك) ← اكتب:

```
Git: Clone
```

الصق الرابط:

```
https://github.com/hasenali7770-jpg/RIVO.git
```

اختر مجلّداً، وبعد ما ينتهي اضغط **Open**.

### بدّل للفرع الصحيح

بأسفل النافذة على اليسار راح تشوف اسم الفرع. اضغط عليه واختر:

```
origin/claude/rivo-maps-realestate-fhipsh
```

> إذا ما ظهر بالقائمة: `Ctrl+Shift+P` ← `Git: Fetch` ← ثم جرّب مرة ثانية.

### ثبّت الإضافات المقترَحة

VS Code راح يعرض إشعار «This workspace has extension recommendations» — اضغط **Install All**.

إذا ما ظهر: `Ctrl+Shift+P` ← `Extensions: Show Recommended Extensions` ← ثبّت الكل.

---

## المسار الأول: Docker — الأسهل

### ١. ثبّت Docker Desktop

نزّله من [docker.com](https://www.docker.com/products/docker-desktop/) وشغّله. انتظر حتى تصير الأيقونة خضراء.

> **على ويندوز** راح يطلب تفعيل WSL2. وافق واتبع التعليمات (يحتاج إعادة تشغيل مرّة واحدة). هذا كل شي — ما راح تحتاج تنصّب PostgreSQL ولا Redis يدوياً.

### ٢. جهّز ملف الإعدادات

بشريط الملفات على اليسار، انسخ `.env.example` وسمّه `.env`:

- اضغط بالزر الأيمن على `.env.example` ← **Copy**
- اضغط بالزر الأيمن على فراغ ← **Paste**
- سمّه `.env`

افتحه وعدّل السطور التالية فقط:

```bash
APP_ENV=development

# مفاتيح Mapbox — بدونها تشتغل داركم كاملة، بس الخريطة تعرض «غير متاحة»
MAPBOX_PUBLIC_TOKEN=pk....
MAPBOX_SECRET_TOKEN=sk....

# كلمة مرور المدير — غيّرها لأي شي تتذكّره، ١٢ حرف على الأقل
ADMIN_BOOTSTRAP_EMAIL=admin@rivo.local
ADMIN_BOOTSTRAP_PASSWORD=RivoDemo-2026-ChangeMe

# محتوى العرض: إعلانات منشورة بصور نموذجية وقائمة مراجعة
RIVO_SEED_DEMO_PUBLISHED=true

# الصور النموذجية تُقدَّم من الـAPI نفسه، بدون حساب Cloudflare
R2_PUBLIC_BASE_URL=http://localhost:3000/demo-media
```

اضغط **`Ctrl+S`**.

### ٣. شغّل

اضغط **`Ctrl+Shift+P`** ← اكتب `Tasks: Run Task` ← اختر:

```
Docker: start the stack
```

أول مرّة تأخذ ٥–١٠ دقائق (يبني الصور). المرّات الجاية أقل من دقيقة.

لمتابعة السجلّات: نفس الطريقة ← **`Docker: follow the logs`**.

### ٤. افتح

| | |
|---|---|
| لوحة الإدارة | <http://localhost:3002> |
| توثيق الـAPI | <http://localhost:3000/api/docs> |
| الإعلانات | <http://localhost:3000/api/v1/properties> |

سجّل الدخول بـ `ADMIN_BOOTSTRAP_EMAIL` وكلمة المرور اللي حطّيتها. راح يطلب منك تغييرها بأول دخول — هذا مقصود.

### للإيقاف

`Ctrl+Shift+P` ← `Tasks: Run Task` ← **`Docker: stop the stack`**

---

## المسار الثاني: تشغيل مباشر — للتطوير

يعطيك إعادة تحميل فورية عند التعديل، وتنقيح بنقاط توقّف داخل VS Code.

### ١. المتطلّبات

| | الإصدار | التنزيل |
|---|---|---|
| Node.js | ٢٢ أو أحدث | [nodejs.org](https://nodejs.org/) |
| PostgreSQL + PostGIS | ١٦ / ٣٫٤ | [postgresql.org](https://www.postgresql.org/download/) — **وأثناء التنصيب علّم PostGIS من Stack Builder** |
| Redis | ٧ | ويندوز: عبر WSL أو [Memurai](https://www.memurai.com/) · ماك: `brew install redis` · لينكس: `apt install redis` |
| Flutter | ٣٫٤٧ | [flutter.dev](https://docs.flutter.dev/get-started/install) — للتطبيق فقط |

> **على ويندوز، الأسهل بكثير**: ثبّت WSL2 مع Ubuntu، وافتح المشروع بـ `Ctrl+Shift+P` ← `WSL: Reopen Folder in WSL`. بعدها كل الأوامر تشتغل مثل لينكس تماماً، وتنصيب Redis يصير `sudo apt install redis`.

### ٢. جهّز المشروع

افتح الطرفية داخل VS Code: **``Ctrl+` ``**

```bash
npm install

createdb rivo
psql rivo -c "CREATE EXTENSION postgis;"
```

انسخ `.env.example` إلى `.env` وعدّله (نفس القيم بالمسار الأول)، مع تعديل رابط قاعدة البيانات ليطابق مستخدمك:

```bash
DATABASE_URL=postgresql://postgres:كلمة_المرور@127.0.0.1:5432/rivo?schema=public
```

### ٣. طبّق الهجرات والبذرة

`Ctrl+Shift+P` ← `Tasks: Run Task` ←

1. **`Database: apply migrations`**
2. **`Database: seed`**

### ٤. شغّل

اضغط **`Ctrl+Shift+D`** (لوحة التشغيل والتنقيح)، اختر من القائمة المنسدلة:

```
Everything (API + worker + admin)
```

واضغط **`F5`**.

هذا يشغّل الثلاثة معاً بإعادة تحميل فورية. عدّل أي ملف واحفظه، والخدمة تعيد تشغيل نفسها.

**لوضع نقطة توقّف:** اضغط على الهامش الأيسر جنب رقم أي سطر بملف `.ts` — تظهر نقطة حمراء. عند وصول التنفيذ لها يتوقّف وتقدر تفحص المتغيّرات.

### أو بأمر واحد للعرض

إذا تريد عرضاً جاهزاً بمحتوى كامل بدل التشغيل اليدوي:

`Ctrl+Shift+P` ← `Tasks: Run Task` ← **`Demo: run the whole thing`**

ينشئ قاعدة بيانات مستقلة، يملأها بـ٦ إعلانات (٤ منشورة و٢ بقائمة المراجعة)، ويشغّل كل شي، ويطبع لك الروابط.

---

## تشغيل التطبيق على الهاتف

### على محاكي أندرويد

شغّل المحاكي من Android Studio، ثم في VS Code:

`Ctrl+Shift+D` ← اختر **`Mobile app (Android emulator)`** ← **`F5`**

### على جهاز حقيقي

وصّل الجهاز بنفس شبكة الواي-فاي، وفعّل **USB debugging** بخيارات المطوّر.

اعرف عنوان جهازك على الشبكة:

```bash
ipconfig        # ويندوز — ابحث عن IPv4 Address
ifconfig        # ماك ولينكس
```

`Ctrl+Shift+D` ← اختر **`Mobile app (physical device on this network)`** ← **`F5`** ← اكتب العنوان لما يطلبه (مثل `192.168.1.10`).

> **قبل أول بناء لأندرويد** لازم مفتاح تنزيل الـSDK من Mapbox. أنشئ ملف `gradle.properties` بمجلّد `~/.gradle/` (على ويندوز: `C:\Users\اسمك\.gradle\`) وضع فيه:
>
> ```properties
> MAPBOX_DOWNLOADS_TOKEN=sk....
> ```
>
> نفس المفتاح السرّي، بشرط أن يحمل صلاحية `Downloads:Read`. التفاصيل بـ [`apps/mobile/MAPBOX_SETUP.md`](../../apps/mobile/MAPBOX_SETUP.md).

---

## مهام جاهزة بالمشروع

كلّها من `Ctrl+Shift+P` ← `Tasks: Run Task`:

| المهمّة | تسوي شنو |
|---|---|
| `Demo: run the whole thing` | عرض كامل بمحتوى نموذجي |
| `Docker: start the stack` | تشغيل كل شي بحاويات |
| `Docker: follow the logs` | متابعة السجلّات |
| `Docker: stop the stack` | إيقاف |
| `Database: apply migrations` | تطبيق الهجرات |
| `Database: seed` | مفاتيح الميزات وحساب المدير |
| `Check: verify Mapbox credentials` | يختبر البحث والمسارات وصلاحية التنزيل |
| `Check: acceptance run (Master Plan §21)` | ٥٥ فحصاً على نظام شغّال |
| `Check: everything` | فحص الأنواع والتدقيق والاختبارات |
| `Mobile: analyze and test` | فحص واختبار تطبيق فلاتر |
| `API: regenerate the OpenAPI reference` | تحديث توثيق الـAPI |

---

## إذا واجهتك مشكلة

| العَرَض | السبب والحل |
|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL مو شغّال. ويندوز: Services ← `postgresql-x64-16` ← Start |
| `ECONNREFUSED 127.0.0.1:6379` | Redis مو شغّال. `redis-server` أو شغّل خدمة Memurai |
| `PostGIS is not installed in this database` | `psql rivo -c "CREATE EXTENSION postgis;"` |
| `Port 3000 is already in use` | خدمة قديمة شغّالة. ويندوز: `netstat -ano \| findstr :3000` ثم `taskkill /PID <الرقم> /F` · ماك ولينكس: `lsof -ti:3000 \| xargs kill` |
| `RIVO cannot start — the environment is invalid` | ناقص متغيّر بـ`.env`. الرسالة تذكر اسمه بالضبط — أضفه وأعد التشغيل |
| الخريطة تعرض «غير متاحة» | مفاتيح Mapbox ناقصة أو غلط. شغّل مهمّة `Check: verify Mapbox credentials` |
| `401` من `api.mapbox.com` عند بناء أندرويد | `MAPBOX_DOWNLOADS_TOKEN` ناقص أو بلا صلاحية `Downloads:Read` |
| صور الإعلانات ما تظهر | تأكّد أن `R2_PUBLIC_BASE_URL=http://localhost:3000/demo-media` موجود بـ`.env` |

**للاطّلاع على الخطأ الحقيقي:** افتح لوحة **Terminal** بأسفل VS Code — كل خطأ يحمل `requestId` تقدر تبحث عنه بالسجلّ.
