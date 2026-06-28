// A small, dependency-free line diff (LCS) used to show how a stage's SKILL.md
// changed between runs. Produces a unified-diff-like row list with long runs of
// unchanged lines collapsed into a "gap" marker so the result is easy to digest.

export interface DiffRow {
  type: 'ctx' | 'add' | 'del' | 'gap'
  text: string
  // For 'gap': how many unchanged lines were collapsed.
  count?: number
}

export interface LineDiff {
  rows: DiffRow[]
  adds: number
  dels: number
}

export function diffLines(oldText: string, newText: string, context = 3): LineDiff {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length

  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'ctx', text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: a[i] }); i++ }
    else { ops.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < n) { ops.push({ type: 'del', text: a[i] }); i++ }
  while (j < m) { ops.push({ type: 'add', text: b[j] }); j++ }

  const adds = ops.reduce((c, o) => c + (o.type === 'add' ? 1 : 0), 0)
  const dels = ops.reduce((c, o) => c + (o.type === 'del' ? 1 : 0), 0)

  // Keep `context` unchanged lines around each change; collapse the rest.
  const keep = new Array(ops.length).fill(false)
  ops.forEach((o, idx) => {
    if (o.type === 'ctx') return
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true
  })

  const rows: DiffRow[] = []
  let gap = 0
  for (let idx = 0; idx < ops.length; idx++) {
    if (keep[idx]) {
      if (gap) { rows.push({ type: 'gap', text: '', count: gap }); gap = 0 }
      rows.push(ops[idx])
    } else {
      gap++
    }
  }
  if (gap) rows.push({ type: 'gap', text: '', count: gap })

  return { rows, adds, dels }
}
