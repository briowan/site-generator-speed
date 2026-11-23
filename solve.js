// Faster drop-in for makefun-site 1.0.0 (site-generator-speed-01). Same answers, byte for byte.
// Written from the kit README + reference semantics; hot paths avoid per-character work.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;

function escapeHtml(text) {
  return text.replace(ESC_RE, (c) => ESC[c]);
}

// ---------------- slug / date ----------------

const MARK_RE = /\p{M}/gu;

function slugifyRaw(text) {
  // ASCII fast path: NFKD is identity and there are no marks.
  let ascii = true;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) { ascii = false; break; }
  let out = '';
  let gap = false;
  if (ascii) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      let keep = -1;
      if (c >= 65 && c <= 90) keep = c + 32;
      else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
      if (keep === -1) { gap = out.length > 0; continue; }
      if (gap) out += '-';
      gap = false;
      out += String.fromCharCode(keep);
      if (out.length >= 65) break;
    }
  } else {
    const plain = text.normalize('NFKD').replace(MARK_RE, '');
    for (const ch of plain) {
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) { gap = out.length > 0; continue; }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDateRaw(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function isSpaceCode(c) {
  return c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 5760 ||
    (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

function wordsOf(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const sp = c === 32 || (c >= 9 && c <= 13) || (c >= 128 && isSpaceCode(c));
    if (!sp && !inWord) { count++; inWord = true; }
    else if (sp) inWord = false;
  }
  return count;
}

// ---------------- front matter ----------------

const FM_KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    let last = 1;
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const nx = raw[i + 1];
        if ((nx !== '"' && nx !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += raw.slice(last, i) + nx;
        i++;
        last = i + 1;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
    }
    out += raw.slice(last, raw.length - 1);
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG_RE.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Returns { data, body } or { error }. text has "\n" line ends.
function parseFrontMatter(text) {
  // first line must be exactly ---
  let nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  if (first !== '---') return { error: 'no front matter' };
  if (nl === -1) return { error: 'the front matter is not closed' };
  const data = {};
  let pos = nl + 1;
  let lineNo = 1; // opening --- is line 1; next line is 2
  for (;;) {
    lineNo++;
    const end = text.indexOf('\n', pos);
    const line = end === -1 ? text.slice(pos) : text.slice(pos, end);
    if (line === '---') {
      if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
      return { data, body: end === -1 ? '' : text.slice(end + 1) };
    }
    if (end === -1) return { error: 'the front matter is not closed' };
    pos = end + 1;
    if (isBlankLine(line) || line.charCodeAt(0) === 35) continue;
    // /^([a-z_]+):(?: (.*))?$/
    let i = 0;
    while (i < line.length) {
      const c = line.charCodeAt(i);
      if ((c >= 97 && c <= 122) || c === 95) i++;
      else break;
    }
    if (i === 0 || line.charCodeAt(i) !== 58) return { error: `line ${lineNo} is not "key: value"` };
    let raw;
    if (i + 1 === line.length) raw = '';
    else if (line.charCodeAt(i + 1) === 32) raw = line.slice(i + 2);
    else return { error: `line ${lineNo} is not "key: value"` };
    const key = line.slice(0, i);
    // trailing spaces/tabs dropped
    let e = raw.length;
    while (e > 0 && (raw.charCodeAt(e - 1) === 32 || raw.charCodeAt(e - 1) === 9)) e--;
    if (e !== raw.length) raw = raw.slice(0, e);
    if (!FM_KEYS.has(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
}

// ---------------- markdown ----------------

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const WS_RE = /\s/;

function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}

function nextSpecial(s, from) {
  let j = s.indexOf('\\', from);
  let k = s.indexOf('`', from);
  if (k !== -1 && (j === -1 || k < j)) j = k;
  k = s.indexOf('*', from);
  if (k !== -1 && (j === -1 || k < j)) j = k;
  k = s.indexOf('[', from);
  if (k !== -1 && (j === -1 || k < j)) j = k;
  return j;
}

function inline(s, linkFn) {
  const parts = [];
  let i = 0;
  let runStart = 0;
  const n = s.length;
  const flush = (upto) => { if (upto > runStart) parts.push(escapeHtml(s.slice(runStart, upto))); };
  while (i < n) {
    const j = nextSpecial(s, i);
    if (j === -1) break;
    i = j;
    const c = s[i];
    if (c === '\\' && i + 1 < n && ESCAPABLE.has(s[i + 1])) {
      flush(i);
      parts.push(escapeHtml(s[i + 1]));
      i += 2;
      runStart = i;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        flush(i);
        parts.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>');
        i = j + 1;
        runStart = i;
      } else i++;
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          flush(i);
          parts.push('<strong>', inline(s.slice(i + 2, j), linkFn), '</strong>');
          i = j + 2;
          runStart = i;
        } else i += 2;
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        flush(i);
        parts.push('<em>', inline(s.slice(i + 1, j), linkFn), '</em>');
        i = j + 1;
        runStart = i;
      } else i++;
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !WS_RE.test(target)) {
        flush(i);
        parts.push('<a href="', escapeHtml(linkFn(target)), '">', inline(s.slice(i + 1, k), linkFn), '</a>');
        i = m + 1;
        runStart = i;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  flush(n);
  return parts.join('');
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

function fenceLang(line) {
  // /^```([A-Za-z0-9_+-]*)[ \t]*$/ -> lang or null
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = line.slice(3, i);
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
    i++;
  }
  return lang;
}

function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function headingOf(line) {
  let i = 0;
  while (i < line.length && line.charCodeAt(i) === 35) i++;
  if (i === 0 || i > 6) return null;
  if (i >= line.length || (line.charCodeAt(i) !== 32 && line.charCodeAt(i) !== 9)) return null;
  let a = i;
  while (a < line.length && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  let b = line.length;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  if (b <= a) return null;
  return { depth: i, text: line.slice(a, b) };
}

function isHr(line) {
  if (line.startsWith('---') || line.startsWith('***')) {
    for (let i = 3; i < line.length; i++) {
      const c = line.charCodeAt(i);
      if (c !== 32 && c !== 9) return false;
    }
    return true;
  }
  return false;
}

function bulletText(line) {
  const c = line.charCodeAt(0);
  if ((c === 45 || c === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

function orderedOf(line) {
  let i = 0;
  while (i < line.length && i < 10) {
    const c = line.charCodeAt(i);
    if (c >= 48 && c <= 57) i++;
    else break;
  }
  if (i === 0 || i > 9) return null;
  if (line.charCodeAt(i) !== 46 || line.charCodeAt(i + 1) !== 32) return null;
  return { num: Number(line.slice(0, i)), text: line.slice(i + 2) };
}

function isContinued(line) {
  // /^ {2,}\S/
  if (line.charCodeAt(0) !== 32 || line.charCodeAt(1) !== 32) return false;
  let i = 2;
  while (i < line.length && line.charCodeAt(i) === 32) i++;
  if (i >= line.length) return false;
  return !isSpaceCode(line.charCodeAt(i));
}

function renderMarkdown(src, linkFn, slugMemo) {
  const lines = src.split('\n');
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const slug = (t) => {
    let v = slugMemo.get(t);
    if (v === undefined) { v = slugifyRaw(t); slugMemo.set(t, v); }
    return v;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) { i++; continue; }
    const lang = fenceLang(line);
    if (lang !== null) {
      const body = [];
      i++;
      while (i < lines.length && !isFenceClose(lines[i])) body.push(lines[i++]);
      i++;
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
      const parts = [`<pre><code${cls}>`];
      for (const l of body) parts.push(escapeHtml(l), '\n');
      parts.push('</code></pre>');
      blocks.push(parts.join(''));
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slug(heading.text), ids);
      const html = inline(heading.text, linkFn);
      blocks.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>`);
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++;
      continue;
    }
    if (isHr(line)) { blocks.push('<hr>'); i++; continue; }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (i < lines.length && lines[i].charCodeAt(0) === 62) {
        let l = lines[i++];
        l = l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1);
        l = trimLine(l);
        if (l !== '') body.push(l);
      }
      blocks.push(body.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(body.join('\n'), linkFn)}</p>\n</blockquote>`);
      continue;
    }
    const bt = bulletText(line);
    const od = bt === null ? orderedOf(line) : null;
    if (bt !== null || od !== null) {
      const isOrdered = od !== null;
      const items = [];
      let cur = null;
      while (i < lines.length) {
        const l = lines[i];
        let t = null;
        if (isOrdered) { const o = orderedOf(l); if (o !== null) t = o.text; }
        else t = bulletText(l);
        if (t !== null) {
          cur = [trimLine(t)];
          items.push(cur);
          i++;
        } else if (isContinued(l)) {
          cur.push(trimLine(l));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && od.num !== 1 ? `<ol start="${od.num}">` : `<${tag}>`;
      const parts = [`${open}\n`];
      for (const partsArr of items) parts.push('<li>', inline(partsArr.join('\n'), linkFn), '</li>\n');
      parts.push(`</${tag}>`);
      blocks.push(parts.join(''));
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      const fc = l.charCodeAt(0);
      if (isBlankLine(l)) break;
      if (fc === 96 && fenceLang(l) !== null) break;
      if (fc === 35 && headingOf(l) !== null) break;
      if ((fc === 45 || fc === 42) && isHr(l)) break;
      body.push(trimLine(l));
      i++;
    }
    const html = inline(body.join('\n'), linkFn);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  const hp = [];
  for (const b of blocks) hp.push(b, '\n');
  return { html: hp.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------- templates ----------------

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;
const INCLUDE_DEPTH = 8;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = isBlankLine(src.slice(lineStart, open)) && isBlankLine(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function prop(v, k) {
  if (v === null || typeof v !== 'object' || !Object.hasOwn(v, k)) return undefined;
  return v[k];
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function expandIncludes(nodes, trees, depth) {
  const out = [];
  for (const n of nodes) {
    if (n.kind === 'include') {
      const t = trees.get(n.name);
      if (t !== undefined && depth < INCLUDE_DEPTH) out.push(...expandIncludes(t, trees, depth + 1));
    } else if (n.kind === 'for') {
      out.push({ kind: 'for', name: n.name, path: n.path, body: expandIncludes(n.body, trees, depth) });
    } else if (n.kind === 'if') {
      out.push({ kind: 'if', not: n.not, path: n.path, then: expandIncludes(n.then, trees, depth), else: n.else === null ? null : expandIncludes(n.else, trees, depth) });
    } else out.push(n);
  }
  return out;
}

function needsLoop(nodes) {
  for (const n of nodes) {
    if ((n.kind === 'var' || n.kind === 'raw' || n.kind === 'if') && n.path[0] === 'loop') return true;
    if (n.kind === 'if' && (needsLoop(n.then) || (n.else !== null && needsLoop(n.else)))) return true;
    if (n.kind === 'for' && n.path[0] === 'loop') return true;
  }
  return false;
}

function compileTemplate(nodes) {
  const code = [];
  let uid = 0;
  const pathExpr = (path, scope) => {
    const first = path[0];
    let expr;
    if (first === 'loop' && scope.length > 0) {
      expr = scope[scope.length - 1].meta;
    } else {
      let found = null;
      for (let s = scope.length - 1; s >= 0; s--) {
        if (scope[s].name === first && first !== 'loop') { found = scope[s].elem; break; }
      }
      expr = found !== null ? found : `(Object.hasOwn(ctx,${JSON.stringify(first)})?ctx[${JSON.stringify(first)}]:undefined)`;
    }
    for (let k = 1; k < path.length; k++) expr = `prop(${expr},${JSON.stringify(path[k])})`;
    return expr;
  };
  const gen = (list, scope) => {
    for (const n of list) {
      switch (n.kind) {
        case 'text':
          code.push(`out.push(${JSON.stringify(n.text)});`);
          break;
        case 'var':
          code.push(`out.push(esc(textOf(${pathExpr(n.path, scope)})));`);
          break;
        case 'raw':
          code.push(`out.push(textOf(${pathExpr(n.path, scope)}));`);
          break;
        case 'if': {
          code.push(`if(truthy(${pathExpr(n.path, scope)})!==${n.not}){`);
          gen(n.then, scope);
          if (n.else !== null) { code.push('}else{'); gen(n.else, scope); }
          code.push('}');
          break;
        }
        case 'for': {
          const id = uid++;
          const arr = `_a${id}`;
          const idx = `_k${id}`;
          const elem = `_x${id}`;
          const meta = `_l${id}`;
          code.push(`{const ${arr}=${pathExpr(n.path, scope)};if(Array.isArray(${arr})){for(let ${idx}=0;${idx}<${arr}.length;${idx}++){const ${elem}=${arr}[${idx}];`);
          if (needsLoop(n.body)) code.push(`const ${meta}={index:${idx}+1,first:${idx}===0,last:${idx}===${arr}.length-1,length:${arr}.length};`);
          gen(n.body, [...scope, { name: n.name, elem, meta }]);
          code.push('}}}');
          break;
        }
      }
    }
  };
  gen(nodes, []);
  return new Function('ctx', 'out', 'prop', 'textOf', 'truthy', 'esc', code.join(''));
}

// ---------------- build pipeline ----------------

const REPORT_FILE = 'build-report.txt';
const RESERVED = ['posts', 'tags', 'page'];
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => {
  const k = path.lastIndexOf('/');
  return k === -1 ? '' : path.slice(0, k);
};

export function run(input) {
  const slugMemo = new Map();
  const slug = (t) => {
    let v = slugMemo.get(t);
    if (v === undefined) { v = slugifyRaw(t); slugMemo.set(t, v); }
    return v;
  };
  const dateMemo = new Map();
  const longDate = (d) => {
    let v = dateMemo.get(d);
    if (v === undefined) { v = longDateRaw(d); dateMemo.set(d, v); }
    return v;
  };

  const trees = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      trees.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const templates = new Map();
  const compiledOf = (name) => {
    let fn = templates.get(name);
    if (fn === undefined) {
      const tree = trees.get(name);
      if (tree === undefined) return undefined;
      fn = compileTemplate(expandIncludes(tree, trees, 0));
      templates.set(name, fn);
    }
    return fn;
  };
  const base = input.site.base_url.replace(/\/+$/, '');
  const sourcesAll = [];
  const statics = [];
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const text = f.content.includes('\r') ? f.content.replace(/\r\n?/g, '\n') : f.content;
      sourcesAll.push({ path: f.path, text });
    } else statics.push({ path: f.path, content: f.content });
  }

  // front matter
  const sources = [];
  for (const s of sourcesAll) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) { report.push(`refused ${s.path}: ${fm.error}`); continue; }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) { report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { report.push(`refused ${s.path}: a post needs a date`); continue; }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!trees.has(layout)) { report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
    s.layout = layout;
    if (s.data.draft === true) { report.push(`draft ${s.path}`); continue; }
    sources.push(s);
  }

  // permalinks
  const taken = new Map();
  const bySource = new Map();
  for (const s of sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) { set = new Set(dir === '' ? RESERVED : []); taken.set(dir, set); }
    s.slug = uniqueSlug(s.data.slug ?? slug(s.data.title), set);
    s.outDir = dir === '' ? s.slug : `${dir}/${s.slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // markdown
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  const resolveMemo = new Map();
  for (const s of sources) {
    const dir = dirOf(s.path);
    const linkFn = (target) => {
      if (SCHEME_RE.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      let path = null;
      if (rel !== '') {
        const key = dir + '\n' + rel;
        path = resolveMemo.get(key);
        if (path === undefined) { path = resolvePath(dir, rel); resolveMemo.set(key, path); }
      }
      if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
      broken.add(`broken-link ${s.path} -> ${target}`);
      return target;
    };
    const md = renderMarkdown(s.body, linkFn, slugMemo);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // collections
  const posts = sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const sl = slug(name);
      if (!seen.has(sl)) { seen.add(sl); out.push(name); }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const sl = slug(name);
      let tag = bySlug.get(sl);
      if (tag === undefined) { tag = { name, slug: sl, url: `${base}/tags/${sl}/`, posts: [] }; bySlug.set(sl, tag); }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of sources) {
    if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slug(name)) ?? { name, slug: slug(name), url: '', posts: [] });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const cardCache = new Map();
  const cardOf = (s) => {
    let card = cardCache.get(s);
    if (card === undefined) {
      card = {
        title: s.data.title,
        url: s.url,
        date: s.data.date ?? '',
        date_long: s.data.date === undefined ? '' : longDate(s.data.date),
        summary: s.data.summary ?? '',
        excerpt: s.excerpt,
        reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
        tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
      };
      cardCache.set(s, card);
    }
    return card;
  };
  const pageOf = (s) => ({
    ...cardOf(s),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });

  const cards = new Map(posts.map((p) => [p, cardOf(p)]));
  const tagOf = (t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) });
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const output = {};
  const render = (name, vars) => {
    const fn = compiledOf(name);
    if (fn === undefined) return null;
    const out = [];
    fn({ site, tags: allTags, recent, ...vars }, out, prop, textOf, truthy, escapeHtml);
    return out.join('');
  };
  for (const s of sources) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: tagOf(t) });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = sources.filter((s) => !s.post).length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return output;
}
