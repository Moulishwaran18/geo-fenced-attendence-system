$pgBin = "C:\PostgreSQL17\pgsql\bin"
$pgData = "C:\PostgreSQL17\data"
$pgLog = "C:\PostgreSQL17\postgresql.log"
$pwFile = "$env:TEMP\pg_pass_tmp.txt"

# Set password silently in temp file
Set-Content -Path $pwFile -Value "moulish" -NoNewline

Write-Host "Initializing PostgreSQL data directory..."
& "$pgBin\initdb.exe" -D "$pgData" -U postgres --pwfile="$pwFile" -E UTF8 --auth=md5 2>&1 | Out-Null
$initExit = $LASTEXITCODE

Remove-Item $pwFile -ErrorAction SilentlyContinue

if ($initExit -ne 0) {
    Write-Host "initdb failed with exit code $initExit"
    exit 1
}

Write-Host "initdb succeeded."

# Configure postgresql.conf
$conf = "$pgData\postgresql.conf"
if (Test-Path $conf) {
    Add-Content -Path $conf -Value "`nlisten_addresses = '127.0.0.1'`nport = 5432`n"
}

# Start PostgreSQL service using pg_ctl
Write-Host "Starting PostgreSQL..."
& "$pgBin\pg_ctl.exe" start -D "$pgData" -l "$pgLog" -w -t 30 2>&1
$startExit = $LASTEXITCODE

Write-Host "pg_ctl start exit code: $startExit"
