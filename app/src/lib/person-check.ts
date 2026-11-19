// task-4ffed14fbf52dc47: whether the studio knows who the person is (whoAmI, lib/session.ts
// meQuery). Until it does, a field a role rule may lock stays locked and kept edits wait
// (components/DocumentPane.tsx); when the check failed or has not answered in time, the page
// says so and offers a retry (components/PersonCheckBanner.tsx).

/** How long the check may take before the page says it has not answered. */
export const SLOW_CHECK_MS = 10_000

type Me = {provisional?: boolean; unchecked?: boolean; [field: string]: unknown}
/** meQuery as it stands, and how long the person has been unknown. */
export type CheckState = {data: Me | undefined; isError: boolean; isFetching: boolean; waitedMs: number}

/** `known`: Barkpark said who (or that nobody is signed in). `checking`: asking. `failed`: it did not say, or not in time. */
export function personCheck({data, isError, isFetching, waitedMs}: CheckState): 'known' | 'checking' | 'failed' {
  if (data && !data.provisional && !data.unchecked) return 'known'
  if (isFetching) return waitedMs < SLOW_CHECK_MS ? 'checking' : 'failed'
  return isError || data?.unchecked || waitedMs >= SLOW_CHECK_MS ? 'failed' : 'checking'
}

/**
 * Whether the page says the check failed: only where something is closed because the person is
 * unknown, a type with a role rule (conditions.ts roleRuled) or kept edits waiting. A doc with
 * nothing closed shows nothing.
 */
export const bannerShows = ({failed, ruled, kept}: {failed: boolean; ruled: boolean; kept: boolean}) => failed && (ruled || kept)
