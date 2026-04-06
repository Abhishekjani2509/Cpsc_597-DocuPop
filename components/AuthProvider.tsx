'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authService, AuthUser, SignInResult } from '@/lib/auth-service';

export interface MfaState {
  required: boolean;
  setupRequired: boolean;
  session: string;
  email: string;
  secretCode?: string;
  otpauthUri?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  mfaState: MfaState | null;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signUp: (email: string, password: string, name: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  verifyMfa: (mfaCode: string) => Promise<AuthUser>;
  getMfaSetupSecret: () => Promise<{ secretCode: string; otpauthUri: string }>;
  completeMfaSetup: (mfaCode: string) => Promise<AuthUser>;
  clearMfaState: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaState, setMfaState] = useState<MfaState | null>(null);
  // DEV DEMO BYPASS:
  // const DEV_BYPASS_AUTH = true;
  // const DEV_BYPASS_AUTH = false;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // DEV_BYPASS_AUTH block (uncomment for frontend-only demos):
      // if (DEV_BYPASS_AUTH) {
      //   setUser({ id: 'demo-user', email: 'demo@docupop.local', name: 'Demo User' });
      //   setLoading(false);
      //   return;
      // }
      const currentUser = await authService.loadCurrentUser();
      setUser(currentUser);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = async (email: string, password: string): Promise<SignInResult> => {
    const result = await authService.signIn(email, password);

    if (result.mfaRequired || result.mfaSetupRequired) {
      setMfaState({
        required: result.mfaRequired || false,
        setupRequired: result.mfaSetupRequired || false,
        session: result.session || '',
        email: result.email || email,
      });
      return result;
    }

    if (result.user) {
      setUser(result.user);
    }
    return result;
  };

  const verifyMfa = async (mfaCode: string): Promise<AuthUser> => {
    if (!mfaState) {
      throw new Error('No MFA session active');
    }

    const currentUser = await authService.verifyMfa(mfaState.session, mfaCode, mfaState.email);
    setUser(currentUser);
    setMfaState(null);
    return currentUser;
  };

  const getMfaSetupSecret = async (): Promise<{ secretCode: string; otpauthUri: string }> => {
    if (!mfaState) {
      throw new Error('No MFA session active');
    }

    const result = await authService.getMfaSetupSecret(mfaState.session);

    // Update MFA state with the new session and secret
    setMfaState({
      ...mfaState,
      session: result.session,
      secretCode: result.secretCode,
      otpauthUri: result.otpauthUri,
    });

    return {
      secretCode: result.secretCode,
      otpauthUri: result.otpauthUri,
    };
  };

  const completeMfaSetup = async (mfaCode: string): Promise<AuthUser> => {
    if (!mfaState) {
      throw new Error('No MFA session active');
    }

    const currentUser = await authService.completeMfaSetup(mfaState.session, mfaCode, mfaState.email);
    setUser(currentUser);
    setMfaState(null);
    return currentUser;
  };

  const clearMfaState = () => {
    setMfaState(null);
  };

  const signUp = async (email: string, password: string, name: string) => {
    const currentUser = await authService.signUp(email, password, name);
    setUser(currentUser);
    return currentUser;
  };

  const signOut = async () => {
    // DEV_BYPASS_AUTH block (uncomment for frontend-only demos):
    // if (DEV_BYPASS_AUTH) {
    //   setUser(null);
    //   setMfaState(null);
    //   return;
    // }
    await authService.signOut();
    setUser(null);
    setMfaState(null);
  };

  const value = {
    user,
    loading,
    mfaState,
    signIn,
    signUp,
    signOut,
    refresh,
    verifyMfa,
    getMfaSetupSecret,
    completeMfaSetup,
    clearMfaState,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
