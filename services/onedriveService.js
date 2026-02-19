const msal = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');
const pool = require('../db');

const msalConfig = {
  auth: {
    clientId: process.env.CLIENT_ID || '',
    clientSecret: process.env.CLIENT_SECRET || '',
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID || 'common'}`,
  }
};

const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:5000/connect/onedrive/callback';
const scopes = ['Files.ReadWrite.All', 'User.Read', 'offline_access'];

function getConfidentialClient() {
  return new msal.ConfidentialClientApplication(msalConfig);
}

async function getAuthUrl(state) {
  const client = getConfidentialClient();
  const authUrl = await client.getAuthCodeUrl({
    scopes,
    redirectUri: REDIRECT_URI,
    responseMode: 'query',
    prompt: 'consent',
    state: state || undefined
  });
  return authUrl;
}

async function exchangeCodeForTokens(companyId, code) {
  const client = getConfidentialClient();
  const result = await client.acquireTokenByCode({
    code,
    scopes,
    redirectUri: REDIRECT_URI
  });

  const expiresAt = result.expiresOn ? new Date(result.expiresOn) : new Date(Date.now() + 3600 * 1000);
  const existing = await pool.query(
    `SELECT id FROM connections WHERE company_id = $1 AND provider = 'ONEDRIVE'`,
    [companyId]
  );

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE connections SET access_token = $1, refresh_token = $2, token_expires_at = $3, status = 'CONNECTED', updated_at = NOW()
       WHERE id = $4`,
      [result.accessToken, result.refreshToken, expiresAt, existing.rows[0].id]
    );
    return existing.rows[0].id;
  } else {
    const ins = await pool.query(
      `INSERT INTO connections (company_id, provider, status, access_token, refresh_token, token_expires_at)
       VALUES ($1, $2, 'CONNECTED', $3, $4, $5) RETURNING id`,
      [companyId, 'ONEDRIVE', result.accessToken, result.refreshToken, expiresAt]
    );
    return ins.rows[0].id;
  }
}

async function getAccessToken(companyId) {
  const conn = await pool.query(
    `SELECT * FROM connections WHERE company_id = $1 AND provider = 'ONEDRIVE' AND status = 'CONNECTED'`,
    [companyId]
  );
  if (conn.rows.length === 0) {
    throw new Error('OneDrive not connected');
  }
  const c = conn.rows[0];
  const expiresAt = c.token_expires_at ? new Date(c.token_expires_at) : new Date(0);
  if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000 && c.refresh_token) {
    const client = getConfidentialClient();
    const result = await client.acquireTokenByRefreshToken({
      refreshToken: c.refresh_token,
      scopes
    });
    const newExpires = result.expiresOn ? new Date(result.expiresOn) : new Date(Date.now() + 3600 * 1000);
    await pool.query(
      `UPDATE connections SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW() WHERE id = $4`,
      [result.accessToken, result.refreshToken || c.refresh_token, newExpires, c.id]
    );
    return result.accessToken;
  }
  return c.access_token;
}

function getGraphClient(accessToken) {
  return Client.init({
    authProvider: (done) => done(null, accessToken)
  });
}

async function uploadFile(companyId, buffer, filename, folderPath) {
  const token = await getAccessToken(companyId);
  const client = getGraphClient(token);
  const basePath = (folderPath || 'HR Consulting AI/Exports').replace(/^\/+|\/+$/g, '');
  const fullPath = basePath ? `${basePath}/${filename}` : filename;
  const upload = await client
    .api(`/me/drive/root:/${fullPath}:/content`)
    .put(buffer);
  return { id: upload.id, webUrl: upload.webUrl };
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getAccessToken,
  uploadFile
};
