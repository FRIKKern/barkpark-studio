// Installs an exact hosted @portable-doc/react tarball only for this process,
// runs the Studio adapter/unit/build checks and its isolated native journeys,
// then restores the previous node_modules state. It never selects production.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync} from 'node:fs'
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`) })()
const repo = fileURLToPath(new URL('../', import.meta.url))
const tarball = path.resolve(required('STUDIO_REACT_CANDIDATE_TARBALL'))
const evidencePath = path.resolve(required('STUDIO_REACT_REPLAY_EVIDENCE'))
const dataset = required('BARKPARK_DATASET')
assert.match(dataset, /^e2e-[a-z0-9-]+$/, 'BARKPARK_DATASET must be a disposable e2e-* lane')
const provenancePath = path.resolve(process.env.STUDIO_REACT_CANDIDATE_PROVENANCE || path.join(path.dirname(tarball), 'provenance.json'))
const packageDir = path.join(repo, 'app/node_modules/@portable-doc/react')
const staging = path.join(path.dirname(evidencePath), `.studio-react-replay-${process.pid}`)
const backup = path.join(staging, 'previous-package')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const run = (file, args, env = process.env) => execFileSync(file, args, {cwd: repo, env, stdio: 'inherit'})

const tarHash = sha256(await readFile(tarball))
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
assert.equal(provenance.artifact?.sha256, tarHash, 'tarball differs from hosted provenance')
if (process.env.STUDIO_REACT_CANDIDATE_COMMIT)
  assert.equal(provenance.source?.commit, process.env.STUDIO_REACT_CANDIDATE_COMMIT, 'hosted source commit differs')

await mkdir(staging, {recursive: true})
const hadPackage = existsSync(packageDir)
if (hadPackage) await rename(packageDir, backup)
await mkdir(packageDir, {recursive: true})
run('tar', ['-xzf', tarball, '--strip-components=1', '-C', packageDir])

let failure
try {
  run('corepack', ['pnpm', '--dir', 'app', 'check'])
  run('corepack', ['pnpm', '--dir', 'e2e', 'install', '--frozen-lockfile'])
  run(process.execPath, [
    'e2e/run.mjs', 'test', '--config', 'studio-react-body.config.ts', '--project', 'studio',
    '--grep', 'React body adapter|keys typed while the body wakes|read-only body follows',
    'journeys/react-body-adapter.spec.ts', 'journeys/body-wake.spec.ts', 'journeys/freeform-links.spec.ts',
  ], {...process.env, BARKPARK_DATASET: dataset})
} catch (error) {
  failure = error
} finally {
  await rm(packageDir, {recursive: true, force: true})
  if (hadPackage) await rename(backup, packageDir)
  await rm(staging, {recursive: true, force: true})
}

await mkdir(path.dirname(evidencePath), {recursive: true})
await writeFile(evidencePath, JSON.stringify({
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: repo, encoding: 'utf8'}).trim() !== '',
  candidate: {tarball, sha256: tarHash, provenance: provenancePath, commit: provenance.source?.commit},
  isolation: {dataset, productionRefused: true},
  checks: {studioCheck: failure ? 'failed' : 'passed', nativeJourneys: failure ? 'failed' : 'passed'},
  rollback: {nodeModulesRestored: true, previousPackage: hadPackage ? 'restored' : 'absent'},
}, null, 2) + '\n')
console.log(`Evidence: ${evidencePath}`)
if (failure) throw failure
