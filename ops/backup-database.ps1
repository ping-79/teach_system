# Database backup settings.
# Set this to your NAS or backup directory, for example:
# $BackupDest = '\\192.168.1.10\backup\teaching'
# $BackupDest = 'Z:\teaching-backup'
$BackupDest = ''
$RetentionDays = 30

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $ScriptDir '..')).Path
$LogDir = Join-Path $ScriptDir 'logs'
$LogFile = Join-Path $LogDir 'backup.log'

function Write-Log {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not (Test-Path -LiteralPath $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }

    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

try {
    Write-Log 'Backup job started.'

    if ([string]::IsNullOrWhiteSpace($BackupDest)) {
        Write-Log 'Backup destination is empty. Edit $BackupDest in ops\backup-database.ps1 before enabling backups.'
        exit 0
    }

    $SourceDb = Join-Path $RepoRoot 'main-app\data\teaching_materials.db'
    if (-not (Test-Path -LiteralPath $SourceDb)) {
        throw "Source database not found: $SourceDb"
    }

    $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($NodeCommand) {
        $NodeExe = $NodeCommand.Source
    } else {
        $NodeExe = 'C:\Program Files\nodejs\node.exe'
    }

    if (-not (Test-Path -LiteralPath $NodeExe)) {
        throw "node.exe not found. Install Node.js 24+ or add node.exe to PATH. Checked: $NodeExe"
    }

    if (-not (Test-Path -LiteralPath $BackupDest)) {
        # 已配置但连不上（NAS 掉线/网络/权限）——必须报错退出，
        # 让计划任务历史显示失败，避免"静默失败"导致一直以为有备份。
        throw "Backup destination is not accessible: $BackupDest"
    }

    $BackupScript = Join-Path $ScriptDir 'backup-database.js'
    $TempName = 'teaching_materials_{0}.db' -f ([Guid]::NewGuid().ToString('N'))
    $TempDb = Join-Path $env:TEMP $TempName
    $Timestamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
    $FinalDb = Join-Path $BackupDest ("teaching_materials_$Timestamp.db")

    if (Test-Path -LiteralPath $TempDb) {
        Remove-Item -LiteralPath $TempDb -Force
    }

    Write-Log "Creating consistent SQLite backup from $SourceDb"
    $output = & $NodeExe $BackupScript $SourceDb $TempDb 2>&1
    $exitCode = $LASTEXITCODE
    foreach ($line in $output) {
        Write-Log "node: $line"
    }

    if ($exitCode -ne 0) {
        throw "Node backup script failed with exit code $exitCode"
    }

    if (-not (Test-Path -LiteralPath $TempDb)) {
        throw "Temporary backup was not created: $TempDb"
    }

    Move-Item -LiteralPath $TempDb -Destination $FinalDb -Force
    Write-Log "Backup saved: $FinalDb"

    if ($RetentionDays -gt 0) {
        $cutoff = (Get-Date).AddDays(-1 * $RetentionDays)
        Get-ChildItem -LiteralPath $BackupDest -Filter 'teaching_materials_*.db' -File |
            Where-Object { $_.LastWriteTime -lt $cutoff } |
            ForEach-Object {
                Write-Log "Deleting old backup: $($_.FullName)"
                Remove-Item -LiteralPath $_.FullName -Force
            }
    }

    Write-Log 'Backup job completed.'
    exit 0
} catch {
    Write-Log "Backup failed: $($_.Exception.Message)"
    if ($TempDb -and (Test-Path -LiteralPath $TempDb)) {
        Remove-Item -LiteralPath $TempDb -Force -ErrorAction SilentlyContinue
    }
    exit 1
}
