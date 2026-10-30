$ErrorActionPreference = 'Stop'
# A fresh, unauthenticated loopback-only replica set with a new temporary data directory.
# Existing MongoDB processes, ports and data directories are never used or stopped.
$mongoCommand = Get-Command mongod -ErrorAction Stop
$nodeBinary = $env:npm_node_execpath
if (!$nodeBinary -or !(Test-Path -LiteralPath $nodeBinary)) { $nodeBinary = (Get-Command node.exe -ErrorAction Stop).Source }
$nodeVersion = (& $nodeBinary --version | Out-String).Trim()
if (!$nodeVersion) { throw 'Node runtime did not return its version.' }
$nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Use Node 22+ for this test.' }
$workspaceServer = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testDirectory = Join-Path $temporaryRoot ('aikya-bus-mongo-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testDirectory) | Out-Null
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$testPort = $listener.LocalEndpoint.Port
$listener.Stop()
$testUri = 'mongodb://127.0.0.1:' + $testPort + '/aikya_bus_test?directConnection=true'
$process = $null
$previousTestUri = $env:TRACKING_TEST_MONGODB_URI
try {
  $process = Start-Process -FilePath $mongoCommand.Source -ArgumentList @('--bind_ip', '127.0.0.1', '--port', $testPort, '--dbpath', ('"' + $testDirectory + '"'), '--replSet', 'aikya_tracking_test', '--logpath', ('"' + (Join-Path $testDirectory 'mongod.log') + '"')) -WindowStyle Hidden -PassThru
  $env:TRACKING_TEST_MONGODB_URI = $testUri
  $initScript = @'
const mongoose = require('mongoose');
(async () => {
  const uri = process.env.TRACKING_TEST_MONGODB_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: false });
  const port = new URL(uri).port;
  await mongoose.connection.db.admin().command({ replSetInitiate: { _id: 'aikya_tracking_test', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  for (let attempt = 0; attempt < 100; attempt++) {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (hello.isWritablePrimary) { await mongoose.disconnect(); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Temporary replica set did not elect a primary');
})().catch(async () => { await mongoose.disconnect(); process.exitCode = 1; });
'@
  Push-Location $workspaceServer
  try {
    $initScript | & $nodeBinary
    if ($LASTEXITCODE -ne 0) { throw 'Temporary replica set initialization failed.' }
    & $nodeBinary integration-tests/bus-tracking.mongo.cjs
    if ($LASTEXITCODE -ne 0) { throw 'MongoDB tracking integration failed.' }
  } finally { Pop-Location }
} finally {
  $env:TRACKING_TEST_MONGODB_URI = $previousTestUri
  if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -Force; $process.WaitForExit() }
  # Verify the exact generated absolute target before removing only this temporary DB.
  $resolvedTarget = [IO.Path]::GetFullPath($testDirectory)
  if (!$resolvedTarget.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedTarget) -notmatch '^aikya-bus-mongo-[a-f0-9]{32}$') { throw 'Refusing unsafe temporary cleanup path.' }
  if (Test-Path -LiteralPath $resolvedTarget) { Remove-Item -LiteralPath $resolvedTarget -Recurse -Force }
}
