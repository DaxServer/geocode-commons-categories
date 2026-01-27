export class NotFoundError extends Error {
  readonly status = 404
  constructor(message: string = 'Location not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}
