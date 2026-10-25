// A small POSIX-shell lexer for the flow guards. It splits a command line into
// simple commands and resolves the quoting forms agents actually use, including
// `--body "$(cat <<'EOF' … EOF)"` and top-level heredocs. Anything it can't
// resolve (variables, other substitutions) is kept verbatim and flagged dynamic.
//
// Returns [{ words: string[], dynamic: boolean[], stdin: string | null }].

const SEPARATORS = new Set([';', '&', '|', '(', ')']);
const VAR_START = /[A-Za-z_{0-9@*#?$!-]/;
const HEREDOC_OP = /^(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2/;

export function heredocCatBody(content) {
  const m = /^\s*cat\s+<<(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2[ \t]*\n([\s\S]*?\n)?[ \t]*\3[ \t]*\n?\s*$/.exec(content);
  if (!m) return null;
  let body = (m[4] ?? '').replace(/\n$/, '');
  if (m[1] === '-') body = body.replace(/^\t+/gm, '');
  return body;
}

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
  function readHeredocBodies() {
    for (const h of pending.splice(0)) h.seg.stdin = readHeredocLines(h);
  }
  function findBacktick(j) {
    while (j < input.length && input[j] !== '`') j += input[j] === '\\' ? 2 : 1;
    return Math.min(j, input.length);
  }
  function skipDouble(j) {
    while (j < input.length && input[j] !== '"') j += input[j] === '\\' ? 2 : 1;
    return j + 1;
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
      if (ch === "'") {
        const end = input.indexOf("'", j + 1);
        j = end === -1 ? input.length : end + 1;
        continue;
      }
      if (ch === '"') {
        j = skipDouble(j + 1);
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
    const body = heredocCatBody(content);
    if (body !== null) append(body);
    else {
      append(`$(${content})`);
      dynamic = true;
    }
    return j + 1;
  }
  function readDouble(j) {
    let out = '';
    while (j < input.length && input[j] !== '"') {
      const ch = input[j];
      if (ch === '\\' && '"\\$`\n'.includes(input[j + 1] ?? '')) {
        if (input[j + 1] !== '\n') out += input[j + 1];
        j += 2;
        continue;
      }
      if (ch === '$' && input[j + 1] === '(') {
        append(out);
        out = '';
        j = readSubstitution(j + 2);
        continue;
      }
      if (ch === '$' && VAR_START.test(input[j + 1] ?? '')) {
        append(out);
        out = '';
        j = readVariable(j);
        continue;
      }
      if (ch === '`') {
        const end = findBacktick(j + 1);
        out += input.slice(j, end + 1);
        dynamic = true;
        j = end + 1;
        continue;
      }
      out += ch;
      j++;
    }
    append(out);
    return j + 1;
  }
  function readAnsiC(j) {
    let out = '';
    const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' };
    while (j < input.length && input[j] !== "'") {
      if (input[j] === '\\' && j + 1 < input.length) {
        out += map[input[j + 1]] ?? input[j + 1];
        j += 2;
      } else out += input[j++];
    }
    append(out);
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
      const end = input.indexOf("'", i + 1);
      const stop = end === -1 ? input.length : end;
      append(input.slice(i + 1, stop));
      i = stop + 1;
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
    if (c === '$' && input[i + 1] === '(') {
      i = readSubstitution(i + 2);
      continue;
    }
    if (c === '$' && VAR_START.test(input[i + 1] ?? '')) {
      i = readVariable(i);
      continue;
    }
    if (c === '`') {
      const end = findBacktick(i + 1);
      append(input.slice(i, end + 1));
      dynamic = true;
      i = end + 1;
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
      readHeredocBodies();
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
  readHeredocBodies();
  endSegment();
  return segments;
}
