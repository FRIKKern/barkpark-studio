// seed-barkpark --remove-type: the plan, apart from the network so it can be tested.
// `--schemas` only adds; this is the other half of the loop: take a type's file out of
// fixtures/barkpark-schema, then remove it from a dataset.

/**
 * What removing `type` from `dataset` would do, or why not.
 * `docs`: the type's documents there ({id} per published id; drafts folded in).
 * `inFixtures`: a fixtures/barkpark-schema file still declares it.
 * `seeded`: the seed writes documents of it (seed-barkpark's TYPES / NATIVE_TYPES).
 * `registered`: the dataset has the schema.
 */
export function planRemoveType({type, dataset, docs, inFixtures, seeded, registered, production = false, withDocs = false}) {
  const refuse = (why) => ({refuse: why, deletes: [], dropSchema: false})
  if (!type || type.startsWith('-')) return refuse('--remove-type needs a type name')
  if (dataset === 'production' && !production) return refuse('BARKPARK_DATASET is production, where people edit. Pass --production if that is really meant.')
  if (inFixtures) return refuse(`fixtures/barkpark-schema still declares ${type}: take its file out first, or the next --schemas adds it back.`)
  if (seeded) return refuse(`the seed writes ${type} documents: take it out of seed-barkpark's TYPES / NATIVE_TYPES and the seed files first.`)
  if (docs.length && !withDocs) return refuse(`${dataset} has ${docs.length} ${type} document(s). Pass --with-docs to delete them first.`)
  // Already gone: the same outcome as removing it, so a chained run doesn't fail.
  if (!registered && !docs.length) return {done: `${dataset} has no ${type} schema and no ${type} documents: nothing to do.`, deletes: [], dropSchema: false}
  // Documents first (references to them go too, as a reset deletes), then the schema.
  return {deletes: docs.map(({id}) => ({delete: {id, type, force: true}})), dropSchema: registered}
}
