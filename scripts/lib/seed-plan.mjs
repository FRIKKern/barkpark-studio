// seed-barkpark's modes as a plan, apart from the network so it can be tested: which
// steps run, and what the seed's files may do. `--schemas` writes schemas and nothing
// else (it used to upload the seed's files first, as every mode did), and `--verify`
// only reads: a file the dataset lacks shows as a difference, never an upload (verify is
// the one mode production allows).

/** @returns {{refuse?: string, schemas: boolean, reset: boolean, verify: boolean, assets: 'none' | 'find' | 'upload'}} */
export function seedPlan(argv, dataset) {
  const has = (flag) => argv.includes(flag)
  if (dataset === 'production' && !has('--verify') && !has('--production'))
    return {refuse: 'BARKPARK_DATASET is production, where people edit: this would overwrite it. Set your own lane (BARKPARK_DATASET=e2e-<you>), or pass --production if that is really meant.', schemas: false, reset: false, verify: false, assets: 'none'}
  if (has('--schemas')) return {schemas: true, reset: false, verify: false, assets: 'none'}
  if (has('--verify')) return {schemas: false, reset: false, verify: true, assets: 'find'}
  return {schemas: !has('--data'), reset: true, verify: true, assets: 'upload'}
}

/**
 * `node run.mjs reset` (a lane's reset: schemas and data) only for an e2e lane dataset,
 * never production or anything shared, whatever the shell or .env says, and never with
 * a flag it doesn't pass on (--production, --help, a typo): a seed run ignores what it
 * doesn't know and resets anyway. Why it refuses, or undefined.
 */
export function laneResetRefusal(dataset, args = []) {
  const unknown = args.find((a) => !LANE_RESET_FLAGS.includes(a))
  if (unknown) return `reset takes only ${LANE_RESET_FLAGS.join(', ')}, not "${unknown}".`
  if (!/^e2e-[a-z0-9][a-z0-9-]*$/.test(dataset ?? '')) return `reset writes schemas and data, so it only takes an e2e lane dataset (BARKPARK_DATASET=e2e-<you>), not "${dataset}".`
}

/** What `run.mjs reset` passes on to seed-barkpark. Anything else (--help, --production, a typo) stops it. */
export const LANE_RESET_FLAGS = ['--no-history']
export const LANE_RESET_USAGE = 'Usage: BARKPARK_DATASET=e2e-<lane> node run.mjs reset [--no-history]\n  Resets that lane dataset to the fixtures: schemas and data (scripts/seed-barkpark.mjs).'

