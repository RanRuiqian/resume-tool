import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { applyDecision, auditResume, confirmImportedEntries, auditText, diffTokens, makeContext, summarize } from '../src/audit/factAudit';
import { buildAllowlist, extractTechTerms, normTerm } from '../src/audit/techTerms';
import { buildSourceIndex } from '../src/audit/sourceIndex';
import { rawToProfile } from '../src/ai/importProfile';
import { applyImportPlan, buildImportPlan } from '../src/ai/importPlan';
import { normalizeProfile } from '../src/storage/profileIO';
import type { GenItem, ProfileDoc, ResumeDoc } from '../src/types';

// 全部为模拟资料（PART C）
function mockProfile(): ProfileDoc {
  const p = rawToProfile({
    name: '测试用户庚', summary: '机械工程硕士在读，关注工业视觉',
    education: [{ school: '模拟理工大学', degree: '硕士', major: '机械工程', start: '2024-09', end: '2026-06', expectedConferralDate: '2026-06', highlights: ['课程设计：用 MATLAB 完成机械臂运动学仿真'], courses: ['机器学习', '深度学习'] }],
    work: [{ company: '模拟智能装备有限公司', title: '视觉算法实习生', start: '2025-03', end: '2025-08', tags: ['Python', 'OpenCV'],
      bullets: ['负责开发工业视觉检测程序，使用 OpenCV 对图像进行预处理', '参与团队搭建缺陷检测流程，检测耗时降低 30%'] }],
    projects: [{ name: '焊缝检测原型', role: '成员', start: '2024-10', end: '2025-01', tags: ['Python'], bullets: ['在实验室搭建焊缝检测原型系统'] },
      { name: 'AGV 调度', start: '2025-02', end: '2025-05', tags: ['ROS2'], bullets: ['实现 A* 路径规划'] }],
    skills: [{ name: 'Python' }, { name: 'OpenCV' }],
  });
  p.education[0].highlights[0].en = 'Course design: simulated robot-arm kinematics in MATLAB';
  p.work[0].bullets[1].en = 'Took part in building the defect-detection pipeline; cut inspection time by 30%';
  return normalizeProfile(p);
}
const ids = (p: ProfileDoc) => ({ w0: p.work[0].bullets[0].id!, w1: p.work[0].bullets[1].id!, pr0: p.projects[0].bullets[0].id!, pr1: p.projects[1].bullets[0].id!, ed0: p.education[0].highlights[0].id!, edu: p.education[0].id });
const resume = (items: GenItem[]): ResumeDoc => ({ id: 'r1', jobId: 'j1', templateId: 't', primaryLanguage: 'zh', createdAt: '2026-10-31', matchScore: 80, gaps: [], selection: { work: [], projects: [], education: [], skills: [], certificates: [], awards: [] }, items, consistency: { checkedAt: '', issues: [] }, generatedBy: 'ai' });
const gi = (sourceId: string, zh: string, en = ''): GenItem => ({ sourceId, zh, en, syncStatus: 'in-sync' });
const codes = (a: { findings: { code: string }[] }) => a.findings.map((f) => f.code);

describe('事实来源索引（B2）', () => {
  it('复用已有 sourceId，记录类型、路径、原文与确认状态', () => {
    const p = mockProfile(); const idx = buildSourceIndex(p); const { w0, edu } = ids(p);
    expect(idx.get(w0)).toMatchObject({ sourceType: 'work-bullet', parentId: p.work[0].id });
    expect(idx.get(w0)!.originalText.zh).toContain('OpenCV');
    expect(idx.get(w0)!.sourcePath).toContain('bullets[0]');
    expect(idx.get(edu)!.degreePending).toBe(true);
  });
  it('技术许可清单：规范化大小写 / 同义拼写，但不使用专业、课程、JD', () => {
    const p = mockProfile(); const a = buildAllowlist(p);
    expect(a.terms.has(normTerm('opencv'))).toBe(true);
    expect(normTerm('cv2')).toBe(normTerm('OpenCV'));
    expect(normTerm('K8s')).toBe(normTerm('kubernetes'));
    expect(normTerm('PyTorch')).not.toBe(normTerm('TensorFlow'));
    expect(a.terms.has(normTerm('深度学习'))).toBe(false); // 只出现在课程里
    expect(a.terms.has(normTerm('机械工程'))).toBe(false);
    expect(extractTechTerms('基于 TensorFlow 与 YOLOv8，使用 CUDA 加速')).toEqual(expect.arrayContaining(['TensorFlow', 'YOLOv8', 'CUDA']));
  });
});

describe('PART C 场景', () => {
  it('1. 只优化措辞 → 绿色', () => {
    const p = mockProfile(); const c = makeContext(p);
    const a = auditText(c, ids(p).w0, 'zh', '基于 OpenCV 开发工业视觉检测程序，完成图像预处理');
    expect(a.level).toBe('green'); expect(a.newTerms).toEqual([]);
  });
  it('2. 添加未使用过的技术 → 红色并列出技术词', () => {
    const p = mockProfile(); const a = auditText(makeContext(p), ids(p).w0, 'zh', '基于 TensorFlow 与 YOLOv8 开发工业视觉检测程序，使用 CUDA 加速 OpenCV 图像预处理');
    expect(a.level).toBe('red');
    expect(a.newTerms).toEqual(expect.arrayContaining(['TensorFlow', 'YOLOv8', 'CUDA']));
    expect(a.findings.find((f) => f.code === 'new-tech')!.reason).toContain('尚未在你的资料库中找到对应使用记录');
    expect(a.findings[0].quote).toContain('OpenCV');
  });
  it('3. 团队成果写成个人成果 → 红色', () => {
    const p = mockProfile(); const a = auditText(makeContext(p), ids(p).w1, 'zh', '独立搭建缺陷检测流程，检测耗时降低 30%');
    expect(a.level).toBe('red'); expect(codes(a)).toContain('team-to-solo');
  });
  it('4. 实验室原型写成已商业化产品 → 红色', () => {
    const p = mockProfile(); const a = auditText(makeContext(p), ids(p).pr0, 'zh', '搭建焊缝检测系统并实现量产商业化');
    expect(a.level).toBe('red'); expect(codes(a)).toContain('proto-to-commercial');
  });
  it('5. 修改性能提升百分比 → 红色', () => {
    const p = mockProfile(); const a = auditText(makeContext(p), ids(p).w1, 'zh', '参与团队搭建缺陷检测流程，检测耗时降低 45%');
    expect(a.level).toBe('red'); expect(a.numberDiff).toContain('+45'); expect(a.checks.numbersKept).toBe(false);
  });
  it('6. 修改工作开始或结束日期 → 红色', () => {
    const p = mockProfile(); const a = auditText(makeContext(p), ids(p).w0, 'zh', '2024-01 起负责开发工业视觉检测程序，使用 OpenCV 对图像进行预处理');
    expect(a.level).toBe('red'); expect(codes(a)).toEqual(expect.arrayContaining(['number-changed', 'date-changed']));
  });
  it('7. 课程经历说成工作经验 → 红色', () => {
    const p = mockProfile(); const a = auditText(makeContext(p), ids(p).ed0, 'zh', '具备机械臂运动学仿真的工作经验（MATLAB）');
    expect(a.level).toBe('red'); expect(codes(a)).toContain('course-to-work');
  });
  it('8. 预计学位写成已获得 → 红色', () => {
    const p = mockProfile(); const a = auditText(makeContext(p), 'summary', 'zh', '已获得机械工程硕士学位，关注工业视觉');
    expect(a.level).toBe('red'); expect(codes(a)).toContain('degree-claimed');
  });
  it('9. 英文译文数字与中文不一致 → 红色、跨语言提示、不是已同步', () => {
    const p = mockProfile(); const { w1 } = ids(p);
    const r = resume([{ ...gi(w1, '参与团队搭建缺陷检测流程，检测耗时降低 30%', 'Helped build the defect-detection pipeline, cutting inspection time by 35%'), syncStatus: 'needs-review' }]);
    const au = auditResume(p, r);
    expect(au.items[0].en.level).toBe('red');
    expect(au.items[0].crossIssues.join()).toContain('中英文');
    expect(au.items[0].crossIssues.join()).toContain('不能视为已同步');
  });
  it('10. 用户手动批准一条改写 → 记录保存，摘要计入已审查', () => {
    const p = mockProfile(); const { w0 } = ids(p);
    const r0 = resume([gi(w0, '基于 TensorFlow 开发工业视觉检测程序，使用 OpenCV 预处理图像')]);
    const before = auditResume(p, r0).summary;
    // 红色风险：单纯「接受」不算处理，需二次确认（riskAck）
    expect(summarize(auditResume(p, applyDecision(p, r0, w0, 'zh', 'accepted')).items, r0, ['zh']).reviewed).toBe(0);
    const r1 = applyDecision(p, r0, w0, 'zh', 'accepted', undefined, { riskAck: { statement: '我确认', evidenceIds: [] } });
    expect(r1.audit!.decisions[w0].zh!.decision).toBe('accepted');
    expect(r1.items[0].zh).toBe(r0.items[0].zh);
    const after = summarize(auditResume(p, r1).items, r1, ['zh']);
    expect(after.reviewed).toBe(1);
    expect(before.unconfirmedRed).toBeGreaterThan(0);
    expect(after.unconfirmedRed).toBe(0);
  });
  it('11. 拒绝改写并恢复原文 → 简历恢复资料库原文，资料库不变', () => {
    const p = mockProfile(); const snap = JSON.stringify(p); const { w0 } = ids(p);
    const r1 = applyDecision(p, resume([gi(w0, '基于 TensorFlow 开发检测程序')]), w0, 'zh', 'restored');
    expect(r1.items[0].zh).toBe(p.work[0].bullets[0].zh);
    expect(r1.audit!.decisions[w0].zh!.aiText).toBe('基于 TensorFlow 开发检测程序');
    expect(JSON.stringify(p)).toBe(snap);
    expect(auditResume(p, r1).items[0].zh.level).toBe('green');
  });
  it('12. 编辑一条后其它条目不受影响；改数字时提示另一语言重新检查', () => {
    const p = mockProfile(); const { w0, w1 } = ids(p);
    const r0 = resume([gi(w0, '基于 OpenCV 开发检测程序', 'Built an OpenCV inspection program'), gi(w1, '参与搭建缺陷检测流程，耗时降低 30%', 'Helped cut inspection time by 30%')]);
    const r1 = applyDecision(p, r0, w1, 'zh', 'edited', '参与搭建缺陷检测流程，耗时降低 35%');
    expect(r1.items[0]).toEqual(r0.items[0]);
    expect(r1.audit!.decisions[w0]).toBeUndefined();
    expect(r1.items[1].zh).toContain('35%');
    expect(r1.items[1].syncStatus).toBe('pending');
    expect(r1.audit!.decisions[w1].en!.recheck).toBe(true);
    expect(auditResume(p, r1).items[1].crossIssues.join()).toContain('重新检查');
    // 只在需要重新检查的英文版上提示，中文版（已编辑）不被重复要求确认
    const a1 = auditResume(p, r1).items[1];
    expect(a1.en.findings.some((x) => x.code === 'cross-lang-recheck')).toBe(true);
    expect(a1.zh.findings.some((x) => x.code === 'cross-lang-recheck')).toBe(false);
    // 英文版确认后 recheck 清除
    const r2 = applyDecision(p, applyDecision(p, r1, w1, 'en', 'edited', 'Helped cut inspection time by 35%'), w1, 'en', 'accepted');
    expect(r2.audit!.decisions[w1].en!.recheck).toBeFalsy();
  });
  it('13. 导出简历后来源关联和审查记录仍在', { timeout: 60000 }, async () => {
    const p = mockProfile(); const { w0 } = ids(p);
    const r1 = applyDecision(p, resume([gi(w0, '基于 OpenCV 开发检测程序', 'Built an OpenCV inspection program')]), w0, 'zh', 'accepted');
    const { ResumeDB } = await import('../src/storage/db');
    const d = new ResumeDB('audit-test-13'); await d.resumes.put(r1);
    const { buildExportItems } = await import('./helpers/exportHelper');
    await buildExportItems(p, r1);
    const back = (await d.resumes.get('r1'))!;
    expect(back.items[0].sourceId).toBe(w0);
    expect(back.audit!.decisions[w0].zh!.decision).toBe('accepted');
    d.close();
  });
  it('14. 旧版资料与历史简历（无 audit / 无 translation 字段）能正常读取与审查', () => {
    const legacy = normalizeProfile({ version: '1.0', primaryLanguage: 'zh', glossary: [], profile: { name: { zh: '旧用户' }, headline: {}, summary: {}, contacts: {}, personal: {} }, education: [], work: [{ id: 'w-old', enabled: true, company: { zh: '旧公司' }, title: { zh: '工程师' }, start: '2020-01', end: '2021-01', tags: [], bullets: [{ id: 'b-old', zh: '维护 Java 服务' }] }], projects: [], skills: [], certificates: [], awards: [] } as unknown as ProfileDoc);
    const old = { ...resume([{ sourceId: 'b-old', zh: '维护 Java 后端服务', en: '', syncStatus: 'in-sync' } as GenItem]) } as ResumeDoc;
    delete (old as Partial<ResumeDoc>).audit;
    const au = auditResume(legacy, old);
    expect(au.items[0].zh.checks.sourceValid).toBe(true);
    expect(au.items[0].zh.level).toBe('green');
    expect(au.items[0].en.level).toBe('gray');
  });
  it('15. 长文本智能导入后事实来源仍然准确', () => {
    const base = mockProfile();
    const inc = rawToProfile({ work: [{ company: '另一模拟公司', title: '数据分析实习', start: '2023-07', end: '2023-09', bullets: ['用 SQL 统计日活，报表效率提升 20%'] }] });
    const plan = buildImportPlan(base, inc);
    const out = normalizeProfile(applyImportPlan(base, inc, plan));
    const nb = out.work[1].bullets[0];
    const idx = buildSourceIndex(out);
    expect(idx.get(nb.id!)!.originalText.zh).toBe('用 SQL 统计日活，报表效率提升 20%');
    expect(idx.get(ids(base).w0)!.originalText.zh).toBe(base.work[0].bullets[0].zh);
    const a = auditText(makeContext(out), nb.id!, 'zh', '使用 SQL 统计日活，报表效率提升 20%');
    // AI 导入的新条目尚未确认：原文标为「未确认来源」（黄色，可人工处理）；确认后为绿色
    expect(a.level).toBe('yellow');
    expect(a.findings.map((f) => f.code)).toContain('source-unconfirmed');
    expect(auditText(makeContext(confirmImportedEntries(out, [out.work[1].id])), nb.id!, 'zh', '使用 SQL 统计日活，报表效率提升 20%').level).toBe('green');
  });
});

describe('差异高亮', () => {
  it('中文按字、英文按词', () => {
    const d = diffTokens('使用 OpenCV 预处理', '基于 OpenCV 预处理');
    expect(d.some(([t]) => t === 'add')).toBe(true);
    expect(diffTokens('built a tool', 'built a fast tool').filter(([t]) => t === 'add').map(([, s]) => s.trim())).toContain('fast');
  });
});
