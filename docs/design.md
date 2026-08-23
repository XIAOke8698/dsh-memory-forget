# dsh-memory-forget —— "遗忘引擎" 插件设计文档（代号 Amnesia）

> 定位：与"记忆编程"潮流完全相反的方向。别人让 Agent 记住一切，Amnesia 让 Agent **默认忘掉一切，记住是例外，且记住的也按计划腐烂**。
>
> 形态：一个核心引擎 × 四副面孔，装进**一个 npm 包 `@deepseek-ai/dsh-memory-forget`**（Cordis 插件 / skill+CLI 本地组合 / 基准 / MCP 远期）。跨 Agent 分发首选 **skill + 本地 CLI**（零服务端）；MCP server 延后。M1 先以动态 Cordis 插件验证，再落正式包。
>
> 状态：设计稿（M0），未进入实现。本文所有集成点引用自运行时 Inspect 的真实注册表（Host Service / Event / Builtin / Tool，Client Slots），不是猜测。

---

## 1. 一页摘要

### 1.1 定位与口号（建议稿，可改）

**Slogan**：`Remember less. Think clearer.` —— **记住更少，想得更清。**

**副标语（分类名）**：The forgetting engine for AI agents. —— **AI Agent 遗忘引擎**

**定位陈述**：dsh-memory-forget 是 AI Agent 的**遗忘引擎**——给每条记忆装上保质期（TTL、衰减、淘汰、审计），把"遗忘"从意外变成设计。它不是又一个记忆存储/检索系统（不与 LightRAG / Mem0 竞争），而是**记忆的生命周期治理层**：管记忆什么时候死、死得是否干净，不管它怎么存、怎么找。

**一句话差异**：记忆引擎回答"怎么存得好、找得准"；dsh-memory-forget 回答"什么时候该忘、哪条还可信、放多少进上下文、里面到底有什么"。

### 1.2 没有记忆系统时的价值（独立形态）

**常见疑问**：DSH 默认不装记忆系统，Amnesia 治理谁？答案：**Amnesia 不是"等一台记忆引擎来治理的管家"，它本身就是"带保质期的记忆"这个原语。**

- 三臂实验里它对应 C 臂；A 臂（无记忆）就是未装记忆系统的 DSH 现状。Amnesia 让用户**不装任何记忆系统也能拿到 C 臂**。
- 默认立场 = 无记忆（冷启动）；想要记忆时 = 显式记住**并带保质期**。这是"永生记忆"与"无记忆"之间的第三条路：拿 30% 的记忆收益（跨会话偏好延续），不付 100% 的代价（陈旧污染、膨胀、投毒）。
- **第二生命**：当用户日后接入 mem0 / LightRAG 等记忆引擎（如 DSH 的 `examples/mcp-memory`），Amnesia 才作为治理层叠加其上——但那是加分项，不是前提。

**问题**：当前 AI Agent 的主流方向是无限累积记忆（Mem0、Letta、Engram、知识图谱……）。但累积记忆有真实代价：上下文污染、陈旧信息被当成事实、注入预算被历史吃掉。[港中文与浙大的研究直接指出"Agent 用得越久越笨"](https://eu.36kr.com/en/p/3815882774011653#1)，学界已出现把"遗忘"当作治理策略的研究（[MemArchitect](https://ar5iv.labs.arxiv.org/html/2603.18330#1)）。DSH 生态里，`compaction` 负责**压缩**历史、`output-retention` 负责**留存**日志，但**没有任何"删除/过期/淘汰"语义**——这正是空白。

**答案**：Amnesia —— 一个把**遗忘**当作一等功能的插件：

- **默认立场是"不记住"**：不自动抽取、不自动沉淀；只有显式写入的记忆才存在。
- **所有记忆有 TTL**：到点过期，按衰减曲线（艾宾浩斯式）从"活跃"滑向"陈旧"，再滑向"遗忘"。
- **遗忘可审计、可解释**：谁、何时、为什么被遗忘，全部留痕。
- **注入有硬预算**：模型上下文里只放"最强"的记忆子集，超预算宁可少放，绝不塞满。
- **隐私优先**：内容默认物理删除，审计只留哈希，不保留可恢复副本。
- **记忆可插拔（核心）**：记忆是总线上的可插拔单元——记住 = 插上，遗忘 = 拔下，拔得干净、不留残余（§5.1）；并适配 DSH 多 Agent 生态（§6.10）。

**一句话卖点**：*别人教你"记得更久"，我教你"忘得更快"——记住更少，想得更清。*

---

## 2. 背景与动机

### 2.1 潮流：记忆编程

2025-2026 年的 Agent Infra 主线之一就是"记忆"：从插件（Mem0、LangMem）到内存系统（Letta/MemGPT），再到知识图谱与向量库（MCP Reference Memory、Engram）。DSH 自身的 `examples/mcp-memory` 也提供了三个第三方记忆 MCP 的引用配置（默认关闭）——说明 DSH 的立场是"记忆交给第三方"，第一方不内置。

「记忆作为可插拔单元」已有先例（Letta 的记忆块 memory blocks），但所有实现只解决"插与换"，**没有人解决"拔的纪律"**——何时拔、按什么拔、拔得干不干净。

### 2.2 反方证据

- 累积记忆 ≠ 更聪明：[CUHK 与 ZJU 的论文表明 Agent 会随着使用变笨，记忆污染是主因之一](https://eu.36kr.com/en/p/3815882774011653#1)。
- 陈旧记忆是幻觉源：一条三个月前的"事实"被注入时，Agent 无法区分它是否仍有效。
- 上下文预算被历史吃掉：注入的记忆挤占了当前任务的 token 空间。
- "遗忘"本身在认知科学里是功能，不是故障（艾宾浩斯遗忘曲线、间隔效应）；[已有人把 AI Amnesia 写成正经 spec](https://github.com/vibealgolab/Vibe_coding_with_Antigravity/blob/main/docs/specs/02_AI_Amnesia_Part_A_Hyper_Deep_v4.1.md#1)。

### 2.3 DSH 生态缺口（实测盘点）

| 已有（压缩/留存侧） | 缺失（删除/过期侧） |
|---|---|
| `compaction` 系：压缩历史、`command-compact` 手动压缩 | **没有 TTL / 过期 / 衰减 / 淘汰策略层** |
| `spill` 系：工具大输出溢出到文件 | **没有显式 `forget` 语义（工具、命令、UI 都没有）** |
| `output-retention`、`session-checkpoint-policy`：日志留存 | **没有记忆陈旧度检测** |
| `mcp-memory` 示例：接入第三方记忆 | **没有第一方"反记忆"立场插件** |
| `token-meter`：度量 | **没有"注入预算硬上限 + 排序择优"的实现** |

Amnesia 落在最右侧这一列，与 `compaction` 构成互补闭环：**compaction 管"历史瘦身"，Amnesia 管"记忆过期"**——压缩 ≠ 遗忘。

---

## 3. 范围（Scope）与明确不做（Non-goals）

### 3.1 范围

1. 一个可持久化的**记忆库**，每条记忆带 TTL 与衰减参数。
2. **衰减-淘汰引擎**：回合结束时惰性结算，按策略驱逐。
3. **模型注入**：每步把"预算内、最强、未过期"的记忆子集注入 prompt（`agent/pre-step` 快照消息），并**写会话日志**（满足 DSH "model-visible ⟺ logged" 约束）。
4. **遗忘与召回工具面**：`amnesia_remember` / `amnesia_forget` / `amnesia_status` / `amnesia_audit` / `amnesia_recall` / `amnesia_restore` 六个动态工具。
5. **审计轨迹**：遗忘事件的留痕（含内容哈希）。
6. **配置面**：全部 tunable 走 `Config` 字段（DSH 约定：无硬编码 tunables）。
7. **Client UI**：记忆健康度环境读数 + 设置页 + 交互面板（M2）。
8. **验证基准**：三臂对比（无记忆 / 全记忆 / Amnesia），量化遗忘在 token 成本、任务成功率、陈旧错误率上的收益（§11）。
9. **多端分发**：核心引擎 + DSH 原生插件 + **skill + 本地 CLI 组合**（跨 Agent 首选，零服务端，§10）；MCP server 延后为远期形态。

### 3.2 明确不做（防止异化为"又一个记忆插件"）

- **不做自动抽取**（MVP）：不监听会话内容自动"记住"。自动建议仅作为 M2+ 的显式 opt-in 配置（见 §12 开放问题 Q2）。
- **不做向量检索 / 语义搜索**（v1 不做）：MVP 只按"强度 + 最近访问"排序择优，不引入 embedding 依赖。语义检索可作为未来 Provider 扩展。
- **不做跨 Agent 共享记忆**（v1 不做）：记忆按 scope（workspace / session / team）隔离；子 Agent 默认不继承主 Agent 记忆（显式 promote 才升级，§6.10）。
- **不做 LLM 参与的记忆总结/改写**：遗忘判定是确定性策略（时间 + 强度），不让模型决定自己忘什么——这是"遗忘策略 vs 记忆治理"的边界。
- **不触碰 `llm/stream` 瀑布**：不改模型调用本身。
- **不做通用 Agent 评测框架**：基准只做本插件主张的对照验证（§11），不宣称普适结论。
- **不替换 `compaction`**：两者职责分离（§6.7）。
- **不做 MCP server（当前阶段）**：需要服务端托管与保活；跨 Agent 诉求由 skill + 本地 CLI 覆盖（§10.3），MCP 延后为远期形态（M6）。

---

## 4. 能力缝（Capability Seam）设计

按 DSH 能力缝惯例，拆成 Service Definition / Provider / Consumer 三态（可独立演化）：

```
amnesia（Service Definition）──┬── amnesia-local（Provider：存储 + 衰减策略）  [未来可换向量/云存储 Provider]
                               ├── amnesia-policy（Provider：淘汰/注入预算策略）[可选拆分]
                               └── Consumers：
                                   ├── 动态工具（remember / forget / status / audit / recall / restore）
                                   ├── 事件钩子（agent/turn-stopping 衰减、system-prompt/assemble 注入）
                                   ├── 命令（/amnesia，M1+）
                                   ├── 多 Agent 适配（agent/disposed、subagent/end、workflow/agent-end 自动拔出）
                                   └── Client UI（composer.dock 读数、settings 页、RPC）
```

动态插件 MVP 阶段：Service Definition 与 Provider 合并在一个 Package 内（`ctx.provide('amnesia', ...)` 注册服务），消费者按模块函数组织；未来拆分正式包时再按上表拆包。

---

## 5. 记忆模型（Memory Model）

### 5.1 记忆总线与拔插协议（核心隐喻）

**核心隐喻：记忆是总线上的可插拔单元。** 记住 = 把记忆节点**插上**总线；遗忘 = 把它**拔下**——干净、无残余、不留"幽灵引用"。整条总线的职责由生命周期管理器承担：

- `plug(memory)`：插入（= remember；校验 TTL、预算、作用域）。
- `unplug(id | filter)`：拔出（= forget；物理删除 + 审计；唯一能拔 pinned 的路径）。
- `plugs(scope?)`：列出当前插在总线上的节点（= status 的明细视图）。
- `inspect(id)`：单节点详情（强度、剩余寿命、作用域、信任状态）。
- `touch(id)`：召回命中（= 想起来；重置衰减时钟 + 强度增强，**滑动续期**）。
- `recall(query)`：想起（返回匹配的活跃记忆并 touch 每条）。
- `restore(id)`：从审计恢复（restorable 模式；新 id、新 TTL、审计记 `restored`）。
- `refuse(reason)`：管理器**会说"不"**——超预算拒绝注入、过期强制拔出、不可信标记待拔。这是与所有正向记忆引擎的本质差异：它们只会说"是"。

**拔得干净**：拔出即物理删除内容（默认），上下文与检索索引同步移除，审计只留哈希——不留任何可被后续注入拾起的残余。**可恢复例外**：`restorable: true` 时审计保留内容副本，`restore(id)` 可原样插回（§6.9）。

### 5.2 MemoryItem 数据结构

```ts
interface MemoryItem {
  id: string;                    // 不透明 id，全局唯一（uuid 风格）
  scope: 'workspace' | 'session' | 'team';   // 插在哪条总线上（§6.10）
  workspaceId: string;           // workspace 隔离域
  ownerId?: string;              // scope=session → sessionId；scope=team → teamId
  kind: 'fact' | 'preference' | 'episode' | 'task-context';
  content: string;               // 小块内容，写入时校验 ≤ maxItemBytes
  source: 'tool' | 'user' | 'auto';   // MVP 只有 tool/user；auto 留给 M2+ 自动建议
  createdAt: number;             // epoch ms
  lastAccessedAt: number;        // 最近一次被注入或被召回
  accessCount: number;           // 间隔效应：访问增强强度
  ttl: number | null;            // ms；null 表示不过期（仅 pin 时允许）
  pinned: boolean;               // pin = 显式要求记住，永不被自动淘汰
  curve: 'flat' | 'linear' | 'ebbinghaus';
  strength: number;              // 0..1，衰减结算后的当前强度
  status: 'active' | 'stale' | 'forgotten';
  tags: string[];                // 可选，用于 amnesia_forget 的按标签筛选
  sourceRef?: { sessionId: string; eventSeq?: number };  // 可选溯源
}
```

### 5.3 生命周期状态机

```
created ──(strength 随时间衰减)──▶ stale ──(继续衰减)──▶ forgotten(物理删除/审计)
   ▲                              │
   └──── 被注入/被召回（strength 增强，回到 active）
```

- `active`：可被注入。
- `stale`：强度低于 `staleStrength` 阈值（默认 0.3），**不再注入**，但仍保留（可能被召回增强复活）。
- `forgotten`：强度低于 `forgottenStrength`（默认 0.05）或 TTL 到期 → 物理删除 + 审计记录。`pinned` 项永不进入 forgotten（除非显式 forget）。
- **复活**：`stale` 与尚未被扫掉的 `forgotten` 被召回（`recall`/注入）命中即回到 `active`——"想起来"是合法的续命手段（spacing effect）。

### 5.4 衰减结算（惰性 + 回合末扫）

- **惰性**：读取记忆时按 `now - lastSettledAt` 结算一次；**回合末**：`agent/turn-stopping` 时对当前 workspace 全量扫一遍。
- **曲线**（`curve` 字段，可逐条覆盖，全局默认取 Config）：

```
flat:        strength(t) = baseStrength                        // 不衰减，仅 TTL 到期删除
linear:      strength(t) = baseStrength * max(0, 1 - t / ttl)  // 线性
ebbinghaus:  strength(t) = baseStrength * exp(-t / tau),  tau = ttl / k   // 指数衰减，k 默认 3
```

- **滑动续期（use it or lose it）**：衰减的参考点是 `lastAccessedAt`（若大于 `createdAt`）而非创建时刻。每次被注入/召回（`touch`）都重置时钟并增强强度：`lastAccessedAt = now`、`strength = min(1, strength * 1.5 + 0.1)`。**只要持续被使用就永不过期；闲置满一个 TTL，说明它不再重要，到期即亡。** 重要性 = 持续被使用，不是它曾经多重要。
- **毕业阈值（可选）**：`promoteAfterAccesses`（Config，默认 0=关）——访问次数达标后自动升级到更长 TTL，防"高频记忆仍然短命"。
- **确定性**：衰减是纯函数（时间 + 参数），无随机性——同一时刻同一批记忆结算结果一致，便于测试与审计。

---

## 6. Host 设计

### 6.1 注册面总览（全部真实扩展缝）

| 注册面 | 真实 API（来自 Inspect） | 用途 |
|---|---|---|
| 服务提供 | `ctx.provide('amnesia', service)` | 记忆库 + 策略核心 API |
| 事件订阅 | `ctx.on('agent/turn-stopping', ...)`（serial，`Scoped<Agent>`） | 回合末衰减扫 + 淘汰 |
| 事件订阅 | `ctx.on('agent/disposed', ...)`（emit，`Scoped<Agent>`） | Agent 消亡 → 拔出其 session/team 作用域记忆（§6.10） |
| 事件订阅 | `ctx.on('subagent/end', ...)`（emit，`Scoped<SubagentRuntime>`） | 子 Agent 结束 → 拔出未 promote 的临时记忆 |
| 事件订阅 | `ctx.on('workflow/agent-end', ...)`（emit） | workflow 子 Agent 结束 → 拔出临时记忆 |
| 事件订阅 | `ctx.on('session/event', ...)`（emit） | 注入留痕落会话日志（可选 v1.1） |
| 事件订阅 | `ctx.on('agent/pre-step', ...)`（waterfall，必须 `next()`） | 每步注入记忆快照消息 + 预算控制（time-context 同款机制） |
| 动态工具 | `harness.registerTool(ctx, def)` | 6 个 amnesia 工具 |
| 命令 | `ctx.get('commands')` → `register(def)` | `/amnesia`（M1+） |
| Client RPC | `harness.handle('amnesia.*', handler)` | 状态/遗忘/审计/策略 的 Client→Host 调用 |
| 定时 | `ctx.get('timer')` → `interval`/`timeout`（需 `inject: ['timer']`） | 可选的低频兜底扫（默认关闭，见 §6.6） |
| 持久化 | `ctx.get('storageDomain')` → `open(spec)` | 记忆库的持久后端 |

### 6.2 服务 API（`ctx.amnesia`）

```
// 总线协议（核心 API）：
plug(input: { content; kind?; ttl?; pin?; curve?; tags?; source?; scope? }): MemoryView   // 插上 = remember
unplug(request: { id?; query?; tags?; scope?: 'workspace' | 'session' | 'team'; all? }): ForgetSummary  // 拔下 = forget
plugs(scope?): PlugView[]        // 当前插在总线上的节点（标量视图）
inspect(id): PlugDetail | undefined
touch(id): PlugView | undefined  // 召回命中：重置衰减时钟（滑动续期）
recall(request: { query }): PlugView[]  // 想起：匹配并 touch 每条
restore(id): MemoryView | { rejected: string }  // 从审计恢复（restorable 模式）

// 模型/工具面别名（语义一致）
remember = plug;  forget = unplug;  status = plugs 摘要;  recall = touch 批量;  restore = 审计恢复

// 只读状态（模型可调用，返回小型标量视图）
status(): { counts: {active; stale; forgotten}; tokens: number; nextExpiryAt?: number; recent: RecentForget[] }

// 审计
audit(request: { limit?; since? }): AuditEntry[]

// 内部：预算内择优注入（供 prompt 组装钩子调用）
selectForInjection(workspaceId, maxTokens): MemoryItem[]
```

**关键约束**：`status()` / `audit()` 返回的是**小型标量视图**（数量、token 数、最近 5 条遗忘摘要），绝不把 MemoryItem 数组整体序列化给模型。

### 6.3 动态工具（工具名已对 `Tool.listTools` 核对，无冲突）

| 工具 | 参数 | 行为 |
|---|---|---|
| `amnesia_remember` | `{content, kind?, ttlMs?, pin?, tags?}` | 写入一条带 TTL 的记忆；`pin: true` 时 `ttl` 必须省略或为 null（永久）。返回 `{id, ttlMs, expiresAt}` |
| `amnesia_forget` | `{id? \| query? \| tags?, all?}` | 显式遗忘；`all: true` 清空当前 workspace（需 `confirm: true` 二次确认参数）。返回被遗忘数量 |
| `amnesia_status` | `{}` | 健康度读数（供模型自查记忆状况） |
| `amnesia_audit` | `{limit?}` | 最近遗忘审计条目 |
| `amnesia_recall` | `{query}` | 想起：匹配并 touch 每条（滑动续期），返回命中记忆 |
| `amnesia_restore` | `{id}` | 从审计恢复（restorable 模式）；新 id、新 TTL、审计记 `restored` |
| `amnesia_preview` | `{}` | **干跑预览**：当前预算下将注入哪些记忆、占多少 token（不 touch），token 账本对账用 |

工具 schema 的 UI render intent：`amnesia_status` / `amnesia_audit` 走 `generic`；`amnesia_forget` 走 `generic` 并返回 diff 式摘要。

七个工具是总线协议（§6.2）的模型友好别名：`remember`→`plug`、`forget`→`unplug`、`status`→`plugs` 摘要、`audit`→拔出轨迹、`recall`→touch 批量、`restore`→审计恢复、`preview`→注入干跑。

### 6.4 注入与预算（`agent/pre-step` 钩子，time-context 同款机制）

- **机制**：`agent/pre-step` waterfall（`{agent, turn, step, signal}, next`），调用 `await next()` 后向 `decision.messages` 追加一条**持久化 user-role 快照消息**（`source: {kind:'plugin', plugin:'dsh-memory-forget', form:'snapshot', sections:[{name,text}]}`）——与 `time-context` 一致，天然满足 "model-visible ⟺ logged"（注入内容落会话日志，可重建）。
- **内容**：`AMNESIA MEMORY` 段 = 预算内择优的活记忆清单（id / kind / 剩余寿命 / content），段尾注明预算占用；无活跃记忆时不注入（零开销）。
- **择优（确定性）**：`pinned` 优先 → `strength` 降序 → `lastAccessedAt` 降序 → 依次取到 `maxInjectedTokens` 预算。**绝不截断单条记忆**（放不下就少选）；`stale` / `forgotten`（死记忆）**绝不注入**。
- **注入即访问**：被注入的记忆 `touch`（滑动续期）——反复被选中的记忆说明与当前任务相关，理应续命；`lastInjection {count, tokens, at}` 记账到 status。
- **硬预算**：`maxInjectedTokens`（默认 2000）。超限不是"截断"，而是"少选"。

### 6.5 回合末衰减（`agent/turn-stopping` 钩子）

- serial 事件，逐个 Agent 处理：对该 Agent 所属 workspace 结算衰减 → 标记 stale → 过期/触底的进入 forgotten（物理删除 + 审计）→ 触发 `amnesia/forgotten` 事件（驱动 UI 刷新）。
- 此钩子**不应阻塞回合关闭太久**：衰减是纯计算 + 少量存储写，单次上限有界（见 §6.6 的预算保障）。

### 6.6 存储与兜底扫

- **存储**：`storageDomain.open({ name: 'amnesia' })`，记录按 workspace 分桶（每条记录含 `workspaceId` 字段）。进程内维护 LRU 缓存，写透传。
- **兜底扫**：默认**不**启用后台 interval（衰减在读取与回合末已惰性结算）；Config `sweepIntervalMs` 为 `0` 表示关闭，>0 时用 `timer.interval` 启低频扫。关闭时无后台副作用，HMR/停止更干净。
- **容量上限**：`maxStoreBytes`（默认 256 KB / workspace）。写入超限时按"非 pinned → strength 升序"驱逐并审计。

### 6.7 与 `compaction` 的边界（互补，不重叠）

| | compaction | Amnesia |
|---|---|---|
| 对象 | 当前会话的对话历史 | 跨会话的显式记忆 |
| 动作 | 压缩（摘要，保留语义） | 删除（过期/淘汰） |
| 触发 | token 压力 / 手动 `/compact` | 时间衰减 / 显式 forget / 预算 |
| 结果 | 历史变短但仍在 | 记忆变少直至消失 |

两者都服务于"上下文干净"，但语义相反且不冲突；Amnesia 默认不调用 `compaction` 的任何方法。

### 6.8 配置项清单（全部 `Config` 字段，无硬编码 tunables）

```ts
Config {
  defaultTtlMs: number          // 默认 30 天；0 表示默认不过期
  defaultCurve: 'flat' | 'linear' | 'ebbinghaus'   // 默认 'ebbinghaus'
  staleStrength: number         // 0.3
  forgottenStrength: number     // 0.05
  maxInjectedTokens: number     // 2000
  maxStoreBytes: number         // 256 * 1024
  maxItemBytes: number          // 2048
  autoExpire: boolean           // true；false = 只靠显式 forget（"只忘不衰"模式）
  auditRetentionMs: number      // 90 天；审计条目（含内容哈希）保留期
  restorable: boolean           // false（隐私默认）；true 时审计保留内容副本，amnesia_restore 可插回
  promoteAfterAccesses: number  // 0 = 关；>0 时访问达标自动升级 TTL（防高频记忆短命）
  promptSectionEnabled: boolean // true
  sweepIntervalMs: number       // 0 = 关闭兜底扫
}
```

### 6.9 安全与边界

- **遗忘 vs 用户意图**：`pinned` 永不自动淘汰；显式 `amnesia_forget` 是唯一能删 pinned 的路径。自动过期永远不碰 `source: 'user'` 的 pin 项。
- **删除与恢复**：`forgotten` 默认**物理删除内容**，审计只留 `{id, kind, reason, at, contentHash}`（SHA-256）。`restorable: true` 时审计保留内容副本，`amnesia_restore` 可把记忆**原样插回总线**（新 id、新 TTL、审计记 `restored`）。可恢复与"删得干净"是显式取舍（Config 开关），默认取隐私侧；恢复动作本身留痕。
- **审计内容不进遥测**：`session-telemetry/record` 不做拦截，但 Amnesia 自己绝不把记忆内容写入 telemetry。
- **崩溃安全**：删除顺序 = 先写审计条目，再删内容记录；域存储单记录原子写。重复删除幂等（按 id 找不到即返回 0）。
- **注入预算保障**：选择过程是纯函数 + 有界循环（≤ 记忆条数），回合末扫有 `maxStoreBytes` 上界，不会拖慢 `agent/turn-stopping`。
- **生命周期纪律**：所有副作用（事件监听、工具、命令、RPC handler、timer、store 连接）都经 `ctx.on` / `ctx.effect` / 显式 disposer 注册，`cordis_stop` / update / undefine 后全部移除（HMR 安全）。
- **内部数据纪律**：MemoryItem 是库内数据；跨 RPC 只传标量视图；`amnesia_status` 返回小型 JSON，不序列化整库。

### 6.11 密度与 token 账本（成本可对账）

**密度**：不做自动抽取/改写（写入零生成成本；密度由写入者决定，`maxItemBytes` 硬上限 + 工具提示"一句话"）；密度杠杆在注入端（择优 + 预算）。

**三条成本面**：

| 面 | 成本 | 控制 |
|---|---|---|
| 写入 | 一次工具调用，无 LLM 生成 | 无抽取/总结（与 mem0 的分水岭） |
| 注入（每步） | ≤ `maxInjectedTokens`（默认 2000） | 硬预算，超限少选不截断 |
| 存储 | 本地文件，近零 | `maxStoreBytes` |

**对等机制**：滑动续期 = 自动 token-ROI 过滤器——只有"持续被使用"的记忆占预算；闲置记忆衰减离场、停止消耗。status 暴露 `injection` 账本（上次注入条数 / tokens），`amnesia_preview` 干跑预览（不 touch）；成本端（累计 token）与效果端（成功率 / 陈旧错误率）由 §11 三臂基准实证。

### 6.10 DSH 多 Agent 生态适配（作用域与自动拔出）

DSH 内部存在多类 Agent（主会话 / 子 Agent / workflow / 团队 / Ralph），各自的记忆生命周期不同。Amnesia 按 **scope 三档** 适配，并靠生命周期事件**自动拔出**：

| Agent 类型 | 默认 scope | 拔出时机 | 说明 |
|---|---|---|---|
| 主会话 Agent | `workspace` | TTL / 显式 forget | 跨会话持久，带衰减 |
| 子 Agent（一次性 subagent） | `session` | `subagent/end` / `agent/disposed` 自动拔出 | 插上即用，任务结束即拔，除非显式 promote 到 workspace |
| 子 Agent（可延续 continuable） | `session` | `subagent/end` 按策略（默认拔出；promote 才保留） | 随 child 延续，结束按策略处置 |
| workflow 子 Agent | `session` | `workflow/agent-end` 自动拔出 | 与主流程隔离，防污染 |
| 团队 Agent（teammate） | `team` | `agent/disposed` 自动拔出 | 跟随 lead session，成员共享 |
| Ralph（fresh-agent） | 无（强制零记忆） | —— | 无状态即遗忘引擎的极致形态；Amnesia 与 Ralph 互补：Ralph 给"默认无记忆"，Amnesia 给"有记忆时的过期治理" |

**原则**：
- 子 Agent 默认**不继承**主 Agent 记忆；需要时显式 `promote`（把 session 记忆升级为 workspace 作用域）。
- 自动拔出同样走审计（reason: `agent-disposed`），并触发 `amnesia/forgotten`。
- 注入侧按当前 Agent 的可见 scope 过滤：主 Agent 只见 workspace（+当前 session），子 Agent 只见自己的 session。

---

## 7. Client 设计

### 7.1 UI 位置（全部对 `Slots.listSubTree` 核对）

| Slot | scope / kind | 内容 |
|---|---|---|
| `conversation.composer.dock` | session / list | **环境读数条**（在已有 stats 行的同座区域，additive）：`🧠 12 活跃 · 3 陈旧 · 1.2k tok · 最近拔出: 2 分钟前`，悬停展开明细，点击打开面板 |
| `conversation.session.header.utilities` | session / list | **Amnesia 按钮**：打开"记忆节点视图"浮层——插在总线上的模块列表（强度 / 剩余寿命 / 作用域），每条可一键拔出；含"全部拔出"危险操作（二次确认） |
| `settings.section` | root / list | **Amnesia 设置页**：TTL 默认值、衰减曲线、注入预算、容量、auto-expire 开关、`restorable` 开关、危险区（清空本机所有 Amnesia 记忆） |
| `tool.view.cordis`（key: `self`） | session / keyed | **Run 卡片内交互面板**：插件启用后展示当前状态 + "立即扫一遍"按钮（演示用） |

### 7.2 Client→Host RPC（`harness.handle`，Package-private）

```
amnesia.status        → 标量视图（计数/token/最近遗忘）
amnesia.forget        → { id | all:true } + confirm
amnesia.audit         → 最近条目（limit ≤ 20）
amnesia.policy        → 当前生效配置（只读展示）
```

客户端**不直接读域存储**；所有数据经 RPC 的小型 JSON 视图，禁止把整库/整条 MemoryItem 数组跨 RPC。

### 7.3 刷新策略

- 回合结束（客户端感知到新 turn 完成）时刷新读数。
- 用户主动操作（点按钮、执行 forget）后立即刷新。
- 不做轮询（v1）；Host 侧未来可推 `amnesia/forgotten` 到 Client（留作 M5 优化）。

---

## 8. 事件与状态流

### 8.1 事件词汇表（Amnesia 自有事件，`ctx.emit`）

| 事件 | mode | payload | 用途 |
|---|---|---|---|
| `amnesia/written` | emit | `{id, kind, ttl}` | 记录写入 |
| `amnesia/forgotten` | emit | `{id, reason: 'expired'\|'evicted'\|'stale'\|'manual'\|'budget'\|'agent-disposed', at}` | 驱动 UI 刷新 / 审计 |
| `amnesia/injected` | emit | `{ids: string[], tokens}` | 注入留痕（也写入会话日志） |

### 8.2 正常回合时序

```
用户/模型调用 amnesia_remember
  → 校验内容与 TTL → 写入域存储 → ctx.emit('amnesia/written')
每步模型请求前（system-prompt/assemble）
  → selectForInjection(workspaceId, maxInjectedTokens)
  → 注入 AMNESIA MEMORY 段（预算内、按强度择优）
  → 追加 amnesia/injected 会话事件（model-visible ⟺ logged）
回合关闭（agent/turn-stopping）
  → 惰性衰减结算 → stale 标记 → 过期/触底 → 审计 + 物理删除
  → ctx.emit('amnesia/forgotten') → 客户端刷新读数
```

### 8.3 衰减计算（伪代码，纯函数）

```js
function settleStrength(item, now) {
  if (item.pinned) return item.strength
  const age = now - item.createdAt
  let s
  switch (item.curve) {
    case 'flat':    s = item.baseStrength; break
    case 'linear':  s = item.baseStrength * Math.max(0, 1 - age / item.ttl); break
    case 'ebbinghaus': s = item.baseStrength * Math.exp(-age / (item.ttl / 3)); break
  }
  if (item.ttl !== null && age >= item.ttl) return 0
  if (item.lastAccessedAt > item.createdAt) {
    // 访问增强（间隔效应），有界
    s = Math.min(1, s * 1.5 + 0.1)
  }
  return clamp01(s)
}
```

---

## 9. 里程碑与验收标准

### M0 —— 本设计文档（当前）
**DoD**：范围、模型、集成点、边界、配置、开放问题全部明确；用户拍板开放问题。

### M1 —— MVP（Host-only，动态插件验证引擎）
拆分子项，逐个交付：
- **M1.1 核心引擎（core）**：MemoryItem、衰减纯函数、总线 plug / unplug / plugs / inspect、淘汰+预算选择策略、审计轨迹。纯函数，可单测。
- **M1.2 服务与存储**：`ctx.provide('amnesia')` + 持久化（动态插件用 fs 文件 best-effort，正式包切 storageDomain）+ 全部 Config。
- **M1.3 工具面**：`amnesia_remember / forget / status / audit / recall / restore` 六个动态工具（总线协议别名，`harness.defineTool` + `harness.registerTool`）。
- **M1.4 生命周期钩子**：`agent/turn-stopping` 衰减扫；`agent/disposed`、`subagent/end`、`workflow/agent-end` 自动拔出（reason `agent-disposed`）。
- **M1.5 注入与日志合规**：`system-prompt/assemble` 注入 + 硬预算 + `amnesia/injected` 会话事件（model-visible ⟺ logged）。
- **M1.6 验收**：跑通 DoD 1-5（见下）。

**DoD（可验证）**：
1. `amnesia_remember(content, {ttlMs: 1})` 后过 1 秒，`amnesia_status` 显示该条已 forgotten，审计可查。
2. 注入段存在且 `maxInjectedTokens` 生效：写入超预算内容后，模型只看到预算内子集（M1.5）。
3. `cordis_stop` 后无残留监听/工具；再次 `cordis_run` 记忆仍在（持久化）。
4. 会话日志可重建出某一步注入的全部记忆内容（M1.5）。
5. 子 Agent 结束（`agent/disposed`）后其 session 作用域记忆自动拔出，审计 reason 为 `agent-disposed`。

### M2 —— Client UI
**内容**：`conversation.composer.dock` 读数条、`conversation.session.header.utilities` 按钮、`settings.section` 设置页、RPC、Run 卡片面板。
**DoD**：设置页改 TTL/预算即时生效（会话内）；"全部遗忘"有二次确认；读数在回合后自动刷新。

### M3 —— 验证与基准
**内容**：§11 的三臂基准：任务集 + 驱动脚本 + 对照报告（累计 token / 成功率 / 陈旧错误率）。
**DoD**：三臂全部跑通；在"记忆有害组"上产出 C 显著优于 B 的报告；报告附方法论与任务集。
**依赖**：M1（引擎是基准中被测物）。

### M4 —— DSH 官方 bundle + 跨 Agent 分发
**内容**：包内加 `dsh.bundle` manifest（`{patch: "./cordis.patch.yml"}`）+ `cordis.patch.yml`（insert 插件行）+ 正式 Cordis 插件适配层（工具 + 钩子 + 注入，port 自 M1 验证逻辑）。DSH 用户一条命令安装：`dsh plugin --profile <name> add @xiaoke8698/dsh-memory-forget`（官方 bundle 机制，见 DSH 文档 `docs/user/develop/basic/publish.md`）。skill + CLI 随后交付（其他 Agent 用）。
**DoD**：`dsh plugin add` 后 profile 启动即出现 amnesia 工具与注入；`--dump-config` 可见本 bundle 层；用户 patch 可覆盖其 config（层序语义）。

### M5 —— 增值（可选，独立评审）
**内容**：`/amnesia` 人类命令；自动建议（opt-in，仍不自动写入）；记忆节点可视化面板深化（§7 之外的全屏视图）。

### M6 —— 远期（延后，不做承诺）
**内容**：MCP server（`dsh-memory-forget-mcp` bin）。延后理由：MCP 需要服务端进程，"谁来托管、如何保活"是运维负担；本地 skill+CLI 已覆盖跨 Agent 诉求。届时再定存储与托管（Q6）。

### 演进路径
设计稿（本文）→ M1 以动态 Cordis 插件验证引擎 → 已发布 v0.1.0（core 库，npm）→ M4 加 `dsh.bundle` 正式插件适配层（官方 bundle 机制，`dsh plugin add` 安装）→ skill + CLI（其他 Agent）→ 单仓库发布（MCP 远期，见 Q6）。

---

## 10. 形态矩阵（跨 Agent 分发）

### 10.1 命名与可发现性（GitHub 检索）

**正式名：`dsh-memory-forget`**（npm 包 `@deepseek-ai/dsh-memory-forget`）；"Amnesia" 仅作代号/口头昵称，不进正式命名。

GitHub 检索机制下的命名决策（参考 [GitHub 仓库搜索文档](https://docs.github.com/zh/search-github/searching-on-github/searching-for-repositories)与 [GitHub SEO 实践](https://www.gitdevtool.com/blog/github-seo)）：

- 仓库检索主要命中 **名称、description、topics**，README 全文另被内容检索覆盖——**四个面都要铺关键词**。
- **"memory" 必须留在仓库名里**：它是本类别最高频搜索词，搜 "memory" 进来的流量恰好是目标用户（找记忆插件 → 看到遗忘的另一面）。换成萌系代号（如 amnesia）会直接丢掉这部分流量。"简单直白"的直觉是对的。
- "forget" 与 "forgetting" 是两个词元，README 首段必须同时出现。
- **topics 是检索杠杆**（GitHub 为 topics 建索引）：首批 `memory`、`forgetting`、`agent-memory`、`llm-agents`、`ai-agents`、`mcp`、`mcp-server`、`memory-management`、`memory-eviction`、`amnesia`、`deepseek`、`context-management`、`privacy`。
- **description 一句话带货**：`Forgetting engine for AI agents — memory TTL, decay, eviction, audit. The opposite of memory programming. DSH plugin + local skill + CLI.`（"skill" 与 "CLI" 是跨 Agent 搜索词；"mcp" 词保留在 topics 供远期。）
- **README 首段铺问题域关键词**：自然出现 "memory forgetting"、"memory eviction"、"memory TTL"、"memory expiry"、"anti-memory"、"agent memory management"。

### 10.2 形态（一个包，四副面孔）

**架构原则：一个引擎，多副面孔。** 所有形态共享同一个 core（记忆模型 + 衰减 + 策略，零依赖纯 TS），差异只在适配层。这样"遗忘逻辑"只有一个实现，不存在各端行为漂移。**发布面收敛为一个仓库 + 一个 npm 包**。

**跨 Agent 首选：skill + 本地 CLI 组合，不选 MCP。** MCP 需要服务端进程——谁来托管、如何保活、失败怎么恢复都是包袱；而 skill 是文件级指令、CLI 是本地可执行，**零服务端、零网络依赖，本地运行即最优解**。MCP server 整体延后（M6），不作为当前承诺。

| 形态 | 交付物 | 面向 | 说明 |
|---|---|---|---|
| core | 包内 `src/core` 导出 | 开发者 | 逻辑真源：MemoryItem 模型、衰减、淘汰、注入选择 |
| `@xiaoke8698/dsh-memory-forget`（Cordis 插件 = DSH bundle） | npm 包 + `dsh.bundle` + `cordis.patch.yml` | DSH 用户（`dsh plugin add`） | 官方 bundle 机制：插件行插入 profile 组合，工具/钩子/注入/Config 全挂载；用户 patch 可覆盖（§10.4） |
| skill 包（`SKILL.md` + CLI bin） | 目录：SKILL.md + bin | Claude Code / Codex / DSH 等任何 Agent | **指令层（skill）+ 执行层（CLI）本地组合**，复制即用，无服务端（§10.3） |
| `dsh-memory-forget`（bin） | CLI | 脚本 / CI | `dsh-memory-forget status`、`dsh-memory-forget audit --project X`、`dsh-memory-forget forget --all`；skill 与脚本共用 |
| `dsh-memory-forget-mcp`（bin，远期） | MCP stdio server | 延后（M6） | 需要服务端托管，暂不承诺；届时再定存储与托管 |
| bench | 评测脚本 + 报告 | 验证 | §11 三臂对比，输出对照报告 |

**要点**：

- **三层关系**：原生插件 = 强制层（注入/日志/UI 硬保证）；skill = 指令层（教 Agent 何时记、怎么忘）；CLI = 执行层（本地落地）。其他 Agent 拿到"指令 + 执行"，DSH 拿到全部三层。
- 对称性彩蛋（延后）：DSH 的 `examples/mcp-memory` 演示"DSH 消费第三方记忆 MCP"；未来 MCP 版可让 DSH 和其他 Agent 消费同一个遗忘服务。
- MCP 存储选型（文件 vs SQLite）届时再定（Q6）。

### 10.3 skill 分发设计（本地组合）

**格式**：`SKILL.md` = YAML frontmatter（`name` + `description`）+ Markdown 正文——即 [Anthropic Agent Skills](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview) 规范，Claude Code / Codex / DSH 的 skill 机制均按此读取（本仓库 `apps/cli/config/agent-presets/cordis/skills/*/SKILL.md` 即此格式）。

**安装**：用户把 skill 目录复制到目标 Agent 的 skills 目录即可，无服务端、无网络：
- Claude Code：`~/.claude/skills/dsh-memory-forget/`（或项目 `.claude/skills/`）
- DSH：skills 目录挂载
- Codex：skills / AGENTS.md 引用
- Cursor：随其 Agent 能力支持跟进

**SKILL.md 正文要点（指令层）**：
- 默认立场：不主动记，只有用户明确要求才记。
- 记住必须带 TTL：`dsh-memory-forget remember "<内容>" --ttl 7d --kind preference`。
- 任务/会话收尾自查：`dsh-memory-forget status`，对每条活跃记忆问"还成立吗"，不成立即 `forget <id>`。
- 陈旧优先于精确：遇到与记忆冲突的新事实，先 `forget` 旧的再 `remember` 新的。
- 拔插纪律：子任务/子 Agent 的临时记忆用 `--scope session`，任务结束即拔出；只有值得跨会话保留的才升级 `--scope workspace`。
- 隐私：`audit` 查看遗忘轨迹；默认不留内容副本。

**与原生插件的边界**：skill+CLI 是"建议 + 执行"，遵守程度取决于模型；需要硬保证（强制注入、会话日志合规、UI）的场景用 DSH 原生插件。

---

### 10.4 DSH 官方 bundle（插件分发机制）

DSH 的官方第三方插件分发 = **bundle**：一个声明 `dsh.bundle` 的 npm 包（含 `cordis.patch.yml` 配置层 + 插件代码），用户经 `dsh plugin --profile <name> add <包>` 安装进 profile 组合（见 DSH 文档 `docs/user/develop/basic/publish.md`）。

- **安装**：`dsh plugin --profile <name> add @xiaoke8698/dsh-memory-forget`（发 npm 带构建产物即可；git 直装需 `prepare` 脚本 + 用户放行构建）。
- **层序**：profile bundles 按序 → 用户 `cordis.patch.yml` → 首页级 → `--patch`；后层按 id **整行替换** config（不深合并）——本插件默认值保持保守，用户可覆盖。
- **插件入口**：`export const name` + `export function apply`（Cordis 函数插件），patch 行 `name` 引用 npm 包名。
- **与核心库的关系**：同一 npm 包可以既是库（导出 core）又是 bundle（声明 `dsh.bundle`）——`dsh plugin add` 激活插件层，普通 `npm install` 时只是库。

---

## 11. 验证与基准（数据对比）**为什么必要**：记忆类产品的宣传全是"记忆让 Agent 更好"；本插件的主张恰恰相反——**不加治理的记忆会让 Agent 随时间变差**（陈旧、污染、上下文膨胀）。没有数据，这个主张只是口号。**基准是产品的一部分，不是事后验证。**

### 11.1 实验设计（三臂对照）

同一任务集 × 同一模型 × 三个条件，仅改变生命周期策略：

| 臂 | 条件 | 说明 |
|---|---|---|
| A | 无记忆 | 每任务全新上下文（Ralph 式冷启动） |
| B | 全记忆 | 写入即永久（典型记忆插件行为，不遗忘） |
| C | Amnesia | 写入带 TTL + 衰减（本插件） |

**公平性关键**：B 与 C 使用**同一个存储与检索**（确定性强度择优），只切换"遗忘策略"开关。这是 Amnesia 独有的 A/B 能力——记忆厂商无法"关掉自己的记忆"做对照。

### 11.2 指标

| 指标 | 含义 |
|---|---|
| 累计上下文 token | 上下文膨胀的直接度量（对齐 `token-meter` 与仓库 README 的 token/KV-cache 记录义务） |
| 任务成功率 | 遗忘没有牺牲完成质量（证明"忘得值"） |
| **陈旧错误率** | 核心指标：写入的事实中途改变（如"验证饮品从 lapsang 换成 oolong"），各臂使用旧事实的比例 |
| 步数 / 耗时 | 效率 |
| 记忆召回收益 | "记忆有帮助"任务（多轮偏好、重复上下文）上 C 是否仍保留收益 |

### 11.3 任务集

- **记忆有帮助组**：多轮偏好延续、重复项目上下文、长任务状态。
- **记忆有害组**：事实变更、过期约束、被投毒记忆（引入 §1 记忆安全研究的攻击案例）。
- **混合组**：两者交替出现（最接近真实使用）。

### 11.4 工具化与诚实声明

- 基准脚本驱动 N 个会话/臂，从**会话日志**提取指标（DSH "model-visible ⟺ logged" 保证可重建），输出对照报告。
- 仓库已有 snapshot / e2e 测试文化，基准可作为 examples/ 下的可运行组合（如 `pnpm run bench:amnesia`）。
- **诚实声明义务**：结果与任务集强相关，报告必须附方法论与任务集，不宣称普适结论。

---

## 12. 开放问题（待用户拍板）

- **Q1 遗忘激进程度**：默认 30 天 TTL + 自动过期（激进，"默认会忘"）vs 默认不过期 + 只靠显式 forget（保守，"记住但可删"）？—— 直接影响产品气质与默认体验。
- **Q2 自动抽取**：是否要 opt-in 的"自动建议记住"（监听用户明确请求，仅建议不写入）？做则接近"记忆插件"，与反记忆立场有张力。
- **Q3 语义检索**：v1 只做强度择优；是否接受未来加 embedding 检索（改变零依赖承诺）？
- **Q4 目标用户**：个人隐私向（默认删干净）还是工程效率向（防上下文污染）？影响默认配置。
- **Q5 基准任务集**：自建任务集 vs 引用公开基准（如 GAIA 类）？谁维护？（影响 §11 可信度与工作量）
- **Q6 分发形态**：已收敛为单仓库单包；跨 Agent 走 skill+CLI（§10.3），**MCP server 整体延后（M6）**，其存储/托管选型届时再定。

---

## 13. 架构总览

### 13.1 分层组件

```
┌─────────────────────────────────────────────────────────────────┐
│ dsh-memory-forget（一个 npm 包 @deepseek-ai/dsh-memory-forget）  │
│                                                                 │
│  src/core/        零依赖纯 TS（逻辑真源）                        │
│    memory.ts        MemoryItem 模型 + 校验                       │
│    decay.ts         衰减曲线纯函数（flat / linear / ebbinghaus）  │
│    bus.ts           记忆总线：plug / unplug / plugs / inspect     │
│    policy.ts        淘汰策略 + 注入预算选择（确定性）             │
│    audit.ts         审计轨迹（哈希，不存内容）                    │
│                                                                 │
│  src/host/        Cordis 插件（DSH 原生 = 强制层）               │
│    service.ts       ctx.provide('amnesia', …)                    │
│    tools.ts         amnesia_remember / forget / status / audit   │
│    hooks.ts         turn-stopping 衰减 / disposed 自动拔出        │
│                     subagent-end / workflow-agent-end            │
│    inject.ts        agent/pre-step 注入快照消息 + 预算 + 日志    │
│    config.ts        Config schema（全部可配）                     │
│                                                                 │
│  src/client/      Client UI（M2）                                │
│  bin/             dsh-memory-forget CLI（M4）                    │
│  skill/           SKILL.md（M4）                                 │
│  bench/           三臂基准（M3）                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 13.2 数据流（一次 plug → 注入 → 拔出）

```
模型调用 amnesia_remember
  → tools.ts → bus.plug() → 校验（TTL / 预算 / scope）→ 写存储 → amnesia/written
每步模型请求前（agent/pre-step）
  → inject.ts → policy.selectForInjection(scope, budget)
  → 追加 AMNESIA MEMORY 快照消息（持久化 user-role，touch 注入项）
  → 记账 lastInjection（count / tokens / at）
回合关闭（agent/turn-stopping）
  → decay 结算 → 过期/触底 → bus.unplug(强制) → 审计 + amnesia/forgotten
Agent 消亡（agent/disposed / subagent/end / workflow/agent-end）
  → bus.unplugByOwner(session scope) → 审计（reason: agent-disposed）
```

### 13.3 依赖与边界原则

- **core 零依赖**：不依赖 Cordis、LLM、embedding；纯函数可单测。
- **host 只依赖**：Cordis ctx + `fs`（M1 临时）/ `storageDomain`（正式包）+ `agents`（取调用者作用域）+ `systemPrompt`（注入）。
- **适配层独立**：DSH 插件、CLI、skill 各自只做适配，共享 core；行为不漂移。
- **不引入**：llm、embedding、网络、服务端进程（MCP 延后）。

---

## 14. 最小真实验证（M1 动态插件，运行实录）

**场景：陈旧事实按计划死亡，新事实存活**（对应 §11 的"陈旧错误率"核心指标）。

```
清空 → remember "验证饮品是 lapsang"（TTL 15s）
     → remember "验证饮品已更换为 oolong"（TTL 600s）
status → active: 2，nextExpiryAt = lapsang 到期时刻
等 17s → status → active: 1（oolong 存活），forgotten: 1（lapsang 已死）
audit  → 上一轮 1.5s TTL 记忆已入审计（reason: expired，只留哈希）
```

**结论**：在 naive "全记忆"系统里两条冲突事实会永远共存，模型可能拿旧的 lapsang 误导用户；Amnesia 下旧事实**到点即死**，从注入面上消失（M1.5 落实为 prompt 硬过滤）。同时验证了：手动拔出、pin 免疫、回合末自动扫、审计只留哈希、fs 持久化（update 重启后记忆仍在）。

---

## 附录 A：生态缺口对照（本文档依据）

| 声称 | 证据 |
|---|---|
| 无第一方记忆/遗忘能力 | `packages/` 与安装 profile 无 memory 包；`examples/mcp-memory` 仅第三方 MCP 引用配置，默认关闭 |
| 有压缩无删除 | `compaction` 族（压缩）、`output-retention`（留存）；无 TTL/过期/淘汰服务 |
| 工具名无冲突 | `Tool.listTools` 已核对：`amnesia_*` 四名均未被占用 |
| 集成点真实 | Host `system-prompt/assemble`（waterfall）、`agent/turn-stopping`（serial）、`storageDomain`、`harness.registerTool`、Client `conversation.composer.dock` / `settings.section` / `tool.view.cordis`(self) 均来自运行时 Inspect |
| 反记忆有据可依 | CUHK/ZJU 记忆污染研究、MemArchitect、AI Amnesia spec（见 §2.2 链接） |
| M1 集成点已核对 | `harness.defineTool` 需 `output{schema,render}+execute`（core/tools schema.ts）；参数 DSL 白名单见 cordis-host-runner guard.ts；`storageDomain.open` 需 defineDomain zod spec（动态插件不可 import → M1 用 fs 文件存储，正式包切 domain） |
