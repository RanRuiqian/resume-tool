# 智能资料导入 浏览器端到端（全部为模拟：资料为虚构，Key 为虚构，AI 接口被 Playwright 拦截并返回「有重复问题」的模拟识别结果，不访问真实服务商）
import json, os, tempfile, re
from playwright.sync_api import sync_playwright
B=os.environ.get('E2E_BASE','http://localhost:4173/'); S=os.environ.get('SHOT_DIR','/workspace/resume-tool/screenshots/'); os.makedirs(S, exist_ok=True)
FX=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','fixtures')
DOC=os.path.join(FX,'files','mock_master_profile_zh.txt'); TXT=open(DOC).read()
SAMPLE=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','src','sample','sample-profile.json')))
KEY='sk-FAKE-import-0001'
ok=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
COURSES=[l.split('　')[0].split('. ',1)[1]+'（'+l.split('　')[1]+'，'+l.split('　')[2]+'）' for l in TXT.split('\n') if re.match(r'^\d+\. .+　学分',l)]
SEG=[
 {'lang':'zh','name':'测试用户庚','phone':'138-0000-0000','email':'gengtest@example.com','headline':'工业自动化 / 机器人工程师','birth':'2001-03','gender':'男',
  'education':[
   {'school':'东临海事大学','degree':'工学学士','major':'轮机工程','start':'2019-09','end':'2023-06','actualConferralDate':'2023-06','courses':COURSES[:40],'coursesInText':40,'notes':['学位证编号待核实']},
   {'school':'Donglin Maritime University','degree':'Bachelor of Engineering','major':'Marine Engineering','start':'2019-09','end':'2023-06'},
   {'school':'Sunbay University Malaysia','degree':'Master of Applied Engineering','major':'Industrial AI & Robotics','start':'2026-02','end':'2027-01','expectedConferralDate':'2027-01'},
   {'school':'桑湾大学马来西亚分校','degree':'应用工程硕士','major':'工业人工智能与机器人','start':'2026-02','end':'2027-01'}],
  'work':[{'company':'北岭生物科技股份有限公司','title':'自动化生产技术员','kind':'fulltime','start':'2023-10','end':'2024-06','bullets':['负责灌装线 PLC 程序维护']},
          {'company':'北岭生物科技股份有限公司','title':'自动化生产技术员（实习）','kind':'internship','start':'2023-10','end':'2024-06','bullets':['负责灌装线 PLC 程序维护','编写故障排查手册']}],
  'uncertain':[{'field':'work[0].kind','note':'原文同时写了正式工作和实习'}]},
 {'lang':'zh','education':[{'school':'东临海事大学','major':'轮机工程','courses':COURSES[40:],'coursesInText':36}],
  'projects':[{'name':'Low-cost Smart Stethoscope for Clinical Training','kind':'core','start':'2026-03','end':'2026-11','bullets':['Built and tested a prototype']},
   {'name':'智能听诊器','start':'2026-03','end':'2026-11','bullets':['完成声学腔体迭代与对比实验']},
   {'name':'基于 AMESim 的减压阀动态性能分析','nameOther':'Dynamic Performance Analysis of a Pressure Reducing Valve Using AMESim','kind':'core','nature':'本科毕业设计','start':'2022-12','end':'2023-05','bullets':['建立减压阀 AMESim 模型']},
   {'name':'本科 AMESim 毕业设计','aliases':['Dynamic Performance Analysis of a Pressure Reducing Valve Using AMESim'],'start':'2022-12','end':'2023-05'},
   {'name':'课程实验：液压回路搭建','kind':'auxiliary','nature':'课程实验','start':'2021-10','end':'2021-12'},
   {'name':'教学实训：工业机器人示教编程','kind':'auxiliary','nature':'教学实训','start':'2022-07'},
   {'name':'个人求职简历工具','kind':'auxiliary','nature':'个人小工具','start':'2026-09','end':'present'}]},
 {'lang':'zh','work':[{'company':'东临海事大学轮机协会','title':'技术部部长','kind':'club','start':'2020-09','end':'2021-06'},
   {'company':'临江市海洋馆','title':'讲解志愿者','kind':'volunteer','start':'2021-07','end':'2021-08'},
   {'company':'某教育机构','title':'数学家教','kind':'parttime','start':'2022-03','end':'2022-12'}],
  'skills':[{'name':n} for n in ['PLC','AMESim','SolidWorks','Python','C 语言','MATLAB']],
  'certificates':[{'name':'全国大学英语六级'},{'name':'轮机工程相关职业资格证书'}],'awards':[{'name':'校级二等奖学金','date':'2021'}],
  'evidence':[{'fileName':'成绩单扫描件','type':'transcript','location':'D:/资料/成绩单.pdf','proves':'76 门课程成绩'}]},
]
reqs=[]
def ai_route(route):
    r=route.request; body=r.post_data or ''; reqs.append(body)
    if '严谨的简历整理助手' in body:
        m=re.search(r'第 (\d+)/(\d+) 段', json.loads(body)['messages'][1]['content']); i=int(m.group(1))-1 if m else 0
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':json.dumps(SEG[min(i,2)],ensure_ascii=False)}}]}))
    return route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':'{"items":[]}'}}]}))
DUMP="""s=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(s).objectStore(s).getAll();t.onsuccess=()=>{db.close();r(t.result)}}})"""
def prof(pg): return [x for x in pg.evaluate(DUMP,'profile') if x['id']=='me'][0]['doc']
def no_overflow(pg): return pg.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
FIT="""()=>[...document.querySelectorAll('[data-testid=imp-action]')].filter(s=>s.offsetParent).map(s=>{const cs=getComputedStyle(s);const c=document.createElement('canvas').getContext('2d');c.font=cs.font;
  const w=c.measureText(s.options[s.selectedIndex].text).width;const avail=s.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-16;return {t:s.options[s.selectedIndex].text,w,avail,ok:w<=avail}})"""
OVERLAP="""()=>[...document.querySelectorAll('.imp-row')].filter(r=>r.offsetParent).every(r=>{const a=r.querySelector('.imp-head').getBoundingClientRect(),b=r.querySelector('select').getBoundingClientRect();return a.right<=b.left+1||a.bottom<=b.top+1})"""
with sync_playwright() as p:
    d=tempfile.mkdtemp(prefix='chrome-p9-')
    c=p.chromium.launch_persistent_context(d, executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':1366,'height':900})
    pg=c.pages[0]; errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    c.route('https://api.deepseek.com/**', ai_route)
    pg.goto(B); pg.wait_for_timeout(1200)
    # 模拟「站点仍有示例数据」的现有资料 + 已配置（虚构）Key
    pg.evaluate("""([k,doc])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','profile'],'readwrite');
      t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:k,model:'deepseek-flash',visionModel:'',translateModel:'',uiLang:'zh',provider:'deepseek',ocrMode:'local',setupDone:true});
      t.objectStore('profile').put({id:'me',doc,updatedAt:Date.now()});t.oncomplete=()=>{db.close();r()}}})""", [KEY, SAMPLE])
    pg.goto(B+'#profile'); pg.reload(); pg.wait_for_selector('[data-testid=smart-import]'); pg.wait_for_timeout(500)
    chk('前置：现有资料含示例 Senior Frontend Engineer', 'Senior Frontend Engineer' in json.dumps(prof(pg)))
    # ---- 上传：文件卡片 + 本地提取，不自动调用 AI ----
    pg.set_input_files('[data-testid=smart-file]', DOC); pg.wait_for_selector('[data-testid=file-card] .fc-status:has-text("已在本地提取")')
    card=pg.locator('[data-testid=file-card]').first; ct=card.inner_text()
    chk(f'文件卡片显示文件名、类型、大小、解析状态（{len(TXT)} 字）', 'mock_master_profile_zh.txt' in ct and 'TXT' in ct and 'KB' in ct and f'已在本地提取 {len(TXT)} 字' in ct)
    chk('TXT 默认展开「查看提取文本」，显示完整文字', card.locator('details').get_attribute('open') is not None and card.locator('[data-testid=file-text]').input_value()==TXT)
    chk('上传后没有调用 AI', len(reqs)==0)
    card.locator('[data-testid=file-text]').fill(TXT+'\n手动补充：测试修改'); 
    chk('提取文本可手动修改并计入识别字数', f'共 {len(TXT)+len(chr(10)+"手动补充：测试修改")+len("【文件：mock_master_profile_zh.txt】")+1} 字' in pg.locator('[data-testid=ai-chars]').inner_text())
    bad=os.path.join(tempfile.mkdtemp(),'broken.pdf'); open(bad,'wb').write(b'not a real pdf')
    pg.set_input_files('[data-testid=smart-file]', bad); pg.wait_for_selector('.fc-error')
    chk('损坏的 PDF：卡片显示解析失败且不阻止其它文件', '解析失败' in pg.locator('.fc-error').inner_text() and pg.locator('[data-testid=smart-run]').is_enabled())
    empty=os.path.join(tempfile.mkdtemp(),'empty.txt'); open(empty,'w').write('   ')
    pg.set_input_files('[data-testid=smart-file]', empty); pg.wait_for_timeout(400)
    chk('空文件：提示没有可读取的文字', '没有可读取的文字' in pg.locator('.fc-error').last.inner_text())
    pg.screenshot(path=S+'p9_upload_cards_1366.png', full_page=False)
    # ---- 点击后才识别 ----
    pg.click('[data-testid=smart-run]'); pg.wait_for_selector('[data-testid=import-review]', timeout=20000)
    ext=[b for b in reqs if '严谨的简历整理助手' in b]
    chk(f'点击「智能识别并填入」后才调用 AI（分 {len(ext)} 段识别，max_tokens=8000）', len(ext)==3 and all(json.loads(b).get('max_tokens')==8000 for b in ext))
    chk('识别完成只是预览：资料未写入', 'Senior Frontend Engineer' in json.dumps(prof(pg)) and '测试用户庚' not in json.dumps(prof(pg)))
    gc=lambda g: pg.locator(f'[data-testid=imp-group-{g}] [data-testid=group-counts]').inner_text()
    groups=['basic','education','work','projects','skills','certificates','awards','evidence']
    chk('按 8 个类别折叠展示（个人信息…证据材料）', all(pg.locator(f'[data-testid=imp-group-{g}]').count()==1 for g in groups))
    chk(f'教育标题含条目 / 重复 / 待确认数量：「{gc("education")}」', re.search(r'4 条 · 重复 2 · 待确认 \d+', gc('education')) is not None)
    chk('三级提示分开显示（需要决定 / 缺失待核对 / 说明），说明默认折叠', pg.locator('[data-testid=lv-critical]').count()==1 and pg.locator('[data-testid=lv-info]').get_attribute('open') is None)
    chk('课程未遗漏：76 门 ≥ 原文课程数，不报遗漏', '可能有遗漏' not in pg.locator('[data-testid=import-review]').inner_text())
    # 展开全部分组以检查控件
    for g in groups: 
        el=pg.locator(f'[data-testid=imp-group-{g}]')
        if el.get_attribute('open') is None: el.locator('summary').first.click()
    fit=pg.evaluate(FIT)
    chk(f'1366px：{len(fit)} 个操作下拉框完整显示当前选项（如「{fit[0]["t"]}」）', len(fit)>15 and all(x['ok'] for x in fit))
    chk('1366px：无横向溢出、标题与下拉框不重叠', no_overflow(pg) and pg.evaluate(OVERLAP))
    pg.screenshot(path=S+'p9_review_1366.png', full_page=False)
    pg.locator('[data-testid=imp-group-education]').scroll_into_view_if_needed(); pg.screenshot(path=S+'p9_review_1366_edu.png')
    # 单条默认折叠，点击展开 + 合并预览
    w=pg.locator('[data-testid=imp-group-work] [data-testid=imp-item][data-status=internal]').first
    chk('单条默认只显示名称 / 日期 / 类型 / 状态', w.locator('[data-testid=imp-detail]').count()==0 and '2023-10' in w.inner_text() and '本次识别内重复' in w.inner_text())
    w.locator('.imp-head').click()
    mp=w.locator('[data-testid=merge-preview]').inner_text()
    chk('展开显示合并预览：合并前两条 + 合并后（类型=实习）', '合并前' in mp and '合并后' in mp and '实习' in mp.split('合并后')[1])
    pg.screenshot(path=S+'p9_merge_preview.png')
    pg.locator('[data-testid=import-bar]').scroll_into_view_if_needed()
    bar_vis=pg.evaluate("()=>{window.scrollTo(0,document.querySelector('[data-testid=imp-group-education]').offsetTop);const b=document.querySelector('[data-testid=import-bar]').getBoundingClientRect();return b.bottom<=innerHeight+1&&b.top<innerHeight}")
    chk('长列表滚动时导入操作栏固定在可视区底部', bar_vis)
    summ=pg.locator('[data-testid=import-summary]').inner_text()
    chk(f'检测到示例数据残留 → 默认「替换现有资料」；汇总：{summ}', pg.locator('[data-testid=mode-replace]').is_checked() and '移除现有' in summ and '待决定' in summ)
    chk('有待决定的条目时，确认按钮禁用', pg.locator('[data-testid=import-confirm]').is_disabled())
    und=pg.locator('[data-testid=imp-item].undecided')
    titles=[und.nth(i).locator('.imp-title b').inner_text() for i in range(und.count())]
    chk(f'跨语言同名同期项目需用户决定：{titles}', titles==['智能听诊器'])
    und.first.locator('[data-testid=imp-action]').select_option('merge'); pg.wait_for_timeout(200)
    summ=pg.locator('[data-testid=import-summary]').inner_text()
    chk(f'决定后可以提交：{summ}', pg.locator('[data-testid=import-confirm]').is_enabled() and '待决定' not in summ)
    # 窄窗口
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(300)
    fit=pg.evaluate(FIT)
    chk('390px：无横向溢出、下拉框完整显示、不重叠', no_overflow(pg) and all(x['ok'] for x in fit) and pg.evaluate(OVERLAP))
    pg.locator('[data-testid=imp-group-projects]').scroll_into_view_if_needed(); pg.screenshot(path=S+'p9_review_390.png')
    pg.set_viewport_size({'width':900,'height':800}); pg.wait_for_timeout(200)
    chk('900px：无横向溢出', no_overflow(pg))
    pg.set_viewport_size({'width':1366,'height':900})
    pg.locator('[data-testid=import-bar]').scroll_into_view_if_needed(); pg.screenshot(path=S+'p9_import_bar.png')
    nb=len(pg.evaluate(DUMP,'backups'))
    pg.once('dialog', lambda dl: dl.accept()); pg.click('[data-testid=import-confirm]'); pg.wait_for_selector('[data-testid=import-done]')
    d2=prof(pg); bk=pg.evaluate(DUMP,'backups')
    chk('替换前自动创建快照（智能导入替换前）', len(bk)==nb+1 and any(b.get('reason')=='智能导入替换前' or '智能导入替换前' in json.dumps(b,ensure_ascii=False)[:400] for b in bk))
    s=json.dumps(d2,ensure_ascii=False)
    chk('替换后不残留示例数据（Senior Frontend Engineer / 前端）', 'Senior Frontend Engineer' not in s and '前端' not in s)
    chk(f'两段学历（实际 {len(d2["education"])}）', len(d2['education'])==2 and d2['education'][0]['school'].get('zh')=='东临海事大学')
    edu0,edu1=d2['education']
    chk('预计授予时间与实际授予时间分开', edu1.get('expectedConferralDate')=='2027-01' and not edu1.get('actualConferralDate') and edu0.get('actualConferralDate')=='2023-06')
    chk(f'课程完整：{len(edu0.get("courses",[]))} 门', len(edu0.get('courses',[]))==76)
    kinds=[(x['company'].get('zh'),x.get('kind')) for x in d2['work']]
    chk(f'企业实习只有一条且为实习；社团 / 志愿 / 兼职保留各自类型：{kinds}', [k for _,k in kinds].count('internship')==1 and 'fulltime' not in [k for _,k in kinds] and {'club','volunteer','parttime'}<={k for _,k in kinds} and len(kinds)==4)
    core=[x for x in d2['projects'] if x.get('kind')=='core']
    chk(f'核心项目 2 个（不重复），辅助项目 3 个且标注性质', len(core)==2 and len([x for x in d2['projects'] if x.get('kind')=='auxiliary'])==3 and all(x.get('nature') for x in d2['projects'] if x.get('kind')=='auxiliary'))
    chk('备注进入 notes，不在亮点 / 要点里', edu0.get('notes')==['学位证编号待核实'] and '待核实' not in json.dumps(edu0['highlights'],ensure_ascii=False))
    chk('完整原始文本已保存为可检索记录', len(d2.get('sourceTexts',[]))==1 and TXT in d2['sourceTexts'][0]['text'])
    chk('导入不影响 API 设置（虚构 Key 仍在设置中）', KEY in json.dumps(pg.evaluate(DUMP,'settings')))
    pg.screenshot(path=S+'p9_after_replace.png')
    # ---- 回滚 ----
    pg.click('[data-testid=import-rollback]'); pg.wait_for_timeout(500)
    chk('回滚：资料恢复为导入前（示例数据回来、无本次导入内容）', 'Senior Frontend Engineer' in json.dumps(prof(pg)) and '测试用户庚' not in json.dumps(prof(pg),ensure_ascii=False))
    # ---- 合并模式 ----
    pg.set_input_files('[data-testid=smart-file]', DOC); pg.wait_for_selector('[data-testid=file-card] .fc-status:has-text("已在本地提取")')
    pg.click('[data-testid=smart-run]'); pg.wait_for_selector('[data-testid=import-review]', timeout=20000)
    pg.check('[data-testid=mode-merge]')
    chk('合并模式：提示示例数据仍会保留，建议替换', pg.locator('[data-testid=sample-warning]').count()==1)
    pg.locator('[data-testid=imp-item].undecided [data-testid=imp-action]').first.select_option('add')
    pg.click('[data-testid=import-confirm]'); pg.wait_for_selector('[data-testid=import-done]')
    d3=prof(pg)
    chk('合并模式：保留原有条目并追加新条目；选「新增条目」的项目单独保留', 'Senior Frontend Engineer' in json.dumps(d3) and len([x for x in d3['projects'] if x['name'].get('zh')=='智能听诊器'])==1)
    pg.click('[data-testid=import-rollback]'); pg.wait_for_timeout(400)
    chk('合并后回滚成功', '测试用户庚' not in json.dumps(prof(pg),ensure_ascii=False))
    chk('页面与截图中不含 Key', KEY not in pg.locator('body').inner_text())
    chk('无页面错误', not errs)
    c.close()
print(f'{sum(ok)}/{len(ok)} passed'); raise SystemExit(0 if all(ok) else 1)
