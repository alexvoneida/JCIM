import { dialog } from 'electron'

import ExcelJS from 'exceljs';

import { Student } from '../shared/student';
import { InterviewResult } from '../shared/interviewResult';

export async function parseSheet() {
    // let the user select a file from their computer
    const dialogReturn = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
    });
    const chosenPath = dialogReturn.filePaths[0];

    // open that excel spreadsheet
    const file = new ExcelJS.Workbook();
    await file.xlsx.readFile(chosenPath);

    // parse sheet into Students
    const students: {[key: string] : Student} = {};

    // ingest student fit data. passed by ref, so no need to return
    ingestStudentFit(file, students);


    // ingest employer fit data. passed by ref, so no need to return
    ingestEmployerFit(file, students);

    
    // done
    return students;
}

function ingestStudentFit(file: ExcelJS.Workbook, students: {[key: string] : Student}) {
    
    // select the sheet with "student good fit" in the name
    const studentFitSheet = file.worksheets.find(sheet =>
        sheet.name.includes("Student Good Fit")
    );
    if (!studentFitSheet) throw Error("No student good fit sheet could be read.");

    // find what columns each wave starts in
    const waveColumns: {[key: number] : number} = {};
    studentFitSheet.getRow(2).eachCell((cell, colNum) => {
        if (cell.text.startsWith("Wave #")) {
            const waveNum = Number(cell.text.slice(6));
            if (waveNum in waveColumns) return; // already seen this wave
            waveColumns[waveNum] = colNum;
        }
    });
    

    let currentStudent: Student | undefined;

    for (const [waveNum, waveCol] of Object.entries(waveColumns)) { // loop through each wave
        studentFitSheet.getColumn(waveCol).eachCell((cell, rowNum) => { // in a wave, iterate down the rows
            if (cell.text === null || cell.text === "" || rowNum<3) return; // heading or blank

            const isStudent = currentStudent == undefined || isNaN(Number(cell.text));

            if (isStudent) { // this is a student name
                if (cell.text.trim() in students) {
                    currentStudent = students[cell.text.trim()];
                    return;
                }
                currentStudent = new Student();
                currentStudent.name = cell.text.trim();
                students[currentStudent.name] = currentStudent;
            } else { // if numeric, its an interview row
                if (studentFitSheet.getCell(rowNum, 1 + waveCol).text.trim() == "") return; // no business
                const result = new InterviewResult(currentStudent!.name,
                                                    waveNum,
                                                    studentFitSheet.getCell(rowNum, 1 + waveCol).text,
                                                    studentFitSheet.getCell(rowNum, 2 + waveCol).text,
                                                    studentFitSheet.getCell(rowNum, 3 + waveCol).text,
                                                    studentFitSheet.getCell(rowNum, 4 + waveCol).text,
                                                    studentFitSheet.getCell(rowNum, 5 + waveCol).text,
                                                    studentFitSheet.getCell(rowNum, 6 + waveCol).text);
                currentStudent!.addInterviewResult(result);
            }
        })
    }
}


function ingestEmployerFit(file: ExcelJS.Workbook, students: {[key: string] : Student}) {
    
    // select the sheet with "employer good fit" in the name
    const employerFitSheet = file.worksheets.find(sheet =>
        sheet.name.includes("Employer Good Fit")
    );
    if (!employerFitSheet) throw Error("No employer good fit sheet could be read.");


    let currentColumn = 2;
    let currentEmployer: string;
    while (true) {
        currentEmployer = employerFitSheet.getCell(2, currentColumn).text;
        if (currentEmployer == "") break;

        // find what indices the column headings are at. These are flexible because they sometimes have a blank notes coloumn, sometimes not.
        const colHeadings = [1,2,3,4].map(num => employerFitSheet.getCell(2, currentColumn+num).text);
        const transportIdx = colHeadings.findIndex(heading => heading == "Transportation");
        const skillsIdx = colHeadings.findIndex(heading => heading == "Skills");
        const positionsIdx = colHeadings.findIndex(heading => heading == "Positions");
        let notesIdx = colHeadings.findIndex(heading => heading == "Notes");
        if (notesIdx == -1) notesIdx = colHeadings.findIndex(heading => heading == "");

        // for each student in a column
        employerFitSheet.getColumn(currentColumn-1).eachCell((cell, rowNum) => {
            const student = students[cell.text.trim()];
            if (!student) return;

            // update their results variable to show employer results
            student.interviewResults.forEach((result: InterviewResult) => {
                if (result.business != currentEmployer) return;
                
                result.setEmployerData(employerFitSheet.getCell(rowNum, currentColumn).text, 
                                        employerFitSheet.getCell(rowNum, currentColumn+transportIdx).text, 
                                        employerFitSheet.getCell(rowNum, currentColumn+skillsIdx).text, 
                                        employerFitSheet.getCell(rowNum, currentColumn+positionsIdx).text,
                                        employerFitSheet.getCell(rowNum, currentColumn+notesIdx).text);
            });
        })


        currentColumn += (notesIdx == -1 ? 5 : 6);
    }
}