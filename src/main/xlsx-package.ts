import JSZip from 'jszip'
import { SaxesParser } from 'saxes'

// ExcelJS happily reads back workbooks that Excel refuses or has to repair, so a load/read
// round trip proves nothing about a file. These checks cover what Excel validates on open:
// XML syntax, content types, relationships, and the element order and required attributes
// that ExcelJS has been seen to get wrong. An empty result means the package is sound.
export async function validateXlsxPackage(
  bytes: Buffer | Uint8Array | ArrayBuffer
): Promise<string[]> {
  const problems: string[] = []
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch (error) {
    return [`Not a zip archive: ${describe(error)}`]
  }
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir)
  const parts = new Map<string, XmlElement>()
  for (const path of paths) {
    if (!/\.(xml|rels)$/i.test(path)) continue
    const xml = await zip.file(path)!.async('string')
    try {
      parts.set(path, parseXml(xml))
    } catch (error) {
      problems.push(`${path}: ${describe(error)}`)
    }
  }
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml'])
    if (!paths.includes(required)) problems.push(`Missing part ${required}`)
  if (problems.length) return problems

  checkContentTypes(paths, parts.get('[Content_Types].xml')!, problems)
  const relationships = checkRelationships(paths, parts, problems)
  for (const [path, part] of parts) {
    checkBogusValues(path, part, problems)
    if (part.name === 'worksheet') checkWorksheet(path, part, relationships, parts, problems)
    if (part.name === 'table') checkTable(path, part, problems)
  }
  checkWorkbook(parts, relationships, problems)
  return problems
}

interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
}

type Relationships = Map<string, Map<string, { type: string; target: string }>>

const worksheetOrder = [
  'sheetPr',
  'dimension',
  'sheetViews',
  'sheetFormatPr',
  'cols',
  'sheetData',
  'sheetCalcPr',
  'sheetProtection',
  'protectedRanges',
  'scenarios',
  'autoFilter',
  'sortState',
  'dataConsolidate',
  'customSheetViews',
  'mergeCells',
  'phoneticPr',
  'conditionalFormatting',
  'dataValidations',
  'hyperlinks',
  'printOptions',
  'pageMargins',
  'pageSetup',
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'customProperties',
  'cellWatches',
  'ignoredErrors',
  'smartTags',
  'drawing',
  'legacyDrawing',
  'legacyDrawingHF',
  'drawingHF',
  'picture',
  'oleObjects',
  'controls',
  'webPublishItems',
  'tableParts',
  'extLst'
]
const sheetPrOrder = ['tabColor', 'outlinePr', 'pageSetUpPr']
const workbookOrder = [
  'fileVersion',
  'fileSharing',
  'workbookPr',
  'workbookProtection',
  'bookViews',
  'sheets',
  'functionGroups',
  'externalReferences',
  'definedNames',
  'calcPr',
  'oleSize',
  'customWorkbookViews',
  'pivotCaches',
  'smartTagPr',
  'smartTagTypes',
  'webPublishing',
  'fileRecoveryPr',
  'webPublishObjects',
  'extLst'
]
const requiredWorksheetAttributes: Record<string, string[]> = {
  autoFilter: ['ref'],
  mergeCell: ['ref'],
  conditionalFormatting: ['sqref'],
  dataValidation: ['sqref'],
  hyperlink: ['ref'],
  col: ['min', 'max'],
  tablePart: ['r:id']
}
const worksheetRelationship =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

function parseXml(xml: string): XmlElement {
  const parser = new SaxesParser()
  const document: XmlElement = { name: '', attributes: {}, children: [] }
  const open = [document]
  parser.on('opentag', (tag) => {
    const element: XmlElement = { name: tag.name, attributes: tag.attributes, children: [] }
    open[open.length - 1].children.push(element)
    open.push(element)
  })
  parser.on('closetag', () => open.pop())
  parser.write(xml).close()
  if (document.children.length !== 1) throw new Error('expected exactly one root element')
  return document.children[0]
}

function children(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name)
}

function* descendants(element: XmlElement): Generator<XmlElement> {
  for (const child of element.children) {
    yield child
    yield* descendants(child)
  }
}

function checkOrder(path: string, parent: XmlElement, order: string[], problems: string[]) {
  let latest = -1
  for (const child of parent.children) {
    const index = order.indexOf(child.name)
    if (index === -1) continue
    if (index < latest)
      problems.push(
        `${path}: <${child.name}> must come before <${order[latest]}> inside <${parent.name}>`
      )
    latest = Math.max(latest, index)
  }
}

function checkContentTypes(paths: string[], types: XmlElement, problems: string[]) {
  const defaults = new Set(
    children(types, 'Default').map((entry) => entry.attributes['Extension']?.toLowerCase())
  )
  const overrides = new Set(
    children(types, 'Override').map((entry) => entry.attributes['PartName'])
  )
  for (const override of overrides)
    if (!paths.includes(override.replace(/^\//, '')))
      problems.push(`[Content_Types].xml lists missing part ${override}`)
  for (const path of paths) {
    if (path === '[Content_Types].xml' || overrides.has(`/${path}`)) continue
    const extension = path.split('.').pop()!.toLowerCase()
    // Excel ignores workbook parts that only carry the generic application/xml type.
    if (!defaults.has(extension) || (extension === 'xml' && /^(xl|docProps)\//.test(path)))
      problems.push(`${path} has no content type`)
  }
}

function resolveTarget(folder: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const segments = folder ? folder.split('/') : []
  for (const segment of target.split('/')) {
    if (segment === '..') segments.pop()
    else if (segment && segment !== '.') segments.push(segment)
  }
  return segments.join('/')
}

function checkRelationships(
  paths: string[],
  parts: Map<string, XmlElement>,
  problems: string[]
): Relationships {
  const relationships: Relationships = new Map()
  for (const [path, part] of parts) {
    const match = /^(.*?)(?:^|\/)_rels\/([^/]+)\.rels$/.exec(path)
    if (!match) continue
    const folder = match[1]
    const source = match[2] === '' ? '' : folder ? `${folder}/${match[2]}` : match[2]
    const entries = new Map<string, { type: string; target: string }>()
    for (const relationship of children(part, 'Relationship')) {
      const { Id: id, Type: type, Target: target, TargetMode: mode } = relationship.attributes
      if (!id || !type || !target) {
        problems.push(`${path}: a relationship is missing Id, Type, or Target`)
        continue
      }
      if (entries.has(id)) problems.push(`${path}: relationship ${id} is listed twice`)
      if (mode === 'External') {
        entries.set(id, { type, target })
        continue
      }
      const resolved = resolveTarget(folder, target)
      if (!paths.includes(resolved))
        problems.push(`${path}: ${id} points to missing part ${resolved}`)
      entries.set(id, { type, target: resolved })
    }
    relationships.set(source, entries)
  }
  return relationships
}

function checkBogusValues(path: string, part: XmlElement, problems: string[]) {
  for (const element of descendants(part))
    for (const [name, value] of Object.entries(element.attributes))
      if (['undefined', 'null', 'NaN', '[object Object]'].includes(value))
        problems.push(`${path}: <${element.name}> has ${name}="${value}"`)
}

function checkWorksheet(
  path: string,
  sheet: XmlElement,
  relationships: Relationships,
  parts: Map<string, XmlElement>,
  problems: string[]
) {
  checkOrder(path, sheet, worksheetOrder, problems)
  for (const properties of children(sheet, 'sheetPr'))
    checkOrder(path, properties, sheetPrOrder, problems)
  for (const element of descendants(sheet)) {
    for (const attribute of requiredWorksheetAttributes[element.name] ?? [])
      if (!element.attributes[attribute])
        problems.push(`${path}: <${element.name}> is missing ${attribute}`)
    if (element.name === 'tablePart' && element.attributes['r:id']) {
      const target = relationships.get(path)?.get(element.attributes['r:id'])?.target
      if (!target || parts.get(target)?.name !== 'table')
        problems.push(`${path}: table ${element.attributes['r:id']} is not a table part`)
    }
  }
}

function columnCount(range: string): number | undefined {
  const match = /^\$?([A-Z]+)\$?\d+(?::\$?([A-Z]+)\$?\d+)?$/.exec(range)
  if (!match) return undefined
  const index = (letters: string) =>
    [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)
  return index(match[2] ?? match[1]) - index(match[1]) + 1
}

function checkTable(path: string, table: XmlElement, problems: string[]) {
  for (const attribute of ['id', 'name', 'displayName', 'ref'])
    if (!table.attributes[attribute]) problems.push(`${path}: <table> is missing ${attribute}`)
  for (const filter of children(table, 'autoFilter'))
    if (!filter.attributes['ref']) problems.push(`${path}: <autoFilter> is missing ref`)
  const columns = children(table, 'tableColumns').flatMap((list) => children(list, 'tableColumn'))
  const declared = children(table, 'tableColumns')[0]?.attributes['count']
  if (declared !== undefined && Number(declared) !== columns.length)
    problems.push(`${path}: tableColumns count ${declared} but ${columns.length} columns`)
  const width = table.attributes['ref'] && columnCount(table.attributes['ref'])
  if (width !== undefined && width !== columns.length)
    problems.push(
      `${path}: ref ${table.attributes['ref']} spans ${width} columns, not ${columns.length}`
    )
  const names = new Set<string>()
  for (const column of columns) {
    const name = column.attributes['name']
    if (!column.attributes['id'] || !name)
      problems.push(`${path}: <tableColumn> is missing id or name`)
    else if (names.has(name.toLowerCase()))
      problems.push(`${path}: column name “${name}” is repeated`)
    names.add((name ?? '').toLowerCase())
  }
}

function checkWorkbook(
  parts: Map<string, XmlElement>,
  relationships: Relationships,
  problems: string[]
) {
  const path = 'xl/workbook.xml'
  const workbook = parts.get(path)!
  checkOrder(path, workbook, workbookOrder, problems)
  const sheets = children(workbook, 'sheets').flatMap((list) => children(list, 'sheet'))
  if (!sheets.length) problems.push(`${path}: the workbook has no sheets`)
  const names = new Set<string>()
  const ids = new Set<string>()
  for (const sheet of sheets) {
    const { name, sheetId, 'r:id': relationshipId, state } = sheet.attributes
    if (!name || name.length > 31 || /[\\/?*[\]:]/.test(name))
      problems.push(`${path}: sheet name “${name ?? ''}” is empty, too long, or has \\ / ? * [ ] :`)
    else if (names.has(name.toLowerCase()))
      problems.push(`${path}: sheet name “${name}” is repeated`)
    names.add((name ?? '').toLowerCase())
    if (!sheetId || ids.has(sheetId))
      problems.push(`${path}: sheetId “${sheetId ?? ''}” is missing or repeated`)
    ids.add(sheetId ?? '')
    const relationship = relationshipId && relationships.get(path)?.get(relationshipId)
    if (
      !relationship ||
      relationship.type !== worksheetRelationship ||
      parts.get(relationship.target)?.name !== 'worksheet'
    )
      problems.push(`${path}: sheet “${name ?? ''}” does not point to a worksheet part`)
    if (state && !['visible', 'hidden', 'veryHidden'].includes(state))
      problems.push(`${path}: sheet “${name ?? ''}” has state “${state}”`)
  }
  if (
    sheets.length &&
    !sheets.some((sheet) => !sheet.attributes['state'] || sheet.attributes['state'] === 'visible')
  )
    problems.push(`${path}: every sheet is hidden`)
  for (const defined of children(workbook, 'definedNames').flatMap((list) =>
    children(list, 'definedName')
  ))
    if (
      defined.attributes['name'] === '_xlnm._FilterDatabase' &&
      !defined.attributes['localSheetId']
    )
      problems.push(`${path}: _xlnm._FilterDatabase must be scoped to a sheet with localSheetId`)
}
