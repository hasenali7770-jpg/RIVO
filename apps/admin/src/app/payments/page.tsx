'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, getAdmin, qs } from '@/lib/api';
import { can } from '@/lib/permissions';
import { Shell } from '@/components/shell';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatTile } from '@/components/ui';
import { PAYMENT_STATUS_LABELS, formatDate, formatIqd } from '@/lib/format';

interface PaymentRow {
  id: string;
  amountIqd: number;
  currency: string;
  status: string;
  provider: string;
  merchantRef: string;
  providerRef: string | null;
  failureReason: string | null;
  settledByAdminId: string | null;
  paidAt: string | null;
  createdAt: string;
  property: { reference: string; title: string; status: string };
  user: { id: string; phoneE164: string; displayName: string | null };
}

interface PaymentList {
  items: PaymentRow[];
  summary: { paidCount: number; totalRevenueIqd: number };
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const STATUSES = ['', 'PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'CANCELLED'];

export default function PaymentsPage() {
  const admin = getAdmin();
  const canSettle = can(admin, 'payments.settle');
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [settling, setSettling] = useState<PaymentRow | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['admin-payments', status, page],
    queryFn: () => api.get<PaymentList>(`/admin/payments${qs({ status, page, limit: 25 })}`),
  });

  const settle = useMutation({
    mutationFn: (id: string) => api.post(`/admin/payments/${id}/settle`, { reference, note }),
    onSuccess: () => {
      setSettling(null);
      setReference('');
      setNote('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.display : 'تعذّر تسجيل الدفع.'),
  });

  return (
    <Shell>
      <PageHeader title="المدفوعات" subtitle="رسوم نشر الإعلانات" />

      {data && (
        <div className="grid gap-4 sm:grid-cols-2 mb-6">
          <StatTile label="عمليات دفع ناجحة" value={data.summary.paidCount} tone="text-success" />
          <StatTile label="إجمالي الإيرادات" value={formatIqd(data.summary.totalRevenueIqd)} tone="text-sand" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUSES.map((value) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => { setStatus(value); setPage(1); }}
            className={status === value ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            {value ? PAYMENT_STATUS_LABELS[value]?.ar ?? value : 'الكل'}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {queryError && <ErrorState error={queryError} onRetry={() => refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="لا توجد عمليات دفع." />}

      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الإعلان</th>
                  <th>المبلغ</th>
                  <th>الحالة</th>
                  <th>البوابة</th>
                  <th>المرجع</th>
                  <th>المستخدم</th>
                  <th>التاريخ</th>
                  {canSettle && <th />}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => {
                  const tone = PAYMENT_STATUS_LABELS[row.status] ?? { ar: row.status, tone: '' };
                  return (
                    <tr key={row.id}>
                      <td>
                        <p className="truncate max-w-[20ch]">{row.property.title}</p>
                        <p className="ltr text-xs text-paper/40 font-mono">{row.property.reference}</p>
                      </td>
                      <td className="text-sand whitespace-nowrap">{formatIqd(row.amountIqd)}</td>
                      <td>
                        <Badge tone={tone.tone}>{tone.ar}</Badge>
                        {row.settledByAdminId && (
                          <p className="text-xs text-sand mt-1">سُجّل يدوياً</p>
                        )}
                      </td>
                      <td className="ltr text-xs">{row.provider}</td>
                      <td className="ltr text-xs font-mono text-paper/50">
                        <p>{row.merchantRef}</p>
                        {row.providerRef && <p className="text-paper/30">{row.providerRef}</p>}
                      </td>
                      <td>
                        <p className="truncate max-w-[14ch]">{row.user.displayName ?? '—'}</p>
                        <p className="ltr text-xs text-paper/40">{row.user.phoneE164}</p>
                      </td>
                      <td className="text-xs text-paper/50 whitespace-nowrap">
                        {formatDate(row.paidAt ?? row.createdAt)}
                      </td>
                      {canSettle && (
                        <td>
                          {row.status !== 'PAID' && row.status !== 'REFUNDED' && (
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() => { setSettling(row); setReference(''); setNote(''); setError(null); }}
                            >
                              تسجيل استلام
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      {settling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-lg">
            <h2 className="text-lg font-semibold text-paper">تسجيل استلام دفعة</h2>
            <p className="mt-2 text-sm text-paper/60">
              {settling.property.reference} — {formatIqd(settling.amountIqd)}
            </p>
            <p className="mt-2 text-xs text-sand">
              يُستخدم هذا فقط عند استلام المبلغ نقداً أو بحوالة. سيُسجَّل الإجراء باسمك في سجل التدقيق،
              وسيُرسل الإعلان إلى المراجعة.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="label" htmlFor="ref">رقم الحوالة أو الوصل</label>
                <input id="ref" className="input ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="note">كيف استُلم المبلغ؟</label>
                <textarea id="note" className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-signal">{error}</p>}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="btn-success"
                disabled={settle.isPending || reference.trim().length < 3 || note.trim().length < 10}
                onClick={() => settle.mutate(settling.id)}
              >
                {settle.isPending ? 'جارٍ الحفظ…' : 'تأكيد الاستلام'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setSettling(null)} disabled={settle.isPending}>
                إلغاء
              </button>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
