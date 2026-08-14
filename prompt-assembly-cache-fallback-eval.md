# DeepSeek Harness：提示词组装、历史投影、缓存命中与各级 Fallback

评估范围：`dsh-system-prompt`、`dsh-agent-loop`、`dsh-session`、`dsh-llm` / `dsh-llm-deepseek` / `dsh-llm-retry`、`dsh-compaction-basic`，以及会改写模型可见输入的 context 插件。结论对应当前源码与已落地 Agent Note，不是路线图。

当前 harness **没有「主模型失败就切备用模型」这条链路**。它做的是另一套：把每次请求做成日志可重建的稳定前缀，再用同路由重试、上下文压缩、以及若干局部回退把失败接住。

## 1. 一次模型请求怎么被拼出来

每个 step 的请求是三块拼在一起的：

| 块 | 来源 | 是否进 `deriveMessages()` |
|---|---|---|
| 系统提示词 + 工具 schema | `ctx.systemPrompt.assemble()` → `renderPrompt()`，记入 `request/header` | 否，作为请求信封单独挂上 |
| 动态 runtime context | 同一次 assemble 的 `PromptContext`，由 loop 投影成 user 消息 | 是，但只在内容变化或被 compaction 清掉时追加 |
| 历史消息 | `session.deriveMessages()` 投影当前 surface | 是 |

Turn 顺序（见 `docs/architecture.md`）：

```text
turn/start
  claim inbox + assemble(sections, contexts, tools)
  -> agent/pre-step          # 压力 compaction、指令/skill/时间等可改写进入消息
     step/start
     append entered user/message
     deriveMessages()
     agent/request           # 只改 provider/model/effort 等 call config
     request/header + request/context
     llm/stream
     失败则 agent/request-error   # overflow compaction / llm-retry
```

设计原则写在 [reconstructable-requests](.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)：**模型可见 ⟺ 日志可重建**。前缀缓存命中是这条原则的推论，不是单独维护的第二套状态。

## 2. 提示词组装：作用与评价

### 2.1 它实际做什么

`ctx.systemPrompt` 是注册表，不是手写大字符串：

1. **Section**（系统提示词正文）
   按 `order` 拼接。约定：`-100` harness 身份、`0` 部署 persona、`100–199` 工具指导。
   工具包各自登记 `tool:bash`、`tool:read` 等；persona 可由 agent 作用域覆盖全局。
   `complete: true` 的段在 waterfall 之后成为唯一系统提示词。

2. **Variable**
   `{{model}}`、`{{cwd}}` 由 loop 提供；渲染是严格的，未知或空值直接抛错。

3. **Tools**
   schema 是 assembly 的一部分。`toolOrder` 在 waterfall 之前规范化顺序；缺省按名字字典序。

4. **PromptContext**（动态 runtime context）
   和 section 分开。approval、sandbox 等易变策略走这里，避免改系统提示词前缀。

5. **`system-prompt/assemble` waterfall**
   专家扩展点。`complete` 段在 waterfall 之后强制恢复，listener 改不掉。

Loop 每 step 都重新 assemble，再和上次 `request/header` 做值比较；变了才记 `reason: 'change'`。不依赖 `system-prompt/change` 信号，避免漏通知。

### 2.2 当前贡献者（产品树上）

**系统段（稳定前缀）：**
`harness:identity`、`deployment:persona`、各工具指导、`plan:policy`（plan 开启时才非空）、Code Mode 的 collapse/sdk 段。

**动态 context（历史尾部快照）：**
`approval:policy`、`sandbox:policy`、子代理 `subagent:delegation`。

**不进系统提示词、进 user 历史的上下文：**

- `dsh-agent-instructions`：`<system-reminder>` 包一层 AGENTS.md 链
- `dsh-tool-skill`：skill 目录，digest 变了整表替换
- `dsh-time-context`：默认关闭；Schedule Web 会打开，按 step 注入时间

### 2.3 评价

**强：**

- 稳定前缀和易变状态拆开了。审批/沙箱改策略只追加 snapshot，不改系统提示词，这是为缓存专门做的。
- 严格插值和 fail-loud 的 `toolOrder` 避免静默发出坏提示词。
- 作用域覆盖干净：子代理可以换 persona，不影响父会话。
- Plan mode 故意不改工具列表，只改 `plan:policy` 段，避免 schema 集合抖动。

**弱 / 代价：**

- `plan:policy` 仍在 **system section** 里。进出 plan mode 会从该段起打断系统提示词前缀缓存。工具 schema 稳住了，系统正文没有。
- 同 `order` 的 section 按插件加载顺序决胜，是已知的非确定性；工具顺序已经规范化，section 没有。
- `{{model}}` / `{{cwd}}` 若写进 persona，换模型和换目录会整段重算系统提示词。
- 没有用户级「编辑系统提示词」API；部署 persona 只能走 config/composition。这对缓存是好事，对产品可配性是限制。

## 3. 历史消息处理：作用与评价

### 3.1 投影规则

日志是唯一真相。`deriveMessages()` 只投影 surface 上的三类事件：

| 事件 | 投影 |
|---|---|
| `user/message` | 原文，含人话、inject、steering、runtime snapshot、AGENTS.md、skill 目录、compaction checkpoint |
| `assistant/message` | 原文；**空 content 丢弃**（只带 usage 的 max-tokens 锚点） |
| `tool/result` | 原文 |

chunk、turn/step 边界、`request/header`、`llm/retry`、`todo/write`、hook 记录都不进模型历史。Surface 被 `replace` 后，被影子盖住的节点从投影里消失，原始日志仍在。**没有 raw-log fallback。**

DeepSeek 序列化还有一层：带 tool call 的 assistant 才回传 `reasoning_content`；纯文本轮次丢掉 reasoning，省 token、也少扰动后续前缀。

### 3.2 进入历史的通道

| 通道 | 时机 | 典型内容 |
|---|---|---|
| `followup()` | 下一 turn | 用户新消息 |
| `steer()` | 下一 step，会唤醒 | 人打断 |
| `inject()` | 下一 step，不唤醒 | 文件变更、cron |
| `agent/pre-step` 改写 enter batch | 当前 step | runtime context、AGENTS.md、skill 目录、time-context |
| compaction `replace` | 压力或 overflow | `<compacted-summary>` checkpoint |
| tool-result pruner `replace` | 压力/overflow 且装了 pruner | 缩短过大的 tool 结果 |

Crash recovery 会补合成结果：`TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` / `ABORTED_BEFORE_DISPATCH`，避免历史里留下半截 tool call。

### 3.3 评价

**强：**

- 投影是纯函数，和 invariant 重建用同一条 `deriveEventMessage`。请求不是「当时内存里碰巧长什么样」。
- Surface + replace 把 compaction 做成位置替换，而不是另起一套历史存储。
- 动态目录/指令用「完整替换消息」而不是改旧消息，符合 append-only，旧前缀可继续命中。
- Compaction 之后，AGENTS.md / skill catalog 会在下一轮 pre-step 重挂，避免「压缩把目录吃掉、模型再也看不见」。

**弱 / 代价：**

- 动态上下文都堆在 **user 历史**里。审批、沙箱、skill 目录、时间戳、指令更新都会让输入变长，直到 compaction。系统前缀保住了，尾巴会胖。
- `time-context` 默认每 step 一条（Schedule overlay 不设 interval）。时间戳几乎必然是新 suffix，这是对的，但会稳定消耗每步增量。
- 历史里没有「按 role 裁剪 / 丢掉旧 tool 结果」的通用层，只有 compaction + 可选 pruner。
- 空 assistant 消息不进历史是对的，但失败的模型尝试也没有 assistant 消息——重试看到的是同一条旧历史，这是刻意设计，不是漏记。

## 4. 缓存命中：设计意图与实际效果

### 4.1 设计意图

DeepSeek 侧是 **自动前缀缓存**（测试按 64 token 块粒度来写）。Harness 不发 `cache_control` 之类显式标记，靠「相邻请求字节级前缀相同」吃饭。

为了让这个成立，做了这些约束：

1. 请求 = `foldRequestHeader(log)` + `deriveMessages()`，禁止 listener 改已经拼好的请求。
2. 易变策略进 runtime context，不进 system section。
3. Plan mode 保持工具 catalog 不变。
4. Compaction 摘要请求 **原样回放** 被影子盖住那段的 system + tools + messages，只在末尾加压缩指令，好复用热前缀。
5. `request/header` 用全量快照 + 值相等，不用 delta；legacy `reason: 'fallback'` 直接拒绝。
6. 真 API e2e：`packages/core/agent-loop/tests/request-cache.e2e.ts` 要求第一步之后每次 `cacheReadTokens > 0`。
7. UI 用 `cacheReadTokens / (input + cacheRead + cacheWrite)` 显示命中率。

### 4.2 什么会打断前缀

| 变化 | 从哪里开始 miss |
|---|---|
| 普通追加 user/assistant/tool | 新消息之前仍命中 |
| 系统提示词 / 工具 schema / call config 变 | 第一个不同的请求 token |
| Compaction / prune `replace` | 第一个被替换的历史 token |
| 换 provider/model | 整条前缀（另一条路由的 cache） |
| 进出 plan mode | `plan:policy` 段起的系统提示词 |
| 换审批/沙箱策略 | 新 snapshot 之前仍命中 |
| Skill 目录变更 | 新 catalog 消息之前仍命中 |

### 4.3 评价

**强：**

- 把缓存做成可重建性的推论，比单独维护「会话客户端缓冲区」稳。日志、重放、fork、缓存共用一个投影。
- Runtime context 拆分是对的：策略切换不应毁掉整段系统前缀。
- 压缩摘要请求主动对齐上一跳 routed request，这是少见的、做对了的细节。换 summarizer 模型或压非头部区间会主动放弃这次复用，文档也写清楚了。
- 有带 key 的真实命中测试，不是只靠 mock 证明「数组是 append 的」。

**弱 / 缺口：**

- **没有显式 cache breakpoint。** 完全依赖提供商自动前缀。换到需要 `cache_control` 的提供商，当前 adapter 接不上。
- **没有命中率 SLO，也没有 miss 归因。** 生产上只能看 `assistant/message.usage.cacheReadTokens`。header change、compaction、plan 切换都会掉命中，但没有把原因标到 usage 上。
- Plan mode 的系统段仍会打穿最贵的那截前缀。若把 plan 规则改成 runtime context / user snapshot，进出 plan 会便宜很多。
- 子代理是新 session，不继承父会话 KV。合理，但委托密集时缓存收益接近零。
- DeepSeek 不报 cache-write；计量只有 read。计费展示是对的，但看不出「这次写了多少 cache」。
- 64 token 粒度只写在 e2e 注释里，运行时不按块对齐。短系统提示词可能整段都不够一块。

## 5. 「模型 Fallback」与各级 Fallback

先说清楚：**没有模型级 failover。**
`agent-default-model` 只给新 Agent 一个默认 `{provider, model}`。已有会话跟 `request/header` 里最后一次路由走。主模型 5xx、额度、空响应时，**不会改切到另一个模型**。`agent/request` 可以改路由，但产品树里没有「失败后换模型」的插件。

实际存在的是下面这几层。

### 5.1 总图

```text
拼请求失败（无 provider/model、assemble 抛错）
  → 直接关 turn，无 retry

llm/stream 成功
  → 记 assistant/message，继续工具 / 结束

llm/stream 失败（终态 error/aborted）
  → agent/request-error waterfall（注册顺序 = 外包内）
       ① dsh-llm-retry          # 先看到
       ② dsh-compaction-basic   # 后注册，是 retry 的 downstream
       ③ 默认：不处理 → 原失败成为 turn error
```

Base bundle 里 `llm-retry` 在 `compaction-basic` 之前注册。Waterfall 是 around-middleware：先注册的先看到事件。

### 5.2 第 0 层：路由与配置回退

| 场景 | 行为 |
|---|---|
| 新会话没有选模型 | `agent-default-model`（默认 `deepseek-official` / `deepseek-v4-flash`） |
| 恢复会话 | 沿用日志里的 header；`AgentOptions` 只在同路由上恢复未标记的 effort |
| `prepareCall` 得到 `NO_ADAPTER` | 保留 proposed config，让 `llm/stream` middleware 有机会接管；没人接就终态 `NO_ADAPTER` |
| DeepSeek 容量 | 精确模型 `contextWindow` → `defaultContextWindow`（默认 1_000_000）→ 没有就不报容量 |
| Reasoning | 请求值 → adapter 默认 `high`；`thinking: disabled` 锁死为 off |
| 摘要模型 | 显式 `summarizationProvider/Model` → **最近一次已记录路由** → `AgentOptions` |

压力检测 **故意不用** `AgentOptions` 当回退：没有已完成的 routed request 就什么都不做。这是对的，避免还没走过模型就按错误窗口去压历史。

### 5.3 第 1 层：同路由重试（`dsh-llm-retry`）

适配器一次 `stream()` = 一次提供商调用，自己不做库级重试。重试发生在 **已关闭的失败 step 之后**，新开 numbered turn，历史不变。

默认（bundle 未覆盖 `retryPolicy`）是 **normal**：

- 最多 2 次
- 只重：`EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`
- 500ms–10s 指数退避 + 10% jitter
- 合法的 `Retry-After` 可替换本地退避；超过 `maxDelayMs` 则 normal 放弃

`always` 模式（README 示例有，**不是** shipping 默认）：

- 先 `next()`，让 compaction 等下游先处理
- 下游不 retry，则对 **所有** 失败无上限重试，包括 AUTH / QUOTA / `CONTEXT_WINDOW_EXCEEDED`

重试本身不可见：不把错误或半截输出写进 `deriveMessages()`。同一条前缀再发一次，**有资格命中 cache**。

### 5.4 第 2 层：上下文溢出（`dsh-compaction-basic`）

两条入口：

**A. 预防（`agent/pre-step`）**

1. 读最近 routed 模型的容量和 `modelPolicies`
2. `tokenMeter` 量当前信封 + surface
3. 低于阈值：不动
4. 超过：可选 `toolResultPruner`（无模型）→ 再量一次 → 还超再摘要
5. 操作失败：打 warn，**带着过长历史继续**，不挡 turn

**B. 确认溢出（`agent/request-error`，仅 `CONTEXT_WINDOW_EXCEEDED`）**

1. 不看容量元数据，绕过普通阈值
2. 先 prune，再尽量压掉头部、留下最新不可分割单元
3. `replaceGeneration` 前进才允许 retry（prune 成功、摘要失败也算）
4. `maxOverflowRetries` 默认 1
5. 没进展 / 取消 / 非规范错误：把 **原来的提供商错误** 往下传

和 retry 的配合：

- **normal + 溢出码**：溢出不在 retryable 集合里，retry 会 `next()`，compaction 能接到。
- **always**：retry 先问 downstream，compaction 仍能先动手；compaction 没进展，always 会开始无上限重试同一个溢出请求。这是已记录的风险。

### 5.5 第 3 层：摘要与计量的局部回退

| 层 | 回退 |
|---|---|
| 摘要目标 | 配置对 → 最近路由 → AgentOptions；三者都空则抛错 |
| 容量缺失 | 自动压力：该路由 warn 一次，全量历史继续；手动量压力：配置错误 |
| token 估算 | 没有可复用的 provider usage 时，用字符数 + 结构开销 |
| 时区 | 请求里唯一的浏览器时区 → config `timeZone` → 进程 `TZ` |
| 未知 content block | DeepSeek adapter 走文档里的 extension fallback；核心 image 则显式拒绝 |
| 空 completion | 不是成功，是可重试的 `EMPTY_RESPONSE` |

### 5.6 评价

**强：**

- 分层清楚：瞬时错误走 retry，窗口错误走 compaction，配置错误 fail loud。没有「再猜一次模型」这种隐式行为。
- Overflow 用 `replaceGeneration` 当进展证明，避免「compact 说成功但模型可见状态没变」却还去 retry。
- Prune 可以单独救命，不必每次溢出都再打一轮摘要。
- 失败请求不污染历史，retry 仍能吃 KV cache。
- 空响应当成错误而不是成功，避免模型静默停住。

**弱 / 缺口：**

1. **没有跨模型 / 跨提供商 failover。** 额度、鉴权、某模型持续 `SERVER`，会话就停。产品若要「Flash 挂了走 Pro / 另一个网关」，今天得自己在 `agent/request-error` 上写插件，还要接受换路由会打穿 cache。
2. **`always` 和不可恢复溢出叠在一起很危险。** Shipping 默认是 normal，所以默认组合是安全的；谁按 README 示例打开 always，compaction 救不了时会空转重试。
3. **预防性 compaction 失败是软的。** warn 之后带着超预算历史去打模型，把问题推给第 2 层。多数时候合理，但提供商若分类不出 `CONTEXT_WINDOW_EXCEEDED`，就会硬失败。
4. **信封本身过大修不了。** 系统提示词 + 工具 schema 超过窗口，surface compaction 无能为力。文档写了，运行时没有「先砍工具 / 先砍 section」的回退。
5. **Retry 和 compaction 预算是分开加的。** 没有总「恢复尝试」上限。
6. **换模型没有渐进策略。** `agent/request` 可以改路由，但不会为了保 cache 而延迟切换，也不会在切换前主动 compact。
7. **已删除的 `request/header reason: 'fallback'`** 说明以前有过另一套 header 回退，现在是显式拒绝。新日志干净，旧日志不能装成现在的语义回放。

## 6. 总评

| 维度 | 成熟度 | 一句话 |
|---|---|---|
| 提示词组装 | 高 | 注册表 + 稳定/动态拆分，扩展点清楚 |
| 历史投影 | 高 | 日志派生、可重建、compaction 是 surface 操作 |
| 前缀缓存 | 高（在自动前缀提供商上） | 设计就是为 DeepSeek 自动 cache 服务的；有真 API 证据 |
| 同路由瞬时失败 | 高 | 策略按提供商绑定，重试不脏历史 |
| 上下文溢出 | 高 | 预防 + 确认两级，prune 可独立进展 |
| 跨模型 fallback | **无** | 不是漏实现，是当前产品边界 |
| 缓存可观测性 | 中 | 有 usage 和 UI 百分比，没有 miss 原因 |
| 信封级降级 | 低 | 窗口被 system/tools 撑爆时没有回退 |

整体判断：这是一套 **「同一条路由上尽量保持前缀稳定」** 的系统，不是 **「多模型保活」** 系统。在 DeepSeek 官方路由上，组装、历史、缓存、retry、overflow 是对齐的，而且比常见 agent 循环更可审计。最大的产品缺口是跨模型 failover；最大的缓存摩擦是 plan-mode 写在系统段里，以及动态 user 快照把尾巴堆胖。

## 7. 若继续做，收益比较明确的几件事

1. **Plan 规则改走 runtime context**，进出 plan 不再打穿系统前缀。
2. **给 `assistant/message.usage` 或并行诊断标 miss 原因**（header change / compaction / route switch），现在只有一个比例。
3. **若需要模型 failover**：新插件听 `agent/request-error`，改下一次 `agent/request` 的路由，并规定哪些码允许换模型。不要塞进 `dsh-llm-retry`。
4. **信封溢出时的降级**：按 `toolOrder` 或优先级先藏工具 / 丢掉非 complete section，再打模型。
5. **限制 `always` × 不可恢复溢出**：always 在 `CONTEXT_WINDOW_EXCEEDED` 且 compaction 无进展时应收束。

这些都还没做。当前代码在「同一模型、可重建前缀、瞬时重试、窗口压缩」这条主路上是完整且自洽的。
