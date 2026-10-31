# 发布前验收：导航工具 1.0 导入、完整备份恢复（PDF/DOCX/图片）、空库首启、移动端/桌面端布局。全部虚构数据。
import json, zipfile, os, tempfile, shutil, hashlib, sys
from playwright.sync_api import sync_playwright
S='/workspace/resume-tool/screenshots/'; B=os.environ.get('E2E_BASE','http://localhost:4173/')
FX=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','fixtures')
S=os.environ.get('SHOT_DIR', S); os.makedirs(S, exist_ok=True); TMP=tempfile.mkdtemp(prefix='p5-')
HO=os.path.join(FX,'handoff-1.0-mock.json'); FAKE_KEY='sk-e2e-FAKE-key-p5-000'
FILES={k:os.path.join(FX,'files',v) for k,v in {'pdf':'Mock_Vision_Engineer_CN.pdf','docx':'Mock_Resume_Submitted_EN.docx','png':'jd_screenshot_mock.png'}.items()}
ok=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
DUMP="""n=>new Promise(r=>{const q=indexedDB.open(n);q.onsuccess=async()=>{const db=q.result;const o={version:db.version};
 const all=s=>new Promise(z=>{const t=db.transaction(s).objectStore(s).getAll();t.onsuccess=()=>z(t.result)});
 for(const s of db.objectStoreNames){o[s]=await all(s)}
 if(o.attachmentBlobs){for(const b of o.attachmentBlobs){const buf=await (b.data instanceof Blob?b.data.arrayBuffer():Promise.resolve(b.data));const h=await crypto.subtle.digest('SHA-256',buf);b.data=[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}}
 db.close();r(o)}})"""
SETKEY="""k=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings'],'readwrite');const s=t.objectStore('settings');const g=s.get('settings');
 g.onsuccess=()=>{s.put({...(g.result||{id:'settings'}),id:'settings',apiKey:k,setupDone:true})};t.oncomplete=()=>{db.close();r()}}})"""
dirs=[]
def ctx_new(p, vp={'width':1280,'height':900}, **kw):
    d=tempfile.mkdtemp(prefix='chrome-p5-'); dirs.append(d)
    c=p.chromium.launch_persistent_context(d, executable_path='/usr/bin/google-chrome', args=['--no-sandbox'], viewport=vp, accept_downloads=True, **kw)
    pg=c.pages[0]; pg.errs=[]; pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('dialog', lambda x: x.accept()); return c,pg
def nav(pg,h,sel='[data-testid=applications-page]'):
    pg.goto(B+'#'+h); pg.reload(); pg.wait_for_selector(sel, timeout=15000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    # ---------- 空库首启 ----------
    c,pg=ctx_new(p); pg.goto(B); pg.wait_for_timeout(1500)
    body=pg.locator('body').inner_text()
    dbs=pg.evaluate("indexedDB.databases()")
    chk('空数据库首次启动：页面正常、无报错、只创建真实库', not pg.errs and '双语简历生成器' in body and [x['name'] for x in dbs]==['resume-tool'])
    nav(pg,'applications'); chk('空库：求职投递页显示空状态', pg.locator('[data-testid=empty]').count()==1)
    pg.evaluate(SETKEY, FAKE_KEY)
    # ---------- 导航工具 1.0 导入 ----------
    nav(pg,'applications/import'); pg.set_input_files('[data-testid=import-file]', HO); pg.wait_for_selector('[data-testid=import-preview]')
    txt=pg.locator('[data-testid=import-panel]').inner_text()
    kinds=pg.locator('[data-testid=import-row]').evaluate_all('e=>e.map(x=>x.dataset.kind)')
    chk('识别导航工具 1.0：48 条岗位（40 校招 + 8 实习），全部为新增', len(kinds)==48 and set(kinds)=={'new'} and 'jobs 40' in txt and 'internships 8' in txt)
    chk('portals 21 个招聘网站单独列出，不作为岗位', 'portals 21' in txt and '招聘网站 21 个' in pg.locator('[data-testid=import-portals]').inner_text() and '虚构招聘网站' not in pg.locator('[data-testid=import-preview]').inner_text())
    chk('预览提示无法映射的字段（tags）', 'tags' in txt and '没有对应项' in txt)
    chk('预览明确说明尚未用真实文件核对', '尚未用真实导出文件核对' in txt)
    sts=pg.locator('[data-testid=import-status]').all_inner_texts()
    chk('预览中「未投」显示为仅岗位，不显示已投递', any('仅岗位（未投）' in s for s in sts) and not any(('已投递' in s.split('原：')[0]) and '未投' in s for s in sts))
    chk('字段映射使用导航工具专用映射（url→投递链接，description→JD）', pg.locator('[data-testid=map-applyUrl]').input_value()=='url' and pg.locator('[data-testid=map-jdText]').input_value()=='description')
    pg.screenshot(path=S+'p5_import_preview.png', full_page=False)
    pg.locator('[data-testid=import-portals] summary').click(); pg.locator('[data-testid=import-panel]').screenshot(path=S+'p5_import_preview_full.png')
    pg.click('[data-testid=import-confirm]'); pg.wait_for_selector('[data-testid=import-result]')
    r=pg.locator('[data-testid=import-result]').inner_text(); print(r)
    db=pg.evaluate(DUMP,'resume-tool'); raw=json.load(open(HO)); recs=raw['jobs']+raw['internships']
    nwt=sum(1 for x in recs if x['status']=='未投')
    chk(f'导入后 48 个岗位、{48-nwt} 条申请；未投的岗位没有申请', len(db['postings'])==48 and len(db['applications'])==48-nwt)
    by={x['source'].get('externalId'):x for x in db['postings']}
    ok_fields=all(by[x['id']]['applyUrl']==x['url'] and by[x['id']]['sourcePlatform']==x['source'] and x['notes'] in by[x['id']]['notes'] and f"原优先级：{x['priority']}" in by[x['id']]['notes'] for x in recs)
    chk('原网址、备注、来源、优先级、原始 ID 全部保留', ok_fields and len(by)==48)
    chk('没有虚假投递时间', all(not a.get('appliedAt') for a in db['applications']))
    appst={a['postingId']:a['status'] for a in db['applications']}
    exp={'已投递':'applied','等待反馈':'applied','笔试/面试':'assessment','已结束':'closed','未投':None}
    chk('状态转换正确（未投/已投递/等待反馈/笔试面试/已结束）', all(appst.get(by[x['id']]['id'])==exp[x['status']] for x in recs))
    pg.set_input_files('[data-testid=import-file]', HO); pg.wait_for_selector('[data-testid=import-preview]')
    k2=pg.locator('[data-testid=import-row]').evaluate_all('e=>e.map(x=>x.dataset.kind)')
    chk('重复导入同一文件：48 条全部识别为重复，无法新增', k2==['duplicate']*48 and pg.locator('[data-testid=import-confirm]').is_disabled())
    nav(pg,'applications'); chk('列表显示 48 个岗位，实习筛选 8 个', pg.locator('[data-testid=posting-row]').count()==48 and (pg.select_option('[data-testid=f-type]','intern') or True) and pg.locator('[data-testid=posting-row]').count()==8)
    pg.select_option('[data-testid=f-type]','')
    # ---------- 完整备份恢复 ----------
    target=by['job-005']  # 未投 → 仅岗位
    nav(pg,'applications/'+target['id'],'[data-testid=posting-detail]')
    pg.select_option('[data-testid=status-select]','applied'); pg.fill('[data-testid=status-note]','（虚构）官网投递'); pg.click('[data-testid=status-apply]'); pg.wait_for_timeout(300)
    pg.select_option('[data-testid=status-select]','interviewing'); pg.fill('[data-testid=status-note]','（虚构）一面'); pg.click('[data-testid=status-apply]'); pg.wait_for_timeout(300)
    pg.set_input_files('[data-testid=submitted-input]', FILES['pdf']); pg.wait_for_timeout(400)
    pg.set_input_files('[data-testid=att-input]', FILES['docx']); pg.wait_for_timeout(400)
    pg.set_input_files('[data-testid=att-input]', FILES['png']); pg.wait_for_timeout(400)
    hist=pg.locator('[data-testid=history] li').all_inner_texts()
    chk('手动更新状态：历史 2 条且顺序正确', len(hist)==2 and '已投递' in hist[0] and '面试中' in hist[1])
    chk('PDF（实际提交）、DOCX、图片附件均已保存', pg.locator('[data-testid=attachment-row]').count()==3 and '实际提交版本' in pg.locator('[data-testid=artifacts]').inner_text())
    before=pg.evaluate(DUMP,'resume-tool')
    sha={a['name']:a['sha256'] for a in before['attachments']}
    chk('附件 SHA-256 与原文件一致', all(sha[os.path.basename(f)]==hashlib.sha256(open(f,'rb').read()).hexdigest() for f in FILES.values()))
    nav(pg,'applications/backup','[data-testid=backup-panel]')
    with pg.expect_download() as dl: pg.click('[data-testid=export-archive]')
    zp=os.path.join(TMP,'archive.zip'); dl.value.save_as(zp); z=zipfile.ZipFile(zp); names=z.namelist()
    blob=b''.join(z.read(n) for n in names)
    chk('ZIP 中三种附件原文件齐全', all(any(n.endswith('/'+os.path.basename(f)) for n in names) for f in FILES.values()))
    chk('ZIP 不含 API Key（含二进制全文搜索）', FAKE_KEY.encode() not in blob and b'apiKey' not in blob)
    chk('导出前后真实库未改变', pg.evaluate(DUMP,'resume-tool')['postings']==before['postings'])
    errs1=pg.errs; c.close()
    c2,pg2=ctx_new(p); pg2.goto(B+'#applications/backup'); pg2.reload(); pg2.wait_for_selector('[data-testid=backup-panel]')
    chk('恢复目标是全新隔离数据库（无岗位）', len(pg2.evaluate(DUMP,'resume-tool').get('postings',[]))==0)
    pg2.set_input_files('[data-testid=archive-file]', zp); pg2.wait_for_selector('[data-testid=archive-check]')
    pg2.click('[data-testid=restore-confirm]'); pg2.wait_for_selector('[data-testid=restore-result]')
    after=pg2.evaluate(DUMP,'resume-tool')
    clean=lambda x:{k:v for k,v in x.items() if v is not None}  # undefined 字段经 JSON 备份后不保留，属于等价
    same=lambda k: sorted(map(clean,after[k]),key=lambda x:x['id'])==sorted(map(clean,before[k]),key=lambda x:x['id'])  # 按值比较（JS 数字在序列化时可能表现为 1 或 1.0）
    for k in ['postings','applications','appEvents','artifacts','attachments','attachmentBlobs']:
        if not same(k):
            bm={x['id']:x for x in before[k]}
            for x in after[k]:
                y=bm.get(x['id'])
                if y!=x: print('DIFF',k,x,'\nVS',y,{kk:(y.get(kk) if y else None,x.get(kk)) for kk in set(x)|set(y or {}) if (y or {}).get(kk)!=x.get(kk)}); break
        chk(f'恢复后 {k} 完全一致（{len(before[k])} 条）', same(k))
    chk('恢复后附件二进制 SHA-256 与原文件一致', {b['data'] for b in after['attachmentBlobs']}=={hashlib.sha256(open(f,'rb').read()).hexdigest() for f in FILES.values()})
    chk('恢复后不含 API Key', 'sk-e2e' not in json.dumps(after))
    nav(pg2,'applications/'+target['id'],'[data-testid=posting-detail]')
    chk('恢复后详情页显示历史与附件', pg2.locator('[data-testid=history] li').count()==2 and pg2.locator('[data-testid=attachment-row]').count()==3)
    for i in range(3):
        pg2.locator('[data-testid=attachment-row]').nth(i).locator('text=校验').click(); pg2.wait_for_timeout(300)
        if '校验通过' not in pg2.locator('[data-testid=detail-msg]').inner_text(): break
    else: i=3
    chk('恢复后 3 个附件逐一校验通过', i==3)
    chk('无页面错误', not errs1 and not pg2.errs); print(errs1, pg2.errs)
    # ---------- 移动端 / 桌面端 ----------
    pages=[('applications','[data-testid=applications-page]'),('applications/new','[data-testid=posting-form]'),('applications/import','[data-testid=import-panel]'),('applications/backup','[data-testid=backup-panel]'),
           ('applications/'+target['id'],'[data-testid=posting-detail]'),('profile','main'),('layout','main'),('settings','main'),('wizard','main')]
    LAYOUT="""()=>{const W=document.documentElement.clientWidth;const over=document.documentElement.scrollWidth-W;
      const bad=[];for(const el of document.querySelectorAll('button,select,input:not([type=file]),a[href],textarea')){const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
        const st=getComputedStyle(el);if(st.visibility==='hidden')continue;
        if(el.closest('.scroll-x,details:not([open])'))continue;
        if(r.right>W+1||r.left<-1){bad.push('越界:'+(el.dataset.testid||el.textContent.trim().slice(0,12)||el.tagName));continue}
        el.scrollIntoView({block:'center'});const r2=el.getBoundingClientRect();const x=r2.left+Math.min(r2.width/2,20),y=r2.top+r2.height/2;
        const h=document.elementFromPoint(x,y);if(h&&!(h===el||el.contains(h)||h.contains(el)||h.closest('label')===el.closest('label')&&el.closest('label')))bad.push('遮挡:'+(el.dataset.testid||el.textContent.trim().slice(0,12)||el.tagName)+'<-'+(h.dataset?.testid||h.className||h.tagName))}
      window.scrollTo(0,0);return {over,bad:bad.slice(0,8),n:bad.length}}"""
    for name,vp in [('mobile',{'width':390,'height':844}),('desktop',{'width':1440,'height':900})]:
        pg2.set_viewport_size(vp); allok=True
        for h,sel in pages:
            pg2.goto(B+'#'+h); pg2.reload(); pg2.wait_for_selector(sel, timeout=15000); pg2.wait_for_timeout(300)
            r=pg2.evaluate(LAYOUT)
            if r['over']>2 or r['n']: allok=False; print(name,h,r)
            if name=='mobile' and h in ('applications','applications/import','profile') or (name=='mobile' and h.startswith('applications/')and h.count('/')==1 and h not in('applications/new','applications/import','applications/backup')):
                fn={'applications':'home','applications/import':'import','profile':'profile'}.get(h,'detail')
                pg2.screenshot(path=S+f'p5_mobile_{fn}.png', full_page=False)
        chk(f'{name}（{vp["width"]}×{vp["height"]}）9 个主要页面：无横向溢出、按钮无遮挡', allok)
    pg2.set_viewport_size({'width':390,'height':844}); nav(pg2,'applications/'+target['id'],'[data-testid=posting-detail]')
    pg2.select_option('[data-testid=status-select]','offer'); pg2.click('[data-testid=status-apply]'); pg2.wait_for_timeout(300)
    chk('手机尺寸下可正常点击并更新状态', pg2.locator('[data-testid=history] li').count()==3)
    pg2.locator('[data-testid=status-card]').screenshot(path=S+'p5_mobile_status.png')
    nav(pg2,'applications/backup','[data-testid=backup-panel]'); pg2.screenshot(path=S+'p5_mobile_backup.png')
    c2.close()
for d in dirs: shutil.rmtree(d, ignore_errors=True)
print('RESULT', sum(ok), '/', len(ok)); sys.exit(0 if all(ok) else 1)
