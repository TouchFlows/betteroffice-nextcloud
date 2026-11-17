import { useEffect, useRef, useState } from 'react';
import { DocxEditor, type DocxEditorRef } from '@betteroffice/docx-react';
import '@betteroffice/docx-react/styles.css';
import { CollaborationProvider, type CollaborationReplica } from '@betteroffice/docx/collaboration';
import { createYrsSession } from '@betteroffice/docx/yrs';
import { WsCollaborationTransport } from '../shared/transport';
import { resolveRoomSeed } from './roomSeed';
import { setDebugHandle } from './debug';
import type { HarnessParams } from './App';

export function DocxHarness({ params }: { params: HarnessParams }) {
  const ref = useRef<DocxEditorRef>(null);
  const providerRef = useRef<CollaborationProvider | null>(null);
  const [initialUpdate, setInitialUpdate] = useState<Uint8Array | undefined>();
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | undefined>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch('/betteroffice-demo.docx');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const seed = await resolveRoomSeed(params.relayUrl, params.room, params.seed, async () => {
        const session = await createYrsSession({ clientId: params.clientId });
        session.seedFromDocx(bytes, { generation: params.room });
        return session.encodeState();
      });
      if (cancelled) return;
      setInitialUpdate(seed);
      setDocumentBuffer(bytes.buffer as ArrayBuffer);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.seed, params.clientId, params.room, params.relayUrl]);

  useEffect(() => {
    if (!ready) return;
    // DocxEditor republishes its imperative handle as its worker finishes
    // initializing — an early snapshot can be a stub whose methods are still
    // undefined, so keep refreshing rather than latching the first non-null one.
    const id = setInterval(() => {
      setDebugHandle({ ready: true, ref: ref.current });
    }, 200);
    return () => clearInterval(id);
  }, [ready]);

  if (!ready) return <div>loading…</div>;

  const onReplica = (replica: CollaborationReplica | null) => {
    providerRef.current?.destroy();
    providerRef.current = null;
    if (!replica) return;
    const transport = new WsCollaborationTransport(`${params.relayUrl}/room/${encodeURIComponent(params.room)}`);
    const provider = new CollaborationProvider(replica, transport, { user: { name: params.userName } });
    provider.onStatus(({ status, synced }) => {
      setDebugHandle({ collab: { status, synced, peers: provider.peers.length } });
    });
    provider.onPeers((peers) => {
      setDebugHandle({ collab: { status: provider.status, synced: provider.synced, peers: peers.length } });
    });
    provider.connect();
    providerRef.current = provider;
  };

  return (
    <div style={{ height: '100vh' }}>
      <DocxEditor
        ref={ref}
        documentBuffer={documentBuffer}
        author={params.userName}
        collaboration={{
          clientId: params.clientId,
          user: { name: params.userName },
          initialUpdate,
          onReplica,
        }}
      />
    </div>
  );
}
