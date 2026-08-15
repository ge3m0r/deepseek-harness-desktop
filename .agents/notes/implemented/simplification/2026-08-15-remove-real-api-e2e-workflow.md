# Agent Note: Keep repository CI keyless

Status: implemented

English | [中文](2026-08-15-remove-real-api-e2e-workflow.zh.md)

## Problem

The repository does not configure `DEEPSEEK_API_KEY_EXTERNAL`, while an inherited GitHub Actions workflow requires it on every main-branch push, trusted pull request, nightly schedule, and manual run. Each ordinary source push therefore fails before tests begin. Reporting a successful real-API job without the key would also be misleading because the e2e suites self-skip when their credentials are absent.

## Decision

Repository automation contains no real-API e2e workflow and does not require an external DeepSeek API secret. The keyless `.github/workflows/ci.yml` remains the pull-request and push quality signal. `pnpm run test:e2e` and its provider-specific tests remain available as local, opt-in verification for contributors who supply their own credentials.

The removed workflow's secret-handling and fork threat model remains available as a frozen [historical record](../../archived/testing/2026-06-19-real-api-e2e-ci.md). Reintroducing secret-bearing automation requires an explicit repository decision, a configured credential, removal of any obsolete required status check, and a fresh review of that threat model; a missing key must not produce a green real-API check.

## Alternatives considered

**Configure `DEEPSEEK_API_KEY_EXTERNAL`.** Rejected because this repository does not require credential-bearing CI and should not make ordinary contributions depend on an externally billed or manually rotated secret.

**Skip the workflow when the secret is absent.** Rejected because the resulting green check would claim real-API coverage without making a model request.

**Retain a manual-only workflow.** Rejected because it still leaves secret lifecycle and workflow maintenance in the repository without a configured credential or an owner relying on the signal. Contributors can run the same command locally.

## Consequences

Pushes and pull requests no longer fail solely because `DEEPSEEK_API_KEY_EXTERNAL` is absent. CI retains deterministic, keyless coverage, snapshots, builds, and compatibility checks, but it does not detect live DeepSeek API drift. Maintainers who need that signal run `pnpm run test:e2e` locally with their own key or make a new decision to restore controlled secret-bearing automation.
