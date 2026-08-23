# dsh-memory-forget — AI Agent 遗忘引擎

> **Remember less. Think clearer. —— 记住更少，想得更清。**
>
> Forgetting engine for AI agents: memory TTL, decay, eviction, audit. The opposite of memory programming. DSH plugin + local skill + CLI.

记忆编程（memory programming）席卷 Agent 生态：Mem0、Letta、Engram 都在教 Agent 记住一切。dsh-memory-forget 做的是**它的反面**——把"遗忘"从意外变成设计：每条记忆都有保质期，过期即死，全程审计，注入有硬预算，拔得干净。

**一句话差异**：记忆引擎回答"怎么存得好、找得准"；dsh-memory-forget 回答"**什么时候该忘、哪条还可信、放多少进上下文、里面到底有什么**"。

这不是抬杠，是有依据的：[Agent 用得越久越笨，记忆污染是主因](https://eu.36kr.com/en/p/3815882774011653#1)；记忆投毒是真实攻击类（[单封邮件持久投毒](https://labs.cloudsecurityalliance.org/research/csa-research-note-memghost-agent-memory-poisoning-20260723-c/)、[隐形记忆注入](https://icml.cc/virtual/2026/poster/66667)）。遗忘不是记忆的故障，是记忆的治理。

## 仓库结构

```
dsh-memory-forget/
  src/core/     零依赖核心（types / decay / audit / engine）
  package.json  @xiaoke8698/dsh-memory-forget（MIT）
  LICENSE / tsconfig.json / .gitignore
  README.md
```

> 状态：包骨架已建立（M1 验证逻辑已抽入 `src/core`，可 `npm run build`）。Cordis 插件适配层、CLI、skill 在路线图（M4）；当前可运行的仍是 DSH 会话级动态插件。

## 特性：可插拔、可遗忘、可对账

| 特性 | 说明 |
|---|---|
| **记忆总线 · 可插拔** | 记住 = 把记忆节点**插上**总线；遗忘 = **拔下**——物理删除、不留"幽灵引用"。遗忘不是故障，是协议操作 |
| **可遗忘 · 带保质期** | 每条记忆有 TTL + 衰减曲线（艾宾浩斯式）：活跃 → 陈旧 → 遗忘。`amnesia_status` 实时可见 |
| **重要性 · 声明或挣得** | `pin: true` 显式永不忘；或靠持续使用挣得——**滑动续期（use it or lose it）**：只要被使用就不过期，闲置满一个 TTL 即亡 |
| **可恢复 · 插得回来** | `amnesia_restore <id>`（restorable 模式）把拔下的记忆原样插回（新 id、新 TTL、审计记 `restored`）；隐私模式下可重新 remember（审计哈希可对照） |
| **审计 · 只留哈希** | 谁、何时、为什么被遗忘/恢复，全部留痕；内容默认物理删除，审计只留 SHA-256 |
| **注入有硬预算** | 每步注入 ≤ `maxInjectedTokens`（默认 2000）；**死记忆（stale/forgotten）绝不注入**；超限"少选不截断" |
| **token 账本可对账** | `amnesia_status` 暴露上次注入账本（count/tokens/at）；`amnesia_preview` 干跑预览不生效 |
| **轻量化** | 零 embedding、零 LLM 抽取/改写（写入零生成成本）、零服务端进程 |
| **隐私优先** | 默认物理删除；可恢复与"删得干净"是显式取舍（Config 开关） |
| **多 Agent 适配** | scope 三档（workspace / session / team）：子 Agent 结束即自动拔出临时记忆，默认不继承主 Agent 记忆 |

## 快速入门（当前形态：DSH 动态插件，M1）

> **状态说明**：目前是**会话级动态 Cordis 插件**（M1 验证形态，运行在 DSH 会话内）。正式 npm 包、CLI、skill 在路线图上（见 Todo）。

1. 在 DSH 会话中加载插件（动态插件流程：define → run），获得 7 个工具：

| 工具 | 作用 |
|---|---|
| `amnesia_remember` | 记住（带 TTL / pin / scope / tags） |
| `amnesia_forget` | 拔下（按 id / 关键词 / 标签 / 全部） |
| `amnesia_recall` | 想起（命中即续命） |
| `amnesia_restore` | 从审计恢复（restorable 模式） |
| `amnesia_preview` | 注入干跑预览（token 对账，不生效） |
| `amnesia_status` | 健康度 + 注入账本 |
| `amnesia_audit` | 遗忘/恢复轨迹 |

2. 一段典型会话：

```
> 记住：验证饮品是 lapsang（15 秒后过期）
→ 已记住 m-xxx（scope=workspace）
# 每步模型请求前，活记忆自动注入上下文（≤ 预算）：
# AMNESIA MEMORY（记忆总线：注入 1 条 / 20 tokens，预算 2000…）
> 15 秒后查状态
→ counts: {active:1, forgotten:1}   ← 过期即死，审计入账
> 想起：oolong
→ 命中并续命（accessCount+1，过期时刻推后）
> 拔下：忘记 CI 密钥格式
→ 审计：{reason:'manual', contentHash:...}
> 恢复：amnesia_restore <原id>
→ 已恢复（新 id、新 TTL、审计记 restored）
```

3. 配置（M1 为插件内 config 对象；正式包走 YAML `Config` 字段）：`defaultTtlMs`（默认 30 天）、`staleStrength`（0.3）/ `forgottenStrength`（0.05）、`maxInjectedTokens`（2000）、`maxItemBytes`（2048）、`restorable`（正式包默认 false = 隐私）、`promoteAfterAccesses`（0 = 关）等。

## 其他 Agent 整合方法

**首选：skill + 本地 CLI（零服务端，规划中 M4）**

- 一个 `SKILL.md`（Anthropic Agent Skills 格式，Claude Code / Codex / DSH 通用）+ 本地 CLI，**复制即用**：无网络依赖、无后台进程、本地运行即最优解。
- Claude Code：复制到 `~/.claude/skills/dsh-memory-forget/`（或项目 `.claude/skills/`）；DSH：skills 目录；Codex：skills / AGENTS.md 引用。
- SKILL.md 教 Agent：默认不记、记住必须带 TTL、收尾自查陈旧、子任务结束即拔临时记忆。

**远期：MCP server（M6，需服务端托管与保活，暂不承诺）**

> **现状**：skill / CLI 尚未交付（在路线图上）；当前可用的只有 DSH 动态插件形态。

## 路线图 / Todo

- [x] **M0 设计定稿** — 定位、架构、里程碑（[设计文档](docs/design.md)）
- [x] **M1 动态插件验证**（`memf-1` 运行中）
  - [x] M1.1 核心引擎（记忆总线 / 衰减 / 审计）
  - [x] M1.2 服务与存储（fs 持久化；正式包切 storageDomain）
  - [x] M1.3 工具面（7 个工具）
  - [x] M1.4 生命周期钩子（turn-stopping 衰减扫 / disposed 自动拔出）
  - [x] M1.5 注入与预算（agent/pre-step 快照消息 + token 账本 + preview）
  - [ ] M1.6 验收（DoD 1-5；DoD 5 子 Agent 自动拔出待实测）
- [ ] **M2 Client UI** — composer.dock 读数条 / 记忆节点视图（可拖动拔出）/ 设置页
- [ ] **M3 三臂基准** — 无记忆 / 全记忆 / Amnesia：累计 token、任务成功率、**陈旧错误率**
- [ ] **M4 skill + CLI 分发** — 跨 Agent 本地组合（本节落地）
- [ ] **M5 增值** — `/amnesia` 命令、自动建议（opt-in）、可视化深化
- [ ] **M6 MCP server（远期，不做承诺）**
- [ ] 开放问题：Q1 遗忘激进度 / Q2 自动抽取 / Q3 语义检索 / Q4 目标用户 / Q5 基准任务集 / Q6 分发形态

## 文档

- 完整设计文档：[docs/design.md](docs/design.md)（§13 架构总览、§14 最小真实验证实录）
- 生态依据：DSH 已有 `compaction`（压缩）但**无任何删除/过期/淘汰语义**；记忆系统仅第三方 MCP 示例（`examples/mcp-memory`，默认关闭）

## 相关研究

- 记忆污染使 Agent 变笨：[CUHK & ZJU](https://eu.36kr.com/en/p/3815882774011653#1)
- 记忆治理策略：[MemArchitect](https://ar5iv.labs.arxiv.org/html/2603.18330#1)
- 记忆投毒攻击：[MemGhost（单封邮件投毒）](https://labs.cloudsecurityalliance.org/research/csa-research-note-memghost-agent-memory-poisoning-20260723-c/)、[MemIncept（ICML 2026）](https://icml.cc/virtual/2026/poster/66667)
