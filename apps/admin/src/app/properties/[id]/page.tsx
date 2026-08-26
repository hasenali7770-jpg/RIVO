'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, getAdmin } from '@/lib/api';
import { can } from '@/lib/permissions';
import { Shell } from '@/components/shell';
import { Badge, Card, ConfirmDialog, ErrorState, PageHeader, Spinner } from '@/components/ui';
import {
  PAYMENT_STATUS_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  PURPOSE_LABELS,
  SELLER_TYPE_LABELS,
  formatDate,
  formatIqd,
} from '@/lib/format';

interface ReviewPayload {
  id: string;
  reference: string;
  status: string;
  type: string;
  purpose: string;
  title: string;
  description: string | null;
  priceIqd: string;
  rentPeriod: string | null;
  areaSqm: string;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  governorate: string;
  city: string | null;
  district: string | null;
  addressLine: string | null;
  location: { lat: number; lng: number; publicLat: number | null; publicLng: number | null; precision: string; placeLabel: string | null } | null;
  contact: { preference: string; phone: string | null };
  owner: { id: string; phone: string; displayName: string | null; sellerType: string; verification: string; officeName: string | null };
  photos: Array<{
    id: string;
    kind: string;
    url: string | null;
    width: number | null;
    height: number | null;
    position: number;
    isSelected: boolean;
    uploadConfirmed: boolean;
    qualityScore: number | null;
    qualityNotes: unknown;
    sourceMediaId: string | null;
    enhancement: { status: string; provider: string | null; model: string | null; operations: string[] } | null;
  }>;
  photoCount: number;
  reels: Array<{
    id: string;
    status: string;
    hlsUrl: string | null;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
    shortEdge: number | null;
    durationSeconds: number | null;
    caption: string | null;
    validationError: string | null;
  }>;
  payments: Array<{ id: string; status: string; amountIqd: number; provider: string; merchantRef: string; providerRef: string | null; paidAt: string | null; createdAt: string }>;
  openReports: Array<{ id: string; reason: string; note: string | null; createdAt: string }>;
  history: Array<{ from: string | null; to: string; actorType: string; reason: string | null; at: string }>;
  moderationReason: string | null;
}

type Action = 'approve' | 'reject' | 'request-changes' | 'unpublish' | null;

export default function PropertyReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const admin = getAdmin();
  const canModerate = can(admin, 'properties.moderate');

  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-property', params.id],
    queryFn: () => api.get<ReviewPayload>(`/admin/properties/${params.id}`),
  });

  const mutation = useMutation({
    mutationFn: async (next: Exclude<Action, null>) => {
      const body = next === 'approve' ? { note: reason || undefined } : { reason };
      return api.post(`/admin/properties/${params.id}/${next}`, body);
    },
    onSuccess: () => {
      setAction(null);
      setReason('');
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-property', params.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-properties'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.display : 'تعذّر تنفيذ الإجراء.');
    },
  });

  if (isLoading) return <Shell><Spinner /></Shell>;
  if (error) return <Shell><ErrorState error={error} onRetry={() => refetch()} /></Shell>;
  if (!data) return null;

  const status = PROPERTY_STATUS_LABELS[data.status] ?? { ar: data.status, tone: '' };
  const photosOk = data.photoCount >= 8 && data.photoCount <= 18;
  const isPaid = data.payments.some((p) => p.status === 'PAID');
  const originals = data.photos.filter((p) => p.kind === 'ORIGINAL');

  // Both preconditions are enforced by the API too; showing them here tells the
  // moderator why the button is disabled instead of letting them hit an error.
  const canApprove = canModerate && data.status === 'PENDING_REVIEW' && photosOk && isPaid;

  return (
    <Shell>
      <PageHeader
        title={data.title}
        subtitle={`${PROPERTY_TYPE_LABELS[data.type] ?? data.type} · ${PURPOSE_LABELS[data.purpose] ?? data.purpose}`}
        actions={
          <button type="button" className="btn-ghost" onClick={() => router.back()}>
            رجوع
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Badge tone={status.tone}>{status.ar}</Badge>
        <span className="ltr font-mono text-sm text-paper/50">{data.reference}</span>
        <Badge tone={photosOk ? 'bg-success-soft text-success' : 'bg-signal-soft text-signal'}>
          {data.photoCount} صورة (المطلوب ٨–١٨)
        </Badge>
        <Badge tone={isPaid ? 'bg-success-soft text-success' : 'bg-signal-soft text-signal'}>
          {isPaid ? 'الرسوم مدفوعة' : 'الرسوم غير مدفوعة'}
        </Badge>
        {data.openReports.length > 0 && (
          <Badge tone="bg-signal-soft text-signal">{data.openReports.length} بلاغ مفتوح</Badge>
        )}
      </div>

      {canModerate && (
        <Card className="mb-6">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-success"
              disabled={!canApprove || mutation.isPending}
              onClick={() => { setReason(''); setActionError(null); setAction('approve'); }}
            >
              الموافقة والنشر
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={data.status !== 'PENDING_REVIEW' || mutation.isPending}
              onClick={() => { setReason(''); setActionError(null); setAction('request-changes'); }}
            >
              طلب تعديل
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={data.status !== 'PENDING_REVIEW' || mutation.isPending}
              onClick={() => { setReason(''); setActionError(null); setAction('reject'); }}
            >
              رفض
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={data.status !== 'PUBLISHED' || mutation.isPending}
              onClick={() => { setReason(''); setActionError(null); setAction('unpublish'); }}
            >
              سحب من النشر
            </button>
          </div>

          {!canApprove && data.status === 'PENDING_REVIEW' && (
            <p className="mt-3 text-sm text-signal">
              {!isPaid && 'لا يمكن النشر قبل تأكيد دفع الرسوم. '}
              {!photosOk && `عدد الصور ${data.photoCount} خارج النطاق المسموح (٨–١٨).`}
            </p>
          )}
          {actionError && <p className="mt-3 text-sm text-signal">{actionError}</p>}
        </Card>
      )}

      {data.moderationReason && (
        <Card className="mb-6 border-sand/30">
          <p className="text-xs text-paper/50 mb-1">ملاحظة المراجعة الحالية (تظهر للمالك)</p>
          <p className="text-paper">{data.moderationReason}</p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h2 className="text-sm font-medium text-paper/50 mb-4">الصور ({originals.length})</h2>
            {originals.length === 0 ? (
              <p className="text-sm text-paper/40">لا توجد صور.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {originals.map((photo) => {
                  const enhanced = data.photos.find((p) => p.sourceMediaId === photo.id);
                  return (
                    <figure key={photo.id} className="space-y-1">
                      {photo.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photo.url}
                          alt={`صورة ${photo.position + 1}`}
                          className="w-full aspect-[4/3] object-cover rounded-lg bg-petrol-800"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full aspect-[4/3] rounded-lg bg-petrol-800 flex items-center justify-center text-xs text-paper/30">
                          لم تُرفع
                        </div>
                      )}
                      <figcaption className="text-xs text-paper/40 space-y-0.5">
                        <span className="ltr block">
                          {photo.width ?? '?'}×{photo.height ?? '?'}
                        </span>
                        {/* Both versions are kept; which one publishes is the
                            seller's choice, and the moderator sees which. */}
                        {enhanced && (
                          <span className="block text-success">
                            {enhanced.isSelected ? 'النسخة المحسّنة منشورة' : 'النسخة الأصلية منشورة'}
                          </span>
                        )}
                        {photo.enhancement && photo.enhancement.status !== 'SUCCEEDED' && (
                          <span className="block text-sand">تحسين: {photo.enhancement.status}</span>
                        )}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            )}
          </Card>

          {data.reels.length > 0 && (
            <Card>
              <h2 className="text-sm font-medium text-paper/50 mb-4">الريلز</h2>
              <div className="space-y-4">
                {data.reels.map((reel) => (
                  <div key={reel.id} className="flex gap-4">
                    {reel.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={reel.thumbnailUrl} alt="" className="w-24 aspect-[9/16] object-cover rounded-lg bg-petrol-800" loading="lazy" />
                    ) : (
                      <div className="w-24 aspect-[9/16] rounded-lg bg-petrol-800" />
                    )}
                    <div className="text-sm space-y-1 min-w-0">
                      <Badge tone={reel.status === 'READY' ? 'bg-success-soft text-success' : 'bg-signal-soft text-signal'}>
                        {reel.status}
                      </Badge>
                      <p className="ltr text-xs text-paper/50">
                        {reel.width ?? '?'}×{reel.height ?? '?'} · أقصر ضلع {reel.shortEdge ?? '?'}px ·{' '}
                        {reel.durationSeconds ? `${Math.round(reel.durationSeconds)}s` : '—'}
                      </p>
                      {reel.caption && <p className="text-paper/70">{reel.caption}</p>}
                      {reel.validationError && <p className="text-signal text-xs">{reel.validationError}</p>}
                      {reel.hlsUrl && (
                        <a href={reel.hlsUrl} target="_blank" rel="noreferrer" className="btn-ghost text-xs px-0">
                          فتح الفيديو
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <h2 className="text-sm font-medium text-paper/50 mb-4">الوصف</h2>
            <p className="text-paper whitespace-pre-wrap">{data.description ?? '—'}</p>
          </Card>

          {data.openReports.length > 0 && (
            <Card className="border-signal/30">
              <h2 className="text-sm font-medium text-signal mb-4">بلاغات المستخدمين</h2>
              <ul className="space-y-3">
                {data.openReports.map((report) => (
                  <li key={report.id} className="text-sm">
                    <p className="text-paper">{report.reason}</p>
                    {report.note && <p className="text-paper/60">{report.note}</p>}
                    <p className="text-xs text-paper/40">{formatDate(report.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="text-sm font-medium text-paper/50 mb-4">التفاصيل</h2>
            <dl className="space-y-2 text-sm">
              <Row label="السعر" value={<span className="text-sand">{formatIqd(data.priceIqd)}</span>} />
              {data.rentPeriod && <Row label="دورية الإيجار" value={data.rentPeriod === 'MONTHLY' ? 'شهري' : 'سنوي'} />}
              <Row label="المساحة" value={`${data.areaSqm} م²`} />
              {data.bedrooms !== null && <Row label="غرف النوم" value={String(data.bedrooms)} />}
              {data.bathrooms !== null && <Row label="الحمامات" value={String(data.bathrooms)} />}
              {data.floors !== null && <Row label="الطوابق" value={String(data.floors)} />}
              <Row label="المحافظة" value={data.governorate} />
              <Row label="المنطقة" value={data.district ?? '—'} />
              {data.addressLine && <Row label="العنوان" value={data.addressLine} />}
            </dl>
          </Card>

          <Card>
            <h2 className="text-sm font-medium text-paper/50 mb-4">الموقع</h2>
            {data.location ? (
              <div className="space-y-2 text-sm">
                <p className="ltr font-mono text-xs text-paper/60">
                  {data.location.lat.toFixed(6)}, {data.location.lng.toFixed(6)}
                </p>
                {data.location.precision === 'APPROXIMATE' && (
                  <p className="text-xs text-sand">
                    يعرض للجمهور موقعاً تقريبياً. الإحداثيات أعلاه هي الموقع الفعلي للمراجعة فقط.
                  </p>
                )}
                {data.location.placeLabel && <p className="text-paper/70">{data.location.placeLabel}</p>}
                <a
                  className="btn-secondary text-xs"
                  href={`https://www.openstreetmap.org/?mlat=${data.location.lat}&mlon=${data.location.lng}#map=17/${data.location.lat}/${data.location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  فتح على الخريطة
                </a>
              </div>
            ) : (
              <p className="text-sm text-signal">لا يوجد موقع محدد.</p>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-medium text-paper/50 mb-4">المالك</h2>
            <dl className="space-y-2 text-sm">
              <Row label="الاسم" value={data.owner.displayName ?? '—'} />
              <Row label="الهاتف" value={<span className="ltr">{data.owner.phone}</span>} />
              <Row label="النوع" value={SELLER_TYPE_LABELS[data.owner.sellerType] ?? data.owner.sellerType} />
              {data.owner.officeName && <Row label="المكتب" value={data.owner.officeName} />}
              <Row
                label="التوثيق"
                value={
                  data.owner.verification === 'VERIFIED' ? (
                    <Badge tone="bg-success-soft text-success">موثّق</Badge>
                  ) : (
                    <span className="text-paper/50">{data.owner.verification}</span>
                  )
                }
              />
              <Row label="هاتف التواصل بالإعلان" value={<span className="ltr">{data.contact.phone ?? '—'}</span>} />
            </dl>
          </Card>

          <Card>
            <h2 className="text-sm font-medium text-paper/50 mb-4">المدفوعات</h2>
            {data.payments.length === 0 ? (
              <p className="text-sm text-paper/40">لا توجد عمليات دفع.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {data.payments.map((payment) => {
                  const tone = PAYMENT_STATUS_LABELS[payment.status] ?? { ar: payment.status, tone: '' };
                  return (
                    <li key={payment.id} className="border-b border-white/5 pb-2 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sand">{formatIqd(payment.amountIqd)}</span>
                        <Badge tone={tone.tone}>{tone.ar}</Badge>
                      </div>
                      <p className="ltr text-xs text-paper/40 font-mono mt-1">{payment.merchantRef}</p>
                      <p className="text-xs text-paper/40">{formatDate(payment.paidAt ?? payment.createdAt)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-medium text-paper/50 mb-4">سجل الحالة</h2>
            <ol className="space-y-3 text-sm">
              {data.history.map((entry, index) => (
                <li key={index} className="border-r-2 border-white/10 pr-3">
                  <p className="text-paper">
                    {(PROPERTY_STATUS_LABELS[entry.to]?.ar ?? entry.to)}
                    {entry.from && <span className="text-paper/40"> ← {PROPERTY_STATUS_LABELS[entry.from]?.ar ?? entry.from}</span>}
                  </p>
                  <p className="text-xs text-paper/40">
                    {entry.actorType} · {formatDate(entry.at)}
                  </p>
                  {entry.reason && <p className="text-xs text-paper/60 mt-1">{entry.reason}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={action !== null}
        title={
          action === 'approve' ? 'نشر الإعلان؟'
          : action === 'reject' ? 'رفض الإعلان؟'
          : action === 'request-changes' ? 'طلب تعديل؟'
          : 'سحب الإعلان من النشر؟'
        }
        description={
          action === 'approve'
            ? 'سيصبح الإعلان مرئياً في داركم فوراً.'
            : 'سيظهر النص التالي للمالك كما هو، فاكتبه بوضوح.'
        }
        confirmLabel={action === 'approve' ? 'نشر' : 'تأكيد'}
        destructive={action !== 'approve'}
        requireReason={action !== 'approve'}
        reason={reason}
        onReasonChange={setReason}
        pending={mutation.isPending}
        onCancel={() => { setAction(null); setActionError(null); }}
        onConfirm={() => action && mutation.mutate(action)}
      />
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-paper/50 shrink-0">{label}</dt>
      <dd className="text-paper text-left">{value}</dd>
    </div>
  );
}
