/**
 * AO protocol utilities: query balance, send transfers via MU/CU.
 */
import { ARIO_PROCESS, MU_URL, CU_URL } from './config'

// Deduplicate concurrent balance requests for the same address
const pendingBalanceFetches = new Map<string, Promise<string>>()

/**
 * Query ARIO balance for an address via the CU (dry-run).
 * Deduplicates concurrent requests and retries on 429.
 */
export async function getArioBalance(address: string): Promise<string> {
  const existing = pendingBalanceFetches.get(address)
  if (existing) return existing

  const promise = _fetchBalance(address).finally(() => {
    pendingBalanceFetches.delete(address)
  })
  pendingBalanceFetches.set(address, promise)
  return promise
}

async function _fetchBalance(address: string, retries = 3): Promise<string> {
  const tags = [
    { name: 'Action', value: 'Balance' },
    { name: 'Recipient', value: address },
    { name: 'Data-Protocol', value: 'ao' },
    { name: 'Type', value: 'Message' },
    { name: 'Variant', value: 'ao.TN.1' },
  ]

  const body = {
    Id: '0000000000000000000000000000000000000000001',
    Target: ARIO_PROCESS,
    Owner: address,
    Anchor: '0',
    Data: '',
    Tags: tags.map(t => ({ name: t.name, value: t.value })),
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${CU_URL}/dry-run?process-id=${ARIO_PROCESS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.status === 429 && attempt < retries) {
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)))
      continue
    }

    if (!res.ok) {
      throw new Error(`CU dry-run failed: ${res.status}`)
    }

    const result = await res.json()

    if (result.Messages && result.Messages.length > 0) {
      const msg = result.Messages[0]
      if (msg.Data) return msg.Data
      const balTag = msg.Tags?.find((t: any) => t.name === 'Balance')
      if (balTag) return balTag.value
    }

    return '0'
  }

  throw new Error('CU dry-run rate limited after retries')
}

/**
 * Send a signed data item to the MU.
 */
export async function sendToMU(raw: Uint8Array): Promise<{ id: string; status: number }> {
  const res = await fetch(MU_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Accept': 'application/json',
    },
    body: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  })

  const text = await res.text()
  let json: any = {}
  try {
    json = JSON.parse(text)
  } catch {}

  if (!res.ok) {
    throw new Error(json.error || `MU error ${res.status}: ${text}`)
  }

  return { id: json.id, status: res.status }
}

/**
 * Format ARIO amount from mARIO (integer string) to display value.
 * ARIO has 6 decimal places (mARIO).
 */
export function formatArioBalance(mario: string): string {
  const n = BigInt(mario)
  const whole = n / 1000000n
  const frac = n % 1000000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '')
  if (fracStr.length === 0) return whole.toString()
  return `${whole}.${fracStr}`
}
