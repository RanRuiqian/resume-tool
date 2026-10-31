# 备份与恢复（BACKUP_RESTORE）

入口：求职投递 → 备份与恢复。

## 完整档案（ZIP）
```
manifest.json            format=resume-tool-archive, version=1, dbVersion, counts, attachmentFiles(含 sha256), excluded
data/profile.json        资料
data/postings.json  applications.json  events.json  artifacts.json  attachments.json  jobs.json  resumes.json
attachments/<id>/<文件名> 附件原文件
```
**永不导出**：API Key 和整个设置表。导出时还会递归删除名为 apiKey / token / secret / password / authorization 的字段。

## 恢复流程
1. 选择 ZIP → 先完整校验，不写任何数据。
2. 显示错误与警告：缺失附件、校验失败（SHA-256 不符）、孤立记录、ID 已存在等。
3. 可只勾选部分内容恢复；资料默认不覆盖，勾选「替换资料」时先自动快照当前资料。
4. 在**单个事务**中写入，任何一步失败整体回滚，原数据不变。

## 轻量 JSON
只含结构化记录（不含附件二进制），便于交给其他工具或 AI 查看。同样不含 Key。

## 导入投递记录（不同于恢复）
CSV / JSON / ran-application-handoff：预览 → 去重（链接、公司+岗位+城市、相似）→ 每行选择跳过 / 合并 / 新建 → 确认 → 单事务写入。同一文件重复导入不会产生重复（`importKeys`）。未知状态不会被猜成「已投递」，原文保存在备注里。

## 注意
浏览器数据不会同步到 GitHub，也不会同步到其他设备；换电脑请用 ZIP 完整档案。
