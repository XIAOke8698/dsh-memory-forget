import type {
  AmnesiaConfig,
  AuditEntry,
  ForgetReason,
  MemoryItem,
  MemoryView,
  PlugInput,
  SelectionResult,
  StoreAdapter,
  UnplugFilter,
} from './types.js'
import { itemTokens, referenceOf, settleItem } from './decay.js'
import { buildAuditEntry, hashText } from './audit.js'

const DEFAULT_CONFIG: AmnesiaConfig = {
  defaultTtlMs: 30 * 24 * 60 * 60 * 1000,
  staleStrength: 0.3,
  forgottenStrength: 0.05,
  maxItemBytes: 2048,
  maxStoreBytes: 256 * 1024,
  maxInjectedTokens: 2000,
  restorable: false,
  promoteAfterAccesses: 0,
}

const AUDIT_CAP = 500

/**
 * The memory bus: memories are pluggable units with a shelf life.
 *
 * - `plug` = remember (with TTL), `unplug` = forget (physical delete + audit)
 * - `touch`/`recall` = accessing renews the decay clock (use it or lose it)
 * - `restore` = plug a forgotten memory back in (restorable mode only)
 * - `selectForInjection` = budgeted, deterministic injection selection;
 *   dead (stale/forgotten) memories are never selected.
 *
 * Zero dependencies; the DSH host plugin, CLI, and skill adapters share it.
 */
export class AmnesiaEngine {
  private readonly config: AmnesiaConfig
  private readonly adapter: StoreAdapter | undefined
  private readonly items = new Map<string, MemoryItem>()
  private audit: AuditEntry[] = []
  private loaded = false
  private loadPromise: Promise<void> | undefined

  constructor(config: Partial<AmnesiaConfig> = {}, adapter?: StoreAdapter) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.adapter = adapter
  }

  /** Resolves once the store has been loaded (no-op without an adapter). */
  get ready(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    this.loadPromise ??= this.load()
    return this.loadPromise
  }

  private async load(): Promise<void> {
    if (this.adapter) {
      try {
        const data = await this.adapter.load()
        if (data) {
          for (const item of data.items) this.items.set(item.id, item)
          this.audit = data.audit.slice(-AUDIT_CAP)
        }
      } catch {
        // best-effort: start empty
      }
    }
    this.loaded = true
  }

  private persist(): void {
    if (!this.adapter || !this.loaded) return
    void this.adapter.persist([...this.items.values()], this.audit.slice(-AUDIT_CAP)).catch(() => {})
  }

  private newId(): string {
    return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  private viewOf(item: MemoryItem): MemoryView {
    return {
      id: item.id,
      content: item.content,
      kind: item.kind,
      scope: item.scope,
      ttlMs: item.ttl,
      expiresAt: item.ttl === null ? null : referenceOf(item) + item.ttl,
      pinned: item.pinned,
      accessCount: item.accessCount,
      strength: Math.round(item.strength * 100) / 100,
      status: item.status,
      tags: item.tags,
    }
  }

  private recordForget(item: MemoryItem, reason: ForgetReason, at: number): void {
    this.audit.push(buildAuditEntry(item, reason, at, this.config.restorable))
    if (this.audit.length > AUDIT_CAP) this.audit = this.audit.slice(-AUDIT_CAP)
  }

  /** Insert one memory (remember). Validates TTL, budget, and scope. */
  plug(input: PlugInput, ownerId = 'default'): MemoryView {
    if (typeof input.content !== 'string' || input.content.length === 0) {
      throw new Error('amnesia plug: content must be a non-empty string')
    }
    if (input.content.length > this.config.maxItemBytes) {
      throw new Error(`amnesia plug: content exceeds maxItemBytes (${this.config.maxItemBytes})`)
    }
    const pinned = input.pin === true
    let ttl: number | null
    if (pinned) {
      ttl = null
    } else {
      const ttlArg = input.ttlMs !== undefined && input.ttlMs !== null ? input.ttlMs : input.ttl
      const value = ttlArg !== undefined && ttlArg !== null ? Number(ttlArg) : this.config.defaultTtlMs
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('amnesia plug: ttlMs must be a positive number')
      }
      ttl = value
    }
    const t = Date.now()
    const scope = input.scope === 'team' ? 'team' : input.scope === 'session' ? 'session' : 'workspace'
    const item: MemoryItem = {
      id: this.newId(),
      scope,
      workspaceId: 'ws-default',
      ownerId,
      kind: typeof input.kind === 'string' ? input.kind : 'fact',
      content: input.content,
      source: 'tool',
      createdAt: t,
      lastAccessedAt: t,
      accessCount: 0,
      ttl,
      pinned,
      curve: input.curve === 'linear' || input.curve === 'flat' ? input.curve : 'ebbinghaus',
      baseStrength: 1,
      strength: 1,
      status: 'active',
      tags: Array.isArray(input.tags) ? input.tags.filter((x): x is string => typeof x === 'string') : [],
    }
    this.items.set(item.id, item)
    this.persist()
    return this.viewOf(item)
  }

  private matches(item: MemoryItem, filter: UnplugFilter): boolean {
    if (filter.id !== undefined && filter.id !== null && item.id !== filter.id) return false
    if (typeof filter.query === 'string' && filter.query.length > 0) {
      const q = filter.query.toLowerCase()
      const hit = item.content.toLowerCase().includes(q)
        || item.tags.some((tag) => tag.toLowerCase().includes(q))
      if (!hit) return false
    }
    if (filter.scope !== undefined && filter.scope !== null && item.scope !== filter.scope) return false
    if (filter.ownerId !== undefined && filter.ownerId !== null && item.ownerId !== filter.ownerId) return false
    if (Array.isArray(filter.tags) && filter.tags.length > 0) {
      if (!filter.tags.every((tag) => item.tags.includes(tag))) return false
    }
    return true
  }

  /** Remove matching memories (forget). Physical delete + audit; the only path that removes pinned items. */
  unplug(filter: UnplugFilter = {}, reason: ForgetReason = 'manual'): { forgotten: number; ids: string[] } {
    const t = Date.now()
    const ids: string[] = []
    for (const [id, item] of this.items) {
      if (this.matches(item, filter)) ids.push(id)
    }
    for (const id of ids) {
      const item = this.items.get(id)
      if (item === undefined) continue
      this.items.delete(id)
      this.recordForget(item, reason, t)
    }
    if (ids.length > 0) this.persist()
    return { forgotten: ids.length, ids }
  }

  /** Settle all items; expired / bottomed-out memories are removed and audited. */
  sweep(): number {
    const t = Date.now()
    const expired: string[] = []
    for (const [id, item] of this.items) {
      settleItem(item, t, this.config.staleStrength, this.config.forgottenStrength)
      if (item.status === 'forgotten') expired.push(id)
    }
    for (const id of expired) {
      const item = this.items.get(id)
      if (item === undefined) continue
      this.items.delete(id)
      this.recordForget(item, 'expired', t)
    }
    if (expired.length > 0) this.persist()
    return expired.length
  }

  /** Access one memory: renew the decay clock (sliding TTL), boost strength. */
  touch(id: string): MemoryView | undefined {
    const item = this.items.get(id)
    if (item === undefined) return undefined
    const t = Date.now()
    item.lastAccessedAt = t
    item.accessCount += 1
    if (this.config.promoteAfterAccesses > 0
      && !item.pinned
      && item.accessCount >= this.config.promoteAfterAccesses) {
      item.ttl = Math.max(item.ttl ?? 0, 365 * 24 * 60 * 60 * 1000)
    }
    item.strength = 1
    item.status = 'active'
    this.persist()
    return this.viewOf(item)
  }

  /** Recall matching active memories and renew each (remembering revives). */
  recall(query?: string): MemoryView[] {
    const q = String(query ?? '').toLowerCase()
    const hits: MemoryView[] = []
    const t = Date.now()
    for (const item of this.items.values()) {
      settleItem(item, t, this.config.staleStrength, this.config.forgottenStrength)
      if (item.status === 'forgotten') continue
      if (q.length > 0 && !(item.content.toLowerCase().includes(q)
        || item.tags.some((tag) => tag.toLowerCase().includes(q)))) continue
      this.touch(item.id)
      const renewed = this.items.get(item.id)
      if (renewed !== undefined) hits.push(this.viewOf(renewed))
    }
    return hits
  }

  /** Restore a forgotten memory from the audit (restorable mode); fresh id and TTL. */
  restore(id: string): MemoryView | { rejected: string } {
    for (let i = this.audit.length - 1; i >= 0; i--) {
      if (this.audit[i].id === id) return this.restoreFrom(this.audit[i])
    }
    return { rejected: `审计中找不到 id=${id}` }
  }

  private restoreFrom(entry: AuditEntry): MemoryView | { rejected: string } {
    if (!this.config.restorable || typeof entry.content !== 'string') {
      return { rejected: '隐私模式：内容已物理删除，无法恢复；可重新 remember 同一条（审计哈希可对照）' }
    }
    const t = Date.now()
    const item: MemoryItem = {
      id: this.newId(),
      scope: entry.scope === 'team' ? 'team' : entry.scope === 'session' ? 'session' : 'workspace',
      workspaceId: 'ws-default',
      ownerId: typeof entry.ownerId === 'string' ? entry.ownerId : 'default',
      kind: typeof entry.kind === 'string' ? entry.kind : 'fact',
      content: entry.content,
      source: 'tool',
      createdAt: t,
      lastAccessedAt: t,
      accessCount: 0,
      ttl: this.config.defaultTtlMs,
      pinned: false,
      curve: 'ebbinghaus',
      baseStrength: 1,
      strength: 1,
      status: 'active',
      tags: Array.isArray(entry.tags) ? entry.tags.filter((x): x is string => typeof x === 'string') : [],
    }
    this.items.set(item.id, item)
    this.audit.push({
      id: item.id,
      kind: item.kind,
      reason: 'restored',
      at: t,
      contentHash: hashText(item.content),
      restoredFrom: entry.id,
    })
    if (this.audit.length > AUDIT_CAP) this.audit = this.audit.slice(-AUDIT_CAP)
    this.persist()
    return this.viewOf(item)
  }

  /** Health readout: counts, token footprint, next expiry, injection ledger input. */
  status(): {
    counts: { active: number; stale: number; forgotten: number }
    tokens: number
    nextExpiryAt: number | null
    recent: Array<{ id: string; reason: string; at: number }>
  } {
    const t = Date.now()
    const counts = { active: 0, stale: 0, forgotten: 0 }
    let tokens = 0
    let nextExpiryAt: number | null = null
    for (const item of this.items.values()) {
      settleItem(item, t, this.config.staleStrength, this.config.forgottenStrength)
      if (item.status === 'active') counts.active++
      else if (item.status === 'stale') counts.stale++
      else counts.forgotten++
      tokens += itemTokens(item)
      if (item.ttl !== null && !item.pinned) {
        const e = referenceOf(item) + item.ttl
        if (nextExpiryAt === null || e < nextExpiryAt) nextExpiryAt = e
      }
    }
    return {
      counts,
      tokens,
      nextExpiryAt,
      recent: this.audit.slice(-5).map((a) => ({ id: a.id, reason: a.reason, at: a.at })),
    }
  }

  /** Recent audit entries; content hash only (never leaks body text). */
  auditView(limit = 20): AuditEntry[] {
    const n = Math.max(1, Math.min(100, Number(limit) || 20))
    return this.audit.slice(-n)
  }

  /** Deterministic, budgeted injection selection. Dead memories are never selected. */
  selectForInjection(budget = this.config.maxInjectedTokens): SelectionResult {
    const t = Date.now()
    const candidates: MemoryItem[] = []
    let skippedDead = 0
    for (const item of this.items.values()) {
      settleItem(item, t, this.config.staleStrength, this.config.forgottenStrength)
      if (item.status === 'forgotten') {
        skippedDead++
        continue
      }
      if (item.status === 'stale') continue
      candidates.push(item)
    }
    candidates.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (b.strength !== a.strength) return b.strength - a.strength
      return b.lastAccessedAt - a.lastAccessedAt
    })
    const selected: MemoryView[] = []
    let used = 0
    for (const item of candidates) {
      const tk = itemTokens(item)
      if (used + tk > budget) continue // skip, never truncate
      const view = this.viewOf(item)
      view.tokens = tk
      selected.push(view)
      used += tk
    }
    return { items: selected, tokens: used, skippedDead }
  }

  /** Dry-run injection preview (does not touch): token ledger for cost accounting. */
  preview(budget = this.config.maxInjectedTokens): {
    budget: number
    count: number
    tokens: number
    skippedDead: number
    items: Array<{ id: string; kind: string; tokens: number; strength: number; status: string; expiresAt: number | null }>
  } {
    const sel = this.selectForInjection(budget)
    return {
      budget,
      count: sel.items.length,
      tokens: sel.tokens,
      skippedDead: sel.skippedDead,
      items: sel.items.map((v) => ({
        id: v.id,
        kind: v.kind,
        tokens: v.tokens ?? 0,
        strength: v.strength,
        status: v.status,
        expiresAt: v.expiresAt,
      })),
    }
  }

  /** Count of currently stored items (diagnostics). */
  get size(): number {
    return this.items.size
  }
}
