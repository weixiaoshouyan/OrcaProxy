// GeneralSettingsForm.tsx — shared general-settings form used by both the
// /settings page (right pane) and the Settings modal (embedded right pane).
import { useEffect, useState } from 'react';
import { translate as t } from '../i18n';
import type { Language } from '../i18n';
import type { AppConfig } from '../types';
import { getElectronStatus, setAutostart } from '../api';
import { useToast } from './Toast';

interface Props {
  config: AppConfig;
  setConfig: (c: AppConfig) => void;
  lang: Language;
  isDark: boolean;
  toggleTheme: () => void;
  accent: string;
  setAccent: (a: string) => void;
  theme: string;
  setTheme: (t: string) => void;
}

export default function GeneralSettingsForm({ config, setConfig, lang, isDark, toggleTheme, accent, setAccent, theme, setTheme }: Props) {
  const toast = useToast();
  // True when running inside the Electron desktop shell (autostart actually applies).
  const [isElectron, setIsElectron] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  // Sync the autostart switch with the real OS-level login-item state once.
  useEffect(() => {
    let cancelled = false;
    getElectronStatus().then((status) => {
      if (cancelled) return;
      setIsElectron(!!status.isElectron);
      if (status.isElectron && status.supported) {
        setConfig({ ...config, autoStart: !!status.autostart });
      }
    }).catch(() => { /* non-Electron or API unavailable — keep config value */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAutostartToggle = async (checked: boolean) => {
    setConfig({ ...config, autoStart: checked });
    if (!isElectron) return; // plain browser: store the preference only
    setAutostartBusy(true);
    try {
      const r = await setAutostart(checked);
      if (!r.ok) {
        toast.error(t('settings.autostart.failed', lang), r.error);
        setConfig({ ...config, autoStart: !checked });
      }
    } catch (e) {
      toast.error(t('settings.autostart.failed', lang), String(e));
      setConfig({ ...config, autoStart: !checked });
    } finally {
      setAutostartBusy(false);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-bold mb-4">{lang === 'en' ? 'General Settings' : '通用设置'}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.port', lang)}</label>
          <input type="number" value={config.port} onChange={e => setConfig({...config, port: parseInt(e.target.value)})} className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors text-sm font-medium" />
          <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('settings.port.desc', lang)}</p>
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.lang', lang)}</label>
          <select value={config.language || 'zh'} onChange={e => setConfig({...config, language: e.target.value as 'zh' | 'en'})} className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors appearance-none text-sm font-medium">
            <option value="zh">{t('settings.lang.zh', lang)}</option>
            <option value="en">{t('settings.lang.en', lang)}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.loglevel', lang)}</label>
          <select value={config.logLevel} onChange={e => setConfig({...config, logLevel: e.target.value})} className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors appearance-none text-sm font-medium">
            <option value="debug">{t('settings.loglevel.debug', lang)}</option>
            <option value="info">{t('settings.loglevel.info', lang)}</option>
            <option value="warn">{t('settings.loglevel.warn', lang)}</option>
            <option value="error">{t('settings.loglevel.error', lang)}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.autoSyncInterval', lang)}</label>
          <select value={config.autoSyncInterval || 'never'} onChange={e => setConfig({...config, autoSyncInterval: e.target.value})} className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors appearance-none text-sm font-medium">
            <option value="never">{t('settings.autoSyncInterval.never', lang)}</option>
            <option value="hourly">{t('settings.autoSyncInterval.hourly', lang)}</option>
            <option value="daily">{t('settings.autoSyncInterval.daily', lang)}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.defaultTemp', lang)}</label>
          <input type="number" step="0.1" min="0" max="2" value={config.defaultTemperature !== undefined ? config.defaultTemperature : 0.7} onChange={e => setConfig({...config, defaultTemperature: parseFloat(e.target.value)})} className="w-full px-4 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] transition-colors text-sm font-medium" />
        </div>
        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={config.autoStart || false} disabled={autostartBusy} onChange={e => handleAutostartToggle(e.target.checked)} />
            <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:bg-gray-700 peer-checked:bg-[var(--color-primary)]"></div>
          </label>
          <div>
            <span className="text-sm font-semibold">{t('settings.autostart', lang)}</span>
            {!isElectron && (
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{t('settings.autostart.desktopOnly', lang)}</p>
            )}
          </div>
        </div>
      </div>
      <div className="mt-6 pt-4 border-t border-[var(--color-border-base)]">
        <div className="flex items-start gap-3">
          <label className="relative inline-flex items-center cursor-pointer mt-0.5 shrink-0">
            <input type="checkbox" className="sr-only peer" checked={config.cacheEnabled !== undefined ? config.cacheEnabled : true} onChange={e => setConfig({...config, cacheEnabled: e.target.checked})} />
            <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:bg-gray-700 peer-checked:bg-[var(--color-primary)]"></div>
          </label>
          <div>
            <span className="text-sm font-bold text-[var(--color-text-primary)] block">{t('settings.cache.enable', lang)}</span>
            <p className="text-xs text-[var(--color-text-muted)] mt-1.5 max-w-2xl leading-relaxed">{t('settings.cache.desc', lang)}</p>
          </div>
        </div>
      </div>

      {/* Appearance — theme mode / accent / presets */}
      <div className="mt-6 pt-4 border-t border-[var(--color-border-base)]">
        <h4 className="text-sm font-bold text-[var(--color-text-primary)] mb-3">
          {lang === 'en' ? 'Appearance' : '外观'}
        </h4>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm font-semibold text-[var(--color-text-secondary)]">
            {lang === 'en' ? 'Theme mode' : '外观模式'}
          </span>
          <button
            onClick={toggleTheme}
            className="px-3 py-1.5 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-base)] text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer"
          >
            {isDark
              ? (lang === 'en' ? 'Dark' : '深色')
              : (lang === 'en' ? 'Light' : '浅色')}
          </button>
        </div>
        <div className="flex items-center gap-1.5 mb-4">
          {[
            { id: 'green', cls: 'bg-green-500' },
            { id: 'blue', cls: 'bg-blue-500' },
            { id: 'purple', cls: 'bg-purple-500' },
            { id: 'amber', cls: 'bg-amber-500' },
            { id: 'rose', cls: 'bg-rose-500' },
            { id: 'teal', cls: 'bg-teal-500' },
            { id: 'slate', cls: 'bg-slate-500' },
            { id: 'nocturne', cls: 'bg-indigo-500' },
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => setAccent(c.id)}
              className={`w-5 h-5 rounded-full ${c.cls} transition-all cursor-pointer ${
                accent === c.id ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg-base)] ring-[var(--color-text-secondary)] scale-110' : 'opacity-60 hover:opacity-100'
              }`}
              title={c.id}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-w-md">
          {[
            { id: 'classic', label: lang === 'en' ? 'Classic' : '经典' },
            { id: 'dracula', label: 'Dracula' },
            { id: 'nord', label: 'Nord' },
            { id: 'catppuccin', label: 'Catppuccin' },
            { id: 'one-dark', label: 'One Dark' },
            { id: 'midnight', label: 'Midnight' },
            { id: 'solarized', label: 'Solarized' },
          ].map((th) => (
            <button
              key={th.id}
              onClick={() => setTheme(th.id)}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                theme === th.id
                  ? 'bg-[var(--color-primary)]/15 border-[var(--color-primary)]/50 text-[var(--color-primary)]'
                  : 'bg-[var(--color-bg-base)] border-[var(--color-border-base)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
              }`}
            >
              {th.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
