/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cordis-host-runner`.
 * @module @deepseek-ai/dsh-cordis-host-runner/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cordis-host-runner'

/** Cordis companion plugin name. */
export const name = 'cordis-host-runner-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: definition persistence has no event stream, and its
 * running-definition relation to a settled host-half fiber and handler table is
 * established and unwound inside single awaited verbs; package tests assert
 * the durable reload and live lifecycle directly.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
