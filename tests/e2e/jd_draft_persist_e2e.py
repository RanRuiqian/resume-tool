"""2026-11 第三轮：岗位页切到「设置」/「版式设置」再回来，岗位文字、截图与进行中的 AI 分析不丢。全部虚构数据，AI 请求被拦截并延迟返回模拟结果。"""
import json, os, tempfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_BASE', 'http://localhost:4173/')
F = json.loads(Path(os.environ.get('WORKSPACE_FIXTURE', '/tmp/resume-workspace-fictional.json')).read_text())
SEED = """f=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction(['profile','settings','jobs','state'],'readwrite');t.objectStore('profile').put({id:'me',doc:f.profile});t.objectStore('settings').put(f.settings);t.objectStore('jobs').put(f.job);t.objectStore('state').put({id:'jobId',value:f.job.id});t.oncomplete=()=>{d.close();resolve()}}})"""
checks, errors, calls = [], [], []
def check(label, condition):
    checks.append(bool(condition)); print(('PASS ' if condition else 'FAIL ') + label, flush=True); assert condition, label

PARSE = {'jdLanguage': 'zh', 'company': {'full': '虚构草稿测试有限公司', 'short': '虚构草稿'}, 'roleAbbr': 'DRAFT', 'title': {'zh': '虚构草稿岗位', 'en': 'Mock Draft Role'},
         'responsibilities': [{'zh': '虚构职责', 'en': 'Mock duty'}], 'mustHave': [{'zh': '虚构要求', 'en': 'Mock requirement'}], 'niceToHave': [], 'yearsRequired': None,
         'keywords': [{'zh': '结构设计', 'en': 'Structural design'}], 'summary': '虚构'}

def network(route):
    host = urlsplit(route.request.url).hostname
    if host in {'localhost', '127.0.0.1'}: return route.continue_()
    if '/chat/completions' in route.request.url:
        calls.append(route)  # 慢速 AI：先挂起，切换页面后再返回
        return
    route.abort()

with tempfile.TemporaryDirectory(prefix='jd-draft-') as folder, sync_playwright() as p:
    c = p.chromium.launch_persistent_context(folder, executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'], viewport={'width': 1300, 'height': 1000}, service_workers='block')
    c.route('**/*', network)
    pg = c.pages[0]; pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(BASE); pg.wait_for_timeout(500)
    pg.evaluate(SEED, F); pg.evaluate("localStorage.setItem('wizardStep','2')"); pg.goto(BASE + '#wizard'); pg.reload()
    box = pg.locator('[data-testid=jd-text]'); box.wait_for()
    draft = '虚构草稿岗位\n虚构草稿测试有限公司\n岗位职责：负责虚构结构设计 DRAFT-MARK'
    box.fill(draft)
    pg.locator('[data-testid=nav-settings]').click(); pg.wait_for_timeout(300)
    pg.locator('[data-testid=nav-layout]').click(); pg.wait_for_timeout(300)
    pg.locator('button.main-nav').click(); box = pg.locator('[data-testid=jd-text]'); box.wait_for()
    check('切到设置、版式设置再回来，岗位文字保留', 'DRAFT-MARK' in box.input_value())
    pg.reload(); box = pg.locator('[data-testid=jd-text]'); box.wait_for()
    check('刷新页面后岗位文字仍保留', 'DRAFT-MARK' in box.input_value())
    pg.locator('[data-testid=analyze]').click(); pg.wait_for_timeout(400)
    pg.locator('[data-testid=nav-settings]').click(); pg.wait_for_timeout(400)
    pg.locator('button.main-nav').click(); pg.locator('[data-testid=jd-text]').wait_for()
    check('分析进行中离开再回来，仍显示进度', pg.locator('.step').inner_text().find('AI 正在读懂这个岗位') >= 0)
    body = {'choices': [{'message': {'content': json.dumps(PARSE, ensure_ascii=False)}, 'finish_reason': 'stop'}], 'model': 'mock', 'usage': {}}
    for r in calls: r.fulfill(status=200, content_type='application/json', body=json.dumps(body, ensure_ascii=False))
    pg.wait_for_selector('text=虚构草稿岗位', timeout=15000)
    check('分析在后台完成，回来后看到结果', '虚构草稿岗位' in pg.locator('[data-testid=single-jd-analysis]').inner_text())
    check('只调用了一次 AI', len(calls) == 1)
    check('无页面错误', not errors)
    c.close()
print(f'{sum(checks)}/{len(checks)} passed')
