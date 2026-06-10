<script setup lang="ts">
import { computed } from 'vue'

interface GraphStage {
  name: string
  skill: string
  next?: number[]
}

const props = defineProps<{
  stages: GraphStage[]
}>()

// Node + spacing geometry (px)
const NODE_W = 168
const NODE_H = 56
const COL_GAP = 54
const ROW_GAP = 20

const layout = computed(() => {
  const stages = props.stages || []
  const N = stages.length
  const next: number[][] = stages.map((s, i) =>
    (s.next && s.next.length ? s.next : (i < N - 1 ? [i + 1] : [])).filter(j => j >= 0 && j < N),
  )
  const preds: number[][] = stages.map(() => [])
  next.forEach((succ, i) => succ.forEach(j => preds[j].push(i)))

  // longest-path layering (bounded iterations so cycles terminate)
  const layer = new Array(N).fill(0)
  for (let iter = 0; iter < N; iter++) {
    let changed = false
    for (let i = 0; i < N; i++) {
      for (const j of next[i]) {
        if (layer[j] < layer[i] + 1) { layer[j] = layer[i] + 1; changed = true }
      }
    }
    if (!changed) break
  }

  // group by column, assign rows
  const cols = new Map<number, number[]>()
  for (let i = 0; i < N; i++) {
    const l = layer[i]
    if (!cols.has(l)) cols.set(l, [])
    cols.get(l)!.push(i)
  }
  const maxLayer = N ? Math.max(...layer) : 0
  let maxRows = 1
  cols.forEach(g => { maxRows = Math.max(maxRows, g.length) })

  const colStride = NODE_W + COL_GAP
  const rowStride = NODE_H + ROW_GAP
  const totalH = maxRows * rowStride - ROW_GAP

  const pos: Array<{ x: number; y: number }> = new Array(N)
  cols.forEach((group, l) => {
    const colH = group.length * rowStride - ROW_GAP
    const startY = (totalH - colH) / 2
    group.forEach((nodeIdx, row) => {
      pos[nodeIdx] = { x: l * colStride, y: startY + row * rowStride }
    })
  })

  const width = (maxLayer + 1) * colStride - COL_GAP
  const height = totalH

  // edges
  const edges: Array<{ from: number; to: number; path: string; back: boolean }> = []
  next.forEach((succ, i) => {
    for (const j of succ) {
      const a = pos[i], b = pos[j]
      if (!a || !b) continue
      const back = layer[j] <= layer[i]
      if (!back) {
        const sx = a.x + NODE_W, sy = a.y + NODE_H / 2
        const tx = b.x, ty = b.y + NODE_H / 2
        const mx = (sx + tx) / 2
        edges.push({ from: i, to: j, back: false, path: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}` })
      } else {
        // loop / back-edge — route below the graph
        const sx = a.x + NODE_W / 2, sy = a.y + NODE_H
        const tx = b.x + NODE_W / 2, ty = b.y + NODE_H
        const dip = height + 34
        edges.push({ from: i, to: j, back: true, path: `M ${sx} ${sy} C ${sx} ${dip}, ${tx} ${dip}, ${tx} ${ty}` })
      }
    }
  })

  const terminals = new Set<number>()
  for (let i = 0; i < N; i++) if (next[i].length === 0) terminals.add(i)
  const starts = new Set<number>()
  for (let i = 0; i < N; i++) if (preds[i].length === 0) starts.add(i)

  return { pos, edges, width, height, NODE_W, NODE_H, terminals, starts }
})
</script>

<template>
  <div class="graph-scroll">
    <div
      class="graph-canvas"
      :style="{ width: layout.width + 'px', height: layout.height + 'px' }"
    >
      <svg class="graph-edges" :style="{ width: layout.width + 'px', height: (layout.height + 60) + 'px' }">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--color-border-medium)" />
          </marker>
        </defs>
        <path
          v-for="(e, ei) in layout.edges"
          :key="ei"
          :d="e.path"
          class="edge"
          :class="{ back: e.back }"
          marker-end="url(#arrow)"
        />
      </svg>

      <div
        v-for="(stage, i) in stages"
        :key="i"
        class="graph-node"
        :style="{
          left: layout.pos[i].x + 'px',
          top: layout.pos[i].y + 'px',
          width: layout.NODE_W + 'px',
          height: layout.NODE_H + 'px',
        }"
      >
        <slot
          name="node"
          :stage="stage"
          :index="i"
          :is-start="layout.starts.has(i)"
          :is-terminal="layout.terminals.has(i)"
        >
          <!-- default node content -->
          <div class="default-node">
            <span class="dn-name">{{ stage.name }}</span>
            <span class="dn-skill">{{ stage.skill }}</span>
          </div>
        </slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px 0 10px;
}

.graph-canvas {
  position: relative;
  margin: 0 auto;
}

.graph-edges {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
}

.edge {
  fill: none;
  stroke: var(--color-border-medium);
  stroke-width: 2;
}

.edge.back {
  stroke-dasharray: 5 4;
  stroke: var(--color-accent);
  opacity: 0.7;
}

.graph-node {
  position: absolute;
}
</style>
