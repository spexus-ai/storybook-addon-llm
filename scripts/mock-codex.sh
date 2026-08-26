#!/bin/bash
# Mock codex CLI for E2E tests. Logs arguments and emits JSONL events
# resembling `codex exec --json` output.
LOG="${MOCK_CODEX_LOG:-/tmp/mock-codex-args.log}"
echo "$*" >> "$LOG"

if echo "$*" | grep -q "resume"; then
  echo '{"type":"thread.started","thread_id":"thread-123"}'
  echo '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Resumed session."}}'
  echo '{"type":"turn.completed"}'
else
  echo '{"type":"thread.started","thread_id":"thread-123"}'
  echo '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"git status","status":"in_progress"}}'
  echo '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"git status","status":"completed"}}'
  echo '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Hello from mock codex."}}'
  echo '{"type":"turn.completed"}'
fi
exit 0
