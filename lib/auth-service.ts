export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthResponse {
  user?: AuthUser;
  token?: string;
  accessToken?: string;
  confirmationRequired?: boolean;
  message?: string;
  // MFA fields
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  session?: string;
  email?: string;
}

interface MfaSetupResponse {
  secretCode: string;
  session: string;
  otpauthUri: string;
}

export interface SignInResult {
  user?: AuthUser;
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  session?: string;
  email?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_LOCAL_API_BASE || '').replace(/\/$/, '');
const API_PREFIX = `${API_BASE}/api/auth`;

const buildUrl = (path: string) => `${API_PREFIX}${path}`;

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Authentication request failed');
  }

  return data as T;
}

class AuthService {
  private currentUser: AuthUser | null = null;
  private token: string | null = null;

  constructor() {
    // Load token from localStorage on initialization
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private setToken(token: string | null): void {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('auth_token', token);
      } else {
        localStorage.removeItem('auth_token');
      }
    }
  }

  async loadCurrentUser(): Promise<AuthUser | null> {
    try {
      const headers: HeadersInit = {};
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      const response = await fetch(buildUrl('/me'), {
        headers
      });

      if (!response.ok) {
        this.currentUser = null;
        this.setToken(null);
        return null;
      }

      const data = (await response.json()) as { user: AuthUser | null };
      this.currentUser = data.user;
      return this.currentUser;
    } catch {
      this.currentUser = null;
      this.setToken(null);
      return null;
    }
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const data = await request<AuthResponse>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    // Check if MFA is required
    if (data.mfaRequired || data.mfaSetupRequired) {
      return {
        mfaRequired: data.mfaRequired,
        mfaSetupRequired: data.mfaSetupRequired,
        session: data.session,
        email: data.email,
      };
    }

    // Authentication complete
    this.currentUser = data.user || null;

    // Handle both token formats (accessToken for Cognito, token for local)
    const authToken = data.accessToken || data.token;
    if (authToken) {
      this.setToken(authToken);
      // Force localStorage update (Next.js SSR workaround)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('auth_token', authToken);
      }
    }
    return { user: data.user };
  }

  async verifyMfa(session: string, mfaCode: string, email: string): Promise<AuthUser> {
    const data = await request<AuthResponse>('/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ session, mfaCode, email }),
    });

    if (!data.user) {
      throw new Error('MFA verification failed');
    }

    this.currentUser = data.user;

    const authToken = data.accessToken || data.token;
    if (authToken) {
      this.setToken(authToken);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('auth_token', authToken);
      }
    }

    return data.user;
  }

  async getMfaSetupSecret(session: string): Promise<MfaSetupResponse> {
    const response = await fetch(buildUrl(`/mfa/setup?session=${encodeURIComponent(session)}`));

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to get MFA setup secret');
    }

    return data as MfaSetupResponse;
  }

  async completeMfaSetup(session: string, mfaCode: string, email: string): Promise<AuthUser> {
    const data = await request<AuthResponse>('/mfa/setup', {
      method: 'POST',
      body: JSON.stringify({ session, mfaCode, email }),
    });

    if (!data.user) {
      throw new Error('MFA setup failed');
    }

    this.currentUser = data.user;

    const authToken = data.accessToken || data.token;
    if (authToken) {
      this.setToken(authToken);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('auth_token', authToken);
      }
    }

    return data.user;
  }

  async signUp(email: string, password: string, name: string): Promise<{ confirmationRequired: boolean; email: string; message?: string }> {
    const data = await request<AuthResponse>('/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
    return {
      confirmationRequired: data.confirmationRequired ?? true,
      email: data.email || email,
      message: data.message,
    };
  }

  async confirmSignUp(email: string, code: string, password: string): Promise<AuthUser | null> {
    const data = await request<AuthResponse>('/confirm-signup', {
      method: 'POST',
      body: JSON.stringify({ email, code, password }),
    });
    if (data.user) {
      this.currentUser = data.user;
      const authToken = data.accessToken || data.token;
      if (authToken) {
        this.setToken(authToken);
        if (typeof window !== 'undefined') window.localStorage.setItem('auth_token', authToken);
      }
      return data.user;
    }
    return null;
  }

  async forgotPassword(email: string): Promise<void> {
    await request<{ message: string }>('/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
    await request<{ message: string }>('/confirm-forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword }),
    });
  }

  async signOut(): Promise<void> {
    await request<{ success: boolean }>('/logout', { method: 'POST' });
    this.currentUser = null;
    this.setToken(null);
  }

  // MFA Management Methods (for authenticated users)

  async getMfaStatus(): Promise<{ mfaEnabled: boolean; preferredMfa: string | null; availableMethods: string[] }> {
    const headers: HeadersInit = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(buildUrl('/mfa/status'), { headers });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to get MFA status');
    }

    return data;
  }

  async getMfaEnableSecret(): Promise<{ secretCode: string; otpauthUri: string }> {
    const headers: HeadersInit = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(buildUrl('/mfa/enable'), { headers });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to get MFA setup secret');
    }

    return data;
  }

  async enableMfa(mfaCode: string): Promise<{ success: boolean; message: string }> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(buildUrl('/mfa/enable'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ mfaCode }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to enable MFA');
    }

    return data;
  }

  async disableMfa(mfaCode: string): Promise<{ success: boolean; message: string }> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(buildUrl('/mfa/disable'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ mfaCode }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to disable MFA');
    }

    return data;
  }
}

export const authService = new AuthService();

