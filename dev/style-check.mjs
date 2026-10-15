#!/usr/bin/env node
// 서술과 조건 절의 문체 규칙 검사. 사용법: node dev/style-check.mjs [<id>]
import {loadAll, listDocIds, paragraphs} from './lib/doc.mjs'
import {GROUPS, countRules} from './lib/style-rules.mjs'

export function styleIssues(doc) {
  const out = []
  for (const sec of ['서술', '조건']) {
    for (const {ln, text} of doc.sections[sec]?.lines ?? []) {
      for (const g of GROUPS) for (const re of g.patterns) { const m = re.exec(text); if (m) out.push({id: doc.id, ln, group: g.name, msg: `'${m[0]}'`}) }
    }
  }
  const all = ['서술', '조건'].flatMap(s => paragraphs(doc, s))
  for (const p of all) {
    const sentences = p.text.replace(/\[F\d+\]/g, '').split(/(?<=[.?!])\s+/).filter(Boolean)
    if (sentences.length > 4) out.push({id: doc.id, ln: p.ln, group: '문단 길이', msg: `문단이 ${sentences.length}문장 (4문장 이내)`})
    for (const m of countRules(p.text.split(/(?<=[.?!])\s*(?:\[F\d+\])*\s+/).filter(Boolean))) out.push({id: doc.id, ln: p.ln, group: '개수 규칙', msg: m})
  }
  const doc2 = all.map(p => p.text).join(' ')
  const contrast = (doc2.match(/[가이] 아니라/g) ?? []).length
  if (contrast > 1) out.push({id: doc.id, ln: 0, group: '개수 규칙', msg: `문서 전체에 'A 가 아니라 B' 가 ${contrast}개 (하나까지)`})
  const jeok = (doc2.match(/[가-힣]+적 [가-힣]+/g) ?? []).length
  if (jeok > 2) out.push({id: doc.id, ln: 0, group: '개수 규칙', msg: `문서 전체에 '~적 N' 이 ${jeok}개 (둘까지)`})
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2]
  const docs = loadAll()
  if (id && !docs.has(id)) { console.error(`문서 없음: ${id}`); process.exit(2) }
  const issues = [...(id ? [docs.get(id)] : docs.values())].flatMap(styleIssues)
  for (const i of issues) console.log(`${i.id}:${i.ln} [${i.group}] ${i.msg}`)
  console.log(`${issues.length} issues`)
  process.exit(issues.length ? 1 : 0)
}
