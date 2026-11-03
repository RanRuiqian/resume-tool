# 换设备备份（v3）：设置页导出含「密码加密 Key」的完整档案 → 新浏览器导入 → API 配置、Key、我的版式恢复。全部虚构 Key。
# 需要：npm run build && npx vite preview --port 4173；CHROMIUM_PATH；NO_PROXY=localhost,127.0.0.1
import json, os, tempfile, zipfile, shutil
from playwright.sync_api import sync_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:4173/')
KEY = 'sk-e2e-FAKE-backup-key-777'; PW = 'mock-pass-e2e'
ok = []
def chk(n, c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n, flush=True)
SEED = """k=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','templates'],'readwrite');const s=t.objectStore('settings');const g=s.get('settings');
 g.onsuccess=()=>{const now='2026-11-01T00:00:00.000Z';const p={id:'p-e2e',name:'模拟配置E2E',provider:'deepseek',baseUrl:'https://api.example.com',apiKey:k,model:'deepseek-chat',translateModel:'',visionModel:'',createdAt:now,updatedAt:now};
 s.put({...(g.result||{}),id:'settings',demoMode:false,setupDone:true,uiLang:'zh',ocrMode:'local',provider:'deepseek',baseUrl:p.baseUrl,apiKey:k,model:p.model,translateModel:'',visionModel:'',apiProfiles:[p],activeProfileId:p.id})};
 t.oncomplete=()=>{db.close();r()}}})"""
DUMP = """()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['settings','templates']);const a=t.objectStore('settings').get('settings');const b=t.objectStore('templates').getAll();
 t.oncomplete=()=>{db.close();r({s:a.result||null,t:b.result})}}})"""
dirs = []
def ctx_new(p):
    d = tempfile.mkdtemp(prefix='chrome-bk-'); dirs.append(d)
    c = p.chromium.launch_persistent_context(d, executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/google-chrome'), args=['--no-sandbox'], viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    pg = c.pages[0]; pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('dialog', lambda x: x.accept()); return c, pg
def settings(pg):
    pg.goto(B + '#settings'); pg.reload(); pg.wait_for_selector('[data-testid=backup-panel]', timeout=15000); pg.wait_for_timeout(300)
TMP = tempfile.mkdtemp(prefix='bk-e2e-')
with sync_playwright() as p:
    c, pg = ctx_new(p); pg.goto(B); pg.wait_for_timeout(1200)
    pg.evaluate(SEED, KEY)
    # 用快捷版式栏之外的方式造一个「我的版式」：直接写入一份模板
    pg.evaluate("""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const db=q.result;const t=db.transaction(['templates'],'readwrite');t.objectStore('templates').put({id:'my-e2e-tpl',name:'我的模拟版式',base:'classic',layout:'single'});t.oncomplete=()=>{db.close();r()}}})""")
    settings(pg)
    chk('设置页有备份面板，API 设置默认勾选、Key 默认不勾选', pg.is_checked('[data-testid=bk-settings]') and not pg.is_checked('[data-testid=bk-key]'))
    pg.check('[data-testid=bk-key]'); pg.fill('[data-testid=bk-pw]', PW); pg.fill('[data-testid=bk-pw2]', 'different')
    chk('两次密码不一致时提示', '不一致' in pg.locator('[data-testid=bk-pw-problem]').inner_text())
    pg.fill('[data-testid=bk-pw2]', PW)
    with pg.expect_download() as dl: pg.click('[data-testid=export-archive]')
    zp = os.path.join(TMP, 'a.zip'); dl.value.save_as(zp)
    with zipfile.ZipFile(zp) as z:
        allt = '\n'.join(z.read(n).decode('utf8', 'ignore') for n in z.namelist() if n.endswith('.json'))
        names = z.namelist(); man = json.loads(z.read('manifest.json'))
    chk('导出文件中没有明文 Key', KEY not in allt)
    chk('导出含 settings.json、keys.enc.json、templates.json', {'data/settings.json', 'data/keys.enc.json', 'data/templates.json'} <= set(names))
    chk('manifest 记录加密 Key 1 个、版本 3', man.get('encryptedKeys') == 1 and man.get('archiveVersion') == 3)
    chk('导出提示说明含加密 Key', '加密' in pg.locator('[data-testid=backup-msg]').inner_text())
    chk('导出无页面错误', not pg.errs)
    c.close()

    # ---------- 新设备：错误密码 ----------
    c2, pg2 = ctx_new(p); pg2.goto(B); pg2.wait_for_timeout(1200); settings(pg2)
    pg2.set_input_files('[data-testid=archive-file]', zp); pg2.wait_for_selector('[data-testid=archive-check]')
    chk('导入预览显示 API 设置与加密 Key 数', '1 个加密 Key' in pg2.locator('[data-testid=restore-settings-box]').inner_text())
    pg2.fill('[data-testid=restore-pw]', 'wrong-password'); pg2.click('[data-testid=restore-confirm]'); pg2.wait_for_timeout(1500)
    st = pg2.evaluate(DUMP)
    chk('密码错误：提示且不写入任何设置 / 模板', '密码不正确' in pg2.locator('[data-testid=backup-msg]').inner_text() and not (st['s'] or {}).get('apiProfiles') and not st['t'])
    # ---------- 正确密码 ----------
    pg2.fill('[data-testid=restore-pw]', PW)
    with pg2.expect_navigation(timeout=15000): pg2.click('[data-testid=restore-confirm]')
    pg2.wait_for_timeout(1500); st = pg2.evaluate(DUMP); s = st['s'] or {}
    chk('正确密码：恢复配置、Key 并设为启用', s.get('activeProfileId') == 'p-e2e' and s.get('apiKey') == KEY and s['apiProfiles'][0]['apiKey'] == KEY)
    chk('「我的版式」随备份恢复', any(t['id'] == 'my-e2e-tpl' for t in st['t']))
    settings(pg2)
    chk('刷新后设置页显示恢复的配置名（Key 脱敏，不显示明文）', '模拟配置E2E' in pg2.locator('body').inner_text() and KEY not in pg2.locator('body').inner_text())
    chk('导入流程无页面错误', not pg2.errs)
    c2.close()

    # ---------- 资料页入口 ----------
    c3, pg3 = ctx_new(p); pg3.goto(B + '#profile'); pg3.wait_for_timeout(1500)
    chk('「我的资料」页有「换设备 / 完整备份」入口', pg3.locator('[data-testid=profile-archive]').count() == 1)
    c3.close()
for d in dirs + [TMP]: shutil.rmtree(d, ignore_errors=True)
print(f'RESULT {sum(ok)} / {len(ok)}')
