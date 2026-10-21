#!/usr/bin/env node
// README, INDEX, 묶음 문서 집계. 사용법: node dev/stats.mjs --write | --check | --kinds
import fs from 'node:fs'
import path from 'node:path'
import {loadAll, ROOT, KINDS, AXES} from './lib/doc.mjs'
import {edgeMap, findCycles, depths} from './lib/graph-lib.mjs'
import {loadGroups, groupPage, indexPage, groupLines} from './lib/groups.mjs'

const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : '0.0%'

export function kindCounts(docs) {
  const c = Object.fromEntries(KINDS.map(k => [k, 0]))
  for (const d of docs.values()) for (const f of d.fragments) c[f.kind] = (c[f.kind] ?? 0) + 1
  return c
}

export function buildReadme(docs, head = '', groups = []) {
  const L = []
  const frags = [...docs.values()].flatMap(d => d.fragments.map(f => ({...f, doc: d.id})))
  const count = rel => [...docs.values()].reduce((n, d) => n + (d.rel[rel]?.length ?? 0), 0)
  L.push(head.replace(/\n+$/, ''), '', '# 집계', '')
  L.push(`- 문서 ${docs.size}개`)
  L.push(`- 간선: 상위 ${count('상위')}, 원인 ${count('원인')}, 대립 ${count('대립') / 2}`)
  L.push('', '## 축 태그별 문서 수', '')
  for (const a of AXES) L.push(`- ${a}: ${[...docs.values()].filter(d => d.tags.includes(a)).length}`)
  L.push('', '## 파편 종류', '')
  const kc = kindCounts(docs)
  for (const k of KINDS) L.push(`- ${k}: ${kc[k]} (${pct(kc[k], frags.length)})`)
  const unver = frags.filter(f => f.unverified).length, van = frags.filter(f => f.vanished).length
  L.push('', '## 확인 상태', '', `- 확인됨 ${frags.length - unver - van} (${pct(frags.length - unver - van, frags.length)}), 미확인 ${unver} (${pct(unver, frags.length)}), 소멸 ${van} (${pct(van, frags.length)})`)
  L.push('', '## 파편 발행 연도 분포', '')
  const dec = new Map()
  for (const f of frags) { const k = f.date === '발행일 미상' ? '미상' : `${Math.floor(Number(f.date.slice(0, 4)) / 10) * 10}년대`; dec.set(k, (dec.get(k) ?? 0) + 1) }
  for (const [k, n] of [...dec].sort()) L.push(`- ${k}: ${n}`)
  const oneDecade = [...docs.values()].filter(d => d.fragments.length && new Set(d.fragments.map(f => f.date.slice(0, 3))).size === 1).length
  L.push('', `파편이 한 10년 안에만 있는 문서: ${oneDecade}`)
  L.push('', '## 문서 묶음', '', `주제가 가까운 현상끼리 묶었다. 묶음 문서마다 최상위 현상 아래에 하위 현상을 들여 쓴다. 제목 순 목록은 [전체 문서 목록](INDEX.md)이다.`, '')
  L.push(...(groups.length ? groupLines(docs, groups) : ['없음.']))
  L.push('', '## 되먹임 (원인 그래프의 순환)', '')
  const fb = findCycles(edgeMap(docs, '결과'))
  L.push(...(fb.length ? fb.map(c => `- ${c.join(' -> ')}`) : ['없음.']))
  L.push('', '## 상위 그래프 깊이 분포', '')
  const dd = new Map()
  for (const v of depths(edgeMap(docs, '상위')).values()) dd.set(v, (dd.get(v) ?? 0) + 1)
  L.push(...(dd.size ? [...dd].sort((a, b) => a[0] - b[0]).map(([k, n]) => `- 깊이 ${k}: ${n}`) : ['없음.']))
  return L.join('\n') + '\n'
}

// README.md, INDEX.md, groups/<id>.md 를 경로별 내용으로 만든다.
export function buildOutputs(docs, head = '', groups = []) {
  const out = new Map([['README.md', buildReadme(docs, head, groups)], ['INDEX.md', indexPage(docs, groups)]])
  for (const g of groups) out.set(`groups/${g.id}.md`, groupPage(g, docs))
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2]
  const docs = loadAll()
  const headFile = path.join(ROOT, 'README.head.md')
  const readme = path.join(ROOT, 'README.md')
  if (mode === '--kinds') { for (const [k, n] of Object.entries(kindCounts(docs))) console.log(`${k}\t${n}`) }
  else if (mode === '--write' || mode === '--check') {
    if (!fs.existsSync(headFile) && fs.existsSync(readme)) fs.writeFileSync(headFile, fs.readFileSync(readme, 'utf8').split(/\n# 집계\n/)[0].replace(/\n+$/, '') + '\n')
    const outs = buildOutputs(docs, fs.existsSync(headFile) ? fs.readFileSync(headFile, 'utf8') : '', loadGroups())
    const gdir = path.join(ROOT, 'groups')
    const stale = fs.existsSync(gdir) ? fs.readdirSync(gdir).map(f => `groups/${f}`).filter(f => !outs.has(f)) : []
    if (mode === '--write') {
      fs.mkdirSync(gdir, {recursive: true})
      for (const [f, text] of outs) fs.writeFileSync(path.join(ROOT, f), text)
      for (const f of stale) fs.rmSync(path.join(ROOT, f))
      console.log(`README.md, INDEX.md, 묶음 문서 ${outs.size - 2}개를 다시 만들었다`)
    } else {
      const diff = [...outs].filter(([f, text]) => !fs.existsSync(path.join(ROOT, f)) || fs.readFileSync(path.join(ROOT, f), 'utf8') !== text).map(([f]) => f).concat(stale)
      if (diff.length) { console.log(`집계가 현재 그래프와 다르다 (--write): ${diff.join(', ')}`); process.exit(1) }
      console.log('README.md, INDEX.md, 묶음 문서 집계 일치')
    }
  } else { console.log('사용법: node dev/stats.mjs --write | --check | --kinds'); process.exit(mode ? 2 : 0) }
}
