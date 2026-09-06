// M1.4 — the response discriminator, resolved by **length**, not byte value.
//
// Doc 10: "The `0xFE` ambiguity is real and must be resolved by length, not by
// byte value — `0xFE` is also the 8-byte prefix of a length-encoded integer."
// M1.4's acceptance assertion: a `0xFE` payload of >= 9 bytes parses as a
// length-encoded integer, not as EOF.
//
// Doc 13 adds a third overload the same dispatcher has to respect: in the
// *connection* phase `0xFE` is an AuthSwitchRequest, `0x01` is AuthMoreData
// and `0x02` is AuthNextFactor. "Note the header-byte overloading ... Context,
// not byte value, decides." So the phase is a parameter.

import { EOF_HEADER, ERR_HEADER, LOCAL_INFILE_HEADER, OK_HEADER } from './generic.ts'

/**
 * Which set of rules applies. The connection phase runs from HandshakeV10 to
 * the terminating OK/ERR; `COM_CHANGE_USER` re-enters it.
 */
export type Phase = 'connection' | 'command'

export const PACKET = {
  OK: 'ok',
  ERR: 'err',
  EOF: 'eof',
  /** A `COM_QUERY` response beginning `0xFB`: the server is asking for a file. */
  LOCAL_INFILE: 'local-infile',
  /** Anything else in the command phase: a length-encoded column count. */
  RESULTSET: 'resultset',
  AUTH_SWITCH: 'auth-switch',
  AUTH_MORE_DATA: 'auth-more-data',
  AUTH_NEXT_FACTOR: 'auth-next-factor',
  /** A zero-length payload — legal, and meaningful, in several places. */
  EMPTY: 'empty',
} as const

export type PacketKind = (typeof PACKET)[keyof typeof PACKET]

/** OK is only OK if the payload can actually hold its fixed fields. */
export const MIN_OK_PAYLOAD = 7
/** `0xFE` is EOF only below this length; at or above it, it is a lenenc prefix. */
export const MAX_EOF_PAYLOAD = 9

export function classify(payload: Uint8Array, phase: Phase = 'command'): PacketKind {
  if (payload.length === 0) return PACKET.EMPTY
  const first = payload[0] as number

  // ERR is unambiguous in both phases.
  if (first === ERR_HEADER) return PACKET.ERR

  if (phase === 'connection') {
    // OldAuthSwitchRequest is a bare 0xFE, so length does not discriminate
    // here; the phase does.
    if (first === EOF_HEADER) return PACKET.AUTH_SWITCH
    if (first === 0x01) return PACKET.AUTH_MORE_DATA
    if (first === 0x02) return PACKET.AUTH_NEXT_FACTOR
    if (first === OK_HEADER && payload.length >= MIN_OK_PAYLOAD) return PACKET.OK
    return PACKET.OK
  }

  if (first === OK_HEADER && payload.length >= MIN_OK_PAYLOAD) return PACKET.OK
  if (first === EOF_HEADER && payload.length < MAX_EOF_PAYLOAD) return PACKET.EOF
  if (first === LOCAL_INFILE_HEADER) return PACKET.LOCAL_INFILE
  // Either a genuine column count, or a 0xFE that is the 9-byte length-encoded
  // form of one — both are the head of a resultset.
  return PACKET.RESULTSET
}
