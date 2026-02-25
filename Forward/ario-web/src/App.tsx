import { useState, useEffect } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config, ARIO_PROCESS } from './config'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { getOrCreateSigner, deriveAOAddress, createAndSignDataItem, resetSigner } from './ao-signer'
import { getArioBalance, sendToMU, formatArioBalance } from './ao-utils'
import './App.css'

const queryClient = new QueryClient()

function WalletApp() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()

  const [aoAddress, setAoAddress] = useState<string>('')
  const [balance, setBalance] = useState<string>('0')
  const [loading, setLoading] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [txId, setTxId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch balance when connected
  useEffect(() => {
    if (!address) return
    let cancelled = false
    setLoading(true)
    getArioBalance(address)
      .then((b) => { if (!cancelled) setBalance(b) })
      .catch((err) => { if (!cancelled) setError('Balance fetch failed: ' + err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [address])

  const handleSend = async () => {
    if (!sendTo || !sendAmount) {
      setError('Please fill in recipient and amount')
      return
    }

    setSending(true)
    setError(null)
    setTxId(null)

    try {
      // Get signer (prompts user to sign once to derive public key)
      const signer = await getOrCreateSigner()

      // Show AO address if not yet shown
      if (!aoAddress) {
        const addr = await deriveAOAddress(signer)
        setAoAddress(addr)
      }

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

      const { raw, id } = await createAndSignDataItem({
        target: ARIO_PROCESS,
        tags,
        data: '',
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
          <button onClick={() => { disconnect(); resetSigner(); setAoAddress('') }} className="btn btn-sm">
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
      </div>

      {address && (
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
                placeholder="Address..."
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
