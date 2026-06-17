# SQLite 数据库备份

本目录提供 `main-app\data\teaching_materials.db` 的定时备份脚本。

## 备份方式

备份使用 Node.js 24+ 内置的 `node:sqlite` 和 SQLite `VACUUM INTO`。这种方式会让 SQLite 生成一个一致的数据库快照，适合 `main-app` 正在运行、数据库处于 WAL 模式的场景。

不要在应用运行时直接复制 `teaching_materials.db`。如果存在 `teaching_materials.db-wal` 或 `teaching_materials.db-shm`，直接复制 `.db` 文件可能漏掉还在 WAL 文件中的数据。

## 配置

编辑 `ops\backup-database.ps1` 顶部配置：

```powershell
$BackupDest = '\\192.168.1.10\backup\teaching'
$RetentionDays = 30
```

`$BackupDest` 可以是 UNC 路径，也可以是映射盘路径，例如 `Z:\teaching-backup`。如果 `$BackupDest` 为空，脚本会记录日志并正常退出，不会执行备份。

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

## NAS 权限说明

默认定时任务使用 `SYSTEM` 账户运行。`SYSTEM` 通常不能访问需要用户名密码的 NAS 共享，也不一定能看到当前用户映射的盘符。

推荐做法：

- 如果使用 NAS，优先把 `$BackupDest` 写成 UNC 路径，例如 `\\192.168.1.10\backup\teaching`。
- 确认运行定时任务的账户对 NAS 目录有写入权限。
- 如果 NAS 需要独立凭据，不要使用默认 `SYSTEM`。请在 `register-backup-task.ps1` 中把 `$RunAsUser` 改成有 NAS 权限的 Windows 用户，再注册任务。
- 映射盘符如 `Z:` 只对创建映射的用户会话可靠，定时任务中不推荐使用。

## 恢复位置

当前数据库位置：

```text
main-app\data\teaching_materials.db
```

恢复前先停止 `main-app`，然后用某个备份文件替换上面的数据库文件。恢复完成后再启动 `main-app`。
