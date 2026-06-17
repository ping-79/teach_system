# CLAUDE.md — 教学管理系统 项目说明与决策记录

> 本文件供 Claude Code / 开发者每次进入项目时快速了解全局。记录架构、约定、运维、
> 重大决策、踩过的坑、被否决的方案。**严禁在本文件写入任何真实密钥/密码/授权码**
> （本文件会推送到 GitHub）。机密一律存放在 .gitignore 的文件中（见「机密管理」一节）。

---

## 1. 项目概览

- **用途**：江西某建设类高职院校（人居环境与艺术学院；含「样式雷」协会、全省双高古建专业群）的**教学管理系统**。
- **使用规模**：约 100 名教师自助录入。
- **AI 能力**：接入 **DeepSeek** 大模型（内容解析、业绩结构化、计划 AI 审阅等）。所有 AI 功能都要可降级（无 AI/无 OCR 时走启发式或手填）。
- **运行环境**：
  - 当前代码在**开发电脑**（Windows 11 家庭版）上。
  - 生产将部署在**另一台 Windows Server 机器**（用户称「2020」，实际应为 2019/2022）。
  - 数据库是单文件 SQLite，**备份是命门**。
- **代码仓库**：https://github.com/ping-79/teach_system （分支 `master`）。

---

## 2. 系统架构

两个独立进程，门户 + 附属子系统：

```
┌─ main-app（统一门户，端口 3001）─ Node/Express + EJS + Prisma + SQLite ─┐
│   教学进度计划表 / 教师档案 / 业绩量化 / 数据统计看板 / 课程资料库          │
│   教案生成（只是一个页面外壳，内容用 iframe 嵌入下面的 jiaoan）            │
└──────────────────────────────────────────────────────────────────────┘
            │ iframe 嵌入 http://127.0.0.1:3100/jiaoan/
┌─ jiaoan（教案生成引擎，端口 3100）─ NestJS + Python(python-docx) ───────┐
│   DeepSeek + 模板，生成教案 docx                                         │
└──────────────────────────────────────────────────────────────────────┘
```

**关键点**：
- 新建的模块（教师档案、业绩量化、统计看板）**全部整合在 main-app 一个进程内**，不新增进程。
- jiaoan 因技术栈不同（NestJS + Python），**保持独立进程、用 iframe 嵌入**，不并入 main-app。
- 因此系统始终是 **2 个进程**（main-app + jiaoan）。开机自启用 nssm 解决（见运维）。

### 启动方式
- 开发期手动：根目录 `启动-main-app.cmd`、`启动-jiaoan.cmd`。
- 生产：用 `ops/` 下的 nssm 脚本注册成 Windows 服务，开机自动拉起，无需手动点 cmd。

---

## 3. 技术栈与代码约定

### main-app
- Node 24 + Express 5 + EJS + Prisma 6 + SQLite，端口 3001，配置走 `main-app/.env`（dotenv）。
- **Prisma 约定**：`Int @id @default(autoincrement())`；JSON 以字符串存、字段名加 `*Json` 后缀；
  状态枚举大写、类型枚举小写；每个模型都有 `createdAt/updatedAt`。
- **算分引擎**（`src/services/scoring.js`）：配置驱动（ScoringScheme/ScoringItem，规则即数据）；
  无配置时用启发式表 `级别×等次→分 × 排序系数 → 组内就高不就低 → 分组封顶`。
  排序系数 `[1, 0.75, 0.5, 0.375, 0.3]`，其余 0.2。有效分优先级 `final ?? prelim ?? self ?? computed`。
- **OCR 流程**（`src/services/ocr.js`）：上传扫描件 → OCR → DeepSeek 结构化 → 草稿预填 → **教师确认**
  （绝不盲信，原件留证）。可插拔 provider，`OCR_PROVIDER` 空时降级为手填。**已接入百度 OCR**。
- **复核流**：DRAFT → SUBMITTED → PRELIM_REVIEWED → FINAL_REVIEWED（或 REJECTED）。v1 管理员统一复核，
  部门复核员角色留到 v2。
- **统计图**：纯 CSS 条形图，宽度由服务端按数据算出百分比，无图表库。

### jiaoan
- NestJS（**本仓库里只有编译产物 `dist/`，没有 TS 源码**：无 `src/`、`tsconfig.json`、`nest-cli.json`，
  故 `pnpm build`（=nest build）在本机**跑不起来**。源码在别处，疑似 Coze 平台生成，见依赖 `coze-coding-dev-sdk`）+ Python（docx 生成）。
- **`dist/` 已 gitignore**：`git clone` 到服务器**不会带 dist**，又无法在本机 build。
  → 部署 jiaoan 必须**把 `dist/` 文件夹整个拷贝到服务器**（连同 `node_modules` 经 `pnpm install` 重建）。
- 改 jiaoan 行为只能直接改 `dist/*.js`（无源码可重编译；这儿也不会被 build 覆盖，改动会保留，但若日后从原始源码重新生成 dist 会丢失）。
- 读 DeepSeek key 的顺序（`dist/jiaoan/deepseek.client.js` 的 `resolveApiKey`）：
  ① 环境变量 `DEEPSEEK_API_KEY` → ② `DEEPSEEK_API_KEY_FILE` 指向的文件 → ③ 自动搜名为 `deepseek_api_key.txt` 的文件。

### 视觉主题（样式雷 / 故宫文创风）
- 调色板：宫墙红 `#9B2D26` + 鎏金 `#C99A3B/#E0B354` + 宣纸米 `#FBF7EF` + 墨黑 `#211C18` + 官式青绿 `#2F5D62`。
- 衬线标题（Noto Serif SC）+ 无衬线正文。已实现进 `public/styles/app.css` 与各 partials。
- 学院名「人居环境与艺术学院」**已确认正确**，勿改。

---

## 4. 已实现功能（Phase 1 已完成并真机验证）

教师档案 + 业绩量化模块：
- 数据层：`TeacherProfile` +18 可空字段；新增 `Credential / Achievement / AchievementAttachment /
  ScoringScheme / ScoringItem / TitleApplication` + 配套枚举（通过 `prisma db push`）。
- 服务层：`scoring.js`、`ocr.js`、`achievement-ai.js`（DeepSeek 结构化 + 正则兜底）、`achievement-constants.js`。
- 路由：`teacher-profile.js`、`achievements.js`（列表/录入/OCR预填/增删改/提交 + 管理员复核 + 统计）。
- 视图：teacher-profile 与 achievements 下共 7 个 EJS 页（评分概览卡、分类 Tab、朱红印章、OCR 两步录入、
  统计看板、复核队列、管理员列表）。

---

## 5. 运维部署（`ops/` 目录）

### 5.1 开机自启（nssm）
- `ops/install-services.ps1`：管理员运行；自动下载 nssm 到 `ops/nssm/`；注册两个服务并启动：
  - `TeachingMainApp`（显示名「教学管理系统-主应用(3001)」）：`node src\server.js`，工作目录 main-app。
  - `TeachingJiaoan`（「教学管理系统-教案服务(3100)」）：`node dist\main.js -p 3100`，工作目录 jiaoan，
    **环境变量从根目录 `启动-jiaoan.cmd` 解析**（单一来源，含 `%~dp0` 展开），自动启动 + 崩溃重启 + 日志轮转。
- `ops/uninstall-services.ps1`：停止并删除两个服务。
- 脚本路径用 `$PSScriptRoot` 相对推导，**可移植**：文件夹放到服务器任何位置都能用，无需改路径。
- 文档：`ops/README-服务.md`。

### 5.2 数据库备份（三层）
最终方案（见决策记录与「被否决方案」）：

```
第一层（脚本，已做+实测）：服务器本机每天 VACUUM INTO 生成一致快照 → 存本机文件夹 $BackupDest
第二层（群晖工具，部署时配）：用 Active Backup for Business 或 Synology Drive 把该文件夹同步到 NAS
第三层（加密邮件，建设中）：每周把【加密后】的备份用 163 邮箱 SMTP 发到邮箱
```

- `ops/backup-database.js`：用 Node 内置 `node:sqlite` 的 `VACUUM INTO` 生成**一致快照**（不可直接复制运行中的 .db；
  WAL 模式下直接复制会漏数据）。已实测：147KB 源库生成可正常打开的 147KB 快照。
- `ops/backup-database.ps1`：编排（生成快照 → 带时间戳存到 `$BackupDest` 本地文件夹 → 保留 N 天 → 写
  `ops/logs/backup.log`）。**`$BackupDest` 填本机文件夹（如 `D:\db-backups`），不要直接写 NAS。**
- `ops/register-backup-task.ps1`：注册每日 03:00 的 `TeachingDbBackup` 计划任务；因只写本地，用默认 `SYSTEM` 账户即可。
- 文档：`ops/README-数据库备份.md`（含恢复步骤：停 main-app → 用某备份替换 `main-app/data/teaching_materials.db` → 启服务）。
- **加密邮件**（建设中）：用单文件版 `7zr.exe` 做 AES-256 加密（`-mhe=on` 连文件名一起加密），再用
  **nodemailer**（不是 .NET SmtpClient，见踩坑）发 163 SMTP（`smtp.163.com:465` SSL）。

### 5.3 部署到新服务器的清单（关键，从干净机器开始）
1. 拿到代码：`git clone`（别拷 node_modules）。
2. 装 Node.js 24.x（默认 `C:\Program Files\nodejs\`）。
3. 装 Python（jiaoan 的 docx 生成需要）。
4. 装依赖：main-app `npm install`；jiaoan `pnpm install`。
5. **拷贝 jiaoan 的 `dist/`**：本仓库无 jiaoan 源码、无法 build，且 `dist/` 已 gitignore（git clone 不会带过去）。
   → 必须把开发机的 `jiaoan/dist/` 整个**拷贝**到服务器对应位置（否则 jiaoan 起不来；不影响主应用）。
6. **重建机密文件**（都已 gitignore，不会随 git 过去）：`main-app/.env`、`jiaoan/deepseek_api_key.txt`、
   备份加密密码文件、163 邮箱配置。
7. 初始化数据库：main-app `npm run prisma:generate` + `npm run prisma:migrate`（或把现有 .db 拷过去）。
8. 管理员运行 `ops/install-services.ps1` 注册开机自启。
9. 配置备份：填 `backup-database.ps1` 的 `$BackupDest`（本地文件夹）→ 跑一次 → 注册计划任务 → 在群晖配 Active Backup/Drive 同步到 NAS。
10. 防火墙：如需局域网访问，放行 3001/3100。

---

## 6. 机密管理（重要）

**所有真实密钥/密码/授权码只存在 .gitignore 的文件里，绝不进版本库、绝不写进本文件。**

| 机密 | 存放位置（已 gitignore） | 谁读它 |
|---|---|---|
| DeepSeek API Key（main-app） | `main-app/.env` | main-app（dotenv） |
| DeepSeek API Key（jiaoan） | `jiaoan/deepseek_api_key.txt` | jiaoan，经 `启动-jiaoan.cmd` 里的 `DEEPSEEK_API_KEY_FILE` 指向 |
| 百度 OCR Key/Secret | `main-app/.env`（`OCR_PROVIDER=baidu` 等） | main-app |
| 备份加密密码（7-Zip） | `ops/` 下 gitignore 的密码文件 | 备份脚本 |
| 163 邮箱授权码 | `ops/` 下 gitignore 的配置文件 | 发件脚本 |

`.gitignore` 已忽略：`node_modules/`、`.env*`、`deepseek_api_key.txt`、`**/deepseek_api_key.txt`、
SQLite 库与 uploads/exports、jiaoan/dist 等、`*.log`、`新建文件夹/`。

**历史遗留安全问题**：DeepSeek 旧 key 曾以明文写在 `启动-jiaoan.cmd` / `main-app/启动-jiaoan.cmd` 里并被
推上 GitHub；已改为通过 `DEEPSEEK_API_KEY_FILE` 指向 gitignore 文件，新 key 不再进库。**旧 key 仍在 git 历史中**，
用户将在确认系统一切正常后到 DeepSeek 后台**吊销旧 key**（吊销后历史里的旧 key 即作废）。

---

## 7. 重大决策记录（含理由）

1. **扩展 main-app 为统一门户**，新模块 = 新 Prisma 模型 + 路由 + 视图；不另起新应用（保持现有功能不受影响）。
2. **jiaoan 保持独立、iframe 嵌入**，不并入 main-app（技术栈不同，重写不值）。
3. **开机自启用 nssm**（见「被否决方案」对比）：零代码改动、单文件、最省心，适合单机低负载、非专业维护。
4. **数据库三层备份**：本地 VACUUM INTO + 群晖工具同步 NAS + 加密邮件。理由：3-2-1 备份原则，单文件 SQLite 必须重点保护。
5. **NAS 走外网**：生产服务器与 NAS **不在同一局域网**，通过域名 `aigc.i234.me`（群晖）相连。
   实测该域名只开放 DSM(5000/5001) 与 SSH/SFTP(22)，**SMB(445) 未开放**（也不应开放到公网）。
   故备份不能走 SMB 文件共享，改为「本机生成 + 群晖工具同步」。用**域名而非 IP**正确（IP 会变、域名不变）。
6. **U 盘备份取消，改为加密邮件**：邮件全自动、异地、无实物可丢；DB 很小（~147KB），远低于邮箱附件上限。
7. **备份一律加密**（7-Zip AES-256）：发邮件/存外部介质前先加密，邮箱被盗也只是乱码。
   **密码绝不与备份放一起**，存服务器 + 用户另抄一份。
8. **与 Codex 协作（串行+稳妥）**：Claude 设计规格 + 审查 + 验证，Codex 编码，用户验收（省 token）。
   一次主线做一个功能、审查后再下一个；可并行一个零冲突的纯运维任务。
9. **学院名「人居环境与艺术学院」确认正确**。
10. **每完成一个任务自动 git commit**：已在 `.claude/settings.json` 配 TaskCompleted 钩子；push 由用户决定。

---

## 8. 踩过的坑（及解决）

- **Codex 后台模式失败**：`codex exec` 用后台（run_in_background）模式产出 0 字节、退出码 255。
  → **改用前台调用**：`codex exec -s read-only|workspace-write -C <dir> -`（长提示用 stdin 管道）。
  无害报错可忽略：`failed to refresh available models: timeout`、`websocket handshake eof`（会自动降级 HTTP）。
- **PowerShell 内联 JS 引号被破坏**：在 `node -e "..."` 里嵌反引号/双引号会被 PowerShell 解析坏。
  → **把脚本写成临时 `.js` 文件再 `node 文件`**。
- **DeepSeek key 泄露**：明文进了两个 `.cmd` 并推上 GitHub。→ 改 `DEEPSEEK_API_KEY_FILE` + gitignore（见机密管理）。
- **NAS 公网只开部分端口**：`aigc.i234.me` 实测 445 不通、5000/5001/22 通 → 备份方案随之改为两层/三层。
- **备份脚本静默失败隐患**：Codex 初版在 NAS 不可达时 `exit 0`（计划任务显示「成功」，实则没备份）。
  → 审查时改为**报错 `exit 1`**，让失败可见。（后因改为只写本地，此风险进一步降低。）
- **register 脚本缺管理员检测**：Codex 漏了，审查时补上；并修正 `SYSTEM` 账户说明
  （注册系统服务/计划任务需管理员）。
- **`main-app/启动-jiaoan.cmd` 是坏掉的重复文件**：它 `cd` 到不存在的 `main-app\jiaoan`，从来没法用，且也存了旧 key。
  → 已移除其中明文 key；**建议直接删除该重复文件**（待办）。
- **.NET 发 163 邮件不可靠**：`System.Net.Mail.SmtpClient` / `Send-MailMessage` 不支持 465 隐式 SSL，163 又主要用 465。
  → **用 nodemailer**（node 已在用）发信。
- **BitLocker 不可用**：开发机是 Windows 11 **家庭版**，无法加密 U 盘（需专业版/服务器版）。→ 选 7-Zip AES-256（跨版本、可脚本化）。
- **jiaoan 教案文件名中文乱码（双层 mojibake）**：上传文件名经 multer 按 latin1 误读成乱码，且本例叠了**两层**
  （UTF-8→latin1→UTF-8→latin1，显示成 `Ã¥Â±Â…`）。jiaoan 原有的修复函数 `normalizeDisplayText`
  （`dist/jiaoan/jiaoan.service.js`）只反解**一层**、且「CJK 没增加就放弃」，双层乱码反解一次后仍是乱码（CJK 仍为 0）→ 放弃 → 退回原样。
  → 改为**循环反解**（最多 4 次，遇 U+FFFD 即停以保护合法拉丁文名，按 CJK 最多者取）；单/双层乱码都能修，正常中文/英文/重音名（café）不受损。
  该函数在读历史记录时也会调用，故**已生成的历史名也会在显示时一并修正**。已用「加载磁盘真身函数」单测 6 例全过 + jiaoan 正常启动验证。
  **注意**：改在编译产物 `dist/` 里（无源码），`dist/` 已 gitignore → 此修复不在版本库，靠部署时拷贝 dist 带过去；若日后从原始源码重新生成 dist 需重打此补丁。
- **移动/复制项目文件夹会断 jiaoan 的 pnpm 链接**：项目曾从 `D:\Desktop\服务器部署` 挪到 `D:\Desktop\works\服务器部署`。
  pnpm 的 `node_modules` 用**写死绝对路径的 Junction**（链接到 `.pnpm` 仓库），文件夹一搬，链接全指向旧地址、全断，
  jiaoan 启动报 `Cannot find module '@nestjs/core'`。main-app 用 npm（相对结构），搬家不受影响，故只 jiaoan 中招。
  → **在 jiaoan 重跑 `pnpm install`** 即可重建链接（非交互环境需先 `set CI=true`，否则报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）。
  本地缓存在时秒级完成。**部署铁律：node_modules 绝不能直接拷贝，必须在目标机 `pnpm install`。** 已实测修复，两个模块均正常。
- （早期）**`prisma generate` EPERM**：DLL 被运行中的服务占用 → 先停服务/杀 node 再 generate。
- （早期）**沙箱内登录后截图工具超时** → 改用 DOM 检查（querySelector/fetch）验证页面。

---

## 9. 被否决的方案（及原因）

- **把 .db 上传 GitHub 当备份** ❌：含约 100 名教师个人信息（违反个保法）；git 存二进制会膨胀、删不净；
  直接复制运行中的库可能损坏。
- **U 盘备份** ❌（取消）：需人工插拔、与主机同地点、丢失即泄露；其唯一优势（离线防勒索）已被 NAS+邮件的异地副本覆盖。
- **走公网 SMB 备份到 NAS** ❌：445 端口未开放（也绝不应暴露到公网，是勒索病毒重灾区）。
- **BitLocker 整盘加密** ❌：家庭版用不了；自动化（自动解锁）更复杂。改用 7-Zip。
- **PM2 / WinSW / Docker / 任务计划程序 做服务管理** ❌：
  PM2 在 Windows 当服务较脆弱、功能对本场景过剩；WinSW 与 nssm 等价无增益；Docker 对老机器复杂度过高；
  任务计划程序做常驻服务太糙。→ 选 **nssm**。
- **Codex 多 agent 并行改共享文件** ❌：都在同一工作目录，`server.js`/`app.css`/`schema.prisma` 等公共文件会互相覆盖。
  → 选**串行+稳妥**（真并行需 git worktree 隔离，暂缓）。

---

## 10. 与 Codex CLI 协作约定

- 分工：**Claude 写精确规格 + 审查 diff + 独立验证**；**Codex 编码**；**用户验收/重启服务**。目的：省 Claude 的 token。
- 调用：前台 `codex exec`（v0.140.0，模型 gpt-5.5，exec 模式 approval=never）。
  只读 `-s read-only`，改文件 `-s workspace-write`，`-C <dir>` 指定目录，长规格写临时文件再 stdin 管道。
- 审查纪律：不轻信 Codex 自称的「已验证」，要自己再验（PowerShell 解析器查语法、端到端实跑、读 diff）。
  本项目已据此抓到并修正多处（静默 exit 0、缺管理员检测等）。
- 机密不经手 Codex：涉及真实密钥/密码的小改动由 Claude 直接做，不写进 Codex 提示、不让其提交。

---

## 11. 待办事项

**进行中**
- 加密邮件备份（7-Zip AES-256 + nodemailer + 163 SMTP + 每周计划任务）——等用户提供 163 发件邮箱、授权码、收件邮箱。

**收尾**
- 删除坏掉的重复文件 `main-app/启动-jiaoan.cmd`。
- 用户确认系统正常后，到 DeepSeek 后台**吊销旧 API key**。

**后续路线图（用户约定顺序）**
- v1.5：Word 导出（竞聘自评表/量化评分表/佐证材料汇编册）——需把 `00相关资料/` 的 4 份 `.doc` 转 `.docx` 模板加占位符；
  实现 `src/services/application-export.js`。
- v1.5：评分方案后台 UI（管理员录入真实《量化评分表》规则，替换启发式算分）。
- Phase 2：教师统计图增强（依赖 Phase 1 数据）。
- Phase 3：教材选用 + 推荐。
- Phase 4：试题库 + 试卷审核。
- Phase 5：基础数据层 + 排课系统（最复杂，算法非 LLM，最后做）。

---

## 12. 常用命令速查

```powershell
# 本地起服务（开发）
node main-app/src/server.js            # 主应用 3001（或根目录 启动-main-app.cmd）

# Prisma
cd main-app; npm run prisma:generate; npm run prisma:migrate

# 手动备份一次（先在脚本顶部填好 $BackupDest）
ops/backup-database.ps1

# 注册/卸载 服务与计划任务（均需管理员 PowerShell）
ops/install-services.ps1
ops/uninstall-services.ps1
ops/register-backup-task.ps1

# 服务状态 / 日志
Get-Service Teaching*
Get-Content ops/logs/backup.log -Tail 20
```
