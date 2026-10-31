# P11 工科正式样式：版式页四卡选择、照片切换、缺照片提示、新老用户默认、三种窗口宽度截图。全部虚构数据（测试用途）。
import json, os, sys, tempfile
from playwright.sync_api import sync_playwright
B=os.environ.get('P11_BASE','http://localhost:4173/')  # 只测本地 preview，不读 E2E_BASE，避免误打线上
S=os.environ.get('P11_SHOT_DIR','/workspace/resume-tool/screenshots/'); A=os.environ.get('P11_OUT','/workspace/resume-tool/artifacts/p12/')
os.makedirs(S,exist_ok=True)
PH=open(os.path.join(A,'e2e_profile_photo.json')).read(); NP=open(os.path.join(A,'e2e_profile_nophoto.json')).read()
ok=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
PUT="""([store,row])=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction([store],'readwrite');t.objectStore(store).put(row);t.oncomplete=()=>{db.close();r()}}})"""
DEL="""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['state'],'readwrite');t.objectStore('state').delete('templateId');t.oncomplete=()=>{db.close();r()}}})"""
GETTPL="""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const g=db.transaction(['state']).objectStore('state').get('templateId');g.onsuccess=()=>{db.close();r(g.result&&g.result.value)}}})"""
def new(p,vp):
    d=tempfile.mkdtemp(prefix='chrome-p11-')
    c=p.chromium.launch_persistent_context(d,executable_path='/usr/bin/google-chrome',args=['--no-sandbox'],viewport=vp)
    pg=c.pages[0]; pg.errs=[]; pg.on('pageerror',lambda e:pg.errs.append(str(e))); return c,pg
def layout(pg):
    pg.goto(B+'#layout'); pg.reload(); pg.wait_for_selector('[data-preset]',state='attached',timeout=15000); pg.wait_for_timeout(500)
def active(pg): return pg.locator('[data-preset][aria-pressed=true]').evaluate_all('e=>e.map(x=>x.dataset.preset)')
with sync_playwright() as p:
    # 新用户：空库 → 工科经典
    c,pg=new(p,{'width':1366,'height':900}); pg.goto(B); pg.wait_for_timeout(1200)
    layout(pg)
    chk('新用户默认：CN 无照片（工科经典）', active(pg)==['cn-eng'] and pg.evaluate(GETTPL)=='tpl-eng')
    chk('四张样式卡片', pg.locator('[data-preset]').count()==4)
    pg.evaluate(PUT,['profile',{'id':'me','doc':json.loads(PH)}]); layout(pg)
    chk('导入资料后默认样式不变', active(pg)==['cn-eng'])
    st=pg.locator('[data-testid=preset-status]').inner_text()
    chk('状态行含 ATS 说明且不承诺通过所有 ATS', 'ATS' in st and '保证' not in st.replace('不保证',''))
    names={'cn-eng':'CN_无照片','cn-eng-photo':'CN_有照片','en-eng':'EN_NoPhoto','en-eng-photo':'EN_WithPhoto'}
    for k,n in names.items():
        pg.click(f'[data-preset={k}]'); pg.wait_for_timeout(600)
        chk(f'点击 {k} 后选中', active(pg)==[k])
        prev=pg.locator('.previews .preview-wrap').first
        pg.evaluate("document.querySelector('.nav').style.visibility='hidden'")
        prev.screenshot(path=os.path.join(A,f'preview_{n}.png'))
    pg.evaluate("document.querySelector('.nav').style.visibility=''")
    pg.click('[data-preset=cn-eng]'); pg.click('[data-testid=preset-photo-toggle]'); pg.wait_for_timeout(300)
    chk('照片切换：CN 无照片 → CN 有照片', active(pg)==['cn-eng-photo'])
    chk('有照片时不显示缺照片提示', pg.locator('[data-testid=photo-missing]').count()==0)
    pg.screenshot(path=S+'p12_layout_1366.png')
    pg.set_viewport_size({'width':768,'height':1000}); pg.wait_for_timeout(400); pg.screenshot(path=S+'p12_layout_768.png')
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(400); pg.screenshot(path=S+'p12_layout_390.png',full_page=True)
    ov=pg.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
    chk('390 宽度无横向溢出', ov)
    pg.set_viewport_size({'width':1366,'height':900})
    pg.evaluate(PUT,['profile',{'id':'me','doc':json.loads(NP)}]); layout(pg)
    chk('缺照片时显示提示', pg.locator('[data-testid=photo-missing]').count()==1)
    pg.screenshot(path=S+'p12_layout_photo_missing.png')
    chk('无页面报错', not pg.errs); c.close()
    # 老用户：已有资料、无模板记录 → 保持经典
    c,pg=new(p,{'width':1366,'height':900}); pg.goto(B); pg.wait_for_timeout(1200)
    pg.evaluate(DEL); pg.evaluate(PUT,['profile',{'id':'me','doc':json.loads(NP)}])  # 模拟升级前的老库：有资料、无模板记录
    layout(pg)
    chk('老用户（已有资料）不被改成工科样式', active(pg)==[] and pg.evaluate(GETTPL)=='tpl-classic'); c.close()
print(f'{sum(ok)}/{len(ok)} passed'); sys.exit(0 if all(ok) else 1)
