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
