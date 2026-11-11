import type { ComponentProps } from 'react';

/** Owned variants, following shadcn's composition model in the existing CSS stack. */
export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'; size?: 'sm' | 'md' | 'icon';
}) {
  return <button type={type} data-slot="button" data-variant={variant} data-size={size} className={`ui-button ${className}`} {...props} />;
}
export function Badge({ className = '', ...props }: ComponentProps<'span'>) {
  return <span data-slot="badge" className={`ui-badge ${className}`} {...props} />;
}
