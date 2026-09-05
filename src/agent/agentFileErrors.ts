export class SandboxPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxPathError';
  }
}

export class SandboxReadLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxReadLimitError';
  }
}
