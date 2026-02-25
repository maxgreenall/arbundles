/**
 * AO DataItem signing using @dha-team/arbundles with InjectedEthereumSigner.
 * Uses MetaMask/injected wallet directly via ethers Web3Provider.
 */
import { InjectedEthereumSigner, createData } from '@dha-team/arbundles'
import { Web3Provider } from '@ethersproject/providers'
import { Buffer } from 'buffer'

let cachedSigner: InjectedEthereumSigner | null = null
let cachedAoAddress: string | null = null

/**
 * Get or create the InjectedEthereumSigner.
 * Calls setPublicKey() which prompts the user to sign once.
 */
export async function getOrCreateSigner(): Promise<InjectedEthereumSigner> {
  if (cachedSigner) return cachedSigner

  if (!window.ethereum) throw new Error('No wallet detected')

  const provider = new Web3Provider(window.ethereum as any)
  const signer = new InjectedEthereumSigner(provider)
  await signer.setPublicKey()

  cachedSigner = signer
  return signer
}

/**
 * Derive AO address from the signer's public key: SHA-256(pubkey) → base64url
 */
export async function deriveAOAddress(signer: InjectedEthereumSigner): Promise<string> {
  if (cachedAoAddress) return cachedAoAddress

  const pk = signer.publicKey
  const hash = await crypto.subtle.digest('SHA-256', pk)
  const b64 = Buffer.from(new Uint8Array(hash)).toString('base64')
  cachedAoAddress = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return cachedAoAddress
}

/**
 * Reset cached signer (call on disconnect).
 */
export function resetSigner() {
  cachedSigner = null
  cachedAoAddress = null
}

interface AODataItemOpts {
  target: string
  tags: { name: string; value: string }[]
  data?: string
  anchor?: string
}

/**
 * Create and sign a DataItem using arbundles.
 */
export async function createAndSignDataItem(
  opts: AODataItemOpts
): Promise<{ raw: Uint8Array; id: string }> {
  const signer = await getOrCreateSigner()

  const anchor = opts.anchor ||
    Math.round(Date.now() / 1000).toString().padStart(32, Math.floor(Math.random() * 10).toString())

  const dataItem = createData(opts.data || '', signer, {
    tags: opts.tags,
    target: opts.target,
    anchor,
  })

  await dataItem.sign(signer)

  return {
    id: dataItem.id,
    raw: dataItem.getRaw(),
  }
}
