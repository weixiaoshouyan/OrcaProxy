// frontend/src/components/Skeleton.tsx
// 通用骨架屏组件 - 提升首屏与切换体验
import React from 'react';

export function Skeleton({ className = '', rounded = 'md' }: { className?: string; rounded?: 'sm' | 'md' | 'lg' | 'full' }) {
  const r = { sm: 'rounded', md: 'rounded-md', lg: 'rounded-xl', full: 'rounded-full' }[rounded];
  return <div className={`animate-pulse bg-[var(--color-bg-hover)]/60 ${r} ${className}`} />;
}

export function SkeletonText({ lines = 3, lastWidth = '60%' }: { lines?: number; lastWidth?: string }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          // @ts-ignore
          style={i === lines - 1 ? { width: lastWidth } : undefined}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ children }: { children?: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl p-5 animate-pulse">
      {children || (
        <div className="space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <SkeletonText lines={2} />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-8 w-20" rounded="lg" />
            <Skeleton className="h-8 w-20" rounded="lg" />
          </div>
        </div>
      )}
    </div>
  );
}

// 页面级骨架
export function PageSkeleton() {
  return (
    <div className="p-8 space-y-4 animate-pulse">
      <Skeleton className="h-8 w-48" rounded="lg" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-3 gap-4 pt-4">
        <SkeletonCard><SkeletonText lines={3} /></SkeletonCard>
        <SkeletonCard><SkeletonText lines={3} /></SkeletonCard>
        <SkeletonCard><SkeletonText lines={3} /></SkeletonCard>
      </div>
      <Skeleton className="h-64 w-full mt-4" rounded="lg" />
    </div>
  );
}

// 聊天消息骨架
export function SkeletonMessage() {
  return (
    <div className="flex gap-3 p-4 animate-pulse">
      <Skeleton className="w-8 h-8 shrink-0" rounded="full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-24" />
        <SkeletonText lines={3} lastWidth="80%" />
      </div>
    </div>
  );
}
