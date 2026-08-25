'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AdminProfile, ApiError, api, setSession } from '@/lib/api';

interface LoginResponse {
  token: string;
  expiresAt: string;
  admin: AdminProfile;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await api.post<LoginResponse>('/admin/auth/login', { email, password });
      setSession(result.token, result.admin);
      // A bootstrap or reset account must choose its own password before it can
      // act on anything.
      router.replace(result.admin.mustChangePassword ? '/change-password' : '/');
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'تعذّر تسجيل الدخول.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-paper tracking-tight">RIVO</h1>
          <p className="text-sm text-paper/40 mt-1">خرائط | داركم — لوحة الإدارة</p>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">
              البريد الإلكتروني
            </label>
            <input
              id="email"
              type="email"
              className="input ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              كلمة المرور
            </label>
            <input
              id="password"
              type="password"
              className="input ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-signal bg-signal-soft rounded-lg px-3 py-2" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? 'جارٍ الدخول…' : 'تسجيل الدخول'}
          </button>

          <p className="text-xs text-paper/40 text-center">
            تُقفل المحاولات بعد ٥ محاولات خاطئة لمدة ١٥ دقيقة.
          </p>
        </form>
      </div>
    </div>
  );
}
