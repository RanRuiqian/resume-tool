# 2026-11-03 求职信 / 备考方向重做：编造句被自动删掉并列出、其余照常保存；备考方向按要求编号输出要点。
# 全部虚构：先 `npx tsx scripts/prepare-workspace-e2e.ts` 生成夹具；AI 接口由 Playwright 拦截返回模拟内容。
import json, os, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:4173/')
F = json.loads(Path(os.environ.get('WORKSPACE_FIXTURE', '/tmp/resume-workspace-fictional.json')).read_text())
ok = []
def chk(n, c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n, flush=True)
FAKE = '我带领团队把检测系统部署到生产线上，良率提升 35%。'
KIT = {
  'coverLetter': {
    'zh': '您好，我应聘机械结构设计工程师岗位。\n课程项目中我参与测量光学探头部件尺寸并设计模块化外壳。课程项目中我参与原型装配并完成成像测试。' + FAKE + '\n期待有机会进一步沟通。',
    'en': 'Dear Hiring Manager, I am applying for the Mechanical Design Engineer role. In a course project, I took part in measuring optical probe parts and designed a modular housing. In the course project, I took part in prototype assembly and completed imaging tests. I led a team that deployed the inspection system on a production line, raising yield by 35%. I look forward to hearing from you.'},
  'selfIntro': {
    'zh': '大家好，我是轮机工程专业的学生。课程项目中我参与测量光学探头部件尺寸并设计模块化外壳。课程项目中我参与原型装配并完成成像测试。我希望在机械结构设计岗位上继续学习。',
    'en': 'Hello, I study Marine Engineering. In a course project, I took part in measuring optical probe parts and designed a modular housing. I also took part in prototype assembly and completed imaging tests. I hope to keep learning in a mechanical design role.'},
}
PREP = {'items': [{'area': {'zh': '机械结构设计基础', 'en': 'Mechanical design basics'}, 'why': {'zh': '岗位核心工作，面试常问设计思路。', 'en': 'Core of the role.'}, 'points': [{'zh': '公差配合与工程图表达', 'en': 'Tolerances and drawings'}, {'zh': '讲清一个零件的设计过程', 'en': 'Walk through a part design'}], 'refs': ['R1']}]}
mode = {'v': 'kit'}
held = []
def ai(route):
    pd = route.request.post_data or ''
    body = PREP if ('R1' in pd and 'refs' in pd) else KIT
    if mode['v'] == 'both': held.append((route, body)); return  # 先扣住，等两个请求都到了再回复
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices': [{'message': {'content': json.dumps(body, ensure_ascii=False)}, 'finish_reason': 'stop'}]}))
SEED = """f=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction(['profile','settings','jobs','resumes','state'],'readwrite');t.objectStore('profile').put({id:'me',doc:f.profile});t.objectStore('settings').put(f.settings);t.objectStore('jobs').put(f.job);t.objectStore('resumes').put(f.resume);t.objectStore('state').put({id:'jobId',value:f.job.id});t.objectStore('state').put({id:'resumeId',value:f.resume.id});t.oncomplete=()=>{d.close();resolve()}}})"""
GET = """()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result;const t=d.transaction('resumes').objectStore('resumes').getAll();t.onsuccess=()=>{d.close();r(t.result[0])}}})"""
with tempfile.TemporaryDirectory(prefix='kit-') as folder, sync_playwright() as p:
    c = p.chromium.launch_persistent_context(folder, executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'], viewport={'width': 1440, 'height': 1100})
    c.route('**/chat/completions', ai)
    pg = c.pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda x: x.accept())
    pg.goto(B); pg.wait_for_timeout(500); pg.evaluate(SEED, F); pg.evaluate("localStorage.setItem('wizardStep','4')"); pg.reload()
    pg.wait_for_selector('.preview-page'); pg.locator('summary', has_text='可选：求职信').click()
    pg.get_by_role('button', name='求职信 + 1 分钟自我介绍').click()
    pg.wait_for_selector('[data-testid=kit-review], [data-testid=kit-blocked]', timeout=30000)
    chk('有编造句时不再整份拦截，而是保存并给出核对提示', pg.locator('[data-testid=kit-review]').count() == 1 and pg.locator('[data-testid=kit-blocked]').count() == 0)
    pg.locator('[data-testid=kit-review] summary').click()
    removed = pg.locator('[data-testid=kit-removed]').inner_text()
    chk('编造句（带领团队 / 部署产线 / 新数字）被删除并列出原因', '部署到生产线' in removed and 'production line' in removed)
    r = pg.evaluate(GET); cl = r['extras']['coverLetter']
    chk('保存的求职信不含编造句，其余句子保留、段落换行保留', FAKE not in cl['zh'] and '35%' not in cl['en'] and '设计模块化外壳' in cl['zh'] and '\n' in cl['zh'])
    chk('求职信文本框显示保存后的内容', '设计模块化外壳' in pg.locator('.career-kit textarea').first.input_value())
    mode['v'] = 'prep'
    pg.get_by_role('button', name='备考大方向').click(); pg.wait_for_selector('.prep-item', timeout=30000)
    txt = pg.locator('.interview.prep').inner_text()
    chk('备考方向有输出：方向名、要点、对应岗位要求原文', '机械结构设计基础' in txt and '公差配合' in txt and pg.locator('[data-testid=prep-points] li').count() == 2 and '岗位原文' in txt)
    if os.environ.get('KIT_SHOT'): pg.locator('.career-kit').screenshot(path=os.environ['KIT_SHOT'])
    # ---------- 两项一起生成：同时在途，后完成的不覆盖先完成的 ----------
    pg.evaluate(SEED, F); pg.reload(); pg.wait_for_selector('.preview-page'); pg.locator('summary', has_text='可选：求职信').click()
    mode['v'] = 'both'
    pg.click('[data-testid=kit-both]')
    for _ in range(50):
        if len(held) >= 2: break
        pg.wait_for_timeout(100)
    chk('两个 AI 请求同时在途（并行，不是一个结束才发下一个）', len(held) == 2)
    chk('两项同时显示进度', pg.locator('[data-testid=kit-busy-cover]').count() == 1 and pg.locator('[data-testid=kit-busy-interview]').count() == 1)
    # 备考方向先完成，求职信后完成（后完成的若基于旧简历保存就会覆盖备考结果）
    for want in (PREP, KIT):
        for rt, b in list(held):
            if b is want: rt.fulfill(status=200, content_type='application/json', body=json.dumps({'choices': [{'message': {'content': json.dumps(b, ensure_ascii=False)}, 'finish_reason': 'stop'}]})); held.remove((rt, b)); pg.wait_for_timeout(800)
    for _ in range(50):
        if held: rt, b = held.pop(0); rt.fulfill(status=200, content_type='application/json', body=json.dumps({'choices': [{'message': {'content': json.dumps(b, ensure_ascii=False)}, 'finish_reason': 'stop'}]}))
        if pg.locator('[data-testid=kit-busy-cover]').count() == 0: break
        pg.wait_for_timeout(200)
    pg.wait_for_selector('[data-testid=kit-busy-cover]', state='detached', timeout=30000); pg.wait_for_selector('[data-testid=kit-busy-interview]', state='detached', timeout=30000); pg.wait_for_timeout(500)
    r = pg.evaluate(GET); e = r.get('extras') or {}
    chk('两项结果都保存了（求职信没有把先完成的备考方向覆盖掉）', bool(e.get('prep')) and '设计模块化外壳' in (e.get('coverLetter') or {}).get('zh', ''))
    # ---------- 公版简历：不显示备考方向，提示占位符 ----------
    G = json.loads(json.dumps(F)); G['job']['generic'] = True
    pg.evaluate(SEED, G); pg.reload(); pg.wait_for_selector('.preview-page'); pg.locator('summary', has_text='可选：求职信').click()
    chk('公版简历：隐藏「两项一起生成」「备考大方向」，显示占位符说明', pg.locator('[data-testid=kit-both]').count() == 0 and pg.get_by_role('button', name='备考大方向').count() == 0 and pg.locator('[data-testid=kit-generic-note]').count() == 1)
    chk('无页面错误', not errs)
print(f'RESULT {sum(ok)} / {len(ok)}')
