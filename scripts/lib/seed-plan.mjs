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
