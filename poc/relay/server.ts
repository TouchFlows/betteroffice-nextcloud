import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room } from './room.js';
import { SeedRegistry } from './seedRegistry.js';

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.BETTEROFFICE_RELAY_DATA_DIR ?? join(here, 'data');
const port = Number(process.env.BETTEROFFICE_RELAY_PORT ?? 8787);

const rooms = new Map<string, Room>();
const seeds = new SeedRegistry(dataDir);

function roomFor(id: string): Room {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id, dataDir);
    rooms.set(id, room);
  }
  return room;
}

function readBody(request: import('node:http').IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    request.on('error', reject);
  });
}

const httpServer = createServer((request, response) => {
  // Dev-only CORS: the PoC app and relay run on different ports. A real
  // deployment serves the seed endpoint from the Nextcloud app's own origin
  // (§13 calls for strict Origin validation, not a wildcard like this).
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  // Stands in for the Nextcloud-app backend's room-seed endpoint (§8.2):
  // the first client PUTs the seed it generated, create-if-absent; everyone
  // else GETs the one authoritative seed instead of generating their own.
  const seedMatch = request.url?.match(/^\/room\/([^/?]+)\/seed$/);
  if (seedMatch) {
    const roomId = decodeURIComponent(seedMatch[1]);
    if (request.method === 'GET') {
      const bytes = seeds.get(roomId);
      if (!bytes) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(Buffer.from(bytes));
      return;
    }
    if (request.method === 'PUT') {
      void readBody(request).then((body) => {
        const { created, bytes } = seeds.createIfAbsent(roomId, body);
        response.writeHead(created ? 201 : 409, { 'content-type': 'application/octet-stream' });
        response.end(Buffer.from(bytes));
      });
      return;
    }
    response.writeHead(405);
    response.end();
    return;
  }

  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  const match = request.url?.match(/^\/room\/([^/?]+)/);
  if (!match) {
    socket.destroy();
    return;
  }
  const roomId = decodeURIComponent(match[1]);
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, roomId);
  });
});

wss.on('connection', (socket: WebSocket, roomId: string) => {
  const room = roomFor(roomId);
  room.join(socket);

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (!isBinary) {
      socket.close(1003, 'Binary frames only');
      return;
    }
    if (data.byteLength > MAX_FRAME_BYTES) {
      socket.close(1009, `Frame exceeds ${MAX_FRAME_BYTES} bytes`);
      return;
    }
    try {
      room.receive(socket, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } catch (error) {
      console.error(`[relay] room ${roomId}: malformed frame`, error);
      socket.close(1002, 'Malformed collaboration frame');
    }
  });

  socket.on('close', () => room.leave(socket));
  socket.on('error', () => room.leave(socket));
});

httpServer.listen(port, () => {
  console.log(`[relay] listening on :${port}, data dir ${dataDir}`);
});

function shutdown(): void {
  // close() alone only stops accepting new connections; any still-open
  // WebSocket keeps the event loop alive, which leaves a test-driven
  // "restart the relay" step waiting forever for the process to exit.
  wss.clients.forEach((client) => client.terminate());
  httpServer.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
