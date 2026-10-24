export const MYSQL_VERSION: string
export const MYSQL_IMAGE: string
export const MYSQL_REFERENCE: {
  readonly version: string
  readonly revision: string
  readonly packages: readonly {
    readonly name: string
    readonly filename: string
    readonly url: string
    readonly sha256: string
  }[]
}
export function assertMysqlVersion(output: string, binary: string): string
export function assertMysqltestFiles(files: readonly string[], recorded: readonly string[]): void
