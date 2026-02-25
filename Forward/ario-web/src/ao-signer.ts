/**
 * ANS-104 DataItem builder + signer for ECDSA/Ethereum wallets.
 * Signs via injected wallet (MetaMask etc.) using personal_sign.
 */
import { WalletClient } from 'viem'
import { Buffer } from 'buffer'

// ---- Tag Serialization (Avro-like, matches arbundles) ----

function serializeTags(tags: { name: string; value: string }[]): Uint8Array {
  const parts: number[] = []
  for (const tag of tags) {
    const nameBytes = new TextEncoder().encode(tag.name)
    const valueBytes = new TextEncoder().encode(tag.value)
    // name length (2 bytes LE) + name + value length (2 bytes LE) + value
    parts.push(nameBytes.length & 0xff, (nameBytes.length >> 8) & 0xff)
    parts.push(...nameBytes)
    parts.push(valueBytes.length & 0xff, (valueBytes.length >> 8) & 0xff)
    parts.push(...valueBytes)
  }
  return new Uint8Array(parts)
}

// ---- Deep Hash (matches arbundles) ----

async function sha384(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-384', data as ArrayBufferView<ArrayBuffer>)
  return new Uint8Array(hash)
}

async function deepHashChunk(data: Uint8Array, isChunk: boolean): Promise<Uint8Array> {
  if (isChunk) {
    const tag = new TextEncoder().encode('blob')
    const size = new TextEncoder().encode(String(data.byteLength))
    const tagHash = await sha384(tag)
    const sizeHash = await sha384(size)
    const dataHash = await sha384(data)
    const combined = new Uint8Array(tagHash.length + sizeHash.length + dataHash.length)
    combined.set(tagHash, 0)
    combined.set(sizeHash, tagHash.length)
    combined.set(dataHash, tagHash.length + sizeHash.length)
    return sha384(combined)
  }
  return data
}

async function deepHash(chunks: Uint8Array[]): Promise<Uint8Array> {
  const tag = new TextEncoder().encode('list')
  const size = new TextEncoder().encode(String(chunks.length))
  const tagHash = await sha384(tag)
  const sizeHash = await sha384(size)
  let acc = new Uint8Array(tagHash.length + sizeHash.length)
  acc.set(tagHash, 0)
  acc.set(sizeHash, tagHash.length)
  acc = await sha384(acc)

  for (const chunk of chunks) {
    const chunkHash = await deepHashChunk(chunk, true)
    const combined = new Uint8Array(acc.length + chunkHash.length)
    combined.set(acc, 0)
    combined.set(chunkHash, acc.length)
    acc = await sha384(combined)
  }
  return acc
}

// ---- Public key recovery ----

/**
 * Recover uncompressed public key from wallet by asking user to sign a known message.
 * Returns 65-byte uncompressed key (04 || x || y).
 */
export async function recoverPublicKey(walletClient: WalletClient): Promise<Uint8Array> {
  const account = walletClient.account
  if (!account) throw new Error('No account connected')

  const message = 'Sign this message to derive your AO address. This does not cost any gas.'

  const signature = await walletClient.signMessage({
    account,
    message,
  })

  // Use viem's recoverPublicKey
  const { recoverPublicKey: viemRecover } = await import('viem')
  const { hashMessage } = await import('viem')
  const hash = hashMessage(message)
  const pubKey = await viemRecover({ hash, signature })

  // pubKey is hex string of uncompressed key (with 04 prefix)
  const bytes = hexToBytes(pubKey)
  if (bytes.length !== 65) throw new Error(`Expected 65-byte public key, got ${bytes.length}`)
  return bytes
}

/**
 * Derive AO address from uncompressed public key: SHA-256(pubkey) → base64url
 */
export async function deriveAOAddress(publicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', publicKey as ArrayBufferView<ArrayBuffer>)
  return bufferToBase64Url(new Uint8Array(hash))
}

// ---- DataItem creation + signing ----

interface AODataItemOpts {
  target: string
  tags: { name: string; value: string }[]
  data?: string
  anchor?: string
}

/**
 * Create, sign, and return raw ANS-104 DataItem bytes.
 */
export async function createAndSignDataItem(
  walletClient: WalletClient,
  publicKey: Uint8Array,
  opts: AODataItemOpts
): Promise<{ raw: Uint8Array; id: string }> {
  const signatureType = 3 // ETHEREUM
  const targetBytes = base64UrlToBytes(opts.target)
  const anchorBytes = opts.anchor
    ? new TextEncoder().encode(opts.anchor.padStart(32, '0').slice(0, 32))
    : undefined
  const dataBytes = new TextEncoder().encode(opts.data || '')
  const serializedTags = serializeTags(opts.tags)

  // Deep hash message construction (matches arbundles)
  const messageChunks: Uint8Array[] = [
    new TextEncoder().encode('dataitem'),
    new TextEncoder().encode('1'),
    new TextEncoder().encode(String(signatureType)),
    publicKey,                        // 65 bytes owner
    targetBytes,                      // 32 bytes target
    anchorBytes || new Uint8Array(0), // 32 bytes anchor or empty
    serializedTags,
    dataBytes,
  ]

  const deepHashResult = await deepHash(messageChunks)

  // Sign the deep hash with the wallet
  const account = walletClient.account
  if (!account) throw new Error('No account connected')

  const signature = await walletClient.signMessage({
    account,
    message: { raw: deepHashResult },
  })

  // Parse signature: r (32) + s (32) + v (1) = 65 bytes
  const sigBytes = hexToBytes(signature)
  if (sigBytes.length !== 65) throw new Error(`Expected 65-byte signature, got ${sigBytes.length}`)

  // Build the raw DataItem binary (ANS-104 format)
  const raw = encodeDataItem(sigBytes, publicKey, targetBytes, anchorBytes, opts.tags, serializedTags, dataBytes)

  // ID = SHA-256(signature) → base64url
  const idHash = await crypto.subtle.digest('SHA-256', sigBytes as ArrayBufferView<ArrayBuffer>)
  const id = bufferToBase64Url(new Uint8Array(idHash))

  return { raw, id }
}

function encodeDataItem(
  signature: Uint8Array,
  owner: Uint8Array,
  target: Uint8Array,
  anchor: Uint8Array | undefined,
  tags: { name: string; value: string }[],
  serializedTags: Uint8Array,
  data: Uint8Array
): Uint8Array {
  const parts: number[] = []

  // 1. Signature type (2 bytes LE)
  parts.push(3, 0) // ETHEREUM = 3

  // 2. Signature (65 bytes)
  parts.push(...signature)

  // 3. Owner (65 bytes, NO presence byte for owner in ANS-104)
  parts.push(...owner)

  // 4. Target (1 presence byte + 32 bytes if present)
  if (target.length > 0) {
    parts.push(1) // present
    const padded = new Uint8Array(32)
    padded.set(target.slice(0, 32))
    parts.push(...padded)
  } else {
    parts.push(0)
  }

  // 5. Anchor (1 presence byte + 32 bytes if present)
  if (anchor && anchor.length > 0) {
    parts.push(1) // present
    const padded = new Uint8Array(32)
    padded.set(anchor.slice(0, 32))
    parts.push(...padded)
  } else {
    parts.push(0)
  }

  // 6. Number of tags (8 bytes LE)
  const tagCount = tags.length
  for (let i = 0; i < 8; i++) parts.push((tagCount >> (i * 8)) & 0xff)

  // 7. Tag bytes length (8 bytes LE)
  const tagBytesLen = serializedTags.length
  for (let i = 0; i < 8; i++) parts.push((tagBytesLen >> (i * 8)) & 0xff)

  // 8. Serialized tags
  parts.push(...serializedTags)

  // 9. Data
  parts.push(...data)

  return new Uint8Array(parts)
}

// ---- Utilities ----

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function bufferToBase64Url(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  return new Uint8Array(Buffer.from(b64, 'base64'))
}
