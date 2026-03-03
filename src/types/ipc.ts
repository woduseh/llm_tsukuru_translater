export interface AlertPayload {
  icon: 'error' | 'success' | 'warning' | 'info';
  message: string;
}

export interface ExtractArg {
  path: string;
  type?: string;
}

export interface ProgressPayload {
  now: number;
  max: number;
}

export interface SetPathPayload {
  type: string;
  dir: string;
}
