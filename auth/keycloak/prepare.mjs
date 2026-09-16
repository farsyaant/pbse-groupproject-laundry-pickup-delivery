import { mkdir, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const runtime = new URL('./.runtime/', import.meta.url);
await mkdir(runtime, { recursive: true, mode: 0o700 });
try {
  await access(new URL('credentials.json', runtime));
  console.log('Existing local configuration preserved.');
  process.exit(0);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const secret = () => randomBytes(32).toString('base64url');
const permissions = ['orders:read', 'orders:write', 'pickups:read', 'orders:fulfil', 'pickups:write'];
const actors = {
  customer: ['orders:read', 'orders:write'],
  driver: ['pickups:read', 'pickups:write'],
  staff: ['orders:read', 'pickups:read', 'orders:fulfil'],
};
const fixtures = [
  ['student-a', 'customer', 'cus_studentA'], ['student-b', 'customer', 'cus_studentB'],
  ['courier-a', 'driver', 'drv_courierA'], ['courier-b', 'driver', 'drv_courierB'],
  ['staff-outlet-a', 'staff', 'outlet_a'], ['staff-outlet-b', 'staff', 'outlet_b'],
];
const credentials = { admin: secret(), scheduledJob: secret(), users: {} };
const publicClient = (clientId, callbacks, origins, scopes) => ({
  clientId, enabled: true, protocol: 'openid-connect', publicClient: true,
  standardFlowEnabled: true, implicitFlowEnabled: false,
  directAccessGrantsEnabled: false, serviceAccountsEnabled: false,
  fullScopeAllowed: false, redirectUris: callbacks, webOrigins: origins,
  attributes: { 'pkce.code.challenge.method': 'S256', 'use.refresh.tokens': 'true' },
  defaultClientScopes: ['laundry-audience'], optionalClientScopes: scopes,
});
const realm = {
  realm: 'laundry', enabled: true, sslRequired: 'external',
  registrationAllowed: false, resetPasswordAllowed: false, rememberMe: false,
  loginWithEmailAllowed: false, bruteForceProtected: true,
  accessTokenLifespan: 300, ssoSessionIdleTimeout: 1800, ssoSessionMaxLifespan: 28800,
  revokeRefreshToken: true, refreshTokenMaxReuse: 0,
  defaultSignatureAlgorithm: 'RS256',
  roles: { realm: [
    ...permissions.map(name => ({ name })),
    ...Object.entries(actors).map(([name, roles]) => ({ name, composite: true, composites: { realm: roles } })),
  ] },
  clientScopes: [
    ...permissions.map(name => ({ name, protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true' } })),
    { name: 'laundry-audience', protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'false' },
      protocolMappers: [{ name: 'laundry-api', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
        config: { 'included.custom.audience': 'laundry-api', 'access.token.claim': 'true', 'id.token.claim': 'false' } }] },
  ],
  // A scope is available only when the user/service account has the matching role.
  scopeMappings: permissions.map(name => ({ clientScope: name, roles: [name] })),
  clients: [
    publicClient('laundry-web', ['http://localhost:5173/callback'], ['http://localhost:5173'], actors.staff),
    publicClient('laundry-mobile', ['id.ac.ugm.laundry://oauth/callback'], [], [...actors.customer, ...actors.driver]),
    { clientId: 'laundry-scheduled-job', enabled: true, protocol: 'openid-connect',
      publicClient: false, clientAuthenticatorType: 'client-secret', secret: credentials.scheduledJob,
      standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false,
      serviceAccountsEnabled: true, fullScopeAllowed: false, redirectUris: [], webOrigins: [],
      attributes: { 'use.refresh.tokens': 'false', 'client_credentials.use_refresh_token': 'false' },
      defaultClientScopes: ['laundry-audience'], optionalClientScopes: ['orders:read', 'pickups:read'] },
  ],
  users: [
    ...fixtures.map(([username, actor, domainId]) => {
      const password = secret();
      credentials.users[username] = password;
      return { username, firstName: username, lastName: 'Test', email: `${username}@example.invalid`,
        enabled: true, requiredActions: [], realmRoles: [actor],
        attributes: { actor: [actor], fixture_domain_id: [domainId] },
        credentials: [{ type: 'password', value: password, temporary: false }] };
    }),
    { username: 'service-account-laundry-scheduled-job', enabled: true,
      serviceAccountClientId: 'laundry-scheduled-job', realmRoles: ['orders:read', 'pickups:read'] },
  ],
};
// Parent directory is 0700. Import file must be readable by the container user.
await writeFile(new URL('laundry-realm.json', runtime), JSON.stringify(realm, null, 2), { mode: 0o644 });
await writeFile(new URL('.env', runtime), `KC_BOOTSTRAP_ADMIN_PASSWORD=${credentials.admin}\n`, { mode: 0o600 });
await writeFile(new URL('credentials.json', runtime), JSON.stringify(credentials, null, 2), { mode: 0o600 });
console.log('Local realm and private credentials generated in auth/keycloak/.runtime/. No secrets printed.');
