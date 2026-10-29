export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'hesapp' },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(options.body ?? {}),
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new ApiError(data.error ?? 'işlem tamamlanamadı', response.status)
  return data as T
}

export function errorMessage(error: unknown): string {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
    return 'cihaz doğrulaması iptal edildi ya da süresi doldu, yeniden deneyebilirsin'
  }
  if (error instanceof DOMException && error.name === 'InvalidStateError') {
    return 'bu cihazda bu hesap için zaten bir passkey kayıtlı'
  }
  return error instanceof Error ? error.message : 'beklenmeyen bir hata oluştu'
}
