#!/usr/bin/env node
// README, INDEX, 묶음 문서 생성. 사용법: node dev/stats.mjs --write | --check | --kinds
import fs from 'node:fs'
import path from 'node:path'
import {loadAll, ROOT, KINDS} from './lib/doc.mjs'
import {loadGroups, groupPage, indexPage, groupLines} from './lib/groups.mjs'

export function kindCounts(docs) {
  const c = Object.fromEntries(KINDS.map(k => [k, 0]))
  for (const d of docs.values()) for (const f of d.fragments) c[f.kind] = (c[f.kind] ?? 0) + 1
  return c
}

export function buildReadme(docs, head = '', groups = []) {
  const L = [head.replace(/\n+$/, ''), '', '# 문서 묶음', '', `주제가 가까운 현상끼리 묶었다. 묶음 문서마다 최상위 현상 아래에 하위 현상을 들여 쓴다. 제목 순 목록은 [전체 문서 목록](INDEX.md)이다.`, '']
  L.push(...(groups.length ? groupLines(docs, groups) : ['없음.']))
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
    if (!fs.existsSync(headFile) && fs.existsSync(readme)) fs.writeFileSync(headFile, fs.readFileSync(readme, 'utf8').split(/\n# (?:집계|문서 묶음)\n/)[0].replace(/\n+$/, '') + '\n')
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
      if (diff.length) { console.log(`README, INDEX, 묶음 문서가 현재 그래프와 다르다 (--write): ${diff.join(', ')}`); process.exit(1) }
      console.log('README.md, INDEX.md, 묶음 문서 일치')
    }
  } else { console.log('사용법: node dev/stats.mjs --write | --check | --kinds'); process.exit(mode ? 2 : 0) }
}
