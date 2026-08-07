// frontend/src/components/Pagination.tsx
// 通用分页组件 - 替代各页面重复实现
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationProps {
  current: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  showSizeChanger?: boolean;
  className?: string;
  compact?: boolean; // 紧凑模式：用于 Chat 等狭窄场景
}

export function Pagination({
  current,
  total,
  pageSize,
  onChange,
  onPageSizeChange,
  pageSizeOptions = [5, 10, 20, 50],
  showSizeChanger = true,
  className = '',
  compact = false,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  // 页码省略：超过 7 页时折叠
  const pageNumbers = React.useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (current > 4) pages.push('ellipsis');
      const start = Math.max(2, current - 1);
      const end = Math.min(totalPages - 1, current + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (current < totalPages - 3) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  }, [current, totalPages]);

  if (compact) {
    return (
      <div className={`flex items-center justify-between text-xs font-bold text-[var(--color-text-secondary)] select-none ${className}`}>
        <span>共 {total}</span>
        <div className="flex items-center gap-1">
          <button
            disabled={current === 1}
            onClick={() => onChange(Math.max(1, current - 1))}
            className="p-1 rounded border border-[var(--color-border-base)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-40 disabled:hover:border-[var(--color-border-base)] disabled:hover:text-[var(--color-text-secondary)] disabled:cursor-not-allowed transition-all"
            aria-label="Previous"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 tabular-nums">{current} / {totalPages}</span>
          <button
            disabled={current === totalPages}
            onClick={() => onChange(Math.min(totalPages, current + 1))}
            className="p-1 rounded border border-[var(--color-border-base)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-40 disabled:hover:border-[var(--color-border-base)] disabled:hover:text-[var(--color-text-secondary)] disabled:cursor-not-allowed transition-all"
            aria-label="Next"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between select-none text-xs font-bold text-[var(--color-text-secondary)] ${className}`}>
      <div>共 {total} 条</div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            disabled={current === 1}
            onClick={() => onChange(Math.max(1, current - 1))}
            className="p-1.5 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          {pageNumbers.map((p, i) => p === 'ellipsis' ? (
            <span key={`e-${i}`} className="px-1 text-[var(--color-text-muted)]">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`min-w-[28px] h-7 rounded-lg border text-center flex items-center justify-center transition-all ${
                current === p
                  ? 'bg-blue-500 border-blue-500 text-white shadow-sm font-bold'
                  : 'border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            disabled={current === totalPages}
            onClick={() => onChange(Math.min(totalPages, current + 1))}
            className="p-1.5 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        {showSizeChanger && onPageSizeChange && (
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            className="appearance-none bg-[var(--color-bg-card)] dark:bg-slate-900 border border-[var(--color-border-base)] rounded-lg pl-2.5 pr-6 py-1 font-bold text-[var(--color-text-primary)] cursor-pointer focus:outline-none hover:border-[var(--color-primary)] transition-all"
            aria-label="Page size"
          >
            {pageSizeOptions.map(s => (
              <option key={s} value={s} className="dark:bg-slate-900">{s} 条/页</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
