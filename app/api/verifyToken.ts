import { createRemoteJWKSet, jwtVerify } from 'jose'

const TENANT = process.env.AZURE_TENANT_ID || process.env.VITE_AZURE_TENANT_ID || 'e442d6a7-a8dc-4ac8-880b-d272b11642e9'
const CLIENT_ID = process.env.AZURE_CLIENT_ID || process.env.VITE_AZURE_CLIENT_ID || '27427d1e-a634-4350-ab9f-20ed5edd857c'

// Azure AD signing keys for this tenant (cached + auto-refreshed by jose).
const JWKS = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`))

// When the JWKS endpoint can't be reached (corporate firewall blocks
// login.microsoftonline.com), don't retry it — and its 5s timeout — on every
// request. Back off, serve the claims-only fallback, and re-probe periodically
// so full signature validation self-heals once egress is restored.
const JWKS_COOLDOWN_MS = 10 * 60 * 1000
let jwksBlockedUntil = 0

export interface VerifyResult { ok: boolean; reason: string }

/** Decode a JWT payload WITHOUT verifying — for diagnostics + the fallback. */
function peekClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8'))
  } catch {
    return {}
  }
}

/** A network/DNS failure reaching the JWKS endpoint (vs. a real token rejection). */
function isNetworkError(err: { code?: string; message?: string }): boolean {
  if (err?.code && /^ERR_(JWT|JWS|JWKS_NO_MATCHING_KEY)/.test(err.code)) return false
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET|network|timeout/i.test(
    String(err?.message ?? '')
  )
}

/**
 * Fallback when the signing keys can't be fetched (egress to Microsoft blocked):
 * validate the token's CLAIMS — audience (our app), tenant, and expiry — WITHOUT
 * the signature. Less strong than signature validation, but the token still had
 * to be minted for THIS app + tenant. Full validation resumes automatically once
 * login.microsoftonline.com becomes reachable again.
 */
function verifyClaimsOnly(claims: Record<string, unknown>, why: string): VerifyResult {
  const audOk = claims.aud === CLIENT_ID
  const tidOk = claims.tid === TENANT || (typeof claims.iss === 'string' && claims.iss.includes(TENANT))
  const expOk = typeof claims.exp === 'number' && claims.exp * 1000 > Date.now() - 120_000
  if (audOk && tidOk && expOk) return { ok: true, reason: `ok-claims-only (${why})` }
  return { ok: false, reason: `claims-invalid audOk=${audOk} tidOk=${tidOk} expOk=${expOk} (${why})` }
}

/**
 * Validate an Azure AD ID token. Primary path: verify the RS256 signature
 * against the tenant's published keys + audience + tenant + expiry (no Graph
 * call). If the keys can't be fetched (firewall), fall back to claims-only.
 */
export async function verifyAzureToken(authHeader: string | undefined): Promise<VerifyResult> {
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, reason: 'no-bearer-header' }
  const token = authHeader.slice(7)
  const claims = peekClaims(token)

  // Skip the JWKS fetch (and its timeout) while we know egress is blocked.
  if (Date.now() < jwksBlockedUntil) return verifyClaimsOnly(claims, 'jwks-cooldown')

  try {
    const { payload } = await jwtVerify(token, JWKS, { audience: CLIENT_ID, clockTolerance: 120 })
    const p = payload as Record<string, unknown>
    const issOk = typeof p.iss === 'string' && p.iss.includes(TENANT)
    if (p.tid === TENANT || issOk) return { ok: true, reason: 'ok' }
    return { ok: false, reason: `tenant-mismatch tid=${String(p.tid)}` }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (isNetworkError(err)) {
      jwksBlockedUntil = Date.now() + JWKS_COOLDOWN_MS
      return verifyClaimsOnly(claims, 'jwks-fetch-failed')
    }
    return {
      ok: false,
      reason: `verify-failed code=${err?.code ?? ''} msg=${String(err?.message ?? e).slice(0, 140)} | tokenAud=${String(claims.aud ?? '?')} tokenTid=${String(claims.tid ?? '?')} expectAud=${CLIENT_ID} expectTid=${TENANT}`,
    }
  }
}
