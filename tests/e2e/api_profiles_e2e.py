# 多 API 配置管理 浏览器端到端（全部为模拟：Key 均为虚构，AI 接口被 Playwright 拦截并模拟返回，不访问真实服务商）
import json, os, tempfile, re
from playwright.sync_api import sync_playwright
B=os.environ.get('E2E_BASE','http://localhost:4173/'); S=os.environ.get('SHOT_DIR','/workspace/resume-tool/screenshots/'); os.makedirs(S, exist_ok=True)
FX=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','fixtures'); SEED=json.load(open(os.path.join(FX,'e2e-seed.json')))
K={'ds1':'sk-FAKE-ds-main-0001','ds2':'sk-FAKE-ds-bak-0002','qw':'sk-FAKE-qwen-0003','oa':'sk-FAKE-openai-0004','cu':'FAKE-custom-0005',
   'bad':'sk-FAKE-BAD-0006','poor':'sk-FAKE-POOR-0007','net':'sk-FAKE-NET-0008','slow':'sk-FAKE-SLOW-0009','old':'sk-FAKE-legacy-0010'}
ALLK=list(K.values())
ok=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
reqs=[]
def ai_route(route):
    r=route.request; auth=r.headers.get('authorization',''); reqs.append({'url':r.url,'auth':auth,'body':r.post_data or ''})
    if 'NET' in auth: return route.abort('internetdisconnected')
    if 'SLOW' in auth: return route.abort('timedout') if False else None
    if 'BAD' in auth: return route.fulfill(status=401, body='{"error":{"message":"Authentication Fails"}}')
    if 'POOR' in auth: return route.fulfill(status=402, body='{"error":{"message":"Insufficient Balance"}}')
    return route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':'OK'}}]}))
SETS="""n=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction('settings').objectStore('settings').getAll();t.onsuccess=()=>{db.close();r(t.result)}}})"""
def settings(pg): return {x['id']:x for x in pg.evaluate(SETS)}
def cur(pg): return settings(pg).get('settings',{})
def items(pg): return pg.locator('[data-testid=api-item]')
def item(pg,name): return items(pg).filter(has=pg.locator('[data-testid=api-name]', has_text=re.compile('^'+re.escape(name)+'$')))
def no_key_visible(pg):
    t=pg.locator('body').inner_text(); vals=pg.evaluate("[...document.querySelectorAll('input')].filter(i=>i.type!=='password').map(i=>i.value).join('|')")
    return not any(k in t or k in vals for k in ALLK) and not any(k in pg.url for k in ALLK)
def add(pg, prov, name, key, url=None, model=None, cancel_ok=True):
    if pg.locator('[data-testid=api-add]').count(): pg.click('[data-testid=api-add]')
    f=pg.locator('[data-testid=api-form]'); f.locator(f'[data-testid=prov-{prov}]').click()
    f.locator('[data-testid=f-name]').fill(name); f.locator('[data-testid=f-key]').fill(key)
    if url is not None: f.locator('[data-testid=f-url]').fill(url)
    if model is not None: f.locator('[data-testid=f-model]').fill(model)
    f.locator('[data-testid=f-save]').click(); pg.wait_for_timeout(250)
logs=[]
with sync_playwright() as p:
    d=tempfile.mkdtemp(prefix='chrome-p7-')
    c=p.chromium.launch_persistent_context(d, executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':1280,'height':900})
    pg=c.pages[0]; errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: logs.append(m.text))
    for h in ['api.deepseek.com','dashscope.aliyuncs.com','api.openai.com','llm.example.com']: c.route(f'https://{h}/**', ai_route)
    # ---- 11 旧版设置迁移（模拟旧格式记录，含 deepseek-chat）----
    pg.goto(B); pg.wait_for_timeout(1200)
    pg.evaluate("""([k,doc])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','profile'],'readwrite');
      t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:k,model:'deepseek-chat',visionModel:'',translateModel:'',uiLang:'zh',provider:'deepseek',ocrMode:'local',setupDone:true});
      t.objectStore('profile').put({id:'me',doc,updatedAt:Date.now()});t.oncomplete=()=>{db.close();r()}}})""", [K['old'], SEED['profile']])
    pg.goto(B+'#settings'); pg.reload(); pg.wait_for_selector('[data-testid=api-manager]'); pg.wait_for_timeout(500)
    s=settings(pg); m=s['settings']
    chk('11 旧单套配置迁移为 1 条记录、Key/BaseURL 不丢、deepseek-chat→deepseek-flash、使用中', len(m['apiProfiles'])==1 and m['apiProfiles'][0]['apiKey']==K['old'] and m['apiProfiles'][0]['baseUrl']=='https://api.deepseek.com' and m['apiProfiles'][0]['model']=='deepseek-flash' and m['activeProfileId']==m['apiProfiles'][0]['id'] and items(pg).count()==1 and item(pg,'DeepSeek（原配置）').locator('[data-testid=api-active]').count()==1)
    chk('11 迁移前快照已保存（含原始模型名）', s.get('settings-premigrate-profiles-v1',{}).get('model')=='deepseek-chat')
    chk('列表只显示脱敏 Key', item(pg,'DeepSeek（原配置）').locator('[data-testid=api-key]').inner_text()=='sk-••••••0010' and no_key_visible(pg))
    chk('正式模式提示：会真实调用 AI', '真实发送' in pg.locator('[data-testid=ai-mode]').inner_text())
    # 删除旧配置 → 10 删除最后一个
    item(pg,'DeepSeek（原配置）').locator('[data-testid=api-del]').click()
    chk('删除需二次确认（弹窗含名称与提示）', pg.locator('[data-testid=del-dialog]').count()==1 and '确定删除「DeepSeek（原配置）」' in pg.locator('[data-testid=del-dialog]').inner_text())
    pg.click('[data-testid=del-cancel]'); chk('取消删除不改变任何配置', items(pg).count()==1)
    item(pg,'DeepSeek（原配置）').locator('[data-testid=api-del]').click(); pg.click('[data-testid=del-ok]'); pg.wait_for_timeout(300)
    m=cur(pg)
    chk('10 删除最后一个 → 空列表、尚未配置 API、Key 已移除、自动打开添加面板', m['apiProfiles']==[] and m['apiKey']=='' and K['old'] not in json.dumps(m) and '尚未启用 API' in pg.locator('[data-testid=ai-mode]').inner_text() and pg.locator('[data-testid=api-form]').count()==1)
    # ---- 1 新增第一个 ----
    pg.locator('[data-testid=api-form]').screenshot(path=S+'p7_add_panel.png')
    f=pg.locator('[data-testid=api-form]'); f.locator('[data-testid=f-save]').click(); pg.wait_for_timeout(200)
    chk('校验：未填 Key 不能保存', '请粘贴 API Key' in pg.locator('[data-testid=f-errors]').inner_text() and cur(pg)['apiProfiles']==[])
    add(pg,'deepseek','DeepSeek 主力',K['ds1'])
    m=cur(pg)
    chk('1 新增第一个 API：保存并自动启用、显示成功反馈（且注明尚未测试）', len(m['apiProfiles'])==1 and m['apiKey']==K['ds1'] and m['model']=='deepseek-flash' and '已保存并启用' in pg.locator('[data-testid=api-msg]').inner_text() and '尚未测试' in pg.locator('[data-testid=api-msg]').inner_text())
    # ---- 2/3 多服务商 + 同服务商两个 Key ----
    add(pg,'deepseek','DeepSeek 备用',K['ds2']); add(pg,'qwen','Qwen 备用',K['qw']); add(pg,'openai','OpenAI',K['oa'])
    add(pg,'custom','自建网关',K['cu'],url='https://llm.example.com/v1',model='my-model')
    m=cur(pg); P={x['name']:x for x in m['apiProfiles']}
    chk('2 多服务商保存成功（5 条），参数正确', len(P)==5 and P['Qwen 备用']['baseUrl']=='https://dashscope.aliyuncs.com/compatible-mode/v1' and P['Qwen 备用']['model']=='qwen-plus' and P['OpenAI']['baseUrl']=='https://api.openai.com/v1' and P['OpenAI']['model']=='gpt-4o-mini' and P['自建网关']['baseUrl']=='https://llm.example.com/v1' and P['自建网关']['model']=='my-model')
    chk('3 同服务商两个 Key：独立 id、互不覆盖', P['DeepSeek 主力']['id']!=P['DeepSeek 备用']['id'] and P['DeepSeek 主力']['apiKey']==K['ds1'] and P['DeepSeek 备用']['apiKey']==K['ds2'])
    chk('只有一条「使用中」（最后添加的）', pg.locator('[data-testid=api-active]').count()==1 and item(pg,'自建网关').locator('[data-testid=api-active]').count()==1)
    # ---- 4 反复切换 + 14 切换后请求参数正确（走真实业务入口：测试连接以外的 AI 调用用 chat；这里用「分析岗位」）----
    seq=['DeepSeek 主力','Qwen 备用','OpenAI','DeepSeek 备用','自建网关','DeepSeek 主力']; good=True
    for n in seq:
        if item(pg,n).locator('[data-testid=api-switch]').count(): item(pg,n).locator('[data-testid=api-switch]').click(); pg.wait_for_timeout(150)
        mm=cur(pg); good &= mm['apiKey']==P[n]['apiKey'] and mm['baseUrl']==P[n]['baseUrl'] and mm['model']==P[n]['model'] and item(pg,n).locator('[data-testid=api-active]').count()==1 and pg.locator('[data-testid=api-active]').count()==1
    chk('4 多次切换：使用中标识、保存值即时更新，其他配置不变', good and len(cur(pg)['apiProfiles'])==5)
    pg.screenshot(path=S+'p7_list.png', full_page=True)
    chk('截图时页面不含任何完整 Key', no_key_visible(pg))
    # 业务请求走当前配置（无需刷新）：切到 Qwen → 去分析岗位
    item(pg,'Qwen 备用').locator('[data-testid=api-switch]').click(); pg.wait_for_timeout(200)
    pg.evaluate("localStorage.setItem('wizardStep','2')"); n0=len(reqs)
    pg.click('button.main-nav'); pg.wait_for_timeout(800)
    pg.locator('textarea').first.fill('模拟科技有限公司 · 数据分析师（虚构岗位）\n任职要求：熟悉 SQL、Python。'); pg.click('button:has-text("分析岗位")'); pg.wait_for_timeout(2500)
    new=reqs[n0:]
    chk('14 切换后无需刷新：JD 解析请求发往 Qwen、使用 Qwen 的 Key 与模型', len(new)>0 and all(r['url'].startswith('https://dashscope.aliyuncs.com/compatible-mode/v1/') and r['auth']=='Bearer '+K['qw'] and '"qwen-plus"' in r['body'] for r in new))
    chk('请求网址中不含 Key', all(not any(k in r['url'] for k in ALLK) for r in reqs))
    pg.click('[data-testid=nav-settings]'); pg.wait_for_selector('[data-testid=api-manager]')
    # ---- 5 刷新保持 ----
    before=cur(pg); pg.reload(); pg.wait_for_selector('[data-testid=api-manager]'); pg.wait_for_timeout(400); after=cur(pg)
    chk('5 刷新后配置与当前选择保持', before['apiProfiles']==after['apiProfiles'] and after['activeProfileId']==P['Qwen 备用']['id'] and item(pg,'Qwen 备用').locator('[data-testid=api-active]').count()==1)
    # ---- 6 编辑不填 Key 保留 / 7 修改当前配置立即生效 ----
    item(pg,'Qwen 备用').locator('[data-testid=api-edit]').click(); f=pg.locator('[data-testid=api-form]')
    chk('编辑面板：Key 框为空、提示留空保留（只显示脱敏 Key）', f.locator('[data-testid=f-key]').input_value()=='' and 'sk-••••••0003' in (f.locator('[data-testid=f-key]').get_attribute('placeholder') or ''))
    f.locator('[data-testid=f-name]').fill('Qwen 备用（Max）'); f.locator('summary').click(); f.locator('[data-testid=f-model]').fill('qwen-max')
    f.screenshot(path=S+'p7_edit.png'); f.locator('[data-testid=f-save]').click(); pg.wait_for_timeout(250)
    m=cur(pg); q=[x for x in m['apiProfiles'] if x['id']==P['Qwen 备用']['id']][0]
    chk('6 编辑未填 Key：原 Key 保留，其他配置未变', q['apiKey']==K['qw'] and q['name']=='Qwen 备用（Max）' and all(x==P[x['name']] for x in m['apiProfiles'] if x['id']!=q['id']))
    chk('7 修改当前配置立即生效（平铺字段 = qwen-max）、列表即时更新', m['model']=='qwen-max' and m['activeProfileId']==q['id'] and item(pg,'Qwen 备用（Max）').locator('[data-testid=api-model]').inner_text()=='qwen-max')
    # ---- 12 连接测试：成功 / 401 / 402 / 网络 / 测试不改变启用 ----
    add(pg,'deepseek','坏 Key',K['bad']); add(pg,'deepseek','欠费',K['poor']); add(pg,'deepseek','断网',K['net'])
    item(pg,'Qwen 备用（Max）').locator('[data-testid=api-switch]').click(); pg.wait_for_timeout(150)
    act=cur(pg)['activeProfileId']
    for n in ['DeepSeek 主力','坏 Key','欠费','断网']: item(pg,n).locator('[data-testid=api-test-btn]').click()
    pg.wait_for_timeout(1500)
    T={n:item(pg,n).locator('[data-testid=api-test]').inner_text() for n in ['DeepSeek 主力','坏 Key','欠费','断网']}; print(T)
    chk('12 测试成功显示「连接成功」', '连接成功' in T['DeepSeek 主力'])
    chk('12 401 → Key 无效', 'Key 无效' in T['坏 Key'])
    chk('12 402 → 余额不足', '余额不足' in T['欠费'])
    chk('12 网络故障 → 无法连接（不说 Key 无效）', '无法连接' in T['断网'] and 'Key' not in T['断网'])
    chk('12 测试不改变当前启用配置', cur(pg)['activeProfileId']==act and item(pg,'Qwen 备用（Max）').locator('[data-testid=api-active]').count()==1)
    tr=[r for r in reqs if 'max_tokens' in r['body']]; chk('测试请求为最小请求（max_tokens=8）', len(tr)>=4 and all('"max_tokens":8' in r['body'] for r in tr))
    pg.locator('[data-testid=api-list]').screenshot(path=S+'p7_test_results.png'); chk('测试结果截图不含 Key', no_key_visible(pg))
    # 超时（模拟：路由挂起 > 20 秒）
    c.unroute('https://api.deepseek.com/**'); c.route('https://api.deepseek.com/**', lambda r: None if 'SLOW' in r.request.headers.get('authorization','') else ai_route(r))
    add(pg,'deepseek','超时',K['slow']); item(pg,'Qwen 备用（Max）').locator('[data-testid=api-switch]').click()
    item(pg,'超时').locator('[data-testid=api-test-btn]').click(); pg.wait_for_timeout(300)
    chk('12 测试中状态', '测试中' in item(pg,'超时').locator('[data-testid=api-test]').inner_text())
    pg.wait_for_function("()=>[...document.querySelectorAll('[data-testid=api-test]')].some(e=>e.textContent.includes('超时'))", timeout=30000)
    chk('12 超时 → 请求超时提示', '超时' in item(pg,'超时').locator('[data-testid=api-test]').inner_text())
    # ---- 8 删除普通 / 9 删除当前 ----
    for n in ['坏 Key','欠费','断网','超时']: item(pg,n).locator('[data-testid=api-del]').click(); pg.click('[data-testid=del-ok]'); pg.wait_for_timeout(150)
    m=cur(pg); chk('8 删除普通配置：Key 移除，当前配置不变', len(m['apiProfiles'])==5 and not any(K[k] in json.dumps(m) for k in ['bad','poor','net','slow']) and m['activeProfileId']==act)
    item(pg,'Qwen 备用（Max）').locator('[data-testid=api-del]').click()
    chk('删除当前配置的确认窗口提示「不会自动切换」', '不会自动切换' in pg.locator('[data-testid=del-dialog]').inner_text())
    pg.screenshot(path=S+'p7_delete_confirm.png'); chk('删除确认截图不含 Key', no_key_visible(pg))
    pg.click('[data-testid=del-ok]'); pg.wait_for_timeout(300); m=cur(pg)
    chk('9 删除当前配置：不自动切换、进入未启用、提示用户选择、Key 不可再用', m['activeProfileId'] is None and m['apiKey']=='' and K['qw'] not in json.dumps(m) and pg.locator('[data-testid=api-active]').count()==0 and pg.locator('[data-testid=pick-hint]').count()==1 and pg.locator('[data-testid=api-switch]', has_text='启用').count()==4)
    n0=len(reqs); pg.click('button.main-nav'); pg.wait_for_timeout(800); pg.locator('textarea').first.fill('模拟公司 · 虚构岗位'); pg.click('button:has-text("分析岗位")'); pg.wait_for_timeout(1500)
    chk('9 未启用时 AI 请求不会发出（不会用已删除或其他配置的 Key）', len(reqs)==n0)
    pg.click('[data-testid=nav-settings]'); pg.wait_for_selector('[data-testid=api-manager]')
    item(pg,'DeepSeek 主力').locator('[data-testid=api-switch]').click(); pg.wait_for_timeout(200)
    chk('用户手动选择新配置后恢复使用中', cur(pg)['apiKey']==K['ds1'] and item(pg,'DeepSeek 主力').locator('[data-testid=api-active]').count()==1)
    # 演示模式提示
    pg.click('[data-testid=demo-toggle]'); pg.wait_for_timeout(200)
    chk('演示模式提示：不会调用 AI', '不会调用任何 AI' in pg.locator('[data-testid=ai-mode]').inner_text())
    item(pg,'DeepSeek 备用').locator('[data-testid=api-switch]').click(); pg.wait_for_timeout(200)
    chk('启用配置后自动退出演示模式并提示真实调用', cur(pg)['demoMode'] is False and '真实发送' in pg.locator('[data-testid=ai-mode]').inner_text())
    # ---- 13 备份/日志不含 Key ----
    chk('13 控制台日志不含 Key', not any(k in l for l in logs for k in ALLK))
    pg.click('[data-testid=nav-applications]'); pg.wait_for_timeout(800)
    dumped=json.dumps(pg.evaluate("""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=async()=>{const db=q.result;const o={};for(const s of db.objectStoreNames){if(s==='settings')continue;o[s]=await new Promise(z=>{const t=db.transaction(s).objectStore(s).getAll();t.onsuccess=()=>z(t.result)})}db.close();r(o)}})"""), default=str)
    chk('13 Key 只在 settings 表中（业务表 / 备份来源表均不含）', not any(k in dumped for k in ALLK))
    # ---- ?demo 隔离：演示库的设置独立 ----
    pg.goto(B+'?demo#settings'); pg.wait_for_selector('[data-testid=api-manager]'); pg.wait_for_timeout(500)
    chk('?demo：独立演示库，看不到正式库的 API 配置', items(pg).count()==0 and '不会调用任何 AI' in pg.locator('[data-testid=ai-mode]').inner_text())
    chk('无页面错误', not errs); print(errs)
    c.close()
    # ---- 16 手机 ----
    d2=tempfile.mkdtemp(prefix='chrome-p7m-')
    c=p.chromium.launch_persistent_context(d2, executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
    pg=c.pages[0]; errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    for h in ['api.deepseek.com','dashscope.aliyuncs.com','api.openai.com','llm.example.com']: c.route(f'https://{h}/**', ai_route)
    pg.goto(B+'#settings'); pg.wait_for_selector('[data-testid=api-manager]'); pg.wait_for_timeout(500)
    add(pg,'deepseek','DeepSeek 主力（名称较长的配置用于检查换行）',K['ds1']); add(pg,'qwen','Qwen 备用',K['qw']); add(pg,'custom','自建',K['cu'],url='https://llm.example.com/v1',model='a-very-long-custom-model-name-for-overflow-check-2026')
    item(pg,'Qwen 备用').locator('[data-testid=api-test-btn]').click(); pg.wait_for_timeout(800)
    ov=pg.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
    boxes=pg.evaluate("""()=>[...document.querySelectorAll('[data-testid=api-item]')].map(li=>[...li.querySelectorAll('.api-actions button')].map(b=>{const r=b.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]}))""")
    inter=lambda a,b: not (a[2]<=b[0] or b[2]<=a[0] or a[3]<=b[1] or b[3]<=a[1])
    overlap=any(inter(a,b) for bs in boxes for i,a in enumerate(bs) for b in bs[i+1:]); small=any((b[3]-b[1])<36 or (b[2]-b[0])<36 for bs in boxes for b in bs)
    gap=min((bs[-1][0]-bs[-2][2]) if bs[-1][1]==bs[-2][1] else 99 for bs in boxes)
    chk(f'16 手机：无横向溢出（{ov}px）、按钮不重叠、触控高度≥36px、删除按钮与其他按钮间距≥12px（{gap:.0f}px）', ov<=0 and not overlap and not small and gap>=12)
    pg.evaluate("window.scrollTo(0, document.querySelector('[data-testid=api-manager]').getBoundingClientRect().top+scrollY-130)"); pg.wait_for_timeout(200); pg.screenshot(path=S+'p7_mobile.png'); chk('手机截图不含 Key', no_key_visible(pg))
    item(pg,'自建').locator('[data-testid=api-del]').click(); pg.wait_for_timeout(200)
    db=pg.locator('[data-testid=del-dialog] .modal').bounding_box(); chk('16 手机删除确认窗完整显示在屏幕内', db and db['x']>=0 and db['x']+db['width']<=390 and db['y']>=0)
    pg.screenshot(path=S+'p7_mobile_delete.png'); pg.click('[data-testid=del-cancel]')
    pg.click('[data-testid=api-add]'); pg.wait_for_timeout(200); ov2=pg.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
    chk('16 手机添加面板无溢出', ov2<=0); pg.screenshot(path=S+'p7_mobile_add.png', full_page=True)
    chk('手机端无页面错误', not errs)
    c.close()
print(f'{sum(ok)}/{len(ok)} passed'); exit(0 if all(ok) else 1)
