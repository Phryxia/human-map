// 출처 확인 공용 코드: 정규화, 텍스트 추출, 판정.
import {parse} from 'node-html-parser'

export function normalize(s) {
  return String(s).normalize('NFC')
    .replace(/[“”„‟″「」『』"]/g, '"')
    .replace(/[‘’‚‛′`']/g, "'")
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/[  -​ 　﻿]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

export function extractText(body, contentType = '') {
  if (/html|xml/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body)) {
    const root = parse(body, {blockTextElements: {script: false, style: false, noscript: false}})
    root.querySelectorAll('script,style,noscript,template').forEach(n => n.remove())
    return root.textContent
  }
  if (/^text\/|json/i.test(contentType) || contentType === '') return body
  return null
}

// 브라우저형 UA 를 봇으로 막는 사이트(Springer 등)가 있어 quote 가 주어지면 UA 를 바꿔 한 번 더 받는다.
const USER_AGENTS = ['Mozilla/5.0 (compatible; human-map-source-check)', 'curl/8.5.0']

// 200 으로 오지만 본문 대신 봇 확인을 띄우는 페이지. PMC 는 간헐적으로 reCAPTCHA 확인 페이지를 준다.
export const CHALLENGE_PATTERNS = [/recaptcha\/challengepage/i, /<title>Just a moment\.\.\.<\/title>/i]

async function fetchOnce(url, ua, {timeout, fetchImpl}) {
  try {
    const res = await fetchImpl(url, {redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: {'user-agent': ua, accept: 'text/html,text/plain,*/*'}})
    if (!res.ok) return {ok: false, reason: `HTTP ${res.status}`}
    const ct = res.headers.get('content-type') ?? ''
    const body = await res.text()
    if (CHALLENGE_PATTERNS.some(re => re.test(body.slice(0, 5000)))) return {ok: false, reason: '봇 확인 페이지'}
    const text = extractText(body, ct)
    return text === null ? {ok: false, reason: `텍스트가 아니다 (${ct})`} : {ok: true, text}
  } catch (e) { return {ok: false, reason: e.name === 'TimeoutError' ? '타임아웃' : e.message} }
}

// 봇 확인 페이지만 받았으면 challengeDelay 만큼 쉬고 UA 목록을 한 번 더 돈다.
export async function fetchText(url, {timeout = 20000, fetchImpl = fetch, quote, challengeDelay = 5000} = {}) {
  let page
  for (let round = 0; round < 2; round++) {
    if (round) await new Promise(r => setTimeout(r, challengeDelay))
    for (const ua of USER_AGENTS) {
      page = await fetchOnce(url, ua, {timeout, fetchImpl})
      if (quote === undefined || (page.ok && quoteIn(page.text, quote))) return page
    }
    if (page.reason !== '봇 확인 페이지') break
  }
  return page
}

export const quoteIn = (text, quote) => normalize(text).includes(normalize(quote))

// 결과를 기록과 줄 표시에 맞춰 판정한다. 돌려주는 값: {exit: 0|1, note}
export function judge(frag, result, record) {
  const wasVerified = !!record?.lastVerified
  if (result === 'VERIFIED') return {exit: 0, note: frag.unverified ? '(미확인) 표시를 뗄 수 있다' : ''}
  if (wasVerified) {
    if (frag.vanished) return {exit: 0, note: ''}
    return {exit: 1, note: `줄 끝을 (소멸, ${record.lastVerified} 까지 확인) 으로 바꾼다`}
  }
  if (result === 'NOT_FOUND') return {exit: 1, note: '원문이 페이지에 없다. 전사나 출처가 틀렸다'}
  return frag.unverified ? {exit: 0, note: ''} : {exit: 1, note: '열리지 않는다. 줄 끝에 (미확인) 을 붙인다'}
}

export const daysBetween = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000)

// Node 의 fetch 는 HTTPS_PROXY 를 기본으로 따르지 않는다. 프록시 환경이면 NODE_USE_ENV_PROXY=1 로 다시 실행해야 한다.
export const needsProxyReexec = env => !!(env.HTTPS_PROXY || env.https_proxy) && env.NODE_USE_ENV_PROXY !== '1'
