import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadAll} from './lib/doc.mjs'
import {styleIssues} from './style-check.mjs'
import {makeDoc, makeRepo} from './lib/fixture.mjs'

const issues = body => styleIssues(loadAll(makeRepo({a: makeDoc({body})})).get('a'))
const has = (body, group) => issues(body).some(i => i.group === group)

test('깨끗한 문단은 통과한다', () => assert.deepEqual(issues('참가자 62%가 응답했다. [F1][F2]'), []))
test('금지 묶음마다 하나씩 잡는다', () => {
  assert.ok(has('누구나 겪는다. [F1][F2]', '범위 뭉뚱그림'))
  assert.ok(has('고쳐야 한다. [F1][F2]', '판단 표현'))
  assert.ok(has('흥미롭게도 늘었다. [F1][F2]', '번역체'))
  assert.ok(has('함정에 빠진다. [F1][F2]', '사전 은유와 의인화'))
  assert.ok(has('늘 것으로 보인다. [F1][F2]', '추론 표현'))
  assert.ok(has('감소했다는 분석이다. [F1][F2]', '주체 없는 판정'))
  assert.ok(has('결론적으로 같다. [F1][F2]', '결산 라벨과 분열문과 도치 결산'))
  assert.ok(has('앞으로 늘 수 있다. [F1][F2]', '막연한 시간'))
  assert.ok(has('나뉘어지게 된다. [F1][F2]', '이중 피동과 이중 조사와 소유 직역'))
  assert.ok(has('말하지만, 달랐다. [F1][F2]', '연결어미 뒤 쉼표'))
  assert.ok(has('늘었다 😀. [F1][F2]', '이모지와 한자'))
  assert.ok(has('**굵게** 썼다. [F1][F2]', '굵게와 기울임과 대시'))
})
test('개수 규칙: 대구 둘, 적 N 셋, 같은 종결 네 번', () => {
  assert.ok(issues('그가 아니라 나다. 내가 아니라 너다. [F1][F2]').some(i => i.group === '개수 규칙'))
  assert.ok(issues('구조적 문제와 심리적 요인과 사회적 압력이 있다. [F1][F2]').some(i => i.group === '개수 규칙'))
  assert.ok(issues('그가 갔다. 그녀가 갔다. 우리가 갔다. 모두 갔다. [F1][F2]').length > 0)
})
test('5문장 문단은 문단 길이로 잡는다', () => assert.ok(has('가 했다. 나 했다? 다는 안 했다. 라는 봤다. 마는 왔다. [F1][F2]', '문단 길이')))
test('동사 어간+고, 는 연결어미 뒤 쉼표 WARN 으로 잡는다', () => {
  const w = issues('2024년 F1 은 바뀌고 있다고 적고, 2022년 F2 는 달랐다. [F1][F2]').filter(i => i.group === '연결어미 뒤 쉼표')
  assert.equal(w.length, 1)
  assert.equal(w[0].level, 'WARN')
  assert.ok(!has('그리고, 갔다. [F1][F2]', '연결어미 뒤 쉼표'))
  assert.ok(!has('F1 은 "먹고, 잤다" 라고 적는다. [F1][F2]', '연결어미 뒤 쉼표'))
  assert.equal(issues('말하고, 갔다. [F1][F2]').filter(i => i.group === '연결어미 뒤 쉼표').length, 1)
})
