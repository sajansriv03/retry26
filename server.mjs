import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';
import { URL } from 'node:url';

const PORT = process.env.PORT || 8787;
const DB_FILE = './server-db.json';

const defaultDb = { users: [], sessions: {}, rooms: {}, history: [] };
const db = existsSync(DB_FILE) ? JSON.parse(readFileSync(DB_FILE, 'utf8')) : defaultDb;
const save = () => writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

const json = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
  res.end(JSON.stringify(payload));
};

const readBody = async (req) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

const hashPassword = (password, salt = randomBytes(16).toString('hex')) => {
  const hash = pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
};

const authUser = (req) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if(!token || !db.sessions[token]) return null;
  return db.users.find(u => u.id === db.sessions[token]);
};

const sanitizeRoom = (room, requesterId) => {
  if(!room) return null;
  const players = room.players.map(p => ({ id: p.id, username: p.username, connected: !!p.connected }));
  const state = room.state ? JSON.parse(JSON.stringify(room.state)) : null;
  return { id: room.id, hostId: room.hostId, players, started: room.started, locked: room.locked, revision: room.revision, state, youAreHost: room.hostId === requesterId };
};

const ensureStats = (user) => {
  user.stats ||= { wins: 0, losses: 0, vs: {} };
  return user.stats;
};

const server = http.createServer(async (req, res) => {
  if(req.method === 'OPTIONS') return json(res, 200, { ok: true });
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if(req.method === 'POST' && url.pathname === '/api/register') {
      const { username, password } = await readBody(req);
      if(!username || !password) return json(res, 400, { error: 'username and password required' });
      if(db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return json(res, 400, { error: 'username already exists' });
      const { salt, hash } = hashPassword(password);
      const user = { id: randomUUID(), username, salt, hash, stats: { wins: 0, losses: 0, vs: {} } };
      db.users.push(user);
      const token = randomUUID();
      db.sessions[token] = user.id;
      save();
      return json(res, 200, { token, user: { id: user.id, username: user.username, stats: user.stats } });
    }

    if(req.method === 'POST' && url.pathname === '/api/login') {
      const { username, password } = await readBody(req);
      const user = db.users.find(u => u.username.toLowerCase() === String(username||'').toLowerCase());
      if(!user) return json(res, 401, { error: 'invalid credentials' });
      const { hash } = hashPassword(password, user.salt);
      if(hash !== user.hash) return json(res, 401, { error: 'invalid credentials' });
      const token = randomUUID();
      db.sessions[token] = user.id;
      save();
      return json(res, 200, { token, user: { id: user.id, username: user.username, stats: user.stats } });
    }

    if(req.method === 'GET' && url.pathname === '/api/me') {
      const user = authUser(req);
      if(!user) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { user: { id: user.id, username: user.username, stats: user.stats } });
    }

    if(req.method === 'POST' && url.pathname === '/api/rooms') {
      const user = authUser(req);
      if(!user) return json(res, 401, { error: 'unauthorized' });
      const { maxPlayers } = await readBody(req);
      const max = Math.max(2, Math.min(4, Number(maxPlayers || 4)));
      const room = { id: randomUUID().slice(0, 8), hostId: user.id, players: [{ id: user.id, username: user.username, connected: true }], maxPlayers: max, started: false, locked: false, state: null, revision: 0 };
      db.rooms[room.id] = room;
      save();
      return json(res, 200, { room: sanitizeRoom(room, user.id) });
    }

    if(req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/[^/]+\/join$/)) {
      const user = authUser(req);
      if(!user) return json(res, 401, { error: 'unauthorized' });
      const roomId = url.pathname.split('/')[3];
      const room = db.rooms[roomId];
      if(!room) return json(res, 404, { error: 'room not found' });
      let seat = room.players.find(p => p.id === user.id);
      if(!seat) {
        if(room.started || room.players.length >= room.maxPlayers) return json(res, 400, { error: 'room full or started' });
        seat = { id: user.id, username: user.username, connected: true };
        room.players.push(seat);
      }
      seat.connected = true;
      room.revision += 1;
      save();
      return json(res, 200, { room: sanitizeRoom(room, user.id) });
    }

    if(req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/[^/]+\/start$/)) {
      const user = authUser(req);
      if(!user) return json(res, 401, { error: 'unauthorized' });
      const roomId = url.pathname.split('/')[3];
      const room = db.rooms[roomId];
      if(!room) return json(res, 404, { error: 'room not found' });
      if(room.hostId !== user.id) return json(res, 403, { error: 'host only' });
      if(room.players.length < 2 || room.players.length > 4) return json(res, 400, { error: 'need 2-4 players' });
      const { state } = await readBody(req);
      room.started = true;
      room.state = state || null;
      room.revision += 1;
      save();
      return json(res, 200, { room: sanitizeRoom(room, user.id) });
    }

    if(req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/[^/]+\/state$/)) {
      const user = authUser(req);
      if(!user) return json(res, 401, { error: 'unauthorized' });
      const roomId = url.pathname.split('/')[3];
      const room = db.rooms[roomId];
      if(!room) return json(res, 404, { error: 'room not found' });
      if(!room.players.some(p => p.id === user.id)) return json(res, 403, { error: 'not in room' });
      const { state, reportWinnerId } = await readBody(req);
      room.state = state;
      room.revision += 1;

      if(reportWinnerId && room.started) {
        const winner = room.players.find(p => p.id === reportWinnerId);
        if(winner) {
          room.players.forEach(p => {
            const u = db.users.find(x => x.id === p.id);
            if(!u) return;
            const stats = ensureStats(u);
            if(p.id === winner.id) stats.wins += 1; else stats.losses += 1;
            room.players.filter(op => op.id !== p.id).forEach(op => {
              stats.vs[op.username] ||= { wins: 0, losses: 0 };
              if(p.id === winner.id) stats.vs[op.username].wins += 1;
              else stats.vs[op.username].losses += 1;
            });
          });
          db.history.push({ id: randomUUID(), roomId, players: room.players.map(p=>p.username), winner: winner.username, at: Date.now() });
          room.started = false;
        }
      }

      save();
      return json(res, 200, { ok: true, revision: room.revision });
    }

    if(req.method === 'GET' && url.pathname.match(/^\/api\/rooms\/[^/]+$/)) {
      const user = authUser(req);
      if(!user) return json(res, 401, { error: 'unauthorized' });
      const roomId = url.pathname.split('/')[3];
      const room = db.rooms[roomId];
      if(!room) return json(res, 404, { error: 'room not found' });
      const seat = room.players.find(p => p.id === user.id);
      if(seat) seat.connected = true;
      save();
      return json(res, 200, { room: sanitizeRoom(room, user.id) });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: e.message || 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
