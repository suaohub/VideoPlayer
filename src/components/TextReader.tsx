import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { X, List, Minus, Plus, ChevronLeft, ChevronRight, Maximize, Minimize } from 'lucide-react';
import { Theme, Video } from '../types';
import { api } from '../api';
import './TextReader.css';

interface TextReaderProps {
  video: Video;
  onClose: () => void;
  appTheme: Theme;
}

type ReaderTheme = 'paper' | 'day' | 'night';
// 翻页模式：横向翻页（多栏左右）/ 竖向翻页（整屏上下）/ 滚动（连续纵向滚动）
type ReadMode = 'horizontal' | 'vertical' | 'scroll';

interface Chapter {
  title: string;
  offset: number; // 在全文中的字符偏移
}

// 虚拟化分块：任意时刻只把一个 chunk 的段落挂进 DOM，避免整本书一次性进多栏布局
interface ChunkRange {
  start: number;       // 段落起始下标（含）
  end: number;         // 段落结束下标（不含）
  startOffset: number; // 该块首段字符偏移
}
// 单块字数：达到软阈值遇章节即断，超过硬上限强制断（应对超长章节/无章节长文）
const CHUNK_SOFT = 12000;
const CHUNK_HARD = 24000;

const FONT_MIN = 14;
const FONT_MAX = 32;
const THEMES: { key: ReaderTheme; label: string }[] = [
  { key: 'paper', label: '纸张' },
  { key: 'day', label: '日间' },
  { key: 'night', label: '夜间' },
];
const READ_MODES: { key: ReadMode; label: string }[] = [
  { key: 'horizontal', label: '横向' },
  { key: 'vertical', label: '竖向' },
  { key: 'scroll', label: '滚动' },
];

// 段落间距档位（对应段落下外边距，单位 em）
type ParaGapKey = 'compact' | 'normal' | 'loose';
const PARA_GAPS: { key: ParaGapKey; label: string; em: number }[] = [
  { key: 'compact', label: '紧凑', em: 0.15 },
  { key: 'normal', label: '标准', em: 0.7 },
  { key: 'loose', label: '宽松', em: 1.3 },
];

// 章节标题正则：第X章/回/节/卷/话/篇 + 序章/楔子/引子/番外/尾声
const CHAPTER_RE = new RegExp(
  '^\\s*(' +
  '第[0-9零一二三四五六七八九十百千两]+[章回节卷话篇集部]' +
  '|序章|序言|楔子|引子|前言|后记|尾声|番外[^\\n]*|第[0-9零一二三四五六七八九十百千两]+)' +
  '[^\\n]{0,30}$',
);

interface Para {
  text: string;
  offset: number;   // 该段首字符在全文中的偏移
  isChapter: boolean;
}

// 把全文切成段落：丢弃空行，每段记录其在原文中的起始偏移（用于进度/章节定位）
function parseParagraphs(text: string): Para[] {
  const paras: Para[] = [];
  let offset = 0;
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      const isChapter = trimmed.length <= 40 && CHAPTER_RE.test(trimmed);
      paras.push({ text: trimmed, offset, isChapter });
    }
    offset += line.length + 1; // +1 为被 split 掉的 \n
  }
  return paras;
}

// 把段落序列切成块：遇章节且已积够软阈值 -> 自然断；累计超硬上限 -> 强制断
function buildChunks(paras: Para[]): ChunkRange[] {
  if (paras.length === 0) return [];
  const chunks: ChunkRange[] = [];
  let start = 0;
  let chars = 0;
  for (let i = 0; i < paras.length; i++) {
    const boundary = i > start && paras[i].isChapter;
    if (i > start && ((boundary && chars >= CHUNK_SOFT) || chars >= CHUNK_HARD)) {
      chunks.push({ start, end: i, startOffset: paras[start].offset });
      start = i;
      chars = 0;
    }
    chars += paras[i].text.length;
  }
  chunks.push({ start, end: paras.length, startOffset: paras[start].offset });
  return chunks;
}

export function TextReader({ video, onClose, appTheme }: TextReaderProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(20);
  const [theme, setTheme] = useState<ReaderTheme>(appTheme === 'night' ? 'night' : 'day');
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [chunkIdx, setChunkIdx] = useState(0);   // 当前渲染的块
  const [showToc, setShowToc] = useState(false);
  const [paraGap, setParaGap] = useState<ParaGapKey>('normal');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [readMode, setReadMode] = useState<ReadMode>('horizontal');
  const [spread, setSpread] = useState<1 | 2>(1); // 横向双页
  const [posOffset, setPosOffset] = useState(0);  // 当前阅读位置的字符偏移（进度/章节高亮/持久化）

  const viewportRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const pageWidthRef = useRef(1);
  // 待恢复的字符偏移（加载完成/重排后跳转到对应块与页）
  const pendingOffsetRef = useRef<number | null>(null);
  // 跨块后退：落到上一块最后一页
  const pendingLastPageRef = useRef(false);
  // 滚动模式跨块：落到新块顶部/底部
  const pendingScrollRef = useRef<'top' | 'bottom' | null>(null);

  const paras = useMemo(() => parseParagraphs(content), [content]);
  const chunks = useMemo(() => buildChunks(paras), [paras]);
  const chapters = useMemo<Chapter[]>(
    () => paras.filter((p) => p.isChapter).map((p) => ({ title: p.text, offset: p.offset })),
    [paras],
  );
  // 当前块下标做一次夹取，防止内容切换后越界
  const safeChunk = chunks.length > 0 ? Math.min(chunkIdx, chunks.length - 1) : 0;
  // 只渲染当前块的段落；换块时 .reader-columns 用 key 重挂载，不触发翻页动画
  const chunkNodes = useMemo(() => {
    const c = chunks[safeChunk];
    if (!c) return null;
    const out: ReactElement[] = [];
    for (let i = c.start; i < c.end; i++) {
      const p = paras[i];
      out.push(
        <p
          key={i}
          data-off={p.offset}
          className={'reader-para' + (p.isChapter ? ' reader-para-chapter' : '')}
        >{p.text}</p>,
      );
    }
    return out;
  }, [chunks, safeChunk, paras]);
  const settingKey = `reader:pos:${video.id}`;

  // 字符偏移 -> 所在块下标（块按 startOffset 升序，二分）
  const chunkOf = useCallback((offset: number): number => {
    let lo = 0, hi = chunks.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (chunks[mid].startOffset <= offset) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }, [chunks]);

  // 读取文件 + 恢复设置
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setContent('');
    setPage(0);
    setChunkIdx(0);

    (async () => {
      // 设置读取与文件读取并行发出，避免多次串行 IPC 往返把打开拖慢
      const [savedFont, savedTheme, savedGap, savedMode, savedSpread, savedPos, result] = await Promise.all([
        api.getSetting('readerFontSize'),
        api.getSetting('readerTheme'),
        api.getSetting('readerParaGap'),
        api.getSetting('readerMode'),
        api.getSetting('readerSpread'),
        api.getSetting(settingKey),
        api.readTextFile(video.path),
      ]);
      if (!active) return;
      if (savedFont) setFontSize(Number(savedFont));
      if (savedTheme) setTheme(savedTheme as ReaderTheme);
      else setTheme(appTheme === 'night' ? 'night' : 'day');
      if (savedGap && PARA_GAPS.some((g) => g.key === savedGap)) setParaGap(savedGap as ParaGapKey);
      if (savedMode === 'horizontal' || savedMode === 'vertical' || savedMode === 'scroll') setReadMode(savedMode);
      if (savedSpread === '2') setSpread(2);
      const startOff = savedPos ? Number(savedPos) : 0;
      pendingOffsetRef.current = startOff;
      setPosOffset(startOff);

      if (result.success && result.content != null) {
        setContent(result.content);
      } else {
        setError(result.error ?? '读取失败');
      }
      setLoading(false);
    })();

    return () => { active = false; };
  }, [video.path, video.id, settingKey]);

  // 当前页首段字符偏移：取块内 data-off 中，其页码 <= 当前页的最后一个（与 transform 无关）
  const pageToOffset = useCallback((): number => {
    const cols = columnsRef.current;
    const step = pageWidthRef.current;
    const c = chunks[safeChunk];
    if (!cols || step <= 0 || !c) return c?.startOffset ?? 0;
    const cr = cols.getBoundingClientRect();
    const nodes = cols.querySelectorAll<HTMLElement>('[data-off]');
    let off = c.startOffset;
    for (const el of nodes) {
      const rr = el.getClientRects()[0] ?? el.getBoundingClientRect();
      const pos = readMode === 'vertical'
        ? (rr.top - cr.top) + page * step
        : (rr.left - cr.left) + page * step;
      const pg = Math.max(0, Math.floor((pos + 1) / step));
      if (pg <= page) off = Number(el.dataset.off);
      else break;
    }
    return off;
  }, [chunks, safeChunk, readMode, page]);

  // 当前阅读位置字符偏移：滚动模式用裁剪区左上角命中段落，翻页模式用 pageToOffset
  const currentOffset = useCallback((): number => {
    if (readMode === 'scroll') {
      const clip = clipRef.current;
      if (!clip) return chunks[safeChunk]?.startOffset ?? 0;
      const r = clip.getBoundingClientRect();
      const range = (document as any).caretRangeFromPoint?.(r.left + 4, r.top + 4) as Range | null;
      let node: Node | null = range?.startContainer ?? null;
      while (node && node !== clip) {
        const el = node instanceof HTMLElement ? node : node.parentElement;
        if (el?.dataset?.off != null) return Number(el.dataset.off);
        node = node.parentElement;
      }
      return chunks[safeChunk]?.startOffset ?? 0;
    }
    return pageToOffset();
  }, [readMode, pageToOffset, chunks, safeChunk]);

  // 重排当前块：设页宽/页高、算块内总页数，并消化待定的偏移/末页/滚动定位
  const relayout = useCallback(() => {
    const clip = clipRef.current;
    const cols = columnsRef.current;
    if (!clip || !cols) return;
    const w = clip.clientWidth;
    const h = clip.clientHeight;
    if (w <= 0 || h <= 0) return;

    // 待恢复偏移落在别的块：先切块，本次不排（切块后 effect 会再次调用）
    if (pendingOffsetRef.current != null) {
      const tc = chunkOf(pendingOffsetRef.current);
      if (tc !== safeChunk) { setChunkIdx(tc); return; }
    }

    if (readMode === 'scroll') {
      cols.style.columnWidth = 'auto';
      cols.style.columnCount = '1';
      cols.style.width = `${w}px`;
      cols.style.height = 'auto';
      cols.style.transform = 'none';
      setPageCount(1);
      const off = pendingOffsetRef.current;
      const sc = pendingScrollRef.current;
      pendingOffsetRef.current = null;
      pendingScrollRef.current = null;
      requestAnimationFrame(() => {
        if (sc === 'bottom') { clip.scrollTop = clip.scrollHeight; return; }
        if (sc === 'top') { clip.scrollTop = 0; return; }
        if (off != null) {
          const nodes = cols.querySelectorAll<HTMLElement>('[data-off]');
          let target: HTMLElement | null = null;
          for (const el of nodes) {
            if (Number(el.dataset.off) <= off) target = el; else break;
          }
          clip.scrollTop = target ? target.offsetTop : 0;
        }
      });
      return;
    }

    let count: number;
    if (readMode === 'vertical') {
      pageWidthRef.current = h;
      cols.style.columnWidth = 'auto';
      cols.style.columnCount = '1';
      cols.style.width = `${w}px`;
      cols.style.height = 'auto';
      count = Math.max(1, Math.round(cols.scrollHeight / h));
    } else {
      const colW = spread === 2 ? Math.floor(w / 2) : w;
      pageWidthRef.current = w;
      cols.style.columnCount = '';
      cols.style.width = 'auto';
      cols.style.columnWidth = `${colW}px`;
      cols.style.height = `${h}px`;
      count = Math.max(1, Math.round(cols.scrollWidth / w));
    }
    setPageCount(count);

    if (pendingLastPageRef.current) {
      pendingLastPageRef.current = false;
      pendingOffsetRef.current = null;
      setPage(count - 1);
    } else if (pendingOffsetRef.current != null) {
      const off = pendingOffsetRef.current;
      pendingOffsetRef.current = null;
      // 重排后 page 状态还是旧值，直接按块内相对位置算目标页
      const cols2 = cols;
      const cr = cols2.getBoundingClientRect();
      const nodes = cols2.querySelectorAll<HTMLElement>('[data-off]');
      let target: HTMLElement | null = null;
      for (const el of nodes) { if (Number(el.dataset.off) <= off) target = el; else break; }
      let tp = 0;
      if (target) {
        const rr = target.getClientRects()[0] ?? target.getBoundingClientRect();
        const step = pageWidthRef.current;
        const pos = readMode === 'vertical' ? rr.top - cr.top : rr.left - cr.left;
        tp = Math.max(0, Math.floor((pos + 1) / step));
      }
      setPage(Math.min(tp, count - 1));
    } else {
      setPage((p) => Math.min(p, count - 1));
    }
  }, [chunkOf, safeChunk, readMode, spread]);

  // 内容/字号/段距/模式/块变化后重排（page 变化不重排，只走 transform）
  useLayoutEffect(() => {
    if (loading) return;
    relayout();
  }, [content, fontSize, paraGap, readMode, spread, safeChunk, loading, relayout]);

  // 窗口尺寸变化后保持当前偏移重排
  useEffect(() => {
    const onResize = () => {
      pendingOffsetRef.current = currentOffset();
      relayout();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [relayout, currentOffset]);

  const lastChunk = chunks.length - 1;

  const prevPage = useCallback(() => {
    if (readMode === 'scroll') {
      const clip = clipRef.current;
      if (!clip) return;
      if (clip.scrollTop <= 2) {
        if (safeChunk > 0) { pendingScrollRef.current = 'bottom'; setChunkIdx(safeChunk - 1); }
      } else {
        clip.scrollBy({ top: -clip.clientHeight * 0.9, behavior: 'smooth' });
      }
      return;
    }
    if (page > 0) { setPage(page - 1); return; }
    if (safeChunk > 0) { pendingLastPageRef.current = true; setPage(0); setChunkIdx(safeChunk - 1); }
  }, [readMode, page, safeChunk]);

  const nextPage = useCallback(() => {
    if (readMode === 'scroll') {
      const clip = clipRef.current;
      if (!clip) return;
      if (clip.scrollTop + clip.clientHeight >= clip.scrollHeight - 2) {
        if (safeChunk < lastChunk) { pendingScrollRef.current = 'top'; setChunkIdx(safeChunk + 1); }
      } else {
        clip.scrollBy({ top: clip.clientHeight * 0.9, behavior: 'smooth' });
      }
      return;
    }
    if (page < pageCount - 1) { setPage(page + 1); return; }
    if (safeChunk < lastChunk) { setPage(0); setChunkIdx(safeChunk + 1); }
  }, [readMode, page, pageCount, safeChunk, lastChunk]);

  // 滚动模式：滚到底/顶继续滚时自动进入下/上一块
  useEffect(() => {
    if (loading || readMode !== 'scroll') return;
    const clip = clipRef.current;
    if (!clip) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; setPosOffset(currentOffset()); });
    };
    const onWheel = (e: WheelEvent) => {
      const atBottom = clip.scrollTop + clip.clientHeight >= clip.scrollHeight - 2;
      const atTop = clip.scrollTop <= 2;
      if (e.deltaY > 0 && atBottom && safeChunk < lastChunk) {
        pendingScrollRef.current = 'top'; setChunkIdx(safeChunk + 1);
      } else if (e.deltaY < 0 && atTop && safeChunk > 0) {
        pendingScrollRef.current = 'bottom'; setChunkIdx(safeChunk - 1);
      }
    };
    clip.addEventListener('scroll', onScroll, { passive: true });
    clip.addEventListener('wheel', onWheel, { passive: true });
    onScroll();
    return () => {
      clip.removeEventListener('scroll', onScroll);
      clip.removeEventListener('wheel', onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [loading, readMode, currentOffset, safeChunk, lastChunk]);

  // 翻页模式：页/块变化后（等 transform 落定）读回当前偏移
  useEffect(() => {
    if (loading || readMode === 'scroll') return;
    const t = setTimeout(() => setPosOffset(currentOffset()), 60);
    return () => clearTimeout(t);
  }, [page, safeChunk, loading, readMode, currentOffset]);

  // 偏移变化后持久化进度
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => { api.setSetting(settingKey, String(posOffset)); }, 300);
    return () => clearTimeout(t);
  }, [posOffset, loading, settingKey]);

  // 阅读断点同时写入统一播放历史；稍作防抖，避免滚动时频繁落库。
  useEffect(() => {
    if (loading || posOffset <= 0 || content.length === 0) return;
    const t = window.setTimeout(() => {
      void api.savePlaybackProgress(video.id, posOffset, content.length);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [posOffset, content.length, loading, video.id]);

  const closeReader = useCallback(async () => {
    if (!loading) {
      const offset = currentOffset();
      api.setSetting(settingKey, String(offset));
      if (offset > 0 && content.length > 0) await api.savePlaybackProgress(video.id, offset, content.length);
    }
    if (await api.getFullscreen()) await api.setFullscreen(false);
    onClose();
  }, [loading, settingKey, currentOffset, content.length, video.id, onClose]);

  // 同步系统全屏状态
  useEffect(() => {
    (async () => setIsFullscreen(await api.getFullscreen()))();
    const off = api.onFullscreenChanged((on) => setIsFullscreen(on));
    return () => { off?.(); };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const on = await api.setFullscreen(!(await api.getFullscreen()));
    setIsFullscreen(on);
  }, []);

  // 键盘：左右/PageUp/PageDown 翻页，F 全屏，Esc 关闭（全屏时先退全屏），Delete 标记删除
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (await api.getFullscreen()) { await api.setFullscreen(false); return; }
        closeReader();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); prevPage(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); nextPage(); }
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

  const changeFont = (delta: number) => {
    setFontSize((f) => {
      const next = Math.max(FONT_MIN, Math.min(FONT_MAX, f + delta));
      pendingOffsetRef.current = currentOffset();
      api.setSetting('readerFontSize', String(next));
      return next;
    });
  };
  const changeTheme = (t: ReaderTheme) => {
    setTheme(t);
    api.setSetting('readerTheme', t);
  };
  const changeGap = (key: ParaGapKey) => {
    pendingOffsetRef.current = currentOffset();
    setParaGap(key);
    api.setSetting('readerParaGap', key);
  };
  const changeMode = (mode: ReadMode) => {
    if (mode === readMode) return;
    pendingOffsetRef.current = currentOffset();
    setReadMode(mode);
    api.setSetting('readerMode', mode);
  };
  const toggleSpread = () => {
    pendingOffsetRef.current = currentOffset();
    setSpread((s) => {
      const next: 1 | 2 = s === 1 ? 2 : 1;
      api.setSetting('readerSpread', String(next));
      return next;
    });
  };
  const jumpToChapter = (ch: Chapter) => {
    setShowToc(false);
    const tc = chunkOf(ch.offset);
    pendingOffsetRef.current = ch.offset;
    setPosOffset(ch.offset);
    if (tc !== safeChunk) { setChunkIdx(tc); return; }
    relayout(); // 同块内直接重定位
  };

  // 当前所在章节（用于目录高亮），统一按 posOffset 判定
  const activeChapterIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].offset <= posOffset) idx = i; else break;
    }
    return idx;
  }, [chapters, posOffset]);

  const gapEm = PARA_GAPS.find((g) => g.key === paraGap)?.em ?? 0.7;
  const px = -page * pageWidthRef.current;
  const columnsTransform =
    readMode === 'scroll' ? 'none'
    : readMode === 'vertical' ? `translateY(${px}px)`
    : `translateX(${px}px)`;
  const totalChars = content.length || 1;
  const overallPct = Math.min(100, Math.max(0, Math.round((posOffset / totalChars) * 100)));

  return (
    <div className={`text-reader theme-${theme}`}>
      {/* 顶栏 */}
      <div className="reader-topbar">
        <button className="reader-icon-btn" onClick={() => setShowToc((s) => !s)} title="目录">
          <List size={20} />
        </button>
        <div className="reader-title" title={video.name}>{video.name}</div>
        <div className="reader-tools">
          <button className="reader-icon-btn" onClick={() => changeFont(-2)} title="缩小字号"><Minus size={18} /></button>
          <span className="reader-font-size">{fontSize}</span>
          <button className="reader-icon-btn" onClick={() => changeFont(2)} title="放大字号"><Plus size={18} /></button>
          <div className="reader-theme-group" title="翻页效果">
            {READ_MODES.map((m) => (
              <button
                key={m.key}
                className={'reader-theme-btn' + (readMode === m.key ? ' active' : '')}
                onClick={() => changeMode(m.key)}
              >{m.label}</button>
            ))}
          </div>
          {readMode === 'horizontal' && (
            <button
              className={'reader-theme-btn' + (spread === 2 ? ' active' : '')}
              onClick={toggleSpread}
              title={spread === 1 ? '单页（点击切换双页）' : '双页（点击切换单页）'}
            >{spread === 1 ? '单页' : '双页'}</button>
          )}
          <div className="reader-theme-group" title="段落间距">
            {PARA_GAPS.map((g) => (
              <button
                key={g.key}
                className={'reader-theme-btn' + (paraGap === g.key ? ' active' : '')}
                onClick={() => changeGap(g.key)}
              >{g.label}</button>
            ))}
          </div>
          <div className="reader-theme-group">
            {THEMES.map((t) => (
              <button
                key={t.key}
                className={'reader-theme-btn' + (theme === t.key ? ' active' : '')}
                onClick={() => changeTheme(t.key)}
              >{t.label}</button>
            ))}
          </div>
          <button className="reader-icon-btn" onClick={toggleFullscreen} title="全屏 (F)">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <button className="reader-icon-btn" onClick={closeReader} title="关闭 (Esc)"><X size={20} /></button>
        </div>
      </div>

      {/* 目录抽屉 */}
      {showToc && (
        <div className="reader-toc-mask" onClick={() => setShowToc(false)}>
          <div className="reader-toc" onClick={(e) => e.stopPropagation()}>
            <div className="reader-toc-head">目录（{chapters.length}）</div>
            <div className="reader-toc-list">
              {chapters.length === 0 && <div className="reader-toc-empty">未识别到章节</div>}
              {chapters.map((ch, i) => (
                <button
                  key={i}
                  className={'reader-toc-item' + (i === activeChapterIdx ? ' active' : '')}
                  onClick={() => jumpToChapter(ch)}
                >{ch.title}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 阅读区 */}
      <div className={'reader-viewport reader-mode-' + readMode} ref={viewportRef}>
        {loading && <div className="reader-status">正在加载...</div>}
        {error && <div className="reader-status reader-error">{error}</div>}
        <div className="reader-clip" ref={clipRef}>
          {!loading && !error && (
            <div
              key={safeChunk}
              className="reader-columns"
              ref={columnsRef}
              style={{ fontSize, transform: columnsTransform, ['--para-gap' as string]: `${gapEm}em` }}
            >
              {chunkNodes}
            </div>
          )}
        </div>

        {/* 左右点击翻页热区 */}
        {!loading && !error && (
          <>
            <button className="reader-tap reader-tap-left" onClick={prevPage} aria-label="上一页">
              <ChevronLeft size={28} />
            </button>
            <button className="reader-tap reader-tap-right" onClick={nextPage} aria-label="下一页">
              <ChevronRight size={28} />
            </button>
          </>
        )}
      </div>

      {/* 底栏：章节 / 页码 / 全书进度 */}
      <div className="reader-footer">
        {chapters[activeChapterIdx] && (
          <span className="reader-footer-chapter">{chapters[activeChapterIdx].title}</span>
        )}
        <span className="reader-footer-page">
          {readMode === 'scroll'
            ? `${overallPct}%`
            : `${page + 1}/${pageCount} · ${overallPct}%`}
        </span>
      </div>
    </div>
  );
}
