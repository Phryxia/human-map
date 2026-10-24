// 문서 묶음. dev/groups.json 의 묶음마다 최상위 현상(상위가 없는 문서) id 를 적고, 하위 현상은 상위를 따라 그 묶음에 든다.
import fs from 'node:fs'
import path from 'node:path'
import {ROOT} from './doc.mjs'

export const GROUPS_FILE = path.join(ROOT, 'dev', 'groups.json')
export const loadGroups = (file = GROUPS_FILE) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []

const isRoot = d => !d.rel['상위']?.length
const byTitle = (a, b) => a.title.localeCompare(b.title, 'ko')

// 묶음 검사. 결과는 validate 와 같은 {level, id, ln, msg} 목록.
export function checkGroups(docs, groups) {
  const out = []
  const err = (id, msg) => out.push({level: 'ERROR', id, ln: 0, msg})
  const seen = new Map(), gids = new Set()
  for (const g of groups) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(g.id ?? '')) err('groups.json', `묶음 id 가 규격이 아니다: ${g.id}`)
    if (gids.has(g.id)) err('groups.json', `묶음 id 가 겹친다: ${g.id}`)
    gids.add(g.id)
    if (!g.title || !/^[^.]+\.$/.test(g.summary ?? '')) err('groups.json', `묶음 ${g.id} 에 제목이나 한 문장 요약이 없다`)
    for (const id of g.roots ?? []) {
      const d = docs.get(id)
      if (!d) err('groups.json', `묶음 ${g.id} 의 문서가 없다: ${id}`)
      else if (!isRoot(d)) err(id, `상위가 있는 문서는 묶음에 직접 넣지 않는다 (${g.id})`)
      if (seen.has(id)) err(id, `두 묶음에 들어 있다: ${seen.get(id)}, ${g.id}`)
      seen.set(id, g.id)
    }
  }
  for (const d of docs.values()) if (isRoot(d) && !seen.has(d.id)) err(d.id, '최상위 현상이 어느 묶음(dev/groups.json)에도 없다')
  return out
}

// 상위 아래에 하위를 들여 쓴 트리. prefix 는 문서 링크 앞에 붙는 경로다.
function tree(d, docs, depth, seen, prefix, withSummary) {
  const head = `${'  '.repeat(depth)}- [${d.title}](${prefix}${d.id}.md)${withSummary && depth === 0 ? ` ${d.summary}` : ''}`
  const kids = (d.rel['하위'] ?? []).map(e => docs.get(e.id)).filter(c => c && !seen.has(c.id)).sort(byTitle)
  return [head, ...kids.flatMap(c => tree(c, docs, depth + 1, new Set([...seen, c.id]), prefix, withSummary))]
}

// 묶음마다 트리에 든 문서 id 집합
export function members(group, docs) {
  const ids = new Set()
  const walk = id => { if (ids.has(id) || !docs.has(id)) return; ids.add(id); for (const e of docs.get(id).rel['하위'] ?? []) walk(e.id) }
  for (const id of group.roots) walk(id)
  return ids
}

export function groupPage(group, docs) {
  const roots = group.roots.map(id => docs.get(id)).filter(Boolean).sort(byTitle)
  const L = [`# ${group.title}`, '', group.summary, '', '[문서 묶음](../README.md#문서-묶음), [전체 문서 목록](../INDEX.md)', '']
  for (const d of roots) L.push(...tree(d, docs, 0, new Set([d.id]), '../docs/', true))
  return L.join('\n') + '\n'
}

export function indexPage(docs, groups) {
  const of = new Map()
  for (const g of groups) for (const id of members(g, docs)) of.set(id, [...(of.get(id) ?? []), g])
  const L = ['# 전체 문서 목록', '', '전체 문서를 제목 순으로 적는다. 주제별 목록은 [문서 묶음](README.md#문서-묶음)에 있다.', '']
  for (const d of [...docs.values()].sort(byTitle)) L.push(`- [${d.title}](docs/${d.id}.md) (${(of.get(d.id) ?? []).map(g => `[${g.title}](groups/${g.id}.md)`).join(', ') || '묶음 없음'})`)
  return L.join('\n') + '\n'
}

// README 의 묶음 목록 줄
export const groupLines = (docs, groups) => groups.map(g => `- [${g.title}](groups/${g.id}.md) ${g.summary}`)
