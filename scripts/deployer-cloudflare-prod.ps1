# Build (et, sur demande explicite, deploiement) de Meritt Home sur Cloudflare Workers - PROJET SUPABASE DE PRODUCTION UNIQUEMENT.
#
# Principe : export statique Next.js (CF_STATIC_EXPORT=1) dans une COPIE du projet SANS aucun fichier .env* ; seules les variables
# de cette session existent. L'adresse et la cle PUBLISHABLE de production sont lues dans .env.local (jamais affichees, jamais modifiees).
# Aucune cle secrete / service_role n'est utilisee ni acceptee. Aucune migration, aucune ecriture dans la base de production.
#
# Usage (depuis la racine du projet) :
#   .\scripts\deployer-cloudflare-prod.ps1 -Action build                                         # build + controles, AUCUN deploiement
#   .\scripts\deployer-cloudflare-prod.ps1 -Action deploy -Confirmer -ComptePrevu <email>        # deploie le Worker « meritt-home »
param(
  [ValidateSet('build', 'deploy')][string]$Action = 'build',
  [switch]$Confirmer,
  [string]$SiteUrl = 'https://meritt-home.mahamabadridine.workers.dev',
  [string]$ComptePrevu = ''
)
$ErrorActionPreference = 'Stop'

$ProdRef = 'jvmvsaiduralhezrjeyg'
$TestRef = 'kmjoyioeanjrvohmfash'
$ProdUrl = "https://$ProdRef.supabase.co"
$WorkerName = 'meritt-home'
$Config = 'wrangler.prod.jsonc'
$Root = (Get-Location).Path
$Copy = Join-Path $env:LOCALAPPDATA 'meritt-home-prod\cf-build'

if (-not (Test-Path 'package.json') -or -not (Test-Path $Config) -or -not (Test-Path '.env.local')) { throw 'Lancez ce script depuis la racine du projet Meritt Home (package.json, wrangler.prod.jsonc, .env.local requis).' }
if ((Get-Content $Config -Raw) -notmatch '"name":\s*"meritt-home"') { throw 'REFUS : wrangler.prod.jsonc ne cible pas le Worker meritt-home.' }
if ($SiteUrl -notmatch '^https://[a-z0-9.-]+\.workers\.dev$') { throw 'REFUS : SiteUrl doit etre une adresse https://....workers.dev.' }

# Les commandes natives ecrivent des avertissements sur stderr : capture sans erreur (PowerShell 5.1).
function Invoke-Native([string]$Command) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & cmd /c "$Command 2>&1" } finally { $ErrorActionPreference = $prev }
}
function Get-WranglerAccount {
  $env:CI = '1'
  $text = (Invoke-Native 'npx wrangler whoami' | Out-String)
  $m = [regex]::Match($text, 'associated with the email ([^\s@]+@[^\s]+?)\.(?:\s|$)')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}
function Assert-Account {
  if ([string]::IsNullOrWhiteSpace($ComptePrevu)) { throw 'REFUS : -ComptePrevu <email> est obligatoire (compte Cloudflare attendu).' }
  $acc = Get-WranglerAccount
  if (-not $acc -or $acc.ToLower() -ne $ComptePrevu.Trim().ToLower()) { throw "REFUS : compte Cloudflare connecte '$acc' different du compte prevu '$ComptePrevu'." }
  return $acc
}
function Test-Bundle([string]$Out) {
  $scan = Get-ChildItem -Recurse -File $Out | Where-Object { $_.Extension -in '.js', '.html', '.txt', '.json', '.css' }
  [pscustomobject]@{
    Files  = @(Get-ChildItem -Recurse -File $Out)
    Prod   = [bool]($scan | Select-String -Pattern $ProdRef -List)
    Test   = [bool]($scan | Select-String -Pattern $TestRef -List)
    Secret = [bool]($scan | Select-String -Pattern 'sb_secret_', 'service_role' -List)
  }
}

# ---------- Deploiement du dossier deja construit (action explicite)
if ($Action -eq 'deploy') {
  if (-not $Confirmer) { throw 'REFUS : ajoutez -Confirmer pour deployer (rien n''est publie sans cela).' }
  $out = Join-Path $Copy 'out'
  if (-not (Test-Path (Join-Path $out 'index.html'))) { throw 'Aucun build : lancez d''abord -Action build.' }
  $acc = Assert-Account
  $b = Test-Bundle $out
  if (-not $b.Prod -or $b.Test -or $b.Secret) { throw 'REFUS : le dossier a publier doit contenir la reference de PRODUCTION, jamais celle de TEST ni une cle secrete.' }
  Write-Host "Deploiement de $WorkerName (compte $acc)..."
  Push-Location $Copy
  try { $env:CI = '1'; Invoke-Native "npx wrangler deploy --config $Config"; if ($LASTEXITCODE -ne 0) { throw 'Le deploiement a echoue.' } } finally { Pop-Location }
  return
}

# ---------- Build : configuration de production lue dans .env.local (cle jamais affichee)
$cfg = @{}
foreach ($line in Get-Content '.env.local') { if ($line -match '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)=(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() } }
$url = $cfg['NEXT_PUBLIC_SUPABASE_URL']; $key = $cfg['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
if ($url -ne $ProdUrl) { throw "REFUS : NEXT_PUBLIC_SUPABASE_URL de .env.local n'est pas exactement $ProdUrl." }
if ($key -notmatch '^sb_publishable_[A-Za-z0-9_-]+$') { throw 'Cle refusee : seule une cle sb_publishable_ est acceptee (jamais sb_secret, service_role ni JWT).' }
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri "$ProdUrl/rest/v1/categories?select=id&limit=1" -Headers @{ apikey = $key } -TimeoutSec 30
  Write-Host 'Cle acceptee par le projet de PRODUCTION (lecture seule).'
} catch {
  $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  if ($code -eq 401) { throw 'REFUS : Supabase repond 401 "Invalid API key" : cle non valide pour la production.' }
  if ($code -eq 0) { throw "REFUS : projet de production injoignable ($($_.Exception.Message))." }
}

# ---------- Copie isolee sans .env*
New-Item -ItemType Directory -Force $Copy | Out-Null
# Module sur mesure (migration non appliquee en production) : ses pages ne sont pas exportees.
$CustomDirs = @((Join-Path $Root 'app\sur-mesure'), (Join-Path $Root 'app\admin\sur-mesure'))
robocopy $Root $Copy /MIR /XD node_modules .next .git test-env audit out .wrangler $CustomDirs /XF '.env*' sortie.txt tsconfig.tsbuildinfo /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Copie du projet impossible.' }
# /XD n'efface pas ce qu'une copie precedente contient deja : retrait explicite, dans la COPIE uniquement.
foreach ($d in @('app\sur-mesure', 'app\admin\sur-mesure')) { $p = Join-Path $Copy $d; if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
if (Get-ChildItem -Force -Path $Copy -Filter '.env*' -ErrorAction SilentlyContinue) { throw 'REFUS : un fichier .env* se trouve dans la copie.' }
if (-not (Test-Path (Join-Path $Copy 'node_modules'))) { New-Item -ItemType Junction -Path (Join-Path $Copy 'node_modules') -Target (Join-Path $Root 'node_modules') | Out-Null }

$env:NEXT_PUBLIC_SUPABASE_URL = $ProdUrl
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $key
$env:NEXT_PUBLIC_SITE_URL = $SiteUrl
$env:CF_STATIC_EXPORT = '1'
$env:NEXT_PUBLIC_HIDE_CUSTOM_MODULE = '1'
Push-Location $Copy
try {
  if (Test-Path 'out') { Remove-Item -Recurse -Force 'out' }
  Invoke-Native 'npx next build'
  if ($LASTEXITCODE -ne 0) { throw 'Le build a echoue.' }
} finally { Pop-Location }

$out = Join-Path $Copy 'out'
if (-not (Test-Path (Join-Path $out 'index.html'))) { throw 'Build incomplet : out\index.html absent.' }
$b = Test-Bundle $out
Write-Host ''
Write-Host ('Fichiers exportes          : {0} ({1:N1} Mo)' -f $b.Files.Count, (($b.Files | Measure-Object Length -Sum).Sum / 1MB))
Write-Host ('Reference de PRODUCTION    : ' + $(if ($b.Prod) { 'presente' } else { 'ABSENTE (REFUS)' }))
Write-Host ('Reference de TEST          : ' + $(if ($b.Test) { 'PRESENTE (REFUS)' } else { 'absente' }))
Write-Host ('Cle secrete / service_role : ' + $(if ($b.Secret) { 'PRESENTE (REFUS)' } else { 'absente' }))
if (-not $b.Prod -or $b.Test -or $b.Secret) { throw 'REFUS : controle du build non conforme. Aucun deploiement possible.' }
$customLeak = (Test-Path (Join-Path $out 'sur-mesure')) -or (Test-Path (Join-Path $out 'admin\sur-mesure')) -or [bool](Select-String -Path (Join-Path $out 'index.html') -Pattern 'sur-mesure' -List)
Write-Host ('Acces au module sur mesure : ' + $(if ($customLeak) { 'PRESENT (REFUS)' } else { 'masque' }))
if ($customLeak) { throw 'REFUS : le module sur mesure est encore accessible dans le build.' }
Write-Host ''
Write-Host "Build pret dans : $out"
Write-Host 'Aucun deploiement effectue. Pour publier : .\scripts\deployer-cloudflare-prod.ps1 -Action deploy -Confirmer -ComptePrevu <email>'
