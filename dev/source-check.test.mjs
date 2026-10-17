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
  const page = await fetchText('https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', {fetchImpl, quote: 'tendency to limit', challengeDelay: 0})
  assert.equal(page.ok, false)
  assert.match(page.reason, /봇 확인/)
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
