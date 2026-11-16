// Live co-editing: a Hocuspocus (Yjs) server attached to the app's HTTP server.
// The live document lives in memory while people edit it; its state is stored in
// SQLite, and its text is saved back to the document so reading, search,
// previews and version history keep working.
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON, updateYFragment } from 'y-prosemirror';
import { markdownToDoc, docToMarkdown } from '../shared/convert.mjs';
import { documentSchema } from '../shared/schema.mjs';
import { randomUUID } from 'node:crypto';
import { BLOCK_KINDS, toEntries, fromEntries, withBlockData } from '../shared/blocks.mjs';
import { normalizeWorkbook } from '../shared/sheet-engine.mjs';
import { normalizeDeck } from '../shared/slides-engine.mjs';

const FIELD = 'default';
const normalize = { sheet: normalizeWorkbook, slides: normalizeDeck };

/** Every spreadsheet/presentation block gets an id (bid) and its entries in the shared "blocks" map, so people can
 *  co-edit its cells and slide objects separately. Done here (not in browsers) so two people opening a document
 *  at once can't both start the entries. Copies of a block (the same id twice) get their own. */
export function ensureBlocks(document) {
  const frag = document.getXmlFragment(FIELD); const blocks = document.getMap('blocks'); const seen = new Set();
  const walk = (el) => {
    for (const child of el.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (BLOCK_KINDS.includes(child.nodeName)) {
        const kind = child.nodeName; let bid = child.getAttribute('bid');
        const copy = bid && seen.has(bid);
        if (!bid || copy) { bid = randomUUID(); child.setAttribute('bid', bid); }
        seen.add(bid);
        if (!blocks.get(bid)?.size) {
          let data = null; try { data = normalize[kind](JSON.parse(child.getAttribute('data') || '{}')); } catch { data = normalize[kind]({}); }
          const m = new Y.Map(); blocks.set(bid, m);
          for (const [k, v] of Object.entries(toEntries(kind, data))) m.set(k, v);
        }
      }
      walk(child);
    }
  };
  document.transact(() => walk(frag), 'server');
}
/** The document as ProseMirror JSON with each block's latest data (from its entries). */
export function liveJSON(document) {
  const blocks = document.getMap('blocks');
  return withBlockData(yDocToProsemirrorJSON(document, FIELD), (bid) => { const m = blocks.get(bid); return m && m.size ? m.toJSON() : null; });
}
export const storeForTests = (document) => refreshSnapshots(document);
/** Keep each block's saved snapshot (its data attribute) up to date, for places that read it without live editing.
 *  A browser still running the previous version of the app (not reloaded since an update) saves whole blocks in that
 *  attribute instead of entries: such a change is folded into the entries rather than overwritten. */
const lastSnapshot = new WeakMap(); // Y element → the snapshot the server last wrote or saw
function refreshSnapshots(document) {
  const frag = document.getXmlFragment(FIELD); const blocks = document.getMap('blocks');
  const walk = (el) => {
    for (const child of el.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (BLOCK_KINDS.includes(child.nodeName)) {
        const kind = child.nodeName; const m = blocks.get(child.getAttribute('bid')); const attr = child.getAttribute('data');
        if (m?.size) {
          const seen = lastSnapshot.get(child);
          if (seen !== undefined && attr !== seen) { // changed by an older browser: bring that change into the entries
            try {
              const next = toEntries(kind, normalize[kind](JSON.parse(attr))); const cur = m.toJSON();
              for (const [k, v] of Object.entries(next)) if (cur[k] !== v) m.set(k, v);
              for (const k of Object.keys(cur)) if (!(k in next)) m.delete(k);
            } catch { /* not valid: ignore it */ }
          }
          const data = JSON.stringify(normalize[kind](fromEntries(kind, m.toJSON())));
          if (attr !== data) child.setAttribute('data', data);
          lastSnapshot.set(child, data);
        }
      }
      walk(child);
    }
  };
  document.transact(() => walk(frag), 'server');
}


export function createCollab({ db, userForRequest }) {
  const lastEditor = new Map(); // noteId -> user id of the most recent editor

  const hocus = Server.configure({
    quiet: true,
    debounce: 1200,
    maxDebounce: 6000,
    async onAuthenticate({ request, documentName, connection }) {
      const user = userForRequest(request);
      if (!user) throw new Error('Please sign in');
      const note = db.get('notes', documentName, user.id);
      if (!note) throw new Error('Document not found');
      if (note.access === 'view') connection.readOnly = true;
      return { user };
    },
    async onLoadDocument({ documentName, document }) {
      const state = db.loadYState(documentName);
      if (state) {
        Y.applyUpdate(document, new Uint8Array(state));
      } else {
        // First time this document is opened live: build it from the saved text.
        const seed = prosemirrorJSONToYDoc(documentSchema(), markdownToDoc(db.noteContent(documentName)), FIELD);
        Y.applyUpdate(document, Y.encodeStateAsUpdate(seed));
      }
      ensureBlocks(document);
      return document;
    },
    async onChange({ documentName, context }) {
      if (context?.user) lastEditor.set(documentName, context.user.id);
    },
    async onStoreDocument({ documentName, document }) {
      try { refreshSnapshots(document); } catch (err) { console.error('Couldn’t refresh block snapshots', documentName, err); }
      db.saveYState(documentName, Buffer.from(Y.encodeStateAsUpdate(document)));
      const uid = lastEditor.get(documentName);
      if (!uid) return;
      try {
        const markdown = docToMarkdown(liveJSON(document)); // with every block's latest data
        db.saveContentFromCollab(documentName, markdown, uid);
      } catch (err) { console.error('Couldn’t save live document', documentName, err); }
    },
  });

  return {
    handleConnection: (ws, request) => hocus.handleConnection(ws, request),
    /** The document's text right now, if it's open for live editing (the database copy is saved in batches). */
    liveMarkdown(noteId) { const doc = hocus.documents.get(noteId); if (!doc) return null; try { return docToMarkdown(liveJSON(doc)); } catch { return null; } },
    /** The document's text changed outside the editor (checkbox, restore, import): update live copies. */
    replaceContent(noteId, markdown) {
      const doc = hocus.documents.get(noteId);
      if (!doc) { db.clearYState(noteId); return; }
      try {
        const node = documentSchema().nodeFromJSON(markdownToDoc(markdown));
        doc.transact(() => updateYFragment(doc, doc.getXmlFragment(FIELD), node, { mapping: new Map(), isOMark: new Map() }), 'server');
        ensureBlocks(doc);
      } catch (err) {
        console.error('Couldn’t update live document', noteId, err);
        db.clearYState(noteId);
      }
    },
    connectionsFor: (noteId) => hocus.documents.get(noteId)?.getConnectionsCount?.() || 0,
    close: () => hocus.closeConnections?.(),
    /** Disconnect everyone from a document (they reconnect if they still have access). */
    closeDocument: (noteId) => hocus.closeConnections?.(noteId),
    /** Sharing changed, a link was turned off or the document was deleted: check every open connection again, in place.
     *  People who lost access are disconnected (and can't reconnect); people now only allowed to view become read-only.
     *  Everyone else stays connected and the document stays loaded (unloading it before its batched save finished could
     *  rebuild it from the saved text, and reconnecting editors would then merge in a second copy of everything). */
    recheckAccess(noteId) {
      const doc = hocus.documents.get(noteId); if (!doc) return;
      for (const c of doc.getConnections()) {
        const user = c.context?.user; let note = null;
        try { note = user ? db.get('notes', noteId, user.id) : null; } catch { note = null; }
        if (!note) c.close({ code: 4403, reason: 'Access removed' });
        else if (note.access === 'view') c.readOnly = true;
      }
    },
  };
}
