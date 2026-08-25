'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, getAdmin, qs } from '@/lib/api';
import { can } from '@/lib/permissions';
import { Shell } from '@/components/shell';
import { Badge, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';

interface ReelRow {
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
  viewCount: number;
  createdAt: string;
  property: { id: string; reference: string; title: string; status: string; owner: { id: string; phoneE164: string } };
}

interface ReelList {
  items: ReelRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const STATUSES = ['', 'READY', 'PROCESSING', 'UPLOADED', 'VALIDATION_FAILED', 'REJECTED'];
const STATUS_LABELS: Record<string, string> = {
  READY: 'منشور',
  PROCESSING: 'قيد المعالجة',
  UPLOADED: 'مرفوع',
  PENDING_UPLOAD: 'بانتظار الرفع',
  VALIDATION_FAILED: 'مرفوض تلقائياً',
  REJECTED: 'محذوف إدارياً',
};

export default function ReelsPage() {
  const admin = getAdmin();
  const canModerate = can(admin, 'reels.moderate');
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('READY');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<ReelRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['admin-reels', status, page],
    queryFn: () => api.get<ReelList>(`/admin/reels${qs({ status, page, limit: 25 })}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.post(`/admin/reels/${id}/remove`, { reason }),
    onSuccess: () => {
      setTarget(null); setReason(''); setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-reels'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.display : 'تعذّر الحذف.'),
  });

  return (
    <Shell>
      <PageHeader
        title="الريلز"
        subtitle="فيديوهات عقارية فقط — الحد الأدنى 1080p ومرتبطة بإعلان"
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUSES.map((value) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => { setStatus(value); setPage(1); }}
            className={status === value ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            {value ? STATUS_LABELS[value] ?? value : 'الكل'}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {queryError && <ErrorState error={queryError} onRetry={() => refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="لا توجد ريلز في هذه الحالة." />}

      {data && data.items.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.items.map((row) => {
              const meetsMinimum = (row.shortEdge ?? 0) >= 1080;
              return (
                <div key={row.id} className="card p-3">
                  <div className="relative">
                    {row.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.thumbnailUrl}
                        alt=""
                        className="w-full aspect-[9/16] object-cover rounded-lg bg-petrol-800"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full aspect-[9/16] rounded-lg bg-petrol-800" />
                    )}
                    <div className="absolute top-2 right-2">
                      <Badge tone={row.status === 'READY' ? 'bg-success-soft text-success' : 'bg-signal-soft text-signal'}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-sm">
                    <p className="truncate">{row.property.title}</p>
                    <p className="ltr text-xs text-paper/40 font-mono">{row.property.reference}</p>
                    <p className={`ltr text-xs ${meetsMinimum ? 'text-success' : 'text-signal'}`}>
                      {row.width ?? '?'}×{row.height ?? '?'} · أقصر ضلع {row.shortEdge ?? '?'}px
                    </p>
                    {row.durationSeconds && (
                      <p className="text-xs text-paper/40">{Math.round(row.durationSeconds)} ثانية · {row.viewCount} مشاهدة</p>
                    )}
                    {row.validationError && (
                      <p className="text-xs text-signal">{row.validationError}</p>
                    )}
                  </div>

                  <div className="mt-3 flex gap-2">
                    {row.hlsUrl && (
                      <a href={row.hlsUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs flex-1">
                        مشاهدة
                      </a>
                    )}
                    {canModerate && row.status === 'READY' && (
                      <button
                        type="button"
                        className="btn-primary text-xs flex-1"
                        onClick={() => { setTarget(row); setReason(''); setError(null); }}
                      >
                        حذف
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={target !== null}
        title="حذف الريل؟"
        description="سيُحذف الفيديو من Cloudflare Stream ويُبلَّغ المالك بالسبب."
        destructive
        requireReason
        reasonLabel="سبب الحذف (يظهر للمالك)"
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
