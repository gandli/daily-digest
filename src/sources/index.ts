import type { Source } from '../types';
import { fetchTrending } from './trending';

// 数组即注册表。新增源: 新文件 + 这里加一行。
export const sources: Source[] = [{ name: 'trending', tag: 'trending', fetch: () => fetchTrending() }];
