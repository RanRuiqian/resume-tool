"""2026-11 记录投递：截图识别（AI 看图用拦截的假接口 / 本机识别）→ 自动填表 → 匹配简历 → 存工具 PDF → 上传自己的 PDF 替换。全部为虚构数据。
用法：python3 tests/e2e/quick_record_e2e.py [vision|local]（默认两种都跑）"""
import json, os, tempfile, copy, sys, re
from pathlib import Path
import fitz
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[2]
F = json.loads(Path(os.environ.get('WORKSPACE_FIXTURE', '/tmp/resume-workspace-fictional.json')).read_text())
_src = (ROOT / 'tests/e2e/resume_workspace_e2e.py').read_text()
SEED = re.search(r'SEED = """(.*?)"""', _src, re.S).group(1)
B = os.environ.get('E2E_BASE', 'http://localhost:4173/')
TMP = Path(tempfile.mkdtemp(prefix='qr-e2e-'))
def _shot(path, lines):
    f = ImageFont.truetype(str(ROOT / 'public/fonts/NotoSansSC-Regular.otf'), 30); b = ImageFont.truetype(str(ROOT / 'public/fonts/NotoSansSC-Bold.otf'), 38)
    im = Image.new('RGB', (900, 520), 'white'); d = ImageDraw.Draw(im); y = 30
    for i, l in enumerate(lines): d.text((40, y), l, fill='black', font=b if i == 0 else f); y += 62 if i == 0 else 52
    im.save(path)
_shot(TMP / 'apply1.png', ['投递成功', '虚构新能源科技有限公司 2027届校园招聘', '申请职位：机械结构设计工程师', '工作地点：苏州', '投递时间：2026-11-05 15:32', '申请截止日期：2026-12-31'])
_shot(TMP / 'apply2.png', ['申请已提交', '模拟汽车股份有限公司', '申请职位：底盘设计工程师', '工作地点：柳州', '提交时间：2026-11-04 10:05'])
checks=[]
def chk(name, ok, extra=''):
    checks.append(ok); print(('PASS ' if ok else 'FAIL ')+name+(f'  [{extra}]' if extra and not ok else ''))
VISION={'apply1.png':{'company':'虚构新能源科技有限公司','title':'机械结构设计工程师','city':'苏州','appliedAt':'2026-11-05 15:32','sourcePlatform':'官网','recruitType':'campus','programYear':'2027 届','statusText':'投递成功'},
        'apply2.png':{'company':'模拟汽车股份有限公司','title':'底盘设计工程师','city':'柳州','appliedAt':'2026-11-04 10:05','sourcePlatform':'','recruitType':'','statusText':'申请已提交'}}
calls=[]
def run(mode):
    F2=copy.deepcopy(F)
    if mode=='vision':
        now='2026-11-05T00:00:00.000Z'
        F2['settings'].update({'apiProfiles':[
            {'id':'api-ds','name':'DeepSeek（写简历）','provider':'deepseek','baseUrl':'https://api.deepseek.com','apiKey':'FAKE-DS','model':'deepseek-flash','translateModel':'','visionModel':'','createdAt':now,'updatedAt':now},
            {'id':'api-qw','name':'通义千问（看图）','provider':'qwen','baseUrl':'https://dashscope.aliyuncs.com/compatible-mode/v1','apiKey':'FAKE-QW','model':'qwen-plus','translateModel':'','visionModel':'qwen-vl-plus','createdAt':now,'updatedAt':now}],
            'activeProfileId':'api-ds'})
    with tempfile.TemporaryDirectory() as d, sync_playwright() as p:
        c=p.chromium.launch_persistent_context(d, executable_path=os.environ['CHROMIUM_PATH'], args=['--no-sandbox'], viewport={'width':1440,'height':1100}, accept_downloads=True)
        order=[]
        def net(route):
            u=route.request.url
            if u.startswith(B): return route.continue_()
            if u.endswith('/chat/completions'):
                body=route.request.post_data or ''; calls.append((u, 'image_url' in body))
                if 'image_url' in body:
                    name='apply1.png' if len([x for x in calls if x[1]])%2==1 else 'apply2.png'
                    content=json.dumps(VISION[name],ensure_ascii=False)
                else:
                    content=json.dumps({'company':'','title':'','city':'','appliedAt':'','sourcePlatform':'官网'},ensure_ascii=False)
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':content},'finish_reason':'stop'}],'usage':{}}))
            order.append(u); return route.abort()
        c.route('**/*', net)
        pg=c.pages[0]; errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda dl: dl.accept())
        pg.goto(B); pg.wait_for_timeout(500); pg.evaluate(SEED, F2)
        pg.goto(B+'#applications/record'); pg.reload(); pg.wait_for_selector('[data-testid=quick-record]')
        if mode=='vision':
            chk('默认用带看图模型的配置识别', pg.locator('[data-testid=qr-ocr]').input_value()=='api-qw', pg.locator('[data-testid=qr-ocr]').input_value())
            pg.locator('[data-testid=qr-input]').set_input_files([str(TMP/'apply1.png'),str(TMP/'apply2.png')])
        else:
            chk('没有看图配置时用本机识别', pg.locator('[data-testid=qr-ocr]').input_value()=='local')
            pg.locator('[data-testid=qr-input]').set_input_files([str(TMP/'apply1.png')])
        n=2 if mode=='vision' else 1
        pg.wait_for_function(f"document.querySelectorAll('[data-testid=qr-via]').length>={n}", timeout=180000)
        drafts=pg.locator('[data-testid=qr-draft]')
        chk(f'{mode}: 生成 {n} 条草稿', drafts.count()==n, drafts.count())
        d1=drafts.nth(0)
        vals={k:d1.locator(f'[data-testid=qr-{k}]').input_value() for k in ['company','title','city','at','platform']}
        print('  draft1:', vals, '|', d1.locator('[data-testid=qr-via]').inner_text())
        chk(f'{mode}: 公司岗位识别正确', '虚构新能源' in vals['company'] and '机械结构设计工程师' in vals['title'], vals)
        chk(f'{mode}: 投递时间来自截图（不是截止日期）', vals['at']=='2026-11-05T15:32', vals['at'])
        chk(f'{mode}: 自动匹配到生成过的简历', d1.locator('[data-testid=qr-resume]').input_value()==F['resume']['id'])
        chk(f'{mode}: 默认存中文 PDF', d1.locator('[data-testid=qr-pdf-zh]').is_checked() and not d1.locator('[data-testid=qr-pdf-en]').is_checked())
        if mode=='vision':
            d2=drafts.nth(1)
            chk('vision: 第二张截图另成一条、未匹配简历', '模拟汽车' in d2.locator('[data-testid=qr-company]').input_value() and d2.locator('[data-testid=qr-resume]').input_value()=='')
            pg.screenshot(path=str(TMP/'drafts.png'), full_page=True)
            pg.locator('[data-testid=qr-save-all]').click()
        else:
            d1.locator('[data-testid=qr-save]').click()
        pg.wait_for_function(f"document.querySelectorAll('[data-testid=qr-saved]').length>={n}", timeout=180000)
        chk(f'{mode}: 全部保存成功', pg.locator('[data-testid=qr-saved]').count()==n)
        warns=pg.locator('.qr-draft .notice.warn').all_inner_texts(); chk(f'{mode}: 保存无警告', not warns, warns)
        pg.locator('[data-testid=qr-open]').first.click(); pg.wait_for_selector('[data-testid=posting-detail]')
        chk(f'{mode}: 状态为已投递', '已投递' in pg.locator('[data-testid=current-status]').inner_text())
        pdfs=pg.locator('[data-testid=resume-pdf]')
        chk(f'{mode}: 存放了 1 份工具生成 PDF 且为实际提交版本', pdfs.count()==1 and '工具生成' in pdfs.first.inner_text() and pdfs.first.locator('[data-testid=pdf-submitted]').count()==1, pdfs.all_inner_texts())
        chk(f'{mode}: 投递成功截图已存为附件', '投递成功截图' in pg.locator('[data-testid=attachments-card]').inner_text())
        chk(f'{mode}: 关联了简历快照', pg.locator('[data-testid=artifact]').count()==1)
        if mode=='vision':
            # 下载工具 PDF 检查是真 PDF
            with pg.expect_download() as dl: pdfs.first.locator('button', has_text='下载').click()
            doc=fitz.open(dl.value.path()); chk('工具 PDF 可打开、1 页以上、含姓名', len(doc)>=1 and '测试' in doc[0].get_text(), doc[0].get_text()[:40])
            # 上传自己修改的 PDF（替换）
            mine=fitz.open(); pgx=mine.new_page(); pgx.insert_text((72,72),'my edited resume'); mine.save(str(TMP/'mine.pdf'))
            pg.locator('[data-testid=submitted-input]').set_input_files(str(TMP/'mine.pdf')); pg.wait_for_timeout(800)
            t=pg.locator('[data-testid=resume-pdfs]').inner_text()
            chk('上传后只剩「我修改的版本」且为实际提交', pg.locator('[data-testid=resume-pdf]').count()==1 and '我修改的版本' in t and '实际提交版本' in t, t)
            pg.locator('[data-testid=pdf-delete]').click(); pg.wait_for_timeout(600)
            chk('删除后显示可重新生成', pg.locator('[data-testid=no-pdf]').count()==1 and pg.locator('[data-testid=regen-pdf]').count()==1)
            pg.locator('[data-testid=regen-pdf]').click(); pg.wait_for_selector('[data-testid=resume-pdf]', timeout=120000)
            chk('重新生成工具版 PDF', '工具生成' in pg.locator('[data-testid=resume-pdfs]').inner_text())
            pg.screenshot(path=str(TMP/'detail.png'), full_page=True)
            pg.goto(B+'#applications'); pg.reload(); pg.wait_for_selector('[data-testid=posting-list]')
            rows=pg.locator('[data-testid=posting-row]').all_inner_texts()
            chk('列表里两个新岗位都是已投递', sum('已投递' in r for r in rows)==2, rows)
            chk('看图调用走的是千问配置', any('dashscope' in u and img for u,img in calls), calls)
        chk(f'{mode}: 无外部请求、无页面错误', not order and not errs, (order, errs))
        c.close()
for mode in (sys.argv[1:] or ['vision', 'local']): run(mode)
print(f'RESULT {sum(checks)}/{len(checks)}')
