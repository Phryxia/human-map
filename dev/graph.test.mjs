import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadAll, parseFragment} from './lib/doc.mjs'
import {validateAll, validateDoc, accountOf} from './lib/validate.mjs'
import {findCycles, wouldCycle, edgeMap} from './lib/graph-lib.mjs'
import {makeDoc, makeRepo, frag} from './lib/fixture.mjs'

const errs = docs => validateAll(docs).filter(r => r.level === 'ERROR').map(r => r.msg)

test('정상 문서는 통과한다', () => {
  const docs = loadAll(makeRepo({a: makeDoc()}))
  assert.deepEqual(errs(docs), [])
})

test('파편 줄 파싱: 번역과 미확인과 소멸', () => {
  const f = parseFragment('- F1 [학술] "x" (번역) — 서지, 2011-03, https://e.com/a, 2026-10-15 접속 (미확인)')
  assert.equal(f.translation, '번역'); assert.ok(f.unverified)
  const g = parseFragment('- F1 [매체] "x" — 서지, 발행일 미상, https://e.com/a, 2026-10-15 접속 (소멸, 2026-08-01 까지 확인)')
  assert.equal(g.vanished, '2026-08-01'); assert.equal(parseFragment('- F1 엉터리'), null)
})

test('근거 없는 문단, 참조되지 않은 파편, 없는 파편 참조', () => {
  const m = errs(loadAll(makeRepo({a: makeDoc({body: '근거 없음.\n\n문단. [F5]', cond: '조건. [F1]'})})))
  assert.ok(m.some(x => x.includes('근거 파편이 없다')))
  assert.ok(m.some(x => x.includes('F5')))
  assert.ok(m.some(x => x.includes('참조되지 않은 파편 F2')))
})

test('확인됨 2개 이상, 종류 2가지 이상', () => {
  const one = [frag(1, '학술', '2001', 'https://a.example/1'), frag(2, '학술', '2002', 'https://a.example/2')]
  assert.ok(errs(loadAll(makeRepo({a: makeDoc({frags: one})}))).some(x => x.includes('종류가 2가지 미만')))
  const unv = [frag(1, '학술', '2001', 'https://a.example/1'), frag(2, '매체', '2002', 'https://a.example/2', ' (미확인)')]
  assert.ok(errs(loadAll(makeRepo({a: makeDoc({frags: unv})}))).some(x => x.includes('2개 미만')))
})

test('발행일 순서와 SNS 서지', () => {
  const bad = [frag(1, '학술', '2011', 'https://a.example/1'), frag(2, 'SNS', '2001', 'https://b.example/2').replace('서지 2', '@someone 게시글')]
  const m = errs(loadAll(makeRepo({a: makeDoc({frags: bad})})))
  assert.ok(m.some(x => x.includes('발행일 순')))
  assert.ok(m.some(x => x.includes('SNS 서지')))
})

test('ASYMMETRIC 과 원인 간선의 근거 파편', () => {
  const a = makeDoc({rel: {원인: ['- [비](b.md)']}})
  const b = makeDoc({title: '비'})
  const m = errs(loadAll(makeRepo({a, b})))
  assert.ok(m.some(x => x.startsWith('ASYMMETRIC')))
  assert.ok(m.some(x => x.includes('근거 파편이 없다') && x.includes('원인')))
})

test('링크 대상 파일이 없으면 오류', () => {
  assert.ok(errs(loadAll(makeRepo({a: makeDoc({rel: {상위: ['- [없](zzz.md)']}})}))).some(x => x.includes('zzz.md')))
})

test('같은 SNS 계정 경로가 둘이면 오류', () => {
  assert.equal(accountOf('https://www.reddit.com/user/Foo/comments/1'), 'foo')
  const mk = n => [frag(1, '학술', '2001', 'https://a.example/1'), frag(2, 'SNS', '2002', `https://www.reddit.com/user/Foo/comments/${n}`).replace('서지 2', 'Reddit 댓글')]
  const m = errs(loadAll(makeRepo({a: makeDoc({frags: mk(1)}), b: makeDoc({frags: mk(2)})})))
  assert.ok(m.some(x => x.includes('같은 계정 경로')))
})

test('축 태그가 없으면 오류, 80줄 초과 오류', () => {
  assert.ok(errs(loadAll(makeRepo({a: makeDoc({tags: '#집단'})}))).some(x => x.includes('축 태그')))
  assert.ok(errs(loadAll(makeRepo({a: makeDoc({body: '문단. [F1][F2]\n'.repeat(1).trim() + '\n'.repeat(80)})}))).some(x => x.includes('80줄')))
})

test('순환 탐지와 check-cycle', () => {
  const adj = new Map([['a', ['b']], ['b', ['c']], ['c', ['a']], ['d', []]])
  assert.equal(findCycles(adj).length, 1)
  const dag = new Map([['a', ['b']], ['b', []], ['c', []]])
  assert.equal(findCycles(dag).length, 0)
  assert.ok(wouldCycle(dag, 'b', 'a'))
  assert.equal(wouldCycle(dag, 'a', 'c'), null)
  const docs = loadAll(makeRepo({a: makeDoc({rel: {상위: ['- [비](b.md)']}}), b: makeDoc({title: '비', rel: {하위: ['- [제목](a.md)']}})}))
  assert.deepEqual(edgeMap(docs, '상위').get('a'), ['b'])
})

test('줄임표 WARN 은 출처에서 원문 그대로 확인된 파편에는 뜨지 않는다', () => {
  const q = (n, quote, url) => `- F${n} [SNS] "${quote}" — 네이버 지식iN 게시글, 2026-06-28, ${url}, 2026-10-17 접속`
  const frags = [frag(1, '학술', '2001', 'https://a.example/1'), q(2, '힘들어요… 미루고미루다가 마음 먹고 봐야지', 'https://b.example/v'), q(3, '신세만저서……', 'https://b.example/n')]
  const docs = loadAll(makeRepo({a: makeDoc({body: '문단. [F1][F2][F3]', frags})}))
  const warns = s => validateAll(docs, s).filter(r => r.msg.includes('줄임표')).map(r => r.ln)
  assert.equal(warns({}).length, 2)
  const sources = {'https://b.example/v': {result: 'VERIFIED', lastVerified: '2026-10-17'}, 'https://b.example/n': {result: 'NOT_FOUND'}}
  assert.deepEqual(warns(sources), [warns({})[1]])
})

test('서술 문단 수 1~4, 문단당 4문장 이내는 WARN', () => {
  const warns = docs => validateAll(docs).filter(r => r.level === 'WARN').map(r => r.msg)
  const five = Array.from({length: 5}, (_, i) => `문단 ${i}. [F1][F2]`).join('\n\n')
  assert.ok(warns(loadAll(makeRepo({a: makeDoc({body: five})}))).some(x => x.includes('서술 문단이 4개를 넘는다 (5)')))
  const long = '하나다. 둘이다. 15.6%였다. 넷이다. 다섯이다. [F1][F2]'
  assert.ok(warns(loadAll(makeRepo({a: makeDoc({body: long})}))).some(x => x.includes('문단이 4문장을 넘는다 (5)')))
  const ok = '하나다. 둘은 15.6%였다. 셋이다. 넷이다. [F1][F2]\n\n문단. [F1]\n\n문단. [F2]\n\n문단. [F1]'
  assert.deepEqual(warns(loadAll(makeRepo({a: makeDoc({body: ok})}))), [])
})
