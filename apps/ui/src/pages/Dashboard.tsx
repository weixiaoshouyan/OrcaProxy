import { useState, useEffect, useRef } from 'react';
import { Zap, Key, Activity, Sparkles, BarChart2, List, Calendar, ChevronDown, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { translate as t } from '../i18n';
import type { Language } from '../i18n';
import * as echarts from 'echarts';
import { Pagination } from '../components/Pagination';
import type { RequestStats, BillingData, BillingDayEntry, BillingTableRow } from '../types';

/** ECharts tooltip formatter parameter item */
interface TooltipParam {
  seriesName?: string;
  value: number;
  color?: string;
  marker?: string;
  name?: string;
  axisValue?: string;
}

/** Read theme-aware CSS variable values from the root element */
function readThemeColors(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  return {
    textPrimary: s.getPropertyValue('--color-text-primary').trim() || '#0f172a',
    textSecondary: s.getPropertyValue('--color-text-secondary').trim() || '#475569',
    bgCard: s.getPropertyValue('--color-bg-card').trim() || '#ffffff',
    bgHover: s.getPropertyValue('--color-bg-hover').trim() || '#e2e8f0',
    border: s.getPropertyValue('--color-border-base').trim() || '#e2e8f0',
    bgSidebar: s.getPropertyValue('--color-bg-sidebar').trim() || '#f1f5f9',
  };
}

const getTokenValue = (val: number | BillingDayEntry): number => {
  if (typeof val === 'number') return val;
  if (val && typeof val === 'object') return val.total || 0;
  return 0;
};

interface DashboardProps {
  lang: Language;
}

export default function Dashboard({ lang }: DashboardProps) {
  const [stats, setStats] = useState<RequestStats>({ totalRequests: 0, interceptedRequests: 0, tokens: 0, totalTokens: 0, totalCost: 0 });
  const [billingData, setBillingData] = useState<BillingData>({});
  const [viewType, setViewType] = useState<'chart' | 'list'>('chart');
  const [timeUnit, setTimeUnit] = useState<'year' | 'month'>('month');
  const [displayMode, setDisplayMode] = useState<'total' | 'single'>('total');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const [themeChanged, setThemeChanged] = useState(0);
  const [activeModelIds, setActiveModelIds] = useState<Set<string>>(new Set());

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<string>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  // 手动刷新：点击刷新按钮时自增，触发下方轮询 effect 重新拉取数据
  const [refreshTick, setRefreshTick] = useState(0);

  const chartRef = useRef<HTMLDivElement>(null);
  const horizontalChartRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  // 图表实例引用 - 由统一的 cleanup effect 管理，避免重复 dispose
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const hChartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMonth, timeUnit]);

  const getTableData = (): BillingTableRow[] => {
    const rows: BillingTableRow[] = [];
    Object.entries(billingData).forEach(([dateStr, dayData]) => {
      const matchesPeriod = timeUnit === 'year'
        ? dateStr.startsWith(selectedMonth.slice(0, 4))
        : dateStr.startsWith(selectedMonth);

      if (matchesPeriod) {
        Object.entries(dayData).forEach(([model, val]) => {
          if (activeModelIds.size === 0 || activeModelIds.has(model)) {
            let total = 0;
            let cached = 0;
            let uncached = 0;

            if (typeof val === 'number') {
              total = val;
              cached = 0;
              uncached = val;
            } else if (val && typeof val === 'object') {
              total = val.total || 0;
              cached = val.cached || 0;
              uncached = val.uncached || 0;
            }

            rows.push({ date: dateStr, model, total, cached, uncached });
          }
        });
      }
    });
    return rows;
  };

  const rawTableRows = getTableData();

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  const sortedTableRows = [...rawTableRows].sort((a, b) => {
    const valA = a[sortField as keyof BillingTableRow];
    const valB = b[sortField as keyof BillingTableRow];
    if (typeof valA === 'string') {
      return sortDirection === 'asc' ? valA.localeCompare(valB as string) : (valB as string).localeCompare(valA);
    } else {
      return sortDirection === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    }
  });

  const totalCount = sortedTableRows.length;
  const paginatedRows = sortedTableRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Poll stats and logs with exponential backoff on failure
  useEffect(() => {
    let mounted = true;
    let consecutiveErrors = 0;
    let currentInterval = 5000;
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleNext = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(fetchData, currentInterval);
    };

    const fetchData = () => {
      Promise.allSettled([
        api.get('/api/stats'),
        api.get('/api/billing-history'),
        api.get('/api/providers'),
      ]).then((results) => {
        if (!mounted) return;
        // Process results individually
        results[0].status === 'fulfilled'
          ? setStats(results[0].value.data)
          : console.error('Stats fetch failed');

        results[1].status === 'fulfilled'
          ? setBillingData(results[1].value.data)
          : console.error('Billing fetch failed');

        if (results[2].status === 'fulfilled') {
          const data = results[2].value.data;
          const activeIds = new Set<string>();
          data.forEach((p: { id: string; configured: boolean; models: { id: string }[] }) => {
            if (p.configured) p.models.forEach(m => {
              // Billing keys are provider-qualified since qualifyModel
              // ("opencode/deepseek-v4-flash"); match both the qualified key
              // and the legacy bare id so rows are never silently dropped.
              activeIds.add(m.id);
              activeIds.add(m.id.includes('/') ? m.id : `${p.id}/${m.id}`);
            });
          });
          setActiveModelIds(activeIds);
        }

        // Adjust polling interval based on success/failure
        const allFailed = results.every(r => r.status === 'rejected');
        if (allFailed) {
          consecutiveErrors++;
          // 5s -> 10s -> 20s -> 30s (capped)
          currentInterval = Math.min(5000 * Math.pow(2, consecutiveErrors), 30000);
        } else {
          consecutiveErrors = 0;
          currentInterval = 5000;
        }

        scheduleNext();
      });
    };

    fetchData();
    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [refreshTick]);

  // Listen to theme changes to redraw ECharts
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeChanged(prev => prev + 1);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Listen for clicks outside the calendar dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setMonthMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 动态获取有数据的期间列表（月份或年份）
  const getAvailablePeriods = () => {
    const periods = new Set<string>();
    const today = new Date();
    
    if (timeUnit === 'year') {
      periods.add(String(today.getFullYear()));
      Object.keys(billingData).forEach(dateStr => {
        const y = dateStr.slice(0, 4);
        if (y.match(/^\d{4}$/)) {
          periods.add(y);
        }
      });
    } else {
      const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
      periods.add(currentMonthStr);
      Object.keys(billingData).forEach(dateStr => {
        const m = dateStr.slice(0, 7);
        if (m.match(/^\d{4}-\d{2}$/)) {
          periods.add(m);
        }
      });
    }
    return Array.from(periods).sort().reverse();
  };

  const handlePeriodSelect = (p: string) => {
    if (timeUnit === 'year') {
      const currentMonthPart = selectedMonth.slice(5, 7) || '06';
      setSelectedMonth(`${p}-${currentMonthPart}`);
    } else {
      setSelectedMonth(p);
    }
    setMonthMenuOpen(false);
  };

  // 根据“年”或“月”维度准备 X 轴数据
  const [yearStr, monthStr] = selectedMonth.split('-');
  const selectedYear = parseInt(yearStr);
  const selectedMonthNum = parseInt(monthStr);

  const getChartXAxis = () => {
    if (timeUnit === 'year') {
      // 显示该年份的 12 个月
      return Array.from({ length: 12 }, (_, i) => `${selectedYear}-${String(i + 1).padStart(2, '0')}`);
    } else {
      // 显示该月份的每日日期
      return getDaysInMonth(selectedYear, selectedMonthNum);
    }
  };

  const days = getChartXAxis();

  // Extract all models from data to build series (filtered by active model IDs)
  const allModelsSet = new Set<string>();
  Object.values(billingData).forEach((dayData) => {
    Object.keys(dayData).forEach(model => {
      if (activeModelIds.size === 0 || activeModelIds.has(model)) {
        allModelsSet.add(model);
      }
    });
  });
  const modelsList = Array.from(allModelsSet);

  // Default color palette for models (sleek HSL hues)
  const modelColors: Record<string, string> = {
    'mimo-v2.5': '#14b8a6', // Teal
    'mimo-v2.5-pro': '#3b82f6', // Blue
    'mimo-v2-omni': '#06b6d4', // Cyan
    'deepseek-chat': '#8b5cf6', // Violet
    'deepseek-coder': '#ec4899', // Pink
    'gpt-4o': '#f59e0b', // Amber
    'claude-3-5-sonnet': '#ef4444', // Red
  };

  const getModelColor = (model: string, index: number) => {
    if (modelColors[model]) return modelColors[model];
    // fallback color based on index
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#38bdf8', '#a855f7'];
    return colors[index % colors.length];
  };

  // 统一的 cleanup effect - 仅在组件卸载时 dispose 两个图表实例，避免重复 dispose
  useEffect(() => {
    return () => {
      if (chartInstanceRef.current && !chartInstanceRef.current.isDisposed()) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
      if (hChartInstanceRef.current && !hChartInstanceRef.current.isDisposed()) {
        hChartInstanceRef.current.dispose();
        hChartInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const c = readThemeColors();

    // 使用 ref 管理实例 - 仅首次 init，后续依赖变化只更新 option（避免 dispose 重建循环
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const myChart = chartInstanceRef.current;

    try {
      if (viewType === 'chart') {
        const gridBorderColor = c.bgHover;
        const splitLineColor = c.bgHover;

        // Build series data
        const lineSeriesList = modelsList.map((model, idx) => {
          const data = days.map(day => {
            if (timeUnit === 'year') {
              let sum = 0;
              Object.entries(billingData).forEach(([dateStr, dayData]) => {
                if (dateStr.startsWith(day)) {
                  sum += getTokenValue(dayData[model]);
                }
              });
              return sum;
            } else {
              return getTokenValue(billingData[day]?.[model]);
            }
          });

          const color = getModelColor(model, idx);
          return {
            name: model,
            type: 'line' as const,
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            showSymbol: true,
            itemStyle: {
              color: color,
              borderColor: '#ffffff',
              borderWidth: 1.5
            },
            lineStyle: {
              width: 2.5,
              color: color
            },
            data
          };
        });

        const lineData = days.map(day => {
          let sum = 0;
          modelsList.forEach(model => {
            if (timeUnit === 'year') {
              Object.entries(billingData).forEach(([dateStr, dayData]) => {
                if (dateStr.startsWith(day)) {
                  sum += getTokenValue(dayData[model]);
                }
              });
            } else {
              sum += getTokenValue(billingData[day]?.[model]);
            }
          });
          return sum;
        });

        const lineSeries = {
          name: 'Token 总消耗',
          type: 'line' as const,
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: true,
          itemStyle: {
            color: '#3b82f6',
            borderColor: '#ffffff',
            borderWidth: 2
          },
          lineStyle: {
            width: 3,
            color: '#3b82f6',
            shadowColor: 'rgba(59, 130, 246, 0.3)',
            shadowBlur: 8,
            shadowOffsetY: 4
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(59, 130, 246, 0.15)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0)' }
            ])
          },
          data: lineData
        };

        const series = displayMode === 'total' ? [...lineSeriesList, lineSeries] : lineSeriesList;

        const option: echarts.EChartsOption = {
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            axisPointer: {
              type: 'shadow'
            },
            backgroundColor: c.bgCard,
            borderColor: c.border,
            borderWidth: 1,
            textStyle: {
              color: c.textPrimary,
              fontFamily: 'system-ui',
              fontSize: 12
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (params: any) => {
              const p = params as TooltipParam[];
              let date = p[0]?.axisValue || '';
              let tooltipHtml = `<div style="font-weight: 700; margin-bottom: 8px; font-size: 13px; color: ${c.textPrimary};">${date}</div>`;

              const lineItem = p.find((item) => item.seriesName === 'Token 总消耗');
              const barItems = p.filter((item) => item.seriesName !== 'Token 总消耗');

              const sortedParams: TooltipParam[] = [];
              if (lineItem && displayMode === 'total') {
                sortedParams.push(lineItem);
              }
              sortedParams.push(...barItems);

              sortedParams.forEach((item) => {
                const val = item.value || 0;
                const color = item.color;
                tooltipHtml += `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-top: 4px; font-size: 12px;">
                      <span style="display: flex; align-items: center; gap: 6px; color: ${c.textSecondary};">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${color};"></span>
                        ${item.seriesName}
                      </span>
                      <span style="font-weight: 700; color: ${c.textPrimary}; font-family: monospace;">${val.toLocaleString()}</span>
                    </div>
                  `;
              });

              return tooltipHtml;
            }
          },
          legend: {
            show: false,
          },
          grid: {
            top: '8%',
            left: '2%',
            right: '2%',
            bottom: '5%',
            containLabel: true
          },
          xAxis: {
            type: 'category',
            data: days,
            axisLine: {
              lineStyle: {
                color: gridBorderColor
              }
            },
            axisLabel: {
              color: c.textPrimary,
              fontSize: 10,
              fontFamily: 'monospace',
              interval: timeUnit === 'year' ? 0 : 2
            },
            axisTick: {
              show: false
            }
          },
          yAxis: {
            type: 'value',
            splitLine: {
              lineStyle: {
                color: splitLineColor,
                type: 'dashed'
              }
            },
            axisLabel: {
              color: c.textPrimary,
              fontSize: 10,
              fontFamily: 'monospace',
              formatter: (value: number) => {
                if (value === 0) return '0';
                return (value / 1000) + 'k';
              }
            }
          },
          series
        };

        myChart.setOption(option, true);

        setTimeout(() => {
          if (!myChart.isDisposed()) myChart.resize();
        }, 50);
      }
    } catch (e) {
      console.error("Failed to render vertical chart:", e);
    }

    // 监听窗口 resize
    const handleResize = () => {
      if (chartInstanceRef.current && !chartInstanceRef.current.isDisposed()) {
        chartInstanceRef.current.resize();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [viewType, billingData, days, displayMode, themeChanged, timeUnit, modelsList]);

  // Horizontal Chart Effect Hook for List View
  useEffect(() => {
    if (!horizontalChartRef.current) return;
    const c = readThemeColors();

    if (!hChartInstanceRef.current) {
      hChartInstanceRef.current = echarts.init(horizontalChartRef.current);
    }
    const myChart = hChartInstanceRef.current;

    try {
      if (viewType === 'list') {
        const gridBorderColor = c.bgHover;
        const splitLineColor = c.bgHover;

        const modelTotals: Record<string, number> = {};
        modelsList.forEach(model => {
          modelTotals[model] = 0;
        });

        days.forEach(day => {
          modelsList.forEach(model => {
            if (timeUnit === 'year') {
              Object.entries(billingData).forEach(([dateStr, dayData]) => {
                if (dateStr.startsWith(day)) {
                  modelTotals[model] += getTokenValue(dayData[model]);
                }
              });
            } else {
              modelTotals[model] += getTokenValue(billingData[day]?.[model]);
            }
          });
        });

        const sortedModels = modelsList
          .map((model, idx) => ({
            model,
            total: modelTotals[model],
            color: getModelColor(model, idx)
          }))
          .filter(item => item.total > 0)
          .sort((a, b) => a.total - b.total);

        if (sortedModels.length > 0) {
          const option: echarts.EChartsOption = {
            backgroundColor: 'transparent',
            tooltip: {
              trigger: 'axis',
              axisPointer: { type: 'shadow' },
              backgroundColor: c.bgCard,
              borderColor: c.border,
              borderWidth: 1,
              textStyle: {
                color: c.textPrimary,
                fontFamily: 'system-ui',
                fontSize: 12
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter: (params: any) => {
                const p = params as TooltipParam[];
                const item = p[0];
                return `
                  <div style="font-weight: 700; margin-bottom: 4px; font-size: 13px; color: ${c.textPrimary};">${item.name}</div>
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 12px;">
                    <span style="display: flex; align-items: center; gap: 6px; color: ${c.textSecondary};">
                      <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${item.color};"></span>
                      总消耗
                    </span>
                    <span style="font-weight: 700; color: ${c.textPrimary}; font-family: monospace;">${item.value.toLocaleString()} Tokens</span>
                  </div>
                `;
              }
            },
            grid: {
              top: '5%',
              left: '3%',
              right: '8%',
              bottom: '5%',
              containLabel: true
            },
            xAxis: {
              type: 'value',
              splitLine: {
                lineStyle: {
                  color: splitLineColor,
                  type: 'dashed'
                }
              },
              axisLabel: {
                color: c.textPrimary,
                fontSize: 10,
                fontFamily: 'monospace'
              }
            },
            yAxis: {
              type: 'category',
              data: sortedModels.map(item => item.model),
              axisLine: {
                lineStyle: { color: gridBorderColor }
              },
              axisLabel: {
                color: c.textPrimary,
                fontSize: 11,
                fontFamily: 'monospace'
              },
              axisTick: { show: false }
            },
            series: [
              {
                type: 'bar',
                data: sortedModels.map(item => ({
                  value: item.total,
                  itemStyle: { color: item.color, borderRadius: [0, 4, 4, 0] }
                })),
                barWidth: '40%',
                label: {
                  show: true,
                  position: 'right',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter: (params: any) => (params as TooltipParam).value.toLocaleString(),
                  color: c.textPrimary,
                  fontSize: 10,
                  fontFamily: 'monospace'
                }
              }
            ]
          };

          myChart.setOption(option, true);
          setTimeout(() => {
            if (!myChart.isDisposed()) myChart.resize();
          }, 50);
        }
      }
    } catch (e) {
      console.error("Failed to render horizontal chart:", e);
    }

    const handleResize = () => {
      if (hChartInstanceRef.current && !hChartInstanceRef.current.isDisposed()) {
        hChartInstanceRef.current.resize();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [viewType, billingData, days, displayMode, themeChanged, timeUnit, modelsList]);

  const handleExport = () => {
    let csvContent = '\uFEFF'; // Add BOM for Excel UTF-8 Chinese compatibility
    if (timeUnit === 'year') {
      csvContent += '月份,模型,Tokens\n';
      days.forEach(day => {
        modelsList.forEach(model => {
          let sum = 0;
          Object.entries(billingData).forEach(([dateStr, dayData]) => {
            if (dateStr.startsWith(day)) {
              sum += getTokenValue(dayData[model]);
            }
          });
          if (sum > 0) {
            csvContent += `${day},${model},${sum}\n`;
          }
        });
      });
    } else {
      csvContent += '日期,模型,Tokens\n';
      days.forEach(day => {
        modelsList.forEach(model => {
          const val = getTokenValue(billingData[day]?.[model]);
          if (val > 0) {
            csvContent += `${day},${model},${val}\n`;
          }
        });
      });
    }
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `orca_billing_${timeUnit === 'year' ? selectedYear : selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  function getDaysInMonth(year: number, month: number) {
    const date = new Date(year, month - 1, 1);
    const daysList: string[] = [];
    while (date.getMonth() === month - 1) {
      const dStr = `${year}-${String(month).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      daysList.push(dStr);
      date.setDate(date.getDate() + 1);
    }
    return daysList;
  }

  const overallTotalTokens = Object.values(billingData).reduce((acc: number, dayData) => {
    return acc + Object.values(dayData).reduce((sum: number, val) => sum + getTokenValue(val), 0);
  }, 0);

  const statCards = [
    { label: t('dashboard.stats.total', lang), value: (stats.totalRequests || 0).toLocaleString(), trend: '+0%', icon: Activity, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: t('dashboard.stats.tokens', lang), value: (overallTotalTokens || stats.totalTokens || 0).toLocaleString() + ' Tokens', trend: 'Total', icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    { label: lang === 'en' ? 'Estimated Cost' : '估算费用 (USD)', value: '$' + (stats.totalCost || 0).toFixed(4), trend: 'USD', icon: Sparkles, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: t('dashboard.stats.cache', lang), value: (stats.interceptedRequests || 0).toLocaleString(), trend: '0%', icon: Key, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out max-w-6xl mx-auto p-1">
      
      <div className="flex items-end justify-between mb-8 select-none">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">{t('dashboard.title', lang)}</h2>
          <p className="text-[14px] text-[var(--color-text-secondary)] mt-1.5">{t('dashboard.desc', lang)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRefreshTick(t => t + 1)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)] text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
            title={lang === 'en' ? 'Refresh token stats' : '刷新 Token 统计'}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {lang === 'en' ? 'Refresh' : '刷新'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8 select-none">
        {statCards.map((stat, i) => (
          <div key={i} className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl p-6 hover:shadow-xl hover:-translate-y-1 hover:border-[var(--color-primary)]/30 transition-all duration-300 relative overflow-hidden group">
            <div className={`absolute -right-8 -top-8 w-32 h-32 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition-opacity ${stat.bg.replace('/10', '')}`}></div>
            <div className="flex justify-between items-start mb-4 relative z-10">
              <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <span className="text-xs font-bold px-2 py-1 bg-[var(--color-bg-base)] border border-[var(--color-border-base)] rounded-lg text-[var(--color-text-secondary)]">
                {stat.trend}
              </span>
            </div>
            <div className="relative z-10">
              <div className="text-[22px] font-extrabold text-[var(--color-text-primary)] mb-1 tracking-tight truncate" title={stat.value}>{stat.value}</div>
              <div className="text-xs font-medium text-[var(--color-text-muted)]">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Model Distribution Summary */}
      {modelsList.length > 0 && Object.keys(billingData).length > 0 && (() => {
        const modelTotals: Record<string, number> = {};
        modelsList.forEach(m => { modelTotals[m] = 0; });
        Object.entries(billingData).forEach(([_, dayData]) => {
          Object.entries(dayData).forEach(([model, val]) => {
            if (modelTotals.hasOwnProperty(model)) {
              modelTotals[model] += getTokenValue(val);
            }
          });
        });
        const grandTotal = Object.values(modelTotals).reduce((a: number, b: number) => a + b, 0);
        if (grandTotal === 0) return null;
        const sorted = Object.entries(modelTotals)
          .filter(([_, v]) => (v as number) > 0)
          .sort(([, a], [, b]) => (b as number) - (a as number));
        return (
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl p-5 mb-6 select-none">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)] mb-3">{lang === 'en' ? 'Model Token Distribution' : '模型用量分布'}</h3>
            <div className="space-y-2">
              {sorted.map(([model, tokens], idx) => {
                const pct = Math.round(((tokens as number) / grandTotal) * 100);
                const barColor = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#38bdf8'][idx % 6];
                return (
                  <div key={model} className="flex items-center gap-3">
                    <span className="text-xs font-mono font-semibold text-[var(--color-text-primary)] w-36 truncate shrink-0">{model}</span>
                    <div className="flex-1 h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(1, pct)}%`, background: barColor }} />
                    </div>
                    <span className="text-[10px] font-mono text-[var(--color-text-muted)] w-12 text-right shrink-0">{(tokens as number).toLocaleString()}</span>
                    <span className="text-[10px] font-bold w-10 text-right shrink-0" style={{ color: barColor }}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="w-full">
        
        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl p-6 flex flex-col w-full">
          
          <div className="flex items-center justify-between mb-4 select-none">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-[var(--color-text-primary)]">
                {displayMode === 'total' ? 'Token 总消耗' : '单模型 Token 消耗'}
              </span>
              <span className="text-gray-300 dark:text-gray-700 text-sm">|</span>
              <span className="text-[14px] font-semibold text-gray-500 dark:text-gray-400">
                {(overallTotalTokens || stats.totalTokens || 0).toLocaleString()} Tokens
              </span>
            </div>

            <div className="flex items-center gap-3">
              
              <div className="flex bg-[var(--color-bg-sidebar)] p-1 rounded-lg border border-[var(--color-border-base)] text-xs font-bold">
                <button 
                  onClick={() => setTimeUnit('year')}
                  className={`px-2.5 py-1.5 rounded-md cursor-pointer transition-all ${timeUnit === 'year' ? 'bg-white dark:bg-slate-900 shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                >
                  年
                </button>
                <button 
                  onClick={() => setTimeUnit('month')}
                  className={`px-2.5 py-1.5 rounded-md cursor-pointer transition-all ${timeUnit === 'month' ? 'bg-white dark:bg-slate-900 shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                >
                  月
                </button>
              </div>

              <div 
                ref={calendarRef}
                onClick={(e) => {
                  e.stopPropagation();
                  setMonthMenuOpen(!monthMenuOpen);
                }}
                className="flex items-center gap-1.5 bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)] px-3 py-2 rounded-lg text-xs font-bold text-[var(--color-text-primary)] shadow-sm select-none cursor-pointer relative"
              >
                <Calendar className="w-3.5 h-3.5 text-gray-500" />
                <span>{timeUnit === 'year' ? selectedMonth.slice(0, 4) : selectedMonth}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />

                {monthMenuOpen && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full right-0 mt-1.5 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl shadow-lg z-50 w-36 py-1 max-h-48 overflow-y-auto"
                  >
                    {getAvailablePeriods().map(p => {
                      const isSelected = (timeUnit === 'year' ? selectedMonth.startsWith(p) : selectedMonth === p);
                      return (
                        <div 
                          key={p}
                          onClick={() => handlePeriodSelect(p)}
                          className={`px-3 py-2 text-xs hover:bg-[var(--color-bg-hover)] cursor-pointer flex justify-between items-center transition-colors ${
                            isSelected ? 'bg-[var(--color-bg-hover)] font-bold text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'
                          }`}
                        >
                          <span>{p}</span>
                          {isSelected && <span className="text-[var(--color-primary)] font-bold">✓</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex bg-[var(--color-bg-sidebar)] p-1 rounded-lg border border-[var(--color-border-base)] text-xs font-bold">
                <button 
                  onClick={() => setViewType('chart')}
                  className={`p-1.5 rounded-md cursor-pointer transition-all ${viewType === 'chart' ? 'bg-white dark:bg-slate-900 shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                  title="图表视图"
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => setViewType('list')}
                  className={`p-1.5 rounded-md cursor-pointer transition-all ${viewType === 'list' ? 'bg-white dark:bg-slate-900 shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                  title="列表视图"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>

              <button 
                onClick={handleExport}
                className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-[var(--color-border-base)] px-3 py-2 rounded-lg text-xs font-bold text-[var(--color-text-primary)] shadow-sm hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer"
                title={lang === 'en' ? 'Export data as CSV' : '导出数据为 CSV'}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                <span>{lang === 'en' ? 'Export' : '导出'}</span>
              </button>

            </div>
          </div>

          <div className="flex items-center gap-2 mb-6 select-none border-b border-[var(--color-border-base)]/55 pb-3">
            <button 
              onClick={() => setDisplayMode('total')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-full transition-all border cursor-pointer ${
                displayMode === 'total' 
                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400' 
                  : 'bg-transparent border-[var(--color-border-base)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              Token 总消耗
            </button>
            <button 
              onClick={() => setDisplayMode('single')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-full transition-all border cursor-pointer ${
                displayMode === 'single' 
                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400' 
                  : 'bg-transparent border-[var(--color-border-base)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              单模型 Token 消耗
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-[var(--color-text-secondary)] mb-6 select-none">
            {displayMode === 'total' && (
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Token 总消耗</span>
            )}
            {modelsList.map((model, idx) => (
              <span key={model} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getModelColor(model, idx) }}></span>
                {model}
              </span>
            ))}
          </div>

          <div className="w-full relative mt-4">
            {/* Vertical Chart Container */}
            <div 
              style={{ display: viewType === 'chart' ? 'block' : 'none' }}
              className="w-full"
            >
              <div ref={chartRef} className="w-full h-[400px]" />
            </div>

            {/* List View Container */}
            <div 
              style={{ display: viewType === 'list' ? 'flex' : 'none' }}
              className="w-full flex flex-col"
            >
              {/* Horizontal Chart for List View */}
              <div className="w-full border border-[var(--color-border-base)] rounded-xl bg-[var(--color-bg-card)] p-4 mb-6 shadow-sm">
                <div className="text-sm font-bold text-[var(--color-text-primary)] mb-2 select-none">
                  {lang === 'en' ? 'Model Consumption Breakdown' : '单模型消耗分布 (横状图)'}
                </div>
                <div ref={horizontalChartRef} className="w-full h-[220px]" />
              </div>

              <div className="overflow-x-auto border border-[var(--color-border-base)] rounded-xl bg-[var(--color-bg-card)] max-h-[400px] overflow-y-auto relative">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-xs font-bold text-[var(--color-text-secondary)] select-none">
                      <th className="p-4 cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors sticky top-0 bg-[var(--color-bg-sidebar)] border-b border-[var(--color-border-base)] z-10" onClick={() => handleSort('date')}>
                        <div className="flex items-center gap-1">
                          日期
                          <span className="text-gray-400">
                            {sortField === 'date' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </th>
                      <th className="p-4 cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors sticky top-0 bg-[var(--color-bg-sidebar)] border-b border-[var(--color-border-base)] z-10" onClick={() => handleSort('model')}>
                        <div className="flex items-center gap-1">
                          模型
                          <span className="text-gray-400">
                            {sortField === 'model' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </th>
                      <th className="p-4 cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors sticky top-0 bg-[var(--color-bg-sidebar)] border-b border-[var(--color-border-base)] z-10" onClick={() => handleSort('total')}>
                        <div className="flex items-center gap-1">
                          总 Token 数
                          <span className="text-gray-400">
                            {sortField === 'total' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </th>
                      <th className="p-4 cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors sticky top-0 bg-[var(--color-bg-sidebar)] border-b border-[var(--color-border-base)] z-10" onClick={() => handleSort('cached')}>
                        <div className="flex items-center gap-1">
                          输入 (命中缓存) Token 数
                          <span className="text-gray-400">
                            {sortField === 'cached' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </th>
                      <th className="p-4 cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors sticky top-0 bg-[var(--color-bg-sidebar)] border-b border-[var(--color-border-base)] z-10" onClick={() => handleSort('uncached')}>
                        <div className="flex items-center gap-1">
                          输入 (未命中缓存) Token 数
                          <span className="text-gray-400">
                            {sortField === 'uncached' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-base)]/50 text-[13px] font-medium text-[var(--color-text-primary)]">
                    {paginatedRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-[var(--color-text-muted)]">
                          暂无消耗记录
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-[var(--color-bg-hover)]/30 transition-colors">
                          <td className="p-4 font-mono">{row.date}</td>
                          <td className="p-4">
                            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)]">
                              {row.model}
                            </span>
                          </td>
                          <td className="p-4 font-mono font-bold text-blue-600 dark:text-blue-400">{row.total.toLocaleString()}</td>
                          <td className="p-4 font-mono text-emerald-600 dark:text-emerald-400">{row.cached.toLocaleString()}</td>
                          <td className="p-4 font-mono text-amber-600 dark:text-amber-400">{row.uncached.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* 分页控制栏 - 使用通用 Pagination 组件 */}
              {totalCount > 0 && (
                <div className="mt-4 px-1">
                  <Pagination
                    current={currentPage}
                    total={totalCount}
                    pageSize={pageSize}
                    onChange={setCurrentPage}
                    onPageSizeChange={(size) => {
                      setPageSize(size);
                      setCurrentPage(1);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
