/**
 * RIVO seed script.
 *
 * Creates:
 *  1. The bootstrap Super Admin from ADMIN_BOOTSTRAP_EMAIL / _PASSWORD.
 *  2. Feature flag rows.
 *  3. Optional demo content, ONLY when RIVO_SEED_DEMO=true.
 *
 * Master Plan §5 and §21: demo content must be clearly marked as sample content.
 * Every demo row sets `is_demo = true`, every demo title carries an explicit
 * "[عينة]" prefix, and the script refuses to create demo data when
 * APP_ENV=production. Demo listings have NO photos, so they can never satisfy the
 * 8-photo rule and can never be published — they exist to exercise map, search
 * and routing code paths, not to look like real inventory.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FEATURE_FLAG_DEFAULTS } from '@rivo/config';
import { hashSecret } from '../src/common/crypto/hash';

const prisma = new PrismaClient();

const SEED_DEMO = process.env.RIVO_SEED_DEMO === 'true';
const APP_ENV = process.env.APP_ENV ?? 'development';

async function main(): Promise<void> {
  console.log(`RIVO seed — environment: ${APP_ENV}`);

  await seedFeatureFlags();
  await seedBootstrapAdmin();

  if (SEED_DEMO) {
    if (APP_ENV === 'production') {
      throw new Error(
        'RIVO_SEED_DEMO=true was set with APP_ENV=production. Demo content must never be created in production.',
      );
    }
    await seedDemoContent();
  } else {
    console.log('Skipping demo content (set RIVO_SEED_DEMO=true to create it).');
  }

  console.log('Seed complete.');
}

async function seedFeatureFlags(): Promise<void> {
  const entries = Object.entries(FEATURE_FLAG_DEFAULTS);
  for (const [key, enabled] of entries) {
    await prisma.featureFlag.upsert({ where: { key }, create: { key, enabled }, update: {} });
  }
  console.log(`  ✓ ${entries.length} feature flags`);
}

async function seedBootstrapAdmin(): Promise<void> {
  const existing = await prisma.adminUser.count();
  if (existing > 0) {
    console.log(`  · ${existing} admin account(s) already exist — not creating a bootstrap admin`);
    return;
  }

  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!email || !password) {
    console.warn(
      '  ! ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD are not set — no admin was created and the dashboard cannot be signed into',
    );
    return;
  }
  if (password.length < 12) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters');
  }

  await prisma.adminUser.create({
    data: {
      email: email.toLowerCase().trim(),
      displayName: 'RIVO Super Admin',
      role: 'SUPER_ADMIN',
      passwordHash: await hashSecret(password),
      // Forces a change on first sign-in so the bootstrap value from .env does
      // not remain a valid long-term credential.
      mustChangePassword: true,
    },
  });
  console.log(`  ✓ bootstrap Super Admin ${email} (must change password on first sign-in)`);
}

/** Baghdad neighbourhoods, used to place demo pins somewhere plausible. */
const DEMO_AREAS = [
  { district: 'الكرادة', lat: 33.3018, lng: 44.4372 },
  { district: 'المنصور', lat: 33.3125, lng: 44.3316 },
  { district: 'زيونة', lat: 33.3406, lng: 44.4514 },
  { district: 'الجادرية', lat: 33.2758, lng: 44.3852 },
  { district: 'الأعظمية', lat: 33.3742, lng: 44.3719 },
  { district: 'الدورة', lat: 33.2506, lng: 44.4053 },
];

const DEMO_PROPERTIES: Array<{
  type: 'HOUSE' | 'APARTMENT' | 'SHOP' | 'BUILDING' | 'LAND' | 'COMMERCIAL';
  purpose: 'SALE' | 'RENT';
  title: string;
  priceIqd: bigint;
  areaSqm: number;
  bedrooms: number | null;
  bathrooms: number | null;
}> = [
  { type: 'HOUSE', purpose: 'SALE', title: 'دار للبيع', priceIqd: 250_000_000n, areaSqm: 300, bedrooms: 4, bathrooms: 3 },
  { type: 'APARTMENT', purpose: 'RENT', title: 'شقة للإيجار', priceIqd: 750_000n, areaSqm: 140, bedrooms: 3, bathrooms: 2 },
  { type: 'SHOP', purpose: 'RENT', title: 'محل تجاري للإيجار', priceIqd: 1_500_000n, areaSqm: 45, bedrooms: null, bathrooms: 1 },
  { type: 'LAND', purpose: 'SALE', title: 'قطعة أرض للبيع', priceIqd: 180_000_000n, areaSqm: 400, bedrooms: null, bathrooms: null },
  { type: 'BUILDING', purpose: 'SALE', title: 'بناية للبيع', priceIqd: 900_000_000n, areaSqm: 800, bedrooms: null, bathrooms: 6 },
  { type: 'COMMERCIAL', purpose: 'RENT', title: 'عقار تجاري للإيجار', priceIqd: 3_000_000n, areaSqm: 220, bedrooms: null, bathrooms: 2 },
];

async function seedDemoContent(): Promise<void> {
  console.log('  · creating demo content (all rows flagged is_demo = true)');

  const demoUser = await prisma.user.upsert({
    where: { phoneE164: '+9647000000001' },
    create: {
      phoneE164: '+9647000000001',
      phoneVerified: true,
      displayName: '[عينة] حساب تجريبي — Demo Account',
      sellerType: 'OFFICE',
      locale: 'ar',
    },
    update: {},
  });

  await prisma.sellerProfile.upsert({
    where: { userId: demoUser.id },
    create: {
      userId: demoUser.id,
      sellerType: 'OFFICE',
      officeName: '[عينة] مكتب ريفو التجريبي',
      about: 'Sample seller profile used for local development. Not a real office.',
      // Deliberately NOT verified: a demo account must not display a trust badge
      // it has not earned.
      verification: 'NONE',
    },
    update: {},
  });

  let created = 0;
  for (let i = 0; i < DEMO_PROPERTIES.length; i += 1) {
    const spec = DEMO_PROPERTIES[i];
    const area = DEMO_AREAS[i % DEMO_AREAS.length];
    const reference = `RV-DEMO${String(i + 1).padStart(2, '0')}`;

    const existing = await prisma.property.findUnique({ where: { reference } });
    if (existing) continue;

    const property = await prisma.property.create({
      data: {
        reference,
        ownerId: demoUser.id,
        type: spec.type,
        purpose: spec.purpose,
        // Demo rows stay in DRAFT with zero photos. They cannot be published:
        // the 8-photo rule and the photo-count CHECK constraint both refuse it.
        status: 'DRAFT',
        title: `[عينة] ${spec.title} في ${area.district}`,
        description:
          'محتوى تجريبي لأغراض التطوير فقط — ليس عقاراً حقيقياً. / Sample content for development only — this is not a real property.',
        priceIqd: spec.priceIqd,
        rentPeriod: spec.purpose === 'RENT' ? 'MONTHLY' : null,
        areaSqm: spec.areaSqm,
        bedrooms: spec.bedrooms,
        bathrooms: spec.bathrooms,
        governorate: 'BAGHDAD',
        city: 'بغداد',
        district: area.district,
        contactPhone: demoUser.phoneE164,
        sellerType: 'OFFICE',
        isDemo: true,
      },
    });

    // Small deterministic offset so the pins do not stack on one point.
    const lat = area.lat + (i % 3) * 0.004;
    const lng = area.lng + (i % 4) * 0.004;

    await prisma.$executeRaw`
      INSERT INTO property_locations (property_id, point, lat, lng, display_precision, approx_radius_m, place_label, created_at, updated_at)
      VALUES (
        ${property.id}::uuid,
        ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography,
        ${lat}, ${lng}, 'EXACT', 300, ${`[عينة] ${area.district}، بغداد`}, NOW(), NOW()
      )
      ON CONFLICT (property_id) DO NOTHING
    `;
    created += 1;
  }
  console.log(`  ✓ ${created} demo listings (DRAFT, no photos, is_demo = true)`);

  // Demo road incidents, so the map layer has something to render locally.
  const incidentSpecs: Array<{ type: string; lat: number; lng: number; note: string }> = [
    { type: 'TRAFFIC_JAM', lat: 33.3128, lng: 44.3944, note: '[عينة] ازدحام تجريبي' },
    { type: 'ROAD_WORKS', lat: 33.3235, lng: 44.4108, note: '[عينة] حفريات تجريبية' },
    { type: 'ACCIDENT', lat: 33.2941, lng: 44.4225, note: '[عينة] حادث تجريبي' },
  ];

  const existingDemoIncidents = await prisma.roadIncident.count({ where: { isDemo: true } });
  if (existingDemoIncidents === 0) {
    for (const spec of incidentSpecs) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO road_incidents (id, type, status, point, lat, lng, note, score, confirm_count, dismiss_count, confidence, expires_at, segment_key, is_demo, created_at, updated_at)
         VALUES ($1::uuid, $2::incident_type, 'ACTIVE',
                 ST_SetSRID(ST_MakePoint($3::double precision, $4::double precision), 4326)::geography,
                 $4::double precision, $3::double precision, $5, 1, 0, 0, 0.5, NOW() + INTERVAL '2 hours', $6, TRUE, NOW(), NOW())`,
        randomUUID(),
        spec.type,
        spec.lng,
        spec.lat,
        spec.note,
        `demo:${spec.type}`,
      );
    }
    console.log(`  ✓ ${incidentSpecs.length} demo road incidents (is_demo = true)`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
