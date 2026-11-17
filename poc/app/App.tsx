import { DocxHarness } from './DocxHarness';
import { XlsxHarness } from './XlsxHarness';
import { PptxHarness } from './PptxHarness';

export interface HarnessParams {
  room: string;
  seed: boolean;
  clientId: number;
  userName: string;
  relayUrl: string;
}

function readParams(): HarnessParams {
  const url = new URLSearchParams(window.location.search);
  return {
    room: url.get('room') ?? 'default-room',
    seed: url.get('seed') === '1',
    clientId: Number(url.get('clientId') ?? '1'),
    userName: url.get('user') ?? 'tester',
    relayUrl: url.get('relayUrl') ?? 'ws://localhost:8787',
  };
}

export function App() {
  const url = new URLSearchParams(window.location.search);
  const format = url.get('format') ?? 'docx';
  const params = readParams();

  if (format === 'xlsx') return <XlsxHarness params={params} />;
  if (format === 'pptx') return <PptxHarness params={params} />;
  return <DocxHarness params={params} />;
}
