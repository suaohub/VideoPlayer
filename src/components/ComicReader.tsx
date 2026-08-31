import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Maximize, Minimize, Loader2 } from 'lucide-react';
import { Video } from '../types';
import { api } from '../api';
import './ComicReader.css';

interface ComicReaderProps {
  video: Video;
  onClose: () => void;
}

// 缩放模式：适应高度（整页竖向铺满）/ 适应宽度（横向铺满，长图上下滚动）
type FitMode = 'height' | 'width';

export function ComicReader({ video, onClose }: ComicReaderProps) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [fit, setFit] = useState<FitMode>('height');
  const [spread, setSpread] = useState<1 | 2>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const settingKey = `comic:pos:${video.id}`;
  const pageCount = pages.length;

  // 加载漫画页 + 恢复设置
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPages([]);
    setPage(0);

    (async () => {
      const savedFit = await api.getSetting('comicFit');
      const savedSpread = await api.getSetting('comicSpread');
      const savedPos = await api.getSetting(settingKey);
      const result = await api.listComicPages(video.path);
      if (!active) return;
      if (savedFit === 'height' || savedFit === 'width') setFit(savedFit);
      if (savedSpread === '2') setSpread(2);
      if (result.success && result.pages.length > 0) {
        setPages(result.pages);
        const start = savedPos ? Number(savedPos) : 0;
        setPage(Math.max(0, Math.min(start, result.pages.length - 1)));
      } else {
        setError(result.error ?? '无法加载漫画');
      }
      setLoading(false);
    })();

    return () => { active = false; };
  }, [video.path, video.id, settingKey]);

  // 同步系统全屏状态
  useEffect(() => {
    (async () => setIsFullscreen(await api.getFullscreen()))();
    const off = api.onFullscreenChanged((on) => setIsFullscreen(on));
    return () => { off?.(); };
  }, []);

  // 退出时若还在全屏则退出全屏
  const exitFsIfNeeded = useCallback(async () => {
    if (await api.getFullscreen()) await api.setFullscreen(false);
  }, []);

  const goPage = useCallback((next: number) => {
    setPage((p) => {
      const target = Math.max(0, Math.min(next, pageCount - 1));
      return target === p ? p : target;
    });
  }, [pageCount]);

  const prevPage = useCallback(() => goPage(page - spread), [goPage, page, spread]);
  const nextPage = useCallback(() => goPage(page + spread), [goPage, page, spread]);

  // 翻页后持久化进度
  useEffect(() => {
    if (loading) return;
    api.setSetting(settingKey, String(page));
  }, [page, loading, settingKey]);

  const closeReader = useCallback(async () => {
    await exitFsIfNeeded();
    onClose();
  }, [exitFsIfNeeded, onClose]);

  const toggleFit = () => {
    setFit((f) => {
      const next = f === 'height' ? 'width' : 'height';
      api.setSetting('comicFit', next);
      return next;
    });
  };

  const toggleSpread = () => {
    setSpread((s) => {
      const next: 1 | 2 = s === 1 ? 2 : 1;
      api.setSetting('comicSpread', String(next));
      // 切到双页时对齐到偶数页，保证成对翻页一致
      if (next === 2) setPage((p) => p - (p % 2));
      return next;
    });
  };

  const toggleFullscreen = useCallback(async () => {
    const on = await api.setFullscreen(!(await api.getFullscreen()));
    setIsFullscreen(on);
  }, []);

  // 键盘：左右翻页、Space 下一页、F 全屏、Esc 关闭（全屏时先退全屏），Delete 标记删除
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (await api.getFullscreen()) { await api.setFullscreen(false); return; }
        closeReader();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prevPage(); }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); nextPage(); }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
      if (e.key === 'Delete') {
        e.preventDefault();
        await api.toggleMarkedForDeletion(video.id);
        closeReader();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeReader, prevPage, nextPage, toggleFullscreen, video.id]);

  // 当前屏显示的页（双页模式下最多两页，左→右）
  const visiblePages = useMemo(() => {
    const arr: { idx: number; url: string }[] = [];
    for (let i = 0; i < spread; i++) {
      const idx = page + i;
      if (idx < pageCount) arr.push({ idx, url: pages[idx] });
    }
    return arr;
  }, [page, spread, pageCount, pages]);

  // 预加载相邻页，翻页更顺滑（双页模式预加载更宽的窗口）
  const preloadUrls = useMemo(() => {
    const urls: string[] = [];
    for (const d of [spread, spread + 1, -1, -2]) {
      const i = page + d;
      if (i >= 0 && i < pageCount) urls.push(pages[i]);
    }
    return urls;
  }, [page, spread, pageCount, pages]);

  return (
    <div className="comic-reader">
      {/* 顶栏 */}
      <div className="comic-topbar">
        <div className="comic-title" title={video.name}>{video.name}</div>
        <div className="comic-tools">
          <button className="comic-icon-btn" onClick={toggleFit} title={fit === 'height' ? '适应高度（点击切换适应宽度）' : '适应宽度（点击切换适应高度）'}>
            {fit === 'height' ? '适高' : '适宽'}
          </button>
          <button className="comic-icon-btn" onClick={toggleSpread} title={spread === 1 ? '单页（点击切换双页）' : '双页（点击切换单页）'}>
            {spread === 1 ? '单页' : '双页'}
          </button>
          <button className="comic-icon-btn" onClick={toggleFullscreen} title="全屏 (F)">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <button className="comic-icon-btn" onClick={closeReader} title="关闭 (Esc)"><X size={20} /></button>
        </div>
      </div>

      {/* 阅读区 */}
      <div className={'comic-viewport comic-fit-' + fit + (spread === 2 ? ' comic-spread' : '')}>
        {loading && <div className="comic-status"><Loader2 className="comic-spin" size={22} /> 正在加载...</div>}
        {error && <div className="comic-status comic-error">{error}</div>}
        {!loading && !error && visiblePages.length > 0 && (
          <div className="comic-pages">
            {visiblePages.map((p) => (
              <img key={p.idx} className="comic-page" src={p.url} alt={`第 ${p.idx + 1} 页`} draggable={false} />
            ))}
          </div>
        )}

        {/* 左右点击翻页热区 */}
        {!loading && !error && (
          <>
            <button className="comic-tap comic-tap-left" onClick={prevPage} aria-label="上一页" disabled={page <= 0}>
              <ChevronLeft size={30} />
            </button>
            <button className="comic-tap comic-tap-right" onClick={nextPage} aria-label="下一页" disabled={page >= pageCount - 1}>
              <ChevronRight size={30} />
            </button>
          </>
        )}
      </div>

      {/* 底栏：页码 + 跳页滑块 */}
      {!loading && !error && (
        <div className="comic-footer">
          <input
            type="range"
            className="comic-slider"
            min={0}
            max={Math.max(0, pageCount - 1)}
            value={page}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPage(spread === 2 ? v - (v % 2) : v);
            }}
          />
          <span className="comic-page-num">
            {spread === 2 && visiblePages.length > 1
              ? `${page + 1}-${page + visiblePages.length} / ${pageCount}`
              : `${page + 1} / ${pageCount}`}
          </span>
        </div>
      )}

      {/* 隐藏的预加载图 */}
      <div className="comic-preload" aria-hidden="true">
        {preloadUrls.map((u) => <img key={u} src={u} alt="" />)}
      </div>
    </div>
  );
}
