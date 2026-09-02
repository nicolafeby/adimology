import React from 'react';
import { formatMarketDate } from './date';

export function getDefaultDate(): string {
  const today = formatMarketDate();
  const date = new Date(`${today}T00:00:00Z`);

  // Broker Summary untuk hari berjalan belum tentu sudah dipublikasikan.
  // Gunakan hari kerja terakhir yang sudah selesai sebagai tanggal default.
  date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }

  return date.toISOString().slice(0, 10);
}

export function renderWithLinks(text: string | undefined): React.ReactNode {
  if (!text) return null;
  
  // Regex to match URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a 
          key={i} 
          href={part} 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ 
            color: 'var(--accent-primary)', 
            textDecoration: 'underline',
            wordBreak: 'break-all',
            cursor: 'pointer'
          }}
          className="link-hover"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}
