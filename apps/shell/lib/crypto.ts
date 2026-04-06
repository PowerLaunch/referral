import { createHmac, timingSafeEqual } from 'crypto'

export function safeCompare(a: string, b: string): boolean {
  try {
    // HMAC both inputs with a fixed key so buffers are always equal length.
    // This prevents timing attacks that exploit early-return on length mismatch.
    const key = Buffer.alloc(32)
    const hmacA = createHmac('sha256', key).update(a).digest()
    const hmacB = createHmac('sha256', key).update(b).digest()
    return timingSafeEqual(hmacA, hmacB)
  } catch {
    return false
  }
}
