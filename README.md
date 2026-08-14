# 中国灾害防御协会团体标准管理系统

面向协会内部使用的团体标准全过程管理系统，覆盖项目台账、15 个流程节点、待补材料、项目档案、办理记录、已发布标准库和标准化体系建设任务。

## 当前能力

- SQLite 统一数据库，刷新页面或更换浏览器后数据不丢失
- 管理员登录与服务器会话
- 项目新建、修改、流程推进和审核退回
- 待补材料确认、误报忽略、重新打开
- 真实文件上传、归档和下载
- 所有关键动作自动记录操作人和办理时间
- 项目台账、待补材料 CSV 导出
- 体系建设任务维护
- 后端不可用时自动进入本地演示模式

## 本地运行

需要 Node.js 24 或更高版本，不需要安装第三方依赖。

```powershell
$env:ADMIN_PASSWORD='请设置一个强密码'
node server.mjs
```

然后访问 <http://127.0.0.1:3000>，账号默认为 `admin`。

未设置 `ADMIN_PASSWORD` 时，本地开发默认密码为 `cadp123456`；生产环境会拒绝使用默认密码。

数据库和上传文件默认保存在 `.runtime`，该目录不会提交到 Git。备份时必须同时备份：

- `.runtime/cadp.db`
- `.runtime/uploads/`

## Docker 部署

```powershell
docker build -t cadp-standard-management .
docker run -d --name cadp-standard-management -p 3000:3000 -e ADMIN_PASSWORD='请设置一个强密码' -v cadp-data:/app/data cadp-standard-management
```

正式部署必须使用 HTTPS，并为 `/app/data` 配置持久化磁盘和定期备份。

## 部署说明

GitHub Pages 只能运行静态页面，不能运行 Node.js 后端或 SQLite。当前 GitHub Pages 可继续作为界面演示；正式数据库版本需要部署到支持 Node.js 和持久化磁盘的服务器、NAS 或云主机，并由该后端同时提供页面和接口。

详细设计见 [docs/系统设计.md](docs/系统设计.md)。

## 数据说明

项目和标准初始数据由现有材料目录整理形成。待补材料根据文件名称和当前流程环节自动比对，仅用于提示，仍需管理员人工确认。
