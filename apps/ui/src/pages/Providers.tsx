import { useState, useEffect } from 'react';
import { Network, Plus, Search, AlertCircle, Key, Activity, Trash2, ArrowUp, ArrowDown, RefreshCw, Check } from 'lucide-react';
import { api } from '../api';

import { translate as t } from '../i18n';
import type { Language } from '../i18n';
import { useToast } from '../components/Toast';
import type { AppConfig } from '../types';

interface ProviderModel {
  id: string;
  name: string;
}

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  configured: boolean;
  models: ProviderModel[];
  openaiCompatible: boolean;
  description: string;
  fromEnv?: boolean;
}

interface RoutingRule {
  pattern: string;
  providerId: string;
}

export default function Providers({ lang }: { lang: Language }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [searchRule, setSearchRule] = useState('');
  
  // Modals state
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  // API Key 已配置状态: 用于 Modal 打开时的占位提示
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const toast = useToast();

  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [customProviderForm, setCustomProviderForm] = useState({
    id: '',
    name: '',
    baseUrl: '',
    apiKey: '',
    modelsStr: 'gpt-4o, gpt-4o-mini',
    description: '',
    openaiCompatible: true
  });

  // Diagnostics and testing state
  const [testResults, setTestResults] = useState<Record<string, { status: 'idle' | 'testing' | 'success' | 'fail'; message: string; latency?: number }>>({});

  // Model discovery states
  const [isDiscoverModalOpen, setIsDiscoverModalOpen] = useState(false);
  const [discoveringProvider, setDiscoveringProvider] = useState<Provider | null>(null);
  const [discoveredModelsList, setDiscoveredModelsList] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const providersRes = await api.get('/api/providers');
      setProviders(providersRes.data);
      
      const configRes = await api.get('/api/config');
      setConfig(configRes.data);
    } catch (e) {
      console.error("Failed to load providers data", e);
    }
  };

  const handleSetActive = async (providerId: string) => {
    try {
      const updatedConfig = { ...config, activeProviderId: providerId };
      await api.post('/api/config', updatedConfig);
      setConfig(updatedConfig);
      // Fetch data again to update statuses
      fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(lang === 'en' ? 'Failed to switch active provider' : '切换主提供商失败', msg);
    }
  };

  // API Key functions
  const openKeyModal = (provider: Provider) => {
    setSelectedProvider(provider);
    setApiKeyConfigured(!!provider.configured);
    setApiKeyInput(provider.configured ? '***configured***' : '');
    setIsKeyModalOpen(true);
  };

  const saveApiKey = async () => {
    if (!selectedProvider || !config) return;
    try {
      const updates: Record<string, Record<string, string>> = {
        providerKeys: {
          [selectedProvider.id]: apiKeyInput === '***configured***' ? '__keep__' : apiKeyInput
        }
      };
      // If user clears the input, clear it on the server
      if (apiKeyInput === '') {
        updates.providerKeys[selectedProvider.id] = '__clear__';
      }

      // Filter out '__keep__' so we do not overwrite the server
      if (updates.providerKeys[selectedProvider.id] === '__keep__') {
        delete updates.providerKeys[selectedProvider.id];
      }

      await api.post('/api/config', updates);
      toast.success(lang === 'en' ? 'API Key saved' : 'API Key 已保存', selectedProvider.name);
      setIsKeyModalOpen(false);
      fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(lang === 'en' ? 'Failed to save API Key' : '保存 API Key 失败', msg);
    }
  };

  // Test provider connection
  const testProvider = async (providerId: string) => {
    setTestResults(prev => ({ ...prev, [providerId]: { status: 'testing', message: lang === 'en' ? 'Testing connection...' : '正在测试连接...' } }));
    const start = Date.now();
    try {
      const res = await api.post('/api/test-provider', { providerId });
      const latency = Date.now() - start;
      if (res.data.ok) {
        setTestResults(prev => ({
          ...prev,
          [providerId]: { status: 'success', message: lang === 'en' ? `Connected! Primary model: ${res.data.model || '-'}` : `连通成功！首选模型: ${res.data.model || '-'}`, latency }
        }));
      } else {
        const errMsg = res.data.error || res.data.message || (lang === 'en' ? 'Connection failed' : '连接失败');
        setTestResults(prev => ({
          ...prev,
          [providerId]: { status: 'fail', message: errMsg }
        }));
      }
    } catch (e: any) {
      // Axios errors carry the backend error in e.response.data.error
      const backendErr = e?.response?.data?.error;
      const msg = backendErr || (e instanceof Error ? e.message : '网络测试异常');
      setTestResults(prev => ({
        ...prev,
        [providerId]: { status: 'fail', message: msg }
      }));
    }
  };

  const discoverModels = async (provider: Provider) => {
    setDiscoveringProvider(provider);
    setDiscoveredModelsList([]);
    setIsDiscovering(true);
    setIsDiscoverModalOpen(true);
    try {
      const res = await api.get(`/api/discover-models/${provider.id}`);
      if (res.data && res.data.models) {
        const list: string[] = res.data.models.map((m: { id: string }) => m.id);
        setDiscoveredModelsList(list);
      } else {
        toast.warning(lang === 'en' ? 'No valid model list returned' : '未获取到有效的模型列表');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(lang === 'en' ? 'Failed to fetch models' : '获取可用模型失败', msg);
      setIsDiscoverModalOpen(false);
    } finally {
      setIsDiscovering(false);
    }
  };

  const saveDiscoveredModels = async () => {
    if (!discoveringProvider || !config) return;
    try {
      const updatedDiscovered: Record<string, Array<{ id: string; name: string }>> = { ...(config.discoveredModels || {}) };
      updatedDiscovered[discoveringProvider.id] = discoveredModelsList.map(m => ({ id: m, name: m }));

      const updatedConfig = { ...config, discoveredModels: updatedDiscovered };
      await api.post('/api/config', updatedConfig);
      setConfig(updatedConfig);
      setIsDiscoverModalOpen(false);
      toast.success(lang === 'en' ? 'Models synced! They are now selectable in the chat picker.' : '同步模型列表成功！您现在已可以在聊天中选择这些模型。');
      fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error((lang === 'en' ? 'Failed to sync models: ' : '同步保存模型失败: ') + msg);
    }
  };

  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    pattern: '',
    providerId: '',
    editIndex: -1 // -1 means add, otherwise edit index
  });

  // Custom provider CRUD
  const saveCustomProvider = async () => {
    const { id, name, baseUrl, apiKey, modelsStr, description, openaiCompatible } = customProviderForm;
    if (!id || !name || !baseUrl) {
      toast.warning(lang === 'en' ? 'Please fill in ID, name and Base URL' : '请填写标识符、名称和 Base URL');
      return;
    }
    try {
      const models = modelsStr.split(',').map(m => m.trim()).filter(Boolean).map(m => ({ id: m, name: m }));
      const payload = {
        id,
        name,
        baseUrl,
        apiKey,
        models,
        description,
        openaiCompatible
      };
      await api.post('/api/custom-providers', { providers: [payload] });
      toast.success(lang === 'en' ? 'Custom provider added' : '自定义供应商已添加', name);
      setIsCustomModalOpen(false);
      // Reset form
      setCustomProviderForm({
        id: '',
        name: '',
        baseUrl: '',
        apiKey: '',
        modelsStr: 'gpt-4o, gpt-4o-mini',
        description: '',
        openaiCompatible: true
      });
      fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error((lang === 'en' ? 'Failed to add custom provider: ' : '添加自定义供应商失败: ') + msg);
    }
  };

  const deleteCustomProvider = async (id: string) => {
    if (!confirm(lang === 'en'
      ? 'Delete this custom provider? Its associated API key will also be removed.'
      : '确定要删除此自定义供应商吗？这也会删除其关联的 API Key。')) return;
    try {
      await api.delete(`/api/custom-providers/${id}`);
      fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(lang === 'en' ? 'Delete failed' : '删除失败', msg);
    }
  };

  // Routing Rules operations
  const saveRule = async () => {
    if (!config) return;
    const { pattern, providerId, editIndex } = ruleForm;
    if (!pattern || !providerId) {
      toast.warning(lang === 'en' ? 'Please fill in the regex pattern and target provider' : '请填写匹配正则并选择目标节点');
      return;
    }
    try {
      const rulesCopy = [...(config.routingRules || [])];
      const newRule = { pattern, providerId };

      if (editIndex >= 0) {
        rulesCopy[editIndex] = newRule;
      } else {
        rulesCopy.push(newRule);
      }

      const updatedConfig = { ...config, routingRules: rulesCopy };
      await api.post('/api/config', updatedConfig);
      setConfig(updatedConfig);
      setIsRuleModalOpen(false);
      setRuleForm({ pattern: '', providerId: '', editIndex: -1 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error((lang === 'en' ? 'Failed to save rule: ' : '保存规则失败: ') + msg);
    }
  };

  const deleteRule = async (index: number) => {
    if (!config) return;
    try {
      const rulesCopy = (config.routingRules || []).filter((_rule: RoutingRule, i: number) => i !== index);
      const updatedConfig = { ...config, routingRules: rulesCopy };
      await api.post('/api/config', updatedConfig);
      setConfig(updatedConfig);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error((lang === 'en' ? 'Failed to delete rule: ' : '删除规则失败: ') + msg);
    }
  };

  const moveRule = async (index: number, direction: 'up' | 'down') => {
    if (!config) return;
    const rules = [...(config.routingRules || [])];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rules.length) return;

    // Swap rules
    const temp = rules[index];
    rules[index] = rules[targetIndex];
    rules[targetIndex] = temp;

    try {
      const updatedConfig = { ...config, routingRules: rules };
      await api.post('/api/config', updatedConfig);
      setConfig(updatedConfig);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error((lang === 'en' ? 'Failed to reorder rules: ' : '调整优先级失败: ') + msg);
    }
  };

  const filteredRules = (config?.routingRules || []).filter((rule: RoutingRule) => {
    const term = searchRule.toLowerCase();
    const providerName = providers.find(p => p.id === rule.providerId)?.name || rule.providerId;
    return rule.pattern.toLowerCase().includes(term) || providerName.toLowerCase().includes(term);
  });

  return (
    <div className="animate-in fade-in duration-500 max-w-6xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">{t('providers.title', lang)}</h2>
          <p className="text-[14px] text-[var(--color-text-secondary)] mt-1.5">{t('providers.desc', lang)}</p>
        </div>
        <button 
          onClick={() => setIsCustomModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] text-white text-sm font-medium rounded-xl hover:bg-[var(--color-primary-hover)] shadow-sm transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" /> {t('providers.add', lang)}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Providers List */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Network className="w-5 h-5 text-[var(--color-primary)]" />
            {t('providers.nodes', lang)}
          </h3>
          
          <div className="space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {providers.map((p) => {
              const isActive = config?.activeProviderId === p.id;
              const testResult = testResults[p.id];
              const isCustom = p.apiKeyEnv === ''; // custom providers do not have built-in env var keys
              
              return (
                <div key={p.id} className={`p-4 rounded-2xl border transition-all ${
                  isActive 
                    ? 'bg-[var(--color-bg-base)] border-[var(--color-primary)]/50 shadow-[0_0_15px_rgba(34,197,94,0.05)] relative overflow-hidden' 
                    : 'bg-[var(--color-bg-card)] border-[var(--color-border-base)] hover:border-[var(--color-text-muted)]'
                }`}>
                  {isActive && <div className="absolute top-0 left-0 w-1 h-full bg-[var(--color-primary)]"></div>}
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                        {p.name}
                        {isCustom && <span className="text-[9px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20 px-1.5 py-0.5 rounded">CUSTOM</span>}
                      </h4>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{p.description}</p>
                    </div>
                    <div className="flex gap-1.5 items-center shrink-0">
                      {p.fromEnv && (
                        <div 
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-500 border border-purple-500/20 cursor-help"
                          title={t('providers.env_tooltip', lang)}
                        >
                          {t('providers.env_badge', lang)}
                        </div>
                      )}
                      <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                        isActive ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                        p.configured ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'bg-gray-500/10 text-gray-500 border border-gray-500/10'
                      }`}>
                        {isActive ? 'Active' : (p.configured ? 'Configured' : 'Offline')}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)] mb-3 font-mono break-all">{p.baseUrl}</div>
                  
                  {/* Diagnostic feedback */}
                  {testResult && (
                    <div className={`mb-3 p-2 rounded-xl text-xs flex flex-col gap-1 border ${
                      testResult.status === 'testing' ? 'bg-gray-500/5 text-[var(--color-text-secondary)] border-gray-500/10' :
                      testResult.status === 'success' ? 'bg-green-500/5 text-green-600 dark:text-green-400 border-green-500/10' :
                      'bg-red-500/5 text-red-500 border-red-500/10'
                    }`}>
                      <div className="flex items-center gap-1.5">
                        <Activity className={`w-3.5 h-3.5 ${testResult.status === 'testing' ? 'animate-pulse' : ''}`} />
                        <span>{testResult.message}</span>
                      </div>
                      {testResult.latency !== undefined && (
                        <span className="font-bold text-[10px]">{lang === 'en' ? 'Latency:' : '网络延迟:'} {testResult.latency}ms</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] border-t border-[var(--color-border-base)] pt-3 mt-1 gap-2">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => openKeyModal(p)}
                        className="hover:text-[var(--color-primary)] transition-colors flex items-center gap-1 border border-[var(--color-border-base)] px-2 py-1 rounded-lg bg-[var(--color-bg-base)] cursor-pointer"
                        title={lang === 'en' ? 'Set API Key' : '设置 API Key'}
                      >
                        <Key className="w-3 h-3" /> API Key
                      </button>
                      <button 
                        onClick={() => testProvider(p.id)}
                        disabled={testResult?.status === 'testing'}
                        className="hover:text-[var(--color-primary)] disabled:opacity-50 transition-colors flex items-center gap-1 border border-[var(--color-border-base)] px-2 py-1 rounded-lg bg-[var(--color-bg-base)] cursor-pointer"
                        title={lang === 'en' ? 'Test connectivity' : '测试连通性'}
                      >
                        <RefreshCw className={`w-3 h-3 ${testResult?.status === 'testing' ? 'animate-spin' : ''}`} /> {lang === 'en' ? 'Test' : '测试'}
                      </button>
                      {p.configured && (
                        <button 
                          onClick={() => discoverModels(p)}
                          className="hover:text-[var(--color-primary)] transition-colors flex items-center gap-1 border border-[var(--color-border-base)] px-2 py-1 rounded-lg bg-[var(--color-bg-base)] cursor-pointer"
                          title={lang === 'en' ? 'Sync cloud models' : '同步云端模型'}
                        >
                          <RefreshCw className="w-3 h-3" /> {lang === 'en' ? 'Sync Models' : '同步模型'}
                        </button>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-1">
                      {isCustom && (
                        <button 
                          onClick={() => deleteCustomProvider(p.id)}
                          className="hover:text-red-500 transition-colors border border-red-500/20 px-2 py-1 rounded-lg bg-red-500/5 text-red-500 mr-1 cursor-pointer"
                          title={lang === 'en' ? 'Delete custom provider' : '删除自定义供应商'}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                      {!isActive && (
                        <button 
                          onClick={() => handleSetActive(p.id)}
                          className="text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors px-2.5 py-1 rounded-lg font-bold border border-[var(--color-primary)]/30 cursor-pointer"
                        >
                          {lang === 'en' ? 'Activate' : '激活'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Routing Rules */}
        <div className="lg:col-span-2">
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-[var(--color-border-base)] flex items-center justify-between bg-[var(--color-bg-base)]/50">
              <h3 className="text-lg font-bold">{lang === 'en' ? 'Smart Routing Rules' : '智能路由规则'}</h3>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input 
                    type="text" 
                    placeholder={lang === 'en' ? 'Search rules...' : '搜索规则...'} 
                    value={searchRule}
                    onChange={e => setSearchRule(e.target.value)}
                    className="pl-9 pr-4 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-sm outline-none focus:border-[var(--color-primary)] transition-colors w-40 md:w-48" 
                  />
                </div>
                <button 
                  onClick={() => {
                    if (providers.length === 0) {
                      toast.error(lang === 'en' ? 'Please add or activate a provider first' : '请先添加或激活提供商');
                      return;
                    }
                    setRuleForm({ pattern: '', providerId: providers[0].id, editIndex: -1 });
                    setIsRuleModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-primary)] text-white text-xs font-bold rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> {lang === 'en' ? 'Add Rule' : '加规则'}
                </button>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--color-bg-base)] text-[var(--color-text-muted)] text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4 font-semibold">{lang === 'en' ? 'Priority' : '优先级顺序'}</th>
                    <th className="px-6 py-4 font-semibold">{lang === 'en' ? 'Regex Pattern' : '正则匹配 (Regex)'}</th>
                    <th className="px-6 py-4 font-semibold">{lang === 'en' ? 'Target' : '目标节点 (Target)'}</th>
                    <th className="px-6 py-4 font-semibold text-right">{lang === 'en' ? 'Actions' : '操作'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-base)]">
                  {filteredRules.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-[var(--color-text-muted)] italic">
                        {lang === 'en' ? 'No routing rules. All requests will use the active provider.' : '无路由规则。所有请求将默认路由至当前激活的主节点。'}
                      </td>
                    </tr>
                  ) : (
                    filteredRules.map((rule: RoutingRule, idx: number) => {
                      const realIndex = config?.routingRules?.findIndex((r: RoutingRule) => r.pattern === rule.pattern && r.providerId === rule.providerId) ?? -1;
                      const targetProvider = providers.find(p => p.id === rule.providerId);

                      return (
                        <tr key={idx} className="hover:bg-[var(--color-bg-hover)] transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-[var(--color-text-muted)] bg-[var(--color-bg-base)] w-6 h-6 flex items-center justify-center rounded-lg border border-[var(--color-border-base)]">
                                {realIndex + 1}
                              </span>
                              <div className="flex flex-col gap-0.5">
                                <button
                                  onClick={() => realIndex >= 0 && moveRule(realIndex, 'up')}
                                  disabled={realIndex === 0}
                                  className="p-0.5 hover:text-[var(--color-primary)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)] transition-colors cursor-pointer"
                                  title={lang === 'en' ? 'Move up (higher priority)' : '上移（增高优先级）'}
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => realIndex >= 0 && moveRule(realIndex, 'down')}
                                  disabled={realIndex === (config?.routingRules || []).length - 1}
                                  className="p-0.5 hover:text-[var(--color-primary)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)] transition-colors cursor-pointer"
                                  title={lang === 'en' ? 'Move down (lower priority)' : '下移（降低优先级）'}
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <code className="bg-[var(--color-bg-base)] px-2.5 py-1 rounded-lg text-[var(--color-primary)] border border-[var(--color-primary)]/20 font-mono text-xs font-semibold">{rule.pattern}</code>
                          </td>
                          <td className="px-6 py-4 font-semibold text-[var(--color-text-primary)]">
                            {targetProvider ? targetProvider.name : rule.providerId}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  if (realIndex >= 0) {
                                    setRuleForm({
                                      pattern: rule.pattern,
                                      providerId: rule.providerId,
                                      editIndex: realIndex
                                    });
                                    setIsRuleModalOpen(true);
                                  }
                                }}
                                className="text-xs px-2 py-1 border border-[var(--color-border-base)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] rounded-lg bg-[var(--color-bg-card)] transition-colors cursor-pointer"
                              >
                                {lang === 'en' ? 'Edit' : '编辑'}
                              </button>
                              <button
                                onClick={() => realIndex >= 0 && deleteRule(realIndex)}
                                className="text-xs px-2 py-1 border border-red-500/20 text-red-500 hover:bg-red-500/5 rounded-lg bg-[var(--color-bg-card)] transition-colors cursor-pointer"
                              >
                                {lang === 'en' ? 'Delete' : '删除'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/30 flex items-start gap-3 text-sm text-[var(--color-text-secondary)]">
              <AlertCircle className="w-5 h-5 shrink-0 text-blue-500" />
              <p>{lang === 'en'
                ? <>When a request arrives, the gateway evaluates rules in order (1 to N). The first rule whose regex matches and whose provider has a valid API key routes the request to it. If no rule matches, the active provider is used.</>
                : <>请求到来时，网关会按<strong>规则列表的先后顺序 (1 到 N)</strong>依次进行正则校验。一旦某条规则匹配且其所选提供商已配置了有效 API Key，则将该请求分流至此提供商。若所有规则均未命中，则回退至主激活提供商。</>}</p>
            </div>
          </div>
        </div>
      </div>

      {/* --- Modal: Edit API Key --- */}
      {isKeyModalOpen && selectedProvider && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Key className="w-5 h-5 text-[var(--color-primary)]" />
                {lang === 'en' ? `Configure ${selectedProvider.name} API Key` : `配置 ${selectedProvider.name} API Key`}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-[var(--color-text-secondary)]">API KEY</label>
                  {apiKeyConfigured && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                      <Check className="w-2.5 h-2.5" /> {lang === 'en' ? 'Configured' : '已配置'}
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={e => {
                    setApiKeyInput(e.target.value);
                    if (apiKeyConfigured && e.target.value !== '***configured***') {
                      setApiKeyConfigured(false);
                    }
                  }}
                  placeholder={apiKeyConfigured
                    ? (lang === 'en' ? 'Configured · type a new key to replace' : '已配置 · 输入新密钥以替换')
                    : (lang === 'en' ? 'Enter the provider API key' : '请输入提供商的 API 密钥')}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm transition-colors font-mono"
                />
                <p className="text-[11px] text-[var(--color-text-muted)] mt-2">
                  {selectedProvider.apiKeyEnv
                    ? (lang === 'en' ? `The local environment variable is read when set: ${selectedProvider.apiKeyEnv}` : `系统支持读取本地环境变量: ${selectedProvider.apiKeyEnv}`)
                    : (lang === 'en' ? 'Verification key used by this custom endpoint' : '自定义接口节点使用的验证密钥')}。
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/30 flex justify-end gap-3">
              <button 
                onClick={() => setIsKeyModalOpen(false)}
                className="px-4 py-2 border border-[var(--color-border-base)] rounded-xl text-sm font-semibold hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button 
                onClick={saveApiKey}
                className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl text-sm font-semibold shadow-sm transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Save' : '保存配置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Add Custom Provider --- */}
      {isCustomModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Network className="w-5 h-5 text-[var(--color-primary)]" />
                {lang === 'en' ? 'Add Custom OpenAI-Compatible Provider' : '新增自定义 OpenAI 兼容供应商'}
              </h3>
            </div>
            <div className="p-6 space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">{lang === 'en' ? 'Unique ID' : '唯一标识符 (ID)'}</label>
                  <input 
                    type="text" 
                    placeholder={lang === 'en' ? 'e.g. local-ollama' : '例如: local-ollama'}
                    value={customProviderForm.id}
                    onChange={e => setCustomProviderForm({...customProviderForm, id: e.target.value})}
                    className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">{lang === 'en' ? 'Display Name' : '展示名称 (Name)'}</label>
                  <input 
                    type="text" 
                    placeholder={lang === 'en' ? 'e.g. Local Ollama' : '例如: 本地 Ollama'}
                    value={customProviderForm.name}
                    onChange={e => setCustomProviderForm({...customProviderForm, name: e.target.value})}
                    className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm transition-colors"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">{lang === 'en' ? 'API Base URL' : 'API 接口端点 (Base URL)'}</label>
                <input 
                  type="text" 
                  placeholder={lang === 'en' ? 'e.g. http://127.0.0.1:11434' : '例如: http://127.0.0.1:11434'}
                  value={customProviderForm.baseUrl}
                  onChange={e => setCustomProviderForm({...customProviderForm, baseUrl: e.target.value})}
                  className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm font-mono transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">{lang === 'en' ? 'API Key (optional)' : '认证密钥 (API Key, 可空)'}</label>
                <input 
                  type="password" 
                  placeholder={lang === 'en' ? 'Leave empty if no auth is required' : '如不需要鉴权请留空'}
                  value={customProviderForm.apiKey}
                  onChange={e => setCustomProviderForm({...customProviderForm, apiKey: e.target.value})}
                  className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">{lang === 'en' ? 'Supported models (comma-separated)' : '支持的模型列表 (以英文逗号分隔)'}</label>
                <input 
                  type="text" 
                  placeholder={lang === 'en' ? 'e.g. llama3, qwen2.5:7b, deepseek-r1' : '例如: llama3, qwen2.5:7b, deepseek-r1'}
                  value={customProviderForm.modelsStr}
                  onChange={e => setCustomProviderForm({...customProviderForm, modelsStr: e.target.value})}
                  className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">{lang === 'en' ? 'Short description' : '简短描述'}</label>
                <input 
                  type="text" 
                  placeholder={lang === 'en' ? 'What this provider is used for' : '这个供应商的介绍或用途'}
                  value={customProviderForm.description}
                  onChange={e => setCustomProviderForm({...customProviderForm, description: e.target.value})}
                  className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm transition-colors"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox" 
                  id="openaiCompatible" 
                  checked={customProviderForm.openaiCompatible}
                  onChange={e => setCustomProviderForm({...customProviderForm, openaiCompatible: e.target.checked})}
                  className="rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                />
                <label htmlFor="openaiCompatible" className="text-xs font-bold text-[var(--color-text-secondary)] cursor-pointer">{lang === 'en' ? 'Fully OpenAI-compatible protocol' : '完全兼容 OpenAI 协议标准格式'}</label>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/30 flex justify-end gap-3">
              <button 
                onClick={() => setIsCustomModalOpen(false)}
                className="px-4 py-2 border border-[var(--color-border-base)] rounded-xl text-sm font-semibold hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button 
                onClick={saveCustomProvider}
                className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl text-sm font-semibold shadow-sm transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Add Provider' : '新增供应商'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Add/Edit Routing Rule --- */}
      {isRuleModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Activity className="w-5 h-5 text-[var(--color-primary)]" />
                {ruleForm.editIndex >= 0
                  ? (lang === 'en' ? 'Edit Routing Rule' : '编辑路由规则')
                  : (lang === 'en' ? 'Add Routing Rule' : '新增智能路由规则')}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">{lang === 'en' ? 'Regex Pattern' : '正则匹配表达式 (Pattern)'}</label>
                <input 
                  type="text" 
                  placeholder={lang === 'en' ? 'e.g. ^gpt-4.* or .* (catch-all)' : '例如: ^gpt-4.* 或 .* (代表兜底匹配)'}
                  value={ruleForm.pattern}
                  onChange={e => setRuleForm({...ruleForm, pattern: e.target.value})}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm font-mono transition-colors"
                />
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">{lang === 'en' ? 'Requests whose model ID matches this regex are routed to the target provider.' : '当请求的模型 ID 匹配该正则时，流量将分流至目标提供商。'}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">{lang === 'en' ? 'Target Provider' : '目标提供商 (Target Provider)'}</label>
                <select 
                  value={ruleForm.providerId}
                  onChange={e => setRuleForm({...ruleForm, providerId: e.target.value})}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm transition-colors"
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/30 flex justify-end gap-3">
              <button 
                onClick={() => setIsRuleModalOpen(false)}
                className="px-4 py-2 border border-[var(--color-border-base)] rounded-xl text-sm font-semibold hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button 
                onClick={saveRule}
                className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl text-sm font-semibold shadow-sm transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Save Rule' : '保存规则'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Discovered Models --- */}
      {isDiscoverModalOpen && discoveringProvider && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-[var(--color-primary)]" />
                {lang === 'en' ? `Discover ${discoveringProvider.name} models` : `发现 ${discoveringProvider.name} 模型列表`}
              </h3>
            </div>
            
            <div className="p-6 space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto animate-in fade-in">
              {isDiscovering ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <RefreshCw className="w-8 h-8 text-[var(--color-primary)] animate-spin" />
                  <span className="text-xs text-[var(--color-text-muted)]">{lang === 'en' ? 'Fetching available models from the upstream API...' : '正在从上游 API 获取可用模型列表...'}</span>
                </div>
              ) : discoveredModelsList.length === 0 ? (
                <div className="text-center py-6 text-xs text-[var(--color-text-muted)] italic">
                  {lang === 'en' ? 'No models discovered. Check the API key or network connectivity.' : '未发现任何可用的模型。请检查 API Key 配置或网络连通性。'}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                    {lang === 'en'
                      ? <>Discovered <strong>{discoveredModelsList.length}</strong> model IDs. After syncing, they become selectable in the chat model picker:</>
                      : <>成功从该提供商获取到以下共 <strong>{discoveredModelsList.length}</strong> 个模型 ID。同步保存后，这些模型将在聊天对话选择框中立即可选：</>}
                  </p>
                  <div className="space-y-2 border border-[var(--color-border-base)] rounded-xl p-3 bg-[var(--color-bg-base)]/40 max-h-60 overflow-y-auto font-mono text-xs">
                    {discoveredModelsList.map(modelId => (
                      <div key={modelId} className="px-2 py-1 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-lg text-[var(--color-text-primary)] truncate">
                        {modelId}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/30 flex justify-end gap-3">
              <button 
                onClick={() => setIsDiscoverModalOpen(false)}
                className="px-4 py-2 border border-[var(--color-border-base)] rounded-xl text-sm font-semibold hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Close' : '关闭'}
              </button>
              {!isDiscovering && discoveredModelsList.length > 0 && (
                <button 
                  onClick={saveDiscoveredModels}
                  className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl text-sm font-semibold shadow-sm transition-colors cursor-pointer"
                >
                  {lang === 'en' ? 'Sync to chat picker' : '同步至聊天选择框'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
