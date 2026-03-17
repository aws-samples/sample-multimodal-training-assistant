'use client';

import { useState, useEffect } from 'react';
import { Amplify } from 'aws-amplify';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { fetchAuthSession } from 'aws-amplify/auth';
import '@aws-amplify/ui-react/styles.css';

// Read Cognito config from build-time env vars
const cognitoConfig = {
  region: process.env.NEXT_PUBLIC_COGNITO_REGION || 'us-west-2',
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '',
  userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID || '',
  identityPoolId: process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID || '',
};

// Configure Amplify synchronously at module level — no async fetch needed
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: cognitoConfig.userPoolId,
      userPoolClientId: cognitoConfig.userPoolClientId,
      identityPoolId: cognitoConfig.identityPoolId,
      loginWith: {
        email: true,
      },
      signUpVerificationMethod: 'code',
      userAttributes: {
        email: {
          required: true,
        },
      },
      allowGuestAccess: false,
      passwordFormat: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: false,
      },
    },
  },
});

// Hook to get access token for API calls
export function useAuthToken() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);

  useEffect(() => {
    async function getToken() {
      if (authStatus !== 'authenticated') {
        setIsLoading(false);
        return;
      }

      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.accessToken;
        if (!token) { setAccessToken(null); return; }

        // If token expires within 5 minutes, force Cognito to issue a fresh one
        const expMs = (token.payload.exp ?? 0) * 1000;
        const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
        if (expMs < fiveMinFromNow) {
          const fresh = await fetchAuthSession({ forceRefresh: true });
          setAccessToken(fresh.tokens?.accessToken?.toString() ?? null);
        } else {
          setAccessToken(token.toString());
        }
      } catch (err) {
        console.error('Failed to get auth token:', err);
        setAccessToken(null);
      } finally {
        setIsLoading(false);
      }
    }

    getToken();

    // Check token freshness every minute — force-refresh only when near expiry
    const interval = setInterval(getToken, 60 * 1000);
    return () => clearInterval(interval);
  }, [authStatus]);

  return { accessToken, isLoading };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <Authenticator>
      {children}
    </Authenticator>
  );
}
