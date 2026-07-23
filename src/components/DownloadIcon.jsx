import React from 'react';
import { IoCloudDownloadOutline } from 'react-icons/io5';

export default function DownloadIcon({ className = '', size = 18 }) {
  return (
    <IoCloudDownloadOutline
      aria-hidden="true"
      className={className}
      focusable="false"
      style={{ width: size, height: size, display: 'block', flex: '0 0 auto' }}
    />
  );
}
