# dsh-memory-forget — The Forgetting Engine for AI Agents

> [English](README.md) · [中文](README.zh.md)

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

Current release **v0.2.1 ships the core engine + the DSH official bundle** (`AmnesiaEngine` + Cordis plugin adapter). Not included yet: CLI, skill, MCP server, Client UI, benchmark results.

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
- [x] **M4 DSH official bundle** — shipped in 0.2.1; install with `dsh plugin add` (official bundle mechanism)
- [ ] **M4b skill + local CLI** — for other agents (Claude Code / Codex / DSH), zero server
- [ ] **M5 Value-add** — `/amnesia` command, auto-suggestion (opt-in), deeper visualization
- [ ] **M6 MCP server (far future, no commitment)**
- [ ] Open questions: Q1 forgetting aggressiveness / Q2 auto-extraction / Q3 semantic retrieval / Q4 target users / Q5 benchmark task set / Q6 distribution shape

## Integration with other agents

**DSH users: official bundle (shipped in 0.2.1)** — install with one command:

```sh
dsh plugin --profile <name> add @xiaoke8698/dsh-memory-forget
```

If your npm registry mirror lags behind npmjs.org, pin the version and the official registry:

```sh
dsh plugin --profile <name> add @xiaoke8698/dsh-memory-forget@0.2.1 --registry=https://registry.npmjs.org/
```

(Official bundle mechanism: npm package + `dsh.bundle` + `cordis.patch.yml`; see DSH docs `docs/user/develop/basic/publish.md`.)

**Planned: skill + local CLI (M4)** — one `SKILL.md` (Anthropic Agent Skills format, shared by Claude Code / Codex / DSH) + a local CLI: copy-and-use, no network, no background process. Claude Code: `~/.claude/skills/dsh-memory-forget/`; DSH: skills dir; Codex: skills / AGENTS.md.

**Far future: MCP server (M6)** — needs server hosting; not committed.

> Status: skill / CLI are not shipped yet. Today the npm package is the core engine + DSH official bundle; the DSH dynamic plugin was the session-scoped validation form.

## Docs & Research

- Full design doc: [docs/design.md](docs/design.md) (§13 architecture, §14 minimal real validation log)
- Ecosystem basis: DSH has `compaction` (compression) but no delete/expiry/eviction semantics; memory systems are third-party MCP examples only (off by default)
- [Agents get dumber with use, memory pollution (CUHK & ZJU)](https://eu.36kr.com/en/p/3815882774011653#1)
- [Memory governance: MemArchitect](https://ar5iv.labs.arxiv.org/html/2603.18330#1)
- [Memory poisoning: MemGhost](https://labs.cloudsecurityalliance.org/research/csa-research-note-memghost-agent-memory-poisoning-20260723-c/) / [MemIncept (ICML 2026)](https://icml.cc/virtual/2026/poster/66667)
