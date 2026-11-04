# Build (et, sur demande explicite, deploiement) de Meritt Home sur Cloudflare Workers - PROJET SUPABASE DE TEST UNIQUEMENT.
#
# Principe : export statique Next.js (CF_STATIC_EXPORT=1) dans une COPIE du projet SANS aucun fichier .env* ; seules les variables de
# cette session (projet de TEST) existent. .env.local (production) n'est jamais lu ni modifie. Aucune cle secrete n'est utilisee :
# la cle publishable de TEST est relue depuis le fichier chiffre cree par lancer-test.ps1 (jamais affichee).
#
# Usage (depuis la racine du projet) :
#   .\test-env\deployer-cloudflare-test.ps1 -Action build                      # build + controles, AUCUN deploiement (defaut)
#   .\test-env\deployer-cloudflare-test.ps1 -Action deploy -Confirmer -ComptePrevu <email>     # deploie le dossier deja construit (workers.dev)
#   .\test-env\deployer-cloudflare-test.ps1 -Action supprimer -Confirmer -ComptePrevu <email>  # supprime le Worker meritt-home-test
# -ComptePrevu est obligatoire pour deploy et supprimer : le script refuse si le compte Cloudflare connecte (wrangler whoami) est different.
param(
  [ValidateSet('build', 'deploy', 'supprimer')][string]$Action = 'build',
  [switch]$Confirmer,
  [string]$SiteUrl = 'https://meritt-home-test.workers.dev',
  [string]$ComptePrevu = ''   # OBLIGATOIRE pour deploy et supprimer : e-mail du compte Cloudflare attendu (aucune valeur par defaut dans le depot)
)
$ErrorActionPreference = 'Stop'

$TestRef = 'kmjoyioeanjrvohmfash'
$ProdRef = 'jvmvsaiduralhezrjeyg'
$TestUrl = "https://$TestRef.supabase.co"
$WorkerName = 'meritt-home-test'
$StateDir = Join-Path $env:LOCALAPPDATA 'meritt-home-test'
$KeyFile = Join-Path $StateDir 'key.dat'
$Copy = Join-Path $env:LOCALAPPDATA 'meritt-home-test\cf-build'
$Root = (Get-Location).Path

# ---------- Garde-fous
if (-not (Test-Path 'package.json') -or -not (Test-Path 'test-env') -or -not (Test-Path 'wrangler.jsonc')) { throw 'Lancez ce script depuis la racine du projet Meritt Home.' }
if ($TestUrl -match $ProdRef) { throw 'REFUS : la cible est la PRODUCTION.' }
if ($SiteUrl -notmatch '^https://[a-z0-9.-]+\.workers\.dev$') { throw 'REFUS : SiteUrl doit etre une adresse https://....workers.dev.' }
if ((Get-Content wrangler.jsonc -Raw) -notmatch '"name":\s*"meritt-home-test"') { throw 'REFUS : wrangler.jsonc ne cible pas le Worker meritt-home-test.' }

# Les commandes natives ecrivent des avertissements sur stderr : on les capture sans les traiter comme des erreurs (PowerShell 5.1).
function Invoke-Native([string]$Command) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & cmd /c "$Command 2>&1" } finally { $ErrorActionPreference = $prev }
}

function Assert-Account {
  if ([string]::IsNullOrWhiteSpace($ComptePrevu)) { throw 'REFUS : -ComptePrevu <email> est obligatoire (compte Cloudflare attendu).' }
  $acc = Get-WranglerAccount
  if (-not $acc -or $acc.ToLower() -ne $ComptePrevu.Trim().ToLower()) { throw "REFUS : compte Cloudflare connecte '$acc' different du compte prevu '$ComptePrevu'." }
  return $acc
}

function Get-WranglerAccount {
  $env:CI = '1'
  $text = (Invoke-Native 'npx wrangler whoami' | Out-String)
  $m = [regex]::Match($text, 'associated with the email ([^\s@]+@[^\s]+?)\.(?:\s|$)')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

# ---------- Suppression du Worker (action explicite)
if ($Action -eq 'supprimer') {
  if (-not $Confirmer) { throw 'REFUS : ajoutez -Confirmer pour supprimer le Worker.' }
  $acc = Assert-Account
  $env:CI = '1'
  Invoke-Native "npx wrangler delete --name $WorkerName --force"
  return
}

# ---------- Deploiement du dossier deja construit (action explicite)
if ($Action -eq 'deploy') {
  if (-not $Confirmer) { throw 'REFUS : ajoutez -Confirmer pour deployer (rien n''est publie sans cela).' }
  $out = Join-Path $Copy 'out'
  if (-not (Test-Path (Join-Path $out 'index.html'))) { throw 'Aucun build : lancez d''abord -Action build.' }
  $acc = Assert-Account
  # Controle final sur le dossier a publier : TEST seulement, aucune cle secrete.
  $hits = Get-ChildItem -Recurse -File $out | Where-Object { $_.Extension -in '.js', '.html', '.txt', '.json', '.css' } | Select-String -Pattern $ProdRef, 'sb_secret_', 'service_role' -List
  if ($hits) { throw "REFUS : motif interdit dans le build : $($hits[0].Path)" }
  Write-Host "Deploiement de $WorkerName (compte $acc)..."
  Push-Location $Copy
  try { $env:CI = '1'; Invoke-Native 'npx wrangler deploy'; if ($LASTEXITCODE -ne 0) { throw 'Le deploiement a echoue.' } } finally { Pop-Location }
  return
}

# ---------- Build : cle publishable de TEST (jamais affichee)
$key = $env:MH_TEST_KEY
if (-not $key -and (Test-Path $KeyFile)) {
  try { $key = [System.Net.NetworkCredential]::new('', ((Get-Content $KeyFile -Raw).Trim() | ConvertTo-SecureString)).Password } catch { }
}
if (-not $key) { throw 'Cle publishable de TEST introuvable : lancez d''abord lancer-test.ps1 -Cible serveur-isole -Detache (elle la memorise) ou definissez MH_TEST_KEY.' }
$key = $key.Trim()
if ($key -notmatch '^sb_publishable_[A-Za-z0-9_-]+$') { throw 'Cle refusee : seule une cle sb_publishable_ est acceptee (jamais sb_secret, service_role ni JWT).' }
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$TestUrl/rest/v1/categories?select=id&limit=1" -Headers @{ apikey = $key } -TimeoutSec 30 | Out-Null
  Write-Host 'Cle acceptee par le projet de TEST.'
} catch {
  $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  if ($code -eq 401) { throw 'REFUS : Supabase repond 401 "Invalid API key" : cette cle n''appartient pas au projet de TEST.' }
  if ($code -eq 0) { throw "REFUS : projet de TEST injoignable ($($_.Exception.Message))." }
}

# ---------- Copie isolee sans .env*
New-Item -ItemType Directory -Force $Copy | Out-Null
robocopy $Root $Copy /MIR /XD node_modules .next .git test-env audit out .wrangler /XF '.env*' sortie.txt tsconfig.tsbuildinfo /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Copie du projet impossible.' }
if (Get-ChildItem -Force -Path $Copy -Filter '.env*' -ErrorAction SilentlyContinue) { throw 'REFUS : un fichier .env* se trouve dans la copie.' }
if (-not (Test-Path (Join-Path $Copy 'node_modules'))) { New-Item -ItemType Junction -Path (Join-Path $Copy 'node_modules') -Target (Join-Path $Root 'node_modules') | Out-Null }

# ---------- Build : variables de cette session uniquement
$env:NEXT_PUBLIC_SUPABASE_URL = $TestUrl
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $key
$env:NEXT_PUBLIC_SITE_URL = $SiteUrl
$env:CF_STATIC_EXPORT = '1'
Push-Location $Copy
try {
  if (Test-Path 'out') { Remove-Item -Recurse -Force 'out' }
  Invoke-Native 'npx next build'
  if ($LASTEXITCODE -ne 0) { throw 'Le build a echoue.' }
} finally { Pop-Location }

# ---------- Controles du dossier a publier
$out = Join-Path $Copy 'out'
if (-not (Test-Path (Join-Path $out 'index.html'))) { throw 'Build incomplet : out\index.html absent.' }
$files = Get-ChildItem -Recurse -File $out
$scan = $files | Where-Object { $_.Extension -in '.js', '.html', '.txt', '.json', '.css' }
$prod = $scan | Select-String -Pattern $ProdRef -List
$secret = $scan | Select-String -Pattern 'sb_secret_', 'service_role' -List
$test = $scan | Select-String -Pattern $TestRef -List
Write-Host ''
Write-Host ('Fichiers exportes      : {0} ({1:N1} Mo)' -f $files.Count, (($files | Measure-Object Length -Sum).Sum / 1MB))
Write-Host ('Reference de TEST      : ' + $(if ($test) { 'presente' } else { 'ABSENTE' }))
Write-Host ('Reference PRODUCTION   : ' + $(if ($prod) { 'PRESENTE (REFUS)' } else { 'absente' }))
Write-Host ('Cle secrete / service_role : ' + $(if ($secret) { 'PRESENTE (REFUS)' } else { 'absente' }))
if ($prod -or $secret) { throw 'REFUS : le build contient un motif interdit. Aucun deploiement possible.' }
if (-not $test) { throw 'REFUS : la reference du projet de TEST est absente du build.' }
Write-Host ''
Write-Host "Build pret dans : $out"
Write-Host 'Aucun deploiement effectue. Pour publier (apres validation) : .\test-env\deployer-cloudflare-test.ps1 -Action deploy -Confirmer'
