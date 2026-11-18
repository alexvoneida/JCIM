// @vitest-environment node
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { validateXlsxPackage } from './xlsx-package'

async function workbookBytes(edit?: (workbook: ExcelJS.Workbook) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Data')
  sheet.addRow(['Name', 'Value'])
  sheet.addRow(['a', 1])
  edit?.(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function rewrite(
  bytes: Buffer,
  path: string,
  change: (xml: string) => string | null
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes)
  const changed = change(await zip.file(path)!.async('string'))
  if (changed === null) zip.remove(path)
  else zip.file(path, changed)
  return zip.generateAsync({ type: 'nodebuffer' })
}

it('accepts a workbook ExcelJS writes from scratch, including tables and filters', async () => {
  const bytes = await workbookBytes((workbook) => {
    const sheet = workbook.getWorksheet('Data')!
    sheet.autoFilter = 'A1:B2'
    sheet.mergeCells('A4:B4')
    workbook.addWorksheet('Listed').addTable({
      name: 'Listed',
      ref: 'A1',
      columns: [{ name: 'Name' }, { name: 'Value' }],
      rows: [['a', 1]]
    })
  })
  expect(await validateXlsxPackage(bytes)).toEqual([])
})

it('reports the sheetPr order ExcelJS writes when fit-to-page meets outline settings', async () => {
  // Excel discards a whole worksheet over this, which is how an imported tracker's
  // "Interview Scheduling" tab was lost from an export.
  const bytes = await workbookBytes((workbook) => {
    const sheet = workbook.getWorksheet('Data')!
    sheet.pageSetup.fitToPage = true
    sheet.properties.outlineProperties = { summaryBelow: false, summaryRight: false }
  })
  expect(await validateXlsxPackage(bytes)).toEqual([
    expect.stringMatching(/sheet1\.xml: <outlinePr> must come before <pageSetUpPr>/)
  ])
})

it('reports a table filter without a range and a column count that disagrees with the range', async () => {
  const bytes = await workbookBytes((workbook) => {
    workbook.addWorksheet('Listed').addTable({
      name: 'Listed',
      ref: 'A1',
      columns: [{ name: 'Name' }, { name: 'Value' }],
      rows: [['a', 1]]
    })
  })
  const broken = await rewrite(bytes, 'xl/tables/table1.xml', (xml) =>
    xml.replace(/<autoFilter ref="[^"]*"/, '<autoFilter').replace(/ref="A1:B2"/, 'ref="A1:C2"')
  )
  expect(await validateXlsxPackage(broken)).toEqual([
    expect.stringMatching(/table1\.xml: <autoFilter> is missing ref/),
    expect.stringMatching(/table1\.xml: ref A1:C2 spans 3 columns, not 2/)
  ])
})

it('reports malformed XML, missing parts, and dangling relationships', async () => {
  const bytes = await workbookBytes()
  const truncated = await rewrite(bytes, 'xl/worksheets/sheet1.xml', (xml) =>
    xml.slice(0, xml.length - 20)
  )
  expect(await validateXlsxPackage(truncated)).toEqual([
    expect.stringMatching(/^xl\/worksheets\/sheet1\.xml: /)
  ])
  const missing = await rewrite(bytes, 'xl/styles.xml', () => null)
  expect(await validateXlsxPackage(missing)).toEqual([
    expect.stringMatching(/lists missing part \/xl\/styles\.xml/),
    expect.stringMatching(/workbook\.xml\.rels: rId\d+ points to missing part xl\/styles\.xml/)
  ])
  expect(await validateXlsxPackage(Buffer.from('not a workbook'))).toEqual([
    expect.stringMatching(/^Not a zip archive/)
  ])
})

it('reports sheets that are unnamed, duplicated, unresolvable, or all hidden', async () => {
  const bytes = await workbookBytes((workbook) => workbook.addWorksheet('Second'))
  const broken = await rewrite(bytes, 'xl/workbook.xml', (xml) =>
    xml
      .replace(/name="Second"/, 'name="Data"')
      .replace(/state="visible"/g, 'state="hidden"')
      .replace(/<definedNames\/>|<\/sheets>/, (tag) =>
        tag === '</sheets>'
          ? '</sheets><definedNames><definedName name="_xlnm._FilterDatabase">Data!$A$1:$B$2</definedName></definedNames>'
          : tag
      )
  )
  expect(await validateXlsxPackage(broken)).toEqual([
    expect.stringMatching(/sheet name “Data” is repeated/),
    expect.stringMatching(/every sheet is hidden/),
    expect.stringMatching(/_xlnm\._FilterDatabase must be scoped/)
  ])
})
