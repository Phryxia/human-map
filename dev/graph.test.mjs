import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadAll, parseFragment} from './lib/doc.mjs'
import {validateAll, validateDoc, accountOf} from './lib/validate.mjs'
import {findCycles, wouldCycle, edgeMap} from './lib/graph-lib.mjs'
import {makeDoc, makeRepo, frag} from './lib/fixture.mjs'

const errs = docs => validateAll(docs).filter(r => r.level === 'ERROR').map(r => r.msg)
const warns = docs => validateAll(docs).filter(r => r.level === 'WARN').map(r => r.msg)

test('정상 문서는 통과한다', () => {
  const docs = loadAll(makeRepo({a: makeDoc()}))
  assert.deepEqual(errs(docs), [])
})

test('파편 줄 파싱: 번역과 미확인과 소멸', () => {
  const f = parseFragment('[^1]: [학술] "x" (번역) — 서지, 2011-03, https://e.com/a, 2026-10-15 접속 (미확인)')
  assert.equal(f.translation, '번역'); assert.ok(f.unverified)
  const g = parseFragment('[^1]: [매체] "x" — 서지, 발행일 미상, https://e.com/a, 2026-10-15 접속 (소멸, 2026-08-01 까지 확인)')
  assert.equal(g.vanished, '2026-08-01'); assert.equal(parseFragment('- F1 엉터리'), null)
})

test('근거 없는 문단, 참조되지 않은 파편, 없는 파편 참조', () => {
  const m = errs(loadAll(makeRepo({a: makeDoc({body: '근거 없음.\n\n문단.[^5]\n\n문단.[^1]'})})))
  assert.ok(!m.some(x => x.includes('근거 파편이 없다')))
  assert.ok(m.some(x => x.includes('[^5]')))
  assert.ok(m.some(x => x.includes('참조되지 않은 파편 [^2]')))
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

test('계정 경로가 URL 에 없는 SNS 글이 두 문서에 쓰이면 같은 계정으로 잰다(WARN)', () => {
  const u = 'https://www.clien.net/service/board/image/260260'
  const mk = () => [frag(1, '학술', '2001', 'https://a.example/1'), frag(2, 'SNS', '2002', u).replace('서지 2', '클리앙 게시글')]
  const m = warns(loadAll(makeRepo({a: makeDoc({frags: mk()}), b: makeDoc({frags: mk()})})))
  assert.ok(m.some(x => x.includes('같은 계정 경로') && x.includes('a:[^2]') && x.includes('b:[^2]')))
})

test('블로그 플랫폼 계정은 종류와 상관없이 같은 계정 경로로 재고 중복은 오류다', () => {
  assert.equal(accountOf('https://brunch.co.kr/@@82Me/112'), 'brunch/@82me')
  assert.equal(accountOf('https://brunch.co.kr/@bidancheon/166'), 'brunch/bidancheon')
  assert.equal(accountOf('https://foo-bar.tistory.com/12'), 'tistory/foo-bar')
  assert.equal(accountOf('https://m.blog.naver.com/someid/2233'), 'naver/someid')
  assert.equal(accountOf('https://medium.com/@writer/post-1'), 'medium/writer')
  const mk = n => [frag(1, '학술', '2001', 'https://a.example/1'), frag(2, '매체', '2002', `https://brunch.co.kr/@@82Me/${n}`)]
  const m = errs(loadAll(makeRepo({a: makeDoc({frags: mk(1)}), b: makeDoc({frags: mk(2)})})))
  assert.ok(m.some(x => x.includes('같은 계정 경로(brunch/@82me)')))
})

test('관심사 태그 밖의 태그는 오류, 태그 목록은 서로 다른 8개, 줄 수 제한은 없다', () => {
  const T = ['돈', '일', '시간', '건강', '관계', '공공', '온라인', '마음']
  assert.ok(validateAll(loadAll(makeRepo({a: makeDoc({tags: '#돈'})})), {}, T.slice(0, 7)).some(r => r.msg.includes('8개여야 한다 (7개)')))
  assert.ok(validateAll(loadAll(makeRepo({a: makeDoc({tags: '#돈'})})), {}, [...T.slice(0, 7), '돈']).some(r => r.msg.includes('8개여야 한다')))
  assert.deepEqual(validateAll(loadAll(makeRepo({a: makeDoc({tags: '#돈'})})), {}, T).map(r => r.msg), [])
  assert.ok(errs(loadAll(makeRepo({a: makeDoc({tags: '#집단'})}))).some(x => x.includes('관심사 태그가 아니다: #집단')))
  assert.deepEqual(errs(loadAll(makeRepo({a: makeDoc({tags: '#돈 #마음'})}))), [])
  assert.deepEqual(errs(loadAll(makeRepo({a: makeDoc({body: '문단.[^1][^2]' + '\n'.repeat(80)})}))), [])
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
  const q = (n, quote, url) => `[^${n}]: [SNS] "${quote}" — 네이버 지식iN 게시글, 2026-06-28, ${url}, 2026-10-17 접속`
  const frags = [frag(1, '학술', '2001', 'https://a.example/1'), q(2, '힘들어요… 미루고미루다가 마음 먹고 봐야지', 'https://b.example/v'), q(3, '신세만저서……', 'https://b.example/n')]
  const docs = loadAll(makeRepo({a: makeDoc({body: '문단.[^1][^2][^3]', frags})}))
  const warns = s => validateAll(docs, s).filter(r => r.msg.includes('줄임표')).map(r => r.ln)
  assert.equal(warns({}).length, 2)
  const sources = {'https://b.example/v': {result: 'VERIFIED', lastVerified: '2026-10-17'}, 'https://b.example/n': {result: 'NOT_FOUND'}}
  assert.deepEqual(warns(sources), [warns({})[1]])
})

test('문단 수 제한은 없고, 문단당 4문장을 넘으면 ERROR', () => {
  const nine = Array.from({length: 9}, (_, i) => i < 8 ? `문단 ${i}.` : `문단 ${i}.[^1][^2]`).join('\n\n')
  assert.deepEqual(errs(loadAll(makeRepo({a: makeDoc({body: nine})}))), [])
  const long = '하나다. 둘이다. 15.6%였다. 넷이다. 다섯이다.[^1][^2]'
  assert.ok(errs(loadAll(makeRepo({a: makeDoc({body: long})}))).some(x => x.includes('문단이 4문장을 넘는다 (5)')))
  const ok = '하나다. 둘은 15.6%였다. 셋이다. 넷이다.[^1]\n\n문단.[^2]'
  assert.deepEqual(validateAll(loadAll(makeRepo({a: makeDoc({body: ok})}))).map(r => r.msg), [])
})

test('관계 줄의 붙여 쓴 근거 파편[^1][^2] 도 간선으로 읽고, 형식이 틀린 관계 줄은 오류', () => {
  const a = makeDoc({rel: {원인: ['- [B](b.md)[^1][^2]']}})
  const b = makeDoc({title: 'B', rel: {결과: ['- [A](a.md)[^1]']}})
  const docs = loadAll(makeRepo({a, b}))
  assert.deepEqual(docs.get('a').rel['원인'][0].frags, [1, 2])
  assert.deepEqual(errs(docs), [])
  const bad = makeDoc({rel: {원인: ['- [B](b.md) F1']}})
  const m = errs(loadAll(makeRepo({a: bad, b})))
  assert.ok(m.some(x => x.includes('관계 줄 형식')))
})

test('본문이 파편을 F<n> 번호로 부르면 ERROR, 따옴표 안과 각주는 통과', () => {
  const bad = (p) => errs(loadAll(makeRepo({a: makeDoc({body: `${p}\n\n문단.[^2]`})})))
  assert.ok(bad('2001년 F1 은 조건을 다룬다.[^1]').some(x => x.includes('번호(F1)')))
  assert.ok(bad('[F1] 조건을 다룬다.[^1]').some(x => x.includes('번호(F1)')))
  assert.deepEqual(bad('2001년 연구[^1]는 조건을 다룬다.'), [])
  assert.deepEqual(bad('글쓴이는 "F1 레이스" 를 봤다.[^1]'), [])
})

test('각주 정의는 태그 줄 뒤에만 있고, 태그 줄 뒤에는 각주 정의만 둔다', () => {
  const ok = makeDoc()
  const moved = ok.replace(/\n(\[\^2\]: [^\n]*)\n$/, '\n').replace('# 관계', '$1\n\n# 관계'.replace('$1', ok.match(/\[\^2\]: [^\n]*/)[0]))
  assert.ok(errs(loadAll(makeRepo({a: moved}))).some(x => x.includes('태그 줄 뒤에만')))
  assert.ok(errs(loadAll(makeRepo({a: ok + '덧붙인 말\n'}))).some(x => x.includes('각주 정의만')))
})

test('각주 없는 문장 뒤 문장 끝에 출처 둘 이상을 묶으면 ERROR', () => {
  // 이슈 #7: overestimating-peer-drinking 의 두 문장이 [^4][^5] 하나로 묶였다
  const bad = '2009년 조사에서 응답자 다수는 친구가 더 마신다고 했다. 2010년 조사에서 폭음집단은 과대추정했다.[^1][^2]'
  assert.ok(errs(loadAll(makeRepo({a: makeDoc({body: bad})}))).some(x => x.includes('출처가 다른 문장')))
  const ok = ['2009년 조사[^1]에서 다수는 그렇게 했다. 2010년 조사에서는 달랐다.[^2]', '한 출처의 첫 문장이다. 같은 출처의 둘째 문장이다.[^1]\n\n두 출처가 같은 말을 한다.[^1][^2]']
  for (const body of ok) assert.ok(![...errs(loadAll(makeRepo({a: makeDoc({body})}))), ...warns(loadAll(makeRepo({a: makeDoc({body})})))].some(x => x.includes('출처가 다른 문장')), body)
})

test('물결은 \\~ 로 쓴다. 파편 원문의 \\~ 는 ~ 로 읽고 URL 안의 ~ 는 통과', () => {
  const ok = makeDoc({body: '16\\~24세가 그랬다.[^1][^2]', frags: [frag(1, '학술', '2001', 'https://a.example/~x/1').replace('인용 1', '16\\~24세'), frag(2, '매체', '2011', 'https://b.example/2')]})
  const docs = loadAll(makeRepo({a: ok}))
  assert.deepEqual(errs(docs), [])
  assert.equal(docs.get('a').fragments[0].quote, '16~24세')
  const bad = errs(loadAll(makeRepo({a: makeDoc({body: '16~24세가 그랬다.[^1][^2]', frags: [frag(1, '학술', '2001', 'https://a.example/1').replace('인용 1', '1~2'), frag(2, '매체', '2011', 'https://b.example/2')]})})))
  assert.equal(bad.filter(m => m.includes('물결')).length, 2)
})

test('별칭마다 원문이나 서지에 그 이름이 든 파편을 각주로 단다', () => {
  const fr = [frag(1, '학술', '2001', 'https://a.example/1').replace('인용 1', 'the Better-than-average effect'), frag(2, '매체', '2011', 'https://b.example/2').replace('서지 2', '우월 착각에 관한 기사')]
  const mk = aliases => makeDoc({frags: fr}).replace('별칭: 없음', `별칭: ${aliases}`)
  assert.deepEqual(errs(loadAll(makeRepo({a: mk('better than average effect[^1], 우월 착각[^2]')}))), [])
  const m = errs(loadAll(makeRepo({a: mk('워비곤 호수 효과, 우월 착각[^1], 엉뚱[^7]')})))
  assert.ok(m.some(x => x.includes('사용례 각주가 없다: 워비곤 호수 효과')))
  assert.ok(m.some(x => x.includes('원문과 서지에 별칭이 없다: 우월 착각')))
  assert.ok(m.some(x => x.includes('[^7]')))
  const only = makeDoc({body: '문단.[^1]', frags: fr}).replace('별칭: 없음', '별칭: 우월 착각[^2]')
  assert.ok(!errs(loadAll(makeRepo({a: only}))).some(x => x.includes('참조되지 않은')))
})

test('한 문서 안의 같은 URL 파편 둘은 오류다', () => {
  const frags = [frag(1, '학술', '2001', 'https://a.example/1'), frag(2, '매체', '2011', 'https://b.example/2'), frag(3, '매체', '2012', 'https://b.example/2')]
  const m = errs(loadAll(makeRepo({a: makeDoc({body: '문단.[^1][^2][^3]', frags})})))
  assert.ok(m.some(x => x.includes('한 출처에서 한 파편만') && x.includes('[^2]')))
  assert.deepEqual(errs(loadAll(makeRepo({a: makeDoc()}))), [])
})

test('서술 문단이 첫 파편의 발행일 순이 아니면 ERROR (이슈 #14)', () => {
  const fr = [frag(1, '학술', '2001', 'https://a.example/1'), frag(2, '매체', '2010', 'https://b.example/2'), frag(3, '공공', '2020', 'https://c.example/3')]
  const back = makeDoc({body: '앞.[^1]\n\n뒤.[^2] 더 뒤.[^3]\n\n되짚음.[^1]', frags: fr})
  assert.ok(errs(loadAll(makeRepo({a: back}))).some(x => x.includes('서술 문단이 발행일 순이 아니다')))
  const ok = makeDoc({body: '근거 없는 앞 문장. 앞.[^1]\n\n뒤.[^2] 앞 시기와 견줌.[^1]\n\n더 뒤.[^3]', frags: fr})
  assert.deepEqual(errs(loadAll(makeRepo({a: ok}))), [])
  assert.deepEqual(warns(loadAll(makeRepo({a: ok}))), [])
})

test('앞 문단에서 쓴 각주만 다시 가리키는 서술 문단은 ERROR', () => {
  const fr = [frag(1, '학술', '2001', 'https://a.example/1'), frag(2, '매체', '2010', 'https://b.example/2'), frag(3, '공공', '2020', 'https://c.example/3')]
  // harsh-words-for-worry 2026-10-27: [^2] 문단 뒤에 [^2] 만 다시 푸는 문단
  const again = makeDoc({body: '앞.[^1]\n\n뒤.[^2]\n\n2019년 글[^2]은 부모가 자녀에게 하는 말이다.\n\n더 뒤.[^3]', frags: fr})
  assert.ok(errs(loadAll(makeRepo({a: again}))).some(x => x.includes('앞 문단에서 쓴 각주만')))
  const ok = makeDoc({body: '앞.[^1]\n\n뒤.[^2] 앞 시기와 견줌.[^1]\n\n더 뒤.[^3]', frags: fr})
  assert.deepEqual(errs(loadAll(makeRepo({a: ok}))), [])
  assert.deepEqual(warns(loadAll(makeRepo({a: ok}))), [])
})
