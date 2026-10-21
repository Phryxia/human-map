#!/usr/bin/env node
// 그래프 검사와 조회. 사용법은 CLAUDE.md 7절.
import fs from 'node:fs'
import {loadAll, KINDS, AXES} from './lib/doc.mjs'
import {edgeMap, findCycles, wouldCycle} from './lib/graph-lib.mjs'
import {validateAll} from './lib/validate.mjs'
import {loadGroups, checkGroups} from './lib/groups.mjs'

const norm = s => s.toLowerCase().replace(/\s+/g, '')
const [cmd, ...args] = process.argv.slice(2)
const docs = loadAll()

switch (cmd) {
  case 'validate': {
    const src = new URL('./sources.json', import.meta.url)
    const res = [...validateAll(docs, fs.existsSync(src) ? JSON.parse(fs.readFileSync(src, 'utf8')) : {}), ...checkGroups(docs, loadGroups())]
    for (const r of res) console.log(`${r.level} ${r.id}${r.ln ? ':' + r.ln : ''} ${r.msg}`)
    const errs = res.filter(r => r.level === 'ERROR').length
    console.log(`${docs.size} docs, ${errs} errors, ${res.length - errs} warnings`)
    process.exit(errs ? 1 : 0)
  }
  case 'cycles': {
    const up = findCycles(edgeMap(docs, '상위'))
    for (const c of up) console.log(`CYCLE ${c.join(' -> ')}`)
    for (const c of findCycles(edgeMap(docs, '결과'))) console.log(`FEEDBACK ${c.join(' -> ')}`)
    process.exit(up.length ? 1 : 0)
  }
  case 'check-cycle': {
    const [child, parent] = args.filter(a => !a.startsWith('--'))
    const allowNew = args.includes('--allow-new')
    if (!child || !parent) { console.error('사용법: check-cycle <child> <parent> [--allow-new]'); process.exit(2) }
    for (const id of [child, parent]) if (!docs.has(id) && !allowNew) { console.error(`문서 없음: ${id} (--allow-new)`); process.exit(2) }
    const p = wouldCycle(edgeMap(docs, '상위'), child, parent)
    console.log(p ? `CYCLE ${p.join(' -> ')}` : 'OK')
    process.exit(p ? 1 : 0)
  }
  case 'find': {
    const q = norm(args.join(' '))
    if (!q) { console.error('사용법: find "<문자열>"'); process.exit(2) }
    let n = 0
    for (const d of docs.values()) if ([d.title, d.aliases, d.summary].some(s => s && norm(s).includes(q)) || d.id.includes(q)) { console.log(`${d.id}\t${d.title}`); n++ }
    if (!n) console.log('(없음)')
    break
  }
  case 'node': {
    const d = docs.get(args[0])
    if (!d) { console.error(`문서 없음: ${args[0]}`); process.exit(1) }
    const kinds = KINDS.map(k => [k, d.fragments.filter(f => f.kind === k).length]).filter(([, c]) => c).map(([k, c]) => `${k} ${c}`).join(', ')
    console.log(`${d.title} (${d.id})\n별칭: ${d.aliases}\n${d.summary}\n파편 ${d.fragments.length}: ${kinds} (미확인 ${d.fragments.filter(f => f.unverified).length})\n태그: ${d.tags.join(' ')}`)
    for (const [rel, es] of Object.entries(d.rel)) console.log(`${rel}: ${es?.length ? es.map(e => e.id + e.frags.map(f => `[^${f}]`).join('')).join(', ') : '없음'}`)
    break
  }
  case 'roots': for (const d of docs.values()) if (!d.rel['상위']?.length) console.log(`${d.id}\t${d.title}`); break
  case 'tags': {
    const c = new Map()
    let untagged = 0
    for (const d of docs.values()) { if (!d.tags.length) untagged++; for (const t of d.tags) c.set(t, (c.get(t) ?? 0) + 1) }
    for (const [t, n] of [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`#${t}\t${n}${AXES.includes(t) ? '\t(축)' : ''}`)
    console.log(`${untagged} untagged`)
    break
  }
  default: console.log('사용법: node dev/graph.mjs validate | cycles | check-cycle <child> <parent> [--allow-new] | find "<문자열>" | node <id> | roots | tags'); process.exit(cmd ? 2 : 0)
}
