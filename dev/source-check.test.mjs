import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalize, extractText, quoteIn, judge, daysBetween, fetchText, hostBlocked, recheckText} from './lib/source.mjs'

test('normalize: 따옴표, 대시, 공백 종류를 맞춘다', () => {
  assert.equal(normalize('“그는” 말했다 – 그리고  떠났다'), '"그는" 말했다 - 그리고 떠났다')
})
test('extractText: HTML 에서 script 를 빼고 텍스트를 뽑는다', () => {
  const t = extractText('<html><body><script>var x="가짜"</script><p>본문 <b>문장</b></p></body></html>', 'text/html')
  assert.ok(t.includes('본문 문장')); assert.ok(!t.includes('가짜'))
  assert.equal(extractText('%PDF', 'application/pdf'), null)
})
test('quoteIn', () => { assert.ok(quoteIn('앞 “인용   문” 뒤', '"인용 문"')); assert.ok(!quoteIn('앞 뒤', '없음')) })
test('judge: 처음 보는 파편', () => {
  const f = {unverified: false, vanished: null}
  assert.equal(judge(f, 'NOT_FOUND', undefined).exit, 1)
  assert.equal(judge(f, 'UNREACHABLE', undefined).exit, 1)
  assert.equal(judge({...f, unverified: true}, 'UNREACHABLE', undefined).exit, 0)
  assert.equal(judge(f, 'VERIFIED', undefined).exit, 0)
  assert.match(judge({...f, unverified: true}, 'VERIFIED', undefined).note, /미확인/)
})
test('judge: 기록에 VERIFIED 가 있던 파편이 사라지면 소멸 표시를 요구한다', () => {
  const rec = {lastVerified: '2026-08-01'}
  const j = judge({unverified: false, vanished: null}, 'NOT_FOUND', rec)
  assert.equal(j.exit, 1); assert.match(j.note, /소멸, 2026-08-01/)
  assert.equal(judge({unverified: false, vanished: '2026-08-01'}, 'UNREACHABLE', rec).exit, 0)
})
test('daysBetween', () => assert.equal(daysBetween('2026-01-01', '2026-04-11'), 100))
test('needsProxyReexec: 프록시 환경에서 NODE_USE_ENV_PROXY 가 없으면 다시 실행한다', async () => {
  const {needsProxyReexec} = await import('./lib/source.mjs')
  assert.equal(needsProxyReexec({HTTPS_PROXY: 'http://x'}), true)
  assert.equal(needsProxyReexec({https_proxy: 'http://x'}), true)
  assert.equal(needsProxyReexec({HTTPS_PROXY: 'http://x', NODE_USE_ENV_PROXY: '1'}), false)
  assert.equal(needsProxyReexec({}), false)
})
test('fetchText: 브라우저형 UA 를 봇으로 막는 사이트는 다른 UA 로 다시 받는다', async () => {
  const fetchImpl = async (url, {headers}) => {
    const body = /Mozilla/.test(headers['user-agent']) ? '<html>차단</html>' : '<html>본문 clandestine means</html>'
    return {ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => body}
  }
  fetchImpl.headers = null
  const page = await fetchText('https://example.org/a', {fetchImpl, quote: 'clandestine means'})
  assert.ok(page.ok && quoteIn(page.text, 'clandestine means'))
})
test('fetchText: quote 가 없으면 첫 응답을 그대로 쓴다', async () => {
  let n = 0
  const fetchImpl = async () => { n++; return {ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => '<html>x</html>'} }
  await fetchText('https://example.org/a', {fetchImpl})
  assert.equal(n, 1)
})
test('fetchText: 200 으로 온 봇 확인 페이지는 UNREACHABLE 로 본다 (PMC 의 reCAPTCHA)', async () => {
  const challenge = '<!doctype html><html><head><base href="https://www.google.com/recaptcha/challengepage/"></head><body>x</body></html>'
  const fetchImpl = async () => ({ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => challenge})
  const page = await fetchText('https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', {fetchImpl, fallbackImpl: fetchImpl, quote: 'tendency to limit', challengeDelay: 0})
  assert.equal(page.ok, false)
  assert.match(page.reason, /봇 확인/)
})
test('fetchText: Springer/BMC 의 Client Challenge 페이지는 UNREACHABLE 로 본다', async () => {
  // link.springer.com/article/10.1007/s12160-010-9210-8, bmcpsychiatry.biomedcentral.com/articles/10.1186/1471-244X-10-113: 200 으로 온 3KB 페이지
  const challenge = '<!DOCTYPE html>\n<html>\n  <head>\n    <title>Client Challenge</title>\n  </head>\n  <body>A required part of this site couldn’t load.</body></html>'
  const fetchImpl = async () => ({ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => challenge})
  const page = await fetchText('https://link.springer.com/article/10.1007/s12160-010-9210-8', {fetchImpl, fallbackImpl: fetchImpl, quote: 'increase vigilance for threat', challengeDelay: 0})
  assert.equal(page.ok, false)
  assert.match(page.reason, /봇 확인/)
})
test('fetchText: 200 으로 온 점검 페이지는 UNREACHABLE 로 본다 (Statistics Canada)', async () => {
  // www150.statcan.gc.ca/n1/daily-quotidien/250617/dq250617d-eng.htm: 2026-10-21 두 UA 모두 200 으로 온 93KB 점검 페이지
  const down = "<!DOCTYPE html><html><head><title>Statistics Canada - We're sorry! The website is currently unavailable / Statistique Canada : Nous sommes\n        désolés! Le site Web n'est pas disponible pour le moment</title></head><body>x</body></html>"
  let n = 0
  const fetchImpl = async () => { n++; return {ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => down} }
  const page = await fetchText('https://www150.statcan.gc.ca/n1/daily-quotidien/250617/dq250617d-eng.htm', {fetchImpl, fallbackImpl: fetchImpl, quote: 'feel rushed', challengeDelay: 0})
  assert.equal(page.ok, false)
  assert.match(page.reason, /점검 페이지/)
})
test('fetchText: 제목이 "- Maintenance" 로 끝나는 점검 페이지도 UNREACHABLE 로 본다 (OneFamily)', async () => {
  // www.onefamily.com/our-story/media-centre/2025/5-million-young-adults-avoid-checking-bills-due-to-money-anxiety/: 2026-10-21 200 으로 온 92KB 점검 페이지
  const down = '﻿<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>OneFamily - Maintenance</title>\n</head><body>x</body></html>'
  const fetchImpl = async () => ({ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => down})
  const page = await fetchText('https://www.onefamily.com/our-story/media-centre/2025/5-million-young-adults-avoid-checking-bills-due-to-money-anxiety/', {fetchImpl, fallbackImpl: fetchImpl, quote: 'avoided opening their bills', challengeDelay: 0})
  assert.equal(page.ok, false)
  assert.match(page.reason, /점검 페이지/)
})
test('fetchText: 제목 중간에 maintenance 가 든 글은 점검 페이지로 보지 않는다', async () => {
  const article = '<html><head><title>Home maintenance tips for winter - Example</title></head><body><p>avoided opening their bills</p></body></html>'
  const fetchImpl = async () => ({ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => article})
  const page = await fetchText('https://example.com/a', {fetchImpl, fallbackImpl: fetchImpl, quote: 'avoided opening their bills', challengeDelay: 0})
  assert.equal(page.ok, true)
})
test('fetchText: fetch 가 봇 확인 페이지만 받으면 node:https 로 curl UA 를 붙여 한 번 더 받는다', async () => {
  // link.springer.com/article/10.1007/s12160-010-9210-8: fetch 는 UA 를 curl 로 바꿔도 Client Challenge, https.get 은 본문(2026-10-17)
  const challenge = '<html><head><title>Client Challenge</title></head></html>'
  const fetchImpl = async () => ({ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => challenge})
  let ua
  const fallbackImpl = async (url, {headers}) => { ua = headers['user-agent']; return {ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => '<html>to increase vigilance for threat</html>'} }
  const page = await fetchText('https://link.springer.com/article/10.1007/s12160-010-9210-8', {fetchImpl, fallbackImpl, quote: 'increase vigilance for threat', challengeDelay: 0})
  assert.ok(page.ok && quoteIn(page.text, 'increase vigilance for threat'))
  assert.equal(ua, 'curl/8.5.0')
})
test('fetchText: fetch 응답 모두에 원문이 없으면 node:https 로 curl UA 를 붙여 한 번 더 받는다', async () => {
  // accesson.kr/healthpsy/v.12/3/631/18715: fetch 로 받은 본문에는 초록 절이 빠지고 https.get 은 초록을 준다(2026-10-18)
  const fetchImpl = async () => ({ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => '<html><head><meta name="description" content="활동형으로 일컬어지는"></head></html>'})
  let ua
  const fallbackImpl = async (url, {headers}) => { ua = headers['user-agent']; return {ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => '<html><p>활동형으로 일컬어지는</p></html>'} }
  const page = await fetchText('https://www.accesson.kr/healthpsy/v.12/3/631/18715', {fetchImpl, fallbackImpl, quote: '활동형으로 일컬어지는'})
  assert.ok(page.ok && quoteIn(page.text, '활동형으로 일컬어지는'))
  assert.equal(ua, 'curl/8.5.0')
})
test('fetchText: node:https 로도 원문이 없거나 실패하면 fetch 의 응답을 돌려준다', async () => {
  const fetchImpl = async () => ({ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => '<html>다른 글</html>'})
  const fallbackImpl = async () => { throw new Error('ECONNRESET') }
  const page = await fetchText('https://example.org/a', {fetchImpl, fallbackImpl, quote: '없는 문장'})
  assert.ok(page.ok && quoteIn(page.text, '다른 글'))
})
test('fetchText: 봇 확인 페이지가 한 번 오면 다시 받는다', async () => {
  let n = 0
  const fetchImpl = async () => {
    const body = n++ === 0 ? '<html><head><base href="https://www.google.com/recaptcha/challengepage/"></head></html>' : '<html>본문 tendency to limit</html>'
    return {ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => body}
  }
  const page = await fetchText('https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', {fetchImpl, quote: 'tendency to limit'})
  assert.ok(page.ok && quoteIn(page.text, 'tendency to limit'))
})
test('fetchText: UA 를 모두 돌아도 봇 확인 페이지면 쉬었다가 한 바퀴 더 받는다', async () => {
  let n = 0
  const fetchImpl = async () => {
    const body = n++ < 2 ? '<html><head><base href="https://www.google.com/recaptcha/challengepage/"></head></html>' : '<html>본문 tendency to limit</html>'
    return {ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => body}
  }
  const page = await fetchText('https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', {fetchImpl, quote: 'tendency to limit', challengeDelay: 0})
  assert.ok(page.ok && quoteIn(page.text, 'tendency to limit'))
  assert.equal(n, 3)
})

test('extractText: 블록 태그 경계에 공백을 넣어 문단을 넘는 원문을 찾는다', () => {
  // kin.naver.com docId=56416069: '안다든지</P><P>이러면' 이 '안다든지이러면' 으로 붙었다
  const t = extractText('<html><body><P>다 안다든지</P><P>이러면 완전</P>줄<br>바꿈<div>가</div><li>나</li></body></html>', 'text/html')
  assert.ok(quoteIn(t, '다 안다든지 이러면 완전'))
  assert.ok(quoteIn(t, '줄 바꿈 가 나'))
  assert.ok(quoteIn(extractText('<html><p>본문 <b>문</b>장</p></html>', 'text/html'), '본문 문장'))
})
test('mergeRecords: rebase 충돌 때 두 쪽 sources.json 을 URL 합집합으로 합친다', async () => {
  const {mergeRecords} = await import('./lib/source.mjs')
  const ours = {
    a: {first: '2026-10-15', last: '2026-10-15', result: 'VERIFIED', lastVerified: '2026-10-15'},
    b: {first: '2026-10-16', last: '2026-10-16', result: 'VERIFIED', lastVerified: '2026-10-16'},
    r: {first: '2026-10-10', last: '2026-10-10', result: 'VERIFIED', lastVerified: '2026-10-10', removed: true},
  }
  const theirs = {
    a: {first: '2026-10-14', last: '2026-10-17', result: 'NOT_FOUND', lastVerified: '2026-10-14'},
    c: {first: '2026-10-17', last: '2026-10-17', result: 'UNREACHABLE'},
    r: {first: '2026-10-10', last: '2026-10-12', result: 'VERIFIED', lastVerified: '2026-10-12'},
  }
  const m = mergeRecords(ours, theirs)
  assert.deepEqual(Object.keys(m).sort(), ['a', 'b', 'c', 'r'])
  assert.deepEqual(m.a, {first: '2026-10-14', last: '2026-10-17', result: 'NOT_FOUND', lastVerified: '2026-10-15'})
  assert.deepEqual(m.b, ours.b)
  assert.deepEqual(m.c, theirs.c)
  assert.equal(m.r.removed, true)
  assert.equal(m.r.lastVerified, '2026-10-12')
})
test('fetchText: EUC-KR 페이지는 Content-Type 이나 meta charset 을 읽어 디코딩한다 (네이트 뉴스)', async () => {
  const html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=euc-kr"></head><body>평소 미용사가 말 거는 게 싫어 자는 척</body></html>'
  const eucKr = Buffer.from('3c68746d6c3e3c686561643e3c6d65746120687474702d65717569763d22436f6e74656e742d547970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d6575632d6b72223e3c2f686561643e3c626f64793ec6f2bcd220b9ccbfebbbe7b0a120b8bb20b0c5b4c220b0d420bdc8beee20c0dab4c220c3b43c2f626f64793e3c2f68746d6c3e', 'hex')
  assert.equal(new TextDecoder('euc-kr').decode(eucKr), html)
  for (const ct of ['text/html; charset=EUC-KR', 'text/html']) {
    const fetchImpl = async () => ({ok: true, status: 200, headers: new Map([['content-type', ct]]), arrayBuffer: async () => eucKr.buffer.slice(eucKr.byteOffset, eucKr.byteOffset + eucKr.length), text: async () => eucKr.toString('utf8')})
    const page = await fetchText('https://m.news.nate.com/view/20260110n00225', {fetchImpl, quote: '평소 미용사가 말 거는 게 싫어 자는 척'})
    assert.ok(page.ok && quoteIn(page.text, '평소 미용사가 말 거는 게 싫어 자는 척'), ct)
  }
})

// instiz.net 은 2026-10-19 오전 VERIFIED 였던 name/49861851 을 저녁에 403 으로 줬고, 홈(/)도 403 이었다. 글이 아니라 호스트가 막은 것이다.
test('judge: 호스트 전체가 막혔으면 VERIFIED 기록이 있어도 소멸 표시를 요구하지 않는다', () => {
  const rec = {first: '2026-10-19', last: '2026-10-19', result: 'VERIFIED', lastVerified: '2026-10-19'}
  const f = {unverified: false, vanished: null}
  const j = judge(f, 'UNREACHABLE', rec, {hostBlocked: true})
  assert.equal(j.exit, 0)
  assert.match(j.note, /호스트/)
  assert.equal(judge(f, 'UNREACHABLE', rec, {hostBlocked: false}).exit, 1)
  assert.equal(judge(f, 'NOT_FOUND', rec, {hostBlocked: true}).exit, 1)
})

test('hostBlocked: 원글이 4xx 이고 호스트의 / 도 열리지 않으면 true', async () => {
  const mk = map => async url => { const s = map[new URL(url).pathname] ?? 200; return {ok: s < 300, status: s, headers: new Map([['content-type', 'text/html']]), text: async () => '<html>x</html>'} }
  assert.equal(await hostBlocked('https://www.instiz.net/name/49861851', 'HTTP 403', {fetchImpl: mk({'/': 403, '/name/49861851': 403})}), true)
  assert.equal(await hostBlocked('https://example.com/gone', 'HTTP 404', {fetchImpl: mk({'/gone': 404})}), false)
  assert.equal(await hostBlocked('https://example.com/slow', '타임아웃', {fetchImpl: mk({'/': 403})}), false)
})

// strathprints.strath.ac.uk 는 2026-10-18 VERIFIED 였던 id/eprint/36504 를 2026-10-20 에 타임아웃으로 줬고(fetch 의 TimeoutError, 연결 단계의 UND_ERR_CONNECT_TIMEOUT 두 꼴), 홈(/)도 연결 타임아웃이었다.
test('hostBlocked: 원글이 타임아웃이고 호스트의 / 도 타임아웃이면 true, / 가 다른 이유로 실패하면 false', async () => {
  const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), {name: 'TimeoutError'})
  const connectTimeout = () => Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}})
  const dead = () => Object.assign(new TypeError('fetch failed'), {cause: {code: 'ENOTFOUND'}})
  const url = 'https://strathprints.strath.ac.uk/id/eprint/36504'
  assert.equal(await hostBlocked(url, '타임아웃', {fetchImpl: async () => { throw connectTimeout() }}), true)
  assert.equal(await hostBlocked(url, '타임아웃', {fetchImpl: async () => { throw timeout() }}), true)
  assert.equal(await hostBlocked(url, '타임아웃', {fetchImpl: async () => { throw dead() }}), false)
  assert.equal(await hostBlocked(url, 'fetch failed', {fetchImpl: async () => { throw dead() }}), false)
})

test('fetchText: 연결 단계 타임아웃도 사유를 타임아웃으로 준다', async () => {
  const fetchImpl = async () => { throw Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}}) }
  const page = await fetchText('https://strathprints.strath.ac.uk/id/eprint/36504', {fetchImpl, fallbackImpl: fetchImpl, challengeDelay: 0})
  assert.equal(page.reason, '타임아웃')
})

// 2026-10-20 bicycle-helmet-nonuse F3 의 PMC1730748 은 VERIFIED 다음 실행에서 HTTP 403, 그다음 실행에서 다시 VERIFIED 였다.
// 같은 날 F5 의 mediahub.seoul.go.kr/archives/1179033 은 fetch failed 두 번 뒤 다시 VERIFIED 였다. VERIFIED 기록이 있던 파편이 실패하면 쉬었다가 한 번 더 받는다.
test('recheckText: VERIFIED 기록이 있던 파편이 한 번 실패하면 쉬었다가 다시 받는다', async () => {
  const quote = '헬멧을 쓰지 않는 이유'
  const ok = {ok: true, text: `앞 ${quote} 뒤`}
  const seq = pages => { let i = 0; const calls = []; return {calls, fetch: async url => { calls.push(url); return pages[Math.min(i++, pages.length - 1)] }} }
  const pmc = seq([{ok: false, reason: 'HTTP 403'}, ok])
  const p1 = await recheckText('https://pmc.ncbi.nlm.nih.gov/articles/PMC1730748/', {quote, wasVerified: true, fetchText: pmc.fetch, delay: 0})
  assert.ok(p1.ok && quoteIn(p1.text, quote)); assert.equal(pmc.calls.length, 2)
  const hub = seq([{ok: false, reason: 'fetch failed'}, ok])
  assert.ok((await recheckText('https://mediahub.seoul.go.kr/archives/1179033', {quote, wasVerified: true, fetchText: hub.fetch, delay: 0})).ok)
  // 원문이 없는 200 도 한 번 더 받는다
  const nf = seq([{ok: true, text: '다른 본문'}, ok])
  assert.ok(quoteIn((await recheckText('https://example.com/a', {quote, wasVerified: true, fetchText: nf.fetch, delay: 0})).text, quote))
  // 두 번 모두 실패하면 두 번째 결과로 판정한다
  const gone = seq([{ok: false, reason: 'HTTP 404'}, {ok: false, reason: 'HTTP 410'}])
  assert.equal((await recheckText('https://example.com/gone', {quote, wasVerified: true, fetchText: gone.fetch, delay: 0})).reason, 'HTTP 410')
  // 처음 보는 파편과 첫 응답이 맞은 파편은 다시 받지 않는다
  const first = seq([{ok: false, reason: 'HTTP 403'}, ok])
  assert.equal((await recheckText('https://example.com/new', {quote, wasVerified: false, fetchText: first.fetch, delay: 0})).ok, false); assert.equal(first.calls.length, 1)
  const once = seq([ok, ok])
  await recheckText('https://example.com/ok', {quote, wasVerified: true, fetchText: once.fetch, delay: 0}); assert.equal(once.calls.length, 1)
})

// scholarworks.umass.edu 는 2026-10-21 같은 글을 타임아웃과 'fetch failed' 로 번갈아 줬고, 'fetch failed' 의 원인을 기록하지 않아 분류를 고칠 수 없었다.
test('fetchText 는 fetch failed 의 원인 코드를 reason 에 붙인다', async () => {
  const fetchImpl = async () => { throw Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_SOCKET'}}) }
  const page = await fetchText('https://example.org/a', {fetchImpl, fallbackImpl: fetchImpl})
  assert.equal(page.reason, 'fetch failed (UND_ERR_SOCKET)')
})

// 이슈 #6: start.umd.edu, scholarworks.iu.edu 는 글과 / 모두 SELF_SIGNED_CERT_IN_CHAIN, archive.carla.umn.edu 는 UNABLE_TO_GET_ISSUER_CERT_LOCALLY,
// abs.gov.au 는 글과 / 모두 503, www150.statcan.gc.ca 는 글과 / 모두 점검 페이지였다(2026-10-21).
test('hostBlocked: TLS 실패, 5xx, 점검 페이지도 / 가 같은 종류로 실패하면 true', async () => {
  const tls = code => async () => { throw Object.assign(new TypeError('fetch failed'), {cause: {code}}) }
  const status = s => async () => ({ok: s < 300, status: s, headers: new Map([['content-type', 'text/html']]), text: async () => '<html>x</html>'})
  const page = body => async () => ({ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => body})
  const maint = page('<html><title>Statistics Canada - website is currently unavailable</title></html>')
  assert.equal(await hostBlocked('https://start.umd.edu/publication/x', 'fetch failed (SELF_SIGNED_CERT_IN_CHAIN)', {fetchImpl: tls('SELF_SIGNED_CERT_IN_CHAIN')}), true)
  assert.equal(await hostBlocked('https://archive.carla.umn.edu/speechacts/refusals/tt.html', 'fetch failed (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)', {fetchImpl: tls('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')}), true)
  assert.equal(await hostBlocked('https://www.abs.gov.au/articles/x', 'HTTP 503', {fetchImpl: status(503)}), true)
  assert.equal(await hostBlocked('https://www150.statcan.gc.ca/n1/x', '점검 페이지', {fetchImpl: maint}), true)
  assert.equal(await hostBlocked('https://www.abs.gov.au/articles/x', 'HTTP 503', {fetchImpl: status(200)}), false)
  assert.equal(await hostBlocked('https://start.umd.edu/publication/x', 'fetch failed (SELF_SIGNED_CERT_IN_CHAIN)', {fetchImpl: status(503)}), false)
  assert.equal(await hostBlocked('https://www150.statcan.gc.ca/n1/x', '점검 페이지', {fetchImpl: page('<html>ok</html>')}), false)
  assert.equal(await hostBlocked('https://example.com/x', 'fetch failed (ECONNRESET)', {fetchImpl: tls('ECONNRESET')}), false)
})
test('extractText: JSON-LD 의 articleBody 를 본문으로 넣는다', () => {
  // ctvnews.ca(Arc): 본문이 HTML 에 없고 ld+json 의 articleBody 에만 있다(2026-10-23)
  const ld = JSON.stringify({'@type': 'NewsArticle', articleBody: 'While 40 per cent of children think they’re getting more'})
  const t = extractText(`<html><head><script type="application/ld+json">${ld}</script><script>var x="가짜"</script></head><body><p>메뉴</p></body></html>`, 'text/html')
  assert.ok(quoteIn(t, 'While 40 per cent of children think they’re getting more'))
  assert.ok(!t.includes('가짜'))
  const graph = JSON.stringify({'@graph': [{'@type': 'WebPage'}, {'@type': 'Article', articleBody: '그래프 안 본문'}]})
  assert.ok(quoteIn(extractText(`<html><script type="application/ld+json">${graph}</script><script type="application/ld+json">{깨진</script></html>`, 'text/html'), '그래프 안 본문'))
})
