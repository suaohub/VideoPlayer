import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

interface ToolbarMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  align?: 'left' | 'right';
  onClose: () => void;
  children: ReactNode;
}

export function ToolbarMenu({ anchorRef, align = 'left', onClose, children }: ToolbarMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const updatePosition = () => {
      const padding = 8;
      const gap = 8;
      const rect = anchor.getBoundingClientRect();
      const below = Math.max(0, window.innerHeight - rect.bottom - gap - padding);
      const above = Math.max(0, rect.top - gap - padding);
      menu.style.maxHeight = `${Math.max(below, above)}px`;
      const { width, height } = menu.getBoundingClientRect();
      const left = align === 'right' ? rect.right - width : rect.left;
      menu.style.left = `${Math.max(padding, Math.min(left, window.innerWidth - width - padding))}px`;
      menu.style.top = `${height <= below || below >= above ? rect.bottom + gap : Math.max(padding, rect.top - height - gap)}px`;
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(anchor);
    observer.observe(menu);
    window.addEventListener('resize', updatePosition);
    // Capture scroll events from the horizontal toolbar and other ancestors.
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, align]);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !menuRef.current?.contains(target)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchorRef.current?.querySelector('button')?.focus({ preventScroll: true });
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [anchorRef, onClose]);

  // The toolbar scrolls horizontally, so its overflow also clips inline dropdowns.
  return createPortal(
    <div ref={menuRef} className={`toolbar-menu toolbar-menu-floating${align === 'right' ? ' toolbar-menu-right' : ''}`} role="menu">
      {children}
    </div>,
    document.body,
  );
}
