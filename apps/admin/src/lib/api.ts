'use client';

/**
 * Admin API client.
 *
 * The session token is kept in sessionStorage rather than localStorage: a
 * dashboard session should not survive the browser being closed, and an admin
 * token is a high-value credential. It is deliberately not a cookie, because the
 * API authenticates admins by bearer token and a cookie would invite CSRF.
 */

const TOKEN_KEY = 'rivo.admin.token';
const ADMIN_KEY = 'rivo.admin.profile';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'MODERATOR' | 'FINANCE' | 'SUPPORT';
  mustChangePassword?: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly messageAr?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Arabic where the API supplied it, English otherwise. */
  get display(): string {
    return this.messageAr ?? this.message;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, admin: AdminProfile): void {
  window.sessionStorage.setItem(TOKEN_KEY, token);
  window.sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}

export function getAdmin(): AdminProfile | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(ADMIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminProfile;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(ADMIN_KEY);
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = options;
  const token = auth ? getToken() : null;

  const response = await fetch(`${API_BASE}/api/v1${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(response.status, 'PARSE_ERROR', `Server returned a non-JSON response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    const err = (body as { error?: { code: string; message: string; messageAr?: string; details?: unknown } }).error;

    // An expired or revoked admin session must return the operator to the sign-in
    // screen rather than leaving them on a page full of failed requests.
    if (response.status === 401 && typeof window !== 'undefined') {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }

    throw new ApiError(
      response.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed with HTTP ${response.status}`,
      err?.messageAr,
      err?.details,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

/** Query-string builder that omits empty values instead of sending `?q=`. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
