import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalize, extractText, quoteIn, judge, daysBetween} from './lib/source.mjs'

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
