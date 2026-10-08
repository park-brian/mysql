// M5.21 — JSON in the executor: a SQL value as JSON, the constructors, and
// `CAST(… AS JSON)`. The value itself, its text, its order and its binary form
// are `@myjs/types`' (json-doc.ts); what is here needs a value's *type* as
// well, which only the compiler knows:
//
//   - A boolean result — `TRUE`, `1 = 1`, `NOT x` — is JSON `true` or
//     `false`, where the integer 1 is `1` (8.4.11: `JSON_ARRAY(1, TRUE)` is
//     `[1, true]`).
//   - A binary string keeps the field type it came from as an opaque value:
//     15 for a VARBINARY or a literal, 254 for a BINARY, 252 for a BLOB, 16 for
//     a BIT (`"base64:type254:YWIA"`).
//   - A YEAR is an integer, an ENUM or SET its text.
import { FIELD_TYPE } from '@myjs/bytes'
import { sqlError } from '@myjs/protocol'
import {
  JSON_FALSE,
  JSON_NULL,
  JSON_TRUE,
  JsonSyntaxError,
  invalidJsonArgument,
  jsonObject,
  jsonValue,
  parseJson,
  toJsonDoc,
  toText,
  truth,
  type JsonDoc,
  type Value,
} from '@myjs/types'
import type { Compiled, Env, Row } from './compile.ts'
import { jsonType, type ResultType } from './meta.ts'
import { bitBytes } from './wire.ts'

/** A value of type `t` as JSON; SQL NULL is JSON null. */
export function asJson(v: Value, t: ResultType): JsonDoc {
  if (v === null) return JSON_NULL
  if (t.boolean === true && v.kind === 'int') return truth(v) === true ? JSON_TRUE : JSON_FALSE
  if (v.kind === 'bytes') return { t: 'opaque', field: opaqueField(t), v: v.v }
  if (t.field === FIELD_TYPE.BIT && v.kind === 'int') {
    // A BIT's bytes, big-endian, as many as its width needs.
    return { t: 'opaque', field: FIELD_TYPE.BIT, v: bitBytes(v.v, t.length) }
  }
  return toJsonDoc(v)
}

/** The field type a binary string's opaque JSON value names. */
function opaqueField(t: ResultType): number {
  if (t.field === FIELD_TYPE.STRING) return FIELD_TYPE.STRING
  if (t.field === FIELD_TYPE.BLOB || t.field === FIELD_TYPE.TINY_BLOB || t.field === FIELD_TYPE.MEDIUM_BLOB || t.field === FIELD_TYPE.LONG_BLOB) return FIELD_TYPE.BLOB
  return FIELD_TYPE.VARCHAR
}

/** `JSON_ARRAY(a, …)` and `JSON_OBJECT(k, v, …)`; `undefined` for another name. */
export function jsonConstructor(name: string, args: readonly Compiled[], callName: string): Compiled | undefined {
  if (name === 'JSON_ARRAY') {
    return {
      eval: (r, env) => jsonValue({ t: 'array', v: args.map((a) => asJson(a.eval(r, env), a.type)) }),
      type: jsonType(true),
    }
  }
  if (name === 'JSON_OBJECT') {
    if (args.length % 2 !== 0) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${callName}'`)
    return {
      eval: (r, env) => {
        const members: [string, JsonDoc][] = []
        for (let i = 0; i < args.length; i += 2) {
          const k = (args[i] as Compiled).eval(r, env)
          if (k === null) throw sqlError('ER_JSON_DOCUMENT_NULL_KEY', 'JSON documents may not contain NULL member names.')
          const v = args[i + 1] as Compiled
          members.push([toText(k), asJson(v.eval(r, env), v.type)])
        }
        return jsonValue(jsonObject(members))
      },
      type: jsonType(true),
    }
  }
  return undefined
}

/**
 * `CAST(x AS JSON)`: a JSON value as it is, a string parsed as a JSON text
 * (3141 naming `cast_as_json` when it is not one), and anything else converted
 * as an argument to a constructor is.
 */
export function castAsJson(inner: Compiled): Compiled {
  return {
    eval: (r: Row, env: Env) => {
      const v = inner.eval(r, env)
      if (v === null) return null
      if (v.kind === 'string') {
        try {
          return jsonValue(parseJson(v.v))
        } catch (e) {
          if (e instanceof JsonSyntaxError) throw invalidJsonArgument(e.message, e.position, 1, 'cast_as_json')
          throw e
        }
      }
      return jsonValue(asJson(v, inner.type))
    },
    type: jsonType(true),
  }
}
