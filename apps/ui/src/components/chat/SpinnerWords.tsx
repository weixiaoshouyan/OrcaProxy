/**
 * SpinnerWords — rotating "工作中/思考中/…" status word while streaming.
 */
import { useEffect, useState } from 'react';
import type { Language } from '../../i18n';

export function SpinnerWords({ lang }: { lang: Language }) {
  const words = lang === 'en'
    ? ['Working', 'Thinking', 'Planning', 'Executing', 'Inspecting', 'Reasoning', 'Writing', 'Searching', 'Fixing', 'Running', 'Gathering', 'Refining']
    : ['工作中', '思考中', '规划中', '执行中', '检查中', '推理中', '写入中', '搜索中', '修复中', '运行中', '收集中', '完善中'];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % words.length), 1200);
    return () => clearInterval(t);
  }, [words.length]);
  return <span className="min-w-[6ch] inline-block text-[var(--color-text-muted)]">{words[idx]}…</span>;
}
