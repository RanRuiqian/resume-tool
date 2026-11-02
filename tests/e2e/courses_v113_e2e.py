"""v1.13 P0/P1 browser acceptance. Synthetic fixtures, temp browser DB, NO external network/API."""
import copy, json, os, shutil, tempfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
BASE=os.environ.get('E2E_BASE','http://localhost:4173/')
OUT=Path(os.environ.get('V113_OUT','/workspace/scratch/v113-validation/samples'))
SHOTS=Path(os.environ.get('SHOT_DIR','/workspace/scratch/v113-validation/screenshots')); SHOTS.mkdir(parents=True,exist_ok=True)
PROFILE=json.loads((OUT/'fictional-profile.json').read_text()); JOB=json.loads((OUT/'fictional-job.json').read_text()); RESUME=json.loads((OUT/'hidden-resume.json').read_text())
KEY='fake-browser-only-v113'; checks=[]
def check(label,condition):
 checks.append(bool(condition)); print(('PASS ' if condition else 'FAIL ')+label,flush=True); assert condition,label
DUMP="""()=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,o={};const t=d.transaction(['profile','resumes','backups','jobs']);for(const k of ['profile','resumes','backups','jobs']){const r=t.objectStore(k).getAll();r.onsuccess=()=>o[k]=r.result}t.oncomplete=()=>{d.close();resolve(o)}}})"""
SEED="""([p,j,r,key])=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction(['profile','settings','jobs','resumes','state'],'readwrite');t.objectStore('profile').put({id:'me',doc:p});t.objectStore('jobs').put(j);t.objectStore('resumes').put(r);t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:key,model:'deepseek-flash',provider:'deepseek',uiLang:'zh',setupDone:true});for(const [id,value] of [['jobId',j.id],['resumeId',r.id],['templateId',r.templateId]])t.objectStore('state').put({id,value});t.oncomplete=()=>{d.close();resolve()}}})"""
with tempfile.TemporaryDirectory(prefix='course-v113-isolated-') as folder, sync_playwright() as p:
 c=p.chromium.launch_persistent_context(folder,executable_path=os.environ.get('CHROME_BIN') or shutil.which('chromium'),args=['--no-sandbox'],service_workers='block',viewport={'width':1440,'height':1000})
 pg=c.pages[0]; errors=[]; external=[]; pg.on('pageerror',lambda e:errors.append(str(e))); pg.on('dialog',lambda d:d.accept())
 def route(r):
  if urlsplit(r.request.url).hostname in ['localhost','127.0.0.1','::1']: r.continue_()
  else: external.append(urlsplit(r.request.url).hostname);r.abort()
 c.route('**/*',route)
 pg.goto(BASE);pg.wait_for_timeout(500);pg.evaluate(SEED,[PROFILE,JOB,RESUME,KEY]);pg.goto(BASE+'#profile');pg.reload();pg.wait_for_selector('[data-testid=fixed-summary-editor]')
 pg.get_by_role('button',name='课程（84）',exact=True).click(); panel=pg.locator('[data-testid=courses-panel]');pg.wait_for_selector('[data-testid=course-row]')
 check('独立课程：76 本科、6 硕士、2 项目学分',panel.locator('[data-testid=course-group-bachelor] [data-testid=course-row]').count()==76 and panel.locator('[data-testid=course-group-master] [data-testid=course-row]').count()==8 and '6 门授课课程' in panel.locator('[data-testid=course-group-master]').inner_text())
 check('84 门课程的详细概述默认全部折叠',panel.locator('[data-testid=course-row][open]').count()==0)
 pg.evaluate("window.scrollTo(0, document.querySelector('[data-testid=courses-panel]').getBoundingClientRect().top + window.scrollY - 80)");pg.screenshot(path=str(SHOTS/'courses-library.png'));panel.locator('[data-testid=course-group-bachelor] > summary').click();pg.screenshot(path=str(SHOTS/'masters-course-library.png'));panel.locator('[data-testid=course-group-bachelor] > summary').click()
 panel.get_by_placeholder('例如 Supply Chain 或 热管理').fill('Supply Chain');check('可按别名检索课程',panel.locator('[data-testid=course-row]').count()==1)
 panel.get_by_placeholder('例如 Supply Chain 或 热管理').fill('生产流程');check('可按知识域检索',panel.locator('[data-testid=course-row]').count()==1)
 row=panel.locator('[data-testid=course-row]').first;row.locator('summary').click();row.get_by_placeholder('中文',exact=True).nth(1).fill('人工修订的课程知识概述，仅描述基础学习，不证明职业实操。');pg.wait_for_timeout(500)
 check('单条编辑退回待确认且保留成绩',pg.evaluate(DUMP)['profile'][0]['doc']['courses'][0]['confirmation']=='pending' and pg.evaluate(DUMP)['profile'][0]['doc']['courses'][0]['grade']['raw']=='MOCK-UG-GRADE-1')
 row.get_by_role('button',name='我已核对课程记录',exact=True).click();pg.wait_for_timeout(500)
 original=copy.deepcopy(pg.evaluate(DUMP)['profile'][0]['doc']);incoming=copy.deepcopy(original['courses'][0]);incoming['synopsis']['zh']='不应覆盖人工修订';incoming['grade']['raw']='MOCK-CONFLICT'
 imp=panel.locator('[data-testid=course-import]');imp.locator('summary').first.click();imp.get_by_role('textbox',name='课程草稿文本').fill(json.dumps({'courses':[incoming]},ensure_ascii=False));imp.get_by_role('button',name='预览差异',exact=True).click()
 preview=pg.locator('[data-testid=course-import-preview]')
 check('导入有字段差异且默认跳过，未自动写库','synopsis' in preview.inner_text() and preview.get_by_role('button',name='确认所选合并（先备份）').is_disabled() and pg.evaluate(DUMP)['profile'][0]['doc']==original)
 preview.locator('select').select_option('fill');preview.get_by_role('button',name='确认所选合并（先备份）').click();pg.wait_for_timeout(600)
 data=pg.evaluate(DUMP);check('补缺不会覆盖人工概述和成绩且先有备份',data['profile'][0]['doc']['courses'][0]['synopsis']==original['courses'][0]['synopsis'] and data['profile'][0]['doc']['courses'][0]['grade']==original['courses'][0]['grade'] and len(data['backups'])>=1)
 row=panel.locator('[data-testid=course-row]').first;row.get_by_role('button',name='删除课程',exact=True).click();pg.wait_for_timeout(500)
 check('删除前确认与快照、其他项目不变',len(pg.evaluate(DUMP)['profile'][0]['doc']['courses'])==83 and pg.evaluate(DUMP)['profile'][0]['doc']['projects']==PROFILE['projects'])
 panel.get_by_role('button',name='撤销最近一次删除').click();pg.wait_for_timeout(500);check('删除可撤销，课程和原始成绩恢复',len(pg.evaluate(DUMP)['profile'][0]['doc']['courses'])==84 and pg.evaluate(DUMP)['profile'][0]['doc']['courses'][0]['grade']['raw']=='MOCK-UG-GRADE-1')
 pg.evaluate("localStorage.setItem('wizardStep','3')");pg.goto(BASE+'#wizard');pg.reload();pg.wait_for_selector('[data-testid=resume-facts-options]');pg.wait_for_selector('.preview-page')
 check('默认预览固定简介、专业保留且成绩/工具库链接隐藏','测试用户三十具有轮机工程本科背景' in pg.locator('.previews').inner_text() and 'MOCK-UG-GRADE' not in pg.locator('.previews').inner_text() and 'example.com/resume-tool' not in pg.locator('.previews').inner_text())
 options=pg.locator('[data-testid=resume-facts-options]');options.locator('summary').click();choice=options.locator('[data-testid=resume-course-choice]').first
 choice.get_by_role('checkbox',name='显示该课成绩原文',exact=True).check();pg.wait_for_timeout(300)
 check('明确开启只显示一个原始成绩','MOCK-UG-GRADE-1' in pg.locator('.previews').inner_text() and 'MOCK-UG-GRADE-2' not in pg.locator('.previews').inner_text())
 choice.get_by_role('checkbox',name='显示该课成绩原文',exact=True).uncheck();pg.wait_for_timeout(300);pg.screenshot(path=str(SHOTS/'resume-chinese.png'))
 pg.get_by_role('button',name='English',exact=True).click();pg.wait_for_timeout(400)
 check('英文预览保留 Marine Engineering，无伪造 IELTS/流利英语','Marine Engineering' in pg.locator('.previews').inner_text() and 'IELTS' not in pg.locator('.previews').inner_text() and 'MOCK-UG-GRADE' not in pg.locator('.previews').inner_text())
 pg.screenshot(path=str(SHOTS/'resume-english.png'))
 options.get_by_role('button',name='特殊岗位微调（人工候选，确认后应用）').click();draft=pg.locator('[data-testid=summary-variant-draft]');draft.locator('textarea').nth(0).fill(PROFILE['profile']['summary']['zh']+' ');draft.get_by_role('button',name='确认仅应用到本份简历').click();pg.wait_for_timeout(400)
 current=pg.evaluate(DUMP);saved=next(r for r in current['resumes'] if r['id']==RESUME['id'])
 check('变体仅保存到本份简历，母库固定原文不变',saved['items'][0]['zh'].endswith(' ') and current['profile'][0]['doc']['profile']['summary']==PROFILE['profile']['summary'])
 options.get_by_role('button',name='恢复本份简历的固定简介').click();pg.wait_for_timeout(300);check('可恢复固定简介',pg.evaluate(DUMP)['resumes'][0]['items'][0]['zh']==PROFILE['profile']['summary']['zh'])
 pg.locator('.insights').scroll_into_view_if_needed();check('匹配只标内部辅助，缺词不鼓励伪造','内部辅助分析' in pg.locator('.insights').inner_text() and '尚未证实' in pg.locator('.insights').inner_text());pg.screenshot(path=str(SHOTS/'internal-evidence-analysis.png'))
 # New parsed JD ID must not trigger generation or erase manual resume choices.
 newer=copy.deepcopy(JOB);newer['id']='v113-new-jd-revision';pg.evaluate("j=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction(['jobs','state'],'readwrite');t.objectStore('jobs').put(j);t.objectStore('state').put({id:'jobId',value:j.id});t.oncomplete=()=>{d.close();r()}}})",newer);before=copy.deepcopy(pg.evaluate(DUMP)['resumes']);pg.reload();pg.wait_for_selector('[data-testid=previous-resume-retained]');pg.wait_for_timeout(500)
 check('JD 新版本保留编辑、历史解析和简历，不自动调用模型',pg.evaluate(DUMP)['resumes']==before and len(pg.evaluate(DUMP)['jobs'])==2 and pg.get_by_role('button',name='满意了，去下载 →').is_disabled())
 check('全程无外部请求、无页面错误、Key 不入界面',not external and not errors and KEY not in pg.locator('body').inner_text())
 c.close()
print(f'{sum(checks)}/{len(checks)} passed')
