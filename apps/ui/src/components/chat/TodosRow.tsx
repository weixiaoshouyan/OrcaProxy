/**
 * TodosRow — compact "📋 任务 2/6 ⏳ 当前步骤" progress row from a
 * `> 📋 Todos [n/m] ⏳ ...` transcript line.
 */
import { ListTodo } from 'lucide-react';
import type { Language } from '../../i18n';

export function TodosRow({ content, lang }: { content: string; lang: Language }) {
  const m = content.match(/📋\s*Todos\s*\[(\d+)\/(\d+)\]\s*([⏳✅❌]?)\s*(.*)/);
  const done = m ? parseInt(m[1], 10) : null;
  const total = m ? parseInt(m[2], 10) : null;
  const current = m ? m[4].trim() : '';
  return (
    <div className="flex items-center gap-2.5 py-1 px-1 text-[11px] text-[var(--color-text-muted)] select-none">
      <ListTodo className="w-3.5 h-3.5 shrink-0 text-[var(--color-primary)]" />
      <span>
        {lang === 'en' ? 'Todos' : '任务'} {done !== null && total !== null ? `${done}/${total}` : ''}
      </span>
      {current && <span className="truncate">{current}</span>}
    </div>
  );
}
