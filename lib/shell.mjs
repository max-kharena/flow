// A small POSIX-shell lexer for the flow guards. It splits a command line into
// simple commands and resolves the quoting forms agents actually use, including
// `--body "$(cat <<'EOF' … EOF)"` and top-level heredocs. Anything it can't
// resolve (variables, other substitutions) is kept verbatim and flagged dynamic.
//
// Returns [{ words: string[], dynamic: boolean[], stdin: string | null }].

const SEPARATORS = new Set([';', '&', '|', '(', ')']);
const VAR_START = /[A-Za-z_{0-9@*#?$!-]/;
const HEREDOC_OP = /^(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2/;

export function parseShell(input) {
  const segments = [];
  const pending = [];
  let seg = newSegment();
  let word = null;
  let dynamic = false;
  let discardNext = false;
  let hereStringNext = false;
  let i = 0;

  function newSegment() {
    return { words: [], dynamic: [], stdin: null };
  }
  function append(text) {
    word = (word ?? '') + text;
  }
  function endWord() {
    if (word !== null) {
      if (discardNext) discardNext = false;
      else if (hereStringNext) {
        seg.stdin = word;
        hereStringNext = false;
      } else {
        seg.words.push(word);
        seg.dynamic.push(dynamic);
      }
    }
    word = null;
    dynamic = false;
  }
  function endSegment() {
    endWord();
    if (seg.words.length || seg.stdin !== null) segments.push(seg);
    seg = newSegment();
  }
  // Reads heredoc lines from `i` up to the delimiter line; leaves `i` after it.
  function readHeredocLines(h) {
    const lines = [];
    while (i < input.length) {
      let nl = input.indexOf('\n', i);
      if (nl === -1) nl = input.length;
      const raw = input.slice(i, nl);
      i = nl + 1;
      const line = h.strip ? raw.replace(/^\t+/, '') : raw;
      if (line.trim() === h.delim) break;
      lines.push(line);
    }
    return lines.join('\n');
  }
  // Index just past the next unescaped `close`, or the end of input.
  function scanTo(j, close) {
    while (j < input.length && input[j] !== close) j += input[j] === '\\' ? 2 : 1;
    return Math.min(j + 1, input.length);
  }
  // Index just past the closing single quote; backslashes are literal inside.
  function singleQuoteEnd(j) {
    const end = input.indexOf("'", j);
    return end === -1 ? input.length : end + 1;
  }
  function readVariable(j) {
    let k = j + 1;
    if (input[k] === '{') {
      const close = input.indexOf('}', k);
      k = close === -1 ? input.length : close + 1;
    } else if (/[A-Za-z_]/.test(input[k])) {
      while (k < input.length && /[A-Za-z0-9_]/.test(input[k])) k++;
    } else {
      k++;
    }
    append(input.slice(j, k));
    dynamic = true;
    return k;
  }
  // `$(…)`: finds the closing paren (skipping quotes and heredoc bodies), then
  // lexes the content. A lone `cat` fed by a heredoc resolves to that text.
  function readSubstitution(j) {
    const start = j;
    const inner = [];
    let depth = 1;
    while (j < input.length) {
      const ch = input[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === "'" || ch === '"') {
        j = ch === "'" ? singleQuoteEnd(j + 1) : scanTo(j + 1, ch);
        continue;
      }
      if (ch === '<' && input[j + 1] === '<' && input[j + 2] !== '<') {
        const m = HEREDOC_OP.exec(input.slice(j + 2));
        if (m) {
          inner.push({ delim: m[3], strip: m[1] === '-' });
          j += 2 + m[0].length;
          continue;
        }
      }
      if (ch === '\n' && inner.length) {
        i = j + 1;
        for (const h of inner.splice(0)) readHeredocLines(h);
        j = i;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) break;
      j++;
    }
    const content = input.slice(start, j);
    const parsed = parseShell(content);
    const [only] = parsed;
    if (parsed.length === 1 && only.words.length === 1 && only.words[0] === 'cat' && only.stdin !== null) append(only.stdin);
    else {
      append(`$(${content})`);
      dynamic = true;
    }
    return j + 1;
  }
  // `$(…)`, `$VAR` and backticks, which mean the same inside and outside
  // double quotes. Returns the index after the expansion, or -1 if there's none at j.
  function readExpansion(j) {
    if (input[j] === '$' && input[j + 1] === '(') return readSubstitution(j + 2);
    if (input[j] === '$' && VAR_START.test(input[j + 1] ?? '')) return readVariable(j);
    if (input[j] === '`') {
      const end = scanTo(j + 1, '`');
      append(input.slice(j, end));
      dynamic = true;
      return end;
    }
    return -1;
  }
  function readDouble(j) {
    append('');
    while (j < input.length && input[j] !== '"') {
      if (input[j] === '\\' && '"\\$`\n'.includes(input[j + 1] ?? '')) {
        if (input[j + 1] !== '\n') append(input[j + 1]);
        j += 2;
        continue;
      }
      const next = readExpansion(j);
      if (next >= 0) j = next;
      else append(input[j++]);
    }
    return j + 1;
  }
  function readAnsiC(j) {
    const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' };
    append('');
    while (j < input.length && input[j] !== "'") {
      if (input[j] === '\\' && j + 1 < input.length) {
        append(map[input[j + 1]] ?? input[j + 1]);
        j += 2;
      } else append(input[j++]);
    }
    return j + 1;
  }
  function skipRedirect(k) {
    if (input[k] === '&') k++;
    while (input[k] === '>' || input[k] === '<') k++;
    if (input[k] === '&') {
      k++;
      while (/[\d-]/.test(input[k] ?? '')) k++;
      return k;
    }
    if (input[k] === '|') k++;
    discardNext = true;
    return k;
  }

  while (i < input.length) {
    const c = input[i];
    if (c === '\\') {
      if (input[i + 1] !== '\n' && i + 1 < input.length) append(input[i + 1]);
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = singleQuoteEnd(i + 1);
      append(input.slice(i + 1, input[end - 1] === "'" ? end - 1 : end));
      i = end;
      continue;
    }
    if (c === '"') {
      i = readDouble(i + 1);
      continue;
    }
    if (c === '$' && input[i + 1] === "'") {
      i = readAnsiC(i + 2);
      continue;
    }
    const next = readExpansion(i);
    if (next >= 0) {
      i = next;
      continue;
    }
    if (c === '#' && word === null) {
      const nl = input.indexOf('\n', i);
      i = nl === -1 ? input.length : nl;
      continue;
    }
    if (c === '\n') {
      i++;
      endWord();
      for (const h of pending.splice(0)) h.seg.stdin = readHeredocLines(h);
      endSegment();
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i++;
      continue;
    }
    if (c === '<' && input[i + 1] === '<' && input[i + 2] === '<') {
      endWord();
      hereStringNext = true;
      i += 3;
      continue;
    }
    if (c === '<' && input[i + 1] === '<') {
      endWord();
      const m = HEREDOC_OP.exec(input.slice(i + 2));
      if (m) {
        pending.push({ delim: m[3], strip: m[1] === '-', seg });
        i += 2 + m[0].length;
      } else i += 2;
      continue;
    }
    if (c === '>' || c === '<' || (c === '&' && input[i + 1] === '>')) {
      if (word !== null && /^\d+$/.test(word)) {
        word = null;
        dynamic = false;
      } else endWord();
      i = skipRedirect(i);
      continue;
    }
    if (SEPARATORS.has(c)) {
      endSegment();
      i++;
      if ((c === '&' || c === '|') && input[i] === c) i++;
      continue;
    }
    append(c);
    i++;
  }
  endWord();
  for (const h of pending.splice(0)) h.seg.stdin = readHeredocLines(h);
  endSegment();
  return segments;
}
