/**
 * Iraqi governorates. Launch market is Baghdad (Master Plan §1); the rest are
 * present so the schema and filters do not need changing as RIVO expands
 * (deck p.14 "Scale — توسع محافظات").
 */
export interface Governorate {
  /** Stable machine code stored in the database. */
  code: string;
  nameAr: string;
  nameEn: string;
  /** Approximate centre, used to bias geocoding and default the map camera. */
  center: { lat: number; lng: number };
  /** Governorates enabled for listing creation at launch. */
  launchEnabled: boolean;
}

export const GOVERNORATES: readonly Governorate[] = [
  { code: 'BAGHDAD', nameAr: 'بغداد', nameEn: 'Baghdad', center: { lat: 33.3152, lng: 44.3661 }, launchEnabled: true },
  { code: 'BASRA', nameAr: 'البصرة', nameEn: 'Basra', center: { lat: 30.5085, lng: 47.7804 }, launchEnabled: false },
  { code: 'NINEVEH', nameAr: 'نينوى', nameEn: 'Nineveh', center: { lat: 36.335, lng: 43.1189 }, launchEnabled: false },
  { code: 'ERBIL', nameAr: 'أربيل', nameEn: 'Erbil', center: { lat: 36.1911, lng: 44.0092 }, launchEnabled: false },
  { code: 'SULAYMANIYAH', nameAr: 'السليمانية', nameEn: 'Sulaymaniyah', center: { lat: 35.5613, lng: 45.4375 }, launchEnabled: false },
  { code: 'DUHOK', nameAr: 'دهوك', nameEn: 'Duhok', center: { lat: 36.8669, lng: 42.9883 }, launchEnabled: false },
  { code: 'KIRKUK', nameAr: 'كركوك', nameEn: 'Kirkuk', center: { lat: 35.4681, lng: 44.3922 }, launchEnabled: false },
  { code: 'NAJAF', nameAr: 'النجف', nameEn: 'Najaf', center: { lat: 31.9959, lng: 44.3148 }, launchEnabled: false },
  { code: 'KARBALA', nameAr: 'كربلاء', nameEn: 'Karbala', center: { lat: 32.6149, lng: 44.0242 }, launchEnabled: false },
  { code: 'BABIL', nameAr: 'بابل', nameEn: 'Babil', center: { lat: 32.4686, lng: 44.4197 }, launchEnabled: false },
  { code: 'ANBAR', nameAr: 'الأنبار', nameEn: 'Anbar', center: { lat: 33.4258, lng: 43.3061 }, launchEnabled: false },
  { code: 'DIYALA', nameAr: 'ديالى', nameEn: 'Diyala', center: { lat: 33.7734, lng: 45.1436 }, launchEnabled: false },
  { code: 'WASIT', nameAr: 'واسط', nameEn: 'Wasit', center: { lat: 32.5153, lng: 45.8181 }, launchEnabled: false },
  { code: 'MAYSAN', nameAr: 'ميسان', nameEn: 'Maysan', center: { lat: 31.8356, lng: 47.1439 }, launchEnabled: false },
  { code: 'DHI_QAR', nameAr: 'ذي قار', nameEn: 'Dhi Qar', center: { lat: 31.0519, lng: 46.2597 }, launchEnabled: false },
  { code: 'MUTHANNA', nameAr: 'المثنى', nameEn: 'Muthanna', center: { lat: 31.3324, lng: 45.2797 }, launchEnabled: false },
  { code: 'QADISIYYAH', nameAr: 'القادسية', nameEn: 'Qadisiyyah', center: { lat: 31.9892, lng: 44.9247 }, launchEnabled: false },
  { code: 'SALAH_AL_DIN', nameAr: 'صلاح الدين', nameEn: 'Salah al-Din', center: { lat: 34.6116, lng: 43.6786 }, launchEnabled: false },
];

export const GOVERNORATE_CODES = GOVERNORATES.map((g) => g.code);
export const DEFAULT_GOVERNORATE = 'BAGHDAD';
export const DEFAULT_MAP_CENTER = GOVERNORATES[0].center;

/** Bounding box for Iraq (minLng, minLat, maxLng, maxLat) — used to bias/limit geocoding. */
export const IRAQ_BBOX: [number, number, number, number] = [38.7936, 28.9971, 48.5679, 37.3806];

/**
 * Approximate containment check.
 *
 * This tests a BOUNDING BOX, not the national border, so it is deliberately
 * permissive: a rectangle around Iraq also covers northern Kuwait, slivers of
 * western Iran, and parts of eastern Syria and Jordan. Its job is to reject the
 * obviously-wrong cases cheaply — a device reporting 0,0 with no GPS fix, or a
 * pin left in another country — not to be the authority on where a listing may be.
 *
 * A human moderator reviews every listing's location before it can be published
 * (Master Plan §6 step 10); that review, not this function, is what keeps
 * out-of-country pins off Darcom. If a stricter automated check is ever needed,
 * PostGIS is already available: load an Iraq polygon and use ST_Contains.
 */
export function isWithinIraqBounds(lng: number, lat: number): boolean {
  const [minLng, minLat, maxLng, maxLat] = IRAQ_BBOX;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}
