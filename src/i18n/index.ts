import type { Lang } from '../types';
import { useApp } from '../store';

/** UI 文案（v1 以中文为主，英文为部分翻译，缺失回退中文） */
const zh = {
  appName: '双语简历生成器', navProfile: '资料库', navJob: '岗位解析', navGenerate: '生成简历', navLayout: '版式设置', navSettings: '设置',
  demoBadge: '演示模式（无需 API Key）', save: '保存', cancel: '取消', add: '添加', remove: '删除', up: '上移', down: '下移',
  exportZip: '一键导出 zip', importJson: '导入 JSON', exportJson: '导出 JSON 备份', loadSample: '载入示例资料',
  translateToEn: 'AI 补译英文', translateToZh: 'AI 补译中文', parse: '解析岗位', ocr: '识别截图文字', generate: '生成中英两版',
  preview: '预览', privacy: '你的资料仅保存在本浏览器（IndexedDB）。调用 AI 时，资料与 JD 会直接发送到你配置的服务商；照片、出生年月、性别、籍贯不会发送。',
};
type Dict = typeof zh;
const en: Partial<Dict> = {
  appName: 'Bilingual Resume Builder', navProfile: 'Profile', navJob: 'Job Parsing', navGenerate: 'Generate', navLayout: 'Layout', navSettings: 'Settings',
  demoBadge: 'Demo mode (no API key)', save: 'Save', cancel: 'Cancel', add: 'Add', remove: 'Delete', up: 'Up', down: 'Down',
  exportZip: 'Export zip', importJson: 'Import JSON', exportJson: 'Export JSON', loadSample: 'Load sample', translateToEn: 'AI translate → EN',
  translateToZh: 'AI translate → ZH', parse: 'Parse job', ocr: 'OCR screenshot', generate: 'Generate CN + EN', preview: 'Preview',
};
const DICTS: Record<Lang, Partial<Dict>> = { zh, en };
export type MsgKey = keyof Dict;
export const translate = (lang: Lang, k: MsgKey) => DICTS[lang][k] ?? zh[k];
export function useT() { const { settings } = useApp(); return (k: MsgKey) => translate(settings.uiLang, k); }
