import { useEffect, useState } from 'react';
import { searchCode, indexCode, type CodeSearchResult } from '../api';
import { Search, RefreshCw, FileCode, AlertCircle, Loader2 } from 'lucide-react';
import { getLanguage } from '../i18n';

export default function CodeSearchPage() {
  const lang = getLanguage();
  const [workspace, setWorkspace] = useState('');
  const [query, setQuery] = useState('');
  const [strategy, setStrategy] = useState<'hybrid' | 'keyword' | 'embedding'>('hybrid');
  const [limit, setLimit] = useState(10);
  const [results, setResults] = useState<CodeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setWorkspace(localStorage.getItem('orca_workspace') || 'd:/A_vibecoding/orca');
  }, []);

  const handleSearch = async () => {
    if (!query.trim() || !workspace.trim()) return;
    setLoading(true);
    setMessage('');
    try {
      const data = await searchCode(workspace, query, limit, strategy);
      setResults(data.results);
      if (data.results.length === 0) {
        setMessage(lang === 'en' ? 'No results found.' : '未找到结果。');
      }
    } catch (e: unknown) {
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleIndex = async () => {
    if (!workspace.trim()) return;
    setIndexing(true);
    setMessage('');
    try {
      const data = await indexCode(workspace);
      setMessage(`${lang === 'en' ? 'Indexed' : '已索引'} ${data.chunks} chunks`);
    } catch (e: unknown) {
      setMessage(String(e));
    } finally {
      setIndexing(false);
    }
  };

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
            <Search className="w-6 h-6 text-[var(--color-primary)]" />
            {lang === 'en' ? 'Code Search' : '代码检索'}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {lang === 'en'
              ? 'Keyword + embedding hybrid search across the active workspace.'
              : '在活动工作区进行关键词与 embedding 混合检索。'}
          </p>
        </div>

        {message && (
          <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-lg ${message.includes('error') || message.includes('失败') || message.includes('No results') || message.includes('未找到') ? 'bg-yellow-500/10 text-yellow-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
            <AlertCircle className="w-4 h-4" />
            {message}
          </div>
        )}

        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-5 space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">Workspace</label>
              <input
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
              />
            </div>
            <div className="md:col-span-4 space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">{lang === 'en' ? 'Query' : '查询'}</label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={lang === 'en' ? 'e.g. authentication logic' : '例如：authentication logic'}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
              />
            </div>
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">{lang === 'en' ? 'Strategy' : '策略'}</label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as 'hybrid' | 'keyword' | 'embedding')}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
              >
                <option value="hybrid">Hybrid</option>
                <option value="keyword">Keyword</option>
                <option value="embedding">Embedding</option>
              </select>
            </div>
            <div className="md:col-span-1 space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">Limit</label>
              <input
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSearch}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {lang === 'en' ? 'Search' : '搜索'}
            </button>
            <button
              onClick={handleIndex}
              disabled={indexing}
              className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] rounded-lg text-sm font-medium hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              {indexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {lang === 'en' ? 'Rebuild Index' : '重建索引'}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {results.map((r, i) => (
            <div
              key={`${r.filePath}:${r.startLine}:${i}`}
              className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-base)] bg-[var(--color-bg-hover)]">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                  <FileCode className="w-4 h-4 text-[var(--color-primary)]" />
                  {r.filePath}
                  <span className="text-[var(--color-text-muted)] text-xs">
                    {r.startLine + 1}-{r.endLine + 1}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <span className="px-2 py-0.5 rounded bg-[var(--color-bg-base)]">{r.language}</span>
                  <span className="px-2 py-0.5 rounded bg-[var(--color-bg-base)]">{r.type}</span>
                  <span className="px-2 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                    score {r.score.toFixed(3)}
                  </span>
                </div>
              </div>
              <pre className="p-4 text-xs overflow-auto max-h-80 text-[var(--color-text-secondary)] bg-[var(--color-bg-base)]">
                {r.content}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
