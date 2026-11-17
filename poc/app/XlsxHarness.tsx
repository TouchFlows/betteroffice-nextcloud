import { useEffect, useRef, useState } from 'react';
import { XlsxEditor } from '@betteroffice/xlsx-react';
import {
  CollaborationProvider,
  createAsyncCollaborationReplica,
  type AsyncCollaborationReplica,
} from '@betteroffice/xlsx/collaboration';
import { openWorkbook, initWasm } from '@betteroffice/xlsx';
import { WsCollaborationTransport } from '../shared/transport';
import { resolveRoomSeed } from './roomSeed';
import { setDebugHandle } from './debug';
import type { HarnessParams } from './App';

export function XlsxHarness({ params }: { params: HarnessParams }) {
  const providerRef = useRef<CollaborationProvider | null>(null);
  const wiredRef = useRef(false);
  const [file, setFile] = useState<Uint8Array>();
  const [initialUpdate, setInitialUpdate] = useState<Uint8Array>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await initWasm();
      const response = await fetch('/showcase.xlsx');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const seed = await resolveRoomSeed(params.relayUrl, params.room, params.seed, async () => {
        const workbook = openWorkbook(bytes, { collaborative: true, clientId: params.clientId });
        const update = workbook.encodeStateAsUpdate();
        workbook.dispose();
        return update;
      });
      if (cancelled) return;
      setInitialUpdate(seed);
      setFile(bytes);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.seed, params.clientId, params.room, params.relayUrl]);

  if (!ready) return <div>loading…</div>;

  const wireProvider = (replica: AsyncCollaborationReplica | null) => {
    if (wiredRef.current) return;
    providerRef.current?.destroy();
    providerRef.current = null;
    if (!replica) return;
    wiredRef.current = true;
    const adapted = createAsyncCollaborationReplica(replica);
    const transport = new WsCollaborationTransport(`${params.relayUrl}/room/${encodeURIComponent(params.room)}`);
    const provider = new CollaborationProvider(adapted, transport, { user: { name: params.userName } });
    provider.onStatus(({ status, synced }) => {
      setDebugHandle({ collab: { status, synced, peers: provider.peers.length } });
    });
    provider.connect();
    providerRef.current = provider;
  };

  return (
    <div style={{ height: '100vh' }}>
      <XlsxEditor
        file={file}
        collaboration={{
          clientId: params.clientId,
          initialUpdate,
        }}
        onReady={(api) => {
          setDebugHandle({ ready: true, ref: api });
          wireProvider(api.collaboration);
          return () => {
            providerRef.current?.destroy();
            providerRef.current = null;
            wiredRef.current = false;
          };
        }}
      />
    </div>
  );
}
