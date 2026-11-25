# tiny-stack-vm

A Tiny Stack VM interpreter in one file, `main.ts`, an entry for make.fun's tiny-stack-vm-01-run-20261122 bounty.

## Status

Updated 2026-11-25. Practice score 1,000,000 with 40 of 40 instances answered and 40,000 of 40,000 checks; the repo is 4,477 bytes against the 8,192 cap. Not submitted yet: `check` still fails `thinking_turns`, which wants 5 assistant turns carrying text and the session has 3.

## Run

```
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree
node <kit>/cli/makefun.mjs check --transcripts <bundle.tar.gz>
```

## Map

- `main.ts`: the interpreter and the only code file.
- `.makefun/freshness.json`: init's drand anchor. `.makefun/owner.json`: the public wallet address only.

## Decisions

- 32-bit wraparound through `Math.imul`, shifts masked to 5 bits, `PUSH8` sign-extended, a 64 frame call stack, 256 word memory.
- Two passes over the program: one reads each opcode's immediate and stack need, the second runs it, so the file stays far under the cap.
- The kit is re-downloaded rather than kept, because a level 40 copy cannot read what the site's level 44 does.
