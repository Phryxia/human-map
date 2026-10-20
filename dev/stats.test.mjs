import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadAll} from './lib/doc.mjs'
import {buildReadme, kindCounts} from './stats.mjs'
import {makeDoc, makeRepo} from './lib/fixture.mjs'

test('집계: 문서, 종류, 깊이', () => {
  const docs = loadAll(makeRepo({
    a: makeDoc({rel: {상위: ['- [비](b.md)']}}),
    b: makeDoc({title: '비', rel: {하위: ['- [제목](a.md)']}}),
  }))
  assert.deepEqual(kindCounts(docs), {학술: 2, 공공: 0, 매체: 2, SNS: 0, 문학: 0})
  const r = buildReadme(docs, '머리말')
  assert.ok(r.startsWith('머리말')); assert.match(r, /문서 2개/); assert.match(r, /상위 1/); assert.match(r, /깊이 1: 1/)
  assert.equal(buildReadme(docs, '머리말'), r)
})

test('문서 목록: 상황 태그로 묶고 하위 현상은 상위 아래에 들여 쓴다', () => {
  const docs = loadAll(makeRepo({
    a: makeDoc({title: '가', rel: {상위: ['- [나](b.md)']}, tags: '#행동 #돈'}),
    b: makeDoc({title: '나', rel: {하위: ['- [가](a.md)']}, tags: '#감정 #돈'}),
    c: makeDoc({title: '다', tags: '#감정 #관계'}),
    d: makeDoc({title: '라', tags: '#행동'}),
  }))
  const r = buildReadme(docs, '')
  assert.doesNotMatch(r, /최상위 현상/)
  assert.match(r, /## 문서 목록\n\n### #돈 \(2\)\n\n- \[나\]\(docs\/b\.md\)\n  - \[가\]\(docs\/a\.md\)\n\n### #관계 \(1\)\n\n- \[다\]\(docs\/c\.md\)\n\n### 상황 태그 없음 \(1\)\n\n- \[라\]\(docs\/d\.md\)\n/)
})
