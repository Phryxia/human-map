import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createQueue, persist, loadQueueFile, gitCommitQueue, startServer, QUEUE_VERSION} from './queue-server.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hm-queue-'))

test('createQueue: 우선순위 내림차순, 동률은 FIFO', () => {
  const q = createQueue()
  const a = q.push({title: 'a', priority: 1}), b = q.push({title: 'b', priority: 5}), c = q.push({title: 'c', priority: 5})
  assert.deepEqual(q.list().map(i => i.id), [b.id, c.id, a.id])
  assert.equal(q.peek().id, b.id); assert.equal(q.size(), 3)
  assert.equal(q.pop().id, b.id); assert.equal(q.pop().id, c.id); assert.equal(q.pop().id, a.id); assert.equal(q.pop(), null)
})

test('createQueue: 검증, remove, dirty, 라운드트립', () => {
  const q = createQueue()
  assert.equal(q.dirty, false)
  assert.throws(() => q.push({title: '  '}), /title/)
  assert.throws(() => q.push({title: 'x', priority: 1.5}), /priority/)
  const x = q.push({title: 'x', note: 'n'})
  assert.equal(q.dirty, true)
  assert.equal(q.remove('nope'), null); assert.equal(q.remove(x.id).id, x.id); assert.equal(q.get(x.id), null)
  q.push({title: 'y'})
  const json = q.toJSON()
  assert.equal(json.version, QUEUE_VERSION)
  const q2 = createQueue(json)
  assert.equal(q2.push({title: 'z'}).seq, json.nextSeq)
  assert.throws(() => createQueue({version: 99, items: []}), /version/)
})

test('persist: 원자적 저장과 재로드', () => {
  const dir = tmp(), file = path.join(dir, 'queue.json')
  const q = createQueue(); q.push({title: 't', priority: 2})
  persist(q, file)
  assert.equal(q.dirty, false)
  assert.ok(!fs.existsSync(file + '.tmp'))
  assert.equal(createQueue(loadQueueFile(file)).peek().title, 't')
  assert.equal(loadQueueFile(path.join(dir, 'none.json')), null)
})

test('gitCommitQueue: 변경 없으면 커밋하지 않는다', t => {
  if (spawnSync('git', ['--version']).status !== 0) return t.skip('git 없음')
  const dir = tmp(), file = path.join(dir, 'dev', 'queue.json')
  const git = (...a) => spawnSync('git', a, {cwd: dir, encoding: 'utf8'})
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  fs.writeFileSync(path.join(dir, 'README'), 'x'); git('add', '.'); git('commit', '-qm', 'init')
  const q = createQueue(); q.push({title: 'a'}); persist(q, file)
  const r1 = gitCommitQueue(dir, file)
  assert.equal(r1.committed, true); assert.match(r1.hash, /^[0-9a-f]{7,}$/)
  assert.equal(gitCommitQueue(dir, file).committed, false)
  assert.equal(git('log', '--oneline').stdout.trim().split('\n').length, 2)
  assert.equal(gitCommitQueue(tmp(), file).committed, false)
})

test('HTTP API', async () => {
  const dir = tmp(), queueFile = path.join(dir, 'queue.json'), portFile = path.join(dir, 'queue.port')
  let exited = null
  const s = await startServer({port: 0, queueFile, portFile, repoRoot: dir, commitOnStop: false, exit: c => { exited = c }, log: () => {}})
  const api = async (m, p, body) => { const r = await fetch(s.url + p, {method: m, headers: {'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined}); return {status: r.status, json: await r.json()} }
  try {
    assert.equal(JSON.parse(fs.readFileSync(portFile, 'utf8')).port, s.port)
    assert.equal((await api('GET', '/health')).json.ok, true)
    assert.equal((await api('GET', '/peek')).json.item, null)
    const a = (await api('POST', '/items', {title: 'a', priority: 1})).json.item
    const b = await api('POST', '/items', {title: 'b', priority: 3, note: 'n'})
    assert.equal(b.status, 201)
    assert.equal((await api('POST', '/items', {title: ''})).status, 400)
    assert.equal((await api('POST', '/items', {title: 'x', priority: 'abc'})).status, 400)
    assert.equal((await api('GET', '/items')).json.items.map(i => i.title).join(), 'b,a')
    assert.equal((await api('GET', `/items/${a.id}`)).json.item.title, 'a')
    assert.equal((await api('GET', '/items/zz')).status, 404)
    assert.equal((await api('POST', '/pop')).json.item.title, 'b')
    assert.equal((await api('DELETE', `/items/${a.id}`)).json.item.id, a.id)
    assert.equal((await api('DELETE', `/items/${a.id}`)).status, 404)
    assert.equal((await api('GET', '/nope')).status, 404)
    await api('POST', '/items', {title: 'c'})
    assert.equal((await api('POST', '/save')).json.saved, true)
    assert.equal(loadQueueFile(queueFile).items.length, 1)
    assert.equal((await api('GET', '/health')).json.dirty, false)
    const stop = await api('POST', '/stop', {commit: false})
    assert.equal(stop.json.stopped, true); assert.equal(stop.json.saved, true); assert.equal(stop.json.committed, false)
    await new Promise(r => setTimeout(r, 100))
    assert.equal(exited, 0)
    assert.ok(!fs.existsSync(portFile))
  } finally { s.server.close() }
})

test('createQueue: stops 카운터가 저장되고 다시 읽힌다', () => {
  const q = createQueue()
  assert.equal(q.stops(), 0)
  q.countStop(); q.countStop()
  assert.equal(createQueue(q.toJSON()).stops(), 2)
})

test('persist: 그사이 디스크에 들어온 다른 세션의 변경을 id 기준으로 합친다', () => {
  // 2026-10-17 04:3x: stops=16, 10 items 로 띄운 사이 원격이 stops=17, 25 items 를 커밋했다
  const dir = tmp(), file = path.join(dir, 'queue.json')
  const base = createQueue(); for (let i = 0; i < 10; i++) base.push({title: `b${i}`, priority: i})
  for (let i = 0; i < 16; i++) base.countStop()
  persist(base, file)
  const mine = createQueue(loadQueueFile(file)), other = createQueue(loadQueueFile(file))
  const popped = mine.pop(), added = mine.push({title: 'mine', priority: 50})
  const otherPopped = other.list()[3]; other.remove(otherPopped.id)
  for (let i = 0; i < 16; i++) other.push({title: `o${i}`})
  other.countStop(); persist(other, file)
  assert.equal(loadQueueFile(file).items.length, 25)
  mine.countStop(); persist(mine, file)
  const saved = loadQueueFile(file), ids = saved.items.map(i => i.id)
  assert.equal(saved.stops, 18)
  assert.equal(saved.items.length, 25)
  assert.ok(!ids.includes(popped.id) && !ids.includes(otherPopped.id))
  assert.ok(ids.includes(added.id))
  assert.equal(new Set(saved.items.map(i => i.seq)).size, 25)
  assert.equal(mine.size(), 25)
  mine.countStop(); persist(mine, file)
  assert.equal(loadQueueFile(file).stops, 19)
})

test('신호 종료는 저장만 하고 회차를 세지 않는다', async () => {
  // 2026-10-25 09:05: kill 로 서버를 끄자 stops 103→104 로 커밋됐다
  const dir = tmp(), queueFile = path.join(dir, 'queue.json'), portFile = path.join(dir, 'queue.port')
  fs.writeFileSync(queueFile, JSON.stringify({version: QUEUE_VERSION, nextSeq: 1, stops: 103, items: []}))
  const s = await startServer({port: 0, queueFile, portFile, repoRoot: dir, commitOnStop: false, exit: () => {}, log: () => {}})
  try {
    await fetch(s.url + '/items', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({title: 'k'})})
    s.stop('SIGTERM')
    const saved = loadQueueFile(queueFile)
    assert.equal(saved.stops, 103)
    assert.equal(saved.items.length, 1)
  } finally { s.server.close() }
})
