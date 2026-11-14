import React from 'react';
import { t } from '../lib/i18n.js';
export default function ErrorScreen({ onRetry, message }) {
  return <div className="loading error-screen" role="alert">
    <div className="brand loading-brand"><b>Earth<span>Trends</span></b></div>
    <p>{message || t('We couldn’t load EarthTrends. Check your connection and try again.')}</p><button className="retry-btn" type="button" onClick={onRetry}>{t('Retry')}</button>
  </div>;
}
