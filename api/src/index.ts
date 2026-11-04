import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', cors())

app.get('/api/health', (c) => c.json({ status: 'ok' }))

type HomeRow = { id: string; name: string }
type MemberRow = { id: string; home_id: string; name: string; position: number }
type ShareRow = {
  id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

const error = (message: string) => ({ error: message })
const id = () => crypto.randomUUID()

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json()
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

app.post('/api/homes', async (c) => {
  const body = await jsonBody(c.req.raw)
  const name = stringValue(body?.name)
  if (!name) return c.json(error('name is required'), 422)
  const home = { id: id(), name }
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)')
    .bind(home.id, home.name)
    .run()
  return c.json(home, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) return c.json(error('home not found'), 404)
  const body = await jsonBody(c.req.raw)
  const name = stringValue(body?.name)
  if (!name) return c.json(error('name is required'), 422)
  const next = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM members WHERE home_id = ?',
  )
    .bind(homeId)
    .first<{ position: number }>()
  const member = { id: id(), homeId, name }
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name, position) VALUES (?, ?, ?, ?)')
    .bind(member.id, homeId, name, next?.position ?? 0)
    .run()
  return c.json(member, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) return c.json(error('home not found'), 404)
  const body = await jsonBody(c.req.raw)
  const title = stringValue(body?.title)
  const totalCents = body?.totalCents
  if (
    !title ||
    typeof totalCents !== 'number' ||
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0
  ) {
    return c.json(error('title and a positive whole totalCents are required'), 422)
  }
  const members = await c.env.DB.prepare(
    'SELECT id, home_id, name, position FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(homeId)
    .all<MemberRow>()
  if (members.results.length === 0) return c.json(error('home has no members'), 422)
  const bill = { id: id(), homeId, title, totalCents }
  const base = Math.floor(totalCents / members.results.length)
  const remainder = totalCents % members.results.length
  const shares = members.results.map((member, index) => ({
    id: id(),
    memberId: member.id,
    amountCents: base + (index < remainder ? 1 : 0),
    paidAt: null as null,
  }))
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(bill.id, homeId, title, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, bill.id, share.memberId, share.amountCents),
    ),
  ])
  return c.json({ ...bill, shares }, 201)
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')
  if (!key) return c.json(error('Idempotency-Key is required'), 400)
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<{ id: string }>()
  if (!bill) return c.json(error('bill not found'), 404)
  const share = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()
  if (!share) return c.json(error('share not found'), 404)
  if (share.paid_at) {
    if (share.idempotency_key === key)
      return c.json({
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      })
    return c.json(error('share already paid with a different key'), 409)
  }
  const paidAt = new Date().toISOString()
  const update = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, key, shareId, billId)
    .run()
  if (update.meta.changes === 0) {
    const current = await c.env.DB.prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
    )
      .bind(shareId, billId)
      .first<ShareRow>()
    if (current?.idempotency_key === key && current.paid_at)
      return c.json({
        id: current.id,
        memberId: current.member_id,
        amountCents: current.amount_cents,
        paidAt: current.paid_at,
      })
    return c.json(error('share already paid with a different key'), 409)
  }
  return c.json({
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt,
  })
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) return c.json(error('home not found'), 404)
  const balances = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name, COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0) AS outstandingCents
     FROM members m LEFT JOIN shares s ON s.member_id = m.id
     WHERE m.home_id = ? GROUP BY m.id, m.name, m.position ORDER BY m.position`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()
  return c.json({ balances: balances.results })
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) return c.json(error('home not found'), 404)
  const bills = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ? ORDER BY created_at, id',
  )
    .bind(homeId)
    .all<{ id: string; home_id: string; title: string; total_cents: number }>()
  const result = await Promise.all(
    bills.results.map(async (bill) => {
      const shares = await c.env.DB.prepare(
        'SELECT id, member_id, amount_cents, paid_at FROM shares WHERE bill_id = ? ORDER BY rowid',
      )
        .bind(bill.id)
        .all<Omit<ShareRow, 'idempotency_key'>>()
      return {
        id: bill.id,
        homeId: bill.home_id,
        title: bill.title,
        totalCents: bill.total_cents,
        shares: shares.results.map((share) => ({
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        })),
      }
    }),
  )
  return c.json({ bills: result })
})

export default app
