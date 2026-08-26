/** Display helpers shared across the dashboard. */

/**
 * Iraqi dinar formatting.
 *
 * Amounts arrive as strings because they exceed 2^31; they are parsed here with
 * BigInt and grouped manually rather than being passed through Number, which
 * would lose precision on the largest listings.
 */
export function formatIqd(value: string | number | bigint): string {
  let amount: bigint;
  try {
    amount = typeof value === 'bigint' ? value : BigInt(String(value).replace(/[^\d-]/g, '') || '0');
  } catch {
    return String(value);
  }
  const grouped = amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped} د.ع`;
}

/** Compact form for KPI tiles: 250,000,000 → 250 مليون. */
export function formatIqdCompact(value: string | number | bigint): string {
  let amount: bigint;
  try {
    amount = typeof value === 'bigint' ? value : BigInt(String(value).replace(/[^\d-]/g, '') || '0');
  } catch {
    return String(value);
  }
  if (amount >= 1_000_000_000n) return `${(Number(amount) / 1e9).toFixed(1)} مليار د.ع`;
  if (amount >= 1_000_000n) return `${(Number(amount) / 1e6).toFixed(1)} مليون د.ع`;
  if (amount >= 1_000n) return `${(Number(amount) / 1e3).toFixed(0)} ألف د.ع`;
  return formatIqd(amount);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-IQ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // Everything is displayed in Baghdad time; a moderator reading "submitted
    // at 09:00" should not have to convert from UTC.
    timeZone: 'Asia/Baghdad',
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 1) return 'الآن';
  const rtf = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

export const PROPERTY_STATUS_LABELS: Record<string, { ar: string; tone: string }> = {
  DRAFT: { ar: 'مسودة', tone: 'bg-white/10 text-paper/70' },
  AWAITING_PAYMENT: { ar: 'بانتظار الدفع', tone: 'bg-sand/20 text-sand' },
  PENDING_REVIEW: { ar: 'قيد المراجعة', tone: 'bg-signal-soft text-signal' },
  CHANGES_REQUESTED: { ar: 'مطلوب تعديل', tone: 'bg-sand/20 text-sand' },
  REJECTED: { ar: 'مرفوض', tone: 'bg-signal-soft text-signal' },
  PUBLISHED: { ar: 'منشور', tone: 'bg-success-soft text-success' },
  ARCHIVED: { ar: 'مؤرشف', tone: 'bg-white/10 text-paper/50' },
  SOLD: { ar: 'مُباع', tone: 'bg-white/10 text-paper/50' },
  RENTED: { ar: 'مؤجَّر', tone: 'bg-white/10 text-paper/50' },
};

export const PAYMENT_STATUS_LABELS: Record<string, { ar: string; tone: string }> = {
  PENDING: { ar: 'معلّق', tone: 'bg-white/10 text-paper/70' },
  PROCESSING: { ar: 'قيد المعالجة', tone: 'bg-sand/20 text-sand' },
  PAID: { ar: 'مدفوع', tone: 'bg-success-soft text-success' },
  FAILED: { ar: 'فشل', tone: 'bg-signal-soft text-signal' },
  EXPIRED: { ar: 'منتهي', tone: 'bg-white/10 text-paper/50' },
  REFUNDED: { ar: 'مسترجع', tone: 'bg-sand/20 text-sand' },
  CANCELLED: { ar: 'ملغى', tone: 'bg-white/10 text-paper/50' },
};

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  HOUSE: 'منزل',
  APARTMENT: 'شقة',
  SHOP: 'محل',
  BUILDING: 'بناية',
  LAND: 'أرض',
  COMMERCIAL: 'عقار تجاري',
};

export const PURPOSE_LABELS: Record<string, string> = { SALE: 'للبيع', RENT: 'للإيجار' };

export const SELLER_TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'مالك',
  OFFICE: 'مكتب عقاري',
  DEVELOPER: 'شركة تطوير',
};

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  ACCIDENT: 'حادث',
  TRAFFIC_JAM: 'ازدحام',
  ROAD_CLOSURE: 'إغلاق طريق',
  ROAD_WORKS: 'حفريات',
  FLOODED_ROAD: 'شارع مغمور',
  POTHOLE: 'حفرة',
  HAZARD: 'خطر',
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'مدير عام',
  MODERATOR: 'مشرف',
  FINANCE: 'مالية',
  SUPPORT: 'دعم',
};
