<script setup lang="ts">
// Reference page for the pipeline.yaml schema. Opened (in a new tab) from the
// "pipeline.yaml schema" button in the definition editor. Static documentation —
// keep it in sync with utils/pipelineParser.ts (parsePipelineSpec / resolveGraph
// / validatePipeline) on the backend.
const example = `name: Rancher Issue Fix & Demo
description: Reproduce a rancher/dashboard issue, demonstrate it, fix it, then open a PR.

args:
  - name: ISSUE_URL
    required: true
    description: URL of the GitHub issue to target.

stages:
  - name: Reproduce Issue
    skill: rancher-issue-reproduce
    successCriteria: The bug is reliably reproduced and the trigger steps are documented.
    description: Reproduce the issue against the project's Rancher instance.
    next: [Decide Demonstration]

  - name: Decide Demonstration
    skill: rancher-demo-decide
    successCriteria: A medium (screenshot or video) is chosen.
    # Fork: both recorders run; only the chosen medium produces output.
    next: [Record Screenshot, Record Video]

  - name: Record Screenshot
    skill: rancher-screenshot-record
    successCriteria: A before-fix screenshot is captured (no-op otherwise).
    next: [Create Fix]

  - name: Record Video
    skill: rancher-video-record
    successCriteria: A before-fix video is recorded (no-op otherwise).
    next: [Create Fix]

  - name: Create Fix
    skill: rancher-fix-create
    successCriteria: A focused change addressing the root cause is implemented.
    # Join: runs once both record branches reach it. No next: = terminal (an end).
`
</script>

<template>
  <div class="schema-page">
    <div class="schema-body">
      <div class="schema-inner">
      <h1 class="schema-title">pipeline.yaml schema</h1>
      <p class="lead">
        A pipeline definition is a <code>pipeline.yaml</code> file: a name, an optional
        description, an optional list of <code>args</code>, and a list of
        <code>stages</code>. The stages form a directed graph (a DAG, with forks and
        joins) connected by each stage's <code>next:</code> field.
      </p>

      <section>
        <h2>Top-level fields</h2>
        <table class="schema-table">
          <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>name</code></td><td>string</td><td>no</td><td>Display name. Defaults to a title-cased version of the definition id.</td></tr>
            <tr><td><code>description</code></td><td>string</td><td>no</td><td>One-line summary shown in the UI.</td></tr>
            <tr><td><code>args</code></td><td>list</td><td>no</td><td>User-supplied inputs collected before a run (see below).</td></tr>
            <tr><td><code>stages</code></td><td>list</td><td><strong>yes</strong></td><td>The pipeline's stages. At least one is required.</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2><code>args[]</code> — run inputs</h2>
        <p>Each arg is collected from the user before a run and passed into the workspace as an environment variable of the same name.</p>
        <table class="schema-table">
          <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>name</code></td><td>string</td><td><strong>yes</strong></td><td>Env-var-style identifier, e.g. <code>ISSUE_URL</code>.</td></tr>
            <tr><td><code>required</code></td><td>boolean</td><td>no</td><td>If true, a run can't start until it's provided. Default <code>false</code>.</td></tr>
            <tr><td><code>description</code></td><td>string</td><td>no</td><td>Hint shown next to the input field.</td></tr>
            <tr><td><code>default</code></td><td>string</td><td>no</td><td>Pre-filled value.</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2><code>stages[]</code> — the pipeline</h2>
        <table class="schema-table">
          <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>name</code></td><td>string</td><td><strong>yes</strong></td><td>Unique stage name. Referenced by other stages' <code>next:</code>.</td></tr>
            <tr><td><code>skill</code></td><td>string</td><td><strong>yes</strong></td><td>The skill that runs this stage — a bundled skill or a global <code>rancher-*</code> skill-definition.</td></tr>
            <tr><td><code>successCriteria</code></td><td>string</td><td>no</td><td>How the stage's success is judged. (<code>success_criteria</code> is also accepted.)</td></tr>
            <tr><td><code>description</code></td><td>string</td><td>no</td><td>What the stage does (shown in the graph node / detail).</td></tr>
            <tr><td><code>next</code></td><td>string or list</td><td>no</td><td>Successor stage name(s). See the graph rules below.</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>The stage graph (<code>next</code>)</h2>
        <ul class="schema-rules">
          <li><code>next</code> lists the <strong>names</strong> of the stages that run after this one. Multiple names = a <strong>fork</strong> (they run in parallel).</li>
          <li>A stage with <strong>no</strong> <code>next</code> (or an empty list) is a <strong>terminal</strong> — an end of the pipeline.</li>
          <li>A stage named by several predecessors is a <strong>join</strong> — it runs once all of them reach it.</li>
          <li>You may write a single successor as a string (<code>next: Decide Demonstration</code>) or a list (<code>next: [A, B]</code>).</li>
          <li><strong>Back-compat:</strong> if <em>no</em> stage declares <code>next</code> at all, the stages run as a linear chain top-to-bottom.</li>
        </ul>
      </section>

      <section>
        <h2>Validation (checked on save)</h2>
        <p>A definition must be a runnable graph. Saving is blocked until:</p>
        <ul class="schema-rules">
          <li>there is at least one stage;</li>
          <li>every stage has a <code>skill</code>;</li>
          <li>every <code>next</code> target names an existing stage;</li>
          <li>there is an <strong>entry point</strong> (a stage with no predecessor) — i.e. the graph isn't fully cyclic;</li>
          <li>there is at least one <strong>terminal</strong> stage (the pipeline can end);</li>
          <li>every referenced <code>skill</code> is available (bundled, or a global skill-definition). Missing skills can be quick-created from the editor.</li>
        </ul>
      </section>

      <section>
        <h2>Full example</h2>
        <pre class="schema-example">{{ example }}</pre>
      </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.schema-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-primary);
}
.schema-title { font-size: 20px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 16px; }

.schema-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 28px 60px;
}
.schema-inner {
  max-width: 900px;
  margin: 0 auto;
  font-size: 13.5px;
  color: var(--color-text-primary);
  line-height: 1.6;
}
.lead { color: var(--color-text-hover); margin: 0 0 8px; }
.schema-body section { margin-top: 28px; }
.schema-body h2 { font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 10px; }
.schema-body code {
  font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12.5px;
  background: var(--color-bg-element); color: var(--color-text-hover); padding: 1px 5px; border-radius: 4px;
}

.schema-table { width: 100%; border-collapse: collapse; }
.schema-table th, .schema-table td {
  text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--color-border-dark); vertical-align: top;
}
.schema-table th { color: var(--color-text-muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.schema-table td:nth-child(2), .schema-table td:nth-child(3) { color: var(--color-text-muted); white-space: nowrap; }

.schema-rules { margin: 0; padding-left: 20px; }
.schema-rules li { margin: 6px 0; }

.schema-example {
  margin: 0; padding: 16px; border-radius: 8px;
  background: var(--color-bg-secondary); border: 1px solid var(--color-border-medium);
  font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.55;
  color: var(--color-text-primary); overflow-x: auto; white-space: pre;
}
</style>
