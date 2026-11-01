# v1.11 岗位分析历史 → 求职管理（浏览器端；资料、岗位全部虚构；不调用真实 AI）
import json, os, tempfile
from playwright.sync_api import sync_playwright
B=os.environ.get('E2E_BASE','http://localhost:4173/'); S=os.environ.get('SHOT_DIR','/workspace/resume-tool/screenshots/'); os.makedirs(S, exist_ok=True)
ok=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
def job(i,company,title,days):
    return {'id':f'jobx-{i}','createdAt':f'2026-10-{days:02d}T08:00:00.000Z','rawText':f'{company} {title} 岗位职责：负责结构设计。任职要求：SolidWorks。','jdLanguage':'zh',
            'company':{'full':company,'short':company},'roleAbbr':'ME','title':{'zh':title,'en':''},'mustHave':[{'zh':'SolidWorks','en':'SolidWorks'}],'niceToHave':[],
            'yearsRequired':None,'keywords':[],'summary':'','responsibilities':[{'zh':'负责结构设计','en':'structural design'}]}
JOBS=[job(1,'虚构电机科技','机械设计工程师',20), job(2,'虚构视觉科技','成像测试工程师',21), job(3,'虚构机器人','机器人应用工程师',22)]
OLD={'id':'job-old-1','company':'虚构视觉科技','title':'成像测试工程师','city':'苏州','priority':2,'source':{'kind':'manual'},'notes':'旧版手动记录','createdAt':'2026-09-01T00:00:00.000Z','updatedAt':'2026-09-01T00:00:00.000Z'}
OLDAPP={'id':'app-old-1','postingId':'job-old-1','status':'applied','appliedAt':'2026-09-02T00:00:00.000Z','todos':[],'interviews':[],'source':{'kind':'manual'},'createdAt':'2026-09-02T00:00:00.000Z','updatedAt':'2026-09-02T00:00:00.000Z'}
DOC={'profile':{'name':{'zh':'测试用户二十'},'email':'t20@example.com','summary':{}},'education':[],'work':[],'projects':[],'skills':[],'certificates':[],'awards':[],'customSections':[]}
SEED="""([doc,jobs,old,oldApp])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','profile','jobs','postings','applications'],'readwrite');
  t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:'sk-FAKE-v111-0001',model:'deepseek-flash',visionModel:'',translateModel:'',uiLang:'zh',provider:'deepseek',ocrMode:'local',setupDone:true});
  t.objectStore('profile').put({id:'me',doc,updatedAt:Date.now()}); jobs.forEach(j=>t.objectStore('jobs').put(j)); t.objectStore('postings').put(old); t.objectStore('applications').put(oldApp);
  t.oncomplete=()=>{db.close();r()}}})"""
with sync_playwright() as p:
    c=p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='chrome-v111-'), executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':1366,'height':900})
    pg=c.pages[0]; errs=[]; dialogs=[]; answers=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    def on_dialog(d):
        dialogs.append(d.message); (d.accept() if (answers.pop(0) if answers else True) else d.dismiss())
    pg.on('dialog', on_dialog)
    c.route('https://api.deepseek.com/**', lambda r: r.abort())
    pg.goto(B); pg.wait_for_timeout(800); pg.evaluate(SEED,[DOC,JOBS,OLD,OLDAPP]); pg.evaluate("localStorage.setItem('wizardStep','2')"); pg.goto(B+'#wizard'); pg.reload()
    pg.wait_for_selector('[data-testid=job-history]')
    h=pg.locator('[data-testid=job-history]').inner_text()
    chk('历史改名为「岗位分析历史 / 制作历史」并显示 3 条', '岗位分析历史 / 制作历史（3）' in h and '投递记录' not in h)
    chk('说明历史不等于已投递', '不等于已投递' in h)
    row=lambda name: pg.locator('[data-testid=job-history] li', has_text=name)
    row('虚构电机科技').locator('[data-testid=history-track]').click()
    pg.wait_for_selector('[data-testid=history-msg]')
    chk('加入求职管理成功，默认待投递', '待投递' in pg.locator('[data-testid=history-msg]').inner_text())
    chk('列表显示已在求职管理（待投递）', row('虚构电机科技').locator('[data-testid=history-tracked]').inner_text().startswith('已在求职管理（待投递）'))
    pg.screenshot(path=S+'v111_history.png')
    # 同公司同岗位：先提示；选择「关联到已有」不改已有内容、不新建
    answers[:]=[True]; row('虚构视觉科技').locator('[data-testid=history-track]').click(); pg.wait_for_timeout(500)
    chk('同公司同岗位提示重复', any('已有「虚构视觉科技 · 成像测试工程师」' in d for d in dialogs))
    chk('关联到已有记录后显示原状态（已投递）', '已投递' in row('虚构视觉科技').locator('[data-testid=history-tracked]').inner_text())
    # 第三条：取消关联 + 取消新建 → 不创建
    pg.locator('[data-testid=nav-applications]').click(); pg.wait_for_selector('[data-testid=applications-page]')
    st={k:pg.locator(f'[data-testid={k}] .n').inner_text() for k in ['st-postings','st-pending','st-applied','st-waiting']}
    chk(f'统计：岗位 2、待投递 1、已投递 1（旧记录），待投递不计入已投递 {st}', st=={'st-postings':'2','st-pending':'1','st-applied':'1','st-waiting':'1'})
    pg.reload(); pg.wait_for_selector('[data-testid=applications-page]')
    chk('刷新后仍保留', pg.locator('[data-testid=st-pending] .n').inner_text()=='1' and pg.locator('[data-testid=st-postings] .n').inner_text()=='2')
    pg.locator('[data-testid=posting-row]', has_text='虚构电机科技').locator('[data-testid=open-posting]').click(); pg.wait_for_selector('[data-testid=posting-detail]')
    d=pg.locator('[data-testid=posting-detail]').inner_text()
    chk('岗位详情：来源为岗位分析历史，城市未猜测', '岗位分析历史' in d and '📍' not in d)
    pg.locator('[data-testid=open-analysis]').click(); pg.wait_for_timeout(600)
    chk('反向链接回到岗位分析（向导页）', pg.evaluate('location.hash')=='#wizard')
    pg.locator('[data-testid=nav-applications]').click(); pg.wait_for_selector('[data-testid=applications-page]'); pg.locator('[data-testid=posting-row]', has_text='虚构视觉科技').locator('[data-testid=open-posting]').click(); pg.wait_for_selector('[data-testid=posting-detail]')
    d=pg.locator('[data-testid=posting-detail]').inner_text()
    chk('旧数据（无 jobParseId 的手动记录）字段未被改写', '苏州' in d and '旧版手动记录' in d)
    cnt=pg.evaluate("""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['jobs','postings','applications']);const o={};let n=0;
      ['jobs','postings','applications'].forEach(s=>{const c=t.objectStore(s).count();c.onsuccess=()=>{o[s]=c.result;if(++n==3){db.close();r(o)}}})}})""")
    chk(f'岗位分析记录未删除，求职记录未重复 {cnt}', cnt=={'jobs':3,'postings':2,'applications':2})
    chk('无页面错误', not errs)
    c.close()
print(f'{sum(ok)}/{len(ok)} passed'); exit(0 if all(ok) else 1)
