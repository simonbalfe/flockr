import { errorStatus, type ErrorKind } from "@flockr/contracts"

export class BoardError extends Error {
  readonly status: (typeof errorStatus)[ErrorKind]

  constructor(
    readonly kind: ErrorKind,
    message: string,
  ) {
    super(message)
    this.status = errorStatus[kind]
  }
}

export const forbidden = (message: string) => new BoardError("forbidden", message)
export const notFound = (message: string) => new BoardError("not_found", message)
export const invalid = (message: string) => new BoardError("invalid", message)
export const notMember = (message: string) => new BoardError("not_member", message)
export const alreadyExists = (message: string) => new BoardError("already_exists", message)
export const wrongState = (message: string) => new BoardError("wrong_state", message)
export const staleClaim = (message: string) => new BoardError("stale_claim", message)
export const notHolder = (message: string) => new BoardError("not_holder", message)
export const unauthenticated = (message: string) => new BoardError("unauthenticated", message)
export const leaseExpired =(message: string) => new BoardError("lease_expired", message)
export const areaOverlap = (message: string) => new BoardError("area_overlap", message)
