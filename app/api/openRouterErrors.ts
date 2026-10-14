export interface OpenRouterFailure {
  status: number
  error: string
  retryable: boolean
}

export function openRouterHttpFailure(
  operation: 'OCR' | 'Extraction',
  upstreamStatus: number,
): OpenRouterFailure {
  if (upstreamStatus === 429) {
    return {
      status: 429,
      error: 'API quota exceeded. Please try again shortly.',
      retryable: true,
    }
  }
  if (upstreamStatus >= 500 && upstreamStatus <= 599) {
    return {
      status: 502,
      error: `${operation} service is temporarily unavailable. Please try again.`,
      retryable: true,
    }
  }
  return {
    status: 502,
    error: `${operation} service rejected the request. Please contact support.`,
    retryable: false,
  }
}

export function openRouterNetworkFailure(
  operation: 'OCR' | 'Extraction',
): OpenRouterFailure {
  return {
    status: 502,
    error: `${operation} service could not be reached. Please try again.`,
    retryable: true,
  }
}
