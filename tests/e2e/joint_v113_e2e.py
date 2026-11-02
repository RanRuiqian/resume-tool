"""Full P2 synthetic browser acceptance; all external requests blocked except intercepted mock AI."""
import copy, json, os, shutil, tempfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
ROOT=Path(os.environ.get('P2_ROOT','/workspace/scratch/v113-p2')); SHOTS=ROOT/'screenshots';SHOTS.mkdir(parents=True,exist_ok=True)
F=json.loads((ROOT/'exports/fictional-joint-fixture.json').read_text()); PROFILE=F['p'];BASE=os.environ.get('E2E_BASE','http://localhost:4173/');checks=[];calls=[]
def check(name,condition):
 checks.append(bool(condition));print(('PASS ' if condition else 'FAIL ')+name,flush=True);assert condition,name
DUMP="""()=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,o={};const t=d.transaction(['profile','jobs','resumes','jdGroups','resumeVersions','applications','postings','artifacts']);for(const n of t.objectStoreNames){const a=t.objectStore(n).getAll();a.onsuccess=()=>o[n]=a.result}t.oncomplete=()=>{d.close();r(o)}}})"""
SEED="""p=>new Promise(r=>{const q=indexedDB.open('resume-tool');q.onsuccess=()=>{const d=q.result,t=d.transaction(['profile','settings'],'readwrite');t.objectStore('profile').put({id:'me',doc:p});t.objectStore('settings').put({id:'settings',demoMode:false,baseUrl:'https://api.deepseek.com',apiKey:'FAKE-P2-ONLY',model:'deepseek-flash',provider:'deepseek',uiLang:'zh',setupDone:true,ocrMode:'vision',visionModel:'mock-vision'});t.oncomplete=()=>{d.close();r()}}})"""
facts={b['id']:b for e in PROFILE['work']+PROFILE['projects'] for b in e['bullets']}
def ai(route):
 body=route.request.post_data_json;messages=body['messages'];text=messages[-1]['content'];calls.append(body)
 if 'image_url' in (route.request.post_data or ''): out='虚构截图：工程背景与装配验证，仅为模拟岗位资料。'
 elif 'JD：' in text:
  i=next(i for i,r in enumerate(F['group']['roles']) if r['name'] in text);out=F['jobs'][i]
 else:
  payload=json.loads(text.split('\n\n')[-1])
  if 'allowedIds' in payload:
   assert len(payload['targets'])==3
   out=copy.deepcopy(F['plan']); refs=payload['requirementRefs']; out['requirements']=[]
   for ref in refs:
    label=ref['text']['zh']; assessment='direct' if label=='工程背景' else 'transferable' if label=='装配验证' else 'learning' if '理论基础' in label else 'gap'
    evidence=['edu-1'] if label=='工程背景' else ['career-b1','core-b2'] if label=='装配验证' else [PROFILE['courses'][0]['id']] if '理论基础' in label else []
    out['requirements'].append({'requirementId':ref['id'],'text':label,'tier':ref['tier'],'assessment':assessment,'evidenceIds':evidence,'reason':'课程内容支持流程优化知识，但不证明供应商开发实操。' if assessment=='learning' else '基于所引事实判断；缺少的实际经验保持缺口，不编造。'})
   common=[r['id'] for r in refs if r['text']['zh']=='工程背景'];rest=[r['id'] for r in refs if r['text']['zh']!='工程背景']
   out['jointSummary']={'common':[{'requirementIds':common,'reason':'各岗共同需要工程背景。'}],'complementary':[{'requirementIds':[r],'reason':'各岗位独立要求，按真实证据兼顾。'} for r in rest],'conflicts':[{'requirementIds':[rest[0],rest[-1]],'reason':'岗位方向存在差异，当前缺少 PLC 实操，单份简历不能同时强匹配。'}]}
  elif 'facts' in payload: out={'items':[{'sourceId':x['sourceId'],'text':x['text']} for x in payload['facts']]}
  else: out={'items':[{'sourceId':x['sourceId'],'text':facts[x['sourceId']]['en']} for x in payload['items']]}
 route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':out if isinstance(out,str) else json.dumps(out,ensure_ascii=False)}}]}))
with tempfile.TemporaryDirectory(prefix='p2-joint-isolated-') as folder, sync_playwright() as p:
 c=p.chromium.launch_persistent_context(folder,executable_path=shutil.which('chromium'),args=['--no-sandbox'],service_workers='block',viewport={'width':1440,'height':1000},accept_downloads=True)
 pg=c.pages[0];errors=[];unexpected=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('dialog',lambda d:d.accept())
 def block(r):
  if urlsplit(r.request.url).hostname in ['localhost','127.0.0.1','::1']:r.continue_()
  else:unexpected.append(urlsplit(r.request.url).hostname);r.abort()
 c.route('**/*',block);c.route('https://api.deepseek.com/**',ai)
 pg.goto(BASE);pg.wait_for_timeout(500);pg.evaluate(SEED,PROFILE);pg.evaluate("localStorage.setItem('wizardStep','2')");pg.reload();pg.wait_for_selector('[data-testid=joint-mode]');pg.click('[data-testid=joint-mode]');pg.wait_for_selector('[data-testid=joint-company]')
 pg.fill('[data-testid=joint-company]',F['group']['company']);pg.get_by_role('button',name='+ 添加岗位（最多三个）').click();pg.get_by_role('button',name='+ 添加岗位（最多三个）').click()
 check('显式联合模式最多三个岗位，单岗位模式保留',pg.locator('[data-testid=joint-role]').count()==3 and pg.get_by_role('button',name='+ 添加岗位（最多三个）').is_disabled() and pg.get_by_role('button',name='单岗位模式',exact=True).is_enabled())
 for i,r in enumerate(F['group']['roles']):
  card=pg.locator('[data-testid=joint-role]').nth(i);card.locator('[data-testid=joint-role-name]').fill(r['name']);card.locator('[data-testid=joint-role-text]').fill(r['text']);card.locator('input[type=url]').fill(r['url'])
 pg.set_viewport_size({'width':390,'height':844});check('移动端三 JD 输入无页面横向溢出',pg.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));pg.screenshot(path=str(SHOTS/'three-jd-mobile.png'),full_page=True);pg.set_viewport_size({'width':1440,'height':1000})
 pg.screenshot(path=str(SHOTS/'three-jd-input.png'),full_page=True)
 pg.get_by_role('button',name='解析全部并准备联合生成',exact=True).click();pg.wait_for_selector('[data-testid=joint-ready]')
 data=pg.evaluate(DUMP);check('三份 JD 各自解析保存，联合快照独立',len([j for j in data['jobs'] if not j.get('joint')])==3 and len([j for j in data['jobs'] if j.get('joint')])==1)
 count=len(calls);pg.get_by_role('button',name='解析全部并准备联合生成',exact=True).click();pg.wait_for_selector('[data-testid=joint-ready]');check('未变化的三份 JD 复用，不重复 Pro 调用',len(calls)==count)
 pg.get_by_role('button',name='生成共同简历 →',exact=True).click();pg.wait_for_selector('[data-testid=evidence-report]',timeout=60000)
 check('只生成一份共同简历且每岗均有独立报告',len(pg.evaluate(DUMP)['resumes'])==1 and pg.locator('[data-testid=role-evidence-report]').count()==3)
 check('共同、互补、冲突与知识边界可见',pg.locator('[data-testid=joint-conflict]').count()==1 and '仅课程知识支持，实践仍有缺口' in pg.locator('[data-testid=evidence-report]').inner_text() and 'inferred' in pg.locator('[data-testid=evidence-report]').inner_text())
 check('固定简介、工作/校园和课程保留，成绩/工具链接默认隐藏','轮机工程本科背景' in pg.locator('.previews').inner_text() and '学生会' in pg.locator('.previews').inner_text() and 'MOCK-UG-GRADE' not in pg.locator('.previews').inner_text() and 'example.com/resume-tool' not in pg.locator('.previews').inner_text())
 check('选材、写作、本地化各一次，无额外联合 Pro 轮次',len(calls)-count==3)
 pg.screenshot(path=str(SHOTS/'common-resume-zh.png'),full_page=True);pg.get_by_role('button',name='English',exact=True).click();check('英文保留 Marine Engineering，不编造 PLC 能力','Marine Engineering' in pg.locator('.previews').inner_text() and 'proficient' not in pg.locator('.previews').inner_text());pg.screenshot(path=str(SHOTS/'common-resume-en.png'),full_page=True)
 pg.locator('[data-testid=evidence-report]').scroll_into_view_if_needed();pg.screenshot(path=str(SHOTS/'per-role-evidence.png'),full_page=True)
 before=copy.deepcopy(pg.evaluate(DUMP)['profile']);pg.click('[data-testid=link-shared-resume]');pg.wait_for_function("document.querySelector('[data-testid=shared-link-result]')?.textContent.includes('已关联')")
 pg.set_viewport_size({'width':390,'height':844});check('移动端报告与完整版本 ID 无页面横向溢出',pg.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));pg.set_viewport_size({'width':1440,'height':1000})
 d=pg.evaluate(DUMP);version=d['resumeVersions'][0];check('三个申请引用完全相同的一份不可变版本',len(d['resumeVersions'])==1 and len(d['applications'])==3 and all(a['resumeVersionId']==version['id'] for a in d['applications']) and all(a['versionId']==version['id'] and not a.get('resume') for a in d['artifacts']))
 check('只记录待投递，不伪造申请时间，母库不变',all(a['status']=='pending' and not a.get('appliedAt') for a in d['applications']) and d['profile']==before)
 pg.click('[data-testid=link-shared-resume]');pg.wait_for_timeout(400);check('重复关联幂等，不建立重复申请/版本',len(pg.evaluate(DUMP)['applications'])==3 and len(pg.evaluate(DUMP)['resumeVersions'])==1)
 with pg.expect_download() as download:pg.get_by_role('button',name='下载逐岗证据报告').click()
 downloaded=download.value;downloaded.save_as(str(ROOT/'evidence-browser.json'));check('可下载三岗报告',len(json.loads((ROOT/'evidence-browser.json').read_text())['targets'])==3)
 # Force only one JD revision; prior edited resume stays intact and other JD IDs remain stable.
 old_resume=copy.deepcopy(d['resumes'][0]);pg.get_by_role('button',name='← 换个岗位',exact=True).click();pg.wait_for_selector('[data-testid=joint-role]');pg.locator('[data-testid=joint-role]').first.get_by_role('button',name='强制重新解析（新版本）').click();pg.wait_for_function("document.querySelector('[data-testid=joint-role]')?.textContent.includes('解析版本 2')")
 pg.get_by_role('button',name='解析全部并准备联合生成').click();pg.wait_for_selector('[data-testid=joint-ready]');pg.get_by_role('button',name='生成共同简历 →').click();pg.wait_for_selector('[data-testid=previous-resume-retained]');d=pg.evaluate(DUMP)
 check('独立重新解析保存新版本，旧共同简历与冻结版本不被覆盖',len([j for j in d['jobs'] if not j.get('joint')])==4 and d['resumes'][0]==old_resume and d['resumeVersions'][0]==version)
 # Each record can export the same canonical bilingual content with frozen template.
 pg.get_by_role('button',name='查看求职记录 →').click();pg.wait_for_selector('[data-testid=posting-row]');pg.locator('[data-testid=posting-row]').first.locator('a,button').first.click();pg.wait_for_selector('[data-testid=shared-version-id]');check('申请详情可追溯共同版本 ID',version['id'] in pg.locator('[data-testid=shared-version-id]').inner_text())
 with pg.expect_download(timeout=60000) as dl:pg.get_by_role('button',name='按快照导出 PDF/Word',exact=True).click()
 dl.value.save_as(str(ROOT/'shared-version-browser.zip'));check('申请详情可导出同一冻结版本中英 PDF/Word',dl.value.suggested_filename.endswith('.zip'))
 check('无页面错误、真实网络请求或界面 Key',not errors and not unexpected and 'FAKE-P2-ONLY' not in pg.locator('body').inner_text())
 c.close()
print(f'{sum(checks)}/{len(checks)} passed')
