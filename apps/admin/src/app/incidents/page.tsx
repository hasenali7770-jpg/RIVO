'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, getAdmin, qs } from '@/lib/api';
import { can } from '@/lib/permissions';
import { Shell } from '@/components/shell';
import { Badge, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';
import { INCIDENT_TYPE_LABELS, formatDate, formatRelative } from '@/lib/format';

interface IncidentRow {
  id: string;
  type: string;
  status: string;
  lat: number;
  lng: number;
  note: string | null;
  score: number;
  confirmCount: number;
  dismissCount: number;
  confidence: number;
  expiresAt: string;
  createdAt: string;
  reportedBy: { id: string; phoneE164: string; displayName: string | null } | null;
}

interface IncidentList {
  items: IncidentRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const STATUSES = ['', 'ACTIVE', 'PENDING_REVIEW', 'EXPIRED', 'REMOVED'];
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'نشط',
  PENDING_REVIEW: 'بانتظار المراجعة',
  EXPIRED: 'منتهي',
  REMOVED: 'محذوف',
};

export default function IncidentsPage() {
  const admin = getAdmin();
  const canModerate = can(admin, 'incidents.moderate');
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<IncidentRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['admin-incidents', status, page],
    queryFn: () => api.get<IncidentList>(`/admin/incidents${qs({ status, page, limit: 25 })}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-incidents'] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.post(`/admin/incidents/${id}/remove`, { reason }),
    onSuccess: () => { setTarget(null); setReason(''); setError(null); invalidate(); },
    onError: (err) => setError(err instanceof ApiError ? err.display : 'تعذّر الحذف.'),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/admin/incidents/${id}/approve`),
    onSuccess: invalidate,
  });

  return (
    <Shell>
      <PageHeader title="بلاغات الطرق" subtitle="حوادث، ازدحام، إغلاقات، حفريات وأخطار" />

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUSES.map((value) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => { setStatus(value); setPage(1); }}
            className={status === value ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            {value ? STATUS_LABELS[value] : 'الكل'}
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
                  <th>النوع</th>
                  <th>الملاحظة</th>
                  <th>الموقع</th>
                  <th>التصويت</th>
                  <th>الثقة</th>
                  <th>الحالة</th>
                  <th>الانتهاء</th>
                  {canModerate && <th />}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">{INCIDENT_TYPE_LABELS[row.type] ?? row.type}</td>
                    <td className="max-w-[24ch] truncate">{row.note ?? '—'}</td>
                    <td>
                      <a
                        className="ltr text-xs font-mono text-paper/60 hover:text-paper"
                        href={`https://www.openstreetmap.org/?mlat=${row.lat}&mlon=${row.lng}#map=17/${row.lat}/${row.lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.lat.toFixed(4)}, {row.lng.toFixed(4)}
                      </a>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      <span className="text-success">+{row.confirmCount}</span>{' '}
                      <span className="text-signal">−{row.dismissCount}</span>
                    </td>
                    <td>{Math.round(row.confidence * 100)}%</td>
                    <td><Badge>{STATUS_LABELS[row.status] ?? row.status}</Badge></td>
                    <td className="text-xs text-paper/50 whitespace-nowrap">{formatRelative(row.expiresAt)}</td>
                    {canModerate && (
                      <td className="whitespace-nowrap">
                        {row.status === 'PENDING_REVIEW' && (
                          <button type="button" className="btn-success text-xs ml-2" onClick={() => approve.mutate(row.id)}>
                            نشر
                          </button>
                        )}
                        {row.status !== 'REMOVED' && (
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => { setTarget(row); setReason(''); setError(null); }}
                          >
                            حذف
                          </button>
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
        title="حذف البلاغ؟"
        description="سيختفي البلاغ من الخريطة. يبقى السجل محفوظاً للمراجعة."
        destructive
        requireReason
        reasonLabel="سبب الحذف"
        minReasonLength={10}
        reason={reason}
        onReasonChange={setReason}
        pending={remove.isPending}
        onCancel={() => { setTarget(null); setError(null); }}
        onConfirm={() => target && remove.mutate(target.id)}
      />
      {error && <p className="mt-3 text-sm text-signal">{error}</p>}
    </Shell>
  );
}
