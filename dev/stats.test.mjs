import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadAll} from './lib/doc.mjs'
import {buildReadme, buildOutputs, kindCounts} from './stats.mjs'
import {checkGroups} from './lib/groups.mjs'
import {makeDoc, makeRepo} from './lib/fixture.mjs'

test('README 는 머리말과 문서 묶음만 담는다', () => {
  const docs = loadAll(makeRepo({
    a: makeDoc({rel: {상위: ['- [비](b.md)']}}),
    b: makeDoc({title: '비', rel: {하위: ['- [제목](a.md)']}}),
  }))
  assert.deepEqual(kindCounts(docs), {학술: 2, 공공: 0, 매체: 2, SNS: 0, 문학: 0})
  const r = buildReadme(docs, '머리말')
  assert.ok(r.startsWith('머리말\n\n# 문서 묶음\n')); assert.doesNotMatch(r, /집계|파편 종류|깊이/)
  assert.equal(buildReadme(docs, '머리말'), r)
})

test('문서 묶음: README 는 묶음 링크만, 묶음 문서는 상위 아래에 하위를 들여 쓰고 INDEX 는 제목 순 전체 목록이다', () => {
  const docs = loadAll(makeRepo({
    a: makeDoc({title: '가', rel: {상위: ['- [나](b.md)']}, tags: '#행동 #돈'}),
    b: makeDoc({title: '나', rel: {하위: ['- [가](a.md)']}, tags: '#감정 #돈'}),
    c: makeDoc({title: '다', tags: '#감정 #관계'}),
  }))
  const groups = [{id: 'money', title: '돈', summary: '돈 이야기다.', roots: ['b']}, {id: 'rel', title: '관계', summary: '관계 이야기다.', roots: ['c']}]
  const out = buildOutputs(docs, '', groups)
  const r = out.get('README.md')
  assert.match(r, /# 문서 묶음\n\n.*\n\n- \[돈\]\(groups\/money\.md\) \(2\) 돈 이야기다\.\n- \[관계\]\(groups\/rel\.md\) \(1\) 관계 이야기다\.\n/)
  assert.doesNotMatch(r, /docs\/a\.md/)
  assert.match(out.get('groups/money.md'), /^# 돈\n\n돈 이야기다\.\n\n문서 2개\..*\n\n- \[나\]\(\.\.\/docs\/b\.md\) 사람이 어떤 상황에서 무언가를 한다\.\n  - \[가\]\(\.\.\/docs\/a\.md\)\n$/)
  assert.match(out.get('INDEX.md'), /- \[가\]\(docs\/a\.md\) \(\[돈\]\(groups\/money\.md\)\)\n- \[나\]\(docs\/b\.md\) .*\n- \[다\]\(docs\/c\.md\) \(\[관계\]\(groups\/rel\.md\)\)\n$/)
})

test('묶음 검사: 최상위 현상은 묶음 하나에만 들고 하위 현상은 직접 넣지 않는다', () => {
  const docs = loadAll(makeRepo({
    a: makeDoc({title: '가', rel: {상위: ['- [나](b.md)']}}),
    b: makeDoc({title: '나', rel: {하위: ['- [가](a.md)']}}),
    c: makeDoc({title: '다'}),
    d: makeDoc({title: '라'}),
  }))
  const g = roots => [{id: 'x', title: '엑스', summary: '요약이다.', roots}, {id: 'y', title: '와이', summary: '요약이다.', roots: ['c']}]
  assert.deepEqual(checkGroups(docs, g(['b', 'd'])), [])
  const msgs = checkGroups(docs, g(['a', 'b', 'c', 'zz'])).map(r => `${r.id} ${r.msg}`)
  assert.ok(msgs.some(m => m.startsWith('a 상위가 있는 문서는')))
  assert.ok(msgs.some(m => m.startsWith('c 두 묶음에')))
  assert.ok(msgs.some(m => m.includes('문서가 없다: zz')))
  assert.ok(msgs.some(m => m.startsWith('d 최상위 현상이 어느 묶음')))
})
