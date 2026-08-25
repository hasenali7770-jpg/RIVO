'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, qs } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Badge, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';
import { SELLER_TYPE_LABELS, formatDate } from '@/lib/format';

interface VerificationRow {
  id: string;
  status: string;
  requestedType: string;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  user: { id: string; phoneE164: string; displayName: string | null; sellerType: string };
  documents: Array<{ key: string; url: string | null }>;
}

interface VerificationList {
  items: VerificationRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export default function VerificationsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<{ row: VerificationRow; verdict: 'VERIFIED' | 'REJECTED' } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['admin-verifications', status, page],
    queryFn: () => api.get<VerificationList>(`/admin/verifications${qs({ status, page, limit: 25 })}`),
  });

  const decide = useMutation({
    mutationFn: () =>
      api.post(`/admin/verifications/${decision!.row.id}/decide`, {
        decision: decision!.verdict,
        reason: decision!.verdict === 'REJECTED' ? reason : undefined,
      }),
    onSuccess: () => {
      setDecision(null); setReason(''); setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-verifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.display : 'تعذّر تنفيذ القرار.'),
  });

  return (
    <Shell>
      <PageHeader
        title="طلبات التوثيق"
        subtitle="لا تظهر علامة التوثيق إلا بعد موافقة صريحة"
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {['PENDING', 'VERIFIED', 'REJECTED', ''].map((value) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => { setStatus(value); setPage(1); }}
            className={status === value ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            {value === 'PENDING' ? 'معلّقة' : value === 'VERIFIED' ? 'موثّقة' : value === 'REJECTED' ? 'مرفوضة' : 'الكل'}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {queryError && <ErrorState error={queryError} onRetry={() => refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="لا توجد طلبات في هذه الحالة." />}

      {data && data.items.length > 0 && (
        <>
          <div className="space-y-4">
            {data.items.map((row) => (
              <Card key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-paper font-medium">{row.user.displayName ?? '—'}</p>
                    <p className="ltr text-xs text-paper/40">{row.user.phoneE164}</p>
                    <p className="text-sm text-paper/60 mt-1">
                      يطلب: {SELLER_TYPE_LABELS[row.requestedType] ?? row.requestedType}
                    </p>
                    {row.note && <p className="text-sm text-paper/60 mt-1">{row.note}</p>}
                    <p className="text-xs text-paper/40 mt-1">{formatDate(row.createdAt)}</p>
                  </div>
                  <Badge
                    tone={
                      row.status === 'VERIFIED' ? 'bg-success-soft text-success'
                      : row.status === 'REJECTED' ? 'bg-signal-soft text-signal'
                      : 'bg-sand/20 text-sand'
                    }
                  >
                    {row.status}
                  </Badge>
                </div>

                {row.documents.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-paper/50 mb-2">
                      المستندات ({row.documents.length}) — روابط مؤقتة صالحة ١٥ دقيقة
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {row.documents.map((doc, index) =>
                        doc.url ? (
                          <a key={doc.key} href={doc.url} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                            مستند {index + 1}
                          </a>
                        ) : (
                          <span key={doc.key} className="btn-secondary text-xs opacity-50">
                            مستند {index + 1} (غير متاح)
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {row.rejectionReason && (
                  <p className="mt-3 text-sm text-signal">سبب الرفض: {row.rejectionReason}</p>
                )}

                {row.status === 'PENDING' && (
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      className="btn-success text-sm"
                      onClick={() => { setDecision({ row, verdict: 'VERIFIED' }); setReason(''); setError(null); }}
                    >
                      توثيق
                    </button>
                    <button
                      type="button"
                      className="btn-primary text-sm"
                      onClick={() => { setDecision({ row, verdict: 'REJECTED' }); setReason(''); setError(null); }}
                    >
                      رفض
                    </button>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={decision !== null}
        title={decision?.verdict === 'VERIFIED' ? 'توثيق الحساب؟' : 'رفض طلب التوثيق؟'}
        description={
          decision?.verdict === 'VERIFIED'
            ? 'ستظهر علامة التوثيق على جميع إعلانات هذا المستخدم.'
            : 'سيظهر السبب للمستخدم كما هو.'
        }
        confirmLabel={decision?.verdict === 'VERIFIED' ? 'توثيق' : 'رفض'}
        destructive={decision?.verdict === 'REJECTED'}
        requireReason={decision?.verdict === 'REJECTED'}
        reason={reason}
        onReasonChange={setReason}
        pending={decide.isPending}
        onCancel={() => { setDecision(null); setError(null); }}
        onConfirm={() => decide.mutate()}
      />
      {error && <p className="mt-3 text-sm text-signal">{error}</p>}
    </Shell>
  );
}
