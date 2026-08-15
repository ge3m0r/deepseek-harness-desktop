# Agent Note: 仓库 CI 仅使用 keyless 检查

Status: implemented

[English](2026-08-15-remove-real-api-e2e-workflow.md) | 中文

## 问题

仓库没有配置 `DEEPSEEK_API_KEY_EXTERNAL`，但继承的 GitHub Actions 工作流会在每次 main 分支推送、可信 PR（Pull Request）、每夜计划任务和手动运行时要求该 secret。因此，普通源码推送会在测试开始前失败。没有密钥时仍报告真实 API job 成功也会产生误导，因为 e2e 套件会在缺少凭据时自动跳过。

## 决策

仓库自动化不包含真实 API e2e 工作流，也不要求外部 DeepSeek API secret。keyless `.github/workflows/ci.yml` 继续作为 PR 和推送的质量信号。`pnpm run test:e2e` 及各提供方专项测试仍可供自行提供凭据的贡献者在本地显式运行。

已删除工作流的 secret 处理和 fork 威胁模型保留为冻结的[历史记录](../../archived/testing/2026-06-19-real-api-e2e-ci.md)。重新引入携带 secret 的自动化需要明确的仓库决策、已配置的凭据、移除任何陈旧的 required status check，并重新审查该威胁模型；缺少密钥时不得产生绿色的真实 API 检查。

## 曾考虑的替代方案

**配置 `DEEPSEEK_API_KEY_EXTERNAL`。** 不采用：该仓库不需要携带凭据的 CI，普通贡献也不应依赖可能产生外部费用或需要手动轮换的 secret。

**缺少 secret 时跳过工作流。** 不采用：由此产生的绿色检查会声称已覆盖真实 API，却没有发起模型请求。

**保留仅手动触发的工作流。** 不采用：在没有已配置凭据且无人依赖该信号时，这仍会在仓库中留下 secret 生命周期和工作流维护成本。贡献者可以在本地运行同一命令。

## 后果

推送和 PR 不会再仅因缺少 `DEEPSEEK_API_KEY_EXTERNAL` 而失败。CI 保留确定性的 keyless 覆盖率、快照、构建和兼容性检查，但不会检测线上 DeepSeek API 漂移。需要该信号的维护者可以使用自己的密钥在本地运行 `pnpm run test:e2e`，或作出新的决策以恢复受控的携带 secret 的自动化。
