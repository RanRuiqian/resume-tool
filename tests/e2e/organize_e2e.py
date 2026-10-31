# v1.9「AI 整理现有资料」+ 首次导入质量检查 浏览器端到端（全部为模拟：资料虚构，Key 虚构，AI 接口被 Playwright 拦截，不访问真实服务商）
import json, os, tempfile, re
from playwright.sync_api import sync_playwright
B=os.environ.get('E2E_BASE','http://localhost:4173/'); S=os.environ.get('SHOT_DIR','/workspace/resume-tool/screenshots/'); os.makedirs(S, exist_ok=True)
FX=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','fixtures')
LEGACY=json.load(open(os.path.join(FX,'legacy-polluted.json')))
KEY='sk-FAKE-organize-0001'
BANNED=['实际职责以本人核实为准','具体情况请自行确认','该经历可能适用于某些岗位','这可以作为求职材料','建议在简历中强调','尚需补充相关证据','本人实际掌握程度有待确认','以上信息仅供参考']
ok=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
mode={'v':'ok'}; reqs=[]
def ai_route(route):
    r=route.request; body=r.post_data or ''; reqs.append(body)
    msgs=json.loads(body)['messages'] if body else []
    u=msgs[-1]['content'] if msgs else ''
    if '已经导入的个人资料母库' in u:
        if mode['v']=='fail': return route.fulfill(status=500, content_type='application/json', body='{"error":{"message":"mock server error"}}')
        items=json.loads(u[u.rfind('{"items"'):])['items']; out=[]
        for x in items:
            zh=x['zh']; en=x['en'] or ''
            if '第1轮测试' in zh: zh='作为全职工程师'+zh   # 模拟 AI 夸大 → 必须成为高风险
            out.append({'key':x['key'],'category':'resume','zh':zh,'en':en+(' 以上信息仅供参考。' if '第2轮' in zh else ''),'notes':[],'archive':[],'uncertain':[]})
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':json.dumps({'items':out},ensure_ascii=False)}}]}))
    if '严谨的简历整理助手' in u or '严谨的简历整理助手' in body:
        seg={'lang':'zh','name':'测试用户九','email':'t9@example.com','work':[{'company':'示例测控公司','title':'测试实习生','kind':'internship','start':'2024-07','end':'2024-09','bullets':['我在公司使用设备进行测试。实际职责以本人核实为准。','这可以作为求职材料。']}],
             'education':[{'school':'示例理工大学','degree':'硕士','major':'机械工程','start':'2025-09','end':'2027-01','expectedConferralDate':'2027-01'}],
             'projects':[{'name':'课程实验：夹具设计','kind':'auxiliary','nature':'课程实验','start':'2025-10','end':'2025-12','bullets':['完成夹具三维建模。'],'archive':['第一版方案因刚度不足失败。']}]}
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':json.dumps(seg,ensure_ascii=False)}}]}))
    return route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':'{"items":[]}'}}]}))
DUMP="""s=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(s).objectStore(s).getAll();t.onsuccess=()=>{db.close();r(t.result)}}})"""
def prof(pg): return [x for x in pg.evaluate(DUMP,'profile') if x['id']=='me'][0]['doc']
def resume_text(d): return json.dumps([d['profile']['summary']]+[b for w in d['work']+d['projects'] for b in w['bullets']]+[h for e in d['education'] for h in e['highlights']]+[s['name'] for s in d['skills']],ensure_ascii=False)
SEED="""([k,doc])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','profile'],'readwrite');
  t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:k,model:'deepseek-flash',visionModel:'',translateModel:'',uiLang:'zh',provider:'deepseek',ocrMode:'local',setupDone:true});
  if(doc)t.objectStore('profile').put({id:'me',doc,updatedAt:Date.now()});else t.objectStore('profile').delete('me');t.oncomplete=()=>{db.close();r()}}})"""
with sync_playwright() as p:
    c=p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='chrome-p14-'), executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':1366,'height':900})
    pg=c.pages[0]; errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    c.route('https://api.deepseek.com/**', ai_route)
    pg.goto(B); pg.wait_for_timeout(1200)
    pg.evaluate(SEED,[KEY,LEGACY]); pg.goto(B+'#profile'); pg.reload(); pg.wait_for_selector('[data-testid=organize-start]')
    orig=prof(pg); orig_s=json.dumps(orig,sort_keys=True)
    chk('前置：旧版污染资料 2/7/14/29/2/5', [len(orig[k]) for k in ['education','work','projects','skills','certificates','awards']]==[2,7,14,29,2,5])
    rs=pg.locator('[data-testid=review-summary]').inner_text()
    chk(f'机翻改为非阻塞汇总：{rs.splitlines()[0][:60]}', '可直接用于求职' in rs and '逐条确认' not in pg.locator('main').inner_text())
    pg.screenshot(path=S+'p14_profile_before.png')
    # ---- 点击 → 快照 + 本地检查 + AI 提示，尚未调用 AI ----
    pg.click('[data-testid=organize-start]'); pg.wait_for_selector('[data-testid=organize-ask]')
    ask=pg.locator('[data-testid=organize-ask]').inner_text()
    chk(f'点击后先保存快照并显示本地检查（{re.search(r"说明性语句 \d+ 处",ask).group(0) if re.search(r"说明性语句 \d+ 处",ask) else ask[:40]}）', '已自动保存整理前快照' in ask and re.search(r'说明性语句 [1-9]\d* 处',ask) is not None)
    chk('调用 AI 前明确提示发送到 api.deepseek.com', 'api.deepseek.com' in pg.locator('[data-testid=organize-ai-notice]').inner_text())
    chk('此时尚未调用 AI', len(reqs)==0)
    backups=pg.evaluate(DUMP,'backups'); chk(f'快照已写入（{len(backups)} 份）', any('AI 整理现有资料前' in b['reason'] for b in backups))
    chk('API Key 不出现在页面', KEY not in pg.content())
    pg.screenshot(path=S+'p14_organize_ask.png')
    # ---- 失败：资料不变，错误清楚 ----
    mode['v']='fail'; pg.click('[data-testid=organize-ai]'); pg.wait_for_selector('[data-testid=organize-error]', timeout=30000)
    er=pg.locator('[data-testid=organize-error]').inner_text()
    chk(f'AI 失败：显示错误「{er[:40]}…」', '资料没有任何改动' in er)
    chk('AI 失败：资料库完全未变', json.dumps(prof(pg),sort_keys=True)==orig_s)
    pg.screenshot(path=S+'p14_organize_error.png')
    # ---- 成功：分批 + 报告 + 对比 ----
    mode['v']='ok'; n0=len(reqs); pg.click('[data-testid=organize-ai]'); pg.wait_for_selector('[data-testid=organize-review]', timeout=60000)
    calls=len(reqs)-n0
    chk(f'分批调用 AI（{calls} 批，每批 ≤20 条）', calls>=2 and all(len(json.loads(json.loads(b)['messages'][-1]['content'][json.loads(b)['messages'][-1]['content'].rfind('{"items"'):])['items'])<=20 for b in reqs[n0:]))
    chk('AI 请求不含照片 / 手机号 / 邮箱字段', all('"phone"' not in b and 'photo' not in b for b in reqs[n0:]))
    chk('预览阶段资料未写入', json.dumps(prof(pg),sort_keys=True)==orig_s)
    rep=pg.locator('[data-testid=organize-report]').inner_text(); print('  report:', rep.replace('\n',' | '))
    hi=pg.locator('[data-testid=org-high]'); sf=pg.locator('[data-testid=org-safe]')
    chk(f'高风险单独列出且默认不勾选（{hi.count()} 条）', hi.count()>=1 and all(not hi.nth(i).locator('input').is_checked() for i in range(hi.count())))
    chk('AI 加「全职」被列为高风险并说明原因', '全职' in pg.locator('.org-group.high').inner_text())
    chk(f'安全修正默认勾选（{sf.count()} 条），显示修改前 / 后与原因', sf.count()>=20 and '修改前' in sf.first.text_content() and '原因' in sf.first.text_content())
    pg.screenshot(path=S+'p14_organize_review.png')
    pg.locator('.org-group.high').scroll_into_view_if_needed(); pg.screenshot(path=S+'p14_organize_highrisk.png')
    pg.click('[data-testid=organize-accept-all]'); pg.click('[data-testid=organize-apply]'); pg.wait_for_selector('[data-testid=organize-done]')
    d=prof(pg); rt=resume_text(d)
    chk('写入后简历要点不含任何说明套话', not any(b in rt for b in BANNED))
    chk('说明句移入 notes，没有删除', '实际职责以本人核实为准' in json.dumps([w.get('notes',[]) for w in d['work']],ensure_ascii=False))
    chk('第一人称已去掉', '"我在公司' not in rt and '"zh": "我' not in rt)
    chk('高风险（全职）未自动写入', '全职' not in rt)
    chk('AI 输出里夹带的说明句被独立检测移出', '仅供参考' not in rt)
    chk('条目 ID 全部保留', [w['id'] for w in d['work']]==[w['id'] for w in orig['work']] and [x['id'] for x in d['projects']]==[x['id'] for x in orig['projects']])
    chk('失败方案进入项目档案', any(x.get('dossier',{}).get('failedAttempts') for x in d['projects']))
    chk('未自动设置 userConfirmedAt', all(not e.get('userConfirmedAt') for k in ['work','projects','education'] for e in d[k]))
    chk('预计授予日期不变、实际授予仍为空', d['education'][1].get('expectedConferralDate')=='2027-01' and not d['education'][1].get('actualConferralDate'))
    pg.screenshot(path=S+'p14_organize_done.png')
    # ---- 幂等：再次整理不再调用 AI、没有新建议 ----
    n1=len(reqs); pg.click('[data-testid=organize-start]'); pg.wait_for_selector('[data-testid=organize-ask]'); pg.click('[data-testid=organize-ai]'); pg.wait_for_selector('[data-testid=organize-review]', timeout=30000)
    rep2=pg.locator('[data-testid=organize-report]').inner_text(); print('  report2:', rep2.replace('\n',' | '))
    chk(f'幂等：第二次只剩用户没接受的高风险项、AI 调用 {len(reqs)-n1} 次', len(reqs)-n1<=1 and pg.locator('[data-testid=org-safe]').count()==0)
    pg.click('text=放弃（不写入）')
    # ---- 恢复快照 ----
    pg.on('dialog', lambda dl: dl.accept())
    pg.click('[data-testid=organize-start]'); pg.wait_for_selector('[data-testid=organize-ask]')
    bks=sorted(pg.evaluate(DUMP,'backups'), key=lambda b:b['createdAt'])
    first=[b for b in bks if 'AI 整理现有资料前' in b['reason']][0]
    T=lambda x: json.dumps([[b.get('zh'),b.get('en')] for w in x['work']+x['projects'] for b in w['bullets']]+[[s['name'].get('zh')] for s in x['skills']],ensure_ascii=False)
    chk('最早的整理前快照与原始资料内容一致', T(first['doc'])==T(orig) and [w['id'] for w in first['doc']['work']]==[w['id'] for w in orig['work']])
    snap_s=json.dumps(first['doc'],sort_keys=True)
    pg.click('text=取消')
    pg.locator('details.backups summary').click(); pg.wait_for_timeout(400)
    pg.locator('details.backups tr', has_text='AI 整理现有资料前').last.locator('button').click(); pg.wait_for_timeout(800)
    chk('从快照恢复后资料与整理前快照完全一致', json.dumps(prof(pg),sort_keys=True)==snap_s)
    # ---- 机翻批量确认：只在用户勾选后才改 ----
    m0=json.dumps(prof(pg)).count('"machine"')
    pg.locator('[data-testid=review-machine] summary').click(); pg.wait_for_timeout(300)
    pg.locator('[data-testid=review-machine] label.check input').first.check(); pg.click('[data-testid=review-confirm-machine]'); pg.wait_for_timeout(800)
    chk(f'机翻批量校对：勾选 1 条确认后 machine {m0}→{json.dumps(prof(pg)).count(chr(34)+"machine"+chr(34))}', json.dumps(prof(pg)).count('"machine"')==m0-1)
    pg.screenshot(path=S+'p14_review_summary.png')
    # ---- 首次导入执行同样的质量检查 ----
    pg.evaluate(SEED,[KEY,None]); pg.goto(B+'#profile'); pg.reload(); pg.wait_for_selector('[data-testid=smart-import]')
    f=os.path.join(tempfile.mkdtemp(),'fictional_profile.txt'); open(f,'w').write('测试用户九 t9@example.com\n示例测控公司 测试实习生 2024-07 至 2024-09\n我在公司使用设备进行测试。实际职责以本人核实为准。这可以作为求职材料。\n示例理工大学 硕士 机械工程 2025-09 至 2027-01 预计2027年1月授予硕士学位\n课程实验：夹具设计 2025-10 至 2025-12 完成夹具三维建模。第一版方案因刚度不足失败。\n')
    pg.set_input_files('[data-testid=smart-file]', f); pg.wait_for_selector('[data-testid=file-card] .fc-status:has-text("已在本地提取")')
    pg.click('[data-testid=smart-run]'); pg.wait_for_selector('[data-testid=import-review]', timeout=30000)
    pg.screenshot(path=S+'p14_import_review.png')
    und=pg.locator('[data-testid=imp-item].undecided')
    while und.count(): und.first.locator('[data-testid=imp-action]').select_option(index=0); pg.wait_for_timeout(150)
    pg.click('[data-testid=import-confirm]'); pg.wait_for_timeout(1500)
    d=prof(pg); w=d['work'][0]; wt=json.dumps(w['bullets'],ensure_ascii=False)
    chk(f'首次导入：要点已去掉套话和「我」：{[b["zh"] for b in w["bullets"]]}', not any(b in wt for b in BANNED) and '我在' not in wt and '在公司使用设备进行测试' in wt)
    chk('首次导入：说明句进入 notes', '实际职责以本人核实为准' in json.dumps(w.get('notes',[]),ensure_ascii=False))
    chk('首次导入：预计学位不变为实际', d['education'][0].get('expectedConferralDate')=='2027-01' and not d['education'][0].get('actualConferralDate'))
    chk('首次导入：课程实验保持辅助 / 课程实验，失败方案进入档案', d['projects'][0].get('nature')=='课程实验' and (d['projects'][0].get('dossier') or {}).get('failedAttempts'))
    chk('首次导入：实习未变成全职', w.get('kind')=='internship')
    pg.screenshot(path=S+'p14_import_done.png')
    pg.set_viewport_size({'width':390,'height':844}); pg.click('[data-testid=organize-start]'); pg.wait_for_selector('[data-testid=organize-ask]')
    chk('390px：无横向溢出', pg.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
    pg.screenshot(path=S+'p14_organize_390.png')
    chk(f'无页面错误 {errs[:2]}', not errs)
    c.close()
print(f'\n{sum(ok)}/{len(ok)} passed'); exit(0 if all(ok) else 1)
