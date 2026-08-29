import { useEffect, useState } from 'react';
import {
  Settings, X, FolderPlus, Loader2, Trash2, Image as ImageIcon, FolderKanban, Pencil, Plus, FolderOpen,
} from 'lucide-react';
import { ImportProgress, OrganizeCategory } from '../types';
import './SettingsModal.css';

interface SettingsModalProps {
  onClose: () => void;
  // 媒体库
  onImport: () => void;
  importing: boolean;
  importProgress: ImportProgress | null;
  onClearCache: () => void;
  // 外观
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
  selectedFolderName: string | null;
  onCreateOrganizeCategory: (name: string) => void;
  onRenameOrganizeCategory: (categoryId: number, name: string) => void;
  onDeleteOrganizeCategory: (categoryId: number) => void;
  organizeOutputPath: string | null;
  onSelectOrganizeOutputFolder: () => void;
  onClearOrganizeOutputFolder: () => void;
  onOrganizeFolder: () => void;
  organizing: boolean;
}

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export function SettingsModal(props: SettingsModalProps) {
  const {
    onClose, onImport, importing, importProgress, onClearCache,
    backgroundImagePath, backgroundOpacity, onSelectBackground, onClearBackground,
    onBackgroundOpacityChange, toolbarOpacity, onToolbarOpacityChange,
    toolbarBlur, onToolbarBlurChange, organizeCategories, selectedFolderName,
    onCreateOrganizeCategory, onRenameOrganizeCategory, onDeleteOrganizeCategory,
    organizeOutputPath, onSelectOrganizeOutputFolder, onClearOrganizeOutputFolder,
    onOrganizeFolder, organizing,
  } = props;
  const [newCategoryName, setNewCategoryName] = useState('');

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div className="settings-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">
            <Settings {...ICON} size={18} /> 设置
          </span>
          <button className="settings-close" onClick={onClose} title="关闭 (Esc)">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        {/* 媒体库 */}
        <div className="settings-section">
          <div className="settings-section-title">媒体库</div>
          <div className="settings-row">
            <button
              className="settings-btn settings-btn-primary"
              onClick={onImport}
              disabled={importing}
            >
              {importing
                ? <><Loader2 {...ICON} className="spin" /> 导入中...</>
                : <><FolderPlus {...ICON} /> 导入文件夹</>}
            </button>
            <span className="settings-hint">导入视频、音频、小说或漫画（图片文件夹）</span>
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
          <div className="settings-row" style={{ marginTop: 10 }}>
            <button className="settings-btn settings-btn-danger" onClick={onClearCache}>
              <Trash2 {...ICON} /> 清除缓存
            </button>
            <span className="settings-hint">删除所有导入记录、目录、标签与缩略图（源文件保留）</span>
          </div>
        </div>

        {/* 整理分类 */}
        <div className="settings-section">
          <div className="settings-section-title">视频整理</div>
          <div className="settings-row">
            <span className="settings-hint">
              右键文件卡片选择一个分类，整理时会按分类移动文件。
            </span>
          </div>
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
          <div className="settings-hint settings-organize-output-path" title={organizeOutputPath ?? undefined}>
            {organizeOutputPath
              ? `集中整理位置：${organizeOutputPath}`
              : '未设置集中位置，将在当前选中目录下创建分类文件夹。'}
          </div>
          <div className="settings-category-list">
            {organizeCategories.length === 0 && (
              <div className="settings-hint">还没有预设分类。</div>
            )}
            {organizeCategories.map((category) => (
              <div className="settings-category-item" key={category.id}>
                <FolderKanban {...ICON} />
                <span className="settings-category-name">{category.name}</span>
                <span className="settings-category-count">{category.count ?? 0}</span>
                <button
                  className="settings-mini-btn"
                  title="重命名分类"
                  onClick={() => {
                    const name = prompt('请输入新的分类名称', category.name);
                    if (name != null && name.trim()) onRenameOrganizeCategory(category.id, name);
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="settings-mini-btn settings-mini-btn-danger"
                  title="删除分类"
                  onClick={() => {
                    if (confirm(`删除分类「${category.name}」？已标记的视频将变为未分类。`)) {
                      onDeleteOrganizeCategory(category.id);
                    }
                  }}
                >
                  <X size={14} />
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
          <div className="settings-row settings-organize-action">
            <button
              className="settings-btn settings-btn-primary"
              disabled={!selectedFolderName || organizing || organizeCategories.length === 0}
              onClick={onOrganizeFolder}
            >
              {organizing ? <><Loader2 {...ICON} className="spin" /> 整理中...</> : <><FolderKanban {...ICON} /> 开始整理目录</>}
            </button>
            <span className="settings-hint">
              {selectedFolderName ? `当前目录：${selectedFolderName}` : '请先在目录树中单选一个目录'}
            </span>
          </div>
        </div>

        {/* 外观 */}
        <div className="settings-section">
          <div className="settings-section-title">外观</div>
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
        </div>
      </div>
    </div>
  );
}
