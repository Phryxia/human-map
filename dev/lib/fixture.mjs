// 테스트용 임시 문서 저장소.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const frag = (n, kind, date, url, extra = '') => `[^${n}]: [${kind}] "인용 ${n}" — 서지 ${n}, ${date}, ${url}, 2026-10-15 접속${extra}`
export function makeDoc({title = '제목', summary = '사람이 어떤 상황에서 무언가를 한다.', body = '문단.[^1][^2]', cond = '기록된 조건 없음.[^1]', frags, rel = {}, tags = '#행동'} = {}) {
  frags ??= [frag(1, '학술', '2001', 'https://a.example/1'), frag(2, '매체', '2011', 'https://b.example/2')]
  const r = k => rel[k] ? rel[k].join('\n') : '없음.'
  return `# ${title}\n\n별칭: 없음\n\n${summary}\n\n# 서술\n\n${body}\n\n# 조건\n\n${cond}\n\n# 관계\n\n## 상위\n\n${r('상위')}\n\n## 하위\n\n${r('하위')}\n\n## 원인\n\n${r('원인')}\n\n## 결과\n\n${r('결과')}\n\n## 대립\n\n${r('대립')}\n\n${tags}\n\n${frags.join('\n')}\n`
}
export function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-docs-'))
  for (const [id, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, id + '.md'), text)
  return dir
}
