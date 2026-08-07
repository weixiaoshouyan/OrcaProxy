import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Language } from '../i18n';
import { Search, Plus, Trash2, Edit, Save, X, BookOpen, Terminal, Sparkles, FileCode } from 'lucide-react';
import { useToast } from '../components/Toast';

interface SkillSummary {
  id: string;
  name: string;
  description: string;
}

interface SkillDetail extends SkillSummary {
  instructions: string;
  scripts: string[];
  references: string[];
}

interface SkillsProps {
  lang: Language;
}

export default function Skills({ lang }: SkillsProps) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const toast = useToast();

  // Edit states
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>('');
  const [editDesc, setEditDesc] = useState<string>('');
  const [editInstructions, setEditInstructions] = useState<string>('');

  // Import states
  const [isImporting, setIsImporting] = useState<boolean>(false);

  const fetchSkills = (selectIdAfterLoad?: string) => {
    setLoadingList(true);
    api.get('/api/skills')
      .then(res => {
        setSkills(res.data);
        if (res.data.length > 0) {
          const targetId = selectIdAfterLoad || res.data[0].id;
          setSelectedSkillId(targetId);
        } else {
          setSelectedSkill(null);
        }
        setLoadingList(false);
      })
      .catch(err => {
        console.error('Failed to fetch skills:', err);
        setLoadingList(false);
      });
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  useEffect(() => {
    if (!selectedSkillId) return;
    setLoadingDetail(true);
    setIsEditing(false);
    api.get(`/api/skills/${selectedSkillId}`)
      .then(res => {
        setSelectedSkill(res.data);
        setEditName(res.data.name);
        setEditDesc(res.data.description);
        setEditInstructions(res.data.instructions);
        setLoadingDetail(false);
      })
      .catch(err => {
        console.error('Failed to fetch skill details:', err);
        setLoadingDetail(false);
      });
  }, [selectedSkillId]);

  const handleSaveEdit = () => {
    if (!selectedSkillId) return;
    api.put(`/api/skills/${selectedSkillId}`, {
      name: editName,
      description: editDesc,
      instructions: editInstructions
    })
      .then(() => {
        setIsEditing(false);
        // Refresh detail and list
        fetchSkills(selectedSkillId);
      })
      .catch(err => {
        toast.error(err.response?.data?.error || '保存修改失败');
      });
  };

  const handleDeleteSkill = () => {
    if (!selectedSkillId) return;
    const confirmMsg = lang === 'en' 
      ? `Are you sure you want to delete skill "${selectedSkill?.name || selectedSkillId}"? This will physically remove the directory and all of its scripts.`
      : `您确定要删除技能“${selectedSkill?.name || selectedSkillId}”吗？这将彻底物理删除该目录及其下的所有自动化脚本和配置。`;

    if (confirm(confirmMsg)) {
      api.delete(`/api/skills/${selectedSkillId}`)
        .then(() => {
          setSelectedSkillId('');
          fetchSkills();
        })
        .catch(err => {
          toast.error(err.response?.data?.error || '删除技能失败');
        });
    }
  };

  const handleImportSkill = () => {
    setIsImporting(true);
    api.post('/api/skills/import')
      .then(res => {
        setIsImporting(false);
        if (res.data.cancelled) {
          return;
        }
        if (res.data.ok && res.data.id) {
          // Reload list and select imported skill
          fetchSkills(res.data.id);
        }
      })
      .catch(err => {
        setIsImporting(false);
        toast.error(err.response?.data?.error || '导入技能失败');
      });
  };

  const filteredSkills = skills.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="h-full flex flex-col select-none relative animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto p-1">
      {/* Header */}
      <div className="mb-6 flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
            {lang === 'en' ? 'Agent Skills Library' : '智能体技能库'}
          </h2>
          <p className="text-[14px] text-[var(--color-text-secondary)] mt-1.5">
            {lang === 'en' 
              ? 'Manage default skills or register custom prompts/scripts for the coding agent.' 
              : '管理内置初始技能，或为您电脑上的智能体注册自定义 Prompt 指令及自动化控制脚本。'}
          </p>
        </div>
      </div>

      {/* Main content grid */}
      <div className="flex-1 min-h-0 flex gap-6">
        {/* Left pane: Skills list */}
        <div className="w-80 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl p-4 flex flex-col shrink-0 h-full">
          <div className="relative mb-4 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder={lang === 'en' ? 'Search skills...' : '搜索技能...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[var(--color-bg-base)] border border-[var(--color-border-base)] rounded-xl text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)] transition-colors font-medium placeholder-gray-400"
            />
          </div>

          {/* List area */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5 pr-0.5">
            {loadingList ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
                <div className="w-6 h-6 border-2 border-t-[var(--color-primary)] border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
                <span className="text-xs font-semibold">加载技能中...</span>
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="text-center py-20 text-xs font-bold text-[var(--color-text-muted)]">
                {lang === 'en' ? 'No skills found' : '未找到匹配的技能'}
              </div>
            ) : (
              filteredSkills.map(skill => (
                <div
                  key={skill.id}
                  onClick={() => setSelectedSkillId(skill.id)}
                  className={`p-3.5 rounded-xl border transition-all duration-300 cursor-pointer ${
                    selectedSkillId === skill.id
                      ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)]/40 shadow-sm'
                      : 'bg-transparent border-transparent hover:bg-[var(--color-bg-hover)]'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={`text-[13px] font-bold truncate pr-2 ${
                      selectedSkillId === skill.id ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'
                    }`}>
                      {skill.name}
                    </span>
                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] font-mono shrink-0 uppercase">
                      {skill.id}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-secondary)] line-clamp-2 leading-relaxed">
                    {skill.description || (lang === 'en' ? 'No description' : '暂无简述')}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* Bottom import triggers */}
          <button
            onClick={handleImportSkill}
            disabled={isImporting}
            className="w-full flex items-center justify-center gap-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-xl py-2.5 text-xs font-bold shadow-md cursor-pointer transition-all duration-300 shrink-0 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'en' ? 'Import External Skill' : '导入外部技能'}</span>
          </button>
        </div>

        {/* Right pane: Skill console */}
        <div className="flex-1 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl p-6 flex flex-col h-full overflow-hidden">
          {loadingDetail ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
              <div className="w-8 h-8 border-2 border-t-[var(--color-primary)] border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
              <span className="text-xs font-semibold">正在载入技能数据...</span>
            </div>
          ) : !selectedSkill ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--color-text-muted)] text-center max-w-sm mx-auto gap-4">
              <div className="p-4 bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)] rounded-2xl text-[var(--color-text-muted)]">
                <BookOpen className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[var(--color-text-primary)] mb-1">
                  {lang === 'en' ? 'No Skill Selected' : '未选中技能'}
                </h3>
                <p className="text-xs font-semibold">
                  {lang === 'en' ? 'Please select a skill from the list on the left to manage it.' : '请在左侧列表中选择一项技能，开始对其配置、修改或添加自动化控制。'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Top Detail Card Header */}
              <div className="flex items-start justify-between border-b border-[var(--color-border-base)]/55 pb-4 mb-4 shrink-0">
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="bg-[var(--color-bg-base)] border border-[var(--color-border-base)] rounded-lg px-2.5 py-1 text-base font-bold text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)]"
                        placeholder="输入技能名称"
                      />
                    ) : (
                      <h3 className="text-lg font-bold text-[var(--color-text-primary)] truncate">
                        {selectedSkill.name}
                      </h3>
                    )}
                    <span className="px-2 py-0.5 rounded bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)] text-[10px] font-mono font-bold text-[var(--color-text-secondary)]">
                      ID: {selectedSkill.id}
                    </span>
                  </div>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-base)] rounded-lg px-2.5 py-1 text-xs text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]"
                      placeholder="输入技能简述"
                    />
                  ) : (
                    <p className="text-xs font-semibold text-[var(--color-text-secondary)] line-clamp-1">
                      {selectedSkill.description || '暂无简述'}
                    </p>
                  )}
                </div>

                {/* Edit & Delete Action Buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleSaveEdit}
                        className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-sm"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>保存</span>
                      </button>
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          setEditName(selectedSkill.name);
                          setEditDesc(selectedSkill.description);
                          setEditInstructions(selectedSkill.instructions);
                        }}
                        className="flex items-center gap-1 bg-gray-500 hover:bg-gray-600 text-white rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-sm"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>取消</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex items-center gap-1 bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer transition-all shadow-sm"
                      >
                        <Edit className="w-3.5 h-3.5 text-blue-500" />
                        <span>编辑技能</span>
                      </button>
                      <button
                        onClick={handleDeleteSkill}
                        className="flex items-center gap-1 bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)] hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500 rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer transition-all shadow-sm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>删除</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Main Content Area (Instructions + Scripts) */}
              <div className="flex-1 overflow-y-auto min-h-0 space-y-5 pr-1 font-sans">
                {/* 1. Skill Instructions */}
                <div>
                  <h4 className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    {lang === 'en' ? 'Skill Instructions (Prompt)' : '技能 Prompt 指令说明'}
                  </h4>
                  {isEditing ? (
                    <textarea
                      value={editInstructions}
                      onChange={(e) => setEditInstructions(e.target.value)}
                      rows={12}
                      className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-base)] rounded-xl p-3.5 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)] font-mono resize-y"
                      placeholder="在这里填写大模型激活此技能时应读取的 Prompt 指令..."
                    />
                  ) : (
                    <div className="bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)] rounded-xl p-4 text-[12.5px] leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap font-medium">
                      {selectedSkill.instructions || (lang === 'en' ? 'No instructions defined.' : '此技能未配置 Prompt 指令。')}
                    </div>
                  )}
                </div>

                {/* 2. Automation Scripts */}
                <div>
                  <h4 className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                    {lang === 'en' ? 'Associated Executable Scripts' : '关联的自动化脚本 (scripts/)'}
                  </h4>
                  {selectedSkill.scripts.length === 0 ? (
                    <div className="p-4 rounded-xl border border-[var(--color-border-base)]/50 border-dashed text-center text-xs text-[var(--color-text-muted)] font-bold">
                      {lang === 'en' 
                        ? 'No associated scripts found. Put python/node scripts inside folders scripts/ directory.'
                        : '暂无关联脚本。用户可以直接在磁盘该技能目录的 scripts/ 文件夹下放入 python (*.py) 或 node (*.js) 自动化代码，即可在对话中由智能体调用。'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 select-text">
                      {selectedSkill.scripts.map(script => (
                        <div key={script} className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)]">
                          <FileCode className="w-4 h-4 text-emerald-500 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-[var(--color-text-primary)] truncate font-mono">{script}</div>
                            <div className="text-[10px] font-bold text-[var(--color-text-muted)] font-mono uppercase">
                              {script.endsWith('.py') ? 'python script' : 'node script'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Importing Skill Loading Overlay */}
      {isImporting && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-card)]/80 border border-[var(--color-border-base)]/50 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative text-center backdrop-blur-xl animate-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="w-12 h-12 border-4 border-t-[var(--color-primary)] border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
              <div>
                <h3 className="text-sm font-bold text-[var(--color-text-primary)] mb-1">
                  {lang === 'en' ? 'Importing Skill...' : '正在导入技能...'}
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  {lang === 'en'
                    ? 'Please select the README.md or SKILL.md file of the skill in the popup window.'
                    : '请在系统弹出的窗口中选择已下载技能的 README.md 或 SKILL.md 文件...'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
