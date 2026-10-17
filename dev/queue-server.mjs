// 우선순위 큐 HTTP 서버. 메모리에 들고 있다가 stop 시에만 dev/queue.json 으로 persist 하고 git 커밋한다.
// persist 는 그사이 디스크에 들어온 다른 세션의 변경(git pull)을 마지막 저장 시점 기준으로 id 별로 합친다.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

export const DEFAULT_PORT = 7777
export const QUEUE_VERSION = 1
const devDir = path.dirname(fileURLToPath(import.meta.url))
export const defaultRepoRoot = () => path.resolve(devDir, '..')
export const defaultQueueFile = () => path.join(devDir, 'queue.json')
export const defaultPortFile = () => path.join(devDir, 'queue.port')

// ---------- 상태 머신 ----------

const byPriority = (a, b) => b.priority - a.priority || a.seq - b.seq

export function createQueue(initial) {
  if (initial && initial.version !== QUEUE_VERSION) throw new Error(`queue.json version ${initial.version} 은 지원하지 않는다 (기대: ${QUEUE_VERSION})`)
  let items = (initial?.items ?? []).map(i => ({...i}))
  let stops = initial?.stops ?? 0
  let nextSeq = initial?.nextSeq ?? (items.reduce((m, i) => Math.max(m, i.seq), 0) + 1)
  let baseIds = new Set(items.map(i => i.id)), baseStops = stops
  const q = {
    dirty: false,
    size: () => items.length,
    list: () => [...items].sort(byPriority),
    get: id => items.find(i => i.id === id) ?? null,
    peek: () => q.list()[0] ?? null,
    push({title, priority = 0, note = ''}) {
      title = String(title ?? '').trim()
      if (!title) throw Object.assign(new Error('title 이 비어 있다'), {status: 400})
      priority = Number(priority)
      if (!Number.isInteger(priority)) throw Object.assign(new Error('priority 는 정수여야 한다'), {status: 400})
      const item = {id: crypto.randomBytes(4).toString('hex'), title, priority, note: String(note ?? ''), createdAt: new Date().toISOString(), seq: nextSeq++}
      items.push(item); q.dirty = true
      return item
    },
    pop() {
      const top = q.peek()
      if (top) { items.splice(items.indexOf(top), 1); q.dirty = true }
      return top
    },
    remove(id) {
      const idx = items.findIndex(i => i.id === id)
      if (idx < 0) return null
      q.dirty = true
      return items.splice(idx, 1)[0]
    },
    stops: () => stops,
    countStop() { stops++; q.dirty = true },
    toJSON: () => ({version: QUEUE_VERSION, savedAt: new Date().toISOString(), nextSeq, stops, items: q.list()}),
    // disk: 지금 디스크의 queue.json. 기준 시점 이후 내가 꺼낸 항목은 빼고, 내가 넣은 항목과 stop 횟수는 더한다.
    mergeDisk(disk) {
      if (disk) {
        if (disk.version !== QUEUE_VERSION) throw new Error(`queue.json version ${disk.version} 은 지원하지 않는다 (기대: ${QUEUE_VERSION})`)
        const mine = new Set(items.map(i => i.id))
        const merged = disk.items.filter(i => !(baseIds.has(i.id) && !mine.has(i.id))).map(i => ({...i}))
        const have = new Set(merged.map(i => i.id))
        nextSeq = Math.max(nextSeq, disk.nextSeq ?? 0, merged.reduce((m, i) => Math.max(m, i.seq + 1), 0))
        for (const i of [...items].sort((a, b) => a.seq - b.seq)) if (!baseIds.has(i.id) && !have.has(i.id)) merged.push({...i, seq: nextSeq++})
        stops = (disk.stops ?? 0) + stops - baseStops
        items = merged
      }
      baseIds = new Set(items.map(i => i.id)); baseStops = stops
    },
  }
  return q
}

export function loadQueueFile(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function persist(queue, file) {
  queue.mergeDisk(loadQueueFile(file))
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file + '.tmp', JSON.stringify(queue.toJSON(), null, 2) + '\n')
  fs.renameSync(file + '.tmp', file)
  queue.dirty = false
}

export function gitCommitQueue(repoRoot, file) {
  const rel = path.relative(repoRoot, file)
  const git = (...args) => spawnSync('git', args, {cwd: repoRoot, encoding: 'utf8'})
  if (git('rev-parse', '--is-inside-work-tree').status !== 0) return {committed: false, reason: 'git 저장소가 아니다'}
  git('add', '--', rel)
  if (git('diff', '--cached', '--quiet', '--', rel).status === 0) return {committed: false, reason: '변경 없음'}
  const n = JSON.parse(fs.readFileSync(file, 'utf8')).items.length
  const r = git('commit', '-m', `queue: ${n} items (${new Date().toISOString().slice(0, 10)})`, '--', rel)
  if (r.status !== 0) return {committed: false, reason: (r.stderr || r.stdout).trim()}
  return {committed: true, hash: git('rev-parse', '--short', 'HEAD').stdout.trim()}
}

// ---------- HTTP ----------

const send = (res, status, body) => { res.writeHead(status, {'content-type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(body)) }

async function readBody(req) {
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 65536) throw Object.assign(new Error('요청이 너무 크다'), {status: 413}) }
  if (!raw.trim()) return {}
  try { return JSON.parse(raw) } catch { throw Object.assign(new Error('JSON 파싱 실패'), {status: 400}) }
}

export function startServer({
  port = DEFAULT_PORT, host = '127.0.0.1',
  queueFile = defaultQueueFile(), portFile = defaultPortFile(), repoRoot = defaultRepoRoot(),
  commitOnStop = true, exit = code => process.exit(code), log = console.log,
} = {}) {
  const queue = createQueue(loadQueueFile(queueFile))
  const startedAt = new Date().toISOString()
  let stopping = false

  const finish = (commit) => {
    const saved = true
    queue.countStop()
    persist(queue, queueFile)
    const c = commit && commitOnStop ? gitCommitQueue(repoRoot, queueFile) : {committed: false, reason: 'commit 생략'}
    try { fs.rmSync(portFile, {force: true}) } catch {}
    return {saved, ...c}
  }
  const stop = (reason, commit = true) => {
    if (stopping) return null
    stopping = true
    const r = finish(commit)
    log(`stop (${reason}): saved=${r.saved} committed=${r.committed}${r.hash ? ' ' + r.hash : ''}${r.reason ? ' ' + r.reason : ''}`)
    server.close(() => exit(0))
    setTimeout(() => exit(0), 500).unref()
    return r
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      const [, a, b] = url.pathname.split('/')
      const m = req.method
      if (m === 'GET' && a === 'health') return send(res, 200, {ok: true, size: queue.size(), dirty: queue.dirty, pid: process.pid, startedAt, port, round: queue.stops()})
      if (m === 'GET' && a === 'items' && !b) return send(res, 200, {items: queue.list()})
      if (m === 'GET' && a === 'items') { const it = queue.get(b); return it ? send(res, 200, {item: it}) : send(res, 404, {error: `항목 없음: ${b}`, code: 'NOT_FOUND'}) }
      if (m === 'POST' && a === 'items' && !b) return send(res, 201, {item: queue.push(await readBody(req))})
      if (m === 'DELETE' && a === 'items') { const it = queue.remove(b); return it ? send(res, 200, {item: it}) : send(res, 404, {error: `항목 없음: ${b}`, code: 'NOT_FOUND'}) }
      if (m === 'POST' && a === 'pop') return send(res, 200, {item: queue.pop()})
      if (m === 'GET' && a === 'peek') return send(res, 200, {item: queue.peek()})
      if (m === 'POST' && a === 'save') { persist(queue, queueFile); return send(res, 200, {saved: true, path: queueFile}) }
      if (m === 'POST' && a === 'stop') {
        const body = await readBody(req)
        if (stopping) return send(res, 409, {error: '이미 종료 중', code: 'STOPPING'})
        stopping = true
        const r = finish(body.commit !== false)
        res.writeHead(200, {'content-type': 'application/json; charset=utf-8'})
        res.end(JSON.stringify({stopped: true, ...r}), () => { log(`stop (http): committed=${r.committed}`); server.close(() => exit(0)); setTimeout(() => exit(0), 500).unref() })
        return
      }
      send(res, 404, {error: `알 수 없는 경로: ${m} ${url.pathname}`, code: 'NOT_FOUND'})
    } catch (e) {
      send(res, e.status ?? 500, {error: e.message, code: e.status === 400 ? 'BAD_REQUEST' : e.status === 413 ? 'TOO_LARGE' : 'INTERNAL'})
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const actual = server.address().port
      fs.writeFileSync(portFile, JSON.stringify({port: actual, pid: process.pid, startedAt}) + '\n')
      const onSignal = sig => stop(sig)
      process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
      log(`queue server http://${host}:${actual} (${queue.size()} items, file=${path.relative(repoRoot, queueFile)})`)
      resolve({server, queue, url: `http://${host}:${actual}`, port: actual, stop})
    })
  })
}

// ---------- 직접 실행 ----------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({options: {port: {type: 'string'}, 'no-commit': {type: 'boolean', default: false}}})
  const port = Number(values.port ?? process.env.HUMANMAP_QUEUE_PORT ?? DEFAULT_PORT)
  startServer({port, commitOnStop: !values['no-commit']}).catch(async e => {
    if (e.code === 'EADDRINUSE') {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json())
        if (r.ok) { console.log(`이미 실행 중 (pid ${r.pid}, ${r.size} items)`); process.exit(0) }
      } catch {}
      console.error(`포트 ${port} 를 다른 프로세스가 쓰고 있다`); process.exit(1)
    }
    console.error(e.message); process.exit(1)
  })
}
