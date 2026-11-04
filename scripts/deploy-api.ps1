if ((Get-Content api/wrangler.jsonc -Raw) -match '"database_id": "local-only"') {
  throw 'Set api/wrangler.jsonc database_id to the D1 database ID before deploying.'
}

Push-Location api
try {
  pnpm exec wrangler d1 migrations apply DB --remote
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  pnpm exec wrangler deploy
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
