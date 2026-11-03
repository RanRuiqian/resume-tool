# 预览 A4 边界 / 空白提示 + 右侧「快捷版式」加减按钮（演示模式，不调用 AI）
import os
from playwright.sync_api import sync_playwright
B=os.environ.get('E2E_BASE','http://localhost:4173/')
ok=[]
def chk(n,c): ok.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n, flush=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/google-chrome'),args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1500,'height':1000}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(B+'?demo#wizard'); pg.reload(); pg.wait_for_selector('[data-testid=a4-info]')
    info=lambda: pg.locator('[data-testid=a4-info]').first.inner_text()
    chk('预览显示 A4 边界、页数、已用比例与空白毫米数', 'A4 210×297' in info() and '空白约' in info() and pg.locator('[data-testid=a4-guides]').count()==1)
    v=lambda: pg.locator('[data-testid=mg-all-value]').inner_text()
    v0=v(); pg.click('[data-testid=mg-all-plus]'); pg.wait_for_timeout(300); v1=v()
    chk(f'页边距「＋」一次只加 0.5 mm（{v0} → {v1}）', float(v1.split('/')[0])-float(v0.split('/')[0])==0.5)
    pg.click('[data-testid=mg-all-minus]'); pg.click('[data-testid=mg-all-minus]'); pg.wait_for_timeout(300)
    chk('「−」两次回到比原值小 0.5 mm', float(v().split('/')[0])-float(v0.split('/')[0])==-0.5)
    b0=info(); pg.click('[data-testid=lh-plus]'); pg.wait_for_timeout(300)
    chk('行距加一点后，空白毫米数随之变化', info()!=b0)
    pg.locator('[data-testid=a4-bar] input').first.uncheck()
    chk('可关闭 A4 边界', pg.locator('[data-testid=a4-guides]').count()==0)
    chk('无页面报错', not errs); b.close()
print(f'{sum(ok)}/{len(ok)} passed'); assert all(ok)
