import { useEffect, useState } from 'react';
import { loadDocument } from '../api';

// Shows an entry's document in place: images inline, PDFs in a viewer, with
// Open and Download links. Pass `file` to preview a newly chosen file instead.
export default function DocumentPreview({ entryId, name, file }) {
  const [state, setState] = useState({ status: 'loading', url: '', type: '', name: name || '' });

  useEffect(() => {
    let url = '';
    let cancelled = false;
    const show = (blob, fileName) => {
      url = URL.createObjectURL(blob);
      if (!cancelled) setState({ status: 'ready', url, type: blob.type, name: fileName });
    };
    setState({ status: 'loading', url: '', type: '', name: name || '' });
    if (file) {
      show(file, file.name);
    } else {
      loadDocument(entryId, name)
        .then(({ blob, name: fileName }) => show(blob, fileName))
        .catch((error) => {
          if (!cancelled) setState({ status: 'error', url: '', type: '', name: name || '', error: error.message });
        });
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entryId, name, file]);

  const isImage = state.type.startsWith('image/');
  const isPdf = state.type === 'application/pdf';

  return (
    <div className="doc-preview">
      <div className="doc-preview-frame">
        {state.status === 'loading' && <div className="doc-preview-message doc-preview-loading">Loading preview…</div>}
        {state.status === 'error' && <div className="doc-preview-message">{state.error || 'Could not load the document.'}</div>}
        {state.status === 'ready' && isImage && (
          <a href={state.url} target="_blank" rel="noopener noreferrer" title="Open full size">
            <img src={state.url} alt={state.name || 'Document'} />
          </a>
        )}
        {state.status === 'ready' && isPdf && (
          <object data={state.url} type="application/pdf" aria-label={state.name || 'PDF document'}>
            <div className="doc-preview-message">This browser cannot show PDFs here. Use Open or Download.</div>
          </object>
        )}
        {state.status === 'ready' && !isImage && !isPdf && (
          <div className="doc-preview-message">No preview for this file type. Use Open or Download.</div>
        )}
      </div>
      <div className="doc-preview-bar">
        <span className="doc-preview-name" title={state.name}>📎 {state.name || 'Document'}</span>
        {state.status === 'ready' && (
          <span className="doc-preview-actions">
            <a className="btn btn-ghost action-btn" href={state.url} target="_blank" rel="noopener noreferrer">Open</a>
            <a className="btn btn-ghost action-btn" href={state.url} download={state.name || 'document'}>Download</a>
          </span>
        )}
      </div>
    </div>
  );
}
