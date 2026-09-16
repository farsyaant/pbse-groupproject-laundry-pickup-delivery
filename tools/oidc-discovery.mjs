// Read only: fetch public discovery/JWKS without credentials or token output.
function safeUrl(value) {
  const url = new URL(value);
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw new Error('Expected HTTPS (or loopback HTTP) without credentials, query, or fragment.');
  }
  return url;
}

async function readJson(url) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Public OIDC endpoint returned HTTP ${response.status}.`);
  return response.json();
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node tools/oidc-discovery.mjs https://YOUR-TENANT/');
  }
  const issuer = safeUrl(process.argv[2]);
  const base = issuer.href.endsWith('/') ? issuer.href : `${issuer.href}/`;
  const discovery = await readJson(new URL('.well-known/openid-configuration', base));
  if (discovery.issuer !== issuer.href) throw new Error('Discovery issuer does not match the requested issuer.');
  const jwksUrl = safeUrl(discovery.jwks_uri);
  if (jwksUrl.origin !== issuer.origin) throw new Error('JWKS origin differs from the issuer.');
  const jwks = await readJson(jwksUrl);
  const usable = Array.isArray(jwks.keys) && jwks.keys.some(key =>
    key.kty === 'RSA' && key.n && key.e && key.kid &&
    (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256') &&
    (!key.key_ops || key.key_ops.includes('verify')) && !key.d);
  if (!usable) throw new Error('No public RSA signing key compatible with RS256 was found.');
  console.log(`OIDC_ISSUER=${discovery.issuer}`);
  console.log(`OIDC_JWKS_URI=${jwksUrl.href}`);
  console.log('# OIDC_AUDIENCE: copy the configured API Identifier; discovery does not supply it.');
}

main().catch(error => {
  // Do not dump response bodies, request objects, or arbitrary provider errors.
  console.error(error instanceof TypeError ? 'Invalid URL or failed public OIDC request.' : error.message);
  process.exitCode = 1;
});
