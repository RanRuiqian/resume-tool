"""Explicit AI organization: fictional reviewed V7-format profile, mocked HTTP, isolated browser only."""
import copy,json,os,shutil,tempfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
BASE=os.environ.get('E2E_BASE','http://localhost:4173/')
DOC=json.loads(Path(os.environ.get('ORGANIZE_FIXTURE','/workspace/scratch/organize-ai/fictional-reviewed.json')).read_text())
KEY='FAKE-ORGANIZE-BROWSER';checks=[];requests=[];mode='success';batch=0
DUMP="""()=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,o={},t=d.transaction(['profile','settings']);for(const n of t.objectStoreNames){const r=t.objectStore(n).getAll();r.onsuccess=()=>o[n]=r.result}t.oncomplete=()=>{d.close();resolve(o)}}})"""
SEED="""([doc,key])=>new Promise(resolve=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction(['profile','settings'],'readwrite');t.objectStore('profile').put({id:'me',doc});t.objectStore('settings').put({id:'settings',demoMode:false,provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:key,model:'deepseek-flash',translateModel:'',visionModel:'',uiLang:'zh',ocrMode:'local',setupDone:true});t.oncomplete=()=>{d.close();resolve()}}})"""
def check(label,ok):
 checks.append(bool(ok));print(('PASS ' if ok else 'FAIL ')+label,flush=True);assert ok,label
def ai(route):
 global batch
 batch+=1;body=route.request.post_data_json;requests.append(body)
 if mode=='fail' or (mode=='partial' and batch==1):return route.fulfill(status=503,content_type='application/json',body='{"error":{"message":"mock unavailable"}}')
 s=body['messages'][-1]['content'];items=json.loads(s[s.rfind('{"items"'):])['items'];out=[]
 for x in items:
  out.append({'key':x['key'],'category':'resume','zh':x['zh'].replace('在模拟实验室使用 Python','在模拟实验室，使用 Python'),'en':x['en'],'notes':[],'archive':[],'uncertain':[],'date':'2099-01','sourceId':'MALICIOUS-IGNORED'})
 route.fulfill(status=200,content_type='application/json',body=json.dumps({'model':'mock-actual-flash-v4','choices':[{'finish_reason':'stop','message':{'content':json.dumps({'items':out},ensure_ascii=False)}}]}))
with tempfile.TemporaryDirectory(prefix='organize-ai-isolated-') as folder,sync_playwright() as p:
 c=p.chromium.launch_persistent_context(folder,executable_path=shutil.which('chromium'),args=['--no-sandbox'],service_workers='block',viewport={'width':1440,'height':1000})
 errors=[];outside=[]
 def block(route):
  if urlsplit(route.request.url).hostname in ['localhost','127.0.0.1','::1']:route.continue_()
  else:outside.append(urlsplit(route.request.url).hostname);route.abort()
 c.route('**/*',block);c.route('https://api.deepseek.com/**',ai);pg=c.pages[0];pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('dialog',lambda d:d.accept());pg.goto(BASE);pg.wait_for_timeout(600)
 def seed(doc):
  pg.evaluate(SEED,[doc,KEY]);pg.goto(BASE+'#profile');pg.reload();pg.wait_for_selector('[data-testid=organize-start]')
 def start():
  pg.click('[data-testid=organize-start]');pg.wait_for_selector('[data-testid=organize-ai]')
 seed(DOC);before=pg.evaluate(DUMP);start();check('启动仅创建快照，未提前发送AI请求',not requests)
 pg.click('[data-testid=organize-ai]');pg.wait_for_selector('[data-testid=organize-review]',timeout=30000)
 execution=pg.locator('[data-testid=organize-execution]').inner_text()
 check('已确认V7措辞确实分批发往配置的Flash模型',len(requests)>1 and all(r['model']=='deepseek-flash' and r.get('thinking',{}).get('type')=='disabled' for r in requests))
 check('界面区分请求模型与实际响应模型并显示成功次数','请求模型：deepseek-flash' in execution and '响应模型：mock-actual-flash-v4' in execution and f'实际请求尝试：{len(requests)} 次' in execution and '失败 0' in execution and 'AI 已返回' in execution)
 check('原文/来源账本/学历课程成绩没有混入请求JSON',all('sourceFacts' not in json.dumps(r) and '成绩受遮挡' not in json.dumps(r,ensure_ascii=False) and '模拟硕士大学' not in json.dumps(r,ensure_ascii=False) for r in requests))
 check('AI只生成建议，确认前个人资料逐字段不变',pg.evaluate(DUMP)['profile']==before['profile'])
 rows=pg.locator('[data-testid=org-high]').filter(has_text='来源：AI 规范化');check('已确认文字的AI措辞建议默认不勾选',rows.count()>0 and not rows.first.locator('input[type=checkbox]').is_checked())
 rows.first.locator('input[type=checkbox]').check();pg.click('[data-testid=organize-apply]');pg.wait_for_selector('[data-testid=organize-done]');pg.wait_for_timeout(500);saved=pg.evaluate(DUMP)
 check('人工选择后才改变措辞，仍保留全部事实及来源编号',saved['profile'][0]['doc']['work'][0]['bullets'][0]['zh']=='在模拟实验室，使用 Python 完成设备测试。' and saved['profile'][0]['doc']['education']==before['profile'][0]['doc']['education'] and saved['profile'][0]['doc']['courses']==before['profile'][0]['doc']['courses'] and saved['profile'][0]['doc']['sourceFacts']==before['profile'][0]['doc']['sourceFacts'])
 check('模型不能通过额外字段篡改日期和来源，API配置不变',saved['settings']==before['settings'] and all(e['start']!='2099-01' for e in saved['profile'][0]['doc']['work']) and 'MALICIOUS-IGNORED' not in json.dumps(saved))
 n=len(requests);start();pg.click('[data-testid=organize-ai]');pg.wait_for_selector('[data-testid=organize-review]');ex=pg.locator('[data-testid=organize-execution]').inner_text()
 check('复用已审阅记录时明确未调用及原因，并提供重审入口',len(requests)==n and '未调用 AI' in ex and '同模型和规则已审阅' in ex and pg.locator('[data-testid=organize-retry-ai]').count()==1)
 mode='fail';batch=0;pg.click('[data-testid=organize-retry-ai]');pg.wait_for_selector('[data-testid=organize-error]',timeout=30000);ex=pg.locator('[data-testid=organize-execution]').inner_text()
 check('失败显示真实请求次数与503原因，不冒充未调用或成功',len(requests)>n and '503' in ex and '失败' in ex and '成功批次 0' in ex and not pg.locator('[data-testid=organize-review]').count())
 check('全批失败保留原资料和来源账本',pg.evaluate(DUMP)['profile']==saved['profile'])
 mode='partial';batch=0;pg.click('[data-testid=organize-recheck]');pg.wait_for_selector('[data-testid=organize-review]',timeout=30000);ex=pg.locator('[data-testid=organize-execution]').inner_text()
 check('部分失败与成功分别展示，本地结果不会被冒充为AI',batch>1 and '失败 1' in ex and '503' in ex and pg.locator('[data-testid=organize-ai-errors]').count()==1 and '本地规则' in pg.locator('[data-testid=organize-report]').inner_text())
 check('部分失败的预览仍不自动写入',pg.evaluate(DUMP)['profile']==saved['profile'])
 protected=copy.deepcopy(DOC);protected['work']=[];protected['projects']=[];protected['profile']['summary']={};protected['profile']['headline']={};protected.pop('sourceFacts',None);mode='success';seed(protected);start();n=len(requests);pg.click('[data-testid=organize-ai]');pg.wait_for_selector('[data-testid=organize-review]');ex=pg.locator('[data-testid=organize-execution]').inner_text()
 check('仅剩学历/课程等受保护内容时明确说明原因且不请求',len(requests)==n and '未调用 AI' in ex and '教育事实受保护' in ex)
 seed(DOC);start();pg.click('[data-testid=organize-ai]');pg.wait_for_selector('[data-testid=organize-review]');pg.locator('[data-testid=org-high]').filter(has_text='来源：AI 规范化').first.locator('input[type=checkbox]').check();pg.get_by_placeholder('中文',exact=True).first.fill('测试用户当前已修改');pg.wait_for_timeout(700);pg.click('[data-testid=organize-apply]');pg.wait_for_selector('[data-testid=organize-error]')
 check('审阅期间用户修改资料后阻止旧计划覆盖当前事实','资料在整理期间已发生变化' in pg.locator('[data-testid=organize-error]').inner_text() and pg.evaluate(DUMP)['profile'][0]['doc']['profile']['name']['zh']=='测试用户当前已修改')
 check('全程无真实外网请求/页面错误/界面Key',not outside and not errors and KEY not in pg.locator('body').inner_text())
 c.close()
print(f'{sum(checks)}/{len(checks)} passed')
