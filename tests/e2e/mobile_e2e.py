# iPhone 尺寸（390 / 360 宽）浏览器验收：无横向溢出、第 3 步预览 / 素材库标签、预览按宽度缩放、点按尺寸、输入框不触发 iOS 自动放大（全部使用演示模式，不调用 AI）
import os
from playwright.sync_api import sync_playwright
B=os.environ.get('E2E_BASE','http://localhost:4173/'); S=os.environ.get('SHOT_DIR','/tmp/mob/e2e/'); os.makedirs(S,exist_ok=True)
ok=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
OVER="()=>{const W=innerWidth;return document.documentElement.scrollWidth>W+1}"
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/google-chrome'),args=['--no-sandbox'])
    for W in (390,360):
        c=b.new_context(viewport={'width':W,'height':800},device_scale_factor=2,is_mobile=True,has_touch=True,user_agent=UA)
        pg=c.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        for name,h in [('wizard','#wizard'),('applications','#applications'),('profile','#profile'),('layout','#layout'),('settings','#settings'),('advanced','#advanced')]:
            pg.goto(B+'?demo'+h); pg.reload(); pg.wait_for_timeout(900)
            chk(f'{W}px {name}：无横向溢出', not pg.evaluate(OVER))
            if W==390: pg.screenshot(path=f'{S}{name}.png',full_page=True)
        # 第 3 步
        pg.goto(B+'?demo#wizard'); pg.reload(); pg.wait_for_selector('[data-testid=m-tabs]')
        chk(f'{W}px 第 3 步：有「简历预览 / 编辑素材」标签，默认显示预览、隐藏素材库', pg.locator('.previews').first.is_visible() and not pg.locator('.pool').first.is_visible())
        box=pg.locator('.preview-wrap').first.bounding_box()
        chk(f'{W}px 预览按屏幕宽度缩放，不被截断', box and box['x']>=0 and box['x']+box['width']<=W+0.5)
        pg.click('[data-testid=m-tab-pool]'); pg.wait_for_timeout(200)
        chk(f'{W}px 切到「编辑素材」：显示素材库、隐藏预览', pg.locator('.pool').first.is_visible() and not pg.locator('.previews').first.is_visible() and not pg.evaluate(OVER))
        pg.click('[data-testid=m-tab-preview]'); pg.click('[data-testid=m-zoom]'); pg.wait_for_timeout(200)
        chk(f'{W}px 「放大看」只在预览区内横向滑动，页面本身不溢出', not pg.evaluate(OVER))
        # 点按尺寸 / iOS 输入放大
        pg.goto(B+'?demo#settings'); pg.reload(); pg.wait_for_timeout(800)
        navh=pg.evaluate("()=>Math.min(...[...document.querySelectorAll('.nav button')].map(x=>x.getBoundingClientRect().height))")
        chk(f'{W}px 导航按钮高度 ≥ 40px（实测 {navh:.0f}）', navh>=40)
        fs=pg.evaluate("()=>Math.min(...[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select,textarea')].map(x=>parseFloat(getComputedStyle(x).fontSize)))")
        chk(f'{W}px 输入框字号 ≥ 16px，iOS 聚焦不会自动放大页面（实测 {fs:.0f}）', fs>=16)
        lh=pg.locator('label.check').first.bounding_box()['height']
        chk(f'{W}px 设置页「演示模式」说明不再被挤成竖排（高度 {lh:.0f}）', lh<150)
        chk(f'{W}px 无页面报错', not errs)
        c.close()
    b.close()
print(f'{sum(ok)}/{len(ok)} passed'); assert all(ok)
