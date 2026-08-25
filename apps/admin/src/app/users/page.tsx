'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, getAdmin, qs } from '@/lib/api';
import { can } from '@/lib/permissions';
import { Shell } from '@/components/shell';
import { Badge, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';
import { SELLER_TYPE_LABELS, formatDate, formatRelative } from '@/lib/format';

interface UserRow {
  id: string;
  phone: string;
  displayName: string | null;
  sellerType: string;
  verification: string;
  officeName: string | null;
  blocked: boolean;
  blockedReason: string | null;
  telemetryOptIn: boolean;
  listingsCount: number;
  incidentsCount: number;
  createdAt: string;
  lastSeenAt: string | null;
}

interface UserList {
  items: UserRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export default function UsersPage() {
  const admin = getAdmin();
  const canBlock = can(admin, 'users.block');
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<UserRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['admin-users', search, page],
    queryFn: () => api.get<UserList>(`/admin/users${qs({ q: search, page, limit: 25 })}`),
  });

  const toggleBlock = useMutation({
    mutationFn: (user: UserRow) =>
      api.post(`/admin/users/${user.id}/block`, {
        blocked: !user.blocked,
        reason: user.blocked ? undefined : reason,
      }),
    onSuccess: () => {
      setTarget(null);
      setReason('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.display : 'تعذّر تنفيذ الإجراء.'),
  });

  return (
    <Shell>
      <PageHeader title="المستخدمون" subtitle={data ? `${data.pagination.total} مستخدم` : undefined} />

      <form className="mb-4" onSubmit={(e) => { e.preventDefault(); setPage(1); refetch(); }}>
        <input
          className="input max-w-sm"
          placeholder="بحث بالاسم أو رقم الهاتف…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      {isLoading && <Spinner />}
      {queryError && <ErrorState error={queryError} onRetry={() => refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="لا يوجد مستخدمون مطابقون." />}

      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>المستخدم</th>
                  <th>النوع</th>
                  <th>التوثيق</th>
                  <th>الإعلانات</th>
                  <th>البلاغات</th>
                  <th>الحالة</th>
                  <th>آخر ظهور</th>
                  {canBlock && <th />}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <p>{row.displayName ?? '—'}</p>
                      <p className="ltr text-xs text-paper/40">{row.phone}</p>
                    </td>
                    <td className="whitespace-nowrap">
                      {SELLER_TYPE_LABELS[row.sellerType] ?? row.sellerType}
                      {row.officeName && <p className="text-xs text-paper/40">{row.officeName}</p>}
                    </td>
                    <td>
                      {row.verification === 'VERIFIED' ? (
                        <Badge tone="bg-success-soft text-success">موثّق</Badge>
                      ) : (
                        <span className="text-xs text-paper/40">{row.verification}</span>
                      )}
                    </td>
                    <td>{row.listingsCount}</td>
                    <td>{row.incidentsCount}</td>
                    <td>
                      {row.blocked ? (
                        <>
                          <Badge tone="bg-signal-soft text-signal">موقوف</Badge>
                          {row.blockedReason && (
                            <p className="text-xs text-paper/40 mt-1 max-w-[20ch] truncate">{row.blockedReason}</p>
                          )}
                        </>
                      ) : (
                        <Badge tone="bg-success-soft text-success">نشط</Badge>
                      )}
                    </td>
                    <td className="text-xs text-paper/50 whitespace-nowrap">{formatRelative(row.lastSeenAt)}</td>
                    {canBlock && (
                      <td>
                        <button
                          type="button"
                          className={row.blocked ? 'btn-secondary text-xs' : 'btn-primary text-xs'}
                          onClick={() => { setTarget(row); setReason(''); setError(null); }}
                        >
                          {row.blocked ? 'رفع الإيقاف' : 'إيقاف'}
                        </button>
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
        title={target?.blocked ? 'رفع الإيقاف عن المستخدم؟' : 'إيقاف المستخدم؟'}
        description={
          target?.blocked
            ? 'سيتمكن المستخدم من تسجيل الدخول والنشر مرة أخرى.'
            : 'سيتم إنهاء جميع جلساته فوراً ولن يتمكن من النشر.'
        }
        destructive={!target?.blocked}
        requireReason={!target?.blocked}
        reasonLabel="سبب الإيقاف"
        minReasonLength={5}
        reason={reason}
        onReasonChange={setReason}
        pending={toggleBlock.isPending}
        onCancel={() => { setTarget(null); setError(null); }}
        onConfirm={() => target && toggleBlock.mutate(target)}
      />
      {error && <p className="mt-3 text-sm text-signal">{error}</p>}
    </Shell>
  );
}
