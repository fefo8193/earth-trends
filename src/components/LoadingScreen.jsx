import React from 'react';

export default function LoadingScreen({ message = 'Loading satellite layers 0/4…' }) {
  return (
    <div className="loading" role="status" aria-live="polite" aria-busy="true">
      <div className="brand loading-brand"><b>Earth<span>Trends</span></b></div>
      <div className="scanner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
