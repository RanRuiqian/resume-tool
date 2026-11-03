"""Opt-in private-file UI regression. Temporary browser only; no screenshots/traces/source dumps, all external requests blocked.
PRIVATE_LIBRARY=/local/path/library.txt python3 tests/e2e/private_fact_import_e2e.py
"""
import os,shutil,tempfile,re,json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
BASE=os.environ.get('E2E_BASE','http://localhost:4173/')
TEXT=Path(os.environ['PRIVATE_LIBRARY']).read_text();checks=[]
def check(label,ok):
 if not ok:raise AssertionError('Private UI verification failed: '+label)
 checks.append(label);print('PASS '+label,flush=True)
DUMP="""()=>new Promise((resolve,reject)=>{const q=indexedDB.open('resume-tool');q.onerror=()=>reject(new Error('Test DB error'));q.onsuccess=()=>{const d=q.result,o={},t=d.transaction(['profile','settings','applications','postings']);for(const n of t.objectStoreNames){const q=t.objectStore(n).getAll();q.onsuccess=()=>o[n]=q.result}t.oncomplete=()=>{d.close();resolve(o)}}})"""
SEED="""()=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction(['settings','applications','postings'],'readwrite');t.objectStore('settings').put({id:'settings',demoMode:false,provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:'FAKE-PRIVATE-BROWSER-ONLY',model:'mock-flash',translateModel:'mock-translate',visionModel:'',uiLang:'zh',ocrMode:'local',setupDone:true});t.objectStore('postings').put({id:'mock-posting',company:'模拟企业',title:'测试岗位',source:{kind:'manual'},createdAt:'2026-01-01',updatedAt:'2026-01-01'});t.objectStore('applications').put({id:'mock-application',postingId:'mock-posting',status:'pending',todos:[],interviews:[],source:{kind:'manual'},createdAt:'2026-01-01',updatedAt:'2026-01-01'});t.oncomplete=()=>{d.close();resolve()}}})"""
with tempfile.TemporaryDirectory(prefix='private-v7-ui-') as folder,sync_playwright() as p:
 c=p.chromium.launch_persistent_context(folder,executable_path=shutil.which('chromium'),args=['--no-sandbox'],service_workers='block',viewport={'width':1440,'height':1000})
 unexpected=[];errors=[]
 def block(route):
  if urlsplit(route.request.url).hostname in ['localhost','127.0.0.1','::1']:route.continue_()
  else:unexpected.append('blocked');route.abort()
 c.route('**/*',block);pg=c.pages[0];pg.on('pageerror',lambda e:errors.append('page error'))
 pg.goto(BASE);pg.wait_for_timeout(600);pg.evaluate(SEED);pg.goto(BASE+'#profile');pg.reload();pg.wait_for_selector('[data-testid=smart-file]',state='attached');before=pg.evaluate(DUMP)
 def upload(text):
  pg.set_input_files('[data-testid=smart-file]',{'name':'private-library.txt','mimeType':'text/plain','buffer':text.encode()});pg.wait_for_selector('[data-testid=file-text]');pg.click('[data-testid=smart-run]');pg.wait_for_selector('[data-testid=import-integrity]')
 upload(TEXT);coverage=pg.locator('[data-testid=import-integrity]').inner_text()
 check('原件预览本科76/76、硕士6/6、核心项目2/2、全部编号事实299/299',all(x in coverage for x in ['本科课程：原文 76 / 已识别 76 / 遗漏 0','硕士课程：原文 6 / 已识别 6 / 遗漏 0','核心项目：原文 2 / 已识别 2 / 遗漏 0','全部编号事实：原文 299 / 已识别 299 / 遗漏 0']))
 check('预览299条事实均可逐条追溯，尚未写库',pg.locator('[data-testid=source-fact]').count()==299 and pg.evaluate(DUMP)['profile']==before['profile'])
 check('首次导入166实体，无内部重复、冲突或待决定项',pg.locator('[data-testid=imp-item]').count()==166 and pg.locator('[data-testid=imp-item]:not([data-status=new])').count()==0 and pg.locator('[data-testid=import-confirm]').is_enabled())
 check('原文未知及遮挡不生成强制待核对或上传任务',not pg.locator('[data-testid=lv-missing]').count() and not pg.locator('[data-testid=lv-critical]').count())
 pg.click('[data-testid=import-confirm]');pg.wait_for_selector('[data-testid=import-done]');pg.wait_for_timeout(200);doc=pg.evaluate(DUMP)['profile'][0]['doc']
 check('实际保存全部299个编号事实及未截断原文',len(doc['sourceFacts'])==299 and TEXT.strip() in doc['sourceTexts'][0]['text'] and all(f['entityIds'] for f in doc['sourceFacts']))
 check('实际保存82课程、2教育、2核心项目和独立组织经历',len(doc['courses'])==82 and len(doc['education'])==2 and sum(p['kind']=='core' for p in doc['projects'])==2 and sum(w['kind']=='club' for w in doc['work'])==3 and sum(w['kind']=='volunteer' for w in doc['work'])==1)
 check('2遮挡和3未公布成绩保留，默认不公开',sum(c['grade']['status']=='unverified' for c in doc['courses'])==2 and sum(c['grade']['status']=='not-released' for c in doc['courses'])==3 and all(not c['defaultGradeVisible'] for c in doc['courses']))
 pg.reload();pg.wait_for_selector('[data-testid=smart-file]',state='attached');loaded=pg.evaluate(DUMP)
 check('刷新后全部个人事实、课程、关联逐字段不变',loaded['profile'][0]['doc']==doc)
 check('API配置、模型、岗位和投递逐字段不变',all(loaded[k]==before[k] for k in ['settings','postings','applications']))
 upload(TEXT);check('相同原件重导入全部166实体自动识别为已有，无待处理',pg.locator('[data-testid=imp-item][data-status=duplicate]').count()==166 and pg.locator('[data-testid=import-confirm]').is_enabled() and not pg.locator('[data-testid=lv-critical]').count())
 pg.click('[data-testid=import-confirm]');pg.wait_for_selector('[data-testid=import-done]');again=pg.evaluate(DUMP)['profile'][0]['doc'];check('重导入不增加记录、快照原文或改变关联',again==doc)
 pg.reload();pg.wait_for_selector('[data-testid=smart-file]',state='attached');upload(re.sub(r'^\[x\] BSC-028.*\n','',TEXT,flags=re.M));bad=pg.locator('[data-testid=import-integrity]').inner_text()
 check('注入真实课程遗漏会列出BSC-028并阻止写入','BSC-028' in bad and pg.locator('[data-testid=import-confirm]').is_disabled() and pg.evaluate(DUMP)['profile'][0]['doc']==doc)
 check('全程零真实API请求、无页面错误，保留清空按钮',not unexpected and not errors and pg.locator('[data-testid=clear-personal-data]').count()==1)
 check('原文件只读且未改变',Path(os.environ['PRIVATE_LIBRARY']).read_text()==TEXT)
 c.close()
print(json.dumps({'passed':len(checks),'sourceFacts':299,'bachelor':76,'master':6,'coreProjects':2,'internalDuplicates':0,'compulsoryMissing':0,'externalApiCalls':0}))
