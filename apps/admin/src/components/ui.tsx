'use client';

import { ReactNode } from 'react';

export function Badge({ children, tone = 'bg-white/10 text-paper/70' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-paper">{title}</h1>
        {subtitle && <p className="text-sm text-paper/50 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-paper/50 text-sm">
      <span
        className="inline-block h-4 w-4 rounded-full border-2 border-paper/20 border-t-signal animate-spin"
        aria-hidden
      />
      {label}
    </div>
  );
}

/**
 * Error state.
 *
 * The Arabic message from the API is shown to the operator; the machine-readable
 * code is shown alongside it because support needs something unambiguous to
 * quote when escalating.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error && typeof error === 'object' && 'display' in error
      ? String((error as { display: string }).display)
      : 'تعذّر تحميل البيانات.';
  const code =
    error && typeof error === 'object' && 'code' in error ? String((error as { code: string }).code) : null;

  return (
    <div className="card p-6 border-signal/30">
      <p className="text-paper font-medium">{message}</p>
      {code && <p className="ltr mt-1 text-xs text-paper/40 font-mono">{code}</p>}
      {onRetry && (
        <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card p-12 text-center">
      <p className="text-paper/70">{title}</p>
      {hint && <p className="text-sm text-paper/40 mt-2">{hint}</p>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'text-paper',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-xs text-paper/50">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-paper/40">{hint}</p>}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-4 mt-4">
      <button
        type="button"
        className="btn-secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        السابق
      </button>
      <span className="text-sm text-paper/50">
        صفحة {page} من {totalPages}
      </span>
      <button
        type="button"
        className="btn-secondary"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        التالي
      </button>
    </div>
  );
}

/**
 * Confirmation prompt for a consequential action.
 *
 * `requireReason` is used wherever the API demands a reason — rejecting a
 * listing, blocking a user, removing a reel — because that text is shown to the
 * affected person verbatim.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'تأكيد',
  requireReason = false,
  reasonLabel = 'السبب (يظهر للمستخدم)',
  minReasonLength = 10,
  destructive = false,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  pending = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  minReasonLength?: number;
  destructive?: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  if (!open) return null;
  const reasonTooShort = requireReason && reason.trim().length < minReasonLength;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-paper">{title}</h2>
        {description && <p className="mt-2 text-sm text-paper/60">{description}</p>}

        {requireReason && (
          <div className="mt-4">
            <label className="label" htmlFor="confirm-reason">
              {reasonLabel}
            </label>
            <textarea
              id="confirm-reason"
              className="input min-h-[96px]"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="اكتب سبباً واضحاً…"
            />
            {reasonTooShort && (
              <p className="mt-1 text-xs text-signal">
                يجب ألا يقل السبب عن {minReasonLength} أحرف.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-start gap-3">
          <button
            type="button"
            className={destructive ? 'btn-primary' : 'btn-success'}
            disabled={pending || reasonTooShort}
            onClick={onConfirm}
          >
            {pending ? 'جارٍ التنفيذ…' : confirmLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Marks seeded sample content. Master Plan §5 and §21 require demo data to be
 * clearly labelled so nobody mistakes it for real inventory.
 */
export function DemoBadge() {
  return <Badge tone="bg-sand/20 text-sand">عيّنة</Badge>;
}
