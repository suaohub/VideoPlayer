import {
  FolderPlus, Tags, FolderTree, Shuffle, FilterX, Trash2,
  Search, Sun, Moon, Heart, Grid3x3, Square, Loader2, TriangleAlert,
  Waves, Trees, Sunset, Circle, Zap, ChevronDown,
  Image as ImageIcon, X, Minus, Maximize2, Minimize2,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Theme, ImportProgress, ThumbnailProgress } from '../types';

interface ToolbarProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onImport: () => void;
  onShuffle: () => void;
  onClearFilter: () => void;
  onClearCache: () => void;
  sidebarMode: 'tags' | 'tree' | null;
  onSidebarModeChange: (m: 'tags' | 'tree' | null) => void;
  search: string;
  onSearchChange: (s: string) => void;
  videoCount: number;
  filteredCount: number;
  importing: boolean;
  importProgress: ImportProgress | null;
  thumbProgress: ThumbnailProgress | null;
  cardSize: number;
  onCardSizeChange: (n: number) => void;
  unmountedDrives: string[];
  showFavorited: boolean;
  onShowFavoritedChange: (show: boolean) => void;
  favoritedCount: number;
  backgroundImagePath: string | null;
  backgroundOpacity: number;
  onSelectBackground: () => void;
  onClearBackground: () => void;
  onBackgroundOpacityChange: (value: number) => void;
  toolbarOpacity: number;
  onToolbarOpacityChange: (value: number) => void;
  toolbarBlur: number;
  onToolbarBlurChange: (value: number) => void;
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

// 卡片大小滑块范围（列宽 px）
const CARD_MIN = 120;
const CARD_MAX = 420;

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'day', label: '白天', Icon: Sun },
  { value: 'night', label: '夜间', Icon: Moon },
  { value: 'romantic', label: '浪漫', Icon: Heart },
  { value: 'ocean', label: '海洋', Icon: Waves },
  { value: 'forest', label: '森林', Icon: Trees },
  { value: 'sunset', label: '日落', Icon: Sunset },
  { value: 'slate', label: '极简灰', Icon: Circle },
  { value: 'cyberpunk', label: '赛博霓虹', Icon: Zap },
];

// 图标统一参数：细描边线性风格
const ICON = { size: 16, strokeWidth: 1.75 } as const;

export function Toolbar(props: ToolbarProps) {
  const {
    theme, onThemeChange, onImport, onShuffle, onClearFilter, onClearCache,
    sidebarMode, onSidebarModeChange, search, onSearchChange,
    videoCount, filteredCount, importing, importProgress, thumbProgress,
    cardSize, onCardSizeChange, unmountedDrives,
    showFavorited, onShowFavoritedChange, favoritedCount,
    backgroundImagePath, backgroundOpacity, onSelectBackground, onClearBackground,
    onBackgroundOpacityChange, toolbarOpacity, onToolbarOpacityChange,
    toolbarBlur, onToolbarBlurChange,
    isMaximized, onMinimize, onToggleMaximize, onClose,
  } = props;

  // 主题下拉菜单开关
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部时收起
  useEffect(() => {
    if (!themeOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [themeOpen]);

  const currentTheme = THEMES.find((t) => t.value === theme) ?? THEMES[0];

  const btnStyle: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 14,
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    transition: 'all 0.15s',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  // 仅图标的方形按钮（主题切换）
  const iconBtnStyle: React.CSSProperties = {
    ...btnStyle,
    padding: 8,
    justifyContent: 'center',
  };

  const activeBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: 'var(--accent)',
    color: '#fff',
    border: '1px solid var(--accent)',
  };

  return (
    <header style={{
      position: 'relative',
      zIndex: 20,
      overflow: 'visible',
      background: `color-mix(in srgb, var(--bg-toolbar) ${toolbarOpacity}%, transparent)`,
      backdropFilter: toolbarBlur > 0 ? `blur(${toolbarBlur}px) saturate(1.08)` : 'none',
      borderBottom: '1px solid var(--border)',
      padding: '12px 16px',
      paddingTop: '52px', // 为 Windows 原生标题栏控件留出空间
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
      boxShadow: 'var(--shadow)',
      flexShrink: 0,
      WebkitAppRegion: 'drag', // 顶部可拖拽移动窗口
    }}>
      <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' }}>
        <button className="window-control" onClick={onMinimize} title="最小化">
          <Minus size={16} strokeWidth={1.8} />
        </button>
        <button className="window-control" onClick={onToggleMaximize} title={isMaximized ? '还原' : '最大化'}>
          {isMaximized
            ? <Minimize2 size={15} strokeWidth={1.8} />
            : <Maximize2 size={15} strokeWidth={1.8} />}
        </button>
        <button className="window-control window-control-close" onClick={onClose} title="关闭">
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>

      {/* 导入 */}
      <button onClick={onImport} disabled={importing} style={{
        ...activeBtnStyle,
        opacity: importing ? 0.6 : 1,
        fontWeight: 600,
        WebkitAppRegion: 'no-drag', // 按钮可点击，不触发拖拽
      }}>
        {importing
          ? <><Loader2 {...ICON} className="spin" /> 导入中...</>
          : <><FolderPlus {...ICON} /> 导入</>}
      </button>

      {/* 侧栏模式切换（点击已激活的可收起） */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg-primary)', padding: 4, borderRadius: 8, WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={() => onSidebarModeChange(sidebarMode === 'tags' ? null : 'tags')}
          style={sidebarMode === 'tags' ? activeBtnStyle : btnStyle}
        >
          <Tags {...ICON} /> 分类标签
        </button>
        <button
          onClick={() => onSidebarModeChange(sidebarMode === 'tree' ? null : 'tree')}
          style={sidebarMode === 'tree' ? activeBtnStyle : btnStyle}
        >
          <FolderTree {...ICON} /> 目录树
        </button>
      </div>

      {/* 收藏过滤 */}
      <button
        onClick={() => onShowFavoritedChange(!showFavorited)}
        style={{
          ...(showFavorited ? activeBtnStyle : btnStyle),
          WebkitAppRegion: 'no-drag',
        }}
        title={`收藏夹 (${favoritedCount})`}
      >
        <Heart {...ICON} fill={showFavorited ? 'currentColor' : 'none'} /> 收藏 {favoritedCount > 0 && `(${favoritedCount})`}
      </button>

      {/* 随机打乱 */}
      <button onClick={onShuffle} style={{ ...btnStyle, WebkitAppRegion: 'no-drag' }}>
        <Shuffle {...ICON} /> 随机打乱
      </button>

      {/* 清空过滤 */}
      <button onClick={onClearFilter} style={{ ...btnStyle, WebkitAppRegion: 'no-drag' }}>
        <FilterX {...ICON} /> 清空过滤
      </button>

      {/* 清除缓存 */}
      <button onClick={onClearCache} style={{ ...btnStyle, WebkitAppRegion: 'no-drag' }} title="删除所有已生成的缩略图文件">
        <Trash2 {...ICON} /> 清除缓存
      </button>

      {/* 搜索框 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        WebkitAppRegion: 'no-drag',
      }}>
        <Search {...ICON} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索文件名..."
          style={{
            fontSize: 14,
            background: 'transparent',
            color: 'var(--text-primary)',
            border: 'none',
            outline: 'none',
            width: 160,
          }}
        />
      </div>

      {/* 未挂载磁盘提示 */}
      {unmountedDrives.length > 0 && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: '#f59e0b',
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 6, padding: '4px 10px',
        }}>
          <TriangleAlert size={14} strokeWidth={2} />
          未连接：{unmountedDrives.join('、')} 的视频已隐藏
        </span>
      )}

      {/* 视频计数 */}
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        {filteredCount} / {videoCount} 个视频
      </span>

      {/* 卡片大小滑块（无级放大缩小，靠右） */}
      <div style={{
        marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--bg-primary)', padding: '4px 12px', borderRadius: 8,
        WebkitAppRegion: 'no-drag',
      }}>
        <Grid3x3 size={15} strokeWidth={1.75} style={{ color: 'var(--text-secondary)' }} aria-label="缩小（每行更多）" />
        <input
          type="range"
          min={CARD_MIN}
          max={CARD_MAX}
          value={cardSize}
          onChange={(e) => onCardSizeChange(Number(e.target.value))}
          style={{ width: 120, cursor: 'pointer' }}
          title="拖动调整卡片大小"
        />
        <Square size={18} strokeWidth={1.75} style={{ color: 'var(--text-secondary)' }} aria-label="放大（每行更少）" />
      </div>

      {/* 主题切换（靠右）：单按钮 + 下拉菜单 */}
      <div ref={themeRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={() => setThemeOpen((o) => !o)}
          style={{ ...btnStyle }}
          title="切换主题"
        >
          <currentTheme.Icon {...ICON} />
          <span>{currentTheme.label}</span>
          <ChevronDown size={14} strokeWidth={1.75} style={{
            opacity: 0.6,
            transition: 'transform 0.15s',
            transform: themeOpen ? 'rotate(180deg)' : 'none',
          }} />
        </button>

        {themeOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 160,
            background: 'var(--bg-toolbar)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 50,
          }}>
            {THEMES.map((t) => {
              const active = theme === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => { onThemeChange(t.value); setThemeOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    fontSize: 14,
                    textAlign: 'left',
                    border: 'none',
                    borderRadius: 6,
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-primary)',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <t.Icon {...ICON} />
                  <span>{t.label}</span>
                </button>
              );
            })}
            <div style={{
              height: 1,
              margin: '6px 4px',
              background: 'var(--border)',
            }} />
            <button
              onClick={onSelectBackground}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px 10px',
                fontSize: 14,
                textAlign: 'left',
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <ImageIcon {...ICON} />
              <span>{backgroundImagePath ? '更换壁纸' : '选择壁纸'}</span>
            </button>
            {backgroundImagePath && (
              <>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px 4px',
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                }}>
                  <span style={{ flexShrink: 0 }}>壁纸透明度</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={100 - backgroundOpacity}
                    onChange={(e) => onBackgroundOpacityChange(100 - Number(e.target.value))}
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    title="调整壁纸透明度，100% 为完全透明"
                  />
                  <span style={{ width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {100 - backgroundOpacity}%
                  </span>
                </div>
                <button
                  onClick={onClearBackground}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 14,
                    textAlign: 'left',
                    border: 'none',
                    borderRadius: 6,
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <X {...ICON} />
                  <span>清除壁纸</span>
                </button>
              </>
            )}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px 4px',
              color: 'var(--text-secondary)',
              fontSize: 12,
            }}>
              <span style={{ flexShrink: 0 }}>操作区透明</span>
              <input
                type="range"
                min={0}
                max={100}
                value={100 - toolbarOpacity}
                onChange={(e) => onToolbarOpacityChange(100 - Number(e.target.value))}
                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                title="调整顶部操作区和右上角窗口按钮的透明度，100% 为完全透明"
              />
              <span style={{ width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {100 - toolbarOpacity}%
              </span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px 8px',
              color: 'var(--text-secondary)',
              fontSize: 12,
            }}>
              <span style={{ flexShrink: 0 }}>操作区模糊</span>
              <input
                type="range"
                min={0}
                max={30}
                value={toolbarBlur}
                onChange={(e) => onToolbarBlurChange(Number(e.target.value))}
                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                title="调整顶部操作区和侧边栏的模糊程度"
              />
              <span style={{ width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {toolbarBlur}px
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 导入进度条 */}
      {importing && importProgress && (
        <div style={{ width: '100%', marginTop: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            扫描中: {importProgress.current} / {importProgress.total} — {importProgress.file}
          </div>
          <div style={{ height: 4, background: 'var(--bg-primary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${(importProgress.current / importProgress.total) * 100}%`,
              background: 'var(--accent)',
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}

      {/* 缩略图后台生成进度（导入进度条不显示时才显示，避免叠加） */}
      {!importing && thumbProgress && thumbProgress.total > 0 && (
        <div style={{ width: '100%', marginTop: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            生成缩略图: {thumbProgress.done} / {thumbProgress.total}
          </div>
          <div style={{ height: 4, background: 'var(--bg-primary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${(thumbProgress.done / thumbProgress.total) * 100}%`,
              background: 'var(--accent)',
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}
    </header>
  );
}
