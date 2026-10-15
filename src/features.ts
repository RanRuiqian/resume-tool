/**
 * 功能开关：每个增强功能都可在这里一键关闭（false 即隐藏入口，不影响核心流程）。
 * Feature flags: set any to false to remove the feature's UI entry points.
 */
export const FEATURES = {
  /** 岗位历史：每个岗位的定制简历自动保存，可重新打开/再次导出 */
  jobHistory: true,
  /** 匹配分析：ATS 关键词覆盖率 + 缺口建议（只建议补充真实经历，不代写） */
  matchInsights: true,
  /** 求职信 / 自我介绍（中英），可选加入 zip */
  coverLetter: true,
  /** 面试准备：根据岗位与简历生成可能被问到的问题与回答要点 */
  /** 备考大方向（基于 JD 原文，不生成具体面试题） */
  prepDirections: true,
  /** 撤销：生成结果的勾选/编辑可撤销（Ctrl+Z） */
  undo: true,
  /** 额外模板：简约居中、商务色块 */
  extraTemplates: true,
  /** 界面中英切换 */
  uiLangSwitch: true,
} as const;
export type FeatureKey = keyof typeof FEATURES;
