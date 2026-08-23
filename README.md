# dsh-memory-forget — The Forgetting Engine for AI Agents

> **Remember less. Think clearer.**
>
> Forgetting engine for AI agents: memory TTL, decay, eviction, audit. The opposite of memory programming. Zero-dependency core, MIT.

Memory programming is everywhere: Mem0, Letta, Engram all teach agents to remember everything. dsh-memory-forget does the **opposite** — it turns forgetting from an accident into a design: every memory has a shelf life, dies on schedule, is fully audited, and is injected under a hard token budget.

**One-line difference**: memory engines answer "how to store and retrieve well"; dsh-memory-forget answers "**when to forget, which memory is still trustworthy, how much goes into context, and what is actually in there**".

This is not contrarianism — there is evidence: [agents get dumber with use, memory pollution is a main cause (CUHK & ZJU)](https://eu.36kr.com/en/p/3815882774011653#1); memory poisoning is a real attack class ([single-email persistent poisoning](https://labs.cloudsecurityalliance.org/research/csa-research-note-memghost-agent-memory-poisoning-20260723-c/), [stealthy memory injection](https://icml.cc/virtual/2026/poster/66667)). Forgetting is not memory's failure mode — it is memory's governance.

---

## Install

```sh
npm install @xiaoke8698/dsh-memory-forget
```

Node >= 20, zero dependencies, ESM.

## Usage

```ts
import { AmnesiaEngine } from '@xiaoke8698/dsh-memory-forget'

const memory = new AmnesiaEngine({ restorable: true })

// remember with a shelf life (plug into the memory bus)
const v = memory.plug({
  content: 'validation drink is lapsang',
  ttlMs: 60_000,
  kind: 'preference',
  tags: ['validation'],
})
console.log(v.id, v.expiresAt) // m-xxx 1787469261044

// health readout: active/stale/forgotten counts + token footprint
console.log(memory.status())

// recall renews the decay clock — use it or lose it
memory.recall('lapsang')      // matches + touches (sliding TTL)

// forget (unplug): physical delete; audit keeps hash only (content if restorable)
memory.unplug({ id: v.id })

// restore a forgotten memory (restorable mode): new id, new TTL, audit reason 'restored'
const back = memory.restore(v.id)

// budgeted injection selection: dead (stale/forgotten) memories are NEVER selected
const sel = memory.selectForInjection(2000)
console.log(sel.tokens, sel.skippedDead)

// dry-run preview for token cost accounting (does not touch)
console.log(memory.preview())
```

### Persistence

The engine is in-memory; provide a `StoreAdapter` for durability:

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { AmnesiaEngine } from '@xiaoke8698/dsh-memory-forget'

const memory = new AmnesiaEngine({ restorable: false }, {
  async load() {
    try { return JSON.parse(await readFile('memories.json', 'utf8')) }
    catch { return undefined }
  },
  async persist(items, audit) {
    await writeFile('memories.json', JSON.stringify({ items, audit }))
  },
})
await memory.ready
```

### API

| Method | Meaning |
|---|---|
| `plug(input)` | remember with TTL / pin / scope / tags |
| `unplug(filter)` | forget (by id / query / tags) — physical delete + audit |
| `touch(id)` | access: renew the decay clock (sliding TTL) |
| `recall(query?)` | recall matching active memories and renew each |
| `restore(id)` | plug a forgotten memory back in (restorable mode) |
| `selectForInjection(budget)` | budgeted selection; dead memories excluded |
| `preview()` | dry-run injection preview (token ledger, no touch) |
| `status()` | counts + token footprint + next expiry + recent audit |
| `auditView(limit)` | forget/restore trail (hash only, never content body) |
| `sweep()` | settle all items; expire dead ones (call on turn end) |

---

## Features

| Feature | Description |
|---|---|
| **Pluggable memory bus** | remember = plug in; forget = unplug — physical delete, no ghost references. Forgetting is a protocol operation, not a failure |
| **Shelf life** | every memory has TTL + decay curve (Ebbinghaus): active → stale → forgotten |
| **Importance: declared or earned** | `pin: true` = explicit forever; or earn it by usage — **sliding renewal (use it or lose it)**: used memories never expire, idle-for-a-full-TTL memories die |
| **Recoverable** | `restore(id)` (restorable mode) plugs a forgotten memory back in (new id, new TTL, audited `restored`); in privacy mode re-`remember` instead (audit hash lets you verify it is the same content) |
| **Audit, hash only** | who/what/when/why forgotten or restored; content physically deleted by default, audit keeps SHA-256 |
| **Hard injection budget** | per-step ≤ `maxInjectedTokens` (default 2000); dead memories never injected; over budget = select less, never truncate |
| **Token ledger** | `status()` reports last-injection accounting; `preview()` is a non-touching dry run |
| **Lightweight** | zero embedding, zero LLM extraction/rewriting (zero generation cost on write), zero server process |
| **Privacy first** | physical deletion by default; recoverability vs. clean deletion is an explicit config switch |
| **Multi-agent scoping** | scope: workspace / session / team; a sub-agent's temp memories are auto-unplugged when it dies, never inherited by default |

---

## Evaluation: design, status, and an honest statement

**Benchmark design (three-arm, same model, same task set — only the forgetting policy changes):**

| Arm | Condition |
|---|---|
| A | no memory (cold start every task) |
| B | full memory (write forever, never forget — typical memory-plugin behavior) |
| C | Amnesia (write with TTL + decay) |

Fairness key: B and C share the **same store and retrieval** (deterministic strength-ranked selection) — only the forgetting policy is toggled. Memory vendors cannot run this A/B because they cannot turn off their own memory.

Metrics: cumulative context tokens, task success rate, **stale-error rate** (a written fact changes mid-task; how often does each arm use the outdated fact), steps/time, recall benefit on memory-helps tasks. Task sets: memory-helps (multi-turn preferences, repeated context), memory-hurts (changed facts, expired constraints, poisoned memories), mixed. Full design: [docs/design.md §11](docs/design.md).

**Status: NO comparative results exist yet (M3 not run).** What is verified (M1 dynamic-plugin validation) is that the *mechanisms* work — expiry, restore, audit, budgeted injection, sliding renewal — not that forgetting improves agent outcomes. **Until M3 produces data, effectiveness claims rest on the cited research, not on measurements of this package.** We will publish the benchmark numbers the moment they exist, with methodology and task sets attached.

---

## Roadmap

Current release **v0.1.0 ships the core engine only** (`AmnesiaEngine`: bus / decay / audit / selection). Not included yet: DSH Cordis plugin adapter, CLI, skill, MCP server, Client UI, benchmark results.

- [x] **M0 Design** — positioning, architecture, milestones ([docs/design.md](docs/design.md))
- [x] **M1 Dynamic-plugin validation** (session-scoped DSH plugin, `memf-1`)
  - [x] M1.1 core engine (bus / decay / audit)
  - [x] M1.2 service + storage (fs persistence; formal package → storageDomain)
  - [x] M1.3 tool surface (7 tools)
  - [x] M1.4 lifecycle hooks (turn-end sweep / disposed auto-unplug)
  - [x] M1.5 injection + budget (pre-step snapshot message + token ledger + preview)
  - [ ] M1.6 acceptance (DoD 1-5; DoD 5 sub-agent auto-unplug pending real-subagent test)
- [ ] **M2 Client UI** — composer readout / memory-node view (draggable unplug) / settings
- [ ] **M3 Three-arm benchmark** — cumulative tokens, success rate, stale-error rate
- [ ] **M4 skill + local CLI distribution** — cross-agent (Claude Code / Codex / DSH), zero server
- [ ] **M5 Value-add** — `/amnesia` command, auto-suggestion (opt-in), deeper visualization
- [ ] **M6 MCP server (far future, no commitment)**
- [ ] Open questions: Q1 forgetting aggressiveness / Q2 auto-extraction / Q3 semantic retrieval / Q4 target users / Q5 benchmark task set / Q6 distribution shape

## Integration with other agents

**Planned: skill + local CLI (M4)** — one `SKILL.md` (Anthropic Agent Skills format, shared by Claude Code / Codex / DSH) + a local CLI: copy-and-use, no network, no background process. Claude Code: `~/.claude/skills/dsh-memory-forget/`; DSH: skills dir; Codex: skills / AGENTS.md.

**Far future: MCP server (M6)** — needs server hosting; not committed.

> Status: skill / CLI are not shipped yet. Today the npm package is the core engine; the DSH dynamic plugin is the session-scoped validation form.

## Docs & Research

- Full design doc: [docs/design.md](docs/design.md) (§13 architecture, §14 minimal real validation log)
- Ecosystem basis: DSH has `compaction` (compression) but no delete/expiry/eviction semantics; memory systems are third-party MCP examples only (off by default)
- [Agents get dumber with use, memory pollution (CUHK & ZJU)](https://eu.36kr.com/en/p/3815882774011653#1)
- [Memory governance: MemArchitect](https://ar5iv.labs.arxiv.org/html/2603.18330#1)
- [Memory poisoning: MemGhost](https://labs.cloudsecurityalliance.org/research/csa-research-note-memghost-agent-memory-poisoning-20260723-c/) / [MemIncept (ICML 2026)](https://icml.cc/virtual/2026/poster/66667)

---

# 中文版

> **记住更少，想得更清。**

记忆编程席卷 Agent 生态（Mem0、Letta、Engram 都在教 Agent 记住一切），dsh-memory-forget 做的是**它的反面**——把"遗忘"从意外变成设计：每条记忆都有保质期、到点即死、全程审计、注入有硬预算、拔得干净。零依赖核心，MIT 协议。

**一句话差异**：记忆引擎回答"怎么存得好、找得准"；dsh-memory-forget 回答"**什么时候该忘、哪条还可信、放多少进上下文、里面到底有什么**"。

## 安装

```sh
npm install @xiaoke8698/dsh-memory-forget
```

Node >= 20，零依赖，ESM。

## 使用

```ts
import { AmnesiaEngine } from '@xiaoke8698/dsh-memory-forget'

const memory = new AmnesiaEngine({ restorable: true })

// 记住（带保质期，插上记忆总线）
const v = memory.plug({
  content: '验证饮品是 lapsang',
  ttlMs: 60_000,
  kind: 'preference',
  tags: ['validation'],
})

// 健康度：活跃/陈旧/已遗忘 + token 占用
console.log(memory.status())

// 想起即续命（use it or lose it）
memory.recall('lapsang')

// 拔下（物理删除 + 审计；restorable 时审计保留副本）
memory.unplug({ id: v.id })

// 恢复（restorable 模式）：新 id、新 TTL、审计记 restored
const back = memory.restore(v.id)

// 预算内注入选择：死记忆（stale/forgotten）绝不入选
const sel = memory.selectForInjection(2000)

// 干跑预览（不 touch，token 对账用）
console.log(memory.preview())
```

**持久化**：引擎是内存态，提供 `StoreAdapter` 即可落盘（见上方英文版示例）。

## 特性

| 特性 | 说明 |
|---|---|
| 记忆总线 · 可插拔 | 记住 = 插上；遗忘 = 拔下——物理删除、无幽灵引用 |
| 带保质期 | TTL + 艾宾浩斯衰减曲线：活跃 → 陈旧 → 遗忘 |
| 重要性：声明或挣得 | `pin: true` 永不忘；或靠使用挣得——滑动续期：持续使用不过期，闲置满一个 TTL 即亡 |
| 可恢复 | `restore(id)` 把拔下的记忆原样插回；隐私模式可重新 remember（审计哈希可对照） |
| 审计只留哈希 | 谁/何时/为什么被忘或恢复全留痕；内容默认物理删除 |
| 注入硬预算 | 每步 ≤ `maxInjectedTokens`（默认 2000）；死记忆绝不注入；超限少选不截断 |
| token 账本 | `status()` 暴露注入账本；`preview()` 干跑不生效 |
| 轻量化 | 零 embedding、零 LLM 抽取/改写、零服务端进程 |
| 隐私优先 | 默认物理删除；可恢复与删得干净是显式取舍 |
| 多 Agent 适配 | scope 三档；子 Agent 消亡自动拔出临时记忆，默认不继承 |

## 测评：方法、现状与诚实声明

**方法（三臂对照，同一模型同一任务集，只切换遗忘策略）**：A 无记忆（每任务冷启动）/ B 全记忆（写入即永久）/ C Amnesia（带 TTL + 衰减）。公平性关键：B 与 C 共用**同一存储与检索**，只开关遗忘策略——记忆厂商无法"关掉自己的记忆"做对照。指标：累计上下文 token、任务成功率、**陈旧错误率**（事实中途变更后各臂使用旧事实的比例）、步数/耗时。任务集：记忆有帮助组 / 记忆有害组（事实变更、过期约束、投毒）/ 混合组。完整设计见 [docs/design.md §11](docs/design.md)。

**现状：尚无对比结果（M3 未跑）。** 已验证的是机制能工作（过期/恢复/审计/预算注入/滑动续期），**不是**遗忘能提升效果。**在 M3 出数据之前，效果主张基于引用研究，不是本包实测**——一旦基准跑完，我们会连同方法论和任务集一起公开数据。

## 路线图

**v0.1.0 只包含核心引擎**（`AmnesiaEngine`：总线/衰减/审计/选择）。未包含：DSH Cordis 插件适配层、CLI、skill、MCP server、Client UI、基准结果。

- [x] M0 设计定稿
- [x] M1 动态插件验证（DSH 会话级）
  - [x] M1.1 核心引擎　[x] M1.2 服务与存储　[x] M1.3 工具面（7 工具）
  - [x] M1.4 生命周期钩子　[x] M1.5 注入与预算　[ ] M1.6 验收（子 Agent 自动拔出待实测）
- [ ] M2 Client UI　[ ] **M3 三臂基准**　[ ] **M4 skill + 本地 CLI 分发**　[ ] M5 增值　[ ] M6 MCP server（远期）
- [ ] 开放问题：Q1 遗忘激进度 / Q2 自动抽取 / Q3 语义检索 / Q4 目标用户 / Q5 基准任务集 / Q6 分发形态

## 其他 Agent 整合

**规划中（M4）**：skill + 本地 CLI（SKILL.md 复制即用，零服务端）。**远期（M6）**：MCP server（需服务端托管，不做承诺）。当前 npm 包只是核心引擎；DSH 动态插件是会话级验证形态。

## 文档与相关研究

- 完整设计文档：[docs/design.md](docs/design.md)
- 生态依据：DSH 有 `compaction`（压缩）但无删除/过期/淘汰语义；记忆系统仅第三方 MCP 示例（默认关闭）
- [记忆污染使 Agent 变笨（CUHK & ZJU）](https://eu.36kr.com/en/p/3815882774011653#1)　·　[记忆治理：MemArchitect](https://ar5iv.labs.arxiv.org/html/2603.18330#1)　·　[记忆投毒：MemGhost](https://labs.cloudsecurityalliance.org/research/csa-research-note-memghost-agent-memory-poisoning-20260723-c/) / [MemIncept](https://icml.cc/virtual/2026/poster/66667)
