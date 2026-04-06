/**
 * Unified Authentication Service
 *
 * Provides a single interface for authentication that automatically selects:
 * - Custom auth (local development)
 * - Cognito auth (staging/production)
 *
 * This allows seamless switching between environments without code changes.
 */

import { config } from '../config';
import * as cognitoAuth from './cognito-auth';
import {
  createUser as createCustomUser,
  verifyCredentials as verifyCustomCredentials,
  getUserById as getCustomUserById,
} from '../../server/data-store';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthResult {
  user?: AuthUser;
  token?: string;
  // MFA challenge fields
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  session?: string;
  challengeName?: string;
}

/**
 * Sign up a new user
 */
export async function signUp(
  email: string,
  password: string,
  name: string
): Promise<AuthResult> {
  if (config.cognito.enabled) {
    // Use Cognito for staging/production
    console.log('🔐 Using Cognito authentication for sign up');
    const result = await cognitoAuth.signUpUser(email, password, name);

    return {
      user: result.user,
      token: undefined, // Session handled differently for Cognito
    };
  } else {
    // Use custom auth for local development
    console.log('🔐 Using custom authentication for sign up');
    const user = await createCustomUser({ email, password, name });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }
}

/**
 * Sign in a user - handles MFA challenges for Cognito
 */
export async function signIn(
  email: string,
  password: string
): Promise<AuthResult> {
  if (config.cognito.enabled) {
    // Use Cognito for staging/production
    console.log('🔐 Using Cognito authentication for sign in');
    const result = await cognitoAuth.signInUser(email, password);

    // Check if MFA challenge is required
    if (result.mfaRequired || result.mfaSetupRequired) {
      return {
        mfaRequired: result.mfaRequired,
        mfaSetupRequired: result.mfaSetupRequired,
        session: result.session,
        challengeName: result.challengeName,
      };
    }

    return {
      user: result.user,
      token: result.accessToken,
    };
  } else {
    // Use custom auth for local development
    console.log('🔐 Using custom authentication for sign in');
    const user = await verifyCustomCredentials(email, password);

    if (!user) {
      throw new Error('Invalid email or password');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }
}

/**
 * Verify MFA code and complete sign in
 * Only available when Cognito is enabled
 */
export async function verifyMfa(
  session: string,
  mfaCode: string,
  email: string
): Promise<AuthResult> {
  if (!config.cognito.enabled) {
    throw new Error('MFA is not available in local development mode');
  }

  const result = await cognitoAuth.verifyMfaCode(session, mfaCode, email);

  return {
    user: result.user,
    token: result.accessToken,
  };
}

/**
 * Get TOTP secret for MFA setup
 * Only available when Cognito is enabled
 */
export async function getMfaSecret(session: string): Promise<{ secretCode: string; session: string }> {
  if (!config.cognito.enabled) {
    throw new Error('MFA is not available in local development mode');
  }

  return await cognitoAuth.getMfaSetupSecret(session);
}

/**
 * Verify TOTP setup and complete MFA enrollment
 * Only available when Cognito is enabled
 */
export async function completeMfaSetup(
  session: string,
  mfaCode: string,
  email: string
): Promise<AuthResult> {
  if (!config.cognito.enabled) {
    throw new Error('MFA is not available in local development mode');
  }

  const result = await cognitoAuth.verifyMfaSetup(session, mfaCode, email);

  return {
    user: result.user,
    token: result.accessToken,
  };
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  if (config.cognito.enabled) {
    // For Cognito, we can't get user by ID directly
    // User info should be cached or fetched from database
    // This is a simplified version
    return null;
  } else {
    // Use custom auth
    const user = await getCustomUserById(userId);

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }
}

/**
 * Verify token (for Cognito) or session
 */
export async function verifyAuth(
  tokenOrSessionId?: string
): Promise<AuthUser | null> {
  if (config.cognito.enabled && tokenOrSessionId) {
    // Verify Cognito token
    return cognitoAuth.verifyToken(tokenOrSessionId);
  } else if (tokenOrSessionId) {
    // For custom auth, get user by session/ID
    return getUserById(tokenOrSessionId);
  }

  return null;
}

/**
 * Get authentication status
 */
export function getAuthStatus(): {
  provider: 'cognito' | 'custom';
  enabled: boolean;
} {
  return {
    provider: config.cognito.enabled ? 'cognito' : 'custom',
    enabled: true,
  };
}

/**
 * Initiate password reset - sends code to user's email
 * Only available when Cognito is enabled
 */
export async function forgotPassword(email: string): Promise<void> {
  if (config.cognito.enabled) {
    await cognitoAuth.forgotPassword(email);
  } else {
    // For local development, just log and return success
    console.log(`🔐 [Local] Password reset requested for ${email} - not implemented for local auth`);
    throw new Error('Password reset is not available in local development mode');
  }
}

/**
 * Confirm password reset with code and new password
 * Only available when Cognito is enabled
 */
export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  if (config.cognito.enabled) {
    await cognitoAuth.confirmForgotPassword(email, code, newPassword);
  } else {
    throw new Error('Password reset is not available in local development mode');
  }
}

export interface TokenRefreshResult {
  accessToken: string;
  expiresIn: number;
}

/**
 * Refresh access token using refresh token
 * Only available when Cognito is enabled
 */
export async function refreshToken(refreshTokenValue: string): Promise<TokenRefreshResult> {
  if (config.cognito.enabled) {
    const result = await cognitoAuth.refreshToken(refreshTokenValue);
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  } else {
    throw new Error('Token refresh is not available in local development mode');
  }
}