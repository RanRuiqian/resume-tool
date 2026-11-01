# v1.10.1 求职信/自我介绍逐句事实核对：失败时不保存、显示原因、保留旧文本、导出拦截、人工核对后放行（全部模拟：虚构资料、虚构 Key、AI 接口被 Playwright 拦截）
import json, os, tempfile
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); B=os.environ.get('E2E_BASE','http://localhost:4173/')
S=os.environ.get('SHOT_DIR','/workspace/resume-tool/screenshots/'); os.makedirs(S, exist_ok=True)
d=json.load(open(os.path.join(HERE,'..','fixtures','e2e-seed.json')))  # 虚构资料
KEY='sk-FAKE-v1101-kit-0001'; ok=[]; calls={'n':0}
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
OLD={'zh':'【我手动改过的旧求职信】负责开发工业视觉检测程序。','en':'[My hand-edited old letter]'}
BAD={'coverLetter':{'zh':'尊敬的招聘负责人：我精通 PyTorch，并主导了缺陷检测流程在工厂产线的现场部署。我已毕业于模拟理工大学。此致敬礼','en':'Dear Hiring Manager, I am proficient in PyTorch and led the on-site production deployment of the defect detection pipeline. Sincerely'},
     'selfIntro':{'zh':'大家好，我精通 PyTorch，主导过产线部署。','en':'Hi, I am proficient in PyTorch and led a production deployment.'}}
def ai(route):
    calls['n']+=1; route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':json.dumps(BAD,ensure_ascii=False)}}]}))
def seed(extras):
    r=dict(d['resume']); r['extras']=extras; return {**d,'resume':r}
SEED="""([k,d])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','profile','jobs','resumes','state'],'readwrite');
  t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:k,model:'deepseek-chat',visionModel:'',translateModel:'',uiLang:'zh',provider:'deepseek',ocrMode:'local',setupDone:true});
  t.objectStore('profile').put({id:'me',doc:d.profile});t.objectStore('jobs').put(d.job);t.objectStore('resumes').put(d.resume);
  t.objectStore('state').put({id:'jobId',value:d.job.id});t.objectStore('state').put({id:'resumeId',value:d.resume.id});t.oncomplete=()=>{db.close();r()}}})"""
GET="""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction('resumes').objectStore('resumes').getAll();t.onsuccess=()=>{db.close();r(t.result[0])}}})"""
with sync_playwright() as p:
    c=p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='chrome-kit-'), executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':1280,'height':1000})
    pg=c.pages[0]; errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda x: x.accept()); c.route('https://api.deepseek.com/**', ai)
    def load(extras):
        pg.goto(B); pg.wait_for_timeout(600); pg.evaluate(SEED,[KEY,seed(extras)]); pg.evaluate("localStorage.setItem('wizardStep','4')"); pg.goto(B+'#wizard'); pg.reload(); pg.wait_for_selector('text=求职信 + 1 分钟自我介绍')
    load({'coverLetter':OLD,'selfIntro':OLD})
    pg.get_by_role('button', name='求职信 + 1 分钟自我介绍').click(); pg.wait_for_selector('[data-testid=kit-blocked]', timeout=20000)
    reasons=pg.locator('[data-testid=kit-blocked-reasons] li').all_inner_texts()
    chk('AI 两次都写出无法追溯的内容 → 显示「事实检查未通过，需人工核对」', '事实检查未通过' in pg.locator('[data-testid=kit-blocked]').inner_text())
    chk(f'重试 1 次（共 {calls["n"]} 次调用）', calls['n']==2)
    chk(f'列出逐句原因（{len(reasons)} 条），含 PyTorch / 部署 / 毕业', len(reasons)>=3 and any('PyTorch' in x for x in reasons) and any('部署' in x or '现场' in x for x in reasons))
    chk('逐句明细表可展开', pg.locator('[data-testid=kit-trace]').count()>=1)
    pg.screenshot(path=S+'p19_kit_blocked.png', full_page=True)
    ex=pg.evaluate(GET)['extras']
    chk('未通过的结果没有保存，旧（手改）文本保留', ex['coverLetter']==OLD and ex['selfIntro']==OLD)
    chk('没有可用精简版时不显示「采用精简版」', pg.locator('[data-testid=kit-use-safe]').count()==0)
    pg.click('[data-testid=kit-discard]'); pg.wait_for_timeout(300)
    chk('放弃后面板关闭', pg.locator('[data-testid=kit-blocked]').count()==0)
    # 已保存的文本本身无法核实（例如旧版本生成的）→ 导出拦截，人工核对后放行
    load({'coverLetter':BAD['coverLetter'],'selfIntro':BAD['selfIntro']})
    chk('已保存文本逐句核对未通过 → 状态提示', pg.locator('[data-testid=kit-status].warn').count()==1 or 'warn' in (pg.locator('[data-testid=kit-status]').get_attribute('class') or ''))
    chk('导出区提示求职信不会打包进 Word', pg.locator('[data-testid=export-kit-blocked]').count()==1)
    pg.screenshot(path=S+'p19_kit_export_blocked.png', full_page=True)
    pg.click('[data-testid=kit-override]'); pg.wait_for_timeout(400)
    rv=pg.evaluate(GET)['extras'].get('kitReview')
    chk('人工核对放行：保存 kitReview（含文本哈希），导出提示消失', rv and rv.get('textHash') and pg.locator('[data-testid=export-kit-blocked]').count()==0)
    pg.screenshot(path=S+'p19_kit_override.png', full_page=True)
    chk('无页面报错；Key 不出现在页面', not errs and KEY not in pg.content())
    c.close()
print(f'{sum(ok)}/{len(ok)} passed'); raise SystemExit(0 if all(ok) else 1)
