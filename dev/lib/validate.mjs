// validate 검사 묶음. 결과는 {level: 'ERROR'|'WARN', id, ln, msg} 목록.
import {KINDS, TAG_COUNT, loadTags, SECTIONS, REL_SECTIONS, INVERSE, FILE_RE, paragraphs, isVerified, refsIn} from './doc.mjs'

// SNS URL 의 계정 경로. 첫 캡처 그룹이 계정이다.
export const ACCOUNT_PATTERNS = [
  /^https?:\/\/(?:www\.|old\.)?reddit\.com\/(?:user|u)\/([^/?#]+)/i,
  /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([^/?#]+)\/status\//i,
  /^https?:\/\/(?:www\.)?threads\.net\/@([^/?#]+)/i,
  /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/)([^/?#]+)/i,
  /^https?:\/\/(?:www\.)?facebook\.com\/(?!groups\/|watch)([^/?#]+)/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)?bsky\.app\/profile\/([^/?#]+)/i,
  /^https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)([^/?#]+)/i,
  /^https?:\/\/([a-z0-9-]+)\.mastodon\.[a-z]+\/@([^/?#]+)/i,
]
// 블로그 플랫폼의 계정 경로. 종류(매체, SNS)와 상관없이 잰다. 이름이 계정 앞에 붙는다.
export const BLOG_PATTERNS = [
  ['brunch', /^https?:\/\/(?:www\.)?brunch\.co\.kr\/@(@?[^/?#]+)/i],
  ['tistory', /^https?:\/\/(?!www\.)([a-z0-9-]+)\.tistory\.com(?:[/?#]|$)/i],
  ['naver', /^https?:\/\/(?:m\.)?blog\.naver\.com\/(?!PostView)([^/?#]+)/i],
  ['medium', /^https?:\/\/(?:www\.)?medium\.com\/@([^/?#]+)/i],
  ['velog', /^https?:\/\/(?:www\.)?velog\.io\/@([^/?#]+)/i],
  ['substack', /^https?:\/\/(?!www\.)([a-z0-9-]+)\.substack\.com(?:[/?#]|$)/i],
  ['blogspot', /^https?:\/\/([a-z0-9-]+)\.blogspot\.[a-z.]+(?:[/?#]|$)/i],
]
export const blogAccountOf = url => {
  for (const [name, re] of BLOG_PATTERNS) { const m = re.exec(url); if (m) return `${name}/${m[1].toLowerCase()}` }
  return null
}
export const accountOf = url => {
  for (const re of ACCOUNT_PATTERNS) { const m = re.exec(url); if (m) return m.slice(1).join('/').toLowerCase() }
  return blogAccountOf(url)
}

const DATE_OK = d => d === '발행일 미상' || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(d)
const sortKey = d => d === '발행일 미상' ? '' : d
// 문장 끝: 공백이나 문단 끝 앞의 마침표·물음표·느낌표. 15.6% 같은 소수점은 세지 않는다.
// 본문이 파편을 번호로 부르는 F<n>(옛 형식). 파편은 각주 [^n] 로만 가리킨다.
const MENTION_RE = /(?<![A-Za-z0-9^])F\d+\b/g
const sentenceCount = text => text.replace(/\[\^\d+\]/g, '').match(/[.?!](?=\s|$)/g)?.length ?? 0
// 문단을 문장으로 나눈다. 문장 끝 뒤에 붙은 각주는 그 문장에 든다.
export const splitSentences = text => text.match(/[^]*?[.?!](?:\[\^\d+\])*(?=\s|$)|[^]+$/g)?.map(s => s.trim()).filter(Boolean) ?? []
// 각주 없는 문장이 앞에 있는데 뒤 문장이 출처 둘 이상을 단 경우. 어느 문장이 어느 출처인지 알 수 없다(이슈 #7).
export function mergedAttributions(text) {
  const out = []
  let pending = 0
  for (const s of splitSentences(text)) {
    const refs = new Set(refsIn(s))
    if (!refs.size) { pending++; continue }
    if (pending && refs.size > 1) out.push(s)
    pending = 0
  }
  return out
}

// sources 는 dev/sources.json 의 URL 별 기록. VERIFIED 인 출처의 원문은 출처에 글자 그대로 있으므로 줄임표도 원글의 것이다.
export function validateDoc(doc, docs, sources = {}, tags = loadTags()) {
  const out = []
  const err = (ln, msg) => out.push({level: 'ERROR', id: doc.id, ln, msg})
  const warn = (ln, msg) => out.push({level: 'WARN', id: doc.id, ln, msg})
  if (!FILE_RE.test(doc.id + '.md')) err(1, '파일명이 규격이 아니다')
  if (!doc.title) err(1, '제목이 없다')
  if (doc.aliases === null || doc.aliases === '') err(3, '별칭 줄이 없다')
  // GitHub 은 ~ 두 개 사이를 취소선으로 그린다(이슈 #13). URL 안의 ~ 는 링크다.
  doc.lines.forEach((l, i) => { if (/(?<!\\)~/.test(l.replace(/https?:\/\/\S+/g, ''))) err(i + 1, '물결은 \\~ 로 쓴다') })
  if (!doc.summary || !/^[^.]+\.$/.test(doc.summary)) err(5, '요약은 마침표 하나로 끝나는 한 문장이어야 한다')
  const h1 = doc.headings.filter(h => h.level === 1).map(h => h.text)
  if (h1.join('|') !== SECTIONS.join('|')) err(1, `헤딩이 ${SECTIONS.join(', ')} 순서와 다르다 (${h1.join(', ')})`)
  const h2 = doc.headings.filter(h => h.level === 2)
  if (h2.map(h => h.text).join('|') !== REL_SECTIONS.join('|') || h2.some(h => h.parent !== '관계')) err(1, `관계의 하위 헤딩이 ${REL_SECTIONS.join(', ')} 순서와 다르다`)
  // 파편
  for (const b of doc.badFragLines) err(b.ln, '파편 줄이 형식에 맞지 않는다')
  for (const b of doc.badRelLines) err(b.ln, '관계 줄 형식이 맞지 않는다: - [제목](id.md)[^n]')
  for (const b of doc.strayLines) err(b.ln, b.text.startsWith('[^') ? '각주 정의는 태그 줄 뒤에만 둔다' : '태그 줄 뒤에는 각주 정의만 둔다')
  const nums = new Set(), firstByUrl = new Map()
  doc.fragments.forEach((f, i) => {
    if (firstByUrl.has(f.url)) err(f.ln, `한 출처에서 한 파편만 쓴다: [^${firstByUrl.get(f.url)}] 와 [^${f.n}] 이 같은 URL ${f.url}`)
    else firstByUrl.set(f.url, f.n)
    if (f.n !== i + 1) err(f.ln, `파편 번호가 순서와 다르다 ([^${f.n}], 기대 [^${i + 1}])`)
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
  for (const sec of ['서술']) {
    const ps = paragraphs(doc, sec)
    if (!ps.length) err(doc.sections[sec]?.ln ?? 1, `${sec} 절이 비어 있다`)
    // 문단은 그 문단이 가리키는 가장 이른 파편의 발행일 순이다(이슈 #14). 파편 번호가 발행일 순이므로 번호로 견준다.
    let prevMin = 0
    for (const p of ps) {
      const r = refsIn(p.text)
      if (!r.length) continue
      const m = Math.min(...r)
      if (m < prevMin) err(p.ln, `서술 문단이 발행일 순이 아니다: 이 문단의 첫 파편 [^${m}] 이 앞 문단의 [^${prevMin}] 보다 이르다`)
      prevMin = Math.max(prevMin, m)
    }
    for (const p of ps) {
      const sentences = sentenceCount(p.text)
      if (sentences > 4) err(p.ln, `문단이 4문장을 넘는다 (${sentences})`)
      for (const s of mergedAttributions(p.text)) err(p.ln, `출처가 다른 문장을 각주 묶음 하나로 받친다. 문장마다 자기 각주를 단다: ${s.slice(0, 40)}`)
      const refs = refsIn(p.text)
      for (const r of refs) { used.add(r); if (!nums.has(r)) err(p.ln, `없는 파편 [^${r}] 를 가리킨다`) }
      // 따옴표 안(인용한 말)은 빼고 본다
      for (const m of p.text.replace(/"[^"]*"|“[^”]*”/g, '').matchAll(MENTION_RE)) err(p.ln, `본문이 파편을 번호(${m[0]})로 부른다. 각주 [^n] 로 가리킨다`)
    }
  }
  // 별칭마다 그 이름이 원문이나 서지에 든 파편을 각주로 단다(이슈 #9)
  const anorm = s => s.toLowerCase().replace(/[\s\-‐–—_'’"“”·・.,()]/g, '')
  for (const a of doc.aliasList) {
    if (!a.refs.length) { err(doc.aliasLn, `별칭에 사용례 각주가 없다: ${a.name}`); continue }
    for (const r of a.refs) { used.add(r); if (!nums.has(r)) err(doc.aliasLn, `없는 파편 [^${r}] 를 가리킨다`) }
    const fs = doc.fragments.filter(f => a.refs.includes(f.n))
    if (fs.length && !fs.some(f => anorm(f.quote + ' ' + f.biblio).includes(anorm(a.name)))) err(doc.aliasLn, `각주의 원문과 서지에 별칭이 없다: ${a.name}`)
  }
  for (const [rel, edges] of Object.entries(doc.rel)) for (const e of edges ?? []) for (const r of e.frags) { used.add(r); if (!nums.has(r)) err(e.ln, `없는 파편 [^${r}] 를 가리킨다`) }
  for (const f of doc.fragments) if (!used.has(f.n)) err(f.ln, `참조되지 않은 파편 [^${f.n}]`)
  // 관계
  for (const rel of REL_SECTIONS) {
    const sec = doc.headings.find(h => h.text === rel && h.level === 2)
    if (!sec) continue
    const edges = doc.rel[rel] ?? []
    const body = doc.sections['관계']?.lines.filter(l => l.ln > sec.ln && l.ln < (doc.headings.find(h => h.level === 2 && h.ln > sec.ln)?.ln ?? 1e9) && l.text.trim()) ?? []
    if (!edges.length && !(body.length === 1 && body[0].text.trim() === '없음.')) err(sec.ln, `${rel} 절이 비어 있으면 '없음.' 을 쓴다`)
    for (const e of edges) {
      const other = docs.get(e.id)
      if (!other) { err(e.ln, `링크 대상 파일이 없다: ${e.id}.md`); continue }
      if (!(other.rel[INVERSE[rel]] ?? []).some(x => x.id === doc.id)) err(e.ln, `ASYMMETRIC: ${doc.id} ${rel} ${e.id} 의 역방향이 ${e.id} 의 ${INVERSE[rel]} 에 없다`)
      if ((rel === '원인' || rel === '대립') && !e.frags.length) err(e.ln, `${rel} 간선에 근거 파편이 없다`)
    }
  }
  if (!doc.tagLine) err(doc.lines.length, '각주 정의 앞의 마지막 줄이 태그 목록이 아니다')
  else for (const t of doc.tags) if (!tags.includes(t)) err(doc.tagLn, `관심사 태그가 아니다: #${t} (dev/tags.json: ${tags.map(x => '#' + x).join(' ')})`)
  return out
}

export function validateAll(docs, sources = {}, tags = loadTags()) {
  const out = []
  if (tags.length !== TAG_COUNT || new Set(tags).size !== TAG_COUNT || tags.some(t => !/^[가-힣a-z0-9_]+$/.test(t))) out.push({level: 'ERROR', id: 'tags.json', ln: 0, msg: `관심사 태그는 서로 다른 ${TAG_COUNT}개여야 한다 (${tags.length}개)`})
  for (const d of docs.values()) out.push(...validateDoc(d, docs, sources, tags))
  const byUrl = new Map(), byAcct = new Map()
  for (const d of docs.values()) for (const f of d.fragments) {
    byUrl.set(f.url, (byUrl.get(f.url) ?? new Set()).add(d.id))
    // 계정 경로가 URL 에 없는 SNS 글은 글 하나가 곧 한 사람이므로 URL 을 계정으로 잰다
    const a = f.kind === 'SNS' ? accountOf(f.url) ?? `글/${f.url}` : blogAccountOf(f.url)
    if (a) { byAcct.set(a, [...(byAcct.get(a) ?? []), `${d.id}:[^${f.n}]`]) }
  }
  for (const [url, ids] of byUrl) if (ids.size >= 5) out.push({level: 'WARN', id: [...ids][0], ln: 0, msg: `같은 URL 을 ${ids.size}개 문서가 쓴다: ${url}`})
  // 계정 경로 없는 SNS 글 검사는 기존 문서가 고쳐질 때까지 WARN 이다
  const isWarn = a => a.startsWith('글/')
  for (const [a, refs] of byAcct) if (refs.length > 1) out.push({level: isWarn(a) ? 'WARN' : 'ERROR', id: refs[0].split(':')[0], ln: 0, msg: `같은 계정 경로(${a})의 글이 ${refs.length}개 파편에 있다: ${refs.join(', ')}`})
  return out
}
