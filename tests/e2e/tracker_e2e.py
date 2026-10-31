import json, zipfile, io, os, tempfile, shutil
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
S=os.environ.get('SHOT_DIR','/workspace/resume-tool/screenshots/'); os.makedirs(S, exist_ok=True); B=os.environ.get('E2E_BASE','http://localhost:4173/')
FX=os.path.join(HERE,'..','fixtures')+'/'
d=json.load(open(FX+'e2e-seed.json'))  # 虚构资料
ok=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n)
DUMP="""n=>new Promise(r=>{const q=indexedDB.open(n);q.onsuccess=async()=>{const db=q.result;const o={version:db.version};
 const all=s=>new Promise(z=>{const t=db.transaction(s).objectStore(s).getAll();t.onsuccess=()=>z(t.result)});
 for(const s of db.objectStoreNames)o[s]=await all(s);db.close();r(o)}})"""
SEED="""d=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','profile','jobs','resumes','state'],'readwrite');
  t.objectStore('settings').put({id:'settings',demoMode:true,baseUrl:'https://api.example.com',apiKey:'sk-e2e-FAKE-key-000',model:'deepseek-chat',visionModel:'',translateModel:'',uiLang:'zh',provider:'deepseek',ocrMode:'local',setupDone:true});
  t.objectStore('profile').put({id:'me',doc:d.profile});t.objectStore('jobs').put(d.job);t.objectStore('resumes').put(d.resume);
  t.objectStore('state').put({id:'jobId',value:d.job.id});t.objectStore('state').put({id:'resumeId',value:d.resume.id});t.oncomplete=()=>{db.close();r()}}})"""
prof=tempfile.mkdtemp(prefix='chrome-p4-'); prof2=tempfile.mkdtemp(prefix='chrome-p4b-')
dialogs=[]
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(prof, executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':1280,'height':1000}, accept_downloads=True)
    pg=ctx.pages[0]; errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    def on_dialog(x): dialogs.append(x.message); x.accept()
    pg.on('dialog', on_dialog)
    def nav(h):
        pg.goto(B+'#'+h); pg.reload()
        try: pg.wait_for_selector('[data-testid=applications-page]', timeout=15000)
        except Exception: print(pg.url, pg.locator('body').inner_text()[:600]); raise
        pg.wait_for_timeout(400)

    pg.goto(B); pg.wait_for_timeout(800); pg.evaluate(SEED, d)
    nav('applications')
    chk('导航含「求职投递」入口', pg.locator('[data-testid=nav-applications]').inner_text().strip()=='求职投递')
    chk('空库：显示空状态，统计全为 0', pg.locator('[data-testid=empty]').count()==1 and pg.locator('[data-testid=st-postings] .n').inner_text()=='0')
    # 新增岗位
    pg.click('[data-testid=nav-new]')
    for k,v in {'company':'模拟视觉科技有限公司','title':'视觉算法工程师（2027 校招）','city':'上海','category':'机器视觉','companyType':'民企','sourcePlatform':'官网','applyUrl':'https://example.com/jobs/101','officialUrl':'https://example.com/careers','programYear':'2027 届'}.items(): pg.fill(f'[data-testid=pf-{k}]', v)
    pg.select_option('[data-testid=pf-recruitType]','campus'); pg.select_option('[data-testid=pf-priority]','1'); pg.fill('[data-testid=pf-deadline]','2026-11-08')
    pg.fill('[data-testid=pf-jdText]','岗位职责：\n1. 负责工业缺陷检测算法开发（虚构 JD）\n任职要求：\n1. 熟悉 Python、OpenCV、PyTorch'); pg.select_option('[data-testid=pf-status]','saved')
    pg.screenshot(path=S+'p4_add_job.png', full_page=True)
    pg.click('[data-testid=pf-save]'); pg.wait_for_selector('[data-testid=posting-detail]')
    chk('新建岗位并进入详情，状态为已收藏', pg.locator('[data-testid=current-status]').inner_text()=='已收藏')
    # 编辑
    pg.click('[data-testid=edit-posting]'); pg.fill('[data-testid=pf-notes]','内推码：虚构 ABC123'); pg.click('[data-testid=pf-save]'); pg.wait_for_selector('[data-testid=posting-detail]')
    chk('编辑岗位', '内推码' in pg.locator('[data-testid=posting-detail]').inner_text())
    # 状态
    pg.select_option('[data-testid=status-select]','applied'); pg.fill('[data-testid=status-note]','官网投递，已收到确认邮件'); pg.click('[data-testid=status-apply]'); pg.wait_for_timeout(400)
    pg.select_option('[data-testid=status-select]','assessment'); pg.fill('[data-testid=status-note]','收到在线测评'); pg.click('[data-testid=status-apply]'); pg.wait_for_timeout(400)
    h=pg.locator('[data-testid=history] li').all_inner_texts()
    chk('状态历史完整保留 3 条（收藏→投递→测评）', len(h)==3 and '已收藏' in h[0] and '已投递' in h[1] and '在线测评' in h[2])
    pg.fill('[data-testid=todo-text]','完成在线测评（虚构）'); pg.fill('[data-testid=todo-due]','2026-11-03'); pg.click('[data-testid=todo-add]'); pg.wait_for_timeout(300)
    pg.fill('[data-testid=iv-at]','2026-11-06T14:00'); pg.fill('[data-testid=iv-round]','技术一面'); pg.click('[data-testid=iv-add]'); pg.wait_for_timeout(300)
    chk('待办与面试安排已记录', '完成在线测评' in pg.locator('[data-testid=todos-card]').inner_text() and '技术一面' in pg.locator('[data-testid=interviews-card]').inner_text())
    pg.locator('[data-testid=status-card]').screenshot(path=S+'p4_status.png')
    # 外链
    with ctx.expect_page() as np: pg.locator('[data-testid=posting-detail] [data-testid=ext-link]').first.click()
    chk('点击投递链接在新标签页打开招聘页', np.value.url.startswith('https://example.com/jobs/101')); np.value.close()
    # 关联当前简历
    pg.click('[data-testid=link-current]'); pg.wait_for_timeout(500)
    chk('关联当前生成的简历（快照，带事实审查摘要）', pg.locator('[data-testid=artifact]').count()==1 and '事实审查' in pg.locator('[data-testid=artifact]').first.inner_text())
    pg.set_input_files('[data-testid=submitted-input]',os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','fixtures','files','Mock_Vision_Engineer_CN.pdf')); pg.wait_for_timeout(500)
    chk('上传实际提交的 PDF，标记为实际提交版本', '实际提交版本' in pg.locator('[data-testid=artifacts]').inner_text() and 'Mock_Vision_Engineer_CN.pdf' in pg.locator('[data-testid=artifacts]').inner_text())
    pg.set_input_files('[data-testid=att-input]',os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','fixtures','files','jd_screenshot_mock.png')); pg.wait_for_timeout(500)
    chk('拖入 / 选择附件保存到本机（含 SHA-256）', pg.locator('[data-testid=attachment-row]').count()==2 and 'SHA-256' in pg.locator('[data-testid=attachments-card]').inner_text())
    pg.locator('[data-testid=resume-card]').screenshot(path=S+'p4_resume_link.png')
    db1=pg.evaluate(DUMP,'resume-tool'); snap=db1['artifacts'][0] if db1['artifacts'][0]['kind']=='snapshot' else db1['artifacts'][1]
    # 修改资料后快照不变
    pg.evaluate("""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const t=q.result.transaction(['profile','resumes'],'readwrite');const s=t.objectStore('profile');const g=s.get('me');g.onsuccess=()=>{const v=g.result;v.doc.profile.name.zh='改名后的虚构用户';s.put(v)};
      const rs=t.objectStore('resumes');const g2=rs.getAll();g2.onsuccess=()=>{for(const x of g2.result){x.items[0].zh='重新生成后的文本';rs.put(x)}};t.oncomplete=()=>{q.result.close();r()}}})""")
    db2=pg.evaluate(DUMP,'resume-tool'); snap2=[a for a in db2['artifacts'] if a['id']==snap['id']][0]
    chk('修改资料 / 重新生成后，已关联的简历快照不变', snap2==snap and snap2['profile']['profile']['name']['zh']!='改名后的虚构用户')
    # 刷新持久化
    pid=[x for x in db2['postings']][0]['id']
    nav('applications/'+pid); chk('刷新后岗位、历史、附件仍在', pg.locator('[data-testid=history] li').count()==3 and pg.locator('[data-testid=attachment-row]').count()==2)
    pg.screenshot(path=S+'p4_detail.png', full_page=True)
    # 从岗位进入生成流程再返回
    pg.click('[data-testid=to-generate]'); pg.wait_for_selector('[data-testid=tracker-return]')
    chk('从岗位进入生成流程：JD 已预填', '工业缺陷检测算法' in pg.locator('textarea').first.input_value())
    pg.click('[data-testid=link-back]'); pg.wait_for_selector('[data-testid=posting-detail]')
    chk('生成后一键关联并返回岗位', pg.locator('[data-testid=artifact]').count()==3)
    # 导入 CSV
    nav('applications/import'); pg.set_input_files('[data-testid=import-file]', FX+'applications-mock.csv'); pg.wait_for_selector('[data-testid=import-preview]')
    kinds=pg.locator('[data-testid=import-row]').evaluate_all('e=>e.map(x=>x.dataset.kind)'); print('kinds',kinds)
    chk('CSV 预览：识别出与已有岗位的冲突（状态不同）、新增、无效', kinds.count('conflict')==1 and kinds.count('new')==4 and kinds.count('invalid')==1)
    pg.screenshot(path=S+'p4_import.png', full_page=True)
    pg.locator('[data-testid=import-row][data-kind=conflict] [data-testid=row-action]').select_option('skip')
    pg.click('[data-testid=import-confirm]'); pg.wait_for_selector('[data-testid=import-result]')
    chk('确认导入：新增 4 条', '新增岗位 4' in pg.locator('[data-testid=import-result]').inner_text())
    pg.set_input_files('[data-testid=import-file]', FX+'applications-mock.csv'); pg.wait_for_selector('[data-testid=import-preview]')
    k2=pg.locator('[data-testid=import-row]').evaluate_all('e=>e.map(x=>x.dataset.kind)')
    chk('同一文件再次导入：无新增', 'new' not in k2 and pg.locator('[data-testid=import-confirm]').is_disabled())
    pg.set_input_files('[data-testid=import-file]', FX+'handoff-mock.json'); pg.wait_for_selector('[data-testid=import-preview]')
    chk('导航工具 JSON：识别格式并显示字段映射', 'ran-application-handoff' in pg.locator('[data-testid=import-panel]').inner_text() and pg.locator('[data-testid=map-title]').input_value()=='position')
    pg.click('[data-testid=import-confirm]'); pg.wait_for_selector('[data-testid=import-result]')
    # 列表 / 搜索 / 筛选
    nav('applications'); n=pg.locator('[data-testid=posting-row]').count()
    pg.fill('[data-testid=search]','杭州'); chk('按城市搜索', pg.locator('[data-testid=posting-row]').count()==1)
    pg.fill('[data-testid=search]',''); pg.select_option('[data-testid=f-type]','intern'); chk('按招聘类型筛选（实习）', pg.locator('[data-testid=posting-row]').count()==1)
    pg.select_option('[data-testid=f-type]',''); pg.select_option('[data-testid=f-status]','none'); chk('筛选「仅岗位」', pg.locator('[data-testid=posting-row]').count()==1)
    pg.select_option('[data-testid=f-status]',''); pg.select_option('[data-testid=f-priority]','1'); chk('按优先级筛选', pg.locator('[data-testid=posting-row]').count()==1)
    pg.select_option('[data-testid=f-priority]','')
    st={k:pg.locator(f'[data-testid={k}] .n').inner_text() for k in ['st-postings','st-applied','st-ti','st-saved']}; print(st, 'rows', n)
    chk('统计来自真实记录', st['st-postings']==str(n) and int(st['st-ti'])>=2)
    pg.screenshot(path=S+'p4_home.png', full_page=True)
    # 删除提示
    dialogs.clear()
    nav('applications/'+pid); pg.remove_listener('dialog', on_dialog)
    msgs=[]; pg.once('dialog', lambda x: (msgs.append(x.message), x.dismiss()))
    pg.click('[data-testid=delete-posting]'); pg.wait_for_timeout(500)
    print('del msg', msgs[:1])
    chk('删除岗位时提示关联申请与附件，取消后未删除', msgs and '申请记录' in msgs[0] and '附件' in msgs[0] and pg.locator('[data-testid=posting-detail]').count()==1)
    pg.on('dialog', on_dialog)
    # 备份
    nav('applications/backup')
    with pg.expect_download() as dl: pg.click('[data-testid=export-archive]')
    zpath=os.path.join(tempfile.mkdtemp(prefix='p4-'),'archive.zip'); dl.value.save_as(zpath); z=zipfile.ZipFile(zpath); names=z.namelist()
    alltxt=''.join(z.read(x).decode('utf8','ignore') for x in names if x.endswith('.json'))
    chk('ZIP 含 manifest、数据与附件', 'manifest.json' in names and any(x.startswith('attachments/') for x in names) and 'data/postings.json' in names)
    chk('导出文件不含 API Key', 'sk-e2e-FAKE-key-000' not in alltxt and 'apiKey' not in alltxt)
    with pg.expect_download() as dl2: pg.click('[data-testid=export-light]')
    lt=open(dl2.value.path(),encoding='utf8').read(); chk('轻量 JSON 不含 API Key', 'sk-e2e-FAKE-key-000' not in lt)
    pg.screenshot(path=S+'p4_backup.png', full_page=True)
    real_before=pg.evaluate(DUMP,'resume-tool')
    # 演示隔离
    pg.goto(B+'?demo#applications/new'); pg.reload(); pg.wait_for_selector('[data-testid=demo-banner]')
    pg.fill('[data-testid=pf-company]','演示公司'); pg.fill('[data-testid=pf-title]','演示岗位'); pg.click('[data-testid=pf-save]'); pg.wait_for_selector('[data-testid=posting-detail]')
    real_after=pg.evaluate(DUMP,'resume-tool')
    chk('?demo 下新增岗位不影响真实库', real_after==real_before and any(x['company']=='演示公司' for x in pg.evaluate(DUMP,'resume-tool-demo')['postings']))
    # 英文界面
    pg.goto(B+'#applications'); pg.reload(); pg.wait_for_selector('[data-testid=applications-page]')
    pg.click('.lang-switch'); pg.wait_for_timeout(300)
    chk('英文界面：导航与页面标题切换', pg.locator('[data-testid=nav-applications]').inner_text().strip()=='Applications' and 'Applications' in pg.locator('[data-testid=applications-page] h2').inner_text())
    pg.screenshot(path=S+'p4_home_en.png', full_page=True); pg.click('.lang-switch')
    chk('无页面错误', not errs); print(errs)
    ctx.close()
    # 恢复到新浏览器
    ctx2=p.chromium.launch_persistent_context(prof2, executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport={'width':1280,'height':1000})
    pg2=ctx2.pages[0]; pg2.on('dialog', lambda x: x.accept())
    pg2.goto(B+'#applications/backup'); pg2.wait_for_selector('[data-testid=backup-panel]')
    pg2.set_input_files('[data-testid=archive-file]', zpath); pg2.wait_for_selector('[data-testid=archive-check]')
    pg2.screenshot(path=S+'p4_restore.png', full_page=True)
    pg2.click('[data-testid=restore-confirm]'); pg2.wait_for_selector('[data-testid=restore-result]')
    new=pg2.evaluate(DUMP,'resume-tool')
    chk('新浏览器恢复：岗位 / 申请 / 历史 / 简历版本 / 附件数量一致', all(len(new[k])==len(real_before[k]) for k in ['postings','applications','appEvents','artifacts','attachments','attachmentBlobs']))
    chk('新浏览器恢复：不含 API Key（设置未导入）', not new.get('settings'))
    pg2.goto(B+'#applications/'+pid); pg2.reload(); pg2.wait_for_selector('[data-testid=posting-detail]')
    pg2.locator('[data-testid=attachment-row]').first.locator('text=校验').click(); pg2.wait_for_timeout(500)
    chk('恢复后附件校验通过', '校验通过' in pg2.locator('[data-testid=detail-msg]').inner_text())
    ctx2.close()
shutil.rmtree(prof); shutil.rmtree(prof2)
print('RESULT', sum(ok), '/', len(ok))
