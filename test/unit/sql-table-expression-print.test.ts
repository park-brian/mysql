import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_TYPE } from '@myjs/bytes'
import type { ColumnDef } from '@myjs/engine'
import { checkClause } from '../../packages/core/src/sql/checks.ts'
import { printGeneration } from '../../packages/core/src/sql/generated.ts'

const column = (charset?: unknown): ColumnDef => ({name:'g',type:{type:FIELD_TYPE.LONG},nullable:true,attributes:charset === undefined ? {} : {generatedCharset:charset}})

test('table printers retain distinct unsupported-expression and parse-error fallbacks', () => {
  const text = "CONCAT('é',?)"
  const check = {name:'ck',text,enforced:true,charset:'utf8mb4'}
  assert.equal(printGeneration(column('utf8mb4'),{text,stored:false}),text)
  assert.equal(printGeneration(column('utf8mb4'),{text,stored:false},true),"CONCAT(\\'é\\',?)")
  assert.equal(checkClause(check),text)
  assert.equal(checkClause(check,false),text)
  assert.throws(() => printGeneration(column(),{stored:false,text:'CONCAT('}))
  assert.equal(checkClause({...check,text:'CONCAT('}),'CONCAT(')
})

test('generation source ownership preserves defaults, legacy text and complete UTF-8 bytes', () => {
  for (const charset of [undefined,123,'utf8mb4']) {
    assert.equal(printGeneration(column(charset),{stored:false,text:"'é'"}),"_utf8mb4'é'")
    assert.equal(printGeneration(column(charset),{stored:false,text:"'é'"},true),"_utf8mb4\\'Ã©\\'")
  }
  assert.equal(printGeneration(column('latin1'),{stored:false,text:"'é'"},true),"_latin1\\'é\\'")
  assert.equal(printGeneration(column('utf8mb3'),{stored:false,text:"'é'"},true),"_utf8mb3\\'Ã©\\'")
  assert.equal(printGeneration(column('utf8mb4'),{stored:false,text:"_latin1'é'"},true),"_latin1\\'Ã©\\'")
  const large = 'é'.repeat(70000)
  assert.equal(printGeneration(column('utf8mb4'),{stored:false,text:"'"+large+"'"},true),"_utf8mb4\\'"+'Ã©'.repeat(70000)+"\\'")
})
