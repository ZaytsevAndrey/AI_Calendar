# Night green-loop: create blocks → intent-by-intent → clarify → full --all.
# Re-runs a failing block until green (max retries), then advances.
param(
  [int]$MaxRetries = 3,
  [switch]$SkipCreate,
  [switch]$SkipIntent,
  [switch]$SkipClarify,
  [switch]$SkipFull
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

function Invoke-Eval {
  param([string[]]$Args)
  Write-Host "`n=== npm run $($Args -join ' ') ===" -ForegroundColor Cyan
  & npx @args
  return $LASTEXITCODE
}

function Invoke-UntilGreen {
  param(
    [string]$Label,
    [string[]]$Args,
    [int]$Retries = $MaxRetries
  )
  for ($i = 1; $i -le $Retries; $i++) {
    Write-Host "`n>>> $Label (attempt $i/$Retries)" -ForegroundColor Yellow
    $code = Invoke-Eval -Args $Args
    if ($code -eq 0) {
      Write-Host "GREEN $Label" -ForegroundColor Green
      return $true
    }
    Write-Host "RED $Label — fix needed before retry $i" -ForegroundColor Red
    if ($i -eq $Retries) { return $false }
    # Agent session should fix fails; script alone just retries once more after pause.
    Start-Sleep -Seconds 5
  }
  return $false
}

if (-not $SkipCreate) {
  for ($b = 0; $b -lt 6; $b++) {
    $ok = Invoke-UntilGreen -Label "create block $b" -Args @(
      'ts-node', 'src/scripts/eval-voice-create.ts', '--local', "--block=$b"
    )
    if (-not $ok) { throw "create block $b still red after $MaxRetries" }
  }
}

if (-not $SkipIntent) {
  $intents = @(
    'update', 'delete', 'complete', 'skip', 'reschedule',
    'habit_create', 'habit_check_in', 'habit_update', 'habit_delete',
    'habit_uncheck', 'needs_clarification'
  )
  foreach ($intent in $intents) {
    $ok = Invoke-UntilGreen -Label "intent $intent" -Args @(
      'ts-node', 'src/scripts/eval-voice-intent.ts', '--local', "--intent=$intent"
    )
    if (-not $ok) { throw "intent $intent still red" }
  }
}

if (-not $SkipClarify) {
  $ok = Invoke-UntilGreen -Label 'clarify all' -Args @(
    'ts-node', 'src/scripts/eval-voice-clarify.ts', '--local', '--all'
  )
  if (-not $ok) { throw 'clarify still red' }
}

if (-not $SkipFull) {
  Write-Host "`n=== FULL create --all ===" -ForegroundColor Magenta
  if ((Invoke-Eval -Args @('ts-node', 'src/scripts/eval-voice-create.ts', '--local', '--all')) -ne 0) {
    throw 'full create failed'
  }
  Write-Host "`n=== FULL intent --all ===" -ForegroundColor Magenta
  if ((Invoke-Eval -Args @('ts-node', 'src/scripts/eval-voice-intent.ts', '--local', '--all')) -ne 0) {
    throw 'full intent failed'
  }
  Write-Host "`n=== FULL clarify --all ===" -ForegroundColor Magenta
  if ((Invoke-Eval -Args @('ts-node', 'src/scripts/eval-voice-clarify.ts', '--local', '--all')) -ne 0) {
    throw 'full clarify failed'
  }
}

Write-Host "`nNight loop finished green." -ForegroundColor Green
