'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { formatDate } from '@/lib/format';

interface JobsPayload {
  aiJobs: Array<{
    id: string; type: string; status: string; provider: string | null; model: string | null;
    operations: string[]; costUsd: string | null; attempts: number; error: string | null;
    createdAt: string; finishedAt: string | null;
  }>;
  mediaJobs: Array<{
    id: string; type: string; status: string; attempts: number; error: string | null;
    createdAt: string; finishedAt: string | null;
  }>;
  pagination: { page: number; limit: number; total: number };
}

const STATUS_TONES: Record<string, string> = {
  SUCCEEDED: 'bg-success-soft text-success',
  FAILED: 'bg-signal-soft text-signal',
  SKIPPED: 'bg-sand/20 text-sand',
  RUNNING: 'bg-white/10 text-paper',
  QUEUED: 'bg-white/10 text-paper/60',
  CANCELLED: 'bg-white/10 text-paper/40',
};

export default function JobsPage() {
  const [status, setStatus] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-jobs', status],
    queryFn: () => api.get<JobsPayload>(`/admin/jobs${qs({ status, limit: 50 })}`),
    refetchInterval: 15_000,
  });

  return (
    <Shell>
      <PageHeader
        title="المهام والمعالجة"
        subtitle="تحسين الصور بالذكاء الاصطناعي وفحص الوسائط"
      />

      <Card className="mb-6 border-sand/20">
        <p className="text-sm text-paper/70">
          عند فشل أو تخطي مهمة التحسين، يُنشر الإعلان بالصورة الأصلية كما هي.
          لا يُعرض أبداً أي محتوى «محسّن» لم يُنتَج فعلياً.
        </p>
      </Card>

      <div className="flex flex-wrap gap-2 mb-4">
        {['', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'].map((value) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => setStatus(value)}
            className={status === value ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            {value || 'الكل'}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <div className="space-y-8">
          <section>
            <h2 className="text-sm font-medium text-paper/50 mb-3">مهام الذكاء الاصطناعي</h2>
            {data.aiJobs.length === 0 ? (
              <EmptyState title="لا توجد مهام." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>النوع</th>
                      <th>الحالة</th>
                      <th>المزوّد</th>
                      <th>النموذج</th>
                      <th>العمليات</th>
                      <th>المحاولات</th>
                      <th>الخطأ</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.aiJobs.map((job) => (
                      <tr key={job.id}>
                        <td className="ltr text-xs font-mono">{job.type}</td>
                        <td><Badge tone={STATUS_TONES[job.status] ?? ''}>{job.status}</Badge></td>
                        <td className="ltr text-xs">{job.provider ?? '—'}</td>
                        <td className="ltr text-xs text-paper/50 max-w-[18ch] truncate">{job.model ?? '—'}</td>
                        <td className="ltr text-xs text-paper/50 max-w-[22ch] truncate">
                          {job.operations.length ? job.operations.join(', ') : '—'}
                        </td>
                        <td>{job.attempts}</td>
                        <td className="max-w-[28ch] truncate text-xs text-signal">{job.error ?? '—'}</td>
                        <td className="text-xs text-paper/50 whitespace-nowrap">
                          {formatDate(job.finishedAt ?? job.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-medium text-paper/50 mb-3">مهام الوسائط</h2>
            {data.mediaJobs.length === 0 ? (
              <EmptyState title="لا توجد مهام." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>النوع</th>
                      <th>الحالة</th>
                      <th>المحاولات</th>
                      <th>الخطأ</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mediaJobs.map((job) => (
                      <tr key={job.id}>
                        <td className="ltr text-xs font-mono">{job.type}</td>
                        <td><Badge tone={STATUS_TONES[job.status] ?? ''}>{job.status}</Badge></td>
                        <td>{job.attempts}</td>
                        <td className="max-w-[28ch] truncate text-xs text-signal">{job.error ?? '—'}</td>
                        <td className="text-xs text-paper/50 whitespace-nowrap">
                          {formatDate(job.finishedAt ?? job.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}
