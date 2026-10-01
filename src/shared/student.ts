
import { InterviewResult } from './interviewResult'

export class Student {
    name: string = "";
    interviewResults: InterviewResult[] = [];

    constructor() {}

    addInterviewResult(result: InterviewResult) {
        this.interviewResults.push(result);
    }
}