# Spawning another pipeline

You can create and start a separate pipeline from within a stage with the
`spawn-pipeline` tool. Use it to hand off independent follow-up work that should
run as its own pipeline (it runs on its own, not as part of this run).

List the available pipeline definitions and the arguments each one takes:

```bash
spawn-pipeline list
```

Create one, set its arguments, and start a run (repeat `--arg` per argument):

```bash
spawn-pipeline create --definition <id> --label "short description" \
  --arg ISSUE_URL=https://github.com/rancher/dashboard/issues/123
```

Add `--no-start` to create it without starting a run.

The pipeline you create is automatically tagged as **spawned by this pipeline**
(its creator pipeline, run, and stage), so the lineage shows up in the portal —
you do not need to pass any creator information yourself.

Only spawn a pipeline when the task genuinely calls for separate follow-up work;
do not spawn one for steps you can complete within the current stage.
