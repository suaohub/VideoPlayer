import { useCallback, useEffect, useState } from 'react';
import { Theme, SortBy, SortDir } from '../types';
import { api } from '../api';

// 用户偏好与持久化：主题、卡片大小、排序、壁纸、工具栏透明度/模糊、整理输出目录。
// 所有 setSetting 持久化副作用集中在此，App 只消费状态与 setter。
export function usePreferences() {
  const [theme, setTheme] = useState<Theme>('night');
  const [cardSize, setCardSize] = useState(220);
  const [sortBy, setSortBy] = useState<SortBy>('added');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [wallpaperPath, setWallpaperPath] = useState<string | null>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [wallpaperOpacity, setWallpaperOpacity] = useState(32);
  const [toolbarOpacity, setToolbarOpacity] = useState(62);
  const [toolbarBlur, setToolbarBlur] = useState(14);
  const [organizeOutputPath, setOrganizeOutputPath] = useState<string | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    api.setSetting('theme', theme);
  }, [theme]);

  useEffect(() => {
    api.setSetting('cardSize', String(cardSize));
  }, [cardSize]);

  useEffect(() => {
    if (preferencesLoaded) api.setSetting('sortBy', sortBy);
  }, [sortBy, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) api.setSetting('sortDir', sortDir);
  }, [sortDir, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) api.setSetting('wallpaperOpacity', String(wallpaperOpacity));
  }, [wallpaperOpacity, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) api.setSetting('toolbarOpacity', String(toolbarOpacity));
  }, [toolbarOpacity, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) api.setSetting('toolbarBlur', String(toolbarBlur));
  }, [toolbarBlur, preferencesLoaded]);

  // 读取全部持久化偏好并置 preferencesLoaded=true。由 App 初始化流程调用。
  const loadPreferences = useCallback(async () => {
    const savedTheme = await api.getSetting('theme');
    if (savedTheme) setTheme(savedTheme as Theme);
    const savedSize = await api.getSetting('cardSize');
    if (savedSize) setCardSize(Number(savedSize));
    const savedSortBy = await api.getSetting('sortBy');
    if (savedSortBy) setSortBy(savedSortBy as SortBy);
    const savedSortDir = await api.getSetting('sortDir');
    if (savedSortDir === 'asc' || savedSortDir === 'desc') setSortDir(savedSortDir);
    const savedOpacity = await api.getSetting('wallpaperOpacity');
    if (savedOpacity) {
      const parsedOpacity = Number(savedOpacity);
      if (Number.isFinite(parsedOpacity)) {
        setWallpaperOpacity(Math.min(100, Math.max(0, parsedOpacity)));
      }
    }
    const savedToolbarOpacity = await api.getSetting('toolbarOpacity');
    if (savedToolbarOpacity) {
      const parsedToolbarOpacity = Number(savedToolbarOpacity);
      if (Number.isFinite(parsedToolbarOpacity)) {
        setToolbarOpacity(Math.min(100, Math.max(0, parsedToolbarOpacity)));
      }
    }
    const savedToolbarBlur = await api.getSetting('toolbarBlur');
    if (savedToolbarBlur) {
      const parsedToolbarBlur = Number(savedToolbarBlur);
      if (Number.isFinite(parsedToolbarBlur)) {
        setToolbarBlur(Math.min(30, Math.max(0, parsedToolbarBlur)));
      }
    }
    const savedWallpaperPath = await api.getSetting('wallpaperPath');
    if (savedWallpaperPath) {
      const savedWallpaperUrl = await api.getBackgroundImageUrl(savedWallpaperPath);
      if (savedWallpaperUrl) {
        setWallpaperPath(savedWallpaperPath);
        setWallpaperUrl(savedWallpaperUrl);
      } else {
        await api.setSetting('wallpaperPath', '');
      }
    }
    const savedOrganizeOutputPath = await api.getSetting('organizeOutputPath');
    if (savedOrganizeOutputPath) {
      setOrganizeOutputPath(savedOrganizeOutputPath);
    }
    setPreferencesLoaded(true);
  }, []);

  const handleSelectBackground = useCallback(async () => {
    const result = await api.selectBackgroundImage();
    if (result.canceled || !result.path) return;
    const imageUrl = await api.getBackgroundImageUrl(result.path);
    if (!imageUrl) {
      alert('无法读取这张图片，请选择常见的 JPG、PNG、WebP 或 GIF 图片。');
      return;
    }
    setWallpaperPath(result.path);
    setWallpaperUrl(imageUrl);
    await api.setSetting('wallpaperPath', result.path);
  }, []);

  // 把一帧截图（path + 立即可显示的 dataURL）设为背景并持久化
  const applyWallpaper = useCallback(async (path: string, dataUrl: string) => {
    setWallpaperPath(path);
    setWallpaperUrl(dataUrl);
    await api.setSetting('wallpaperPath', path);
  }, []);

  // ShortsFeed 传来 dataURL 截帧 → 保存为文件并设为背景
  const handleCaptureWallpaper = useCallback(async (dataUrl: string) => {
    const result = await api.saveWallpaperFrame(dataUrl);
    if (result.success && result.path) {
      await applyWallpaper(result.path, dataUrl);
    }
  }, [applyWallpaper]);

  // mpv 全屏时按全局快捷键 B 截帧 → 主进程推送已存好的 path + dataURL
  useEffect(() => {
    const off = api.onWallpaperCaptured(({ path, dataUrl }) => {
      void applyWallpaper(path, dataUrl);
    });
    return () => { off?.(); };
  }, [applyWallpaper]);

  const handleClearBackground = useCallback(async () => {
    setWallpaperPath(null);
    setWallpaperUrl(null);
    await api.setSetting('wallpaperPath', '');
  }, []);

  const handleSelectOrganizeOutputFolder = useCallback(async () => {
    const result = await api.selectOrganizeOutputFolder();
    if (result.canceled || !result.path) return;
    setOrganizeOutputPath(result.path);
    await api.setSetting('organizeOutputPath', result.path);
  }, []);

  const handleClearOrganizeOutputFolder = useCallback(async () => {
    setOrganizeOutputPath(null);
    await api.setSetting('organizeOutputPath', '');
  }, []);

  return {
    theme, setTheme,
    cardSize, setCardSize,
    sortBy, setSortBy,
    sortDir, setSortDir,
    wallpaperPath, wallpaperUrl,
    wallpaperOpacity, setWallpaperOpacity,
    toolbarOpacity, setToolbarOpacity,
    toolbarBlur, setToolbarBlur,
    organizeOutputPath,
    preferencesLoaded,
    loadPreferences,
    applyWallpaper,
    handleSelectBackground,
    handleClearBackground,
    handleCaptureWallpaper,
    handleSelectOrganizeOutputFolder,
    handleClearOrganizeOutputFolder,
  };
}
