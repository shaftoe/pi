#!/usr/bin/env bun
/**
 * Generate an LLM prompt summarizing upstream changes.
 *
 * The range is expressed purely in terms of resolved commit SHAs: the caller
 * (the workflow) reads the last-synced tip from upstream-sync.log and passes it
 * as --from, and passes the upstream tip as --to. The script never touches the
 * log file and never depends on the fork's own branch history, so it works the
 * same locally and in CI and stays reproducible days after the sync.
 *
 * Usage:
 *   bun scripts/upstream-digest.ts --to <ref> [--from <ref>]
 *
 *   --to,   -t <ref>   Ending upstream ref (required). Typically upstream/main.
 *   --from, -f <ref>   Starting ref (default: upstream-sync/latest).
 *
 * Prints the prompt to stdout. Pipe into pi:
 *   pi -p "$(bun scripts/upstream-digest.ts --to upstream/main)"
 */

import { execSync } from "child_process";

const args = process.argv.slice(2);

let fromRef = "";
let toRef = "";
const upstreamRepo = "earendil-works/pi-mono";
const upstreamBranch = "main";

for (let i = 0; i < args.length; i++) {
	const arg = args[i]!;
	if (arg === "--from" || arg === "-f") {
		fromRef = args[++i] ?? "";
	} else if (arg === "--to" || arg === "-t") {
		toRef = args[++i] ?? "";
	} else if (arg === "--help" || arg === "-h") {
		console.log(`Usage: bun scripts/upstream-digest.ts --to <ref> [--from <ref>]

Options:
  --to,   -t <ref>   Ending upstream ref (required). Typically upstream/main.
  --from, -f <ref>   Starting ref (SHA). When omitted, the caller (workflow) is
                     expected to pass the last-synced tip from upstream-sync.log.`);
		process.exit(0);
	} else {
		console.error(`Error: unknown argument "${arg}"`);
		process.exit(2);
	}
}

if (!toRef) {
	console.error("Error: --to is required");
	process.exit(1);
}
if (!fromRef) {
	console.error("Error: --from is required");
	process.exit(1);
}

const git = (cmd: string) =>
	execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

// Resolve via --verify so an unresolvable ref fails loudly with a clear message
// instead of crashing inside execSync or silently echoing the literal arg.
const resolve = (ref: string, label: string): string => {
	try {
		return git(`git rev-parse --verify --quiet "${ref}^{commit}"`);
	} catch {
		console.error(`Error: ${label} ref "${ref}" does not resolve to a commit.`);
		process.exit(1);
	}
};

const from = resolve(fromRef, "--from");
const to = resolve(toRef, "--to");

if (!from || !to) {
	console.error("Error: could not resolve both --from and --to to commits.");
	process.exit(1);
}

if (from === to) {
	console.error("No commits to summarize (--from and --to resolve to the same commit).");
	process.exit(0);
}

// Fail loudly rather than silently spanning an implausible range (e.g. a missing
// or rewound --from). upstream/main has hundreds of commits per minor release;
// a single daily sync is a handful. 500 is a generous safety ceiling.
const count = parseInt(git(`git rev-list "${from}..${to}" --count`), 10);
if (count > 500) {
	console.error(
		`Error: range ${from}..${to} spans ${count} commits, which is implausibly large. ` +
			`Check that --from points at the intended commit.`,
	);
	process.exit(1);
}

const log = git(
	`git log --format="### %s%n- Hash: %h%n- Author: %an%n- Date: %ci%n%n%b---" "${from}..${to}"`,
);

const prompt = `You are analyzing upstream changes from the Pi coding agent project (${upstreamRepo}) that were synced to this fork. Write a concise, well-organized digest.

## Changes to analyze

Repository: ${upstreamRepo}
Branch: ${upstreamBranch}
Range: ${from}..${to}
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
