
export type Rating = 1 | 2 | 3 | 4 | 5

export type MatchingInput = {
  // Company -> students the company likes
  companyLikes: Map<string, string[]>

  // Student -> company -> rating
  studentRatings: Map<string, Map<string, Rating>>

  // Company -> number of available internship slots
  companyCapacities: Map<string, number>
}

export type Assignment = {
  student: string
  company: string
  rating: Rating
}

export type MatchingResult = {
  assignments: Assignment[]
  unmatchedStudents: string[]
  totalRating: number
}