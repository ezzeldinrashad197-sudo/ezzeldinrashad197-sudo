import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { resolveEnvironment, createApp } from '../server.js';

console.log('================================================================================');
console.log('  STRUCTUSIGHT — DEPLOYMENT & RUNTIME ENTRYPOINT AUDIT SUITE');
console.log('================================================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    failCount++;
  }
}

async function run() {
  // 1. Runtime Entrypoint & Platform Node Version
  const nodeVersion = process.version;
  console.log(`\n--- SECTION 1: RUNTIME ENTRYPOINT AUDIT (Node: ${nodeVersion}) ---`);
  assert(nodeVersion.startsWith('v22.'), `Node runtime version verified: ${nodeVersion} (Target: Node 22 Cloud Run)`);

  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  assert(pkg.scripts.start === 'node dist/server.cjs', `package.json start script points to compiled JS entrypoint: '${pkg.scripts.start}'`);
  assert(fs.existsSync(path.resolve(process.cwd(), 'dist/server.cjs')), `Compiled production entrypoint exists: dist/server.cjs (${(fs.statSync(path.resolve(process.cwd(), 'dist/server.cjs')).size / 1024).toFixed(1)} KB)`);
  assert(fs.existsSync(path.resolve(process.cwd(), 'dist/index.html')), `Compiled production static HTML exists: dist/index.html (${fs.statSync(path.resolve(process.cwd(), 'dist/index.html')).size} bytes)`);

  // 2. Verify Environment Resolution Scenarios
  console.log('\n--- SECTION 2: ENVIRONMENT DETECTION SCENARIOS ---');
  
  // Scenario A: AI Studio dev container
  process.env.NODE_ENV = 'development';
  process.env.K_SERVICE = 'ais-dev-k33a24ou3xwld6wy37hakh';
  process.env.PORT = '8080';
  let env = resolveEnvironment();
  assert(env.isDev === true && env.isProd === false, 'Scenario A (AI Studio dev container): isDev=true, isProd=false');

  // Scenario B: Local development
  process.env.NODE_ENV = 'development';
  delete process.env.K_SERVICE;
  delete process.env.PORT;
  env = resolveEnvironment();
  assert(env.isDev === true && env.isProd === false, 'Scenario B (Local development NODE_ENV=development): isDev=true, isProd=false');

  // Scenario C: Production with NODE_ENV=production
  process.env.NODE_ENV = 'production';
  delete process.env.K_SERVICE;
  env = resolveEnvironment();
  assert(env.isDev === false && env.isProd === true, 'Scenario C (Production NODE_ENV=production): isDev=false, isProd=true');

  // Scenario D: Production with Cloud Run K_SERVICE (ais-pre-... or prod service)
  delete process.env.NODE_ENV;
  process.env.K_SERVICE = 'ais-pre-k33a24ou3xwld6wy37hakh';
  env = resolveEnvironment();
  assert(env.isDev === false && env.isProd === true, 'Scenario D1 (Production K_SERVICE=ais-pre-...): isDev=false, isProd=true');

  process.env.K_SERVICE = 'structusight-cloudrun-prod';
  env = resolveEnvironment();
  assert(env.isDev === false && env.isProd === true, 'Scenario D2 (Production K_SERVICE=structusight-cloudrun-prod): isDev=false, isProd=true');

  // Scenario E: Missing / unexpected environment variables
  delete process.env.NODE_ENV;
  delete process.env.K_SERVICE;
  env = resolveEnvironment();
  assert(env.isDev === true && env.isProd === false, 'Scenario E1 (Unset env vars): defaults safely to development');

  process.env.NODE_ENV = 'staging';
  process.env.K_SERVICE = 'custom-cloud-run-service';
  env = resolveEnvironment();
  assert(env.isDev === false && env.isProd === true, 'Scenario E2 (Staging Cloud Run service): fails closed to production mode');

  // 3. Verify Artifact Validation & Diagnostic Failure
  console.log('\n--- SECTION 3: ARTIFACT VALIDATION & RECURSION GUARD ---');
  process.env.NODE_ENV = 'production';
  delete process.env.K_SERVICE;

  // Temporarily rename dist/index.html to test missing artifact behavior
  const distHtml = path.resolve(process.cwd(), 'dist/index.html');
  const tempHtml = path.resolve(process.cwd(), 'dist/index.html.bak');
  let missingArtifactCaught = false;

  try {
    fs.renameSync(distHtml, tempHtml);
    try {
      await createApp({ skipVite: true });
    } catch (err: any) {
      if (err.message.includes('[CRITICAL PRODUCTION ERROR] Required production artifact')) {
        missingArtifactCaught = true;
      }
    }
  } finally {
    if (fs.existsSync(tempHtml)) {
      fs.renameSync(tempHtml, distHtml);
    }
  }
  assert(missingArtifactCaught, 'Production fails closed with clear diagnostic when dist/index.html is missing');

  // 4. Test Actual Production Server Startup & Single-Instance Initialization
  console.log('\n--- SECTION 4: PRODUCTION SERVER STARTUP & ENDPOINT VERIFICATION ---');
  
  const testPort = 31980;
  const startProd = spawn('node', ['dist/server.cjs'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(testPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  startProd.stdout?.on('data', (d) => { serverOutput += d.toString(); });
  startProd.stderr?.on('data', (d) => { serverOutput += d.toString(); });

  // Wait for server to start
  await new Promise((r) => setTimeout(r, 1200));

  try {
    // Check single initialization
    const listenMatches = (serverOutput.match(/Server running on http:\/\/0\.0\.0\.0/g) || []).length;
    assert(listenMatches === 1, `Server initialized exactly once (Listen logged: ${listenMatches} time)`);

    // HTTP GET /
    const rootRes = await fetch(`http://127.0.0.1:${testPort}/`);
    const rootText = await rootRes.text();
    assert(rootRes.status === 200, `GET / returned HTTP 200 OK`);
    assert(rootText.includes('<!doctype html>') && rootText.includes('StructuSight'), `GET / returned compiled SPA HTML document`);

    // HTTP GET /healthz
    const healthzRes = await fetch(`http://127.0.0.1:${testPort}/healthz`);
    const healthzJson = await healthzRes.json();
    assert(healthzRes.status === 200 && healthzJson.status === 'ok', `GET /healthz returned status: ok`);

    // HTTP GET /_ah/health
    const ahHealthRes = await fetch(`http://127.0.0.1:${testPort}/_ah/health`);
    const ahHealthJson = await ahHealthRes.json();
    assert(ahHealthRes.status === 200 && ahHealthJson.status === 'ok', `GET /_ah/health returned status: ok`);

    // Static asset fetch
    const assetMatch = rootText.match(/\/assets\/[A-Za-z0-9._-]+\.js/);
    if (assetMatch) {
      const assetUrl = `http://127.0.0.1:${testPort}${assetMatch[0]}`;
      const assetRes = await fetch(assetUrl);
      assert(assetRes.status === 200, `Static asset GET ${assetMatch[0]} returned HTTP 200 OK (${assetRes.headers.get('content-type')})`);
    } else {
      assert(false, 'Static asset discovery in index.html', 'No asset bundle link found in HTML');
    }

    // Security header inspection
    assert(rootRes.headers.get('cross-origin-opener-policy') === 'same-origin-allow-popups', 'COOP security header configured for popup OAuth');
    assert(rootRes.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff present');

  } finally {
    startProd.kill('SIGTERM');
  }

  // 5. Test node server.ts in Production Mode (Ensures clean delegation without double-start)
  console.log('\n--- SECTION 5: NODE SERVER.TS PRODUCTION EXECUTION AUDIT ---');
  const tsTestPort = 31985;
  const startTsProd = spawn('node', ['server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(tsTestPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let tsOutput = '';
  startTsProd.stdout?.on('data', (d) => { tsOutput += d.toString(); });
  startTsProd.stderr?.on('data', (d) => { tsOutput += d.toString(); });

  await new Promise((r) => setTimeout(r, 1500));

  try {
    const tsListenMatches = (tsOutput.match(/Server running on http:\/\/0\.0\.0\.0/g) || []).length;
    assert(tsListenMatches === 1, `node server.ts in production initialized exactly once (Listen logged: ${tsListenMatches} time)`);

    const tsRootRes = await fetch(`http://127.0.0.1:${tsTestPort}/`);
    assert(tsRootRes.status === 200, `node server.ts GET / returned HTTP 200 OK`);

    const tsHealthRes = await fetch(`http://127.0.0.1:${tsTestPort}/healthz`);
    assert(tsHealthRes.status === 200, `node server.ts GET /healthz returned HTTP 200 OK`);
  } finally {
    startTsProd.kill('SIGTERM');
  }

  console.log('\n================================================================================');
  console.log(`Audit Results: ${passCount} Passed, ${failCount} Failed.`);
  console.log('================================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Audit crashed with error:', err);
  process.exit(1);
});
