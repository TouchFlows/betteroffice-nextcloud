import type { CollaborationTransport as DocxTransport } from '@betteroffice/docx/collaboration';
import type { CollaborationTransport as PptxTransport } from '@betteroffice/pptx/collaboration';
import type { CollaborationTransport as XlsxTransport } from '@betteroffice/xlsx/collaboration';
import type { WsCollaborationTransport } from './transport';

/**
 * Compile-time proof that the shared transport still fits all three formats'
 * provider constructors.
 *
 * `transport.ts` declares the contract itself rather than borrowing one
 * package's type, which is what lets the spreadsheet and presentation editors
 * reuse it -- but that only works while the three packages agree on the
 * contract. If a dependency bump gives any of them a different shape, tsc
 * fails here and names the format, instead of the mismatch surfacing later as
 * a provider that refuses its transport in a half-written collaboration
 * slice (poc/RECONNAISSANCE.md §3).
 *
 * Nothing imports this module: `tsc --noEmit` type-checks it, the bundler
 * never sees it, and it has no runtime cost.
 */

type Assignable<From, To> = From extends To ? true : false;

export const DOCX_TRANSPORT_FITS: Assignable<WsCollaborationTransport, DocxTransport> = true;
export const XLSX_TRANSPORT_FITS: Assignable<WsCollaborationTransport, XlsxTransport> = true;
export const PPTX_TRANSPORT_FITS: Assignable<WsCollaborationTransport, PptxTransport> = true;
