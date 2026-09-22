# 🚀 راه‌اندازی حرفه‌ای Rosie Atelier

سند عملیاتی (runbook) همین نسخهٔ در حال اجرا. هر چیزی که برای «کار کردن سایت در
حالت پروداکشن»، «تحویل به تیم» و «انتشار روی دامنهٔ واقعی» لازم است اینجاست.

---

## ۱. وضعیت فعلی راه‌اندازی

| مورد | وضعیت |
| --- | --- |
| نصب وابستگی‌ها | ✅ `npm ci` (۳۴۰ پکیج) |
| Type-check + Lint | ✅ `npm run check` → **۰ خطا** (۴۸ هشدار سبک کدنویسی) |
| Build پروداکشن | ✅ `npm run build` → `✓ Compiled successfully` |
| سرور | ✅ `next start -H 0.0.0.0 -p 3000` (حالت production، نه dev) |
| سلامت سرویس | ✅ `/api/health` → `"ok": true` · `admin.configured: true` |
| ذخیره‌سازی محتوا | ✅ backend = `file` → `data/content.json` (نوشتن آزمایش و تأیید شد) |
| Smoke test | ✅ `npm run smoke` → **۳۶ از ۳۶** سبز |
| کرال کامل نقشهٔ سایت | ✅ ۷۷ آدرس از `sitemap.xml` → همه `200` |
| اطلاعات ورود ادمین | ✅ ساخته و در `.env.local` ذخیره شد (فایل git-ignored با دسترسی `600`) |

آدرس پیش‌نمایش زنده (پروکسی‌شدهٔ همین سرور):

```
https://3000-i9dxol328ai32nis9b8nf.e2b.app
```

> **نکته:** این دامنه فقط برای پیش‌نمایش است. برای انتشار واقعی حتماً
> `NEXT_PUBLIC_SITE_URL` را روی دامنهٔ خودتان بگذارید (بخش ۴).

---

## ۲. آدرس‌های مهم

| کاربرد | آدرس |
| --- | --- |
| سایت فارسی (RTL) | `/fa` |
| سایت انگلیسی (LTR) | `/en` |
| مسیر ریشه | `/` → ریدایرکت خودکار به `/fa` (یا زبان کوکی کاربر) |
| **ورود ادمین** | `/admin/fa/login` (یا `/admin/en/login`) |
| **پنل مدیریت** | `/admin/fa` |
| میان‌بر پنل | `/fa/admin` → ریدایرکت به `/admin/fa` |
| داشبورد هنرمند | `/fa/artist` (نیاز به نقش `artist` یا `admin`) |
| پنل مالک (راضیه خیری‌پور) | `/fa/owner` (نقش `admin` یا `OWNER_EMAIL`) |
| سلامت سرویس (uptime probe) | `/api/health` |
| نقشهٔ سایت / robots | `/sitemap.xml` · `/robots.txt` |
| فروشگاه · الگوها · گالری | `/fa/shop` · `/fa/patterns` · `/fa/portfolio` |
| آکادمی · کالکشن‌ها · سبک‌ها | `/fa/academy` · `/fa/collections` · `/fa/styles` |

---

## ۳. اطلاعات ورود و رمزها

همهٔ رمزها **فقط** در `.env.local` (کنار `package.json`) قرار دارند؛ این فایل در
`.gitignore` هست و هرگز کامیت نمی‌شود.

```
ADMIN_EMAIL     = admin@rosie-atelier.local
ADMIN_PASSWORD  = (به‌صورت تصادفی تولید شد — در .env.local بخوانید)
AUTH_SECRET     = (کلید ۳۲ بایتی HMAC امضای کوکی نشست)
OWNER_EMAIL     = owner@rosie-atelier.local   ← جای ایمیل واقعی مالک بگذارید
```

**تغییر رمز ادمین:** مقدار `ADMIN_PASSWORD` را در `.env.local` عوض کنید و سرور را
ری‌استارت کنید — نیازی به build دوباره نیست.

**محافظت‌های فعال:** کوکی نشست `HttpOnly` + `SameSite=Lax` + امضای HMAC، محدودیت
تلاش ورود بر اساس IP+ایمیل (`src/lib/rate-limit.ts`)، پاسخ‌های `no-store` برای
`/api/auth/*` و `/api/admin/*`، و گارد middleware روی `/admin/*`، `/fa/artist` و
`/fa/owner`.

---

## ۴. راه‌اندازی مجدد / روزمره

```bash
# اجرای پروداکشن (build در صورت نبود، ساخت .env.local در صورت نبود)
npm run launch

# فقط سرو کردن build موجود
npm run start:prod            # = next start -H 0.0.0.0
PORT=8080 npm run start:prod  # پورت دیگر

# تست دود پس از هر تغییر (سلامت، روتینگ، ورود ادمین)
npm run smoke
BASE_URL=https://your-domain.com npm run smoke

# کیفیت کد
npm run check        # typecheck + lint
npm run build        # build کامل پروداکشن
```

اجرای دائمی روی VPS با systemd (نمونه):

```ini
# /etc/systemd/system/rosie-atelier.service
[Unit]
Description=Rosie Atelier (Next.js)
After=network.target

[Service]
WorkingDirectory=/srv/rosie-atelier
EnvironmentFile=/srv/rosie-atelier/.env.local
Environment=NODE_ENV=production PORT=3000 HOST=127.0.0.1
ExecStart=/usr/bin/npm run start:prod
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

سپس `systemctl enable --now rosie-atelier` و جلوی آن Nginx/Caddy با HTTPS قرار دهید
(فقط مسیر `/api/webinar/*/signal` باید WebSocket/long-poll را عبور دهد).

---

## ۵. متغیرهای محیطی برای انتشار واقعی

| متغیر | لازم؟ | توضیح |
| --- | --- | --- |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` | ✅ | حساب ادمین؛ بدون آن‌ها در production ورود ادمین ممکن نیست |
| `AUTH_SECRET` | ✅ | کلید امضای کوکی (`openssl rand -hex 32`) |
| `NEXT_PUBLIC_SITE_URL` | ✅ | دامنهٔ نهایی بدون `/` پایانی — منبع `sitemap.xml`، `robots.txt`، canonical و OG. **در زمان build خوانده می‌شود**؛ بعد از تغییر، دوباره build کنید |
| `OWNER_EMAIL` | توصیه‌شده | ایمیل مالک برای دسترسی به `/fa/owner` |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | روی سرورلس ✅ | ذخیرهٔ پایدار محتوا؛ روی Netlify الزامی است (فایل‌سیستم فقط‌خواندنی) |
| `CLOUDINARY_*` یا `BLOB_READ_WRITE_TOKEN` | توصیه‌شده | آپلود تصویر/ویدئوی ادمین؛ در نبودشان آپلود در `public/images/uploads/` ذخیره می‌شود (فقط dev/VPS) |

### Netlify / Vercel
1. مخزن را import کنید — `netlify.toml` و `vercel.json` همه‌چیز را تنظیم کرده‌اند.
2. متغیرهای بالا را در Environment Variables اضافه کنید و **دوباره deploy** کنید
   (تغییر env به‌تنهایی rebuild نمی‌کند).
3. `/api/health` را باز کنید؛ باید `"persistent": true` (با Redis) و
   `"configured": true` ببینید.

### VPS / Docker
`npm ci && npm run build && npm start` روی Node 20+، دایرکتوری `data/` را روی
volume پایدار نگه دارید (یا Redis بدهید) و آپلودها را به Cloudinary بسپارید.

---

## ۶. چک‌لیست قبل از انتشار عمومی

- [ ] `NEXT_PUBLIC_SITE_URL` = دامنهٔ واقعی + build دوباره
- [ ] رمز ادمین پیش‌فرض را عوض کرده‌اید و `.env.local` از مخزن بیرون است
- [ ] `OWNER_EMAIL` روی ایمیل واقعی مالک تنظیم شده
- [ ] Redis (Upstash) وصل است → محتوا بین نسخه‌ها گم نمی‌شود
- [ ] Cloudinary برای آپلودهای واقعی وصل است
- [ ] HTTPS فعال و در پروکسی `Strict-Transport-Security` ست شده
- [ ] پشتیبان‌گیری: `data/content.json` یا snapshot از کلید Redis
- [ ] `npm run smoke` روی دامنهٔ نهایی سبز است
- [ ] Uptime-monitor روی `/api/health`
- [ ] ایمیل خبرنامه/تماس به سرویس واقعی ارسال وصل شده (فعلاً در store ذخیره می‌شود)

---

## ۷. عیب‌یابی

| نشانه | علت / راه‌حل |
| --- | --- |
| `502 storage_write_failed` هنگام ذخیرهٔ ادمین | فایل‌سیستم فقط‌خواندنی است (Netlify/Vercel). `UPSTASH_REDIS_REST_*` را ست کنید |
| ورود ادمین `admin_not_configured` | `ADMIN_EMAIL`/`ADMIN_PASSWORD` ست نشده یا سرور بدون آن‌ها بالا آمده |
| بعد از ورود، فوراً به صفحهٔ لاگین برمی‌گردد | کوکی `ra-session` مسدود شده (مثلاً `Secure` روی HTTP) یا ساعت سیستم/`AUTH_SECRET` بین نمونه‌ها یکی نیست |
| `/fa/admin` قبلاً ۴۰۴ می‌داد | ✅ رفع شد: middleware حالا با ۳۰۷ به `/admin/fa` می‌فرستد |
| سایت با `/` باز نمی‌شود و ۴۰۴ می‌دهد | مسیر ریشه در middleware بر اساس کوکی `ra-locale` ریدایرکت می‌شود؛ کوکی را پاک کنید |
| عدم نمایش تصاویر در دامنهٔ جدید | `images.deviceSizes` در `next.config.ts` و دامنه‌های `next/image` را بررسی کنید |
| تغییر env بی‌اثر است | `NEXT_PUBLIC_*` در زمان build ثابت می‌شود → rebuild لازم است |

---

## ۸. آنچه در این راه‌اندازی به مخزن اضافه/اصلاح شد

1. `src/middleware.ts` + `src/app/[locale]/admin/page.tsx` — میان‌بر پنل ادمین:
   لینک‌های «پنل مدیریت» در هدر/فوتر/حساب کاربری به `/fa/admin` می‌رفتند و **۴۰۴**
   می‌گرفتند؛ الآن با ریدایرکت واقعی ۳۰۷ به `/admin/fa` می‌رسند (گارد نقش admin
   دست‌نخورده است).
2. `next.config.ts` — `poweredByHeader: false` و هدرهای امنیتی پایه
   (`X-Content-Type-Options`, `Referrer-Policy`, `X-DNS-Prefetch-Control`).
   عمداً `X-Frame-Options`/`frame-ancestors` ست نشده تا پیش‌نمایش‌های داخل iframe و
   وبینارها کار کنند.
3. `scripts/start-prod.sh` — لانچر idempotent پروداکشن: ساخت `.env.local` با رمز
   تصادفی در صورت نبود، نصب وابستگی‌ها، build در صورت نیاز، سرو روی `0.0.0.0`.
4. `scripts/smoke.sh` — تست دود پیش از انتشار (سلامت، روتینگ دو زبان، حفاظت از
   API ادمین، و round-trip کامل ورود ادمین).
5. `package.json` — اسکریپت‌های `launch`, `start:prod`, `smoke`.
