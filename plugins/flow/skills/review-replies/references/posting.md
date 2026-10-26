# Posting replies

Reply text and comment text never go on a shell command line, in an `echo`, or in a heredoc. Write each reply with the Write tool to a file inside the git folder, where it can't be committed. That folder is `<dir>` below:

```bash
mkdir -p "$(git rev-parse --absolute-git-dir)/flow/replies"
```

Name each file after the thread, as `<dir>/reply-<thread-id>.md`. Run the secret scan over every file before posting:

```bash
node <flow>/scripts/flow.mjs secret-scan --text-file <dir>/reply-<thread-id>.md
```

Exit code 1 means it found something. Remove it from the reply and scan again.

## Inline threads (`kind: "inline"`)

Reply inside the thread. The thread's `id` is its first comment's id, which is the one GitHub's replies endpoint takes. Turn the reply into a JSON payload with the body as data, then post it:

```bash
node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[2], JSON.stringify({ body: fs.readFileSync(process.argv[1], "utf8") }))' \
  <dir>/reply-<thread-id>.md <dir>/reply-<thread-id>.json
gh api --method POST "repos/{owner}/{repo}/pulls/<pr>/comments/<thread-id>/replies" \
  --input <dir>/reply-<thread-id>.json --jq .html_url
```

`gh` fills in `{owner}/{repo}` from the current repo. The command prints the reply's link.

## Review-level and conversation comments (`kind: "review"` or `"conversation"`)

These have no thread to reply in. Post a PR comment that starts with `@reviewer` and the point in a few words:

```bash
gh pr comment <pr> --body-file <dir>/reply-<thread-id>.md
```

It prints the comment's link.

## When a post fails

- **404 on an inline reply.** The comment was deleted, or the id isn't a thread's first comment. Re-run `pr-comments` and use the thread `id` it gives.
- **403.** No write access, as on some fork PRs. Give the engineer the reply files to post by hand.
- **Any other error.** Keep the file, note the thread as "reply not posted" in the final table with the error, and go on to the next thread.

Never retry by pasting the reply into the command.
