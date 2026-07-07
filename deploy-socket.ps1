# Automated deploy-socket.ps1 script for the standalone Socket.IO server.
# Run this from PowerShell inside the project root directory.

$SSH_KEY = "$HOME\Downloads\ssh-key-2026-06-13.key"
$REMOTE_USER = "ubuntu"
$REMOTE_HOST = "92.4.90.211"
$SERVER_DIR = "socket-server"
$TAR_NAME = "socket-server.tar.gz"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Starting socket server deployment..." -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Package the source code
Write-Host "[1/5] Packaging local socket server source code..." -ForegroundColor Yellow
if (Test-Path $TAR_NAME) {
    Remove-Item $TAR_NAME -Force
}
tar -czf $TAR_NAME -C $SERVER_DIR src package.json tsconfig.json .env .gitignore
if (-not $?) {
    Write-Error "Failed to package code."
    Exit 1
}

# 2. Transfer the package to VM
Write-Host "[2/5] Uploading package to remote server ($REMOTE_HOST)..." -ForegroundColor Yellow
scp -i $SSH_KEY -o StrictHostKeyChecking=no $TAR_NAME "${REMOTE_USER}@${REMOTE_HOST}:/home/ubuntu/"
if (-not $?) {
    Write-Error "Failed to upload package via SCP."
    Remove-Item $TAR_NAME -Force
    Exit 1
}

# 3. Extract and configure remote server
Write-Host "[3/5] Extracting package on remote server..." -ForegroundColor Yellow
ssh -i $SSH_KEY -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p $SERVER_DIR && tar -xzf $TAR_NAME -C $SERVER_DIR && rm $TAR_NAME"
if (-not $?) {
    Write-Error "Failed to extract package on remote host."
    Remove-Item $TAR_NAME -Force
    Exit 1
}

# 4. Install dependencies and compile TypeScript
Write-Host "[4/5] Running npm install and building server on remote host..." -ForegroundColor Yellow
ssh -i $SSH_KEY -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "cd $SERVER_DIR && npm install && npm run build"
if (-not $?) {
    Write-Error "Build failed on remote host."
    Remove-Item $TAR_NAME -Force
    Exit 1
}

# 5. Restart server on PM2
Write-Host "[5/5] Restarting server via PM2..." -ForegroundColor Yellow
ssh -i $SSH_KEY -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "cd $SERVER_DIR && (pm2 restart socket-server || pm2 start dist/server.js --name socket-server)"
if (-not $?) {
    Write-Error "Failed to restart process under PM2."
    Remove-Item $TAR_NAME -Force
    Exit 1
}

# 6. Cleanup local package
Write-Host "Cleaning up local temporary package archive..." -ForegroundColor Yellow
Remove-Item $TAR_NAME -Force

# 7. Check health status
Write-Host "Checking remote server health status..." -ForegroundColor Green
Start-Sleep -Seconds 2
Invoke-RestMethod -Uri "http://${REMOTE_HOST}:3001/api/health" -Method Get

Write-Host "=============================================" -ForegroundColor Green
Write-Host "Deployment Completed Successfully!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
