param(
  [switch]$Check
)

pnpm install
if ($Check) {
  pnpm test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  pnpm check
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  pnpm typecheck
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  pnpm build
  exit $LASTEXITCODE
}

pnpm dev
