import React from 'react';
import { t } from '../lib/i18n.js';

export default function LoadingScreen({ message }) {
  return (
    <div className="loading" role="status" aria-live="polite" aria-busy="true">
      <div className="brand loading-brand"><b>Earth<span>Trends</span></b></div>
      <div className="scanner" aria-hidden="true" />
      <p>{message || t('Loading satellite layers 0/4…')}</p>
    </div>
  );
}
