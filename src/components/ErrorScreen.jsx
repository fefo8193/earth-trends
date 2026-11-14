import React from 'react';
export default function ErrorScreen({ onRetry, message = "We couldn’t load EarthTrends. Check your connection and try again." }) {
  return <div className="loading error-screen" role="alert">
    <div className="brand loading-brand"><b>Earth<span>Trends</span></b></div>
    <p>{message}</p><button className="retry-btn" type="button" onClick={onRetry}>Retry</button>
  </div>;
}
