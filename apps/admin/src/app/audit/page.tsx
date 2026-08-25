'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';
import { ROLE_LABELS, formatDate } from '@/lib/format';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  reason: string | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  admin: { id: string; email: string; displayName: string; role: string } | null;
}

interface AuditList {
  items: AuditRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-audit', action, entityType, page],
    queryFn: () => api.get<AuditList>(`/admin/audit-logs${qs({ action, entityType, page, limit: 50 })}`),
  });

  return (
    <Shell>
      <PageHeader
        title="سجل التدقيق"
        subtitle="سجل غير قابل للتعديل أو الحذف على مستوى قاعدة البيانات"
      />

      <Card className="mb-6 border-sand/20">
        <p className="text-sm text-paper/70">
          هذا السجل للإضافة فقط: أي محاولة تعديل أو حذف تُرفض بواسطة مُشغِّل في قاعدة البيانات،
          حتى من داخل التطبيق نفسه.
        </p>
      </Card>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          className="input max-w-[200px]"
          placeholder="الإجراء (مثال: property.approve)"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
        />
        <select
          className="input max-w-[180px]"
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
        >
          <option value="">كل الأنواع</option>
          {['property', 'user', 'payment', 'incident', 'reel', 'verification', 'report', 'flag', 'admin'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="لا توجد سجلات مطابقة." />}

      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الإجراء</th>
                  <th>العنصر</th>
                  <th>المُنفِّذ</th>
                  <th>السبب</th>
                  <th>IP</th>
                  <th>التاريخ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <>
                    <tr key={row.id}>
                      <td className="ltr text-xs font-mono">{row.action}</td>
                      <td className="ltr text-xs">
                        <p>{row.entityType}</p>
                        {row.entityId && (
                          <p className="text-paper/30 font-mono truncate max-w-[16ch]">{row.entityId}</p>
                        )}
                      </td>
                      <td>
                        {row.admin ? (
                          <>
                            <p className="text-sm">{row.admin.displayName}</p>
                            <Badge tone="bg-white/10 text-paper/60">
                              {ROLE_LABELS[row.admin.role] ?? row.admin.role}
                            </Badge>
                          </>
                        ) : (
                          <span className="text-paper/40 text-xs">النظام</span>
                        )}
                      </td>
                      <td className="max-w-[24ch] truncate text-xs">{row.reason ?? '—'}</td>
                      <td className="ltr text-xs text-paper/40">{row.ip ?? '—'}</td>
                      <td className="text-xs text-paper/50 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                      <td>
                        {row.changes ? (
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                          >
                            {expanded === row.id ? 'إخفاء' : 'التفاصيل'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {expanded === row.id && row.changes ? (
                      <tr key={`${row.id}-detail`}>
                        <td colSpan={7} className="bg-petrol-800">
                          <pre className="ltr text-xs font-mono text-paper/70 overflow-x-auto p-2">
                            {JSON.stringify(row.changes, null, 2)}
                          </pre>
                          {row.requestId && (
                            <p className="ltr text-xs text-paper/30 font-mono px-2 pb-2">
                              request-id: {row.requestId}
                            </p>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}
    </Shell>
  );
}
