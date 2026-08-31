import { Video, Tag, Folder } from '../types';

// 4 个真实视频（点击可真播放），缩略图已用 mpv 抽帧生成
const REAL_VIDEOS: { path: string; thumb: string; w: number; h: number }[] = [
  { path: '/Users/mr.su/Downloads/7_15488491008712.mp4', thumb: '/mock-thumbs/thumb1.jpg', w: 3840, h: 2160 },
  { path: '/Users/mr.su/Downloads/3_15488491008637.mp4', thumb: '/mock-thumbs/thumb2.jpg', w: 3840, h: 2160 },
  { path: '/Users/mr.su/Downloads/7_15488491008750.mp4', thumb: '/mock-thumbs/thumb3.jpg', w: 2560, h: 1440 },
  { path: '/Users/mr.su/Downloads/5_15488491008663.mp4', thumb: '/mock-thumbs/thumb4.jpg', w: 3840, h: 2160 },
];

// 假视频的名字池、标签池、目录池
const NAME_POOL = [
  '海边日落延时', '城市夜景航拍', '雪山纪录片', '猫咪日常', '街头美食探店',
  '钢琴演奏现场', '赛车比赛集锦', '深海生物图鉴', '古镇漫游', '烟花大会',
  '森林徒步 Vlog', '咖啡制作教程', '篮球高光时刻', '极光实拍', '沙漠越野',
  '樱花季记录', '夜市烟火气', '潜水探洞', '滑雪第一视角', '雨天窗边',
];

// 渐变色池（给占位卡片用）—— 现代紧凑风的低饱和渐变
const GRADIENTS = [
  ['#667eea', '#764ba2'], ['#f093fb', '#f5576c'], ['#4facfe', '#00f2fe'],
  ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'], ['#30cfd0', '#330867'],
  ['#a8edea', '#fed6e3'], ['#ff9a9e', '#fecfef'], ['#5ee7df', '#b490ca'],
  ['#c471f5', '#fa71cd'], ['#48c6ef', '#6f86d6'], ['#feada6', '#f5efef'],
];

// 各种宽高比：横向、竖向、方形混合，撑出瀑布流错落感
const RATIOS = [
  { w: 1920, h: 1080 }, // 16:9 横
  { w: 1080, h: 1920 }, // 9:16 竖
  { w: 1080, h: 1080 }, // 1:1 方
  { w: 1280, h: 720 },  // 16:9 横
  { w: 720, h: 1280 },  // 9:16 竖
  { w: 1440, h: 1080 }, // 4:3 横
  { w: 1080, h: 1350 }, // 4:5 竖
];

// 目录结构（原始拓扑）+ 对应标签
const FOLDER_DEFS = [
  { root: '影视收藏', subs: ['电影', '纪录片', '动画'] },
  { root: '生活记录', subs: ['旅行', '美食', '宠物'] },
  { root: '学习资料', subs: ['教程', '演讲'] },
];

export interface MockDataset {
  videos: Video[];
  tags: Tag[];
  folders: Folder[];
}

// 生成整套 mock 数据
export function generateMockData(): MockDataset {
  const folders: Folder[] = [];
  const tagMap = new Map<string, number>();
  const videoTags = new Map<number, number[]>(); // videoId -> tagIds
  let folderId = 1;
  let tagId = 1;

  // 建目录树 + 标签（子目录名即标签）
  const leafFolders: { id: number; tagIds: number[] }[] = [];
  for (const def of FOLDER_DEFS) {
    const rootId = folderId++;
    folders.push({ id: rootId, path: `/Movies/${def.root}`, name: def.root, parent_id: null, import_root_id: rootId, hidden: 0 });
    for (const sub of def.subs) {
      const subId = folderId++;
      folders.push({ id: subId, path: `/Movies/${def.root}/${sub}`, name: sub, parent_id: rootId, import_root_id: rootId, hidden: 0 });
      // 标签：root 名 + sub 名
      if (!tagMap.has(def.root)) tagMap.set(def.root, tagId++);
      if (!tagMap.has(sub)) tagMap.set(sub, tagId++);
      leafFolders.push({ id: subId, tagIds: [tagMap.get(def.root)!, tagMap.get(sub)!] });
    }
  }

  const videos: Video[] = [];
  let vid = 1;

  // 先放 4 个真实视频
  REAL_VIDEOS.forEach((rv, idx) => {
    const leaf = leafFolders[idx % leafFolders.length];
    const id = vid++;
    videos.push({
      id, path: rv.path, name: rv.path.split('/').pop()!, ext: '.mp4',
      size: 50_000_000 + Math.floor(Math.random() * 500_000_000),
      duration: 60 + Math.floor(Math.random() * 600),
      width: rv.w, height: rv.h, aspect_ratio: rv.w / rv.h,
      thumbnail_path: rv.thumb, folder_id: leaf.id,
      added_at: Date.now() - id * 100000, mtime: Date.now(),
      favorited: 0, marked_for_deletion: 0,
    });
    videoTags.set(id, leaf.tagIds);
  });

  // 再生成 ~44 个占位视频
  for (let i = 0; i < 44; i++) {
    const leaf = leafFolders[i % leafFolders.length];
    const ratio = RATIOS[i % RATIOS.length];
    const grad = GRADIENTS[i % GRADIENTS.length];
    const id = vid++;
    videos.push({
      id,
      path: `/Movies/mock/video_${id}.mp4`,
      name: `${NAME_POOL[i % NAME_POOL.length]} ${String(i + 1).padStart(2, '0')}`,
      ext: ['.mp4', '.mkv', '.mov', '.webm'][i % 4],
      size: 20_000_000 + Math.floor(Math.random() * 800_000_000),
      duration: 30 + Math.floor(Math.random() * 3600),
      width: ratio.w, height: ratio.h, aspect_ratio: ratio.w / ratio.h,
      // 占位缩略图用渐变（data URI），存两个颜色，卡片组件负责渲染
      thumbnail_path: `gradient:${grad[0]},${grad[1]}`,
      folder_id: leaf.id,
      added_at: Date.now() - id * 100000, mtime: Date.now(),
      favorited: 0, marked_for_deletion: 0,
    });
    videoTags.set(id, leaf.tagIds);
  }

  // 统计标签数量
  const tagCounts = new Map<number, number>();
  videoTags.forEach((tids) => tids.forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
  const tags: Tag[] = Array.from(tagMap.entries()).map(([name, id]) => ({
    id, name, count: tagCounts.get(id) || 0,
  }));

  // 把 videoTags 挂到全局，供 mock 查询用
  (globalThis as any).__mockVideoTags = videoTags;

  return { videos, tags, folders };
}
