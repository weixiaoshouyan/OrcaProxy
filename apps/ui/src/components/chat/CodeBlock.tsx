/**
 * CodeBlock — syntax-highlighted code block with line numbers + copy button.
 * (Lightweight tokenizer; code always sits on the dark code-bg.)
 */
import { useState } from 'react';
import type { Language } from '../../i18n';

const SYNTAX_KW: Record<string, string[]> = {
  js: ['const','let','var','function','return','if','else','for','while','class','import','export','from','default','async','await','new','this','try','catch','throw','typeof','instanceof','switch','case','break','continue','do','in','of','yield','null','undefined','true','false','void','delete','super','extends','static','get','set'],
  ts: ['const','let','var','function','return','if','else','for','while','class','import','export','from','default','async','await','new','this','try','catch','throw','typeof','instanceof','switch','case','type','interface','enum','implements','extends','abstract','readonly','private','public','protected','as','is','keyof','infer','never','unknown','any','null','undefined','true','false','void','declare'],
  py: ['def','class','import','from','return','if','elif','else','for','while','try','except','finally','with','as','in','not','and','or','is','True','False','None','pass','break','continue','yield','lambda','raise','global','nonlocal','assert','del','async','await','self','print'],
  go: ['func','package','import','var','const','type','struct','interface','return','if','else','for','range','switch','case','default','go','defer','chan','map','select','make','new','append','len','nil','true','false','break','continue','fallthrough'],
  rs: ['fn','let','mut','const','if','else','for','while','loop','match','return','struct','enum','impl','trait','pub','use','mod','self','super','crate','async','await','move','ref','type','where','true','false','Some','None','Ok','Err','unsafe','extern','static'],
  java: ['public','private','protected','static','final','class','interface','extends','implements','return','if','else','for','while','try','catch','throw','throws','new','import','package','void','int','long','double','float','boolean','char','String','null','true','false','this','super','abstract','synchronized'],
  sh: ['if','then','else','elif','fi','for','while','do','done','case','esac','function','return','exit','echo','export','source','local','readonly','shift','set','unset','trap','eval','exec','cd','pwd','ls','cat','grep','sed','awk','find','sudo','chmod','mkdir','rm','cp','mv'],
  css: ['color','background','margin','padding','border','font','display','position','width','height','top','left','right','bottom','flex','grid','align','justify','transform','transition','animation','opacity','overflow','z-index','cursor','box-shadow'],
};
const KW_ALIAS: Record<string, string> = { javascript: 'js', typescript: 'ts', python: 'py', golang: 'go', rust: 'rs', bash: 'sh', shell: 'sh', jsx: 'js', tsx: 'ts', powershell: 'sh', scss: 'css', less: 'css' };

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function tokenizeCode(code: string, lang?: string): string {
  const normLang = KW_ALIAS[lang || ''] || lang || '';
  const keywords = SYNTAX_KW[normLang] || SYNTAX_KW['js'] || [];
  let html = '';
  let i = 0;
  while (i < code.length) {
    if (code[i] === '/' && code[i + 1] === '/') {
      let end = code.indexOf('\n', i);
      if (end === -1) end = code.length;
      html += `<span class="hl-cmt">${esc(code.slice(i, end))}</span>`;
      i = end;
    } else if (code[i] === '#' && (normLang === 'py' || normLang === 'sh') && (i === 0 || code[i - 1] === '\n')) {
      let end = code.indexOf('\n', i);
      if (end === -1) end = code.length;
      html += `<span class="hl-cmt">${esc(code.slice(i, end))}</span>`;
      i = end;
    } else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const q = code[i]; let j = i + 1;
      while (j < code.length && code[j] !== q) { if (code[j] === '\\') j++; j++; }
      html += `<span class="hl-str">${esc(code.slice(i, Math.min(j + 1, code.length)))}</span>`;
      i = j + 1;
    } else if (/[0-9]/.test(code[i]) && (i === 0 || !/[a-zA-Z_$]/.test(code[i - 1]))) {
      let j = i;
      while (j < code.length && /[0-9.xXa-fA-FeE_]/.test(code[j])) j++;
      html += `<span class="hl-num">${esc(code.slice(i, j))}</span>`;
      i = j;
    } else if (/[a-zA-Z_$]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (keywords.includes(word)) html += `<span class="hl-kw">${esc(word)}</span>`;
      else html += esc(word);
      i = j;
    } else {
      html += esc(code[i]); i++;
    }
  }
  return html;
}

export function CodeBlock({ content, language, highlightLine, lang }: { content: string; language?: string; highlightLine?: number; lang: Language }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const lines = content.split('\n');
  const lineCount = lines.length;
  const highlighted = lineCount <= 500 ? tokenizeCode(content, language) : esc(content);
  const lineNumWidth = String(lineCount).length;

  return (
    <div className="my-4 border border-[var(--color-border-base)] rounded-xl overflow-hidden shadow-[var(--shadow-xs)] bg-[var(--color-code-bg)] font-mono text-[13px] leading-relaxed code-block-container">
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-bg-card)]/90 text-xs border-b border-[var(--color-border-base)] select-none">
        <div className="flex items-center gap-3">
          <span className="font-semibold uppercase tracking-wider text-[var(--color-primary)]">{language || 'code'}</span>
          <span className="text-[10px] opacity-60 text-[var(--color-text-muted)]">{lineCount} {lang === 'en' ? 'lines' : '行'}</span>
        </div>
        <button onClick={handleCopy} className="flex items-center gap-1 hover:text-[var(--color-primary)] transition-colors px-2 py-1 rounded border border-[var(--color-border-base)] bg-[var(--color-bg-hover)]/50 text-[11px] font-semibold cursor-pointer text-[var(--color-text-secondary)]">
          {copied ? (lang === 'en' ? 'Copied!' : '已复制') : (lang === 'en' ? 'Copy' : '复制')}
        </button>
      </div>
      <div className="flex overflow-x-auto max-h-[500px]">
        {/* Line numbers gutter */}
        <div className="shrink-0 select-none text-right pr-3 pl-3 py-4 bg-black/20 dark:bg-white/5 text-[11px] leading-relaxed text-[var(--color-text-muted)] border-r border-[var(--color-border-base)] font-mono">
          {lines.map((_, i) => (
            <div
              key={i}
              className={`${highlightLine === i + 1 ? 'text-[var(--color-primary)] font-bold' : ''}`}
              style={{ minWidth: `${lineNumWidth + 1}ch` }}
            >
              {i + 1}
            </div>
          ))}
        </div>
        {/* Code */}
        <pre className="p-4 whitespace-pre text-[var(--color-code-fg)] min-w-0 flex-1">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>
    </div>
  );
}
