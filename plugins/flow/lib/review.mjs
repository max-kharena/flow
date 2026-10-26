import { parseJson } from './io.mjs';

export const isBot = (user) => user?.type === 'Bot' || /\[bot\]$/i.test(user?.login ?? '') || Boolean(user?.is_bot);

// Every review comment on a PR as threads, for the review-replies skill.
// `gh` is a function (args) => stdout or null. A thread is "open" when its
// last word is not the PR author's.
export function prThreads(gh, number) {
  const view = parseJson(gh(['pr', 'view', String(number), '--json', 'number,url,author,headRefName,reviews,comments']));
  if (!view) return null;
  const author = view.author?.login ?? null;
  const inline = parseJson(gh(['api', `repos/{owner}/{repo}/pulls/${view.number}/comments?per_page=100`, '--paginate', '--slurp'])) ?? [];
  const flat = inline.flat();

  const threads = new Map();
  for (const c of flat.sort((a, b) => a.id - b.id)) {
    const rootId = c.in_reply_to_id ?? c.id;
    if (!threads.has(rootId)) {
      threads.set(rootId, { id: rootId, kind: 'inline', path: c.path, line: c.line ?? c.original_line ?? null, url: c.html_url, comments: [] });
    }
    threads.get(rootId).comments.push({ id: c.id, author: c.user?.login, bot: isBot(c.user), body: c.body, at: c.created_at });
  }
  const reviews = (view.reviews ?? [])
    .filter((r) => r.body?.trim())
    .map((r) => ({
      id: r.id,
      kind: 'review',
      state: r.state,
      url: null,
      comments: [{ id: r.id, author: r.author?.login, bot: isBot(r.author), body: r.body, at: r.submittedAt }],
    }));
  const conversation = (view.comments ?? []).map((c) => ({
    id: c.id,
    kind: 'conversation',
    url: c.url,
    comments: [{ id: c.id, author: c.author?.login, bot: isBot(c.author), body: c.body, at: c.createdAt }],
  }));
  const all = [...threads.values(), ...reviews, ...conversation].map((t) => {
    const last = t.comments.at(-1);
    return { ...t, open: last.author !== author, fromBot: t.comments[0].bot };
  });
  return { number: view.number, url: view.url, author, branch: view.headRefName, threads: all, open: all.filter((t) => t.open).length };
}
