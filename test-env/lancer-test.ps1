# Lanceur de l'environnement de TEST de Meritt Home (projet Supabase « meritt-home-test »).
#
# Aucun secret n'est stocké : la clé publique et le mot de passe sont demandés à l'écran (saisie masquée) et ne vivent
# que dans cette session PowerShell. .env.local (production) n'est jamais lu ni modifié.
#
# Usage (depuis la racine du projet) :
#   .\test-env\lancer-test.ps1 -Cible serveur             # application sur http://localhost:3001 branchée sur le projet de test
#   .\test-env\lancer-test.ps1 -Cible serveur-isole       # idem, mais sur une COPIE (dossier temporaire) : n'utilise pas le dossier .next
#                                                         # du projet, donc ne perturbe pas un « next dev » déjà lancé sur le port 3000
#   .\test-env\lancer-test.ps1 -Cible commande            # test de bout en bout des commandes (serveur déjà lancé)
#   .\test-env\lancer-test.ps1 -Cible encaissements       # test de bout en bout des encaissements (serveur déjà lancé)
param(
  [Parameter(Mandatory = $true)][ValidateSet('serveur', 'serveur-isole', 'commande', 'encaissements', 'mock', 'arret')][string]$Cible,
  [int]$Port = 3001,
  [switch]$Detache,        # serveur-isole : demarre Next.js detache du terminal (survit a la fermeture/Ctrl+C), journal dans $StateDir
  [switch]$MemoriserCle    # enregistre la cle publishable chiffree (DPAPI, compte Windows courant) hors du depot, pour les prochains lancements
)
$ErrorActionPreference = 'Stop'

# Etat du serveur detache : hors du depot (jamais committe). La cle n'y est stockee que chiffree (DPAPI : lisible uniquement par ce compte Windows).
$StateDir = Join-Path $env:LOCALAPPDATA 'meritt-home-test'
$KeyFile = Join-Path $StateDir 'key.dat'
$PidFile = Join-Path $StateDir 'server.pid'
$LogOut = Join-Path $StateDir 'server.out.log'
$LogErr = Join-Path $StateDir 'server.err.log'

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

# Arret du serveur detache (uniquement le processus enregistre dans server.pid).
if ($Cible -eq 'arret') {
  if (Test-Path $PidFile) {
    $savedPid = [int](Get-Content $PidFile -Raw)
    & taskkill /PID $savedPid /T /F | Out-Null
    Remove-Item $PidFile -Force
    Write-Host "Serveur de test arrete (PID $savedPid et ses processus enfants)."
  } else { Write-Host 'Aucun serveur detache enregistre.' }
  return
}

# Cle publique de TEST : variable MH_TEST_KEY, sinon fichier chiffre, sinon saisie masquee.
# Uniquement le format sb_publishable_ : une cle secrete ou service_role est refusee.
$key = $env:MH_TEST_KEY
if (-not $key -and (Test-Path $KeyFile)) {
  try { $key = [System.Net.NetworkCredential]::new('', ((Get-Content $KeyFile -Raw).Trim() | ConvertTo-SecureString)).Password } catch { Write-Host 'Cle memorisee illisible : saisie demandee.' }
}
$fromPrompt = $false
if (-not $key) { $key = Read-Secret 'Clé publique (sb_publishable_...) du projet de TEST'; $fromPrompt = $true }
$key = $key.Trim()
if ($key -notmatch '^sb_publishable_[A-Za-z0-9_-]+$') { throw 'Clé refusée : seule une clé « sb_publishable_ » est acceptée (jamais sb_secret, service_role ni JWT).' }

# Validation AVANT de demarrer : une lecture publique (GET, limit=1) sur le projet de TEST. Un 401 = cle refusee par Supabase.
try {
  $probe = Invoke-WebRequest -UseBasicParsing -Uri "$TestUrl/rest/v1/categories?select=id&limit=1" -Headers @{ apikey = $key } -TimeoutSec 30
  Write-Host "Cle acceptee par le projet de TEST (HTTP $($probe.StatusCode))."
} catch {
  $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  if ($code -eq 401) { throw 'REFUS : Supabase repond 401 "Invalid API key". Cette cle n''appartient pas au projet kmjoyioeanjrvohmfash (ou est revoquee/tronquee). Copiez-la depuis Project Settings > API Keys DU PROJET DE TEST.' }
  if ($code -eq 0) { throw "REFUS : projet de TEST injoignable ($($_.Exception.Message))." }
  Write-Host "Avertissement : la sonde de validation a repondu HTTP $code (cle acceptee, mais verifiez les policies/tables du projet de TEST)."
}
if ($MemoriserCle -or ($fromPrompt -and $Detache)) {
  New-Item -ItemType Directory -Force $StateDir | Out-Null
  (ConvertTo-SecureString $key -AsPlainText -Force | ConvertFrom-SecureString) | Set-Content -Path $KeyFile -Encoding ASCII
  Write-Host "Cle memorisee (chiffree, compte Windows courant) : $KeyFile"
}

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
  'serveur-isole' {
    # Copie de l'application dans un dossier temporaire, SANS aucun fichier .env* : seules les variables de cette session
    # (projet de TEST) existent. Le dossier .next du projet et le serveur du port 3000 ne sont ni utilisés ni modifiés.
    if ($Port -eq 3000) { throw 'REFUS : le port 3000 est réservé au serveur habituel.' }
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Le port $Port est déjà utilisé : choisissez un autre port (-Port) ou libérez-le vous-même." }
    $copy = Join-Path $env:TEMP 'meritt-test-app'
    New-Item -ItemType Directory -Force $copy | Out-Null
    robocopy . $copy /MIR /XD node_modules .next .git test-env /XF '.env*' /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'Copie de l''application impossible.' }
    if (Get-ChildItem -Force -Path $copy -Filter '.env*' -ErrorAction SilentlyContinue) { throw 'REFUS : un fichier .env* se trouve dans la copie.' }
    if (-not (Test-Path (Join-Path $copy 'node_modules'))) { New-Item -ItemType Junction -Path (Join-Path $copy 'node_modules') -Target (Join-Path (Get-Location) 'node_modules') | Out-Null }
    if ($Detache) {
      # Demarrage detache : processus Next.js independant du terminal, journaux dans $StateDir, attente de disponibilite.
      New-Item -ItemType Directory -Force $StateDir | Out-Null
      $nextBin = Join-Path $copy 'node_modules\next\dist\bin\next'
      if (-not (Test-Path $nextBin)) { throw "Next.js introuvable dans la copie ($nextBin)." }
      $proc = Start-Process -FilePath 'node' -ArgumentList "`"$nextBin`" dev -p $Port" -WorkingDirectory $copy -WindowStyle Hidden `
        -RedirectStandardOutput $LogOut -RedirectStandardError $LogErr -PassThru
      Set-Content -Path $PidFile -Value $proc.Id
      Write-Host "Serveur de test demarre en arriere-plan (PID $($proc.Id)). Journaux : $LogOut"
      $ready = $false
      for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        if ($proc.HasExited) { break }
        try { if ((Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/" -TimeoutSec 20).StatusCode -eq 200) { $ready = $true; break } } catch { }
      }
      if (-not $ready) {
        Write-Host "ECHEC du demarrage (processus termine : $($proc.HasExited)). Dernieres lignes du journal :"
        foreach ($f in @($LogOut, $LogErr)) { if (Test-Path $f) { Get-Content $f -Tail 15 } }
        throw 'Le serveur de test n''est pas disponible.'
      }
      Write-Host "PRET : http://localhost:$Port (projet kmjoyioeanjrvohmfash). Arret : .\test-env\lancer-test.ps1 -Cible arret"
      return
    }
    Write-Host "Application de TEST ISOLÉE sur http://localhost:$Port (projet kmjoyioeanjrvohmfash, copie dans $copy). Ctrl+C pour arrêter."
    Set-Location $copy
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
