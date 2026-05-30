Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=9222 --user-data-dir=C:\ChromeScraper"
Start-Sleep 4
$port = netstat -an | findstr "9222"
if ($port) { Write-Host "Chrome ready on port 9222 - log in to Amazon if needed, then run npm start" }
else { Write-Host "Chrome did not start correctly, try again" }
