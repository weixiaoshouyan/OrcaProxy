import { useState, useEffect } from 'react';
import { Save, RefreshCw, Check } from 'lucide-react';
import { api } from '../api';
import { translate as t, setLanguage } from '../i18n';
import type { Language } from '../i18n';

interface SettingsProps {
  lang: Language;
  setLang: (lang: Language) => void;
}

export default function Settings({ lang, setLang }: SettingsProps) {
  const [config, setConfig] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // New MCP form state
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpCommand, setNewMcpCommand] = useState('');
  const [newMcpArgs, setNewMcpArgs] = useState('');
  const [newMcpEnv, setNewMcpEnv] = useState('');

  // New Pricing form state
  const [newModelId, setNewModelId] = useState('');
  const [newModelInputPrice, setNewModelInputPrice] = useState('0.0');
  const [newModelOutputPrice, setNewModelOutputPrice] = useState('0.0');

  // New Model Override state
  const [newOverrideSource, setNewOverrideSource] = useState('');
  const [newOverrideTargetProvider, setNewOverrideTargetProvider] = useState('');
  const [newOverrideTargetModel, setNewOverrideTargetModel] = useState('');

  useEffect(() => {
    api.get('/api/config').then(res => setConfig(res.data)).catch(console.error);
    api.get('/api/providers').then(res => {
      setProviders(res.data);
      const configured = res.data.filter((p: any) => p.configured);
      if (configured && configured.length > 0) {
        setNewOverrideTargetProvider(configured[0].id);
        if (configured[0].models && configured[0].models.length > 0) {
          setNewOverrideTargetModel(configured[0].models[0].id);
        }
      } else {
        setNewOverrideTargetProvider('');
        setNewOverrideTargetModel('');
      }
    }).catch(console.error);
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      await api.post('/api/config', config);
      
      // Update localized state and localStorage
      if (config.language) {
        setLanguage(config.language as Language);
        setLang(config.language as Language);
      }
      
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      alert(t('settings.save.failed', lang));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevert = () => {
    api.get('/api/config').then(res => setConfig(res.data)).catch(console.error);
    api.get('/api/providers').then(res => setProviders(res.data)).catch(console.error);
  };

  const handleAddOverride = () => {
    if (!newOverrideSource || !newOverrideTargetProvider || !newOverrideTargetModel) return;
    const modelOverrides = { ...(config.modelOverrides || {}) };
    modelOverrides[newOverrideSource] = `${newOverrideTargetProvider}/${newOverrideTargetModel}`;
    setConfig({ ...config, modelOverrides });
    setNewOverrideSource('');
  };

  const handleRemoveOverride = (source: string) => {
    const modelOverrides = { ...(config.modelOverrides || {}) };
    delete modelOverrides[source];
    setConfig({ ...config, modelOverrides });
  };

  const handleTargetProviderChange = (provId: string) => {
    setNewOverrideTargetProvider(provId);
    const prov = providers.find((p) => p.id === provId);
    if (prov && prov.models && prov.models.length > 0) {
      setNewOverrideTargetModel(prov.models[0].id);
    } else {
      setNewOverrideTargetModel('');
    }
  };

  const handleAddMcp = () => {
    if (!newMcpName || !newMcpCommand) return;
    const mcpServers = { ...(config.mcpServers || {}) };
    const argsArray = newMcpArgs.trim() ? newMcpArgs.split(/\s+/) : [];
    const envObj: Record<string, string> = {};
    if (newMcpEnv.trim()) {
      const parts = newMcpEnv.split(',');
      parts.forEach(p => {
        const [k, v] = p.split('=');
        if (k && v) envObj[k.trim()] = v.trim();
      });
    }
    mcpServers[newMcpName] = {
      command: newMcpCommand,
      args: argsArray,
      env: Object.keys(envObj).length > 0 ? envObj : undefined
    };
    setConfig({ ...config, mcpServers });
    setNewMcpName('');
    setNewMcpCommand('');
    setNewMcpArgs('');
    setNewMcpEnv('');
  };

  const handleRemoveMcp = (name: string) => {
    const mcpServers = { ...(config.mcpServers || {}) };
    delete mcpServers[name];
    setConfig({ ...config, mcpServers });
  };

  const handleAddPricing = () => {
    if (!newModelId) return;
    const modelPricing = { ...(config.modelPricing || {}) };
    modelPricing[newModelId] = {
      inputPrice: parseFloat(newModelInputPrice) || 0.0,
      outputPrice: parseFloat(newModelOutputPrice) || 0.0
    };
    setConfig({ ...config, modelPricing });
    setNewModelId('');
    setNewModelInputPrice('0.0');
    setNewModelOutputPrice('0.0');
  };

  const handleRemovePricing = (modelId: string) => {
    const modelPricing = { ...(config.modelPricing || {}) };
    delete modelPricing[modelId];
    setConfig({ ...config, modelPricing });
  };

  const handleToggleFallback = (providerId: string) => {
    let list = [...(config.fallbackProviderIds || [])];
    if (list.includes(providerId)) {
      list = list.filter(id => id !== providerId);
    } else {
      list.push(providerId);
    }
    setConfig({ ...config, fallbackProviderIds: list });
  };

  if (!config) return <div className="p-8 text-[var(--color-text-muted)] animate-pulse">{lang === 'en' ? 'Loading configuration...' : '正在加载配置...'}</div>;

  return (
    <div className="animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">{t('settings.title', lang)}</h2>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1.5">{t('settings.desc', lang)}</p>
      </div>

      <div className="space-y-6">
        {/* General Settings Card */}
        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
            <h3 className="text-lg font-bold">{t('settings.general', lang)}</h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Listening Port */}
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.port', lang)}</label>
                <input 
                  type="number" 
                  value={config.port}
                  onChange={e => setConfig({...config, port: parseInt(e.target.value)})}
                  className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors text-sm font-medium"
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('settings.port.desc', lang)}</p>
              </div>

              {/* Language Selection */}
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.lang', lang)}</label>
                <select 
                  value={config.language || 'zh'}
                  onChange={e => setConfig({...config, language: e.target.value})}
                  className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors appearance-none text-sm font-medium"
                >
                  <option value="zh">{t('settings.lang.zh', lang)}</option>
                  <option value="en">{t('settings.lang.en', lang)}</option>
                </select>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">{lang === 'en' ? 'Select your UI language preference.' : '选择用户界面的语言首选项。'}</p>
              </div>

              {/* Log Level */}
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.loglevel', lang)}</label>
                <select 
                  value={config.logLevel}
                  onChange={e => setConfig({...config, logLevel: e.target.value})}
                  className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors appearance-none text-sm font-medium"
                >
                  <option value="debug">{t('settings.loglevel.debug', lang)}</option>
                  <option value="info">{t('settings.loglevel.info', lang)}</option>
                  <option value="warn">{t('settings.loglevel.warn', lang)}</option>
                  <option value="error">{t('settings.loglevel.error', lang)}</option>
                </select>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">{lang === 'en' ? 'Log level for server console logs output.' : '服务控制台日志输出的详细程度级别。'}</p>
              </div>

              {/* Auto Sync Interval */}
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.autoSyncInterval', lang)}</label>
                <select 
                  value={config.autoSyncInterval || 'never'}
                  onChange={e => setConfig({...config, autoSyncInterval: e.target.value})}
                  className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors appearance-none text-sm font-medium"
                >
                  <option value="never">{t('settings.autoSyncInterval.never', lang)}</option>
                  <option value="hourly">{t('settings.autoSyncInterval.hourly', lang)}</option>
                  <option value="daily">{t('settings.autoSyncInterval.daily', lang)}</option>
                </select>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('settings.autoSyncInterval.desc', lang)}</p>
              </div>

              {/* Default Temperature */}
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.defaultTemp', lang)}</label>
                <input 
                  type="number" 
                  step="0.1" 
                  min="0" 
                  max="2"
                  value={config.defaultTemperature !== undefined ? config.defaultTemperature : 0.7}
                  onChange={e => setConfig({...config, defaultTemperature: parseFloat(e.target.value)})}
                  className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors text-sm font-medium"
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('settings.defaultTemp.desc', lang)}</p>
              </div>


            </div>

            {/* Boot Start Simulation (General general setting) */}
            <div className="flex items-center gap-3 pt-4 border-t border-[var(--color-border-base)]">
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={config.autoStart || false}
                  onChange={e => setConfig({...config, autoStart: e.target.checked})}
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:bg-gray-700 peer-checked:bg-[var(--color-primary)]"></div>
              </label>
              <span className="text-sm font-semibold">{t('settings.autostart', lang)}</span>
            </div>
          </div>
        </div>

        {/* Optimizations & Cache Settings Card */}
        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
            <h3 className="text-lg font-bold">{t('settings.cache', lang)}</h3>
          </div>
          
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <label className="relative inline-flex items-center cursor-pointer mt-0.5 shrink-0">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={config.cacheEnabled !== undefined ? config.cacheEnabled : true}
                  onChange={e => setConfig({...config, cacheEnabled: e.target.checked})}
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:bg-gray-700 peer-checked:bg-[var(--color-primary)]"></div>
              </label>
              <div>
                <span className="text-sm font-bold text-[var(--color-text-primary)] block">{t('settings.cache.enable', lang)}</span>
                <p className="text-xs text-[var(--color-text-muted)] mt-1.5 max-w-2xl leading-relaxed">{t('settings.cache.desc', lang)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Disaster Recovery (Failover) Card */}
        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
            <h3 className="text-lg font-bold">{t('settings.fallback', lang)}</h3>
          </div>
          
          <div className="p-6 space-y-4">
            <p className="text-xs text-[var(--color-text-muted)] max-w-2xl leading-relaxed">{t('settings.fallback.desc', lang)}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {providers.map(p => {
                const isChecked = (config.fallbackProviderIds || []).includes(p.id);
                const isActive = config.activeProviderId === p.id;
                return (
                  <div 
                    key={p.id} 
                    onClick={() => !isActive && handleToggleFallback(p.id)}
                    className={`p-3 rounded-xl border flex items-center justify-between transition-colors select-none cursor-pointer ${
                      isActive 
                        ? 'border-[var(--color-border-base)] bg-[var(--color-bg-base)]/30 opacity-60' 
                        : (isChecked ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border-base)] hover:border-[var(--color-primary)]/50')
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold">{p.name}</div>
                      <div className="text-[10px] text-[var(--color-text-muted)] font-mono">{p.id}</div>
                    </div>
                    {isActive ? (
                      <span className="text-[9px] bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-1.5 py-0.5 rounded font-bold">{lang === 'en' ? 'Active' : '当前主节点'}</span>
                    ) : (
                      <input 
                        type="checkbox" 
                        checked={isChecked}
                        readOnly
                        className="rounded border-[var(--color-border-base)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]" 
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Token Pricing Rates Card */}
        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
            <h3 className="text-lg font-bold">{t('settings.pricing', lang)}</h3>
          </div>
          
          <div className="p-6 space-y-4">
            <p className="text-xs text-[var(--color-text-muted)] max-w-2xl leading-relaxed">{t('settings.pricing.desc', lang)}</p>
            
            <div className="border border-[var(--color-border-base)]/50 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--color-bg-base)] text-[var(--color-text-muted)] font-bold border-b border-[var(--color-border-base)]">
                  <tr>
                    <th className="p-3">{lang === 'en' ? 'Model ID' : '模型 ID'}</th>
                    <th className="p-3">{lang === 'en' ? 'Input ($ / M tokens)' : '输入单价 (USD / 百万)'}</th>
                    <th className="p-3">{lang === 'en' ? 'Output ($ / M tokens)' : '输出单价 (USD / 百万)'}</th>
                    <th className="p-3 w-16 text-center">{lang === 'en' ? 'Actions' : '操作'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-base)]/40 font-medium">
                  {Object.entries(config.modelPricing || {}).map(([modelId, rates]: any) => (
                    <tr key={modelId} className="hover:bg-[var(--color-bg-hover)]/30 font-medium text-[var(--color-text-primary)]">
                      <td className="p-3 font-mono">{modelId}</td>
                      <td className="p-3">${rates.inputPrice.toFixed(2)}</td>
                      <td className="p-3">${rates.outputPrice.toFixed(2)}</td>
                      <td className="p-3 text-center">
                        <button 
                          onClick={() => handleRemovePricing(modelId)}
                          className="text-red-500 hover:text-red-600 transition-colors font-bold text-[11px]"
                        >
                          {lang === 'en' ? 'Delete' : '删除'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {Object.keys(config.modelPricing || {}).length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-[var(--color-text-muted)] italic">{lang === 'en' ? 'No custom pricing sheets' : '暂无自定义价格'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Add new rate form */}
            <div className="flex flex-wrap gap-3 items-end p-4 bg-[var(--color-bg-base)]/50 border border-[var(--color-border-base)]/50 rounded-xl">
              <div className="flex-1 min-w-[150px]">
                <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{lang === 'en' ? 'Model ID' : '模型 ID'}</label>
                <input 
                  type="text" 
                  value={newModelId}
                  onChange={e => setNewModelId(e.target.value)}
                  placeholder="e.g. deepseek-chat"
                  className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] font-mono text-[var(--color-text-primary)]"
                />
              </div>
              <div className="w-24">
                <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{lang === 'en' ? 'Input Rate' : '输入价格'}</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={newModelInputPrice}
                  onChange={e => setNewModelInputPrice(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] text-[var(--color-text-primary)]"
                />
              </div>
              <div className="w-24">
                <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{lang === 'en' ? 'Output Rate' : '输出价格'}</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={newModelOutputPrice}
                  onChange={e => setNewModelOutputPrice(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] text-[var(--color-text-primary)]"
                />
              </div>
              <button 
                onClick={handleAddPricing}
                className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Add Sheet' : '添加费率'}
              </button>
            </div>
          </div>
        </div>

        {/* MCP Servers Card */}
        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
            <h3 className="text-lg font-bold">{t('settings.mcp', lang)}</h3>
          </div>
          
          <div className="p-6 space-y-4">
            <p className="text-xs text-[var(--color-text-muted)] max-w-2xl leading-relaxed">{t('settings.mcp.desc', lang)}</p>
            
            <div className="space-y-3">
              {Object.entries(config.mcpServers || {}).map(([name, mcp]: any) => (
                <div key={name} className="p-4 rounded-xl border border-[var(--color-border-base)] bg-[var(--color-bg-base)]/20 flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-[var(--color-text-primary)]">{name}</div>
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      <span className="font-semibold">{lang === 'en' ? 'Cmd:' : '命令:'}</span> <code className="font-mono bg-[var(--color-bg-base)] px-1.5 py-0.5 rounded text-[11px]">{mcp.command} {mcp.args?.join(' ')}</code>
                    </div>
                    {mcp.env && Object.keys(mcp.env).length > 0 && (
                      <div className="text-[10px] text-[var(--color-text-muted)] font-mono">
                        Env: {Object.entries(mcp.env).map(([k, v]) => `${k}=${v}`).join(', ')}
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => handleRemoveMcp(name)}
                    className="text-red-500 hover:text-red-600 transition-colors font-bold text-xs"
                  >
                    {lang === 'en' ? 'Remove' : '移除'}
                  </button>
                </div>
              ))}
              {Object.keys(config.mcpServers || {}).length === 0 && (
                <div className="text-center p-6 bg-[var(--color-bg-base)]/30 border border-dashed border-[var(--color-border-base)]/80 rounded-xl text-xs text-[var(--color-text-muted)] italic">
                  {lang === 'en' ? 'No MCP servers configured.' : '未配置任何 MCP 服务器。'}
                </div>
              )}
            </div>

            {/* Add MCP server form */}
            <div className="p-4 bg-[var(--color-bg-base)]/50 border border-[var(--color-border-base)]/50 rounded-xl space-y-3">
              <h4 className="text-xs font-bold text-[var(--color-text-primary)]">{lang === 'en' ? 'Add MCP Server node' : '新建 MCP 服务节点'}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{lang === 'en' ? 'Unique Name' : '节点唯一标识'}</label>
                  <input 
                    type="text" 
                    value={newMcpName}
                    onChange={e => setNewMcpName(e.target.value)}
                    placeholder="e.g. everything"
                    className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] font-mono text-[var(--color-text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{lang === 'en' ? 'Command' : '可执行文件命令'}</label>
                  <input 
                    type="text" 
                    value={newMcpCommand}
                    onChange={e => setNewMcpCommand(e.target.value)}
                    placeholder="e.g. npx or node"
                    className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] font-mono text-[var(--color-text-primary)]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{lang === 'en' ? 'Arguments (Space separated)' : '启动参数 (空格分隔)'}</label>
                  <input 
                    type="text" 
                    value={newMcpArgs}
                    onChange={e => setNewMcpArgs(e.target.value)}
                    placeholder="e.g. -y @modelcontextprotocol/server-everything"
                    className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] font-mono text-[var(--color-text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{lang === 'en' ? 'Env (Comma separated KEY=VAL)' : '环境变量 (逗号分隔 KEY=VAL)'}</label>
                  <input 
                    type="text" 
                    value={newMcpEnv}
                    onChange={e => setNewMcpEnv(e.target.value)}
                    placeholder="e.g. API_KEY=abc,NODE_ENV=production"
                    className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] font-mono text-[var(--color-text-primary)]"
                  />
                </div>
              </div>
              <button 
                onClick={handleAddMcp}
                className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Add MCP Server' : '添加 MCP 服务'}
              </button>
            </div>
          </div>
        </div>

        {/* Model Overrides Card */}
        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
            <h3 className="text-lg font-bold">{t('settings.overrides', lang)}</h3>
          </div>
          
          <div className="p-6 space-y-4">
            <p className="text-xs text-[var(--color-text-muted)] max-w-2xl leading-relaxed">{t('settings.overrides.desc', lang)}</p>
            
            <div className="space-y-3">
              {Object.entries(config?.modelOverrides || {}).map(([source, target]: any) => (
                <div key={source} className="p-4 rounded-xl border border-[var(--color-border-base)] bg-[var(--color-bg-base)]/20 flex justify-between items-center">
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-[var(--color-text-primary)]">{source}</div>
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      <span className="font-semibold">{lang === 'en' ? 'Redirects to:' : '重定向至:'}</span> <code className="font-mono bg-[var(--color-bg-base)] px-1.5 py-0.5 rounded text-[11px]">{target}</code>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleRemoveOverride(source)}
                    className="text-red-500 hover:text-red-600 transition-colors font-bold text-xs"
                  >
                    {lang === 'en' ? 'Remove' : '移除'}
                  </button>
                </div>
              ))}
              {Object.keys(config?.modelOverrides || {}).length === 0 && (
                <div className="text-center p-6 bg-[var(--color-bg-base)]/30 border border-dashed border-[var(--color-border-base)]/80 rounded-xl text-xs text-[var(--color-text-muted)] italic">
                  {t('settings.overrides.empty', lang)}
                </div>
              )}
            </div>

            {/* Add model override form */}
            <div className="p-4 bg-[var(--color-bg-base)]/50 border border-[var(--color-border-base)]/50 rounded-xl space-y-3">
              <h4 className="text-xs font-bold text-[var(--color-text-primary)]">{lang === 'en' ? 'Add model override mapping' : '新建模型映射重定向'}</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{t('settings.overrides.original', lang)}</label>
                  <input 
                    type="text" 
                    value={newOverrideSource}
                    onChange={e => setNewOverrideSource(e.target.value)}
                    placeholder="e.g. gpt-4o"
                    className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] font-mono text-[var(--color-text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{lang === 'en' ? 'Target Provider' : '目标供应商'}</label>
                  <select 
                    value={newOverrideTargetProvider}
                    onChange={e => handleTargetProviderChange(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] text-[var(--color-text-primary)]"
                  >
                    {providers.filter((p: any) => p.configured).map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    {providers.filter((p: any) => p.configured).length === 0 && (
                      <option value="">{lang === 'en' ? 'No configured providers' : '无已配置的供应商'}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[var(--color-text-muted)] mb-1">{lang === 'en' ? 'Target Model' : '目标映射模型'}</label>
                  <select 
                    value={newOverrideTargetModel}
                    onChange={e => setNewOverrideTargetModel(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] text-[var(--color-text-primary)]"
                  >
                    {providers.find((p: any) => p.id === newOverrideTargetProvider)?.models?.map((m: any) => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    )) || <option value="">{lang === 'en' ? 'No models' : '无模型'}</option>}
                  </select>
                </div>
              </div>
              <button 
                onClick={handleAddOverride}
                className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                {t('settings.overrides.add', lang)}
              </button>
            </div>
          </div>
        </div>

        {/* Save & Cancel Buttons */}
        <div className="flex justify-end gap-4">
          <button 
            onClick={handleRevert}
            className="px-6 py-2.5 rounded-xl border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)] text-sm font-bold text-[var(--color-text-secondary)] transition-colors flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" /> {t('settings.revert', lang)}
          </button>
          
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className={`px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all flex items-center gap-2 shadow-sm cursor-pointer ${
              saved ? 'bg-green-600 shadow-green-600/20' : 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] shadow-[var(--color-primary)]/20'
            } disabled:opacity-50`}
          >
            {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? t('settings.save.success', lang) : (isSaving ? t('settings.saving', lang) : t('settings.save', lang))}
          </button>
        </div>
      </div>
    </div>
  );
}
