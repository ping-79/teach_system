# Windows 服务部署说明

本目录用于把两个 Node.js 应用注册为 Windows 服务：

- `TeachingMainApp`：主应用，监听 `3001`，工作目录为 `main-app`，启动命令为 `node src\server.js`。
- `TeachingJiaoan`：教案服务，监听 `3100`，工作目录为 `jiaoan`，启动命令为 `node dist\main.js -p 3100`。

## 前置条件

1. 已安装 Node.js，并且 `Get-Command node` 能找到 `node.exe`。脚本也会尝试使用 `C:\Program Files\nodejs\node.exe`。
2. `main-app` 已安装依赖，并准备好 `main-app\.env`。主应用会通过 dotenv 自动读取该文件。
3. `jiaoan` 已安装依赖并完成构建，确认存在 `jiaoan\dist\main.js`。
4. 教案服务需要的 Python、模板路径、输出目录、临时目录、API Key 等变量写在根目录 `启动-jiaoan.cmd` 中，格式为 `set "KEY=VALUE"`。

## 安装服务

用“以管理员身份运行”的 PowerShell 进入本目录：

```powershell
Set-Location -LiteralPath 'D:\Desktop\works\服务器部署\ops'
.\install-services.ps1
```

安装脚本会自动完成：

- 创建 `ops\logs` 日志目录。
- 如果缺少 `ops\nssm\nssm.exe`，从 `https://nssm.cc/release/nssm-2.24.zip` 下载 NSSM，并复制 `win64\nssm.exe`。
- 如果已有同名服务，先执行 `nssm stop` 和 `nssm remove confirm` 后重新安装。
- 将两个服务设置为开机自启，并配置异常退出自动重启。
- 将标准输出和错误输出写入 `ops\logs`。

## 检查状态

```powershell
Get-Service Teaching*
sc query TeachingMainApp
sc query TeachingJiaoan
.\nssm\nssm.exe status TeachingMainApp
.\nssm\nssm.exe status TeachingJiaoan
```

## 查看日志

日志文件位于：

- `ops\logs\mainapp.out.log`
- `ops\logs\mainapp.err.log`
- `ops\logs\jiaoan.out.log`
- `ops\logs\jiaoan.err.log`

## 重启服务

推荐使用 NSSM：

```powershell
.\nssm\nssm.exe restart TeachingMainApp
.\nssm\nssm.exe restart TeachingJiaoan
```

也可以使用 Windows 服务命令：

```powershell
Restart-Service TeachingMainApp
Restart-Service TeachingJiaoan
```

## 卸载服务

用“以管理员身份运行”的 PowerShell 进入本目录：

```powershell
Set-Location -LiteralPath 'D:\Desktop\works\服务器部署\ops'
.\uninstall-services.ps1
```

卸载脚本会执行 `nssm stop` 和 `nssm remove confirm`，删除 `TeachingMainApp` 与 `TeachingJiaoan`。

## 环境变量说明

- `main-app`：使用 `main-app\.env`，服务工作目录是 `main-app`，因此 dotenv 会从该目录读取配置。
- `jiaoan`：服务安装时会读取根目录 `启动-jiaoan.cmd` 中所有 `set "KEY=VALUE"` 行，并写入 NSSM 的 `AppEnvironmentExtra`。脚本会把变量值里的 `%~dp0` 展开为仓库根目录路径。

修改 `启动-jiaoan.cmd` 后，需要重新运行 `ops\install-services.ps1`，让 NSSM 服务配置同步最新环境变量。
