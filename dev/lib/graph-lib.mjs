// 간선 그래프 계산. 상위 그래프는 DAG, 원인 그래프의 순환은 되먹임이다.
export function edgeMap(docs, rel) {
  const m = new Map()
  for (const [id, d] of docs) m.set(id, (d.rel[rel] ?? []).map(e => e.id))
  return m
}

// child -> parent 방향 인접 리스트에서 순환을 찾는다. 경로 배열의 목록을 돌려준다.
export function findCycles(adj) {
  const cycles = [], state = new Map(), stack = []
  const seen = new Set()
  const visit = n => {
    state.set(n, 1); stack.push(n)
    for (const t of adj.get(n) ?? []) {
      if (state.get(t) === 1) {
        const path = stack.slice(stack.indexOf(t)).concat(t)
        const key = [...path.slice(0, -1)].sort().join('|')
        if (!seen.has(key)) { seen.add(key); cycles.push(path) }
      } else if (!state.has(t)) visit(t)
    }
    stack.pop(); state.set(n, 2)
  }
  for (const n of adj.keys()) if (!state.has(n)) visit(n)
  return cycles
}

// child 아래에 parent 를 새 상위로 달면 순환인지. parent 에서 상위를 따라 올라가 child 에 닿는지 본다.
export function wouldCycle(adj, child, parent) {
  if (child === parent) return [child, parent]
  const seen = new Set(), stack = [[parent, [child, parent]]]
  while (stack.length) {
    const [n, path] = stack.pop()
    for (const t of adj.get(n) ?? []) {
      if (t === child) return [...path, t]
      if (!seen.has(t)) { seen.add(t); stack.push([t, [...path, t]]) }
    }
  }
  return null
}

export function depths(adj) {
  const memo = new Map()
  const d = (n, guard = new Set()) => {
    if (memo.has(n)) return memo.get(n)
    if (guard.has(n)) return 0
    guard.add(n)
    const ps = adj.get(n) ?? []
    const v = ps.length ? 1 + Math.max(...ps.map(p => d(p, guard))) : 0
    guard.delete(n); memo.set(n, v)
    return v
  }
  return new Map([...adj.keys()].map(n => [n, d(n)]))
}
