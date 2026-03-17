/**
 * Auth setup: get Cognito tokens via InitiateAuth API and inject into
 * browser localStorage so Amplify picks them up. Runs once before all tests.
 */
import { test as setup } from '@playwright/test';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const REGION = process.env.NEXT_PUBLIC_COGNITO_REGION!;
const USER_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!;
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID!;
const TEST_EMAIL = process.env.E2E_TEST_EMAIL!;
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD!;

if (!REGION || !USER_POOL_ID || !CLIENT_ID || !TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error(
    'Missing required env vars for e2e auth. Set: NEXT_PUBLIC_COGNITO_REGION, ' +
    'NEXT_PUBLIC_COGNITO_USER_POOL_ID, NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID, ' +
    'E2E_TEST_EMAIL, E2E_TEST_PASSWORD'
  );
}

setup('authenticate via Cognito API', async ({ page }) => {
  // 1. Get tokens from Cognito
  const cognito = new CognitoIdentityProviderClient({ region: REGION });
  const auth = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: TEST_EMAIL, PASSWORD: TEST_PASSWORD },
  }));

  const idToken = auth.AuthenticationResult!.IdToken!;
  const accessToken = auth.AuthenticationResult!.AccessToken!;
  const refreshToken = auth.AuthenticationResult!.RefreshToken!;
  const clockDrift = '0';

  // 2. Navigate to app so we can set localStorage on the right origin
  await page.goto('/');

  // 3. Inject tokens into localStorage in Amplify v6 format
  const lastAuthUser = TEST_EMAIL;
  const keyPrefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;

  await page.evaluate(({ keyPrefix, lastAuthUser, idToken, accessToken, refreshToken, clockDrift }) => {
    localStorage.setItem(`${keyPrefix}.LastAuthUser`, lastAuthUser);
    localStorage.setItem(`${keyPrefix}.${lastAuthUser}.idToken`, idToken);
    localStorage.setItem(`${keyPrefix}.${lastAuthUser}.accessToken`, accessToken);
    localStorage.setItem(`${keyPrefix}.${lastAuthUser}.refreshToken`, refreshToken);
    localStorage.setItem(`${keyPrefix}.${lastAuthUser}.clockDrift`, clockDrift);
  }, { keyPrefix, lastAuthUser, idToken, accessToken, refreshToken, clockDrift });

  // 4. Reload so Amplify reads the tokens
  await page.reload();
  await page.waitForTimeout(2000);

  // 5. Save browser state for other tests to reuse
  await page.context().storageState({ path: './e2e/.auth/session.json' });
});
