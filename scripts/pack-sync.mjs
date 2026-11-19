// Rewrites conformance/pack/ from Barkpark's api/priv/portable_doc, by machine: the block goldens
// its stamp names, the stamp, conformance.mjs and its types, and SOURCE.md with the commit. Then
// conformance runs on the new pack; the report takes the new stamp only when no row moved
// (conformance/barkpark-studio.mjs CONFORMANCE_RESTAMP). docs/decisions/0009-pack-syncs-itself.md
//   node scripts/pack-sync.mjs <barkpark checkout> [--commit <sha>] [--pr-body <file>]
// Prints the sync PR's title. --commit: for a checkout without git (an archive of the pack).
import {execFileSync, spawnSync} from 'node:child_process'
import {cpSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {COPIED, PACK_DIR, SOURCE_PATH, SOURCE_REPO, compare, diff, readSourceNote, selfCheck, sourceDir, sourceNote, sourcePack, studioPack} from './lib/pack.mjs'

const {values, positionals} = parseArgs({allowPositionals: true, options: {commit: {type: 'string'}, 'pr-body': {type: 'string'}}})
if (positionals.length !== 1) {
  console.error('usage: node scripts/pack-sync.mjs <barkpark checkout> [--commit <sha>] [--pr-body <file>]')
  process.exit(2)
}
const fail = (message) => {
  console.error(`pack-sync: ${message}`)
  process.exit(1)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const src = sourceDir(positionals[0])
const source = sourcePack(src)
if (source.errors.length) fail(`Barkpark's pack at ${src} is not valid, nothing copied:\n${source.errors.join('\n')}`)
const commit = values.commit ?? execFileSync('git', ['-C', positionals[0], 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim()
if (!/^[0-9a-f]{40}$/.test(commit)) fail(`not a full commit sha: ${commit}`)

const before = {commit: readSourceNote(root).commit, files: studioPack(root)}
const pack = join(root, PACK_DIR)
rmSync(pack, {recursive: true, force: true})
mkdirSync(join(pack, 'goldens/blocks'), {recursive: true})
for (const f of Object.keys(source.files)) cpSync(join(src, COPIED[f] ?? f), join(pack, f))
writeFileSync(join(pack, 'SOURCE.md'), sourceNote(commit, source.files))
const left = [...selfCheck(root), ...compare(root, src)]
if (left.length) fail(`the copy does not match its source:\n${left.join('\n')}`)

// The studio renderer on the new pack. Its own output goes to stderr: stdout is the title.
const run = spawnSync(process.execPath, ['../conformance/barkpark-studio.mjs'], {cwd: join(root, 'app'), env: {...process.env, CONFORMANCE_RESTAMP: '1'}, encoding: 'utf8'})
process.stderr.write(run.stdout + run.stderr)
const summary = run.stdout.match(/^barkpark-studio: .*$/m)?.[0]
if (!summary) fail('conformance did not run on the new pack (see above)')
const moved = [...run.stdout.matchAll(/^moved: (.*)$/gm)].map((m) => m[1])

const d = diff(before.files, studioPack(root))
const title = `PortableDoc pack: sync from Barkpark ${commit.slice(0, 12)}${moved.length ? `, ${moved.length} conformance rows moved` : ''}`
if (values['pr-body']) {
  const list = (kind) => d[kind].map((f) => `- \`${PACK_DIR}/${f}\``).join('\n') || '- none'
  writeFileSync(
    values['pr-body'],
    `Written by \`scripts/pack-sync.mjs\` from [\`${SOURCE_REPO}\` ${commit.slice(0, 12)}](https://github.com/${SOURCE_REPO}/commit/${commit}) \`${SOURCE_PATH}\` (was ${before.commit?.slice(0, 12) ?? 'none'}). Barkpark is the source: fix the pack there, never here.

${moved.length ? `**The studio renderer is behind Barkpark.** Conformance fails here until it renders the new pack as before, or someone accepts the new rows on this branch (\`pnpm --dir app conformance:write\`) and says why. Rows that moved:\n\n${moved.map((m) => `- ${m}`).join('\n')}` : 'No conformance row moved: the report takes the new pack stamp.'}

\`${summary}\` · ${d.added.length} added, ${d.changed.length} changed, ${d.removed.length} removed

### Added
${list('added')}

### Changed
${list('changed')}

### Removed
${list('removed')}

This PR merges itself once every required check is green (\`.github/workflows/sync-pack.yml\`). To hold the sync back, disable that workflow.
`,
  )
}
console.log(title)
