import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Join Tailwind class names, letting later ones win (e.g. a focused state over the default). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
