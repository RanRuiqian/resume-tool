import { useApp } from '../store';
import type { TemplateConfig } from '../types';
import { uid } from '../locale/text';

/** 修改当前模板；内置模板会自动另存为「xx（自定义）」 */
export function useEditTemplate() {
  const { template, saveTemplate, setTemplateId, templates } = useApp();
  return (fn: (x: TemplateConfig) => void) => {
    const n = structuredClone(template);
    if (n.builtin) {
      const existing = templates.find((t) => !t.builtin && t.id.startsWith(`${template.id}-custom`));
      n.builtin = false; n.id = existing?.id ?? `${template.id}-custom-${uid('t').slice(2, 8)}`;
      n.name = { zh: `${template.name.zh}（我的）`, en: `${template.name.en} (mine)` };
    }
    fn(n); saveTemplate(n); setTemplateId(n.id);
  };
}
