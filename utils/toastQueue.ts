import type { Toast } from '../types';

export const appendUniqueToast = (toasts: Toast[], next: Toast): Toast[] =>
  toasts.some(toast => toast.message === next.message && toast.type === next.type)
    ? toasts
    : [...toasts, next];
