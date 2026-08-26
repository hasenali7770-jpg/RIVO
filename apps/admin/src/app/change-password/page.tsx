'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api, clearSession } from '@/lib/api';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 12;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.post('/admin/auth/change-password', { currentPassword, newPassword });
      // The API revokes every admin session on a password change, so the
      // operator must sign in again — including on this device.
      clearSession();
      router.replace('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'تعذّر تغيير كلمة المرور.');
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-paper">تغيير كلمة المرور</h1>
          <p className="text-sm text-paper/50 mt-1">
            سيتم تسجيل الخروج من جميع الجلسات بعد التغيير.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="current">كلمة المرور الحالية</label>
          <input id="current" type="password" className="input ltr" value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </div>

        <div>
          <label className="label" htmlFor="next">كلمة المرور الجديدة</label>
          <input id="next" type="password" className="input ltr" value={newPassword}
            onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={12} />
          {tooShort && <p className="mt-1 text-xs text-signal">١٢ حرفاً على الأقل.</p>}
        </div>

        <div>
          <label className="label" htmlFor="confirm">تأكيد كلمة المرور</label>
          <input id="confirm" type="password" className="input ltr" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          {mismatch && <p className="mt-1 text-xs text-signal">كلمتا المرور غير متطابقتين.</p>}
        </div>

        {error && <p className="text-sm text-signal bg-signal-soft rounded-lg px-3 py-2" role="alert">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={pending || mismatch || tooShort}>
          {pending ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </form>
    </div>
  );
}
