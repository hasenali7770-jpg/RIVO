'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Badge, EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  PURPOSE_LABELS,
  formatIqd,
  formatRelative,
} from '@/lib/format';

interface PropertyRow {
  id: string;
  reference: string;
  title: string;
  status: string;
  type: string;
  purpose: string;
  priceIqd: string;
  areaSqm: string;
  governorate: string;
  district: string | null;
  photoCount: number;
  isPaid: boolean;
  owner: { id: string; phoneE164: string; displayName: string | null; sellerType: string };
  coverUrl: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface PropertyList {
  items: PropertyRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const STATUS_TABS = [
  { value: 'PENDING_REVIEW', label: 'بانتظار المراجعة' },
  { value: 'AWAITING_PAYMENT', label: 'بانتظار الدفع' },
  { value: 'PUBLISHED', label: 'منشورة' },
  { value: 'CHANGES_REQUESTED', label: 'مطلوب تعديل' },
  { value: 'REJECTED', label: 'مرفوضة' },
  { value: 'DRAFT', label: 'مسودات' },
  { value: '', label: 'الكل' },
];

function PropertiesContent() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? 'PENDING_REVIEW');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-properties', status, search, page],
    queryFn: () => api.get<PropertyList>(`/admin/properties${qs({ status, q: search, page, limit: 25 })}`),
  });

  return (
    <>
      <PageHeader
        title="العقارات"
        subtitle={data ? `${data.pagination.total} إعلان` : undefined}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value || 'all'}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            className={status === tab.value ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form
        className="mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          refetch();
        }}
      >
        <input
          className="input max-w-sm"
          placeholder="بحث بالعنوان أو الرقم المرجعي أو المنطقة…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="لا توجد إعلانات في هذه الحالة." />}

      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الإعلان</th>
                  <th>النوع</th>
                  <th>السعر</th>
                  <th>الصور</th>
                  <th>الدفع</th>
                  <th>الحالة</th>
                  <th>المالك</th>
                  <th>التاريخ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => {
                  const status = PROPERTY_STATUS_LABELS[row.status] ?? { ar: row.status, tone: '' };
                  // The 8-18 rule is what a moderator checks first, so it is
                  // surfaced in the list rather than only on the detail page.
                  const photosOk = row.photoCount >= 8 && row.photoCount <= 18;
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          {row.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={row.coverUrl}
                              alt=""
                              className="h-10 w-14 rounded object-cover bg-petrol-800"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-10 w-14 rounded bg-petrol-800 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate max-w-[22ch]">{row.title}</p>
                            <p className="ltr text-xs text-paper/40 font-mono">{row.reference}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <p>{PROPERTY_TYPE_LABELS[row.type] ?? row.type}</p>
                        <p className="text-xs text-paper/40">{PURPOSE_LABELS[row.purpose] ?? row.purpose}</p>
                      </td>
                      <td className="whitespace-nowrap text-sand">{formatIqd(row.priceIqd)}</td>
                      <td>
                        <span className={photosOk ? 'text-success' : 'text-signal'}>
                          {row.photoCount}
                        </span>
                        <span className="text-paper/30 text-xs"> / 8–18</span>
                      </td>
                      <td>
                        {row.isPaid ? (
                          <Badge tone="bg-success-soft text-success">مدفوع</Badge>
                        ) : (
                          <Badge tone="bg-white/10 text-paper/50">غير مدفوع</Badge>
                        )}
                      </td>
                      <td>
                        <Badge tone={status.tone}>{status.ar}</Badge>
                      </td>
                      <td>
                        <p className="truncate max-w-[16ch]">{row.owner.displayName ?? '—'}</p>
                        <p className="ltr text-xs text-paper/40">{row.owner.phoneE164}</p>
                      </td>
                      <td className="whitespace-nowrap text-xs text-paper/50">
                        {formatRelative(row.submittedAt ?? row.createdAt)}
                      </td>
                      <td>
                        <Link href={`/properties/${row.id}`} className="btn-secondary text-xs">
                          مراجعة
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}
    </>
  );
}

export default function PropertiesPage() {
  return (
    <Shell>
      {/* useSearchParams needs a Suspense boundary during static generation. */}
      <Suspense fallback={<Spinner />}>
        <PropertiesContent />
      </Suspense>
    </Shell>
  );
}
