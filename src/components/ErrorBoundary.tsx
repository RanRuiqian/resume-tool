import { Component, type ReactNode } from 'react';

/**
 * 全局错误边界：任何界面渲染错误不再整页白屏，而是显示具体报错和恢复入口。
 * 数据都还在浏览器里（这里只是不让界面崩掉），不会清库。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('界面渲染错误', error, info.componentStack);
    try { localStorage.setItem('lastUiError', JSON.stringify({ at: new Date().toISOString(), message: error.message, stack: (error.stack ?? '').slice(0, 1500), component: (info.componentStack ?? '').slice(0, 800) })); } catch { /* 存不了也不影响显示 */ }
  }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    const detail = `${e.message}\n${(e.stack ?? '').split('\n').slice(1, 6).join('\n')}`;
    const backToStart = () => { try { localStorage.setItem('wizardStep', '2'); } catch { /* ignore */ } location.hash = '#wizard'; location.reload(); };
    return (
      <div className="notice error" role="alert" data-testid="error-boundary" style={{ margin: 24 }}>
        <h3>页面出错了（资料没有丢）</h3>
        <p>你的资料和简历都还保存在这个浏览器里，只是这个页面显示时出了错。可以先试下面的按钮；如果反复出现，把下面的错误信息复制发给开发者。</p>
        <div className="row">
          <button className="primary" onClick={() => location.reload()}>重新加载</button>
          <button onClick={backToStart}>回到第 2 步（岗位）</button>
          <button onClick={() => { navigator.clipboard?.writeText(detail).catch(() => undefined); }}>复制错误信息</button>
        </div>
        <pre className="small" data-testid="error-detail" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail}</pre>
      </div>
    );
  }
}
