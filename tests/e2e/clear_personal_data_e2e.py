"""Clear only synthetic data in an isolated temporary Chromium profile. All external APIs mocked."""
import copy,json,os,shutil,tempfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
ROOT=Path(os.environ.get('CLEAR_OUT','/workspace/scratch/clear-profile'));ROOT.mkdir(parents=True,exist_ok=True)
BASE=os.environ.get('E2E_BASE','http://localhost:4173/')
FIX=json.loads(Path(os.environ.get('CLEAR_FIXTURE',str(ROOT/'fictional-clear-fixture.json'))).read_text())
PROFILE=copy.deepcopy(FIX['p']);PROFILE['profile']['headline']={'zh':'原有的虚构工程背景','en':''};PROFILE['sourceTexts']=[{'id':'old-text','at':'2026-01-01','files':['old-fictional.txt'],'text':'旧的虚构个人资料原文'}]
PROFILE['evidence']=[{'id':'old-ev','fileName':'fictional.pdf','type':'other','location':'fictional local note','locationKind':'note','projectIds':['core'],'skillIds':[],'proves':'虚构资料证据','confirmed':False,'publicOk':False}]
KEY='FAKE-CLEAR-PROFILE-ONLY';checks=[];requests=[];authorized=[];pending=[];hold=False
NEW={'lang':'zh','name':'测试用户全新','headline':'虚构工程实习生','summary':'测试用户全新的虚构资料。','email':'new-test@example.com','education':[{'school':'模拟新大学','degree':'本科','major':'工程','start':'2020-09','end':'2024-06','highlights':[]}],'work':[],'projects':[],'skills':[{'name':'虚构测试技能','category':'工程'}],'certificates':[],'awards':[],'evidence':[]}
NEW_TEXT='测试用户全新\n邮箱 new-test@example.com\n虚构工程实习生\n2020-09 至 2024-06 模拟新大学 工程 本科\n技能：虚构测试技能\n简介：测试用户全新的虚构资料。'
TABLES=['profile','settings','templates','jobs','jdGroups','resumes','exports','backups','postings','applications','appEvents','artifacts','resumeVersions','attachments','attachmentBlobs','state']
DUMP="""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,o={};const t=d.transaction([...d.objectStoreNames]);for(const n of t.objectStoreNames){const a=t.objectStore(n).getAll();a.onsuccess=()=>o[n]=a.result}t.oncomplete=()=>{d.close();r(o)}}})"""
SEED="""([profile,job,key])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction([...d.objectStoreNames],'readwrite');t.objectStore('profile').put({id:'me',doc:profile});t.objectStore('settings').put({id:'settings',demoMode:false,provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:key,model:'deepseek-v4-pro',translateModel:'mock-translation',visionModel:'mock-vision',uiLang:'zh',ocrMode:'local',setupDone:true});t.objectStore('jobs').put(job);t.objectStore('state').put({id:'jobId',value:job.id});t.objectStore('state').put({id:'templateId',value:'tpl-classic'});t.objectStore('backups').put({id:'bk-premigrate-v4-me',createdAt:'2026-01-01',reason:'fictional old profile',doc:profile});t.objectStore('resumes').put({id:'old-resume',jobId:job.id,createdAt:'2026-01-01',items:[{sourceId:'summary',zh:profile.profile.summary.zh,en:profile.profile.summary.en,syncStatus:'in-sync'}],selection:{work:[],projects:[],education:[],skills:[],certificates:[],awards:[]},consistency:{checkedAt:'',issues:[]},primaryLanguage:'zh',templateId:'tpl-classic',generatedBy:'rules',matchScore:0,gaps:[]});t.objectStore('exports').put({id:'old-export',resumeId:'old-resume',company:'模拟企业',roleAbbr:'MOCK',date:'2026-01-01',seq:1,zip:new Uint8Array([1,2])});t.objectStore('postings').put({id:'keep-posting',company:'模拟保留企业',title:'模拟岗位',city:'',priority:1,source:{kind:'manual'},createdAt:'2026-01-01',updatedAt:'2026-01-01'});t.objectStore('applications').put({id:'keep-application',postingId:'keep-posting',status:'pending',todos:[],interviews:[],source:{kind:'manual'},createdAt:'2026-01-01',updatedAt:'2026-01-01'});t.objectStore('artifacts').put({id:'keep-artifact',applicationId:'keep-application',kind:'snapshot',label:'虚构只读投递版本',languages:['zh','en'],createdAt:'2026-01-01',submitted:false,profile});t.oncomplete=()=>{d.close();r()}}})"""
def check(label,cond):
 checks.append(bool(cond));print(('PASS ' if cond else 'FAIL ')+label,flush=True);assert cond,label
def ai(route):
 body=route.request.post_data_json;requests.append(body);authorized.append(route.request.headers.get('authorization')=='Bearer '+KEY);content=body['messages'][-1]['content']
 try:payload=json.loads(content)
 except (ValueError,TypeError):payload={}
 if 'items' in payload:
  out={'items':[{'key':x['key'],'text':{'原有的虚构工程背景':'Original fictional engineering background','测试用户全新':'Test User New','虚构工程实习生':'Fictional Engineering Intern','模拟新大学':'Fictional New University','本科':'Bachelor','工程':'Engineering','虚构测试技能':'Fictional Test Skill'}.get(x['text'],x['text'])} for x in payload['items']]}
  if hold:pending.append((route,out));return
 else:out=NEW
 route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(out,ensure_ascii=False)}}]}))
with tempfile.TemporaryDirectory(prefix='clear-profile-isolated-') as folder,sync_playwright() as p:
 c=p.chromium.launch_persistent_context(folder,executable_path=shutil.which('chromium'),args=['--no-sandbox'],service_workers='block',viewport={'width':1440,'height':1000})
 errors=[];unexpected=[]
 def block(route):
  if urlsplit(route.request.url).hostname in ['localhost','127.0.0.1','::1']:route.continue_()
  else:unexpected.append(urlsplit(route.request.url).hostname);route.abort()
 c.route('**/*',block);c.route('https://api.deepseek.com/**',ai)
 pg=c.pages[0];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(BASE);pg.wait_for_timeout(500);pg.evaluate(SEED,[PROFILE,FIX['jobs'][0],KEY]);pg.goto(BASE+'#profile');pg.reload();pg.wait_for_selector('[data-testid=clear-personal-data]')
 before=pg.evaluate(DUMP);check('清空前存在旧资料、原文、快照、生成和导出缓存',len(before['profile'][0]['doc']['work'])>0 and len(before['profile'][0]['doc']['courses'])>0 and bool(before['backups']) and bool(before['resumes']) and bool(before['exports']))
 pg.click('[data-testid=clear-personal-data]');dialog=pg.locator('[data-testid=clear-personal-data-dialog]')
 check('顶部危险按钮打开指定确认文案，明确不可撤销及投递版本保留','此操作无法撤销，但不会影响 API 设置和求职投递记录' in dialog.inner_text() and '只读投递版本' in dialog.inner_text())
 dialog.get_by_role('button',name='取消',exact=True).click();check('取消不删除任何资料',pg.evaluate(DUMP)==before)
 # A different tab starts a real UI translation whose mocked response remains in flight.
 other=c.new_page();other.on('pageerror',lambda e:errors.append(str(e)));other.goto(BASE+'#profile');other.wait_for_selector('[data-testid=clear-personal-data]');hold=True
 other.get_by_role('button',name='AI 补译英文',exact=False).click()
 for _ in range(100):
  if pending:break
  pg.wait_for_timeout(50)
 check('旧标签页已有未完成的翻译任务',len(pending)>0)
 pg.click('[data-testid=clear-personal-data]');pg.click('[data-testid=confirm-clear-personal-data]');pg.wait_for_selector('[data-testid=clear-personal-data-dialog]',state='detached');pg.wait_for_timeout(500)
 after=pg.evaluate(DUMP);doc=after['profile'][0]['doc']
 check('所有个人条目、翻译、原文和关联信息真正清空',not doc['profile']['name'] and not doc['profile']['summary'] and not doc['profile'].get('photo') and all(not doc.get(k) for k in ['education','work','projects','courses','skills','certificates','awards','evidence','sourceTexts','glossary']))
 check('历史快照、生成简历、导出缓存均删除，当前结果解除',not after['backups'] and not after['resumes'] and not after['exports'] and next(x['value'] for x in after['state'] if x['id']=='resumeId')=='')
 kept=['settings','templates','jobs','jdGroups','postings','applications','appEvents','artifacts','resumeVersions','attachments','attachmentBlobs']
 check('API Key/模型/语言/模板/岗位/投递版本逐项原样保留',all(after[k]==before[k] for k in kept))
 check('页面各栏目立即为空，旧人名和旧文件未残留','课程（0）' in pg.locator('.tabs').inner_text() and '工作（0）' in pg.locator('.tabs').inner_text() and not pg.locator('[data-testid=file-card]').count())
 hold=False
 for route,out in pending:route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(out)}}]}))
 pending.clear();pg.wait_for_timeout(1200)
 check('其他标签页与晚到翻译响应不能恢复旧资料',not pg.evaluate(DUMP)['profile'][0]['doc']['work'] and other.locator('[data-testid=fixed-summary-editor] textarea').first.input_value()=='')
 # Try editing very quickly before clear; the old 400ms debounced write must not win.
 pg.get_by_placeholder('中文',exact=True).first.fill('测试用户防抖');pg.click('[data-testid=clear-personal-data]');pg.click('[data-testid=confirm-clear-personal-data]');pg.wait_for_timeout(800)
 check('清空取消待落盘编辑，不会被防抖保存恢复',not pg.evaluate(DUMP)['profile'][0]['doc']['profile']['name'])
 pg.reload();pg.wait_for_selector('[data-testid=clear-personal-data]');pg.wait_for_timeout(500)
 check('刷新仍为空，配置与投递记录仍在',not pg.evaluate(DUMP)['profile'][0]['doc']['work'] and pg.evaluate(DUMP)['settings']==before['settings'] and pg.evaluate(DUMP)['applications']==before['applications'])
 pg.screenshot(path=str(ROOT/'cleared-profile.png'))
 pg.set_input_files('[data-testid=smart-file]',{'name':'new-fictional-profile.txt','mimeType':'text/plain','buffer':NEW_TEXT.encode()});pg.wait_for_selector('[data-testid=file-text]');check('可以重新上传 TXT，内容只来自新文件',NEW_TEXT in pg.locator('[data-testid=file-text]').input_value() and '旧的虚构个人资料原文' not in pg.locator('[data-testid=smart-import]').inner_text())
 pg.click('[data-testid=smart-run]');pg.wait_for_selector('[data-testid=import-confirm]',timeout=30000);pg.click('[data-testid=import-confirm]');pg.wait_for_selector('[data-testid=import-done]');pg.wait_for_timeout(500)
 imported=pg.evaluate(DUMP)['profile'][0]['doc'];check('清空后智能识别使用保留的 API 并保存全新资料',imported['profile']['name']['zh']==NEW['name'] and len(imported['education'])==1 and bool(imported['sourceTexts']) and all(authorized))
 check('新资料没有混入旧经历、课程或快照',not imported['work'] and not imported['courses'] and not pg.evaluate(DUMP)['backups'])
 pg.reload();pg.wait_for_selector('[data-testid=clear-personal-data]');check('新资料刷新后正常保存可使用',pg.evaluate(DUMP)['profile'][0]['doc']['profile']['name']['zh']==NEW['name'])
 check('API 授权继续使用同一虚构 Key，模型配置未改',all(authorized) and all(r['model'] in ['deepseek-v4-pro','mock-translation'] for r in requests) and pg.evaluate(DUMP)['settings']==before['settings'])
 check('全程无真实外网请求或页面错误，Key 不出现在页面',not errors and not unexpected and KEY not in pg.locator('body').inner_text())
 c.close()
print(f'{sum(checks)}/{len(checks)} passed')
