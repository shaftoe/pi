#!/usr/bin/env bun
/**
 * Generate an LLM prompt summarizing upstream changes.
 *
 * Usage:
 *   bun scripts/upstream-digest.ts --from <hash> [--to <ref>]
 *
 * Prints the prompt to stdout. Pipe into pi:
 *   pi -p "$(bun scripts/upstream-digest.ts --from abc1234)"
 */

import { execSync } from "child_process";

const args = process.argv.slice(2);

let fromHash = "";
let toRef = "HEAD";
const upstreamRepo = "earendil-works/pi-mono";
const upstreamBranch = "main";

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--from" || args[i] === "-f") {
		fromHash = args[++i]!;
	} else if (args[i] === "--to" || args[i] === "-t") {
		toRef = args[++i]!;
	} else if (args[i] === "--help" || args[i] === "-h") {
		console.log(`Usage: bun scripts/upstream-digest.ts --from <hash> [--to <ref>]

Options:
  --from, -f <hash>   Starting commit (required)
  --to,   -t <ref>    Ending ref (default: HEAD)`);
		process.exit(0);
	}
}

if (!fromHash) {
	console.error("Error: --from is required");
	process.exit(1);
}

const git = (cmd: string) =>
	execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const from = git(`git rev-parse "${fromHash}"`);
const to = git(`git rev-parse "${toRef}"`);

if (from === to) {
	console.error("No commits to summarize (--from and --to resolve to the same commit).");
	process.exit(0);
}

const count = parseInt(git(`git rev-list "${from}..${to}" --count`), 10);
const log = git(
	`git log --format="### %s%n- Hash: %h%n- Author: %an%n- Date: %ci%n%n%b---" "${from}..${to}" -- . ':!.github/workflows/upstream-sync-and-digest.yml'`,
);

const prompt = `You are analyzing upstream changes from the Pi coding agent project (${upstreamRepo}) that were synced to this fork. Write a concise, well-organized digest.

## Changes to analyze

Repository: ${upstreamRepo}
Branch: ${upstreamBranch}
Commits: ${count}

${log}

Total commits: ${count}

## Instructions

- Group by category: Breaking Changes, New Features, Bug Fixes, Internal/Refactor, Dependencies, Documentation
- Include the commit hash for each item
- Skip trivial changes (typo fixes, formatting)
- If there are breaking changes, highlight them at the top
- End with a one-paragraph summary
- Use GitHub-flavored Markdown`;

process.stdout.write(prompt);
