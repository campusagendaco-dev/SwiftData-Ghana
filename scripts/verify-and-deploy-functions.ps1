<#
.SYNOPSIS
    Pre-flight build verification and sequential deployment script for Supabase Edge Functions.
.DESCRIPTION
    1. Verifies syntax and build integrity of target Edge Functions using esbuild (--target=esnext --log-level=warning).
    2. Unless -VerifyOnly is specified, loads SUPABASE_ACCESS_TOKEN from .env (if not already in environment)
       and sequentially deploys each verified function via the Supabase Management API with automatic 1x retry.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string[]]$Functions,

    [Parameter(Mandatory = $false)]
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

# Resolve workspace root (parent of scripts/ directory)
$WorkspaceRoot = Split-Path -Parent $PSScriptRoot
Push-Location $WorkspaceRoot

try {
    $EsbuildPath = Join-Path $WorkspaceRoot "node_modules\@esbuild\win32-x64\esbuild.exe"
    if (-not (Test-Path $EsbuildPath)) {
        Write-Error "esbuild binary not found at: $EsbuildPath"
        exit 1
    }

    $FunctionsRoot = Join-Path $WorkspaceRoot "supabase\functions"
    if (-not (Test-Path $FunctionsRoot)) {
        Write-Error "Supabase functions directory not found at: $FunctionsRoot"
        exit 1
    }

    # Resolve target functions if not explicitly passed
    if (-not $Functions -or $Functions.Count -eq 0) {
        $Functions = Get-ChildItem -Path $FunctionsRoot -Directory |
            Where-Object { Test-Path (Join-Path $_.FullName "index.ts") } |
            Select-Object -ExpandProperty Name |
            Sort-Object
    }

    if (-not $Functions -or $Functions.Count -eq 0) {
        Write-Error "No Edge Functions containing index.ts found in $FunctionsRoot."
        exit 1
    }

    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " Step 1: Pre-Deployment Build Verification ($($Functions.Count) functions)" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    foreach ($fn in $Functions) {
        $entryFile = "supabase/functions/$fn/index.ts"
        if (-not (Test-Path (Join-Path $WorkspaceRoot $entryFile))) {
            Write-Host "[FAIL] $fn - Entry file not found: $entryFile" -ForegroundColor Red
            exit 1
        }

        Write-Host -NoNewline "Verifying $fn ... "
        & .\node_modules\@esbuild\win32-x64\esbuild.exe $entryFile --target=esnext --log-level=warning > $null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAILED]" -ForegroundColor Red
            Write-Error "Build verification failed for Edge Function '$fn' (exit code $LASTEXITCODE). Failing fast."
            exit $LASTEXITCODE
        }
        Write-Host "[OK]" -ForegroundColor Green
    }

    Write-Host "`nAll $($Functions.Count) Edge Function(s) passed esbuild verification!" -ForegroundColor Green

    Write-Host "`nScanning for undefined identifier errors across Edge Functions..." -ForegroundColor Cyan
    node scripts/scan-undefined.mjs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAILED] Undefined identifier scan found missing references!" -ForegroundColor Red
        exit $LASTEXITCODE
    }

    if ($VerifyOnly) {
        Write-Host "VerifyOnly switch is set. Skipping deployment." -ForegroundColor Yellow
        exit 0
    }

    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host " Step 2: Sequential Edge Function Deployment" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    # Load SUPABASE_ACCESS_TOKEN from .env if not already set in environment
    if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
        $EnvFilePath = Join-Path $WorkspaceRoot ".env"
        if (Test-Path $EnvFilePath) {
            $envLines = Get-Content $EnvFilePath
            foreach ($line in $envLines) {
                if ($line -match '^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.+?)\s*$') {
                    $tokenVal = $Matches[1].Trim('"', "'")
                    if (-not [string]::IsNullOrWhiteSpace($tokenVal)) {
                        $env:SUPABASE_ACCESS_TOKEN = $tokenVal
                        Write-Host "Loaded SUPABASE_ACCESS_TOKEN from .env" -ForegroundColor DarkGray
                        break
                    }
                }
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
        Write-Error "SUPABASE_ACCESS_TOKEN is not set in environment or .env file."
        exit 1
    }

    $ProjectRef = "lsocdjpflecduumopijn"
    $DeployedCount = 0

    foreach ($fn in $Functions) {
        $attempt = 1
        $maxAttempts = 2
        $deployed = $false

        while ($attempt -le $maxAttempts -and -not $deployed) {
            Write-Host "`nDeploying '$fn' (Attempt $attempt of $maxAttempts)..." -ForegroundColor Cyan
            & npx supabase functions deploy $fn --project-ref $ProjectRef --no-verify-jwt --use-api
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[DEPLOYED] $fn" -ForegroundColor Green
                $deployed = $true
                $DeployedCount++
            } else {
                if ($attempt -lt $maxAttempts) {
                    Write-Host "[WARN] Transient error deploying '$fn'. Retrying in 2 seconds..." -ForegroundColor Yellow
                    Start-Sleep -Seconds 2
                } else {
                    Write-Host "[ERROR] Failed to deploy '$fn' after $maxAttempts attempts." -ForegroundColor Red
                    exit 1
                }
            }
            $attempt++
        }
    }

    Write-Host "`nSuccessfully verified and deployed $DeployedCount/$($Functions.Count) Edge Function(s)." -ForegroundColor Green
}
finally {
    Pop-Location
}
