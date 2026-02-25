import { useState, useEffect } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config, ARIO_PROCESS } from './config'
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi'
import { recoverPublicKey, deriveAOAddress, createAndSignDataItem } from './ao-signer'
import { getArioBalance, sendToMU, formatArioBalance } from './ao-utils'
import './App.css'

const queryClient = new QueryClient()

function WalletApp() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: walletClient } = useWalletClient()

  const [publicKey, setPublicKey] = useState<Uint8Array | null>(null)
  const [aoAddress, setAoAddress] = useState<string>('')
  const [balance, setBalance] = useState<string>('0')
  const [loading, setLoading] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [txId, setTxId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signingKey, setSigningKey] = useState(false)

  // Recover public key after wallet connect
  useEffect(() => {
    if (walletClient && isConnected && !publicKey && !signingKey) {
      setSigningKey(true)
      recoverPublicKey(walletClient)
        .then(async (pk) => {
          setPublicKey(pk)
          const addr = await deriveAOAddress(pk)
          setAoAddress(addr)
        })
        .catch((err) => {
          setError('Failed to recover public key: ' + err.message)
        })
        .finally(() => setSigningKey(false))
    }
  }, [walletClient, isConnected, publicKey, signingKey])

  // Fetch balance when connected
  useEffect(() => {
    if (address) {
      setLoading(true)
      getArioBalance(address)
        .then(setBalance)
        .catch((err) => setError('Balance fetch failed: ' + err.message))
        .finally(() => setLoading(false))
    }
  }, [address])

  const handleSend = async () => {
    if (!walletClient || !publicKey || !sendTo || !sendAmount) return

    setSending(true)
    setError(null)
    setTxId(null)

    try {
      // Convert display amount to mARIO
      const parts = sendAmount.split('.')
      let mario: string
      if (parts.length === 2) {
        const frac = parts[1].padEnd(6, '0').slice(0, 6)
        mario = (BigInt(parts[0]) * 1000000n + BigInt(frac)).toString()
      } else {
        mario = (BigInt(parts[0]) * 1000000n).toString()
      }

      const tags = [
        { name: 'Data-Protocol', value: 'ao' },
        { name: 'Variant', value: 'ao.TN.1' },
        { name: 'Type', value: 'Message' },
        { name: 'Action', value: 'Transfer' },
        { name: 'Recipient', value: sendTo },
        { name: 'Quantity', value: mario },
      ]

      const anchor = Math.round(Date.now() / 1000).toString().padStart(32, '0')

      const { raw, id } = await createAndSignDataItem(walletClient, publicKey, {
        target: ARIO_PROCESS,
        tags,
        data: '',
        anchor,
      })

      const result = await sendToMU(raw)
      setTxId(result.id || id)

      // Refresh balance after a delay
      setTimeout(async () => {
        try {
          if (address) {
            const newBalance = await getArioBalance(address)
            setBalance(newBalance)
          }
        } catch {}
      }, 5000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const refreshBalance = async () => {
    if (!address) return
    setLoading(true)
    try {
      const b = await getArioBalance(address)
      setBalance(b)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="container">
        <h1>ARIO Wallet</h1>
        <p className="subtitle">Send ARIO tokens from your EVM wallet</p>
        <div className="connect-buttons">
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              onClick={() => connect({ connector })}
              className="btn btn-primary"
            >
              Connect {connector.name}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <h1>ARIO Wallet</h1>

      <div className="card">
        <div className="card-header">
          <h3>Connected</h3>
          <button onClick={() => { disconnect(); setPublicKey(null); setAoAddress('') }} className="btn btn-sm">
            Disconnect
          </button>
        </div>

        <div className="info-row">
          <span className="label">ETH Address</span>
          <span className="value mono">{address}</span>
        </div>

        {aoAddress && (
          <div className="info-row">
            <span className="label">AO Address</span>
            <span className="value mono">{aoAddress}</span>
          </div>
        )}

        {signingKey && (
          <p className="muted">Sign the message in your wallet to derive your AO address...</p>
        )}
      </div>

      {aoAddress && (
        <>
          <div className="card balance-card">
            <div className="balance-header">
              <h3>ARIO Balance</h3>
              <button onClick={refreshBalance} className="btn btn-sm" disabled={loading}>
                {loading ? '⏳' : '🔄'}
              </button>
            </div>
            <div className="balance-amount">
              {loading ? '...' : formatArioBalance(balance)}
              <span className="ticker">ARIO</span>
            </div>
          </div>

          <div className="card">
            <h3>Send ARIO</h3>

            <div className="form-group">
              <label>Recipient (AO Address)</label>
              <input
                type="text"
                placeholder="Base64url address..."
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                className="input"
              />
            </div>

            <div className="form-group">
              <label>Amount</label>
              <input
                type="text"
                placeholder="0.00"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                className="input"
              />
            </div>

            <button
              onClick={handleSend}
              disabled={sending || !sendTo || !sendAmount}
              className="btn btn-primary btn-full"
            >
              {sending ? 'Signing & Sending...' : 'Send ARIO'}
            </button>

            {txId && (
              <div className="success">
                ✅ Sent! TX: <a href={`https://ao.link/#/message/${txId}`} target="_blank" rel="noreferrer" className="mono">{txId}</a>
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="error">
          ❌ {error}
          <button onClick={() => setError(null)} className="btn btn-sm dismiss">✕</button>
        </div>
      )}
    </div>
  )
}

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <WalletApp />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
