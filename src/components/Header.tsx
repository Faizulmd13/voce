import React from 'react';

interface HeaderProps {
  category: string;
  title: string;
  action?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ category, title, action }) => {
  return (
    <div className="flex items-end justify-between pb-6 mb-6 border-b border-neutral-800/60">
      <div>
        <span className="text-xs font-mono uppercase tracking-widest text-neutral-500 block mb-1">
          {category}
        </span>
        <h1 className="text-2xl font-semibold text-neutral-100 tracking-tight">
          {title}
        </h1>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
};
