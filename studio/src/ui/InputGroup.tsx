import type { ComponentProps } from 'react';

/** Small owned input/addon primitives in the existing CSS stack. */
export function InputGroup({ className = '', ...props }: ComponentProps<'div'>) {
  return <div data-slot="input-group" className={`ui-input-group ${className}`} {...props} />;
}
export function InputAddon({ className = '', ...props }: ComponentProps<'span'>) {
  return <span data-slot="input-addon" className={`ui-input-addon ${className}`} aria-hidden="true" {...props} />;
}
