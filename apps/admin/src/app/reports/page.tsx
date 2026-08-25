'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, getAdmin, qs } from '@/lib/api';
import { can } from '@/lib/permissions';
import { Shell } from '@/components/shell';
import { Badge, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';
import { formatDate } from '@/lib/format';

interface ReportRow {
  id: string;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string;
  resolutionNote: string | null;
  property: { id: string; reference: string; title: string; status: string };
  reporter: { id: string; phoneE164: string } | null;
}

interface ReportList {
  items: ReportRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const REASON_LABELS: Record<string, string> = {
  FAKE_LISTING: 'إعلان وهمي',
  WRONG_PRICE: 'سعر مضلل',
  SOLD_ALREADY: 'مُباع مسبقاً',
  WRONG_LOCATION: 'موقع خاطئ',
  OFFENSIVE: 'محتوى مسيء',
  DUPLICATE: 'مكرر',
  OTHER: 'أخرى',
};

export default function ReportsPage() {
  const admin = getAdmin();
  const canResolve = can(admin, 'reports.resolve');
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<{ row: ReportRow; verdict: 'ACTIONED' | 'DISMISSED' } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['admin-reports', status, page],
    queryFn: () => api.get<ReportList>(`/admin/reports${qs({ status, page, limit: 25 })}`),
  });

  const resolve = useMutation({
    mutationFn: () => api.post(`/admin/reports/${target!.row.id}/resolve`, { status: target!.verdict, note }),
    onSuccess: () => {
      setTarget(null); setNote(''); setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.display : 'تعذّر إغلاق البلاغ.'),
  });

  return (
    <Shell>
      <PageHeader title="بلاغات المستخدمين" subtitle="بلاغات عن إعلانات وهمية أو مضللة" />

      <div className="flex flex-wrap gap-2 mb-4">
        {['OPEN', 'ACTIONED', 'DISMISSED', ''].map((value) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => { setStatus(value); setPage(1); }}
            className={status === value ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            {value === 'OPEN' ? 'مفتوحة' : value === 'ACTIONED' ? 'تم اتخاذ إجراء' : value === 'DISMISSED' ? 'مرفوضة' : 'الكل'}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {queryError && <ErrorState error={queryError} onRetry={() => refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="لا توجد بلاغات في هذه الحالة." />}

      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>السبب</th>
                  <th>الإعلان</th>
                  <th>الملاحظة</th>
                  <th>المُبلِّغ</th>
                  <th>التاريخ</th>
                  <th>الحالة</th>
                  {canResolve && <th />}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">{REASON_LABELS[row.reason] ?? row.reason}</td>
                    <td>
                      <Link href={`/properties/${row.property.id}`} className="hover:text-signal">
                        <p className="truncate max-w-[20ch]">{row.property.title}</p>
                        <p className="ltr text-xs text-paper/40 font-mono">{row.property.reference}</p>
                      </Link>
                    </td>
                    <td className="max-w-[24ch] truncate">{row.note ?? '—'}</td>
                    <td className="ltr text-xs text-paper/50">{row.reporter?.phoneE164 ?? 'مجهول'}</td>
                    <td className="text-xs text-paper/50 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                    <td><Badge>{row.status}</Badge></td>
                    {canResolve && (
                      <td className="whitespace-nowrap">
                        {row.status === 'OPEN' && (
                          <>
                            <button
                              type="button"
                              className="btn-primary text-xs ml-2"
                              onClick={() => { setTarget({ row, verdict: 'ACTIONED' }); setNote(''); setError(null); }}
                            >
                              اتخاذ إجراء
                            </button>
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() => { setTarget({ row, verdict: 'DISMISSED' }); setNote(''); setError(null); }}
                            >
                              رفض البلاغ
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={target !== null}
        title={target?.verdict === 'ACTIONED' ? 'إغلاق البلاغ بعد اتخاذ إجراء؟' : 'رفض البلاغ؟'}
        description="سجّل ما تم عمله. تُحفظ الملاحظة في سجل التدقيق."
        requireReason
        reasonLabel="ملاحظة الإغلاق"
        minReasonLength={5}
        destructive={target?.verdict === 'ACTIONED'}
        reason={note}
        onReasonChange={setNote}
        pending={resolve.isPending}
        onCancel={() => { setTarget(null); setError(null); }}
        onConfirm={() => resolve.mutate()}
      />
      {error && <p className="mt-3 text-sm text-signal">{error}</p>}
    </Shell>
  );
}
