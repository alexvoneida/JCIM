import { dialog, ipcMain } from 'electron'
import { IpcChannel } from '../shared/api'

import ExcelJS from 'exceljs';

export function registerExcelHandelers() {
    ipcMain.handle(IpcChannel.parseSheet, async () => {
        const dialogReturn = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
        });
        const chosenPath = dialogReturn.filePaths[0];

        const file = new ExcelJS.Workbook();
        await file.xlsx.readFile(chosenPath);
        const studentInterestSheet = file.worksheets.find(sheet =>
            sheet.name.includes("Student Interest")
        );
        
        return studentInterestSheet?.getCell(2, 2).text;
    })
}