/** 运行模式：?demo 时使用完全独立的演示数据库，绝不读写真实资料 */
export const DB_REAL = 'resume-tool';
export const DB_DEMO = 'resume-tool-demo';

export function isDemoSearch(search: string): boolean {
  return new URLSearchParams(search).has('demo');
}

export const IS_DEMO = typeof location !== 'undefined' && isDemoSearch(location.search);

/** 界面小状态（如向导步骤）：演示模式用 sessionStorage，不污染真实设置 */
export const uiStorage: Pick<Storage, 'getItem' | 'setItem'> =
  typeof window === 'undefined' ? { getItem: () => null, setItem: () => {} } : IS_DEMO ? window.sessionStorage : window.localStorage;

/** 退出演示：去掉 ?demo 重新加载，回到真实数据库 */
export function exitDemoUrl(): string {
  return location.pathname + location.hash;
}
