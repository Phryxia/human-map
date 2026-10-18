// validate 검사 묶음. 결과는 {level: 'ERROR'|'WARN', id, ln, msg} 목록.
import {KINDS, AXES, SECTIONS, REL_SECTIONS, INVERSE, FILE_RE, paragraphs, isVerified} from './doc.mjs'

// SNS URL 의 계정 경로. 첫 캡처 그룹이 계정이다.
export const ACCOUNT_PATTERNS = [
  /^https?:\/\/(?:www\.|old\.)?reddit\.com\/(?:user|u)\/([^/?#]+)/i,
  /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([^/?#]+)\/status\//i,
  /^https?:\/\/(?:www\.)?threads\.net\/@([^/?#]+)/i,
  /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/)([^/?#]+)/i,
  /^https?:\/\/(?:www\.)?facebook\.com\/(?!groups\/|watch)([^/?#]+)/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)?bsky\.app\/profile\/([^/?#]+)/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)?tistory\.com\/?$/i,
  /^https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)([^/?#]+)/i,
  /^https?:\/\/([a-z0-9-]+)\.mastodon\.[a-z]+\/@([^/?#]+)/i,
]
export const accountOf = url => {
  for (const re of ACCOUNT_PATTERNS) { const m = re.exec(url); if (m) return m.slice(1).join('/').toLowerCase() }
  return null
}

const DATE_OK = d => d === '발행일 미상' || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(d)
const sortKey = d => d === '발행일 미상' ? '' : d
// 문장 끝: 공백이나 문단 끝 앞의 마침표·물음표·느낌표. 15.6% 같은 소수점은 세지 않는다.
const sentenceCount = text => text.replace(/\[F\d+\]/g, '').match(/[.?!](?=\s|$)/g)?.length ?? 0

// sources 는 dev/sources.json 의 URL 별 기록. VERIFIED 인 출처의 원문은 출처에 글자 그대로 있으므로 줄임표도 원글의 것이다.
export function validateDoc(doc, docs, sources = {}) {
  const out = []
  const err = (ln, msg) => out.push({level: 'ERROR', id: doc.id, ln, msg})
  const warn = (ln, msg) => out.push({level: 'WARN', id: doc.id, ln, msg})
  if (!FILE_RE.test(doc.id + '.md')) err(1, '파일명이 규격이 아니다')
  if (doc.lines.length > 80) err(81, `80줄 초과 (${doc.lines.length}줄)`)
  if (!doc.title) err(1, '제목이 없다')
  if (doc.aliases === null || doc.aliases === '') err(3, '별칭 줄이 없다')
  if (!doc.summary || !/^[^.]+\.$/.test(doc.summary)) err(5, '요약은 마침표 하나로 끝나는 한 문장이어야 한다')
  const h1 = doc.headings.filter(h => h.level === 1).map(h => h.text)
  if (h1.join('|') !== SECTIONS.join('|')) err(1, `헤딩이 ${SECTIONS.join(', ')} 순서와 다르다 (${h1.join(', ')})`)
  const h2 = doc.headings.filter(h => h.level === 2)
  if (h2.map(h => h.text).join('|') !== REL_SECTIONS.join('|') || h2.some(h => h.parent !== '관계')) err(1, `관계의 하위 헤딩이 ${REL_SECTIONS.join(', ')} 순서와 다르다`)
  // 파편
  for (const b of doc.badFragLines) err(b.ln, '파편 줄이 형식에 맞지 않는다')
  const nums = new Set()
  doc.fragments.forEach((f, i) => {
    if (f.n !== i + 1) err(f.ln, `파편 번호가 순서와 다르다 (F${f.n}, 기대 F${i + 1})`)
    nums.add(f.n)
    if (!KINDS.includes(f.kind)) err(f.ln, `종류가 다섯 중 하나가 아니다: ${f.kind}`)
    if (!DATE_OK(f.date)) err(f.ln, `발행일 형식: ${f.date}`)
    if ([...f.quote].length > 200) err(f.ln, `원문이 200자를 넘는다 (${[...f.quote].length})`)
    if (/…|\.\.\.$/.test(f.quote) && sources[f.url]?.result !== 'VERIFIED') warn(f.ln, '원문이 줄임표를 담고 있다')
    if (i > 0 && sortKey(f.date) < sortKey(doc.fragments[i - 1].date)) err(f.ln, '파편이 발행일 순이 아니다')
    if (f.kind === 'SNS' && (/@/.test(f.biblio) || !/^\S+(?: \S+)? (게시글|댓글)$/.test(f.biblio))) err(f.ln, `SNS 서지는 플랫폼명과 글의 종류만 쓴다: ${f.biblio}`)
  })
  const verified = doc.fragments.filter(isVerified)
  if (verified.length < 2) err(0, `확인됨 파편이 2개 미만 (${verified.length})`)
  if (new Set(verified.map(f => f.kind)).size < 2) err(0, '확인됨 파편의 종류가 2가지 미만')
  // 본문의 참조
  const used = new Set()
  for (const sec of ['서술', '조건']) {
    const ps = paragraphs(doc, sec)
    if (!ps.length) err(doc.sections[sec]?.ln ?? 1, `${sec} 절이 비어 있다`)
    if (sec === '서술' && ps.length > 4) warn(ps[4].ln, `서술 문단이 4개를 넘는다 (${ps.length})`)
    for (const p of ps) {
      const sentences = sec === '서술' ? sentenceCount(p.text) : 0
      if (sentences > 4) warn(p.ln, `문단이 4문장을 넘는다 (${sentences})`)
      const refs = [...p.text.matchAll(/\[F(\d+)\]/g)].map(m => Number(m[1]))
      if (!refs.length) err(p.ln, '문단에 근거 파편이 없다')
      for (const r of refs) { used.add(r); if (!nums.has(r)) err(p.ln, `없는 파편 F${r} 를 가리킨다`) }
    }
  }
  for (const [rel, edges] of Object.entries(doc.rel)) for (const e of edges ?? []) for (const r of e.frags) { used.add(r); if (!nums.has(r)) err(e.ln, `없는 파편 F${r} 를 가리킨다`) }
  for (const f of doc.fragments) if (!used.has(f.n)) err(f.ln, `참조되지 않은 파편 F${f.n}`)
  // 관계
  for (const rel of REL_SECTIONS) {
    const sec = doc.headings.find(h => h.text === rel && h.level === 2)
    if (!sec) continue
    const edges = doc.rel[rel] ?? []
    const body = doc.sections['관계']?.lines.filter(l => l.ln > sec.ln && l.ln < (doc.headings.find(h => h.level === 2 && h.ln > sec.ln)?.ln ?? 1e9) && l.text.trim() && l.ln !== (doc.tagLine ? doc.lines.length : 0)) ?? []
    if (!edges.length && !(body.length === 1 && body[0].text.trim() === '없음.')) err(sec.ln, `${rel} 절이 비어 있으면 '없음.' 을 쓴다`)
    for (const e of edges) {
      const other = docs.get(e.id)
      if (!other) { err(e.ln, `링크 대상 파일이 없다: ${e.id}.md`); continue }
      if (!(other.rel[INVERSE[rel]] ?? []).some(x => x.id === doc.id)) err(e.ln, `ASYMMETRIC: ${doc.id} ${rel} ${e.id} 의 역방향이 ${e.id} 의 ${INVERSE[rel]} 에 없다`)
      if ((rel === '원인' || rel === '긴장') && !e.frags.length) err(e.ln, `${rel} 간선에 근거 파편이 없다`)
    }
  }
  const last = doc.lines[doc.lines.length - 1]
  if (!doc.tagLine) err(doc.lines.length, '마지막 줄이 태그 목록이 아니다')
  else if (!doc.tags.some(t => AXES.includes(t))) err(doc.lines.length, `축 태그(${AXES.join(' ')})가 없다`)
  return out
}

export function validateAll(docs, sources = {}) {
  const out = []
  for (const d of docs.values()) out.push(...validateDoc(d, docs, sources))
  const byUrl = new Map(), byAcct = new Map()
  for (const d of docs.values()) for (const f of d.fragments) {
    byUrl.set(f.url, (byUrl.get(f.url) ?? new Set()).add(d.id))
    if (f.kind === 'SNS') { const a = accountOf(f.url); if (a) byAcct.set(a, [...(byAcct.get(a) ?? []), `${d.id}:F${f.n}`]) }
  }
  for (const [url, ids] of byUrl) if (ids.size >= 5) out.push({level: 'WARN', id: [...ids][0], ln: 0, msg: `같은 URL 을 ${ids.size}개 문서가 쓴다: ${url}`})
  for (const [a, refs] of byAcct) if (refs.length > 1) out.push({level: 'ERROR', id: refs[0].split(':')[0], ln: 0, msg: `같은 계정 경로(${a})의 글이 ${refs.length}개 파편에 있다: ${refs.join(', ')}`})
  return out
}
