# Demo recording script

For a human to follow with real screen-recording software. Produces `assets/demo.gif`,
referenced from `README.md`.

**Setup before recording:** a project already added, a real Claude Code session
authenticated, and a small real repo with an obvious one-line bug to fix — the smaller the
diff, the shorter the recording.

1. Show the Objective Board (empty or near-empty) — 2 seconds.
2. Click "New objective," type a one-sentence bug description, submit.
3. Let the agent explore and propose a plan; show the Plan Approval screen — pause on it long
   enough to read.
4. Click "Approve."
5. Let one task execute; show the Focus View's structured event display (not a raw log) while
   it runs.
6. Show the Evidence Panel once a check/test result lands — pause on a passing evidence item.
7. Reach `awaitingReview`; show the diff.
8. Click "Integrate" (commit).
9. Show the objective at `done`.

Keep the whole recording under 60 seconds — this is a GIF for a README, not a full walkthrough
video. Trim dead air (agent "thinking" time) aggressively in editing.
