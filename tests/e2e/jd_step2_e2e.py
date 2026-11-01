# v1.10 岗位分析稳定性 + 截图删除 + 标签不重叠（浏览器端，全部模拟：资料虚构、Key 虚构、AI 接口被 Playwright 拦截）
import json, os, tempfile, shutil
from playwright.sync_api import sync_playwright
B=os.environ.get('E2E_BASE','http://localhost:4173/'); S=os.environ.get('SHOT_DIR','/workspace/resume-tool/screenshots/'); os.makedirs(S, exist_ok=True)
FX=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','fixtures','files')
KEY='sk-FAKE-v110-step2-0001'; ok=[]; calls={'ocr':0,'parse':0}
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
OCR=['共有47个符合条件的职位\n机械结构设计工程师（应届）\n虚构新能源科技有限公司\n岗位职责：\n1. 负责发电机结构设计与 CAD 建模\n128 人已申请\n立即申请',
     '任职要求：\n1. 熟练使用 SolidWorks\n2. 了解有限元分析者优先\n相似职位\n电气工程师 虚构电气']
LONG='Geometric Dimensioning and Tolerancing (GD&T) per ASME Y14.5-2018 for complex multi-part assemblies'
PARSE={'jdLanguage':'zh','company':{'full':'虚构新能源科技有限公司','short':'虚构新能源'},'roleAbbr':'ME','title':{'zh':'机械结构设计工程师','en':'Mechanical Design Engineer'},
  'mustHave':[{'zh':'SolidWorks','en':'SolidWorks'},{'zh':'机械结构设计与发电机及附件的 CAD 三维建模、二维出图和装配关系校核','en':LONG}],
  'niceToHave':[{'zh':'有限元分析','en':'FEA'}],'responsibilities':[{'zh':'负责发电机结构设计与 CAD 建模','en':'generator structural design'}],
  'keywords':[{'zh':'超长关键词'*8,'en':'VeryLongUnbrokenKeyword'*6}]+[{'zh':f'关键词{i}','en':f'Keyword number {i}'} for i in range(18)],'yearsRequired':None,'summary':'机械结构设计'}
def ai(route):
    body=route.request.post_data or ''
    if 'image_url' in body: txt=OCR[calls['ocr']%2]; calls['ocr']+=1
    else: calls['parse']+=1; txt=json.dumps(PARSE,ensure_ascii=False)
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':txt}}]}))
DOC={'profile':{'name':{'zh':'测试用户十八'},'email':'t18@example.com','summary':{}},'education':[{'id':'ed1','school':{'zh':'虚构海事大学'},'degree':{'zh':'学士'},'major':{'zh':'轮机工程'},'start':'2022-09','end':'2026-06','highlights':[]}],
 'work':[],'projects':[],'skills':[],'certificates':[],'awards':[],'customSections':[]}
SEED="""([k,doc])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','profile'],'readwrite');
  t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:k,model:'deepseek-flash',visionModel:'mock-vl',translateModel:'',uiLang:'zh',provider:'deepseek',ocrMode:'vision',setupDone:true});
  t.objectStore('profile').put({id:'me',doc,updatedAt:Date.now()});t.oncomplete=()=>{db.close();r()}}})"""
OVERLAP="""()=>{const bad=[];document.querySelectorAll('.chips').forEach(c=>{const cr=c.getBoundingClientRect();const rs=[...c.querySelectorAll('.chip')].map(x=>x.getBoundingClientRect());
  rs.forEach((a,i)=>{if(a.right>cr.right+1)bad.push('overflow');rs.slice(i+1).forEach(b=>{if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)bad.push('overlap')})})});
  return {bad, n:document.querySelectorAll('.chip').length, docOverflow: document.documentElement.scrollWidth>window.innerWidth+1}}"""
tmp=tempfile.mkdtemp(prefix='p18-'); img1=os.path.join(tmp,'jd_a.png'); img2=os.path.join(tmp,'jd_b.png')
shutil.copy(os.path.join(FX,'jd_screenshot_mock.png'),img1); shutil.copy(os.path.join(FX,'jd_screenshot_mock.png'),img2)
with sync_playwright() as p:
    c=p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='chrome-p18-'), executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':1366,'height':900})
    pg=c.pages[0]; errs=[]; dialogs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept())); c.route('https://api.deepseek.com/**', ai)
    pg.goto(B); pg.wait_for_timeout(800); pg.evaluate(SEED,[KEY,DOC]); pg.evaluate("localStorage.setItem('wizardStep','2')"); pg.goto(B+'#wizard'); pg.reload(); pg.wait_for_selector('[data-testid=jd-text]')
    pg.set_input_files('.dropzone input[type=file]', [img1, img2]); pg.wait_for_function("document.querySelectorAll('[data-testid=jd-thumb]').length==2")
    pg.wait_for_function("document.querySelector('[data-testid=jd-text]').value.includes('SolidWorks')", timeout=15000)
    t=pg.locator('[data-testid=jd-text]').input_value()
    chk('两张截图都识别，正文合并', calls['ocr']==2 and '发电机结构设计' in t and 'SolidWorks' in t)
    chk('网页噪声和「相似职位」之后的内容已去掉', not any(x in t for x in ['共有47个','已申请','立即申请','电气工程师']))
    chk('截图识别原文可查看（含被去掉的行）', pg.locator('[data-testid=ocr-raw]').count()==1 and '共有47个' in pg.locator('[data-testid=ocr-raw]').text_content())
    pg.click('[data-testid=analyze]'); pg.wait_for_selector('.chip.must')
    chk('首次分析调用 1 次 AI', calls['parse']==1)
    chk('分析面板显示岗位职责', '岗位职责' in pg.locator('.card').nth(1).inner_text())
    pg.click('[data-testid=analyze]'); pg.wait_for_selector('[data-testid=analyze-info]')
    chk('同一文字再次分析：复用结果，不再调用 AI', calls['parse']==1 and '沿用' in pg.locator('[data-testid=analyze-info]').inner_text())
    for w,h in [(390,844),(768,1000),(1280,900),(1440,900)]:
        pg.set_viewport_size({'width':w,'height':h}); pg.wait_for_timeout(250); r=pg.evaluate(OVERLAP)
        chk(f'{w}px：{r["n"]} 个标签无重叠、不溢出容器、页面无横向滚动', not r['bad'] and not r['docOverflow'] and r['n']>15)
        pg.screenshot(path=S+f'p18_chips_{w}.png', full_page=True)
    pg.set_viewport_size({'width':1366,'height':900})
    pg.click('[data-testid=reanalyze]'); pg.wait_for_timeout(400)
    chk('「重新分析」强制调用 AI', calls['parse']==2)
    pg.screenshot(path=S+'p18_step2_two_shots.png', full_page=True)
    pg.locator('[data-testid=thumb-del]').first.click(); pg.wait_for_timeout(300)
    t2=pg.locator('[data-testid=jd-text]').input_value()
    chk('删除一张截图：剩 1 张，正文按剩余截图重建', pg.locator('[data-testid=jd-thumb]').count()==1 and 'SolidWorks' in t2 and '发电机结构设计' not in t2)
    chk('删除后旧分析标为过期，不能直接生成简历', pg.locator('[data-testid=stale-warn]').count()==1 and pg.get_by_role('button', name='生成简历 →').is_disabled())
    pg.screenshot(path=S+'p18_step2_deleted_one.png', full_page=True)
    pg.locator('[data-testid=thumb-del]').first.click(); pg.wait_for_timeout(300)
    chk('删除最后一张：截图、文字、分析全部清空', pg.locator('[data-testid=jd-thumb]').count()==0 and pg.locator('[data-testid=jd-text]').input_value()=='' and pg.locator('.chip.must').count()==0)
    pg.screenshot(path=S+'p18_step2_cleared.png', full_page=True)
    pg.fill('[data-testid=jd-text]','机械结构设计工程师\n负责发电机结构设计与 CAD 建模\n熟练使用 SolidWorks'); pg.click('[data-testid=analyze]'); pg.wait_for_selector('.chip.must')
    pg.click('[data-testid=clear-job]'); pg.wait_for_timeout(300)
    chk('「清空本次岗位」清空文字与分析', pg.locator('[data-testid=jd-text]').input_value()=='' and pg.locator('.chip.must').count()==0)
    prof=pg.evaluate("""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const t=q.result.transaction('profile').objectStore('profile').get('me');t.onsuccess=()=>{q.result.close();r(t.result)}}})""")
    chk('个人资料母库未改动', prof['doc']['profile']['name']['zh']=='测试用户十八')
    chk('无页面报错；Key 不出现在页面', not errs and KEY not in pg.content())
    c.close()
print(f'{sum(ok)}/{len(ok)} passed'); raise SystemExit(0 if all(ok) else 1)
