# 岗位要求解读（浏览器端，全部模拟：资料虚构、Key 虚构、AI 接口被 Playwright 拦截）
import json, os, tempfile, re
from playwright.sync_api import sync_playwright
B=os.environ.get('E2E_BASE','http://localhost:4173/'); S=os.environ.get('SHOT_DIR','/tmp/shots/'); os.makedirs(S, exist_ok=True)
ok=[]; calls={'parse':0,'explain':0}
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
PARSE={'jdLanguage':'zh','company':{'full':'虚构电机有限公司','short':'虚构电机'},'roleAbbr':'ME','title':{'zh':'机械设计工程师','en':'Mechanical Design Engineer'},
  'mustHave':[{'zh':'熟练使用 CAD','en':'CAD'}],'niceToHave':[],'responsibilities':[{'zh':'澄清订单技术相关的事宜','en':'clarify order tech'},{'zh':'处理工程变更','en':'ECN'}],
  'keywords':[{'zh':'CAD','en':'CAD'}],'yearsRequired':None,'summary':'机械设计'}
def ai(route):
    body=route.request.post_data_json; text=body['messages'][-1]['content']
    if '职业顾问' in text:
        calls['explain']+=1
        ids=re.findall(r'"id":"([^"]+)"', text)
        out={'items':[{'id':i,'meaning':'模拟解读：核对订单里的技术参数','abilities':'读规格书、基础制图','experience':'课程项目或实习'} for i in ids]}
    else: calls['parse']+=1; out=PARSE
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(out,ensure_ascii=False)}}]}))
DOC={'profile':{'name':{'zh':'测试用户'},'email':'t@example.com','summary':{}},'education':[{'id':'ed1','school':{'zh':'虚构海事大学'},'degree':{'zh':'学士'},'major':{'zh':'轮机工程'},'start':'2022-09','end':'2026-06','highlights':[]}],'work':[],'projects':[],'skills':[],'certificates':[],'awards':[],'customSections':[]}
SEED="""([k,doc])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','profile'],'readwrite');
  t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:k,model:'deepseek-flash',uiLang:'zh',provider:'deepseek',ocrMode:'vision',setupDone:true});
  t.objectStore('profile').put({id:'me',doc,updatedAt:Date.now()});t.oncomplete=()=>{db.close();r()}}})"""
with sync_playwright() as p:
    c=p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='chrome-explain-'), executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/google-chrome'), args=['--no-sandbox'], viewport={'width':1366,'height':900})
    pg=c.pages[0]; errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); c.route('https://api.deepseek.com/**', ai)
    pg.goto(B); pg.wait_for_timeout(800); pg.evaluate(SEED,['sk-FAKE-explain-0001',DOC]); pg.evaluate("localStorage.setItem('wizardStep','2')"); pg.goto(B+'#wizard'); pg.reload(); pg.wait_for_selector('[data-testid=jd-text]')
    pg.fill('[data-testid=jd-text]','机械设计工程师 虚构电机有限公司\n岗位职责：1. 澄清订单技术相关的事宜 2. 处理工程变更\n任职要求：熟练使用 CAD')
    pg.click('[data-testid=analyze]'); pg.wait_for_selector('.chip.must')
    chk('分析岗位后出现「岗位要求解读」栏，且分析时没有自动调用解读', pg.locator('[data-testid=job-explain]').count()==1 and calls['explain']==0)
    pg.locator('[data-testid=job-explain] > summary').click(); pg.click('[data-testid=explain-run]'); pg.wait_for_selector('[data-testid=explain-item]')
    t=pg.locator('[data-testid=job-explain]').inner_text()
    chk('三条要求各有解读，含意思 / 通常需要 / 对口经历', pg.locator('[data-testid=explain-item]').count()==3 and '意思：' in t and '通常需要：' in t and '对口经历：' in t and '澄清订单技术相关的事宜' in t)
    chk('只调用一次 AI，并标注仅供参考', calls['explain']==1 and '仅供参考' in t)
    chk('解读完成后按钮变为「已全部解读」且禁用', pg.locator('[data-testid=explain-run]').is_disabled() and '已全部解读' in pg.locator('[data-testid=explain-run]').inner_text())
    pg.reload(); pg.wait_for_selector('[data-testid=job-explain]'); pg.locator('[data-testid=job-explain] > summary').click()
    chk('刷新后解读仍在（保存在岗位上），不再调用 AI', pg.locator('[data-testid=explain-item]').count()==3 and calls['explain']==1)
    pg.screenshot(path=S+'job_explain.png', full_page=True)
    chk('页面无报错', not errs)
    c.close()
print(f'{sum(ok)}/{len(ok)} passed'); assert all(ok)
