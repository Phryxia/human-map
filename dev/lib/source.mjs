// 출처 확인 공용 코드: 정규화, 텍스트 추출, 판정.
import {parse} from 'node-html-parser'
import https from 'node:https'

export function normalize(s) {
  return String(s).normalize('NFC')
    .replace(/[“”„‟″「」『』"]/g, '"')
    .replace(/[‘’‚‛′`']/g, "'")
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/[  -​ 　﻿]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

// 블록 태그 경계에는 공백을 넣는다. '안다든지</P><P>이러면' 이 '안다든지이러면' 으로 붙지 않게 하려는 것이다.
const BLOCK_TAGS = ['p', 'br', 'div', 'li', 'ul', 'ol', 'dd', 'dt', 'tr', 'td', 'th', 'table', 'h[1-6]', 'blockquote', 'section', 'article', 'header', 'footer', 'pre', 'hr']
const BLOCK_TAG_RE = new RegExp(`<(/?(?:${BLOCK_TAGS.join('|')}))(?=[\\s/>])`, 'gi')

export function extractText(body, contentType = '') {
  if (/html|xml/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body)) {
    const root = parse(body.replace(BLOCK_TAG_RE, ' <$1'), {blockTextElements: {script: false, style: false, noscript: false}})
    root.querySelectorAll('script,style,noscript,template').forEach(n => n.remove())
    return root.textContent
  }
  if (/^text\/|json/i.test(contentType) || contentType === '') return body
  return null
}

// 브라우저형 UA 를 봇으로 막는 사이트(Springer 등)가 있어 quote 가 주어지면 UA 를 바꿔 한 번 더 받는다.
const USER_AGENTS = ['Mozilla/5.0 (compatible; human-map-source-check)', 'curl/8.5.0']

// 200 으로 오지만 본문 대신 봇 확인을 띄우는 페이지. PMC 는 간헐적으로 reCAPTCHA 확인 페이지를, Springer/BMC 는 Client Challenge 페이지를 준다.
export const CHALLENGE_PATTERNS = [/recaptcha\/challengepage/i, /<title>Just a moment\.\.\.<\/title>/i, /<title>\s*Client Challenge\s*<\/title>/i]

// 바이트를 Content-Type 의 charset, 없으면 앞부분의 meta charset 으로 디코딩한다. 네이트 뉴스처럼 EUC-KR 로 오는 페이지가 있다.
export function decodeBody(bytes, contentType = '') {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096))
  const label = (/charset\s*=\s*["']?([\w-]+)/i.exec(contentType) ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head))?.[1]
  try { return new TextDecoder(label ?? 'utf-8').decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}

async function fetchOnce(url, ua, {timeout, fetchImpl}) {
  try {
    const res = await fetchImpl(url, {redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: {'user-agent': ua, accept: 'text/html,text/plain,*/*'}})
    if (!res.ok) return {ok: false, reason: `HTTP ${res.status}`}
    const ct = res.headers.get('content-type') ?? ''
    const body = res.arrayBuffer ? decodeBody(new Uint8Array(await res.arrayBuffer()), ct) : await res.text()
    if (CHALLENGE_PATTERNS.some(re => re.test(body.slice(0, 5000)))) return {ok: false, reason: '봇 확인 페이지'}
    const text = extractText(body, ct)
    return text === null ? {ok: false, reason: `텍스트가 아니다 (${ct})`} : {ok: true, text}
  } catch (e) { return {ok: false, reason: e.name === 'TimeoutError' || e.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ? '타임아웃' : e.message} }
}

// fetch 는 sec-fetch-mode, accept-language 같은 헤더를 덧붙여 Springer 가 UA 를 curl 로 바꿔도 Client Challenge 를 준다.
// node:https 로 헤더를 그대로 보내는 fetch 꼴 함수. 프록시는 NODE_USE_ENV_PROXY=1 이면 https.get 도 따른다.
export function httpsFetch(url, {headers = {}, signal} = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {headers, signal}, res => {
      const loc = res.headers.location
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && hops < 5) { res.resume(); return resolve(httpsFetch(new URL(loc, url).href, {headers, signal}, hops + 1)) }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('error', reject)
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.length)
        resolve({ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers: new Map([['content-type', res.headers['content-type'] ?? '']]), arrayBuffer: async () => bytes.slice().buffer, text: async () => buf.toString('utf8')})
      })
    })
    req.on('error', reject)
  })
}

// 봇 확인 페이지만 받았으면 challengeDelay 만큼 쉬고 UA 목록을 한 번 더 돈다. 그래도 봇 확인이거나 받은 본문 모두에 원문이 없으면 fallbackImpl 에 curl UA 로 받는다.
// accesson.kr 은 fetch 에는 초록 절을 뺀 본문을, https.get 에는 초록이 있는 본문을 준다(2026-10-18).
export async function fetchText(url, {timeout = 20000, fetchImpl = fetch, fallbackImpl = httpsFetch, quote, challengeDelay = 5000} = {}) {
  let page
  for (let round = 0; round < 2; round++) {
    if (round) await new Promise(r => setTimeout(r, challengeDelay))
    for (const ua of USER_AGENTS) {
      page = await fetchOnce(url, ua, {timeout, fetchImpl})
      if (quote === undefined || (page.ok && quoteIn(page.text, quote))) return page
    }
    if (page.reason !== '봇 확인 페이지') break
  }
  if (page.reason === '봇 확인 페이지') return fetchOnce(url, USER_AGENTS.at(-1), {timeout, fetchImpl: fallbackImpl})
  if (!page.ok) return page
  const last = await fetchOnce(url, USER_AGENTS.at(-1), {timeout, fetchImpl: fallbackImpl})
  return last.ok && quoteIn(last.text, quote) ? last : page
}

export const quoteIn = (text, quote) => normalize(text).includes(normalize(quote))

// 원글이 4xx 일 때 같은 호스트의 / 도 열리지 않으면 글이 아니라 호스트가 이 환경을 막은 것이다(instiz.net, 2026-10-19).
// 원글이 타임아웃일 때 / 도 타임아웃이면 마찬가지다(strathprints.strath.ac.uk, 2026-10-20). / 가 다른 이유(도메인 소멸 등)로 실패하면 막힌 것으로 보지 않는다.
export async function hostBlocked(url, reason, {fetchImpl = fetch, timeout = 20000} = {}) {
  const http4xx = /^HTTP 4\d\d$/.test(reason ?? '')
  if (!http4xx && reason !== '타임아웃') return false
  const home = await fetchOnce(new URL('/', url).href, USER_AGENTS.at(-1), {timeout, fetchImpl})
  return http4xx ? !home.ok : home.reason === '타임아웃'
}

// 결과를 기록과 줄 표시에 맞춰 판정한다. 돌려주는 값: {exit: 0|1, note}
export function judge(frag, result, record, {hostBlocked = false} = {}) {
  const wasVerified = !!record?.lastVerified
  if (result === 'VERIFIED') return {exit: 0, note: frag.unverified ? '(미확인) 표시를 뗄 수 있다' : ''}
  if (wasVerified) {
    if (frag.vanished) return {exit: 0, note: ''}
    if (result === 'UNREACHABLE' && hostBlocked) return {exit: 0, note: '호스트 전체가 막혀 있다(/ 도 열리지 않음). 소멸로 보지 않는다'}
    return {exit: 1, note: `줄 끝을 (소멸, ${record.lastVerified} 까지 확인) 으로 바꾼다`}
  }
  if (result === 'NOT_FOUND') return {exit: 1, note: '원문이 페이지에 없다. 전사나 출처가 틀렸다'}
  return frag.unverified ? {exit: 0, note: ''} : {exit: 1, note: '열리지 않는다. 줄 끝에 (미확인) 을 붙인다'}
}

export const daysBetween = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000)

// Node 의 fetch 는 HTTPS_PROXY 를 기본으로 따르지 않는다. 프록시 환경이면 NODE_USE_ENV_PROXY=1 로 다시 실행해야 한다.
export const needsProxyReexec = env => !!(env.HTTPS_PROXY || env.https_proxy) && env.NODE_USE_ENV_PROXY !== '1'

// rebase 충돌 때 두 쪽 dev/sources.json 을 URL 합집합으로 합친다. 같은 URL 은 마지막 확인이 늦은 쪽의 결과를 쓰고,
// 첫 확인일은 이른 쪽, 마지막 VERIFIED 일은 늦은 쪽, removed 는 한쪽에만 있어도 남긴다.
export function mergeRecords(ours, theirs) {
  const out = {...ours}
  const max = (x, y) => (!x ? y : !y ? x : x > y ? x : y)
  const min = (x, y) => (!x ? y : !y ? x : x < y ? x : y)
  for (const [url, t] of Object.entries(theirs)) {
    const o = out[url]
    if (!o) { out[url] = t; continue }
    const m = {...((t.last ?? '') > (o.last ?? '') ? t : o)}
    m.first = min(o.first, t.first)
    const lv = max(o.lastVerified, t.lastVerified)
    if (lv) m.lastVerified = lv; else delete m.lastVerified
    if (o.removed || t.removed) m.removed = true
    out[url] = m
  }
  return out
}
