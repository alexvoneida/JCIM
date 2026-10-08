import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import type { Workspace, SheetResult } from '../shared/workspace'
import { fileError, readWorkbook, writeWorkspace, WorkbookIssue } from './workbook'

export async function parseSheet(): Promise<SheetResult<Workspace>> {
  let path = 'the selected workbook'
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Excel workbook (.xlsx)', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' }
    path = result.filePaths[0]
    if (extname(path).toLowerCase() !== '.xlsx')
      throw new WorkbookIssue({
        title: 'Unsupported file type',
        detail: `“${basename(path)}” is not an .xlsx workbook.`,
        fix: 'In Excel, use Save As → Excel Workbook (.xlsx), then import that file.'
      })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(path)
    const { workspace, warnings } = readWorkbook(workbook)
    const cacheFolder = join(app.getPath('userData'), 'imported-workbooks')
    await mkdir(cacheFolder, { recursive: true })
    const sourceSnapshotPath = join(cacheFolder, `${randomUUID()}.xlsx`)
    await copyFile(path, sourceSnapshotPath)
    return {
      status: 'success',
      data: {
        ...workspace,
        sourcePath: path,
        sourceSnapshotPath,
        sourceName: basename(path),
        importedAt: new Date().toISOString()
      },
      warnings
    }
  } catch (error) {
    return { status: 'error', error: fileError(error, 'import', path) }
  }
}

export async function exportSheet(
  event: IpcMainInvokeEvent,
  data: Workspace
): Promise<SheetResult<{ path: string }>> {
  let path = 'the export workbook'
  let temporaryPath: string | undefined
  try {
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent)
      throw new Error('The application window is unavailable. Reopen JCIM and try again.')
    const result = await dialog.showSaveDialog(parent, {
      defaultPath: 'JCIM-workspace.xlsx',
      filters: [{ name: 'Excel workbook (.xlsx)', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { status: 'cancelled' }
    path = result.filePath
    if (!extname(path)) path += '.xlsx'
    if (extname(path).toLowerCase() !== '.xlsx')
      throw new WorkbookIssue({
        title: 'Unsupported export file type',
        detail: 'The destination must end in .xlsx.',
        fix: 'Choose a filename such as JCIM-workspace.xlsx.'
      })
    if (data.sourcePath && resolve(path) === resolve(data.sourcePath))
      throw new WorkbookIssue({
        title: 'Choose a new export filename',
        detail: 'The destination is the original imported workbook.',
        fix: 'Use a different filename to keep the source tracker intact.'
      })
    const workbook = new ExcelJS.Workbook()
    const source = data.sourceSnapshotPath ?? data.sourcePath
    if (source) await workbook.xlsx.readFile(source)
    writeWorkspace(workbook, data)
    // Complete the workbook beside the destination before replacing any existing export.
    temporaryPath = join(dirname(path), `.jcim-${randomUUID()}.xlsx`)
    await workbook.xlsx.writeFile(temporaryPath)
    await rename(temporaryPath, path)
    return { status: 'success', data: { path }, warnings: [] }
  } catch (error) {
    return { status: 'error', error: fileError(error, 'export', path) }
  } finally {
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
