#!/usr/bin/env node
// 파편의 URL 을 fetch 해서 원문이 그 안에 있는지 본다. 사용법은 CLAUDE.md 5절.
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {loadAll, ROOT} from './lib/doc.mjs'
import {fetchText, quoteIn, judge, hostBlocked, daysBetween, needsProxyReexec, mergeRecords} from './lib/source.mjs'

if (needsProxyReexec(process.env)) {
  const r = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)], {stdio: 'inherit', env: {...process.env, NODE_USE_ENV_PROXY: '1'}})
  process.exit(r.status ?? 1)
}

const SOURCES = path.join(ROOT, 'dev', 'sources.json')
const git = (...a) => spawnSync('git', a, {cwd: ROOT, encoding: 'utf8'})

// --resolve: rebase/merge 충돌 중인 dev/sources.json 을 두 쪽(:2, :3) 기록의 합집합으로 풀고 git add 한다.
if (process.argv[2] === '--resolve') {
  const side = n => { const r = git('show', `:${n}:dev/sources.json`); return r.status === 0 ? JSON.parse(r.stdout) : null }
  const [ours, theirs] = [side(2), side(3)]
  if (!ours || !theirs) { console.error('충돌 중인 dev/sources.json 이 없다'); process.exit(2) }
  const merged = mergeRecords(ours, theirs)
  fs.writeFileSync(SOURCES, JSON.stringify(merged, null, 2) + '\n')
  git('add', 'dev/sources.json')
  console.log(`dev/sources.json 합침: ${Object.keys(merged).length} URLs`)
  process.exit(0)
}
const today = new Date().toISOString().slice(0, 10)
const args = process.argv.slice(2)
const docs = loadAll()
const records = fs.existsSync(SOURCES) ? JSON.parse(fs.readFileSync(SOURCES, 'utf8')) : {}

const gitOut = (...a) => git(...a).stdout ?? ''
const changedIds = () => {
  const files = new Set([...gitOut('diff', '--name-only', 'HEAD~1', 'HEAD').split('\n'), ...gitOut('status', '--porcelain').split('\n').map(l => l.slice(3))])
  return [...files].filter(f => /^docs\/[^/]+\.md$/.test(f)).map(f => f.slice(5, -3)).filter(id => docs.has(id))
}

let targets = []   // {doc, frag}
const staleIdx = args.indexOf('--stale')
if (args.includes('--all')) targets = [...docs.values()].flatMap(d => d.fragments.map(f => ({doc: d, frag: f})))
else if (args.includes('--changed')) targets = changedIds().flatMap(id => docs.get(id).fragments.map(f => ({doc: docs.get(id), frag: f})))
else if (staleIdx >= 0) {
  const days = Number(args[staleIdx + 1])
  targets = [...docs.values()].flatMap(d => d.fragments.map(f => ({doc: d, frag: f}))).filter(({frag}) => {
    const r = records[frag.url]
    return !r || daysBetween(r.last, today) > days
  })
} else if (args[0] && !args[0].startsWith('--')) {
  if (!docs.has(args[0])) { console.error(`문서 없음: ${args[0]}`); process.exit(2) }
  targets = docs.get(args[0]).fragments.map(f => ({doc: docs.get(args[0]), frag: f}))
} else { console.log('사용법: node dev/source-check.mjs <id> | --all | --changed | --stale <일수> | --resolve'); process.exit(args.length ? 2 : 0) }

for (const [url, r] of Object.entries(records)) if (r.removed) for (const {doc, frag} of targets) if (frag.url === url) console.log(`ERROR ${doc.id} F${frag.n} 삭제된 출처를 다시 썼다: ${url}`)

const cache = new Map()
let failed = false
for (const {doc, frag} of targets) {
  if (records[frag.url]?.removed) { failed = true; continue }
  if (!cache.has(frag.url)) cache.set(frag.url, await fetchText(frag.url, {quote: frag.quote}))
  const page = cache.get(frag.url)
  const result = !page.ok ? 'UNREACHABLE' : quoteIn(page.text, frag.quote) ? 'VERIFIED' : 'NOT_FOUND'
  const rec = records[frag.url]
  const blocked = result === 'UNREACHABLE' && rec?.lastVerified && !frag.vanished ? await hostBlocked(frag.url, page.reason) : false
  const j = judge(frag, result, rec, {hostBlocked: blocked})
  console.log(`${result} ${doc.id} F${frag.n}${page.ok ? '' : ` (${page.reason})`}${j.note ? ' — ' + j.note : ''}`)
  if (j.exit) failed = true
  records[frag.url] = {...rec, first: rec?.first ?? today, last: today, result, lastVerified: result === 'VERIFIED' ? today : rec?.lastVerified}
}
if (targets.length) fs.writeFileSync(SOURCES, JSON.stringify(records, null, 2) + '\n')
console.log(`${targets.length} fragments checked`)
process.exit(failed ? 1 : 0)
