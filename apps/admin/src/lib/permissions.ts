import type { AdminProfile } from './api';

/**
 * Client-side permission map.
 *
 * This mirrors the @RequireRoles decorators on the API and exists only to avoid
 * showing an operator a control that would be refused — Master Plan §24's "no
 * dead controls". It is NOT the security boundary: the API re-checks every
 * request, and a route with no declared role is refused there outright.
 */
export type Permission =
  | 'dashboard.view'
  | 'properties.view'
  | 'properties.moderate'
  | 'users.view'
  | 'users.block'
  | 'payments.view'
  | 'payments.settle'
  | 'incidents.view'
  | 'incidents.moderate'
  | 'reels.view'
  | 'reels.moderate'
  | 'verifications.manage'
  | 'reports.view'
  | 'reports.resolve'
  | 'jobs.view'
  | 'flags.manage'
  | 'audit.view'
  | 'admins.manage';

const MATRIX: Record<AdminProfile['role'], Permission[]> = {
  SUPER_ADMIN: [
    'dashboard.view', 'properties.view', 'properties.moderate', 'users.view', 'users.block',
    'payments.view', 'payments.settle', 'incidents.view', 'incidents.moderate', 'reels.view',
    'reels.moderate', 'verifications.manage', 'reports.view', 'reports.resolve', 'jobs.view',
    'flags.manage', 'audit.view', 'admins.manage',
  ],
  MODERATOR: [
    'dashboard.view', 'properties.view', 'properties.moderate', 'users.view', 'users.block',
    'incidents.view', 'incidents.moderate', 'reels.view', 'reels.moderate',
    'verifications.manage', 'reports.view', 'reports.resolve', 'jobs.view',
  ],
  // Finance sees money, not listings or user content. Keeping the roles narrow
  // is what makes the audit trail meaningful.
  FINANCE: ['dashboard.view', 'payments.view', 'payments.settle'],
  SUPPORT: [
    'dashboard.view', 'properties.view', 'users.view', 'incidents.view', 'reels.view', 'reports.view',
  ],
};

export function can(admin: AdminProfile | null, permission: Permission): boolean {
  if (!admin) return false;
  return MATRIX[admin.role]?.includes(permission) ?? false;
}

export interface NavItem {
  href: string;
  label: string;
  permission: Permission;
  /** Key into the dashboard payload used to render an attention badge. */
  badgeKey?: 'pendingReview' | 'openReports' | 'pendingVerifications';
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'لوحة المعلومات', permission: 'dashboard.view' },
  { href: '/properties?status=PENDING_REVIEW', label: 'إعلانات بانتظار المراجعة', permission: 'properties.view', badgeKey: 'pendingReview' },
  { href: '/properties', label: 'العقارات', permission: 'properties.view' },
  { href: '/reels', label: 'الريلز', permission: 'reels.view' },
  { href: '/users', label: 'المستخدمون', permission: 'users.view' },
  { href: '/verifications', label: 'طلبات التوثيق', permission: 'verifications.manage', badgeKey: 'pendingVerifications' },
  { href: '/payments', label: 'المدفوعات', permission: 'payments.view' },
  { href: '/incidents', label: 'بلاغات الطرق', permission: 'incidents.view' },
  { href: '/reports', label: 'البلاغات', permission: 'reports.view', badgeKey: 'openReports' },
  { href: '/jobs', label: 'المهام والمعالجة', permission: 'jobs.view' },
  { href: '/flags', label: 'إعدادات الميزات', permission: 'flags.manage' },
  { href: '/audit', label: 'سجل التدقيق', permission: 'audit.view' },
  { href: '/admins', label: 'حسابات الإدارة', permission: 'admins.manage' },
];
