/**
 * Cognito Authentication Service
 *
 * Handles user authentication with AWS Cognito for staging/production.
 * Uses existing custom auth system for local development.
 *
 * Security features:
 * - Environment-based auth selection
 * - Secure password hashing (handled by Cognito)
 * - No password storage in application database
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  GetUserCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  RespondToAuthChallengeCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
  ChallengeNameType,
} from '@aws-sdk/client-cognito-identity-provider';
import crypto from 'crypto';
import { config } from '../config';

// Cognito Client (only initialized if Cognito is enabled)
let cognitoClient: CognitoIdentityProviderClient | null = null;

if (config.cognito.enabled) {
  cognitoClient = new CognitoIdentityProviderClient({
    region: config.cognito.region,
  });
  console.log(`✅ Cognito client initialized for pool: ${config.cognito.userPoolId}`);
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface SignUpResult {
  user: AuthUser;
  confirmationRequired: boolean;
}

export interface SignInResult {
  user?: AuthUser;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  // MFA challenge fields
  challengeName?: string;
  session?: string;
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
}

/**
 * Sign up a new user
 */
export async function signUpUser(
  email: string,
  password: string,
  name: string
): Promise<SignUpResult> {
  if (!config.cognito.enabled || !cognitoClient) {
    throw new Error('Cognito authentication is not enabled');
  }

  if (!config.cognito.clientId) {
    throw new Error('Cognito client ID is not configured');
  }

  try {
    const result = await cognitoClient.send(
      new SignUpCommand({
        ClientId: config.cognito.clientId,
        Username: email.toLowerCase(),
        Password: password,
        UserAttributes: [
          {
            Name: 'email',
            Value: email.toLowerCase(),
          },
          {
            Name: 'name',
            Value: name,
          },
          {
            Name: 'preferred_username',
            Value: email.toLowerCase(),
          },
        ],
      })
    );

    // Generate a UUID for the user
    const userId = crypto.randomUUID();

    return {
      user: {
        id: userId,
        email: email.toLowerCase(),
        name,
      },
      confirmationRequired: !result.UserConfirmed,
    };
  } catch (error: any) {
    console.error('❌ Cognito sign up error:', error);

    // Map Cognito errors to user-friendly messages
    if (error.name === 'UsernameExistsException') {
      throw new Error('Email is already registered');
    }
    if (error.name === 'InvalidPasswordException') {
      throw new Error('Password does not meet requirements');
    }
    if (error.name === 'InvalidParameterException') {
      throw new Error('Invalid email or password format');
    }

    throw new Error(`Sign up failed: ${error.message}`);
  }
}

/**
 * Sign in a user - handles MFA challenges
 */
export async function signInUser(
  email: string,
  password: string
): Promise<SignInResult> {
  if (!config.cognito.enabled || !cognitoClient) {
    throw new Error('Cognito authentication is not enabled');
  }

  if (!config.cognito.clientId) {
    throw new Error('Cognito client ID is not configured');
  }

  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: config.cognito.clientId,
        AuthParameters: {
          USERNAME: email.toLowerCase(),
          PASSWORD: password,
        },
      })
    );

    // Check if MFA challenge is required
    if (result.ChallengeName) {
      console.log(`🔐 MFA Challenge required: ${result.ChallengeName}`);

      if (result.ChallengeName === ChallengeNameType.SOFTWARE_TOKEN_MFA) {
        // User has TOTP MFA set up - needs to enter code
        return {
          mfaRequired: true,
          challengeName: result.ChallengeName,
          session: result.Session,
        };
      }

      if (result.ChallengeName === ChallengeNameType.MFA_SETUP) {
        // User needs to set up MFA for the first time
        return {
          mfaSetupRequired: true,
          challengeName: result.ChallengeName,
          session: result.Session,
        };
      }

      // Unknown challenge type
      throw new Error(`Unsupported authentication challenge: ${result.ChallengeName}`);
    }

    // No MFA required - authentication complete
    if (!result.AuthenticationResult?.AccessToken) {
      throw new Error('Authentication failed - no access token received');
    }

    return await completeAuthentication(result.AuthenticationResult, email);
  } catch (error: any) {
    console.error('❌ Cognito sign in error:', error);

    if (error.name === 'NotAuthorizedException') {
      throw new Error('Invalid email or password');
    }
    if (error.name === 'UserNotFoundException') {
      throw new Error('Invalid email or password');
    }
    if (error.name === 'UserNotConfirmedException') {
      throw new Error('Email not confirmed. Please check your email.');
    }

    throw new Error(`Sign in failed: ${error.message}`);
  }
}

/**
 * Complete authentication after successful auth or MFA
 */
async function completeAuthentication(
  authResult: {
    AccessToken?: string;
    RefreshToken?: string;
    ExpiresIn?: number;
  },
  email: string
): Promise<SignInResult> {
  if (!cognitoClient || !authResult.AccessToken) {
    throw new Error('Authentication failed');
  }

  const accessToken = authResult.AccessToken;

  // Get user details
  const userDetails = await cognitoClient.send(
    new GetUserCommand({
      AccessToken: accessToken,
    })
  );

  const nameAttr = userDetails.UserAttributes?.find((attr) => attr.Name === 'name');
  const emailAttr = userDetails.UserAttributes?.find((attr) => attr.Name === 'email');
  const subAttr = userDetails.UserAttributes?.find((attr) => attr.Name === 'sub');

  return {
    user: {
      id: subAttr?.Value || crypto.randomUUID(),
      email: emailAttr?.Value || email.toLowerCase(),
      name: nameAttr?.Value || 'User',
    },
    accessToken,
    refreshToken: authResult.RefreshToken,
    expiresIn: authResult.ExpiresIn || 3600,
  };
}

/**
 * Verify MFA code and complete sign in
 */
export async function verifyMfaCode(
  session: string,
  mfaCode: string,
  email: string
): Promise<SignInResult> {
  if (!config.cognito.enabled || !cognitoClient) {
    throw new Error('Cognito authentication is not enabled');
  }

  if (!config.cognito.clientId) {
    throw new Error('Cognito client ID is not configured');
  }

  try {
    const result = await cognitoClient.send(
      new RespondToAuthChallengeCommand({
        ClientId: config.cognito.clientId,
        ChallengeName: ChallengeNameType.SOFTWARE_TOKEN_MFA,
        Session: session,
        ChallengeResponses: {
          USERNAME: email.toLowerCase(),
          SOFTWARE_TOKEN_MFA_CODE: mfaCode,
        },
      })
    );

    if (!result.AuthenticationResult?.AccessToken) {
      throw new Error('MFA verification failed');
    }

    console.log('✅ MFA verification successful');
    return await completeAuthentication(result.AuthenticationResult, email);
  } catch (error: any) {
    console.error('❌ MFA verification error:', error);

    if (error.name === 'CodeMismatchException') {
      throw new Error('Invalid MFA code');
    }
    if (error.name === 'ExpiredCodeException') {
      throw new Error('MFA code has expired. Please sign in again.');
    }

    throw new Error(`MFA verification failed: ${error.message}`);
  }
}

/**
 * Get TOTP secret for MFA setup
 */
export async function getMfaSetupSecret(session: string): Promise<{ secretCode: string; session: string }> {
  if (!config.cognito.enabled || !cognitoClient) {
    throw new Error('Cognito authentication is not enabled');
  }

  try {
    const result = await cognitoClient.send(
      new AssociateSoftwareTokenCommand({
        Session: session,
      })
    );

    if (!result.SecretCode) {
      throw new Error('Failed to get MFA setup secret');
    }

    console.log('✅ MFA setup secret generated');
    return {
      secretCode: result.SecretCode,
      session: result.Session || session,
    };
  } catch (error: any) {
    console.error('❌ MFA setup error:', error);
    throw new Error(`MFA setup failed: ${error.message}`);
  }
}

/**
 * Verify TOTP setup and complete MFA enrollment
 */
export async function verifyMfaSetup(
  session: string,
  mfaCode: string,
  email: string
): Promise<SignInResult> {
  if (!config.cognito.enabled || !cognitoClient) {
    throw new Error('Cognito authentication is not enabled');
  }

  if (!config.cognito.clientId) {
    throw new Error('Cognito client ID is not configured');
  }

  try {
    // First verify the TOTP code
    const verifyResult = await cognitoClient.send(
      new VerifySoftwareTokenCommand({
        Session: session,
        UserCode: mfaCode,
      })
    );

    if (verifyResult.Status !== 'SUCCESS') {
      throw new Error('MFA setup verification failed');
    }

    // Now respond to the MFA_SETUP challenge
    const challengeResult = await cognitoClient.send(
      new RespondToAuthChallengeCommand({
        ClientId: config.cognito.clientId,
        ChallengeName: ChallengeNameType.MFA_SETUP,
        Session: verifyResult.Session,
        ChallengeResponses: {
          USERNAME: email.toLowerCase(),
        },
      })
    );

    if (!challengeResult.AuthenticationResult?.AccessToken) {
      throw new Error('MFA setup completion failed');
    }

    console.log('✅ MFA setup completed successfully');
    return await completeAuthentication(challengeResult.AuthenticationResult, email);
  } catch (error: any) {
    console.error('❌ MFA setup verification error:', error);

    if (error.name === 'CodeMismatchException') {
      throw new Error('Invalid MFA code');
    }

    throw new Error(`MFA setup failed: ${error.message}`);
  }
}

/**
 * Verify an access token and get user details
 */
export async function verifyToken(accessToken: string): Promise<AuthUser | null> {
  if (!config.cognito.enabled || !cognitoClient) {
    return null;
  }

  try {
    const userDetails = await cognitoClient.send(
      new GetUserCommand({
        AccessToken: accessToken,
      })
    );

    const nameAttr = userDetails.UserAttributes?.find((attr) => attr.Name === 'name');
    const emailAttr = userDetails.UserAttributes?.find((attr) => attr.Name === 'email');
    const subAttr = userDetails.UserAttributes?.find((attr) => attr.Name === 'sub');

    return {
      id: subAttr?.Value || crypto.randomUUID(),
      email: emailAttr?.Value || '',
      name: nameAttr?.Value || 'User',
    };
  } catch (error) {
    console.error('❌ Token verification failed:', error);
    return null;
  }
}

/**
 * Confirm user signup with confirmation code
 */
export async function confirmSignUp(email: string, code: string): Promise<void> {
  if (!config.cognito.enabled || !cognitoClient) {
    throw new Error('Cognito authentication is not enabled');
  }

  if (!config.cognito.clientId) {
    throw new Error('Cognito client ID is not configured');
  }

  try {
    await cognitoClient.send(
      new ConfirmSignUpCommand({
        ClientId: config.cognito.clientId,
        Username: email.toLowerCase(),
        ConfirmationCode: code,
      })
    );
  } catch (error: any) {
    console.error('❌ Confirmation error:', error);

    if (error.name === 'CodeMismatchException') {
      throw new Error('Invalid confirmation code');
    }
    if (error.name === 'ExpiredCodeException') {
      throw new Error('Confirmation code has expired');
    }

    throw new Error(`Confirmation failed: ${error.message}`);
  }
}

/**
 * Initiate password reset - sends code to user's email
 */
export async function forgotPassword(email: string): Promise<void> {
  if (!config.cognito.enabled || !cognitoClient) {
    throw new Error('Cognito authentication is not enabled');
  }

  if (!config.cognito.clientId) {
    throw new Error('Cognito client ID is not configured');
  }

  try {
    await cognitoClient.send(
      new ForgotPasswordCommand({
        ClientId: config.cognito.clientId,
        Username: email.toLowerCase(),
      })
    );
    console.log(`✅ Password reset code sent to ${email}`);
  } catch (error: any) {
    console.error('❌ Forgot password error:', error);

    if (error.name === 'UserNotFoundException') {
      // Don't reveal if user exists - return success anyway
      console.log('User not found, but returning success for security');
      return;
    }
    if (error.name === 'LimitExceededException') {
      throw new Error('Too many attempts. Please try again later.');
    }

    throw new Error(`Password reset failed: ${error.message}`);
  }
}

/**
 * Confirm password reset with code and new password
 */
export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  if (!config.cognito.enabled || !cognitoClient) {
    throw new Error('Cognito authentication is not enabled');
  }

  if (!config.cognito.clientId) {
    throw new Error('Cognito client ID is not configured');
  }

  try {
    await cognitoClient.send(
      new ConfirmForgotPasswordCommand({
        ClientId: config.cognito.clientId,
        Username: email.toLowerCase(),
        ConfirmationCode: code,
        Password: newPassword,
      })
    );
    console.log(`✅ Password reset confirmed for ${email}`);
  } catch (error: any) {
    console.error('❌ Confirm forgot password error:', error);

    if (error.name === 'CodeMismatchException') {
      throw new Error('Invalid verification code');
    }
    if (error.name === 'ExpiredCodeException') {
      throw new Error('Verification code has expired');
    }
    if (error.name === 'InvalidPasswordException') {
      throw new Error('Password does not meet requirements');
    }

    throw new Error(`Password reset failed: ${error.message}`);
  }
}

export interface TokenRefreshResult {
  accessToken: string;
  idToken?: string;
  expiresIn: number;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshToken(refreshTokenValue: string): Promise<TokenRefreshResult> {
  if (!config.cognito.enabled || !cognitoClient) {
    throw new Error('Cognito authentication is not enabled');
  }

  if (!config.cognito.clientId) {
    throw new Error('Cognito client ID is not configured');
  }

  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: config.cognito.clientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshTokenValue,
        },
      })
    );

    if (!result.AuthenticationResult?.AccessToken) {
      throw new Error('Token refresh failed - no access token received');
    }

    console.log('✅ Token refreshed successfully');

    return {
      accessToken: result.AuthenticationResult.AccessToken,
      idToken: result.AuthenticationResult.IdToken,
      expiresIn: result.AuthenticationResult.ExpiresIn || 3600,
    };
  } catch (error: any) {
    console.error('❌ Token refresh error:', error);

    if (error.name === 'NotAuthorizedException') {
      throw new Error('Refresh token is invalid or expired. Please sign in again.');
    }

    throw new Error(`Token refresh failed: ${error.message}`);
  }
}
