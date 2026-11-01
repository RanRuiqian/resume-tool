"""v1.12 固定简介、确认翻译、完整背景与旧简历不变。全部合成资料，API 全部模拟。
先运行 V112_LAYOUT_OUT=<临时目录> npx vitest run tests/personalLayoutV112.test.ts；
再以相同 V112_LAYOUT_OUT 运行本脚本，浏览器仅访问本地 preview。
"""
import copy, json, os, shutil, tempfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

BASE=os.environ.get('E2E_BASE','http://localhost:4173/')
assert urlsplit(BASE).hostname in ('localhost','127.0.0.1','::1'), 'only local preview is allowed'
FIX=Path(os.environ.get('V112_LAYOUT_OUT','/workspace/scratch/v112-personal-validation/layout'))
PROFILE=json.loads((FIX/'e2e-personal-profile.json').read_text())
JOBS=json.loads((FIX/'e2e-jobs.json').read_text())
KEY='FAKE-v112-personal-test-only'
plan={'requirements':[{'text':'模拟工程实践要求','tier':'must','assessment':'direct','evidenceIds':['career-b1','core-b1']}],
 'entries':[{'entryId':'career','bulletIds':['career-b1'],'reason':'真实生产技术背景'},{'entryId':'core','bulletIds':['core-b1','core-b2'],'reason':'工程课程实践'}],
 'reserveEntries':[{'entryId':'student','bulletIds':['student-b1'],'reason':'有价值的组织协调背景'}],
 'education':[{'entryId':'edu-1','bulletIds':[]}], 'skills':['sk-1'],'certificates':['cert-1'],'awards':[],'tradeoffs':'主要工作与项目，空间允许时补充组织背景'}
old={'id':'v112-old','jobId':'legacy-job','templateId':'tpl-classic','createdAt':'2026-01-01T00:00:00.000Z','primaryLanguage':'zh',
 'matchScore':0,'gaps':[],'selection':{'work':[],'projects':[],'education':[],'skills':[],'certificates':[],'awards':[]},
 'items':[{'sourceId':'summary','zh':'旧简历已经保存的简介。','en':'Previously saved introduction.','syncStatus':'in-sync'}],
 'consistency':{'checkedAt':'','issues':[]},'generatedBy':'rules'}
SEED='''([profile,job,old,key])=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['profile','settings','jobs','resumes','state'],'readwrite');
t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:key,model:'deepseek-flash',translateModel:'',visionModel:'',provider:'deepseek',uiLang:'zh',ocrMode:'local',setupDone:true});
t.objectStore('profile').put({id:'me',doc:profile});t.objectStore('jobs').put(job);t.objectStore('resumes').put(old);
t.objectStore('state').put({id:'jobId',value:job.id});t.objectStore('state').put({id:'resumeId',value:old.id});t.oncomplete=()=>{db.close();resolve()}}})'''
DUMP='''()=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['profile','resumes']);const o={};const a=t.objectStore('profile').get('me'),b=t.objectStore('resumes').getAll();a.onsuccess=()=>o.profile=a.result.doc;b.onsuccess=()=>o.resumes=b.result;t.oncomplete=()=>{db.close();resolve(o)}}})'''
SETJOB='''job=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['jobs','state'],'readwrite');t.objectStore('jobs').put(job);t.objectStore('state').put({id:'jobId',value:job.id});t.oncomplete=()=>{db.close();resolve()}}})'''
checks=[]
def check(label,condition):
 checks.append(condition); print(('PASS ' if condition else 'FAIL ')+label,flush=True)
 assert condition,label

with tempfile.TemporaryDirectory(prefix='v112-personal-browser-') as user_dir, sync_playwright() as p:
 executable=os.environ.get('CHROME_BIN') or shutil.which('google-chrome') or shutil.which('chromium')
 c=p.chromium.launch_persistent_context(user_dir,executable_path=executable,args=['--no-sandbox'],service_workers='block',viewport={'width':1366,'height':1000})
 pg=c.pages[0]; errors=[]; calls=[]; pg.on('pageerror',lambda e:errors.append(str(e)))
 c.route('**/*',lambda r:r.continue_() if urlsplit(r.request.url).hostname in ['localhost','127.0.0.1','::1'] else r.abort())
 facts={b['id']:b for e in PROFILE['work']+PROFILE['projects'] for b in e['bullets']}
 def ai(route):
  body=route.request.post_data_json; messages=body['messages']; content=messages[-1]['content']; calls.append(body)
  payload=json.loads(content.split('\n\n')[-1])
  if 'items' in payload and payload['items'] and 'key' in payload['items'][0]:
   response={'items':[{'key':'fixed-summary','text':PROFILE['profile']['summary']['en']}]}
  elif 'allowedIds' in payload:
   assert 'summaryOriginal' not in payload['candidate']; response=plan
  elif 'facts' in payload:
   assert 'summaryOriginal' not in payload and 'summaryFocus' not in payload
   response={'items':[]}
   core=[x for x in payload['facts'] if x['sourceId'].startswith('core-')]
   for fact in payload['facts']:
    if fact['sourceId']=='core-b2': continue
    response['items'].append({'sourceId':fact['sourceId'],'sourceIds':[x['sourceId'] for x in core] if fact['sourceId']=='core-b1' else [fact['sourceId']],
       'text':'\n'.join(x['text'] for x in core) if fact['sourceId']=='core-b1' else fact['text']})
  else:
   assert all(x['sourceId']!='summary' for x in payload['items'])
   target='zh' if '为中文副版本' in content else 'en'
   response={'items':[{'sourceId':x['sourceId'],'text':'\n'.join(facts[s].get(target,'') for s in x.get('sourceIds',[x['sourceId']]))} for x in payload['items']]}
  route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(response,ensure_ascii=False)}}]}))
 c.route('https://api.deepseek.com/**',ai)
 profile=copy.deepcopy(PROFILE); profile['profile']['summary']['en']=''; profile['profile']['summary']['status']['en']='machine'
 pg.goto(BASE);pg.wait_for_timeout(700);pg.evaluate(SEED,[profile,JOBS['A'],old,KEY]);pg.goto(BASE+'#profile');pg.reload()
 pg.wait_for_selector('[data-testid=fixed-summary-editor]')
 editor=pg.locator('[data-testid=fixed-summary-editor]');editor.get_by_role('button',name='获取英文简介翻译建议（确认后保存）').click()
 pg.wait_for_selector('[data-testid=summary-translation-preview]')
 check('翻译建议尚未写入资料',pg.evaluate(DUMP)['profile']['profile']['summary']['en']=='')
 print('Translation review:',pg.locator('[data-testid=summary-translation-preview] .err-text').all_inner_texts(),flush=True)
 check('简介翻译通过事实对照核验',pg.locator('[data-testid=summary-translation-preview]').get_by_role('button',name='确认译文并保存到我的资料').is_enabled())
 pg.locator('[data-testid=summary-translation-preview]').get_by_role('button',name='确认译文并保存到我的资料').click()
 pg.wait_for_timeout(500);saved=pg.evaluate(DUMP)
 check('确认后只保存固定简介英文',saved['profile']['profile']['summary']['en']==PROFILE['profile']['summary']['en'] and saved['profile']['profile']['summary']['status']['en']=='confirmed')
 check('资料修改没有覆盖旧简历',next(r for r in saved['resumes'] if r['id']=='v112-old')==old)
 before_profile=copy.deepcopy(saved['profile']); before_calls=len(calls); generated=[]
 for key in ['A','B']:
  pg.evaluate(SETJOB,JOBS[key]);pg.evaluate("localStorage.setItem('wizardStep','3')");pg.goto(BASE+'#wizard');pg.reload()
  r=None
  for _ in range(300):
   data=pg.evaluate(DUMP)
   r=next((x for x in data['resumes'] if x['jobId']==JOBS[key]['id']),None)
   if r: break
   failure=pg.locator('.notice.error')
   if failure.count(): raise AssertionError(failure.all_inner_texts())
   pg.wait_for_timeout(200)
  assert r is not None, 'generation not saved within 60 seconds'
  generated.append(r)
  pg.wait_for_selector('.result-bar');pg.wait_for_timeout(300)
  summary=next(x for x in r['items'] if x['sourceId']=='summary')
  check(key+' 直接复用双语简介',summary['zh']==PROFILE['profile']['summary']['zh'] and summary['en']==PROFILE['profile']['summary']['en'])
  check(key+' 保留专业工作和组织、排除普通兼职',set(r['selection']['work'])=={'career','student'} and 'core' in r['selection']['projects'])
  group=next(x for x in r['items'] if x['sourceId']=='core-b1')
  check(key+' 多来源合并可追溯且没有重复要点',group['sourceIds']==['core-b1','core-b2'] and not any(x['sourceId']=='core-b2' for x in r['items']))
  check(key+' 生成不改母库和旧简历',data['profile']==before_profile and next(x for x in data['resumes'] if x['id']=='v112-old')==old)
 check('两份已保存简历简介完全一致',next(x for x in generated[0]['items'] if x['sourceId']=='summary')==next(x for x in generated[1]['items'] if x['sourceId']=='summary'))
 # 界面上的勾选操作仍然有效，且不触发新的 AI 调用或修改母库。
 row=pg.locator('.pool-entry').filter(has=pg.locator('b',has_text='虚构工程大学学生会')).first
 row.locator('input[type=checkbox]').first.uncheck();pg.wait_for_timeout(400)
 check('用户取消组织经历仍有效','student' not in next(x for x in pg.evaluate(DUMP)['resumes'] if x['id']==generated[1]['id'])['selection']['work'])
 row.locator('input[type=checkbox]').first.check();pg.wait_for_timeout(400)
 check('用户补选组织经历仍有效','student' in next(x for x in pg.evaluate(DUMP)['resumes'] if x['id']==generated[1]['id'])['selection']['work'])
 check('无页面错误且界面无 Key',not errors and KEY not in pg.locator('body').inner_text())
 check('两份简历仅使用原有选材、写作、本地化调用，无额外完整重跑',len(calls)-before_calls==6)
 if os.environ.get('SHOT_DIR'):
  Path(os.environ['SHOT_DIR']).mkdir(parents=True,exist_ok=True);pg.screenshot(path=str(Path(os.environ['SHOT_DIR'])/'personal-completeness.png'),full_page=True)
 c.close()
print(f'{len(checks)}/{len(checks)} passed')
