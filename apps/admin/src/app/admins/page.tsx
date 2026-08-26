'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, getAdmin } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Badge, Card, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { ROLE_LABELS, formatDate } from '@/lib/format';

interface AdminRow {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLES = ['SUPER_ADMIN', 'MODERATOR', 'FINANCE', 'SUPPORT'] as const;

const ROLE_DESCRIPTIONS: Record<string, string> = {
  SUPER_ADMIN: 'صلاحية كاملة، بما فيها الإعدادات وسجل التدقيق وحسابات الإدارة.',
  MODERATOR: 'مراجعة الإعلانات والريلز والبلاغات وإدارة المستخدمين.',
  FINANCE: 'المدفوعات والإيرادات فقط.',
  SUPPORT: 'اطّلاع فقط على الإعلانات والمستخدمين والبلاغات.',
};

export default function AdminsPage() {
  const me = getAdmin();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', displayName: '', role: 'SUPPORT', temporaryPassword: '' });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['admin-admins'],
    queryFn: () => api.get<AdminRow[]>('/admin/admins'),
  });

  const create = useMutation({
    mutationFn: () => api.post('/admin/admins', form),
    onSuccess: () => {
      setCreating(false);
      setForm({ email: '', displayName: '', role: 'SUPPORT', temporaryPassword: '' });
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-admins'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.display : 'تعذّر إنشاء الحساب.'),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin/admins/${id}/active`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-admins'] }),
    onError: (err) => setError(err instanceof ApiError ? err.display : 'تعذّر تغيير الحالة.'),
  });

  return (
    <Shell>
      <PageHeader
        title="حسابات الإدارة"
        actions={
          <button type="button" className="btn-primary" onClick={() => { setCreating(true); setError(null); }}>
            إضافة حساب
          </button>
        }
      />

      {error && <p className="mb-4 text-sm text-signal">{error}</p>}
      {isLoading && <Spinner />}
      {queryError && <ErrorState error={queryError} onRetry={() => refetch()} />}

      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>البريد</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>آخر دخول</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id}>
                  <td>{row.displayName}</td>
                  <td className="ltr text-sm">{row.email}</td>
                  <td>
                    <Badge tone="bg-white/10 text-paper/70">{ROLE_LABELS[row.role] ?? row.role}</Badge>
                    <p className="text-xs text-paper/40 mt-1 max-w-[28ch]">{ROLE_DESCRIPTIONS[row.role]}</p>
                  </td>
                  <td>
                    {row.isActive ? (
                      <Badge tone="bg-success-soft text-success">نشط</Badge>
                    ) : (
                      <Badge tone="bg-signal-soft text-signal">معطّل</Badge>
                    )}
                  </td>
                  <td className="text-xs text-paper/50 whitespace-nowrap">{formatDate(row.lastLoginAt)}</td>
                  <td>
                    {row.id !== me?.id && (
                      <button
                        type="button"
                        className={row.isActive ? 'btn-secondary text-xs' : 'btn-success text-xs'}
                        disabled={setActive.isPending}
                        onClick={() => setActive.mutate({ id: row.id, isActive: !row.isActive })}
                      >
                        {row.isActive ? 'تعطيل' : 'تفعيل'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md">
            <h2 className="text-lg font-semibold text-paper mb-4">حساب إدارة جديد</h2>
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="a-name">الاسم</label>
                <input id="a-name" className="input" value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="a-email">البريد الإلكتروني</label>
                <input id="a-email" type="email" className="input ltr" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="a-role">الدور</label>
                <select id="a-role" className="input" value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
                <p className="text-xs text-paper/40 mt-1">{ROLE_DESCRIPTIONS[form.role]}</p>
              </div>
              <div>
                <label className="label" htmlFor="a-pass">كلمة مرور مؤقتة</label>
                <input id="a-pass" className="input ltr" value={form.temporaryPassword} minLength={12}
                  onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} />
                <p className="text-xs text-paper/40 mt-1">
                  ١٢ حرفاً على الأقل. سيُطلب من صاحب الحساب تغييرها عند أول دخول.
                </p>
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-signal">{error}</p>}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={create.isPending || form.temporaryPassword.length < 12 || !form.email || form.displayName.length < 2}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'جارٍ الإنشاء…' : 'إنشاء'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>إلغاء</button>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
