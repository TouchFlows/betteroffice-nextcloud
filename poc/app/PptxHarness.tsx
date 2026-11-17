import { useEffect, useRef, useState } from 'react';
import { PptxEditor } from '@betteroffice/pptx-react';
import { CollaborationProvider, type AsyncCollaborationReplica } from '@betteroffice/pptx/collaboration';
import { openPresentation, initWasm } from '@betteroffice/pptx';
import { WsCollaborationTransport } from '../shared/transport';
import { resolveRoomSeed } from './roomSeed';
import { setDebugHandle } from './debug';
import type { HarnessParams } from './App';

export function PptxHarness({ params }: { params: HarnessParams }) {
  const providerRef = useRef<CollaborationProvider | null>(null);
  const [file, setFile] = useState<Uint8Array>();
  const [initialUpdate, setInitialUpdate] = useState<Uint8Array>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await initWasm();
      const response = await fetch('/betteroffice-demo.pptx');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const seed = await resolveRoomSeed(params.relayUrl, params.room, params.seed, async () => {
        const presentation = openPresentation(bytes, { clientId: params.clientId });
        const update = presentation.encodeStateAsUpdate();
        presentation.dispose();
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

  const onReplica = (replica: AsyncCollaborationReplica | null) => {
    providerRef.current?.destroy();
    providerRef.current = null;
    if (!replica) return;
    const transport = new WsCollaborationTransport(`${params.relayUrl}/room/${encodeURIComponent(params.room)}`);
    const provider = new CollaborationProvider(replica, transport, { user: { name: params.userName } });
    provider.onStatus(({ status, synced }) => {
      setDebugHandle({ collab: { status, synced, peers: provider.peers.length } });
    });
    provider.onPresence(() => {
      setDebugHandle({ collab: { status: provider.status, synced: provider.synced, peers: provider.peers.length } });
    });
    provider.connect();
    providerRef.current = provider;
  };

  return (
    <div style={{ height: '100vh' }}>
      <PptxEditor
        file={file}
        fonts={[]}
        collaboration={{
          clientId: params.clientId,
          initialUpdate,
          onReplica,
        }}
        onReady={(api) => setDebugHandle({ ready: true, ref: api })}
      />
    </div>
  );
}
