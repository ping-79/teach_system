$TaskName = 'TeachingDbBackup'
$RunTime = '03:00'
# 计划任务以哪个账户运行：
#   本方案中备份只写到【本机文件夹】（异地同步到 NAS 由群晖工具负责），
#   所以默认 'SYSTEM' 即可，无需配置账户密码。
$RunAsUser = 'SYSTEM'

$ErrorActionPreference = 'Stop'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    throw '请使用“以管理员身份运行”的 PowerShell 执行本脚本。'
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupScript = Join-Path $ScriptDir 'backup-database.ps1'

if (-not (Test-Path -LiteralPath $BackupScript)) {
    throw "Backup script not found: $BackupScript"
}

$principal = New-ScheduledTaskPrincipal -UserId $RunAsUser -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($RunTime, 'HH:mm', $null))
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$BackupScript`""
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Back up main-app SQLite database with VACUUM INTO.' | Out-Null

Write-Host "Scheduled task registered: $TaskName"
Write-Host "Run time: $RunTime"
Write-Host "Run as: $RunAsUser"
Write-Host 'If the backup destination is a NAS path, make sure this account can access it.'
