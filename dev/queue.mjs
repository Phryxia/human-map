#!/usr/bin/env node
// 우선순위 큐 CLI. 서버가 떠 있지 않으면 자동으로 띄운다.
// 사용법: node dev/queue.mjs <command> [args] [--json] [--port N] [--no-spawn]
import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {DEFAULT_PORT, defaultPortFile} from './queue-server.mjs'

const devDir = path.dirname(fileURLToPath(import.meta.url))
const HELP = `사용법: node dev/queue.mjs <command> [args] [--json] [--port N] [--no-spawn]

  push "<title>" [--priority N] [--note "..."]   항목 추가 (큰 수가 먼저 나온다, 기본 0)
  pop                                            최고 우선순위 항목을 꺼내 제거
  peek                                           최고 우선순위 항목 보기
  list | ls                                      전체 목록
  show <id>                                      항목 상세
  remove <id> | rm <id>                          항목 제거
  save                                           dev/queue.json 에 저장만 (커밋 없음)
  stop [--no-commit]                             저장 + git 커밋 + 서버 종료
  status                                         서버 상태와 경과 시간
  start                                          서버 기동만

서버가 없으면 push/pop/peek/list/show/remove/save 는 자동으로 서버를 띄운다. stop/status 는 띄우지 않는다.`

const {values: opts, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    json: {type: 'boolean', default: false}, port: {type: 'string'}, 'no-spawn': {type: 'boolean', default: false},
    priority: {type: 'string', short: 'p', default: '0'}, note: {type: 'string', short: 'n', default: ''},
    'no-commit': {type: 'boolean', default: false}, limit: {type: 'string'},
  },
})
const [cmd, ...args] = positionals
if (!cmd || cmd === 'help') { console.log(HELP); process.exit(0) }

const readPortFile = () => { try { return JSON.parse(fs.readFileSync(defaultPortFile(), 'utf8')) } catch { return null } }
const port = Number(opts.port ?? process.env.HUMANMAP_QUEUE_PORT ?? readPortFile()?.port ?? DEFAULT_PORT)
const base = `http://127.0.0.1:${port}`

async function request(method, p, body) {
  const res = await fetch(base + p, {method, headers: {'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000)})
  return {status: res.status, json: await res.json()}
}
const isRunning = async () => { try { return (await request('GET', '/health')).json.ok === true } catch { return false } }

async function ensureServer() {
  if (await isRunning()) return false
  if (opts['no-spawn']) { console.error(`서버가 없다 (${base}). node dev/queue.mjs start 로 띄워라`); process.exit(3) }
  const log = fs.openSync(path.join(devDir, 'queue-server.log'), 'a')
  const child = spawn(process.execPath, [path.join(devDir, 'queue-server.mjs'), '--port', String(port)], {detached: true, stdio: ['ignore', log, log]})
  child.unref()
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 100)); if (await isRunning()) return true }
  console.error('서버 기동 실패. dev/queue-server.log 를 확인하라'); process.exit(3)
}

const fmt = it => it ? `${it.id}  [p${it.priority}]  ${it.title}${it.note ? `\n    note: ${it.note}` : ''}` : '(empty)'
const out = (json, text) => console.log(opts.json ? JSON.stringify(json, null, 2) : text)
const fail = (r) => { out(r.json, `오류: ${r.json.error}`); process.exit(r.status === 404 ? 1 : 2) }

switch (cmd) {
  case 'start': {
    const spawned = await ensureServer()
    out({running: true, spawned, port}, spawned ? `started on :${port}` : `already running on :${port}`)
    break
  }
  case 'status': {
    if (!(await isRunning())) {
      let stops = 0
      try { stops = JSON.parse(fs.readFileSync(path.join(devDir, 'queue.json'), 'utf8')).stops ?? 0 } catch {}
      out({running: false, port, round: stops}, `not running (:${port}) round=${stops} (${stops % 2 ? '현상 우선' : '파편 우선'})`); process.exit(3)
    }
    const {json} = await request('GET', '/health')
    const elapsed = Math.round((Date.now() - Date.parse(json.startedAt)) / 60000)
    out({running: true, ...json, elapsedMinutes: elapsed}, `running pid=${json.pid} port=${json.port} size=${json.size} dirty=${json.dirty} elapsed=${elapsed}min round=${json.round} (${json.round % 2 ? '현상 우선' : '파편 우선'})`)
    break
  }
  case 'stop': {
    if (!(await isRunning())) { out({running: false}, 'not running'); break }
    const r = await request('POST', '/stop', {commit: !opts['no-commit']})
    if (r.status !== 200) fail(r)
    out(r.json, `stopped. saved=${r.json.saved} committed=${r.json.committed}${r.json.hash ? ' ' + r.json.hash : ''}${r.json.reason ? ` (${r.json.reason})` : ''}`)
    break
  }
  case 'push': {
    if (!args.length) { console.error('title 이 필요하다'); process.exit(2) }
    await ensureServer()
    const r = await request('POST', '/items', {title: args.join(' '), priority: Number(opts.priority), note: opts.note})
    if (r.status !== 201) fail(r)
    out(r.json, `pushed ${fmt(r.json.item)}`)
    break
  }
  case 'pop': case 'peek': {
    await ensureServer()
    const r = cmd === 'pop' ? await request('POST', '/pop') : await request('GET', '/peek')
    out(r.json, fmt(r.json.item))
    if (!r.json.item) process.exit(1)
    break
  }
  case 'list': case 'ls': {
    await ensureServer()
    let {items} = (await request('GET', '/items')).json
    if (opts.limit) items = items.slice(0, Number(opts.limit))
    out({items}, items.length ? items.map(fmt).join('\n') + `\n${items.length} items` : '(empty)')
    break
  }
  case 'show': {
    if (!args[0]) { console.error('id 가 필요하다'); process.exit(2) }
    await ensureServer()
    const r = await request('GET', `/items/${args[0]}`)
    if (r.status !== 200) fail(r)
    out(r.json, JSON.stringify(r.json.item, null, 2))
    break
  }
  case 'remove': case 'rm': {
    if (!args[0]) { console.error('id 가 필요하다'); process.exit(2) }
    await ensureServer()
    const r = await request('DELETE', `/items/${args[0]}`)
    if (r.status !== 200) fail(r)
    out(r.json, `removed ${fmt(r.json.item)}`)
    break
  }
  case 'save': {
    await ensureServer()
    const r = await request('POST', '/save')
    out(r.json, `saved ${path.relative(process.cwd(), r.json.path)}`)
    break
  }
  default: console.error(`알 수 없는 명령: ${cmd}\n\n${HELP}`); process.exit(2)
}
