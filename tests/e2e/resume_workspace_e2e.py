"""Isolated fictional workspace acceptance. No real browser data or AI credentials are used."""
import copy, io, json, os, tempfile, zipfile
from pathlib import Path
from urllib.parse import urlsplit
import fitz
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_BASE', 'http://localhost:4173/')
F = json.loads(Path(os.environ.get('WORKSPACE_FIXTURE', '/tmp/resume-workspace-fictional.json')).read_text())
checks, calls, errors, outside, dialogs = [], [], [], [], []
TABLES = ['profile', 'settings', 'jobs', 'resumes', 'state', 'postings', 'applications']
DUMP = """()=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction([...d.objectStoreNames]),o={};for(const n of t.objectStoreNames){const r=t.objectStore(n).getAll();r.onsuccess=()=>o[n]=r.result}t.oncomplete=()=>{d.close();resolve(o)}}})"""
SEED = """f=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction(['profile','settings','jobs','resumes','state','postings','applications'],'readwrite');t.objectStore('profile').put({id:'me',doc:f.profile});t.objectStore('settings').put(f.settings);t.objectStore('jobs').put(f.job);t.objectStore('resumes').put(f.resume);t.objectStore('state').put({id:'jobId',value:f.job.id});t.objectStore('state').put({id:'resumeId',value:f.resume.id});t.objectStore('state').put({id:'templateId',value:f.template.id});t.objectStore('postings').put({id:'keep-posting',company:'模拟保留企业',title:'模拟岗位',city:'',priority:1,source:{kind:'manual'},createdAt:'2026-01-01',updatedAt:'2026-01-01'});t.objectStore('applications').put({id:'keep-app',postingId:'keep-posting',status:'pending',todos:[],interviews:[],createdAt:'2026-01-01',updatedAt:'2026-01-01'});t.oncomplete=()=>{d.close();resolve()}}})"""
def check(label, condition):
    checks.append(bool(condition)); print(('PASS ' if condition else 'FAIL ') + label, flush=True); assert condition, label

def network(route):
    host = urlsplit(route.request.url).hostname
    if host in {'localhost', '127.0.0.1'}: route.continue_()
    else:
        outside.append(host)
        if '/chat/completions' in route.request.url: calls.append(route.request.post_data_json)
        route.abort()

with tempfile.TemporaryDirectory(prefix='resume-workspace-isolated-') as folder, sync_playwright() as p:
    c = p.chromium.launch_persistent_context(folder, executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'], viewport={'width': 1440, 'height': 1100}, accept_downloads=True, service_workers='block')
    c.route('**/*', network)
    pg = c.pages[0]; pg.on('pageerror', lambda error: errors.append(str(error)))
    pg.on('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.dismiss()))
    pg.goto(BASE); pg.wait_for_timeout(500)
    F['resume']['extras'] = {'coverLetter': {'zh': '测试用户X的人工求职信说明 EDITED-LETTER', 'en': 'Manually edited fictional cover letter EDITED-LETTER'}}
    pg.evaluate(SEED, F); pg.evaluate("localStorage.setItem('wizardStep','4')"); pg.reload()
    pg.wait_for_selector('.pool-entry'); pg.wait_for_selector('.preview-page'); pg.wait_for_timeout(500)
    before = pg.evaluate(DUMP)
    grade = pg.locator('.pool-bullet').filter(has_text='GPA: MOCK-MANUAL-GRADE').locator('input')
    check('成绩不由自动生成默认公开', 'MOCK-MANUAL-GRADE' not in pg.locator('.previews').inner_text())
    grade.check(); check('用户明确选用的文字正常预览，不被隐私默认值吞掉', 'MOCK-MANUAL-GRADE' in pg.locator('.previews').inner_text())
    grade.uncheck()

    check('旧下载页书签兼容三步流程，无需重导资料', pg.locator('.stepper li').count() == 3 and '编辑与下载' in pg.locator('.stepper').inner_text())
    check('保留左右素材与预览布局，移除评分和审查入口', pg.locator('.pool-layout .pool').count() == 1 and pg.locator('.pool-layout .previews').count() == 1 and pg.locator('.score, [data-testid=open-audit], [data-testid=audit-badge]').count() == 0)
    entry = next(e for e in F['profile']['projects'] if e['id'] == F['entryId'])
    extra = next(e for e in F['profile']['projects'] if e['id'] == F['extraId'])
    def project(name): return pg.locator('.pool-entry').filter(has=pg.locator('.pool-head b', has_text=name))
    row = project(entry['name']['zh']); head = row.locator('.pool-head input')
    edit = row.locator('details.pool-edit').filter(has=pg.locator(f'textarea[aria-label="{F["itemId"]} zh"]'))
    edit.locator('summary').click()
    zh, en = '测试用户X人工润色的课程实践说明 EDITED-CN', 'Manually edited fictional coursework EDITED-EN'
    edit.get_by_label(F['itemId'] + ' zh', exact=True).fill(zh); edit.get_by_label(F['itemId'] + ' en', exact=True).fill(en)
    check('人工编辑立即更新右侧预览', zh in pg.locator('.previews').inner_text())
    heading = row.locator('[data-testid=resume-entry-edit]'); heading.locator('summary').click()
    edited_title = '模拟本份简历项目标题'
    heading.get_by_label('名称 · 中文', exact=True).fill(edited_title)
    check('标题可直接编辑并立即预览，不改母库名称', edited_title in pg.locator('.previews').inner_text() and pg.evaluate(DUMP)['profile'] == before['profile'])
    head.uncheck(); pg.wait_for_timeout(200)
    check('取消整项后内容立即消失，母库没有删除', zh not in pg.locator('.previews').inner_text() and pg.evaluate(DUMP)['profile'] == before['profile'])
    pg.wait_for_timeout(500); pg.reload(); pg.wait_for_selector('.pool-entry'); pg.wait_for_selector('.preview-page')
    row = project(entry['name']['zh']); head = row.locator('.pool-head input')
    check('刷新后维持取消状态并保存人工文字缓存', not head.is_checked() and any(i['zh'] == zh for i in pg.evaluate(DUMP)['resumes'][0].get('deselectedItems', [])))
    head.check(); pg.wait_for_timeout(250)
    check('重新勾选恢复原人工编辑', zh in pg.locator('.previews').inner_text() and edited_title in pg.locator('.previews').inner_text())
    bullet = row.locator('.pool-bullets > div').filter(has=pg.locator(f'textarea[aria-label="{F["itemId"]} zh"]'))
    bullet.locator('.pool-bullet input').uncheck(); check('取消单条要点立即消失', zh not in pg.locator('.previews').inner_text())
    row.locator('.pool-bullet').filter(has_text=next(b['zh'] for b in entry['bullets'] if b['id'] == F['itemId'])).locator('input').check()
    pg.get_by_role('button', name='中英对照', exact=True).click()
    check('单条恢复保留中英人工编辑', zh in pg.locator('.previews').inner_text() and en in pg.locator('.previews').inner_text())
    extra_row = project(extra['name']['zh']); extra_row.locator('.pool-head input').check()
    check('只有中文的新素材无需翻译请求即可显示', '仅有中文的课程实践要点' in pg.locator('.previews').inner_text())
    check('左侧清单顺序与简历一致，可本地调整', pg.get_by_role('button', name='上移 ' + extra['name']['zh'], exact=True).is_enabled())
    pg.get_by_role('button', name='上移 ' + extra['name']['zh'], exact=True).click()
    check('排序即时更新右侧预览', pg.locator('.previews').inner_text().index(extra['name']['zh']) < pg.locator('.previews').inner_text().index(edited_title))
    extra_row.locator('.pool-head input').uncheck()
    for _ in range(5): head.uncheck(); head.check()
    pg.wait_for_timeout(500)
    check('连续勾选、编辑、排序都不调用 AI，也不弹二次确认', len(calls) == 0 and not dialogs and zh in pg.locator('.previews').inner_text())
    pg.get_by_role('button', name='⬇ 下载 PDF / Word', exact=True).click(); pg.wait_for_selector('.modal')
    check('人工修改可直接导出，无审查或证明材料拦截', pg.locator('[data-testid=export-kit-blocked], [data-testid=export-audit-warn], [data-testid=kit-override]').count() == 0 and pg.locator('.modal button.primary').is_enabled())
    with pg.expect_download(timeout=120000) as download: pg.locator('.modal button.primary').click()
    target = Path(folder) / 'resume.zip'; download.value.save_as(target)
    archive = zipfile.ZipFile(target); names = archive.namelist()
    check('中英文 PDF / Word 均生成，默认不附审查报告', sum(n.endswith('.pdf') for n in names) == 2 and sum(n.endswith('.docx') for n in names) == 4 and 'evidence-and-gaps.json' not in names)
    for lang, marker in [('CN', 'EDITED-CN'), ('EN', 'EDITED-EN')]:
        pdf = next(n for n in names if n.endswith(f'_{lang}.pdf')); docx = next(n for n in names if n.endswith(f'_{lang}.docx') and 'CoverLetter' not in n)
        doc = fitz.open(stream=archive.read(pdf), filetype='pdf'); pdf_text = ''.join(page.get_text() for page in doc)
        xml = zipfile.ZipFile(io.BytesIO(archive.read(docx))).read('word/document.xml').decode()
        check(f'{lang}导出包含恢复的人工文字、不包含取消的素材', marker in pdf_text and marker in xml and 'local-only-language' not in xml and extra['name']['zh'] not in xml and extra['name']['en'] not in xml)
    kit = next(n for n in names if 'CoverLetter' in n and n.endswith('_CN.docx'))
    check('人工求职信无需审查确认即可按选择导出', 'EDITED-LETTER' in zipfile.ZipFile(io.BytesIO(archive.read(kit))).read('word/document.xml').decode())
    pg.goto(BASE + '#generate'); pg.reload(); pg.wait_for_selector('.pool-entry'); pg.wait_for_selector('.preview-page')
    check('独立生成页也使用同一左右编辑体验', pg.locator('.pool-layout .pool').count() == 1 and zh in pg.locator('.previews').inner_text())
    after = pg.evaluate(DUMP)
    check('资料、来源编号、API设置、投递记录保持原样', all(after[k] == before[k] for k in ['profile', 'settings', 'applications', 'postings']))
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    check('移动端编辑页面无横向溢出', pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
    pg.goto(BASE + '#profile'); pg.reload(); pg.wait_for_selector('[data-testid=nav-profile]')
    check('证明材料录入入口已移除，一键清空保留', pg.locator('.tabs button').filter(has_text='证据').count() == 0 and pg.get_by_role('button', name='🔴 清空所有个人资料', exact=True).count() == 1)
    check('全程无外部请求、页面错误或Key显示', not outside and not errors and F['settings']['apiKey'] not in pg.locator('body').inner_text())
    c.close()
print(f'{sum(checks)}/{len(checks)} passed')
