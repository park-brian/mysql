// myjs/server — doc 42's `serve()`: a database on a TCP port, for the `mysql`
// command-line client and anything else that dials one. Node only.
export { serve, isLoopback, InsecureBindError } from '@myjs/server'
export type { ServeOptions, Server } from '@myjs/server'
