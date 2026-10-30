import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadAll} from './lib/doc.mjs'
import {styleIssues} from './style-check.mjs'
import {makeDoc, makeRepo} from './lib/fixture.mjs'

const issues = body => styleIssues(loadAll(makeRepo({a: makeDoc({body})})).get('a'))
const has = (body, group) => issues(body).some(i => i.group === group)

test('깨끗한 문단은 통과한다', () => assert.deepEqual(issues('참가자 62%가 응답했다.[^1][^2]'), []))
test('금지 묶음마다 하나씩 잡는다', () => {
  assert.ok(has('누구나 겪는다.[^1][^2]', '범위 뭉뚱그림'))
  assert.ok(has('고쳐야 한다.[^1][^2]', '판단 표현'))
  assert.ok(has('흥미롭게도 늘었다.[^1][^2]', '번역체'))
  assert.ok(has('함정에 빠진다.[^1][^2]', '사전 은유와 의인화'))
  assert.ok(has('늘 것으로 보인다.[^1][^2]', '추론 표현'))
  assert.ok(has('감소했다는 분석이다.[^1][^2]', '주체 없는 판정'))
  assert.ok(has('결론적으로 같다.[^1][^2]', '결산 라벨과 분열문과 도치 결산'))
  assert.ok(has('앞으로 늘 수 있다.[^1][^2]', '막연한 시간'))
  assert.ok(has('나뉘어지게 된다.[^1][^2]', '이중 피동과 이중 조사와 소유 직역'))
  assert.ok(has('말하지만, 달랐다.[^1][^2]', '연결어미 뒤 쉼표'))
  assert.ok(has('늘었다 😀.[^1][^2]', '이모지와 한자'))
  assert.ok(has('**굵게** 썼다.[^1][^2]', '굵게와 기울임과 대시'))
})
test('대립의 뜻으로 쓴 긴장은 번역체로 잡고 감정의 긴장은 잡지 않는다', () => {
  assert.ok(has('두 사고 사이의 긴장이 있다.[^1][^2]', '번역체'))
  assert.ok(has('관계의 긴장을 해소하려 했다.[^1][^2]', '번역체'))
  assert.ok(has('진영 간 긴장 속에 있었다.[^1][^2]', '번역체'))
  assert.ok(!has('면접관 앞에서 긴장해 얼굴이 붉어졌다.[^1][^2]', '번역체'))
  assert.ok(!has('불안과 긴장을 느낀다.[^1][^2]', '번역체'))
})
test('개수 규칙: 대구 둘, 적 N 셋, 같은 종결 네 번', () => {
  assert.ok(issues('그가 아니라 나다. 내가 아니라 너다.[^1][^2]').some(i => i.group === '개수 규칙'))
  assert.ok(issues('구조적 문제와 심리적 요인과 사회적 압력이 있다.[^1][^2]').some(i => i.group === '개수 규칙'))
  assert.ok(issues('그가 갔다. 그녀가 갔다. 우리가 갔다. 모두 갔다.[^1][^2]').length > 0)
})
test('5문장 문단은 문단 길이로 잡는다', () => assert.ok(has('가 했다. 나 했다? 다는 안 했다. 라는 봤다. 마는 왔다.[^1][^2]', '문단 길이')))
test('동사 어간+고, 는 연결어미 뒤 쉼표 ERROR 로 잡는다', () => {
  const w = issues('2024년 F1 은 바뀌고 있다고 적고, 2022년 F2 는 달랐다.[^1][^2]').filter(i => i.group === '연결어미 뒤 쉼표')
  assert.equal(w.length, 1)
  assert.equal(w[0].level, 'ERROR')
  assert.ok(!has('그리고, 갔다.[^1][^2]', '연결어미 뒤 쉼표'))
  assert.ok(!has('F1 은 "먹고, 잤다" 라고 적는다.[^1][^2]', '연결어미 뒤 쉼표'))
  assert.equal(issues('말하고, 갔다.[^1][^2]').filter(i => i.group === '연결어미 뒤 쉼표').length, 1)
})
test('명사 사고·원고·재고 등의 나열 쉼표는 연결어미 뒤 쉼표로 잡지 않는다', () => {
  assert.ok(!has('충동성과 감각 추구는 사고, 공격 운전, 위험 운전을 예측한다.[^1][^2]', '연결어미 뒤 쉼표'))
  assert.ok(!has('방송 원고, 기사, 게시글에 나온다.[^1][^2]', '연결어미 뒤 쉼표'))
  assert.ok(!has('규범적 평가, 경제 사정 재고, 구매 결정 연기를 거친다.[^1][^2]', '연결어미 뒤 쉼표'))
  assert.ok(!has('교통사고, 경고, 광고, 최고, 창고, 공고, 금고가 있다.[^1][^2]', '연결어미 뒤 쉼표'))
  assert.ok(has('화를 참고, 웃었다.[^1][^2]', '연결어미 뒤 쉼표'))
  assert.ok(has('밥을 먹고, 잤다.[^1][^2]', '연결어미 뒤 쉼표'))
})
test('제목·별칭·요약 줄의 한자와 이모지도 잡는다', () => {
  const head = text => styleIssues(loadAll(makeRepo({a: text})).get('a')).filter(i => i.group === '이모지와 한자')
  const alias = makeDoc().replace('별칭: 없음', '별칭: 상사 눈치에 퇴근 못 하기, 付き合い残業')
  assert.deepEqual(head(alias).map(i => i.ln), [3])
  assert.equal(head(alias)[0].level, 'ERROR')
  assert.equal(head(makeDoc({title: '향수 😀'})).length, 1)
  assert.equal(head(makeDoc({summary: '사람이 殘業 한다.'})).length, 1)
  assert.deepEqual(head(makeDoc()), [])
})
test('공간의 앞으로는 막연한 시간으로 잡지 않는다', () => {
  assert.ok(!has('남편은 솥을 앞으로 들고 나갔다.[^1][^2]', '막연한 시간'))
  assert.ok(!has('누나는 동생 앞으로 그릇을 밀어 놓았다.[^1][^2]', '막연한 시간'))
  assert.ok(has('앞으로 그 수가 늘어난다.[^1][^2]', '막연한 시간'))
  assert.ok(has('앞으로도 일하기를 바란다.[^1][^2]', '막연한 시간'))
})
test('되묻기의 다시 말해 달라·주는 번역체로 잡지 않는다', () => {
  assert.ok(has('다시 말해 소진된 참가자가 더 미뤘다.[^1][^2]', '번역체'))
  assert.ok(!has('상대에게 다시 말해 달라고 하고도 알아듣지 못했다.[^1][^2]', '번역체'))
  assert.ok(!has('그녀에게 다시 말해 달라고 했는데도 한 마디도 알아듣지 못했다.[^1][^2]', '번역체'))
  assert.ok(!has('한 번 더 다시 말해 주기를 청했다.[^1][^2]', '번역체'))
})
test('요약 줄에도 서술과 같은 금지 묶음을 적용한다', () => {
  const sum = summary => styleIssues(loadAll(makeRepo({a: makeDoc({summary})})).get('a'))
  const w = sum('상속을 기대하는 사람이 물려받을 재산을 앞으로의 살림 계산에 넣는다.')
  assert.ok(w.some(i => i.group === '막연한 시간' && i.ln === 5 && i.level === 'ERROR'))
  assert.ok(sum('누구나 실수를 숨긴다.').some(i => i.group === '범위 뭉뚱그림'))
  assert.deepEqual(sum('사람이 어떤 상황에서 무언가를 한다.'), [])
})
test('해야 한다고 여기다, 해야 한다는 압박처럼 생각을 옮긴 말은 판단 표현으로 잡지 않는다', () => {
  assert.ok(!has('그는 완벽해야 한다고 여겼다.[^1][^2]', '판단 표현'))
  assert.ok(!has('빨리 답해야 한다는 압박을 느꼈다.[^1][^2]', '판단 표현'))
  assert.ok(has('빨리 답해야 한다.[^1][^2]', '판단 표현'))
})
test('지게 된다 말고 다른 활용의 이중 피동도 잡는다', () => {
  assert.ok(has('특별하게 느껴지게 된 물건이 쌓였다.[^1][^2]', '이중 피동과 이중 조사와 소유 직역'))
  assert.ok(has('둘로 나뉘어지게 됐다.[^1][^2]', '이중 피동과 이중 조사와 소유 직역'))
  assert.ok(has('잊혀지게 되었다.[^1][^2]', '이중 피동과 이중 조사와 소유 직역'))
  assert.ok(!has('물건이 쌓여 잡동사니가 됐다.[^1][^2]', '이중 피동과 이중 조사와 소유 직역'))
})
test('실물 열쇠는 사전 은유로 잡지 않고 은유의 열쇠는 잡는다', () => {
  assert.ok(!has('필자는 열쇠꾸러미가 어머니 집에 꼭 있을 거라 믿었다.[^1][^2]', '사전 은유와 의인화'))
  assert.ok(!has('응답자는 차 열쇠를 찾느라 늦었다.[^1][^2]', '사전 은유와 의인화'))
  assert.ok(!has('그는 열쇠를 잃어버렸다.[^1][^2]', '사전 은유와 의인화'))
  assert.ok(has('신뢰가 관계의 열쇠다.[^1][^2]', '사전 은유와 의인화'))
  assert.ok(has('해결의 열쇠를 쥐었다.[^1][^2]', '사전 은유와 의인화'))
})
