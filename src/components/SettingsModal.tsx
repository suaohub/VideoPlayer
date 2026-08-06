import { useEffect } from 'react';
import {
  Settings, X, FolderPlus, Loader2, Trash2, Image as ImageIcon,
} from 'lucide-react';
import { ImportProgress } from '../types';
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
}

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export function SettingsModal(props: SettingsModalProps) {
  const {
    onClose, onImport, importing, importProgress, onClearCache,
    backgroundImagePath, backgroundOpacity, onSelectBackground, onClearBackground,
    onBackgroundOpacityChange, toolbarOpacity, onToolbarOpacityChange,
    toolbarBlur, onToolbarBlurChange,
  } = props;

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
