# Builds the Go backend into backend/bin/svcide-backend.exe (bundled by electron-builder)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'backend')
try {
    go build -ldflags "-s -w" -o bin/svcide-backend.exe ./cmd/svcide-backend
    if ($LASTEXITCODE -ne 0) { throw "go build failed" }
    Write-Host "backend built: backend/bin/svcide-backend.exe"
} finally {
    Pop-Location
}
