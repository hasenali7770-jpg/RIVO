'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Card, ErrorState, PageHeader, Spinner, StatTile } from '@/components/ui';
import { formatIqd, formatNumber } from '@/lib/format';

interface Dashboard {
  users: { total: number; new24h: number };
  properties: { total: number; published: number; pendingReview: number; awaitingPayment: number; new7d: number };
  payments: { paidCount: number; revenueIqd: number; standardFeeIqd: number };
  content: { activeIncidents: number; readyReels: number };
  queues: {
    openReports: number;
    pendingVerifications: number;
    failedAiJobs7d: number;
    bull: Record<string, { waiting: number; active: number; failed: number; delayed: number }>;
  };
  actionRequired: number;
}

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/admin/dashboard'),
  });

  return (
    <Shell>
      <PageHeader title="لوحة المعلومات" subtitle="نظرة عامة على منصة RIVO" />

      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <div className="space-y-6">
          {data.actionRequired > 0 && (
            <Card className="border-signal/30 bg-signal-soft">
              <p className="text-paper font-medium">
                {formatNumber(data.actionRequired)} عنصر بانتظار إجراء منك
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.properties.pendingReview > 0 && (
                  <Link href="/properties?status=PENDING_REVIEW" className="btn-secondary text-sm">
                    مراجعة {data.properties.pendingReview} إعلان
                  </Link>
                )}
                {data.queues.openReports > 0 && (
                  <Link href="/reports" className="btn-secondary text-sm">
                    {data.queues.openReports} بلاغ مفتوح
                  </Link>
                )}
                {data.queues.pendingVerifications > 0 && (
                  <Link href="/verifications" className="btn-secondary text-sm">
                    {data.queues.pendingVerifications} طلب توثيق
                  </Link>
                )}
              </div>
            </Card>
          )}

          <section>
            <h2 className="text-sm font-medium text-paper/50 mb-3">العقارات</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="إجمالي الإعلانات" value={formatNumber(data.properties.total)} />
              <StatTile
                label="منشورة"
                value={formatNumber(data.properties.published)}
                tone="text-success"
              />
              <StatTile
                label="قيد المراجعة"
                value={formatNumber(data.properties.pendingReview)}
                tone={data.properties.pendingReview > 0 ? 'text-signal' : 'text-paper'}
              />
              <StatTile
                label="بانتظار الدفع"
                value={formatNumber(data.properties.awaitingPayment)}
                tone="text-sand"
                hint={`رسوم النشر ${formatIqd(data.payments.standardFeeIqd)}`}
              />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium text-paper/50 mb-3">المستخدمون والإيرادات</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="المستخدمون" value={formatNumber(data.users.total)} hint={`+${data.users.new24h} خلال ٢٤ ساعة`} />
              <StatTile label="إعلانات جديدة (٧ أيام)" value={formatNumber(data.properties.new7d)} />
              <StatTile label="عمليات دفع ناجحة" value={formatNumber(data.payments.paidCount)} tone="text-success" />
              <StatTile label="إجمالي الإيرادات" value={formatIqd(data.payments.revenueIqd)} tone="text-sand" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium text-paper/50 mb-3">المحتوى والطرق</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="بلاغات طرق نشطة" value={formatNumber(data.content.activeIncidents)} />
              <StatTile label="ريلز منشورة" value={formatNumber(data.content.readyReels)} />
              <StatTile
                label="مهام AI فاشلة (٧ أيام)"
                value={formatNumber(data.queues.failedAiJobs7d)}
                tone={data.queues.failedAiJobs7d > 0 ? 'text-signal' : 'text-paper'}
                hint="الإعلان يُنشر بالصورة الأصلية عند فشل التحسين"
              />
              <StatTile label="طلبات توثيق معلّقة" value={formatNumber(data.queues.pendingVerifications)} />
            </div>
          </section>

          {Object.keys(data.queues.bull ?? {}).length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-paper/50 mb-3">طوابير المعالجة</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>الطابور</th>
                      <th>بالانتظار</th>
                      <th>قيد التنفيذ</th>
                      <th>مؤجلة</th>
                      <th>فاشلة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.queues.bull).map(([name, counts]) => (
                      <tr key={name}>
                        <td className="ltr font-mono text-xs">{name}</td>
                        <td>{formatNumber(counts.waiting)}</td>
                        <td>{formatNumber(counts.active)}</td>
                        <td>{formatNumber(counts.delayed)}</td>
                        <td className={counts.failed > 0 ? 'text-signal' : ''}>{formatNumber(counts.failed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </Shell>
  );
}
