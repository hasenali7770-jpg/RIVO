'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminProfile, api, clearSession, getAdmin, getToken } from '@/lib/api';
import { NAV_ITEMS, can } from '@/lib/permissions';
import { ROLE_LABELS } from '@/lib/format';
import { Spinner } from './ui';

interface DashboardCounts {
  properties: { pendingReview: number };
  queues: { openReports: number; pendingVerifications: number };
}

/**
 * Authenticated shell.
 *
 * Guards every page: without a session token the operator is sent to /login
 * before any data request is made. This is a usability guard, not the security
 * boundary — the API authorises every request independently.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    const profile = getAdmin();
    if (!token || !profile) {
      router.replace('/login');
      return;
    }
    // A seeded or reset account must set its own password before it can work.
    if (profile.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
      return;
    }
    setAdmin(profile);
    setChecked(true);
  }, [router, pathname]);

  const { data: counts } = useQuery({
    queryKey: ['dashboard-counts'],
    queryFn: () => api.get<DashboardCounts>('/admin/dashboard'),
    enabled: checked && can(admin, 'dashboard.view'),
    refetchInterval: 60_000,
  });

  if (!checked || !admin) return <Spinner label="جارٍ التحقق من الجلسة…" />;

  const badgeFor = (key?: 'pendingReview' | 'openReports' | 'pendingVerifications'): number => {
    if (!key || !counts) return 0;
    if (key === 'pendingReview') return counts.properties?.pendingReview ?? 0;
    if (key === 'openReports') return counts.queues?.openReports ?? 0;
    return counts.queues?.pendingVerifications ?? 0;
  };

  const signOut = async () => {
    await api.post('/admin/auth/logout').catch(() => undefined);
    clearSession();
    router.replace('/login');
  };

  const visible = NAV_ITEMS.filter((item) => can(admin, item.permission));

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 shrink-0 border-l border-white/5 bg-surface/50 hidden md:flex md:flex-col">
        <div className="p-5 border-b border-white/5">
          <p className="text-xl font-bold text-paper tracking-tight">RIVO</p>
          <p className="text-xs text-paper/40 mt-0.5">خرائط | داركم</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {visible.map((item) => {
            const base = item.href.split('?')[0];
            const active =
              pathname === base || (base !== '/' && pathname.startsWith(`${base}/`));
            const badge = badgeFor(item.badgeKey);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  active ? 'bg-signal/15 text-signal font-medium' : 'text-paper/70 hover:bg-white/5 hover:text-paper'
                }`}
              >
                <span>{item.label}</span>
                {badge > 0 && (
                  <span className="badge bg-signal text-white min-w-[1.5rem] justify-center">{badge}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/5">
          <div className="px-3 py-2">
            <p className="text-sm text-paper truncate">{admin.displayName}</p>
            <p className="ltr text-xs text-paper/40 truncate">{admin.email}</p>
            <p className="text-xs text-sand mt-1">{ROLE_LABELS[admin.role] ?? admin.role}</p>
          </div>
          <Link href="/change-password" className="btn-ghost w-full justify-start text-sm">
            تغيير كلمة المرور
          </Link>
          <button type="button" onClick={signOut} className="btn-ghost w-full justify-start text-sm">
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between border-b border-white/5 bg-surface/50 px-4 py-3">
          <p className="font-bold text-paper">RIVO</p>
          <button type="button" onClick={signOut} className="btn-ghost text-sm">
            خروج
          </button>
        </div>
        {/* Mobile navigation: the sidebar is hidden below md, so the same links
            are offered as a horizontal scroller rather than being unreachable. */}
        <div className="md:hidden table-wrap border-0 border-b border-white/5">
          <div className="flex gap-1 p-2 min-w-max">
            {visible.map((item) => (
              <Link key={item.href} href={item.href} className="btn-ghost text-xs whitespace-nowrap">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="p-4 md:p-8 max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
