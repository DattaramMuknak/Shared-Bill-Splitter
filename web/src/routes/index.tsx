import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'

type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type Bill = { id: string; title: string; totalCents: number; shares: Share[] }
type ApiError = { error?: string }

const apiBases = import.meta.env.VITE_API_URL
  ? [import.meta.env.VITE_API_URL]
  : ['http://127.0.0.1:8787', 'http://127.0.0.1:8788']

async function fetchWithTimeout(path: string, init?: RequestInit) {
  for (const apiBase of apiBases) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5_000)
    try {
      return await fetch(`${apiBase}${path}`, { ...init, signal: controller.signal })
    } catch {
      // Try the next local API port. Vite increments its port when it is already in use.
    } finally {
      window.clearTimeout(timeout)
    }
  }
  throw new Error('The API is unavailable. Start the API with pnpm --filter bill-splitter-api dev.')
}

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [homeId, setHomeId] = useState('')
  const [bills, setBills] = useState<Bill[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState<string | null>(null)

  const loadBills = useCallback(async () => {
    if (!homeId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetchWithTimeout(
        `/api/homes/${encodeURIComponent(homeId.trim())}/bills`,
      )
      const data = (await response.json()) as { bills?: Bill[] } & ApiError
      if (!response.ok || !data.bills) throw new Error(data.error ?? 'Could not load bills.')
      setBills(data.bills)
    } catch (reason) {
      setBills(null)
      setError(reason instanceof Error ? reason.message : 'Could not load bills.')
    } finally {
      setLoading(false)
    }
  }, [homeId])

  async function pay(billId: string, shareId: string) {
    setPaying(shareId)
    setError(null)
    try {
      const response = await fetchWithTimeout(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
      const data = (await response.json()) as ApiError
      if (!response.ok) throw new Error(data.error ?? 'Payment failed.')
      await loadBills()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Payment failed. The share is still unpaid.',
      )
    } finally {
      setPaying(null)
    }
  }

  return (
    <main
      style={{ margin: '0 auto', maxWidth: 760, padding: 24, fontFamily: 'system-ui, sans-serif' }}
    >
      <h1>Shared Bill Splitter</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void loadBills()
        }}
      >
        <label htmlFor="home-id">Home ID</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input
            id="home-id"
            value={homeId}
            onChange={(event) => setHomeId(event.target.value)}
            placeholder="Paste a home ID"
            style={{ flex: 1, padding: 8 }}
          />
          <button disabled={loading || !homeId.trim()} type="submit">
            {loading ? 'Loading…' : 'Load bills'}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      {loading && <p role="status">Loading bills…</p>}
      {bills?.length === 0 && <p>No bills for this home yet.</p>}
      {bills?.map((bill) => (
        <section
          key={bill.id}
          style={{ border: '1px solid #ddd', borderRadius: 8, marginTop: 20, padding: 16 }}
        >
          <h2>
            {bill.title} — ${(bill.totalCents / 100).toFixed(2)}
          </h2>
          <ul>
            {bill.shares.map((share) => (
              <li key={share.id} style={{ margin: '10px 0' }}>
                Member {share.memberId}: ${(share.amountCents / 100).toFixed(2)} —{' '}
                {share.paidAt ? (
                  `Paid ${new Date(share.paidAt).toLocaleString()}`
                ) : (
                  <button
                    disabled={paying === share.id}
                    onClick={() => void pay(bill.id, share.id)}
                    type="button"
                  >
                    {paying === share.id ? 'Paying…' : 'Pay share'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
