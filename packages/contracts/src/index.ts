export interface LivenessResponse {
  status: 'ok';
  service: 'p2p-api';
}

export interface ReadinessResponse {
  status: 'ready' | 'unavailable';
  checks: {
    mongodb: 'up' | 'down';
    replicaSet: 'ready' | 'unavailable';
  };
}

export interface AuthUser {
  id: string;
  email: string;
  publicHandle: string;
  displayName: string;
  emailVerified: boolean;
  signInMethod: 'email' | 'google';
}

export interface AuthResponse {
  user: AuthUser;
}
export interface AuthProvidersResponse {
  google: boolean;
  email: true;
}
export interface CsrfResponse {
  csrfToken: string;
}
export interface SignInRequest {
  email: string;
  password: string;
}
export interface SignUpRequest extends SignInRequest {
  publicHandle: string;
}
