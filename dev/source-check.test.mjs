import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalize, extractText, quoteIn, judge, daysBetween, fetchText} from './lib/source.mjs'

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
