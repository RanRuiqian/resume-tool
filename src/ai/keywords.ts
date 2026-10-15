import type { Bi } from '../types';
/** 规则模式使用的常见关键词中英对照表（AI 不可用时兜底，也可由社区扩充） */
export const KEYWORD_DICT: Bi[] = [
  ['React', 'React'], ['Vue', 'Vue'], ['Angular', 'Angular'], ['TypeScript', 'TypeScript'], ['JavaScript', 'JavaScript'],
  ['Node.js', 'Node.js'], ['Vite', 'Vite'], ['Webpack', 'Webpack'], ['Next.js', 'Next.js'], ['CSS', 'CSS'],
  ['Kubernetes', 'Kubernetes'], ['Docker', 'Docker'], ['Python', 'Python'], ['Java', 'Java'], ['Go', 'Go'], ['SQL', 'SQL'],
  ['Spring', 'Spring'], ['Redis', 'Redis'], ['MySQL', 'MySQL'], ['AWS', 'AWS'], ['LLM', 'LLM'], ['PyTorch', 'PyTorch'],
  ['性能优化', 'performance optimization'], ['组件库', 'component library'], ['设计系统', 'design system'],
  ['前端工程化', 'frontend engineering'], ['工程化', 'engineering tooling'], ['数据可视化', 'data visualization'], ['微前端', 'micro-frontends'],
  ['单元测试', 'unit testing'], ['架构设计', 'architecture design'], ['跨端', 'cross-platform'], ['小程序', 'mini programs'],
  ['机器学习', 'machine learning'], ['数据分析', 'data analysis'], ['团队管理', 'team leadership'], ['编辑器', 'editor'],
  ['首屏', 'first-screen load'], ['监控', 'monitoring'], ['产品设计', 'product design'], ['用户研究', 'user research'],
  ['实时', 'real-time'], ['可视化', 'visualization'], ['构建工具', 'build tools'],
].map(([zh, en]) => ({ zh, en }));
