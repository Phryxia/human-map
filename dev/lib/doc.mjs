// 문서 파싱 공용 코드. 4절의 고정 구조를 줄 단위로 읽는다. 파편은 태그 줄 뒤의 각주 정의 [^n]: 이다.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DOCS = path.join(ROOT, 'docs')
export const KINDS = ['학술', '공공', '매체', 'SNS', '문학']
export const AXES = ['특성', '사고', '감정', '행동']
export const SECTIONS = ['서술', '관계']
export const REL_SECTIONS = ['상위', '하위', '원인', '결과', '대립']
export const INVERSE = {상위: '하위', 하위: '상위', 원인: '결과', 결과: '원인', 대립: '대립'}
// 본문과 관계 줄의 각주 참조
export const REF_RE = /\[\^(\d+)\]/g
export const refsIn = text => [...text.matchAll(REF_RE)].map(m => Number(m[1]))
export const FILE_RE = /^[a-z0-9][a-z0-9-]*\.md$/
export const FRAG_RE = /^\[\^(\d+)\]: \[([^\]]+)\] "(.*?)"(?: \((.*?)\))? — (.*), (발행일 미상|\d{4}(?:-\d{2}(?:-\d{2})?)?), (https?:\/\/\S+), (\d{4}-\d{2}-\d{2}) 접속(?: \((미확인)\)| \(소멸, (\d{4}-\d{2}-\d{2}) 까지 확인\))?$/
const NON_DOCS = new Set(['README.md', 'CLAUDE.md', 'README.head.md', 'LICENSE'])

export function listDocIds(dir = DOCS) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !NON_DOCS.has(f)).map(f => f.slice(0, -3)).sort()
}

export function parseFragment(line) {
  const m = FRAG_RE.exec(line)
  if (!m) return null
  const [, n, kind, quote, translation, biblio, date, url, accessed, unverified, vanished] = m
  return {n: Number(n), kind, quote, translation, biblio, date, url, accessed, unverified: !!unverified, vanished: vanished ?? null, line}
}

export function parseDoc(id, dir = DOCS) {
  const file = path.join(dir, id + '.md')
  const lines = fs.readFileSync(file, 'utf8').replace(/\n+$/, '').split('\n')
  const doc = {id, file, lines, title: null, aliases: null, summary: null, sections: {}, headings: [], fragments: [], badFragLines: [], badRelLines: [], strayLines: [], rel: {}, tags: [], tagLine: null, tagLn: null}
  for (const r of REL_SECTIONS) doc.rel[r] = null
  // 태그 줄은 태그 꼴인 마지막 줄이고, 없으면 각주 정의와 빈 줄을 뺀 마지막 줄 자리다
  const TAG_RE = /^(#[가-힣a-z0-9_]+)( #[가-힣a-z0-9_]+)*$/
  let tagIdx = lines.findLastIndex(l => TAG_RE.test(l))
  if (tagIdx < 0) { tagIdx = lines.length - 1; while (tagIdx >= 0 && (!lines[tagIdx].trim() || lines[tagIdx].startsWith('[^'))) tagIdx-- }
  const tagText = lines[tagIdx] ?? ''
  if (TAG_RE.test(tagText)) { doc.tagLine = tagText; doc.tagLn = tagIdx + 1; doc.tags = tagText.split(' ').map(t => t.slice(1)) }
  let h1 = null, h2 = null
  lines.forEach((text, i) => {
    const ln = i + 1
    let m
    if (text.startsWith('[^')) {
      if (i <= tagIdx) doc.strayLines.push({ln, text})
      const f = parseFragment(text)
      if (f) { f.ln = ln; doc.fragments.push(f) } else doc.badFragLines.push({ln, text})
      return
    }
    if (i > tagIdx) { if (text.trim()) doc.strayLines.push({ln, text}); return }
    if ((m = /^# (.*)$/.exec(text))) {
      if (doc.title === null) { doc.title = m[1]; return }
      h1 = m[1]; h2 = null
      doc.headings.push({level: 1, text: h1, ln})
      doc.sections[h1] = {ln, lines: []}
      return
    }
    if ((m = /^## (.*)$/.exec(text))) { h2 = m[1]; doc.headings.push({level: 2, text: h2, ln, parent: h1}); if (h1 === '관계') doc.rel[h2] ??= []; return }
    if (h1 === null) {
      if (text.startsWith('별칭:')) doc.aliases = text.slice(3).trim()
      else if (text.trim() && doc.summary === null) doc.summary = text.trim()
      return
    }
    if (ln === doc.tagLn) return
    doc.sections[h1].lines.push({ln, text})
    if (h1 === '관계' && h2 && doc.rel[h2] && text.startsWith('- ')) {
      // 근거 파편은 붙여 쓴 '[^1][^2]' 와 띄어 쓴 ' [^1]' 을 모두 받는다
      if ((m = /^- \[([^\]]*)\]\(([^)]*)\.md\)((?: ?\[\^\d+\])*)\s*$/.exec(text))) doc.rel[h2].push({title: m[1], id: m[2], frags: refsIn(m[3]), ln})
      else doc.badRelLines.push({ln, text})
    }
  })
  return doc
}

// 서술 절의 문단: 빈 줄로 나뉜 덩어리와 그 시작 줄
export function paragraphs(doc, section) {
  const s = doc.sections[section]
  if (!s) return []
  const out = []
  let cur = null
  for (const {ln, text} of s.lines) {
    if (!text.trim()) { cur = null; continue }
    if (!cur) { cur = {ln, text: ''}; out.push(cur) }
    cur.text += (cur.text ? ' ' : '') + text
  }
  return out
}

export function loadAll(dir = DOCS) {
  const docs = new Map()
  for (const id of listDocIds(dir)) docs.set(id, parseDoc(id, dir))
  return docs
}

export const fragsOf = doc => doc.fragments
export const isVerified = f => !f.unverified
