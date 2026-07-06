import { createRemoteJWKSet, jwtVerify } from 'jose'

const TENANT = process.env.AZURE_TENANT_ID || process.env.VITE_AZURE_TENANT_ID || 'e442d6a7-a8dc-4ac8-880b-d272b11642e9'
const CLIENT_ID = process.env.AZURE_CLIENT_ID || process.env.VITE_AZURE_CLIENT_ID || '27427d1e-a634-4350-ab9f-20ed5edd857c'

// Azure AD signing keys for this tenant (cached + auto-refreshed by jose).
const JWKS = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`))

/**
 * Validate an Azure AD ID token locally: verifies the RS256 signature against
 * the tenant's published keys, the audience (our app), the tenant, and expiry.
 * No call to Microsoft Graph — robust to Conditional Access / token protection.
 */
export async function verifyAzureToken(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)
  try {
    // Verify signature + expiry + audience. Issuer format can be v1.0
    // (sts.windows.net) or v2.0 (login.microsoftonline.com/.../v2.0), so check
    // the tenant via the `tid` claim instead of pinning an exact issuer string.
    const { payload } = await jwtVerify(token, JWKS, { audience: CLIENT_ID })
    const p = payload as Record<string, unknown>
    const tid = p.tid
    const issOk = typeof p.iss === 'string' && p.iss.includes(TENANT)
    return (tid === TENANT || issOk)
  } catch {
    return false
  }
}
