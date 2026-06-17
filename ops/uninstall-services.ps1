Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$NssmExe = Join-Path $PSScriptRoot 'nssm\nssm.exe'
$ServiceNames = @('TeachingMainApp', 'TeachingJiaoan')

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    throw '请使用“以管理员身份运行”的 PowerShell 执行本脚本。'
}

if (-not (Test-Path -LiteralPath $NssmExe)) {
    throw "未找到 NSSM：$NssmExe。请先运行 install-services.ps1，或手动放置 NSSM。"
}

foreach ($name in $ServiceNames) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Host "服务不存在，跳过：$name"
        continue
    }

    Write-Host "正在停止并删除服务：$name"
    & $NssmExe stop $name | Out-Null
    & $NssmExe remove $name confirm | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "删除服务 $name 失败，退出码 $LASTEXITCODE"
    }
}

Write-Host ''
Write-Host '卸载完成。当前 Teaching* 服务：'
Get-Service -Name 'Teaching*' -ErrorAction SilentlyContinue | Format-Table -AutoSize Name, Status, StartType, DisplayName
