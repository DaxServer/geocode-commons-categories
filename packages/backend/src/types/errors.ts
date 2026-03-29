export class NotFoundError extends Error {
  readonly _tag = 'NotFoundError'
  readonly status = 404
  constructor(message: string = 'Location not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class DatabaseError extends Error {
  readonly _tag = 'DatabaseError'
  readonly status = 500
  constructor(
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}
