Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$MainAppDir = Join-Path $RepoRoot 'main-app'
$JiaoanDir = Join-Path $RepoRoot 'jiaoan'
$LogsDir = Join-Path $PSScriptRoot 'logs'
$NssmDir = Join-Path $PSScriptRoot 'nssm'
$NssmExe = Join-Path $NssmDir 'nssm.exe'
$JiaoanCmd = Join-Path $RepoRoot '启动-jiaoan.cmd'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-NodeExe {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand -and $nodeCommand.Source -and (Test-Path -LiteralPath $nodeCommand.Source)) {
        return $nodeCommand.Source
    }

    $defaultNode = 'C:\Program Files\nodejs\node.exe'
    if (Test-Path -LiteralPath $defaultNode) {
        return $defaultNode
    }

    throw '未找到 node.exe。请先安装 Node.js，或确认 (Get-Command node).Source 可用。'
}

function Ensure-Nssm {
    if (Test-Path -LiteralPath $NssmExe) {
        return
    }

    New-Item -ItemType Directory -Force -Path $NssmDir | Out-Null

    $zipPath = Join-Path $env:TEMP 'nssm-2.24.zip'
    $extractDir = Join-Path $env:TEMP ('nssm-2.24-' + [guid]::NewGuid().ToString('N'))

    Write-Host "未找到 NSSM，正在下载到 $zipPath ..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zipPath

    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    $downloadedExe = Join-Path $extractDir 'nssm-2.24\win64\nssm.exe'
    if (-not (Test-Path -LiteralPath $downloadedExe)) {
        throw "NSSM 下载完成但未找到 win64\nssm.exe：$downloadedExe"
    }

    Copy-Item -LiteralPath $downloadedExe -Destination $NssmExe -Force
    Remove-Item -LiteralPath $extractDir -Recurse -Force

    Write-Host "NSSM 已准备：$NssmExe"
}

function Invoke-Nssm {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $NssmExe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "nssm $($Arguments -join ' ') 执行失败，退出码 $LASTEXITCODE"
    }
}

function Remove-ServiceIfExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) {
        return
    }

    Write-Host "发现已有服务 $Name，正在停止并删除..."
    & $NssmExe stop $Name | Out-Null
    & $NssmExe remove $Name confirm | Out-Null

    Start-Sleep -Seconds 1
}

function Get-CmdSetVariables {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CmdPath
    )

    if (-not (Test-Path -LiteralPath $CmdPath)) {
        throw "未找到环境变量脚本：$CmdPath"
    }

    $cmdDir = (Split-Path -Parent (Resolve-Path -LiteralPath $CmdPath).Path).TrimEnd('\') + '\'
    $items = New-Object System.Collections.Generic.List[string]

    foreach ($line in Get-Content -LiteralPath $CmdPath) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^(?i)set\s+"([^=]+)=(.*)"\s*$') {
            $key = $matches[1]
            $value = $matches[2] -replace '(?i)%~dp0', ($cmdDir -replace '\$', '$$')
            $items.Add("$key=$value")
        }
    }

    return $items.ToArray()
}

function Install-NodeService {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$DisplayName,

        [Parameter(Mandatory = $true)]
        [string]$Description,

        [Parameter(Mandatory = $true)]
        [string]$NodeExe,

        [Parameter(Mandatory = $true)]
        [string[]]$NodeArguments,

        [Parameter(Mandatory = $true)]
        [string]$AppDirectory,

        [Parameter(Mandatory = $true)]
        [string]$StdoutPath,

        [Parameter(Mandatory = $true)]
        [string]$StderrPath,

        [string[]]$EnvironmentExtra = @()
    )

    Remove-ServiceIfExists -Name $Name

    Write-Host "正在安装服务 $Name ..."
    Invoke-Nssm -Arguments (@('install', $Name, $NodeExe) + $NodeArguments)
    Invoke-Nssm -Arguments @('set', $Name, 'AppDirectory', $AppDirectory)
    Invoke-Nssm -Arguments @('set', $Name, 'Start', 'SERVICE_AUTO_START')
    Invoke-Nssm -Arguments @('set', $Name, 'DisplayName', $DisplayName)
    Invoke-Nssm -Arguments @('set', $Name, 'Description', $Description)
    Invoke-Nssm -Arguments @('set', $Name, 'AppExit', 'Default', 'Restart')
    Invoke-Nssm -Arguments @('set', $Name, 'AppRestartDelay', '5000')
    Invoke-Nssm -Arguments @('set', $Name, 'AppThrottle', '1500')
    Invoke-Nssm -Arguments @('set', $Name, 'AppStdout', $StdoutPath)
    Invoke-Nssm -Arguments @('set', $Name, 'AppStderr', $StderrPath)
    Invoke-Nssm -Arguments @('set', $Name, 'AppRotateFiles', '1')
    Invoke-Nssm -Arguments @('set', $Name, 'AppRotateOnline', '1')
    Invoke-Nssm -Arguments @('set', $Name, 'AppRotateBytes', '10485760')

    if ($EnvironmentExtra.Count -gt 0) {
        Invoke-Nssm -Arguments (@('set', $Name, 'AppEnvironmentExtra') + $EnvironmentExtra)
    }

    Invoke-Nssm -Arguments @('start', $Name)
}

if (-not (Test-Administrator)) {
    throw '请使用“以管理员身份运行”的 PowerShell 执行本脚本。'
}

if (-not (Test-Path -LiteralPath $MainAppDir)) {
    throw "未找到 main-app 目录：$MainAppDir"
}

if (-not (Test-Path -LiteralPath $JiaoanDir)) {
    throw "未找到 jiaoan 目录：$JiaoanDir"
}

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
Ensure-Nssm

$nodeExe = Resolve-NodeExe
$jiaoanEnvironment = Get-CmdSetVariables -CmdPath $JiaoanCmd

Install-NodeService `
    -Name 'TeachingMainApp' `
    -DisplayName '教学管理系统-主应用(3001)' `
    -Description '教学管理系统主应用，监听 3001 端口。工作目录为 main-app，dotenv 自动读取 main-app\.env。' `
    -NodeExe $nodeExe `
    -NodeArguments @('src\server.js') `
    -AppDirectory $MainAppDir `
    -StdoutPath (Join-Path $LogsDir 'mainapp.out.log') `
    -StderrPath (Join-Path $LogsDir 'mainapp.err.log')

Install-NodeService `
    -Name 'TeachingJiaoan' `
    -DisplayName '教学管理系统-教案服务(3100)' `
    -Description '教学管理系统教案服务，监听 3100 端口。工作目录为 jiaoan。' `
    -NodeExe $nodeExe `
    -NodeArguments @('dist\main.js', '-p', '3100') `
    -AppDirectory $JiaoanDir `
    -StdoutPath (Join-Path $LogsDir 'jiaoan.out.log') `
    -StderrPath (Join-Path $LogsDir 'jiaoan.err.log') `
    -EnvironmentExtra $jiaoanEnvironment

Write-Host ''
Write-Host '服务安装完成：'
Get-Service -Name 'Teaching*' | Format-Table -AutoSize Name, Status, StartType, DisplayName
Write-Host ''
Write-Host 'NSSM 状态：'
& $NssmExe status TeachingMainApp
& $NssmExe status TeachingJiaoan
