/**
 * v1.10 招聘截图文字 → 岗位正文（纯本地启发式，不调用 AI，不补写任何内容）。
 * 流程：截图识别 → 原始文字保存（JobParse.ocrRawText）→ 本函数去掉网页噪声 → 用户查看 / 修改 → 岗位分析。
 * 只删除整行噪声；从「相似职位 / 推荐职位」等标题开始的其余部分属于其他岗位，整体去掉。
 */
const NOISE: RegExp[] = [
  /共(?:有|找到)?\s*\d+\s*(?:个|条)?(?:符合条件的)?(?:职位|岗位|结果)/,
  /^\d+\s*(?:个|条)?(?:职位|岗位|结果)$/,
  /^\d+\s*(?:人|位)?(?:已)?(?:投递|申请|浏览|查看|看过|沟通)/,
  /^(?:\d+\s*)?(?:applicants?|views?|results?|jobs? found)\b/i,
  /\b\d+\s+(?:applicants|people (?:clicked|applied)|results)\b/i,
  /^(?:首页|职位列表|全部职位|搜索|筛选|排序|登录|注册|分享|收藏|举报|立即投递|投递简历|申请职位|立即申请|返回|返回列表|上一页|下一页|查看更多|展开|收起|在线沟通|立即沟通|微信扫码|下载\s*APP|关注|已关注)\s*$/i,
  /^(?:Apply(?: now)?|Easy Apply|Save|Saved|Share|Sign in|Join now|Show (?:more|less)|See more|Report(?: this job)?|Follow|Back to (?:search|results)|Next|Previous|Home|Jobs)\s*$/i,
  /(?:\d+\s*(?:天|小时|分钟)前(?:发布|更新)?|刚刚发布|今日更新)$/,
  /^(?:posted|reposted)?\s*\d+\s*(?:days?|hours?|minutes?|weeks?)\s+ago\b/i,
  /^(?:Promoted|Actively recruiting|Be an early applicant)\s*$/i,
  /^[<>«»‹›|·•\-–—_=*~]+$/,
];
const OTHER_JOBS = /^(?:相似职位|相关职位|推荐职位|热门职位|其他职位|更多职位|猜你喜欢|看过该职位的人还看了|Similar jobs|People also viewed|Jobs you may be interested in|More jobs|Recommended jobs|Other jobs)(?:\s|[:：]|$)/i;

export function extractJdBody(raw: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const out: string[] = [];
  const lines = raw.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (OTHER_JOBS.test(l)) { removed.push(...lines.slice(i).map((x) => x.trim()).filter(Boolean)); break; }
    if (l && NOISE.some((re) => re.test(l))) { removed.push(l); continue; }
    out.push(lines[i].replace(/\s+$/, ''));
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
}
