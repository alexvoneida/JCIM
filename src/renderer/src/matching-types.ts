export type Rating = 1 | 2 | 3 | 4 | 5

export type JobRole = {
  id: string
  company: string
  title: string | null
  // A student fits a titled role when one of their interests matches a tag.
  tags: string[]
  capacity: number
}

export type MatchingInput = {
  companyLikes: Map<string, string[]>
  studentRatings: Map<string, Map<string, Rating>>
  roles: JobRole[]
  // Student -> interests. Used to decide which titled roles a student can fill.
  studentInterests: Map<string, string[]>
}

export type Assignment = {
  student: string
  company: string
  role?: string | null
  rating: Rating
}

export type MatchingResult = {
  assignments: Assignment[]
  unmatchedStudents: string[]
  totalRating: number
}
