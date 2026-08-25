# dsh-memory-forget — AI Agent 遗忘引擎

> [English](README.md) · [中文](README.zh.md)

> **记住更少，想得更清。**
>
> AI Agent 遗忘引擎：记忆 TTL、衰减、淘汰、审计。记忆编程的反面。零依赖核心，MIT 协议。

记忆编程席卷 Agent 生态（Mem0、Letta、Engram 都在教 Agent 记住一切），dsh-memory-forget 做的是**它的反面**——把"遗忘"从意外变成设计：每条记忆都有保质期、到点即死、全程审计、注入有硬预算、拔得干净。

**一句话差异**：记忆引擎回答"怎么存得好、找得准"；dsh-memory-forget 回答"**什么时候该忘、哪条还可信、放多少进上下文、里面到底有什么**"。

这不是抬杠，是有依据的：[Agent 用得越久越笨，记忆污染是主因（CUHK & ZJU）](https://eu.36kr.com/en/p/3815882774011653#1)；记忆投毒是真实攻击类（[单封邮件持久投毒](https://labs.cloudsecurityalliance.org/research/csa-research-note-memghost-agent-memory-poisoning-20260723-c/)、[隐形记忆注入](https://icml.cc/virtual/2026/poster/66667)）。遗忘不是记忆的故障，是记忆的治理。

---

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

**持久化**：引擎是内存态，提供 `StoreAdapter` 即可落盘（示例见英文版 README）。

### API

| 方法 | 含义 |
|---|---|
| `plug(input)` | 记住（TTL / pin / scope / tags） |
| `unplug(filter)` | 遗忘（按 id / 关键词 / 标签）——物理删除 + 审计 |
| `touch(id)` | 访问：重置衰减时钟（滑动续期） |
| `recall(query?)` | 想起：匹配并续命 |
| `restore(id)` | 从审计恢复（restorable 模式） |
| `selectForInjection(budget)` | 预算内选择；死记忆排除 |
| `preview()` | 注入干跑预览（token 账本，不 touch） |
| `status()` | 计数 + token 占用 + 下次过期 + 最近审计 |
| `auditView(limit)` | 遗忘/恢复轨迹（只留哈希） |
| `sweep()` | 结算并清除过期记忆（回合末调用） |

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

**v0.2.1 包含核心引擎 + DSH 官方 bundle**（`AmnesiaEngine` + Cordis 插件适配层）。未包含：CLI、skill、MCP server、Client UI、基准结果。

- [x] M0 设计定稿
- [x] M1 动态插件验证（DSH 会话级）
  - [x] M1.1 核心引擎　[x] M1.2 服务与存储　[x] M1.3 工具面（7 工具）
  - [x] M1.4 生命周期钩子　[x] M1.5 注入与预算　[ ] M1.6 验收（子 Agent 自动拔出待实测）
- [ ] M2 Client UI　[ ] **M3 三臂基准**　[ ] **M4 DSH 官方 bundle（已发 0.2.1）**　[ ] **M4b skill + 本地 CLI**　[ ] M5 增值　[ ] M6 MCP server（远期）
- [ ] 开放问题：Q1 遗忘激进度 / Q2 自动抽取 / Q3 语义检索 / Q4 目标用户 / Q5 基准任务集 / Q6 分发形态

## 其他 Agent 整合

**DSH 用户：官方 bundle（已发布 0.2.1）**——一条命令安装：

```sh
dsh plugin --profile <name> add @xiaoke8698/dsh-memory-forget
```

如果 npm 镜像源还没同步（会解析到旧版），pin 版本 + 官方源：

```sh
dsh plugin --profile <name> add @xiaoke8698/dsh-memory-forget@0.2.1 --registry=https://registry.npmjs.org/
```

（官方 bundle 机制：npm 包 + `dsh.bundle` + `cordis.patch.yml`，见 DSH 文档 `docs/user/develop/basic/publish.md`。）

**卸载**——从 profile 移除插件（同时移除依赖与配置层）：

```sh
dsh plugin --profile <name> remove @xiaoke8698/dsh-memory-forget
```

记忆存储在 workspace 的 `.dsh-memory-forget/store.json`（默认）。移除插件**不会**删除该文件——要彻底清空记忆与审计副本（隐私），删除 `.dsh-memory-forget/` 目录即可。

**规划中（M4b）**：skill + 本地 CLI（SKILL.md 复制即用，零服务端）。**远期（M6）**：MCP server（需服务端托管，不做承诺）。当前 npm 包 = 核心引擎 + DSH 官方 bundle；DSH 动态插件是会话级验证形态。

## 文档与相关研究

- 完整设计文档：[docs/design.md](docs/design.md)（§13 架构总览、§14 最小真实验证实录）
- 生态依据：DSH 有 `compaction`（压缩）但无删除/过期/淘汰语义；记忆系统仅第三方 MCP 示例（默认关闭）
- [记忆污染使 Agent 变笨（CUHK & ZJU）](https://eu.36kr.com/en/p/3815882774011653#1)　·　[记忆治理：MemArchitect](https://ar5iv.labs.arxiv.org/html/2603.18330#1)　·　[记忆投毒：MemGhost](https://labs.cloudsecurityalliance.org/research/csa-research-note-memghost-agent-memory-poisoning-20260723-c/) / [MemIncept](https://icml.cc/virtual/2026/poster/66667)
