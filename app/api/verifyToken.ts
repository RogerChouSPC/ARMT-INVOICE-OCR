import { createRemoteJWKSet, jwtVerify } from 'jose'

const TENANT = process.env.AZURE_TENANT_ID || process.env.VITE_AZURE_TENANT_ID || 'e442d6a7-a8dc-4ac8-880b-d272b11642e9'
const CLIENT_ID = process.env.AZURE_CLIENT_ID || process.env.VITE_AZURE_CLIENT_ID || '27427d1e-a634-4350-ab9f-20ed5edd857c'

// Azure AD signing keys for this tenant (cached + auto-refreshed by jose).
const JWKS = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`))

/** Decode a JWT payload WITHOUT verifying — for diagnostics only. */
function peekClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8'))
  } catch {
    return {}
  }
}

export interface VerifyResult { ok: boolean; reason: string }

/**
 * Validate an Azure AD ID token locally: verifies the RS256 signature against
 * the tenant's published keys, the audience (our app), the tenant, and expiry.
 * No call to Microsoft Graph — robust to Conditional Access / token protection.
 * Returns a `reason` string so a 401 can explain WHY (diagnostics).
 */
export async function verifyAzureToken(authHeader: string | undefined): Promise<VerifyResult> {
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, reason: 'no-bearer-header' }
  const token = authHeader.slice(7)
  const claims = peekClaims(token)
  const audSeen = String(claims.aud ?? '?')
  const tidSeen = String(claims.tid ?? '?')
  try {
    const { payload } = await jwtVerify(token, JWKS, { audience: CLIENT_ID })
    const p = payload as Record<string, unknown>
    const issOk = typeof p.iss === 'string' && p.iss.includes(TENANT)
    if (p.tid === TENANT || issOk) return { ok: true, reason: 'ok' }
    return { ok: false, reason: `tenant-mismatch tid=${String(p.tid)}` }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return {
      ok: false,
      reason: `verify-failed code=${err?.code ?? ''} msg=${String(err?.message ?? e).slice(0, 140)} | tokenAud=${audSeen} tokenTid=${tidSeen} expectAud=${CLIENT_ID} expectTid=${TENANT}`,
    }
  }
}
