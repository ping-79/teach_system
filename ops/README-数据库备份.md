# SQLite 数据库备份

本目录提供 `main-app\data\teaching_materials.db` 的定时备份脚本。

## 备份方式

备份使用 Node.js 24+ 内置的 `node:sqlite` 和 SQLite `VACUUM INTO`。这种方式会让 SQLite 生成一个一致的数据库快照，适合 `main-app` 正在运行、数据库处于 WAL 模式的场景。

不要在应用运行时直接复制 `teaching_materials.db`。如果存在 `teaching_materials.db-wal` 或 `teaching_materials.db-shm`，直接复制 `.db` 文件可能漏掉还在 WAL 文件中的数据。

## 配置

编辑 `ops\backup-database.ps1` 顶部配置：

```powershell
$BackupDest = 'D:\db-backups'   # 本机的备份文件夹（不要直接写 NAS）
$RetentionDays = 30
```

`$BackupDest` 请填**服务器本机的一个文件夹**（异地同步到 NAS 由群晖工具负责，见下文「异地备份到 NAS」）。如果 `$BackupDest` 为空，脚本会记录日志并正常退出，不会执行备份。

## 手动运行

用 PowerShell 进入 `ops` 目录：

```powershell
Set-Location -LiteralPath 'D:\Desktop\works\服务器部署\ops'
.\backup-database.ps1
```

备份文件名格式：

```text
teaching_materials_yyyy-MM-dd_HHmm.db
```

日志文件：

```text
ops\logs\backup.log
```

## 注册 Windows 定时任务

用“以管理员身份运行”的 PowerShell 进入 `ops` 目录：

```powershell
Set-Location -LiteralPath 'D:\Desktop\works\服务器部署\ops'
.\register-backup-task.ps1
```

脚本会创建名为 `TeachingDbBackup` 的每日定时任务，默认每天 `03:00` 运行：

```powershell
powershell.exe -ExecutionPolicy Bypass -File "<ops\backup-database.ps1>"
```

如需修改时间，编辑 `ops\register-backup-task.ps1` 顶部的 `$RunTime`。

## 异地备份到 NAS（两层方案）

本系统的服务器与 NAS 不在同一局域网，通过外网（域名 `aigc.i234.me`）相连，且 NAS 未开放 SMB（445 端口），因此采用两层备份：

- **第一层（本脚本负责）**：每天用 VACUUM INTO 在**服务器本机**生成干净的备份文件，存到 `$BackupDest` 指向的本地文件夹。这一层不依赖网络，永远可用。
- **第二层（群晖工具负责）**：用 NAS 自带的 **Active Backup for Business** 或 **Synology Drive**，把上面那个本地备份文件夹同步到 NAS，实现异地容灾。

第二层在部署时用群晖的图形界面配置（连接地址用 `aigc.i234.me`，DSM 端口 `5001`）。两种工具二选一：

- **Active Backup for Business**：在服务器装代理程序，NAS 端集中管理备份与恢复（推荐）。
- **Synology Drive Client**：在服务器装客户端，把本地备份文件夹设为同步到 NAS 的某个目录。

> 因为本脚本只写本地文件夹，所以计划任务用默认的 `SYSTEM` 账户即可，无需配置 NAS 账号密码——联网部分由群晖工具用它自己的凭据处理。

## 恢复位置

当前数据库位置：

```text
main-app\data\teaching_materials.db
```

恢复前先停止 `main-app`，然后用某个备份文件替换上面的数据库文件。恢复完成后再启动 `main-app`。
