export class DomainError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const badRequest = (message: string) => new DomainError(400, message);
export const forbidden = (message: string) => new DomainError(403, message);
export const notFound = (message: string) => new DomainError(404, message);
export const conflict = (message: string) => new DomainError(409, message);