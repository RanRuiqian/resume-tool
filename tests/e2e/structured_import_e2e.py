"""Numbered import in an isolated Chromium profile, using ONLY fictional text; all external requests blocked.
Run: MOCK_LIBRARY=/path/to/fictional-numbered-library.txt python3 tests/e2e/structured_import_e2e.py
"""
import json,os,shutil,tempfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
BASE=os.environ.get('E2E_BASE','http://localhost:4173/')
TEXT=Path(os.environ['MOCK_LIBRARY']).read_text()
assert '测试用户甲' in TEXT and '非用户 V7' in TEXT, 'Must use the fictional regression fixture'
checks=[]
def check(label,ok):
 checks.append(bool(ok));print(('PASS ' if ok else 'FAIL ')+label,flush=True);assert ok,label
DUMP="""()=>new Promise((resolve,reject)=>{const q=indexedDB.open('resume-tool');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const d=q.result,o={},t=d.transaction(['profile','settings','applications','postings','backups']);for(const n of t.objectStoreNames){const a=t.objectStore(n).getAll();a.onsuccess=()=>o[n]=a.result}t.oncomplete=()=>{d.close();resolve(o)}}})"""
SEED="""()=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction(['settings','postings','applications'],'readwrite');t.objectStore('settings').put({id:'settings',demoMode:false,provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:'FAKE-STRUCTURED-ONLY',model:'mock-flash',translateModel:'mock-translation',visionModel:'',uiLang:'zh',ocrMode:'local',setupDone:true});t.objectStore('postings').put({id:'mock-posting',company:'模拟企业',title:'模拟岗位',city:'',priority:1,source:{kind:'manual'},createdAt:'2026-01-01',updatedAt:'2026-01-01'});t.objectStore('applications').put({id:'mock-application',postingId:'mock-posting',status:'pending',todos:[],interviews:[],source:{kind:'manual'},createdAt:'2026-01-01',updatedAt:'2026-01-01'});t.oncomplete=()=>{d.close();resolve()}}})"""
with tempfile.TemporaryDirectory(prefix='mock-numbered-import-') as folder,sync_playwright() as p:
 c=p.chromium.launch_persistent_context(folder,executable_path=shutil.which('chromium'),args=['--no-sandbox'],service_workers='block',viewport={'width':1440,'height':1000})
 unexpected=[];errors=[]
 def block(route):
  if urlsplit(route.request.url).hostname in ['localhost','127.0.0.1','::1']:route.continue_()
  else:unexpected.append(urlsplit(route.request.url).hostname);route.abort()
 c.route('**/*',block)
 pg=c.pages[0];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(BASE);pg.wait_for_timeout(700);pg.evaluate(SEED);pg.goto(BASE+'#profile');pg.reload();pg.wait_for_selector('[data-testid=smart-file]',state='attached')
 before=pg.evaluate(DUMP)
 def upload(text):
  pg.set_input_files('[data-testid=smart-file]',{'name':'mock-numbered-library.txt','mimeType':'text/plain','buffer':text.encode()});pg.wait_for_selector('[data-testid=file-text]');pg.click('[data-testid=smart-run]');pg.wait_for_selector('[data-testid=import-integrity]')
 upload(TEXT)
 integrity=pg.locator('[data-testid=import-integrity]').inner_text()
 check('预览显示76/76本科、6/6硕士、2/2核心项目，遗漏0','本科课程：原文 76 / 已识别 76 / 遗漏 0' in integrity and '硕士课程：原文 6 / 已识别 6 / 遗漏 0' in integrity and '核心项目：原文 2 / 已识别 2 / 遗漏 0' in integrity)
 check('预览尚未落盘、无需API调用、没有无意义缺失或证据任务',pg.evaluate(DUMP)['profile']==before['profile'] and not unexpected and pg.locator('[data-testid=lv-missing]').count()==0 and pg.locator('[data-testid=lv-critical]').count()==0)
 check('独立实验、作业、工具无内部重复或强制人工决策',pg.locator('[data-testid=imp-item][data-status=internal]').count()==0 and pg.locator('[data-testid=imp-action]').count()>82 and pg.locator('[data-testid=import-confirm]').is_enabled())
 # Source tracing in the expanded record.
 pg.locator('[data-testid=imp-group-courses] > summary').click();first=pg.locator('[data-testid=imp-item][data-section=courses]').first;first.locator('.imp-head').click();check('可按来源编号查看逐条原文','MSC-01' in first.locator('[data-testid=imp-detail]').inner_text())
 pg.click('[data-testid=import-confirm]');pg.wait_for_selector('[data-testid=import-done]');pg.wait_for_timeout(300)
 doc=pg.evaluate(DUMP)['profile'][0]['doc'];ids={k:[e['id'] for e in doc.get(k,[])] for k in ['education','work','projects','skills','courses','certificates','awards']}
 check('课程82条，硕士教育1条，核心项目2项且关联正确',len(doc['courses'])==82 and len(doc['education'])==2 and len([x for x in doc['projects'] if x['kind']=='core'])==2 and all(x['educationId'] in ids['education'] for x in doc['courses']))
 check('实物/仿真和不同作业分别保留，工具未按子串合并',len([x for x in doc['projects'] if x['sourceRecord']['id'].startswith('LRN-')])==4 and len(doc['skills'])==4)
 check('未公布/遮挡成绩原样保留，未编造未知毕业日期',next(x for x in doc['courses'] if x['sourceRecord']['id']=='BSC-011')['grade']['raw']=='成绩遮挡 **' and next(x for x in doc['courses'] if x['sourceRecord']['id']=='MSC-06')['grade']['raw']=='尚未公布' and not doc['education'][1].get('actualConferralDate'))
 pg.reload();pg.wait_for_selector('[data-testid=smart-file]',state='attached');after=pg.evaluate(DUMP)
 check('刷新后事实、课程、来源编号和关联完整保留',after['profile'][0]['doc']==doc)
 check('API Key、模型、语言、投递与岗位记录原样保留',all(after[k]==before[k] for k in ['settings','applications','postings']))
 upload(TEXT);check('重复导入所有条目可自动合并，没有待定或内部重复',pg.locator('[data-testid=import-confirm]').is_enabled() and pg.locator('[data-testid=imp-item]:not([data-status=duplicate])').count()==0)
 pg.click('[data-testid=import-confirm]');pg.wait_for_selector('[data-testid=import-done]');again=pg.evaluate(DUMP)['profile'][0]['doc']
 check('重复导入不增加实体、原文副本或破坏技能关联',all([e['id'] for e in again[k]]==v for k,v in ids.items()) and len(again['sourceTexts'])==1 and again['skills'][0]['usedIn']==doc['skills'][0]['usedIn'])
 pg.reload();pg.wait_for_selector('[data-testid=smart-file]',state='attached');upload(TEXT.replace('BSC-076','BSC-077',1)) # Changes range end to77: manifest must catch77.
 check('真实遗漏显示具体编号与原因并阻止错误完整导入','BSC-077' in pg.locator('[data-testid=import-integrity]').inner_text() and pg.locator('[data-testid=import-confirm]').is_disabled())
 check('错误预览不改数据库',pg.evaluate(DUMP)['profile'][0]['doc']==again)
 check('一键清空功能仍在、全程零外部请求/页面错误且Key未显示',pg.locator('[data-testid=clear-personal-data]').count()==1 and not unexpected and not errors and 'FAKE-STRUCTURED-ONLY' not in pg.locator('body').inner_text())
 c.close()
print(f'{sum(checks)}/{len(checks)} passed')
