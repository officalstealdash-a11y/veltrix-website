import express from 'express';
import session from 'express-session';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const {
  DISCORD_CLIENT_ID: CLIENT_ID = '816582705826365471',
  DISCORD_CLIENT_SECRET: CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE',
  DISCORD_BOT_TOKEN: BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE',
  REDIRECT_URI = 'http://localhost:3000/callback',
  SECRET_KEY = 'change-this-in-production',
  PORT = 3000,
} = process.env;

const DISCORD_API = 'https://discord.com/api/v10';
const CONFIG_DIR = join(__dirname, 'guild_configs');
if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(session({
  secret: SECRET_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

const OAUTH_URL =
  `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code&scope=identify+guilds`;

async function discordFetch(endpoint, { token, bot } = {}) {
  const headers = {};
  if (bot) headers['Authorization'] = `Bot ${BOT_TOKEN}`;
  else if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${DISCORD_API}${endpoint}`, { headers });
  return res.ok ? res.json() : null;
}

async function exchangeCode(code) {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  return res.json();
}

function loadConfig(guildId) {
  const path = join(CONFIG_DIR, `${guildId}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function saveConfig(guildId, data) {
  writeFileSync(join(CONFIG_DIR, `${guildId}.json`), JSON.stringify(data, null, 2));
}

function hasAdmin(guild) {
  return Boolean(BigInt(guild.permissions ?? 0) & 8n);
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  next();
}

app.get('/login', (_, res) => res.redirect(OAUTH_URL));

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/');

  const tokenData = await exchangeCode(code);
  if (!tokenData?.access_token) return res.redirect('/');

  const [user, guilds] = await Promise.all([
    discordFetch('/users/@me', { token: tokenData.access_token }),
    discordFetch('/users/@me/guilds', { token: tokenData.access_token }),
  ]);
  if (!user) return res.redirect('/');

  req.session.user = user;
  req.session.token = tokenData.access_token;
  req.session.guilds = Array.isArray(guilds) ? guilds : [];
  res.redirect('/dashboard');
});

app.get('/dashboard', requireLogin, (_, res) =>
  res.sendFile(join(__dirname, 'dashboard.html'))
);

app.get('/api/config/:guildId', requireLogin, (req, res) => {
  const { guildId } = req.params;
  if (!req.session.guilds.some(g => g.id === guildId && hasAdmin(g)))
    return res.status(403).json({ error: 'Forbidden' });
  res.json(loadConfig(guildId));
});

app.post('/api/config/:guildId', requireLogin, (req, res) => {
  const { guildId } = req.params;
  if (!req.session.guilds.some(g => g.id === guildId && hasAdmin(g)))
    return res.status(403).json({ error: 'Forbidden' });
  saveConfig(guildId, req.body);
  res.json({ ok: true });
});

app.listen(PORT, () =>
  console.log(`VELTRIX running → http://localhost:${PORT}`)
);
