import { useEffect, useRef, useState } from 'react';
import {
  Settings, X, FolderPlus, Loader2, Trash2, Image as ImageIcon, FolderKanban, Plus, FolderOpen, EyeOff, Eye, SlidersHorizontal, RefreshCw, Sun, Moon,
} from 'lucide-react';
import { Folder, ImportProgress, OrganizeCategory, Theme } from '../types';
import { api } from '../api';
import './SettingsModal.css';
import { useAppFeedback } from './AppFeedback';

interface SettingsModalProps {
  onClose: () => void;
  // 媒体库
  onImport: () => void;
  importing: boolean;
  importProgress: ImportProgress | null;
  onClearCache: () => void;
  onRefreshLibrary: () => void;
  refreshing: boolean;
  hiddenFolders: Folder[];
  onRestoreHiddenFolder: (folder: Folder) => void;
  // 外观
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  backgroundImagePath: string | null;
  backgroundOpacity: number;
  onSelectBackground: () => void;
  onClearBackground: () => void;
  onBackgroundOpacityChange: (value: number) => void;
  toolbarOpacity: number;
  onToolbarOpacityChange: (value: number) => void;
  toolbarBlur: number;
  onToolbarBlurChange: (value: number) => void;
  organizeCategories: OrganizeCategory[];
  onCreateOrganizeCategory: (name: string) => void;
  onDeleteOrganizeCategory: (categoryId: number) => void;
  onToggleOrganizeCategory: (categoryId: number, enabled: boolean) => void;
  organizeOutputPath: string | null;
  onSelectOrganizeOutputFolder: () => void;
  onClearOrganizeOutputFolder: () => void;
  onOrganizeFolder: () => void;
  organizing: boolean;
}

const ICON = { size: 16, strokeWidth: 1.75 } as const;
type SettingsSection = 'all' | 'hidden' | 'library' | 'organize' | 'appearance';
const DEFAULT_SETTINGS_TAB_ORDER: SettingsSection[] = ['all', 'hidden', 'library', 'organize', 'appearance'];
const SETTINGS_TAB_LABELS: Record<SettingsSection, string> = {
  all: '全部', hidden: '隐藏目录', library: '媒体库', organize: '视频整理', appearance: '外观',
};

function organizeFolderName(outputPath: string | null): string {
  if (!outputPath) return 'VideoPlayer整理';
  const normalized = outputPath.replace(/\//g, '\\').replace(/[\\]+$/, '');
  const segments = normalized.split('\\').filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  return /^[A-Za-z]:$/.test(name) ? 'VideoPlayer整理' : name || 'VideoPlayer整理';
}

export function SettingsModal(props: SettingsModalProps) {
  const { confirm: confirmDialog } = useAppFeedback();
  const {
    onClose, onImport, importing, importProgress, onClearCache, onRefreshLibrary, refreshing,
    hiddenFolders, onRestoreHiddenFolder,
    theme, onThemeChange,
    backgroundImagePath, backgroundOpacity, onSelectBackground, onClearBackground,
    onBackgroundOpacityChange, toolbarOpacity, onToolbarOpacityChange,
    toolbarBlur, onToolbarBlurChange, organizeCategories,
    onCreateOrganizeCategory, onDeleteOrganizeCategory, onToggleOrganizeCategory,
    organizeOutputPath, onSelectOrganizeOutputFolder, onClearOrganizeOutputFolder,
    onOrganizeFolder, organizing,
  } = props;
  const [newCategoryName, setNewCategoryName] = useState('');
  const [activeSection, setActiveSection] = useState<SettingsSection>('all');
  const [tabOrder, setTabOrder] = useState<SettingsSection[]>(DEFAULT_SETTINGS_TAB_ORDER);
  const [draggingTab, setDraggingTab] = useState<SettingsSection | null>(null);
  const settingsContentRef = useRef<HTMLDivElement>(null);
  const [settingsHasMore, setSettingsHasMore] = useState(false);

  useEffect(() => {
    void api.getSetting('settingsTabOrder').then((saved) => {
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved) as unknown;
        if (Array.isArray(parsed) && parsed.length === DEFAULT_SETTINGS_TAB_ORDER.length
          && parsed.every((item) => DEFAULT_SETTINGS_TAB_ORDER.includes(item as SettingsSection))) {
          setTabOrder(parsed as SettingsSection[]);
        }
      } catch { /* ignore invalid preference */ }
    });
  }, []);

  const moveTab = (from: SettingsSection, to: SettingsSection) => {
    if (from === to) return;
    setTabOrder((prev) => {
      const next = [...prev];
      const fromIndex = next.indexOf(from);
      const toIndex = next.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return prev;
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, from);
      void api.setSetting('settingsTabOrder', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    const element = settingsContentRef.current;
    if (!element) return;
    const update = () => {
      const canScroll = element.scrollHeight > element.clientHeight + 2;
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
      setSettingsHasMore(canScroll && atBottom);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      resizeObserver.disconnect();
    };
  }, [activeSection, tabOrder]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="settings-overlay"
      onMouseDown={(e) => {
        // Only clicks on the scrim itself close the drawer; controls inside remain interactive.
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <aside
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <div className="settings-head-brand">
            <div className="settings-head-icon"><Settings size={19} strokeWidth={1.8} /></div>
            <div>
              <div className="settings-eyebrow">WORKSPACE SETTINGS</div>
              <div className="settings-title-row"><h2 className="settings-title" id="settings-title">设置中心</h2><span className="settings-version">v{__APP_VERSION__}</span><span className="settings-status">● 在线就绪</span></div>
              <p className="settings-subtitle">把媒体库整理成更顺手的工作空间</p>
            </div>
          </div>
          <button type="button" className="settings-close" onClick={onClose} title="关闭 (Esc)" aria-label="关闭设置">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            <div className="settings-nav-label">设置分类</div>
            {tabOrder.map((section) => (
              <button
                key={section}
                type="button"
                draggable
                className={`settings-nav-item${activeSection === section ? ' is-active' : ''}${draggingTab === section ? ' is-dragging' : ''}`}
                onClick={() => setActiveSection(section)}
                onDragStart={(event) => {
                  setDraggingTab(section);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', section);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  moveTab(draggingTab ?? event.dataTransfer.getData('text/plain') as SettingsSection, section);
                  setDraggingTab(null);
                }}
                onDragEnd={() => setDraggingTab(null)}
                title="拖动调整标签顺序"
              >
                <span>{SETTINGS_TAB_LABELS[section]}</span><small>拖动排序</small>
              </button>
            ))}
            <div className="settings-nav-footer"><SlidersHorizontal {...ICON} /> 偏好设置会自动保存</div>
          </nav>

          <div ref={settingsContentRef} className={`settings-content settings-content-${activeSection}`}>

        {/* 隐藏目录 */}
        <div className="settings-section settings-panel-hidden">
          <div className="settings-section-heading">
            <div className="settings-section-icon"><EyeOff size={16} /></div>
            <div>
              <div className="settings-section-title">隐藏目录</div>
              <div className="settings-section-description">从日常浏览中收起，不删除任何媒体文件。</div>
            </div>
          </div>
          <div className="settings-callout">
            <EyeOff size={14} />
            <span>隐藏目录不会出现在目录树、文件列表和统计中，导入记录、收藏、分类及缩略图都会保留。</span>
          </div>
          {hiddenFolders.length === 0 ? (
            <div className="settings-hint">暂无隐藏目录。可在左侧目录上右键，选择“隐藏目录及子目录”。</div>
          ) : (
            <div className="settings-hidden-folder-list">
              {hiddenFolders.map((folder) => (
                <div className="settings-hidden-folder-item" key={folder.id}>
                  <EyeOff {...ICON} />
                  <div className="settings-hidden-folder-info">
                    <span className="settings-hidden-folder-name">{folder.name}</span>
                    <span className="settings-hidden-folder-path" title={folder.path}>{folder.path}</span>
                  </div>
                  <button
                    className="settings-mini-btn"
                    onClick={() => onRestoreHiddenFolder(folder)}
                    title="恢复显示目录"
                  >
                    <Eye size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 媒体库 */}
        <div className="settings-section settings-panel-library">
          <div className="settings-section-heading">
            <div className="settings-section-icon"><FolderPlus size={16} /></div>
            <div>
              <div className="settings-section-title">媒体库</div>
              <div className="settings-section-description">导入来源、索引和本地缓存。</div>
            </div>
          </div>
          <div className="settings-action-card">
            <div className="settings-action-copy">
              <strong>添加媒体来源</strong>
              <span>支持视频、音频、小说和漫画图片文件夹</span>
            </div>
            <button
              className="settings-btn settings-btn-primary"
              onClick={onImport}
              disabled={importing}
            >
              {importing
                ? <><Loader2 {...ICON} className="spin" /> 导入中...</>
                : <><FolderPlus {...ICON} /> 导入文件夹</>}
            </button>
          </div>
          {importing && importProgress && (
            <div>
              <div className="settings-hint">
                扫描中: {importProgress.current} / {importProgress.total} — {importProgress.file}
              </div>
              <div className="settings-progress-track">
                <div
                  className="settings-progress-fill"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          <div className="settings-action-card settings-action-card-danger" style={{ marginTop: 10 }}>
            <div className="settings-action-copy">
              <strong>清理媒体库缓存</strong>
              <span>删除索引、目录、标签和缩略图，源文件不会受影响</span>
            </div>
            <button className="settings-btn settings-btn-danger" onClick={onClearCache}>
              <Trash2 {...ICON} /> 清除缓存
            </button>
          </div>
          <div className="settings-action-card">
            <div className="settings-action-copy">
              <strong>检查失效媒体</strong>
              <span>扫描磁盘并清理已被其他程序删除的媒体记录</span>
            </div>
            <button className="settings-btn" onClick={onRefreshLibrary} disabled={refreshing || importing}>
              <RefreshCw {...ICON} className={refreshing ? 'spin' : undefined} /> {refreshing ? '检查中…' : '开始检查'}
            </button>
          </div>
        </div>

        {/* 整理分类 */}
        <div className="settings-section settings-panel-organize">
          <div className="settings-section-heading">
            <div className="settings-section-icon"><FolderKanban size={16} /></div>
            <div>
              <div className="settings-section-title">视频整理</div>
              <div className="settings-section-description">用分类建立清晰的目标目录，停用分类不会清除已有标记。</div>
            </div>
          </div>
          <div className="settings-row settings-organize-action">
            <button
              className="settings-btn settings-btn-primary"
              disabled={organizing || organizeCategories.length === 0}
              onClick={onOrganizeFolder}
            >
              {organizing ? <><Loader2 {...ICON} className="spin" /> 整理中...</> : <><FolderKanban {...ICON} /> 整理全部已分类视频</>}
            </button>
            <span className="settings-hint">
              按当前分类记录整理全部视频；未分类视频不会移动
            </span>
          </div>
          <div className="settings-subsection-label">整理位置</div>
          <div className="settings-row settings-organize-output">
            <button className="settings-btn" onClick={onSelectOrganizeOutputFolder}>
              <FolderOpen {...ICON} /> {organizeOutputPath ? '更换整理位置' : '选择整理位置'}
            </button>
            {organizeOutputPath && (
              <button
                className="settings-btn"
                onClick={onClearOrganizeOutputFolder}
                title="清除集中整理位置"
              >
                <X {...ICON} /> 使用当前目录
              </button>
            )}
          </div>
          <div className="settings-path-card" title={organizeOutputPath ?? undefined}>
            <FolderOpen size={14} />
            <span>
            {organizeOutputPath
              ? `集中整理位置：${organizeOutputPath}；不同盘符会在各自盘符根目录的「${organizeFolderName(organizeOutputPath)}」下整理，避免跨盘复制。`
              : '未设置集中位置，将按文件所在盘符在盘符根目录的「VideoPlayer整理」下创建分类文件夹。'}
            </span>
          </div>
          <div className="settings-hint settings-note">同名目标文件会直接覆盖；跨盘文件会按盘符分别处理。</div>
          <div className="settings-subsection-label">分类</div>
          <div className="settings-category-list">
            {organizeCategories.length === 0 && (
              <div className="settings-hint">还没有预设分类。</div>
            )}
            {organizeCategories.map((category) => (
              <div className={`settings-category-item${category.enabled === 0 ? ' is-disabled' : ''}`} key={category.id}>
                <FolderKanban {...ICON} />
                <span className="settings-category-name">{category.name}</span>
                <span className="settings-category-count">{category.count ?? 0}</span>
                <button
                  type="button"
                  className={`settings-switch${category.enabled === 0 ? '' : ' is-on'}`}
                  title={category.enabled === 0 ? '启用分类' : '停用分类'}
                  aria-label={category.enabled === 0 ? `启用分类：${category.name}` : `停用分类：${category.name}`}
                  aria-pressed={category.enabled !== 0}
                  onClick={() => onToggleOrganizeCategory(category.id, category.enabled === 0)}
                >
                  <span className="settings-switch-thumb" />
                </button>
                <button
                  className="settings-mini-btn settings-mini-btn-danger"
                  title="删除分类"
                  onClick={() => {
                    void confirmDialog({
                      title: `删除分类「${category.name}」？`,
                      message: '已标记的视频将变为未分类，此操作不会删除视频文件。',
                      tone: 'danger',
                      confirmLabel: '删除分类',
                    }).then((confirmed) => {
                      if (confirmed) onDeleteOrganizeCategory(category.id);
                    });
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="settings-row">
            <input
              className="settings-text-input"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newCategoryName.trim()) {
                  onCreateOrganizeCategory(newCategoryName);
                  setNewCategoryName('');
                }
              }}
              placeholder="新分类名称"
            />
            <button
              className="settings-btn"
              disabled={!newCategoryName.trim()}
              onClick={() => {
                onCreateOrganizeCategory(newCategoryName);
                setNewCategoryName('');
              }}
            >
              <Plus {...ICON} /> 新建分类
            </button>
          </div>
        </div>

        {/* 外观 */}
        <div className="settings-section settings-panel-appearance">
          <div className="settings-section-heading">
            <div className="settings-section-icon"><ImageIcon size={16} /></div>
            <div>
              <div className="settings-section-title">外观</div>
              <div className="settings-section-description">调整背景、透明度与界面层次感。</div>
            </div>
          </div>
          <div className="settings-row">
            <button className={`settings-btn${theme === 'day' ? ' is-active' : ''}`} onClick={() => onThemeChange('day')}>
              <Sun {...ICON} /> 日间主题
            </button>
            <button className={`settings-btn${theme === 'night' ? ' is-active' : ''}`} onClick={() => onThemeChange('night')}>
              <Moon {...ICON} /> 夜间主题
            </button>
          </div>
          <div className="settings-row">
            <button className="settings-btn" onClick={onSelectBackground}>
              <ImageIcon {...ICON} /> {backgroundImagePath ? '更换壁纸' : '选择壁纸'}
            </button>
            {backgroundImagePath && (
              <button className="settings-btn" onClick={onClearBackground}>
                <X {...ICON} /> 清除壁纸
              </button>
            )}
          </div>

          {backgroundImagePath && (
            <div className="settings-slider-row">
              <span>壁纸透明度</span>
              <input
                type="range"
                min={0}
                max={100}
                value={100 - backgroundOpacity}
                onChange={(e) => onBackgroundOpacityChange(100 - Number(e.target.value))}
                title="调整壁纸透明度，100% 为完全透明"
              />
              <span className="settings-slider-val">{100 - backgroundOpacity}%</span>
            </div>
          )}

          <div className="settings-slider-row">
            <span>操作区透明</span>
            <input
              type="range"
              min={0}
              max={100}
              value={100 - toolbarOpacity}
              onChange={(e) => onToolbarOpacityChange(100 - Number(e.target.value))}
              title="调整顶部操作区和右上角窗口按钮的透明度，100% 为完全透明"
            />
            <span className="settings-slider-val">{100 - toolbarOpacity}%</span>
          </div>

          <div className="settings-slider-row">
            <span>操作区模糊</span>
            <input
              type="range"
              min={0}
              max={30}
              value={toolbarBlur}
              onChange={(e) => onToolbarBlurChange(Number(e.target.value))}
              title="调整顶部操作区和侧边栏的模糊程度"
            />
            <span className="settings-slider-val">{toolbarBlur}px</span>
          </div>

          <details className="settings-help">
            <summary>使用说明与快捷键</summary>
            <div className="settings-help-grid">
              <div>
                <strong>媒体库</strong>
                <p>点击“导入媒体”添加文件或文件夹；左侧目录可筛选内容，顶部搜索支持名称和路径。卡片上的心形用于收藏，分类按钮用于标记整理分类。</p>
              </div>
              <div>
                <strong>整理与删除</strong>
                <p>在“整理预览”中给视频分组后，可在设置中心执行整理。删除标记会先进入“待处理”，确认后才会从磁盘删除。</p>
              </div>
              <div>
                <strong>健康中心</strong>
                <p>可检查失效媒体、缺少缩略图、离线磁盘和待整理内容；“全速生成”会调用全部逻辑线程生成预览。</p>
              </div>
              <div>
                <strong>外观</strong>
                <p>日间/夜间主题会自动保存；可设置自定义壁纸、壁纸透明度、操作区透明度和模糊程度。</p>
              </div>
              <div>
                <strong>播放快捷键</strong>
                <p><kbd>Space</kbd> 播放/暂停　<kbd>←</kbd>/<kbd>→</kbd> 后退/前进 5 秒　<kbd>Enter</kbd> 退出播放器　<kbd>Esc</kbd> 关闭播放界面</p>
              </div>
              <div>
                <strong>画面快捷键</strong>
                <p><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>R</kbd> 旋转 90°　<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>M</kbd> 水平镜像　<kbd>B</kbd> 截取当前画面设为壁纸</p>
              </div>
              <div>
                <strong>界面快捷键</strong>
                <p><kbd>Ctrl</kbd> + <kbd>K</kbd> 聚焦搜索框　<kbd>Esc</kbd> 关闭弹窗或菜单　鼠标滚轮可调整卡片大小。</p>
              </div>
            </div>
          </details>
        </div>
          </div>
          <div className={`settings-scroll-edge${settingsHasMore ? ' is-visible' : ''}`} aria-hidden="true" />
          <div className="settings-footer">
            <span><i /> 更改将自动同步至本地索引</span>
            <button type="button" onClick={onClose}>完成</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
