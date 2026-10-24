import type {
  AuthProvidersResponse,
  AuthResponse,
  CsrfResponse,
  SignInRequest,
  SignUpRequest,
} from '@p2p/contracts';

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      credentials: 'same-origin',
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AuthApiError(0, 'Unable to connect. Please try again.');
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : 'Unable to complete your request. Please try again.';
    throw new AuthApiError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
async function write<T>(path: string, body?: unknown) {
  const { csrfToken } = await request<CsrfResponse>('csrf');
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body ?? {}),
  });
}
export const authApi = {
  providers: (signal?: AbortSignal) => request<AuthProvidersResponse>('providers', { signal }),
  me: (signal?: AbortSignal) => request<AuthResponse>('me', { signal }),
  signUp: (input: SignUpRequest) => write<AuthResponse>('signup', input),
  signIn: (input: SignInRequest) => write<AuthResponse>('signin', input),
  signOut: () => write<void>('signout'),
};
