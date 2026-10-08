import { InterviewResult } from './interviewResult'

export class Student {
  name: string = ''
  interviewResults: InterviewResult[] = []
  school?: string
  grade?: string
  interests?: string[]

  constructor() {}

  addInterviewResult(result: InterviewResult) {
    this.interviewResults.push(result)
  }
}
