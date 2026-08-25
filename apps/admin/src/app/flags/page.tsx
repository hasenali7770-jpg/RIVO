'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { formatDate } from '@/lib/format';

interface Flag {
  key: string;
  enabled: boolean;
  effective: boolean;
  blockedByMissingCredential: boolean;
  description: string | null;
  updatedAt: string;
}

export default function FlagsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['admin-flags'],
    queryFn: () => api.get<Flag[]>('/admin/flags'),
  });

  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api.patch(`/admin/flags/${key}`, { enabled }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-flags'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.display : 'تعذّر تغيير الإعداد.'),
  });

  return (
    <Shell>
      <PageHeader
        title="إعدادات الميزات"
        subtitle="التحكم بالميزات المتاحة في التطبيق"
      />

      <Card className="mb-6 border-sand/20">
        <p className="text-sm text-paper/70">
          الميزة تعمل فعلياً فقط عندما تكون مفعّلة <em>و</em> بيانات الاعتماد اللازمة لها متوفرة.
          إذا كانت مفعّلة لكن ينقصها مفتاح، فسيخفيها التطبيق بدلاً من عرض زر لا يعمل.
        </p>
      </Card>

      {isLoading && <Spinner />}
      {queryError && <ErrorState error={queryError} onRetry={() => refetch()} />}
      {error && <p className="mb-4 text-sm text-signal">{error}</p>}

      {data && (
        <div className="space-y-3">
          {data.map((flag) => (
            <Card key={flag.key} className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="ltr font-mono text-sm text-paper">{flag.key}</p>
                {flag.description && <p className="text-sm text-paper/60 mt-1">{flag.description}</p>}
                {flag.blockedByMissingCredential && (
                  <p className="text-xs text-sand mt-1">
                    مفعّلة لكن غير فعّالة — بيانات الاعتماد المطلوبة غير مضبوطة في الخادم.
                  </p>
                )}
                <p className="text-xs text-paper/30 mt-1">آخر تحديث {formatDate(flag.updatedAt)}</p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-xs ${flag.effective ? 'text-success' : 'text-paper/40'}`}>
                  {flag.effective ? 'فعّالة' : 'غير فعّالة'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={flag.enabled}
                  aria-label={flag.key}
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ key: flag.key, enabled: !flag.enabled })}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    flag.enabled ? 'bg-success' : 'bg-white/15'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      flag.enabled ? 'right-0.5' : 'right-[1.375rem]'
                    }`}
                  />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
