# Lanceur de l'environnement de TEST de Meritt Home (projet Supabase « meritt-home-test »).
#
# Aucun secret n'est stocké : la clé publique et le mot de passe sont demandés à l'écran (saisie masquée) et ne vivent
# que dans cette session PowerShell. .env.local (production) n'est jamais lu ni modifié.
#
# Usage (depuis la racine du projet) :
#   .\test-env\lancer-test.ps1 -Cible serveur             # application sur http://localhost:3001 branchée sur le projet de test
#   .\test-env\lancer-test.ps1 -Cible commande            # test de bout en bout des commandes (serveur déjà lancé)
#   .\test-env\lancer-test.ps1 -Cible encaissements       # test de bout en bout des encaissements (serveur déjà lancé)
param(
  [Parameter(Mandatory = $true)][ValidateSet('serveur', 'commande', 'encaissements', 'mock')][string]$Cible,
  [int]$Port = 3001
)
$ErrorActionPreference = 'Stop'

$TestUrl = 'https://kmjoyioeanjrvohmfash.supabase.co'   # projet de TEST (non secret)
$ProdRef = 'jvmvsaiduralhezrjeyg'                        # production : jamais utilisable ici

# ---------- Garde-fous
if ($TestUrl -match $ProdRef) { throw 'REFUS : l''adresse configurée est celle de la PRODUCTION.' }
if ($TestUrl -ne 'https://kmjoyioeanjrvohmfash.supabase.co') { throw 'REFUS : la cible doit être exactement kmjoyioeanjrvohmfash.' }
if (-not (Test-Path 'package.json') -or -not (Test-Path 'test-env')) { throw 'Lancez ce script depuis la racine du projet Meritt Home.' }

# ---------- Cible « mock » : strictement séparée des cibles ci-dessous. Aucune clé, aucun projet Supabase réel.
# Lance une COPIE de l'application (sans .env.local, dossier temporaire) sur le port choisi avec une adresse factice ;
# les tests Playwright simulés interceptent tout le trafic vers cette adresse. N'utilise ni le dossier .next ni le serveur du port 3000.
if ($Cible -eq 'mock') {
  $MockUrl = 'https://mocktest00000000.supabase.co'
  if ($MockUrl -match $ProdRef -or $MockUrl -match 'kmjoyioeanjrvohmfash') { throw 'REFUS : l''adresse factice ne doit pas être celle d''un vrai projet.' }
  $copy = Join-Path $env:TEMP 'meritt-mock-app'
  New-Item -ItemType Directory -Force $copy | Out-Null
  robocopy . $copy /MIR /XD node_modules .next .git test-env /XF '.env*' /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Copie de l''application impossible.' }
  if (-not (Test-Path (Join-Path $copy 'node_modules'))) { New-Item -ItemType Junction -Path (Join-Path $copy 'node_modules') -Target (Join-Path (Get-Location) 'node_modules') | Out-Null }
  $env:NEXT_PUBLIC_SUPABASE_URL = $MockUrl
  $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_MOCK'
  Write-Host "Application MOCK sur http://localhost:$Port (adresse factice $MockUrl). Ctrl+C pour arrêter."
  Set-Location $copy
  npx next dev -p $Port
  return
}

function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  return [System.Net.NetworkCredential]::new('', $secure).Password
}

# Clé publique de TEST : uniquement le format « sb_publishable_ ». Une clé secrète ou service_role est refusée.
$key = Read-Secret 'Clé publique (sb_publishable_...) du projet de TEST'
if ($key -notmatch '^sb_publishable_[A-Za-z0-9_-]+$') { throw 'Clé refusée : seule une clé « sb_publishable_ » est acceptée (jamais sb_secret, service_role ni JWT).' }

# Variables de cette session uniquement : elles l'emportent sur .env.local sans le modifier.
$env:NEXT_PUBLIC_SUPABASE_URL = $TestUrl
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $key
$env:TEST_SUPABASE_URL = $TestUrl
$env:TEST_SUPABASE_KEY = $key
$env:APP_URL = "http://localhost:$Port"

switch ($Cible) {
  'serveur' {
    Write-Host "Application de TEST sur http://localhost:$Port (projet kmjoyioeanjrvohmfash). Ctrl+C pour arrêter."
    npx next dev -p $Port
  }
  default {
    $env:TEST_ADMIN_EMAIL = Read-Host 'E-mail du compte administrateur de TEST'
    $env:TEST_ADMIN_PASSWORD = Read-Secret 'Mot de passe du compte administrateur de TEST'
    $script = if ($Cible -eq 'commande') { 'test-env/e2e-commande.mjs' } else { 'test-env/e2e-encaissements.mjs' }
    Write-Host "Exécution de $script contre le projet de TEST uniquement."
    node $script
  }
}
