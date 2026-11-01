# v1.9.1 信息丢失回归（浏览器端，全部模拟：资料虚构、Key 虚构、AI 接口被 Playwright 拦截）
import json, os, tempfile
from playwright.sync_api import sync_playwright
B=os.environ.get('E2E_BASE','http://localhost:4173/'); S=os.environ.get('SHOT_DIR','/workspace/resume-tool/screenshots/'); os.makedirs(S, exist_ok=True)
KEY='sk-FAKE-infoloss-0001'; ok=[]; reqs=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
BAD={'在公司使用设备测试':'使用设备测试','在医院与导师讨论耳镜设计':'讨论耳镜设计','协助维护实验台':'负责维护实验台','仅在室温条件下验证样机':'验证样机','样机尚未完成测试':'样机已完成测试','参与三人团队开发控制软件':'独立开发控制软件'}
BADEN={'协助维护自动化生产设备':'Led the maintenance of automated production equipment','参与开发数据采集软件':'Independently developed data acquisition software','预计2027年1月授予硕士学位':"Master's degree awarded in January 2027",'在车间使用设备测试':'Tested equipment','实习期间参与设备测试':'Participated in equipment testing during full-time employment','样机调试尚未完成':'Completed prototype debugging','协助整理实验数据':'Assisted in organizing experimental data'}
def ai_route(route):
    body=route.request.post_data or ''; reqs.append(body); u=json.loads(body)['messages'][-1]['content']
    if '已经导入的个人资料母库' not in u: return route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':'{"items":[]}'}}]}))
    out=[]
    for x in json.loads(u[u.rfind('{"items"'):])['items']:
        zh=x['zh']
        for k,v in BAD.items():
            if k in zh: zh=zh.replace(k,v)
        en=x['en'] or ''
        for k,v in BADEN.items():
            if k in zh: en=v
        out.append({'key':x['key'],'category':'resume','zh':zh,'en':en,'notes':[],'archive':[],'uncertain':[]})
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':json.dumps({'items':out},ensure_ascii=False)}}]}))
B1=lambda i,zh: {'id':f'b{i}','zh':zh+'实际职责以本人核实为准。','status':{'zh':'manual'},'source':'zh'}
DOC={'profile':{'name':{'zh':'测试用户十'},'email':'t10@example.com','summary':{}},'education':[{'id':'ed1','school':{'zh':'示例海事大学'},'degree':{'zh':'学士'},'major':{'zh':'轮机工程'},'start':'2019-09','end':'2023-06','highlights':[]}],
 'work':[{'id':'w1','company':{'zh':'示例测控公司'},'title':{'zh':'测试实习生'},'kind':'internship','start':'2024-07','end':'2024-09','link':'https://example.com/w','bullets':[B1(1,'我在公司使用设备测试。'),B1(2,'在医院与导师讨论耳镜设计。'),B1(3,'协助维护实验台。'),B1(4,'仅在室温条件下验证样机。'),B1(5,'样机尚未完成测试。'),B1(6,'参与三人团队开发控制软件。')]}],
 'projects':[],'skills':[],'certificates':[],'awards':[],'customSections':[]}
DUMP="""s=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(s).objectStore(s).getAll();t.onsuccess=()=>{db.close();r(t.result)}}})"""
SEED="""([k,doc])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','profile'],'readwrite');
  t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:k,model:'deepseek-flash',visionModel:'',translateModel:'',uiLang:'zh',provider:'deepseek',ocrMode:'local',setupDone:true});
  t.objectStore('profile').put({id:'me',doc,updatedAt:Date.now()});t.oncomplete=()=>{db.close();r()}}})"""
def prof(pg): return [x for x in pg.evaluate(DUMP,'profile') if x['id']=='me'][0]['doc']
with sync_playwright() as p:
    c=p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='chrome-p15-'), executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':1366,'height':900})
    pg=c.pages[0]; errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); c.route('https://api.deepseek.com/**', ai_route)
    pg.goto(B); pg.wait_for_timeout(1000); pg.evaluate(SEED,[KEY,DOC]); pg.goto(B+'#profile'); pg.reload(); pg.wait_for_selector('[data-testid=organize-start]')
    chk('三类状态分开显示', all(pg.locator(f'[data-testid={t}]').count()==1 for t in ['st-clean','st-fact','st-trans']))
    pg.screenshot(path=S+'p15_status_before.png')
    pg.click('[data-testid=organize-start]'); pg.wait_for_selector('[data-testid=organize-ask]'); pg.click('[data-testid=organize-ai]'); pg.wait_for_selector('[data-testid=organize-review]', timeout=30000)
    hi=pg.locator('[data-testid=org-high]'); rj=pg.locator('[data-testid=organize-rejected]'); rj.locator('summary').click(); ht=rj.inner_text()
    rn=int(pg.locator('[data-testid=stat-rejected]').inner_text().split('：')[1].split(' ')[0])
    chk(f'v1.9.3：6 个丢失 / 改变事实的 AI 改写重试后仍不完整 → 全部拒绝（拒绝 {rn} 条，需要审核 {hi.count()} 条）', rn==6 and hi.count()==0)
    chk('重试请求带上了具体丢失的事实（lostFacts）', any('lostFacts' in b for b in reqs))
    chk('拒绝列表显示参与程度 / 团队 / 条件 / 时间状态原因', all(k in ht for k in ['参与程度','团队','室温','尚未']))
    rj.scroll_into_view_if_needed(); pg.screenshot(path=S+'p15_btype_loss.png')
    pg.click('[data-testid=organize-accept-all]'); pg.click('[data-testid=organize-apply]'); pg.wait_for_selector('[data-testid=organize-done]')
    d=prof(pg); zs=[b['zh'] for b in d['work'][0]['bullets']]; print('  after:', zs)
    chk('批量接受只写入安全版本：在公司 / 医院 / 导师 / 协助 / 仅室温 / 尚未 / 三人团队 全部保留', zs[0].startswith('在公司使用设备测试') and all(k in ''.join(zs) for k in ['医院','导师','协助','仅在室温','尚未','参与三人团队']) and '独立' not in ''.join(zs) and '负责' not in ''.join(zs))
    chk('第一人称已去掉', not zs[0].startswith('我'))
    chk('ID、链接、专业不变', [b['id'] for b in d['work'][0]['bullets']]==[f'b{i}' for i in range(1,7)] and d['work'][0]['link']=='https://example.com/w' and d['education'][0]['major']['zh']=='轮机工程')
    pg.screenshot(path=S+'p15_after_apply.png')
    n=len(reqs); pg.click('[data-testid=organize-start]'); pg.wait_for_selector('[data-testid=organize-ask]')
    chk('有「重新检查已拒绝建议」按钮', pg.locator('[data-testid=organize-recheck]').count()==1)
    pg.click('[data-testid=organize-recheck]'); pg.wait_for_selector('[data-testid=organize-review]', timeout=30000)
    chk(f'重新检查：不重新导入即可再次送 AI（干净条目只补译），仍不产生 B 类（{pg.locator("[data-testid=org-high]").count()} 条）', len(reqs)>n and pg.locator('[data-testid=org-high]').count()==0)
    pg.screenshot(path=S+'p15_recheck.png'); pg.click('text=放弃（不写入）')
    # ---- v1.9.2 英文译文交叉核对 ----
    M=lambda i,zh: {'id':f't{i}','zh':zh,'en':'old machine text','status':{'zh':'manual','en':'stale'},'source':'zh'}
    D2=json.loads(json.dumps(DOC)); D2['work'][0]['bullets']=[M(1,'我协助维护自动化生产设备。实际职责以本人核实为准。'),M(2,'参与开发数据采集软件。'),M(3,'在车间使用设备测试。'),M(4,'实习期间参与设备测试。'),M(5,'样机调试尚未完成。'),M(6,'预计2027年1月授予硕士学位。'),M(7,'协助整理实验数据。')]
    pg.evaluate(SEED,[KEY,D2]); pg.goto(B+'#profile'); pg.reload(); pg.wait_for_selector('[data-testid=organize-start]')
    pg.click('[data-testid=organize-start]'); pg.wait_for_selector('[data-testid=organize-ask]'); pg.click('[data-testid=organize-ai]'); pg.wait_for_selector('[data-testid=organize-review]', timeout=30000)
    hi=pg.locator('[data-testid=org-high]'); rj=pg.locator('[data-testid=organize-rejected]'); rj.locator('summary').click(); ht=rj.inner_text()
    chk(f'6 条错误英文译文全部被拒绝（保持原文），不进入 B 类（{ht.count("译文待核对")} 条 / B {hi.count()}）', ht.count('译文待核对')>=6 and hi.count()==0)
    chk('原因覆盖参与程度 / 预计授予 / 公司或车间 / 实习全职 / 未完成', all(k in ht for k in ['参与程度','预计','车间','全职','否定']))
    chk('正确译文（协助→Assisted）为 A 类', any('Assisted in organizing experimental data' in pg.locator('[data-testid=org-safe]').nth(i).text_content() for i in range(pg.locator('[data-testid=org-safe]').count())))
    rj.scroll_into_view_if_needed(); pg.screenshot(path=S+'p15_en_crosscheck.png')
    pg.click('[data-testid=organize-accept-all]'); pg.click('[data-testid=organize-apply]'); pg.wait_for_selector('[data-testid=organize-done]')
    bs=prof(pg)['work'][0]['bullets']; print('  after2:', [(b['zh'],b.get('en')) for b in bs])
    chk('英文有风险时中文安全清洗照常写入', bs[0]['zh']=='协助维护自动化生产设备。')
    chk('错误英文一条也没写入', all(b.get('en')=='old machine text' for b in bs[:6]) and bs[6]['en']=='Assisted in organizing experimental data')
    # ---- v1.9.3 可用性：案例 A–D、只删「曾」、五类数量 ----
    CA='完成项目交付成果：硬件原型、Windows 软件、展示照片、视频、完整 Demo、GitHub 项目和技术报告。'; CB='原型核心材料估算成本约22美元，不代表经过验证的量产成本或零售价。'
    CC='历史平均分约77/100，GPA约2.7/4.0，属于历史估算，并非官方成绩单计算结果。'; CD='与示例医院医生讨论过可变焦需求，尚未实现可变焦功能。'; KFC='本科期间曾在肯德基兼职。'
    BAD.clear(); BAD.update({'、展示照片、视频、完整 Demo、GitHub 项目':'',CB:'产品成本仅22美元。','，属于历史估算，并非官方成绩单计算结果':'','讨论过可变焦需求，尚未实现可变焦功能':'实现了可变焦功能','曾在':'在'}); BADEN.clear()
    E=lambda i,zh: {'id':f'c{i}','zh':zh,'en':'Machine translation.','status':{'zh':'manual','en':'machine'},'source':'zh'}
    D3=json.loads(json.dumps(DOC)); D3['work'][0]['bullets']=[E(i,x) for i,x in enumerate([CA,CB,CC,CD,KFC]+[x+'实际职责以本人核实为准。' for x in [CA,CB,CC,CD,KFC]]+['我在实验室搭建数据采集流程。'])]
    pg.evaluate(SEED,[KEY,D3]); pg.goto(B+'#profile'); pg.reload(); pg.wait_for_selector('[data-testid=organize-start]'); n=len(reqs)
    pg.click('[data-testid=organize-start]'); pg.wait_for_selector('[data-testid=organize-ask]'); pg.click('[data-testid=organize-ai]'); pg.wait_for_selector('[data-testid=organize-review]', timeout=30000)
    sent=len({x['zh'] for b in reqs[n:] if '已经导入的个人资料母库' in b for x in json.loads(json.loads(b)['messages'][-1]['content'][json.loads(b)['messages'][-1]['content'].rfind('{"items"'):])['items']})
    num=lambda t: int(pg.locator(f'[data-testid={t}]').inner_text().split('：')[1].split(' ')[0])
    st={t:num(t) for t in ['stat-meta','stat-improved','stat-unchanged','stat-rejected','stat-review']}; print('  stats:', st, 'sent', sent)
    chk(f'干净条目（A–D 原句 + 肯德基）不发送 AI、计为无需修改（发送 {sent} 条，无需修改 {st["stat-unchanged"]}）', st['stat-unchanged']>=5 and sent<=6)
    chk(f'五类数量：说明 5 / 改善 1 / 拒绝 4 / 需要审核 0（{st}）', st['stat-meta']==5 and st['stat-improved']==1 and st['stat-rejected']==4 and st['stat-review']==0)
    pg.locator('[data-testid=organize-stats]').scroll_into_view_if_needed(); pg.screenshot(path=S+'p17_organize_counts.png')
    rj=pg.locator('[data-testid=organize-rejected]'); rj.locator('summary').click(); rj.scroll_into_view_if_needed(); pg.screenshot(path=S+'p17_organize_rejected.png')
    pg.click('[data-testid=organize-accept-all]'); pg.click('[data-testid=organize-apply]'); pg.wait_for_selector('[data-testid=organize-done]')
    zs=[b['zh'] for b in prof(pg)['work'][0]['bullets']]; print('  after3:', zs)
    chk('案例 A–D 与肯德基：干净版原样、脏版只去说明句，全部事实保留', zs[:5]==[CA,CB,CC,CD,KFC] and zs[5:10]==[CA,CB,CC,CD,KFC] and zs[10]=='在实验室搭建数据采集流程。')
    chk('没有写入「产品成本仅」「实现了可变焦」或删掉「曾」', not any(k in ''.join(zs) for k in ['产品成本仅','实现了可变焦']) and ''.join(zs).count('曾在肯德基')==2)
    pg.screenshot(path=S+'p17_organize_after.png')
    chk('API Key 不出现在页面', KEY not in pg.content()); chk(f'无页面错误 {errs[:2]}', not errs)
    c.close()
print(f'{sum(ok)}/{len(ok)} passed')
