#!/usr/bin/env node
// 서술 절과 요약 줄의 문체 규칙 검사(제목·별칭 줄은 이모지와 한자만). 사용법: node dev/style-check.mjs [<id>]
import {loadAll, listDocIds, paragraphs} from './lib/doc.mjs'
import {GROUPS, countRules} from './lib/style-rules.mjs'

// 한 줄에 금지 묶음을 적용한다. level 을 주면 그 단계로 낮춘다.
function lineIssues(doc, ln, text, groups, level) {
  const out = []
  const bare = text.replace(/"[^"]*"|“[^”]*”|'[^']*'|‘[^’]*’/g, '')
  for (const g of groups) for (const re of g.patterns) {
    const m = re.exec(g.unquoted ? bare : text)
    if (m) out.push({id: doc.id, ln, group: g.name, msg: `'${m[0]}'`, level: level ?? g.level ?? 'ERROR'})
  }
  return out
}

export function styleIssues(doc) {
  const out = []
  for (const {ln, text} of doc.sections['서술']?.lines ?? []) out.push(...lineIssues(doc, ln, text, GROUPS))
  // 제목·별칭 줄은 이모지와 한자만, 요약 줄은 모든 묶음을 본다.
  const emoji = GROUPS.filter(g => g.name === '이모지와 한자')
  const headEnd = doc.headings.find(h => h.level === 1)?.ln ?? doc.lines.length + 1
  doc.lines.slice(0, headEnd - 1).forEach((text, i) => {
    const isSummary = doc.summary !== null && text.trim() === doc.summary
    out.push(...lineIssues(doc, i + 1, text, isSummary ? GROUPS : emoji))
  })
  const all = paragraphs(doc, '서술')
  for (const p of all) {
    const sentences = p.text.replace(/\[\^\d+\]/g, '').split(/(?<=[.?!])\s+/).filter(Boolean)
    if (sentences.length > 4) out.push({id: doc.id, ln: p.ln, group: '문단 길이', msg: `문단이 ${sentences.length}문장 (4문장 이내)`})
    for (const m of countRules(p.text.split(/(?<=[.?!])\s*(?:\[\^\d+\])*\s+/).filter(Boolean))) out.push({id: doc.id, ln: p.ln, group: '개수 규칙', msg: m})
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
  for (const i of issues) console.log(`${i.level === 'WARN' ? 'WARN ' : ''}${i.id}:${i.ln} [${i.group}] ${i.msg}`)
  const errors = issues.filter(i => i.level !== 'WARN').length
  console.log(`${errors} issues, ${issues.length - errors} warnings`)
  process.exit(errors ? 1 : 0)
}
