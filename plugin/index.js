/**
 * dsh-memory-forget — DSH Cordis plugin adapter (official bundle entry).
 *
 * Ports the M1-validated dynamic-plugin logic (memory bus, tools, lifecycle
 * hooks, pre-step injection) into a real Cordis plugin package. Zero external
 * dependencies by design: tools are registered as raw ToolDefinitions via
 * `ctx.tools.register` (the same shape MCP interop uses), the pre-step
 * injection follows the time-context snapshot-message pattern, and tunables
 * come from the bundle patch row's `config` (documented in the README; the
 * formal in-repo package would switch to schemastery Config validation).
 *
 * Install into a DSH profile:
 *   dsh plugin --profile <name> add @xiaoke8698/dsh-memory-forget
 */

import { AmnesiaEngine } from '../dist/index.js'

export const name = 'dsh-memory-forget'

/** The tools registry is a hard dependency: Cordis waits for it before apply. */
export const inject = ['tools']

const DEFAULTS = {
  defaultTtlMs: 30 * 24 * 60 * 60 * 1000,
  staleStrength: 0.3,
  forgottenStrength: 0.05,
  maxItemBytes: 2048,
  maxStoreBytes: 256 * 1024,
  maxInjectedTokens: 2000,
  restorable: false,
  promoteAfterAccesses: 0,
  storeFile: '.dsh-memory-forget/store.json',
}

/** Lossless-JSON helper for building the pre-step injection message. */
function uuidish() {
  let s = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'
    else if (i === 14) s += '4'
    else if (i === 19) s += '8'
    else s += Math.floor(Math.random() * 16).toString(16)
  }
  return s
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }
  let lastInjection = null
  const fsSvc = ctx.get('fs')

  const adapter = {
    async load() {
      if (!fsSvc) return undefined
      try {
        const target = await fsSvc.resolve(cfg.storeFile)
        const info = await fsSvc.stat(target)
        if (!info) return undefined
        return JSON.parse(await fsSvc.readText(target))
      } catch (err) {
        console.error('[amnesia] load failed, starting empty:', String(err))
        return undefined
      }
    },
    async persist(items, audit) {
      if (!fsSvc) return
      try {
        const target = await fsSvc.resolve(cfg.storeFile)
        await fsSvc.writeText(target, JSON.stringify({ items, audit }))
      } catch (err) {
        console.error('[amnesia] persist skipped (in-memory only):', String(err))
      }
    },
  }

  const engine = new AmnesiaEngine(cfg, adapter)
  void engine.ready

  /** Wrapped service: core engine + injection ledger. */
  const amnesia = {
    plug: (input, ownerId) => engine.plug(input, ownerId),
    unplug: (filter, reason) => engine.unplug(filter, reason),
    touch: (id) => engine.touch(id),
    recall: (query) => engine.recall(query),
    restore: (id) => engine.restore(id),
    sweep: () => engine.sweep(),
    selectForInjection: (budget) => engine.selectForInjection(budget),
    preview: () => engine.preview(),
    audit: (limit) => engine.auditView(limit),
    status: () => ({ ...engine.status(), injection: lastInjection }),
  }
  ctx.provide('amnesia', amnesia)

  // ---------- injection: budgeted memory snapshot per step (time-context pattern) ----------
  function buildInjectionMessage() {
    const sel = engine.selectForInjection(cfg.maxInjectedTokens)
    if (sel.items.length === 0) return undefined
    const t = Date.now()
    const lines = sel.items.map((v) => {
      const remain = v.ttlMs === null ? '永久' : `${Math.max(1, Math.round((v.expiresAt - t) / 3600000))}h`
      return `- [${v.id} | ${v.kind} | 剩 ${remain}] ${v.content}`
    })
    const text = `AMNESIA MEMORY（记忆总线：注入 ${sel.items.length} 条 / ${sel.tokens} tokens，预算 ${cfg.maxInjectedTokens}；这些记忆带保质期，过期后不再注入）\n${lines.join('\n')}`
    for (const v of sel.items) engine.touch(v.id) // injection counts as access (sliding renewal)
    lastInjection = { count: sel.items.length, tokens: sel.tokens, at: t }
    return {
      id: uuidish(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: 'amnesia/memory', text }] },
    }
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (!decision || decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
    const msg = buildInjectionMessage()
    if (!msg) return decision
    return { kind: 'enter', messages: [...decision.messages, msg] }
  }, { prepend: true })

  // ---------- lifecycle hooks ----------
  ctx.on('agent/turn-stopping', () => {
    const gone = engine.sweep()
    if (gone > 0) console.log('[amnesia] turn sweep expired', gone, 'memories')
  })

  ctx.on('agent/disposed', (payload) => {
    const a = payload && payload.agent
    const sid = a && a.session ? a.session.id : undefined
    if (typeof sid === 'string' && sid.length > 0) {
      const res = engine.unplug({ scope: 'session', ownerId: sid }, 'agent-disposed')
      if (res.forgotten > 0) console.log('[amnesia] auto-unplugged', res.forgotten, 'session memories of', sid)
    }
  })

  // ---------- tools (raw ToolDefinitions via ctx.tools.register) ----------
  const text = (s) => [{ type: 'text', text: String(s) }]
  const define = (def) => ctx.tools.register(def)

    define({
      name: 'amnesia_remember',
      description: '记住一条带保质期的记忆（插上记忆总线）。默认按衰减曲线在 TTL 后过期；pin=true 则永久保留，直到显式遗忘。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '记忆内容，一句话以内' },
          kind: { type: 'string', enum: ['fact', 'preference', 'episode', 'task-context'], description: '记忆类型，默认 fact' },
          ttlMs: { type: 'number', description: '过期毫秒数；省略用默认 TTL（30 天）；pin=true 时忽略' },
          pin: { type: 'boolean', description: 'true = 永久保留直到显式遗忘' },
          scope: { type: 'string', enum: ['workspace', 'session', 'team'], description: '作用域；默认 workspace' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选标签，便于按标签遗忘' },
        },
        required: ['content'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(args, value) {
          const label = value.ttlMs === null ? '永久保留' : `约 ${Math.max(1, Math.round(value.ttlMs / 3600000))} 小时后过期`
          return text(`已记住 ${value.id}（${label}，scope=${value.scope}）`)
        },
      },
      execute: (args) => engine.plug(args),
    })

    define({
      name: 'amnesia_forget',
      description: '拔下记忆：按 id / 内容关键词 / 标签 / 全部 遗忘。遗忘物理删除内容并写入审计（只留哈希；restorable 模式保留副本可恢复）。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '记忆 id（amnesia_status 或 remember 返回）' },
          query: { type: 'string', description: '内容或标签关键词' },
          tags: { type: 'array', items: { type: 'string' }, description: '匹配所有这些标签的记忆' },
          all: { type: 'boolean', description: 'true = 清空全部记忆（需 confirm: true）' },
          confirm: { type: 'boolean', description: 'all=true 时必须为 true 才会执行' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(args, value) {
          const extra = value.rejected ? `（${value.rejected}）` : ''
          return text(`已拔出 ${value.forgotten} 条记忆${value.ids.length ? `：${value.ids.join(', ')}` : ''}${extra}`)
        },
      },
      execute: (args) => {
        const hasSelector = args.id !== undefined
          || (typeof args.query === 'string' && args.query.length > 0)
          || (Array.isArray(args.tags) && args.tags.length > 0)
        if (!hasSelector && args.all !== true) {
          return { forgotten: 0, ids: [], rejected: '需要提供 id / query / tags，或 all=true + confirm=true' }
        }
        if (args.all === true && args.confirm !== true) {
          return { forgotten: 0, ids: [], rejected: 'all=true 需要 confirm=true 确认' }
        }
        return engine.unplug({ id: args.id, query: args.query, tags: args.tags }, 'manual')
      },
    })

    define({
      name: 'amnesia_recall',
      description: '想起：按关键词召回记忆并触摸（滑动续期）。被召回的每条记忆衰减时钟重置——只要持续有用就不过期（use it or lose it）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '内容或标签关键词；留空返回全部活跃记忆' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(args, value) { return text(JSON.stringify(value)) },
      },
      execute: (args) => ({ hits: engine.recall(args.query) }),
    })

    define({
      name: 'amnesia_restore',
      description: '从审计恢复一条被遗忘的记忆（restorable 模式）。返回新 id、新 TTL；恢复动作本身记入审计。隐私模式（restorable=false）下内容已物理删除，无法恢复，只能重新 remember。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '被遗忘记忆的原 id（amnesia_status 的 recent 或 amnesia_audit 中查看）' },
        },
        required: ['id'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(args, value) {
          if (value.rejected) return text(`恢复失败：${value.rejected}`)
          return text(`已恢复 ${value.id}（原 ${value.restoredFrom} → 新 ${value.id}）`)
        },
      },
      execute: (args) => {
        const res = engine.restore(args.id)
        if (res && res.rejected) return res
        return { id: res.id, restoredFrom: args.id, content: res.content, ttlMs: res.ttlMs, scope: res.scope }
      },
    })

    define({
      name: 'amnesia_preview',
      description: '干跑预览：当前预算（maxInjectedTokens）下下一步将注入哪些记忆、占多少 token、跳过多少死记忆（不 touch、不生效）。token 成本对账用。',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(args, value) { return text(JSON.stringify(value, null, 2)) },
      },
      execute: () => engine.preview(),
    })

    define({
      name: 'amnesia_status',
      description: '记忆健康度读数：活跃/陈旧/已遗忘数量、token 总占用、下一次过期时间、上次注入账本（count/tokens/at）、最近拔出记录。',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(args, value) { return text(JSON.stringify(value)) },
      },
      execute: () => amnesia.status(),
    })

    define({
      name: 'amnesia_audit',
      description: '查看遗忘/恢复审计轨迹：谁、何时、为什么被遗忘或恢复；内容只留哈希（不泄露正文）。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回条数，默认 20，最大 100' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(args, value) { return text(JSON.stringify(value, null, 2)) },
      },
      execute: (args) => ({ entries: engine.auditView(args.limit) }),
    })

    console.log('[amnesia] dsh-memory-forget plugin mounted; tools registered: 7')
}
