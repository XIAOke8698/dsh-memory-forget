/** Memory kinds. */
export type MemoryKind = 'fact' | 'preference' | 'episode' | 'task-context'

/** Memory scope: which bus the item is plugged into. */
export type MemoryScope = 'workspace' | 'session' | 'team'

/** Decay curve selector. */
export type DecayCurve = 'flat' | 'linear' | 'ebbinghaus'

/** Lifecycle status. */
export type MemoryStatus = 'active' | 'stale' | 'forgotten'

/** Why a memory was forgotten. */
export type ForgetReason = 'expired' | 'evicted' | 'stale' | 'manual' | 'budget' | 'agent-disposed'

/** One durable memory item plugged into the bus. */
export interface MemoryItem {
  id: string
  scope: MemoryScope
  workspaceId: string
  ownerId?: string
  kind: MemoryKind
  content: string
  source: 'tool' | 'user' | 'auto'
  createdAt: number
  lastAccessedAt: number
  accessCount: number
  ttl: number | null
  pinned: boolean
  curve: DecayCurve
  baseStrength: number
  strength: number
  status: MemoryStatus
  tags: string[]
}

/** Lossless scalar view of one memory (safe to serialize / send over RPC). */
export interface MemoryView {
  id: string
  content: string
  kind: MemoryKind
  scope: MemoryScope
  ttlMs: number | null
  expiresAt: number | null
  pinned: boolean
  accessCount: number
  strength: number
  status: MemoryStatus
  tags: string[]
  tokens?: number
}

/** One audit entry: what was forgotten/restored, when, why; content hash only by default. */
export interface AuditEntry {
  id: string
  kind: MemoryKind
  reason: ForgetReason | 'restored'
  at: number
  contentHash: string
  content?: string
  tags?: string[]
  scope?: MemoryScope
  ownerId?: string
  restoredFrom?: string
}

/** Validated tunables; the DSH host plugin exposes these as YAML Config fields. */
export interface AmnesiaConfig {
  defaultTtlMs: number
  staleStrength: number
  forgottenStrength: number
  maxItemBytes: number
  maxStoreBytes: number
  maxInjectedTokens: number
  restorable: boolean
  promoteAfterAccesses: number
}

/** Input for {@link AmnesiaEngine.plug}. */
export interface PlugInput {
  content: string
  kind?: MemoryKind
  ttlMs?: number | null
  ttl?: number | null
  pin?: boolean
  scope?: MemoryScope
  tags?: string[]
  curve?: DecayCurve
}

/** Filter for {@link AmnesiaEngine.unplug}. */
export interface UnplugFilter {
  id?: string
  query?: string
  tags?: string[]
  scope?: MemoryScope
  ownerId?: string
}

/** Budgeted injection selection result. */
export interface SelectionResult {
  items: MemoryView[]
  tokens: number
  skippedDead: number
}

/** Durable persistence hook; the host plugin supplies a file/domain adapter. */
export interface StoreAdapter {
  load(): Promise<{ items: MemoryItem[]; audit: AuditEntry[] } | undefined>
  persist(items: readonly MemoryItem[], audit: readonly AuditEntry[]): Promise<void>
}
