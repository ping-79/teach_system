# 教学资料系统 V1

面向 NAS 部署的教学资料 Web 系统，当前版本已实现：

- 教师工号登录与首次改密
- 管理员创建教师账号
- 学期管理
- 课表 `.xls/.xlsx` 导入
- 自动生成课程卡片
- 教学进度计划表自动生成、编辑、保存、导出
- 实践进度计划数据页
- 课程内容资料库导入与确认
- DeepSeek 辅助解析和智能校验接口

## 技术栈

- Node.js 24
- Express
- Prisma
- SQLite
- EJS
- Docker Compose

## 本地启动

1. 安装依赖：`npm install`
2. 生成 Prisma Client：`npx prisma generate`
3. 初始化本地数据库：`npx prisma db push`
4. 创建管理员账号：`npm run prisma:seed`
5. 启动开发服务：`npm run dev`

默认管理员账号：

- 用户名：`admin`
- 初始密码：`.env` 里的 `ADMIN_INITIAL_PASSWORD`

## NAS 部署

当前部署方式为单容器模式，和 `/volume3/docker/jiao_an` 类似：

- 一个 `web` 容器
- 一个 NAS 目录挂载到 `/app/data`
- SQLite 数据文件保存在 `data/teaching_materials.db`

启动命令：

```bash
docker compose up -d --build
```

默认访问地址：

- `http://你的NAS地址:3001/login`

## 数据目录

应用运行后会在 `data` 下使用这些目录或文件：

- `data/teaching_materials.db`
- `data/uploads`
- `data/exports`
- `data/sessions`

## DeepSeek 配置

在 `.env` 或 `docker-compose.yml` 环境变量里配置：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

如果暂时不接 DeepSeek，系统也能正常运行；只会退化为规则解析和规则校验。
