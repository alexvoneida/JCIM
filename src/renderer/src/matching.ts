import type { Rating, MatchingInput, Assignment, MatchingResult, JobRole } from './matching-types'
import { canFillRole } from '../../shared/roles'

// Both sides must want the match, and a titled role also needs one of the
// student's interests to match the role's tags.
export function canFill(input: MatchingInput, student: string, role: JobRole): boolean {
  return (
    !!input.companyLikes.get(role.company)?.includes(student) &&
    input.studentRatings.get(student)?.has(role.company) === true &&
    canFillRole(input.studentInterests.get(student), role)
  )
}

type Edge = {
  to: number
  rev: number
  capacity: number
  cost: number
}

function addEdge(graph: Edge[][], from: number, to: number, capacity: number, cost: number): Edge {
  const forward: Edge = {
    to,
    rev: graph[to].length,
    capacity,
    cost
  }

  const reverse: Edge = {
    to: from,
    rev: graph[from].length,
    capacity: 0,
    cost: -cost
  }

  graph[from].push(forward)
  graph[to].push(reverse)

  return forward
}

export function matchInternships(input: MatchingInput): MatchingResult {
  const { studentRatings, roles } = input


  const students = Array.from(studentRatings.keys())

//create graph nodes for the algorithm
  const source = 0
  const studentStart = 1
  const roleStart = studentStart + students.length
  const sink = roleStart + roles.length

  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => [])

  const studentIndex = new Map(students.map((student, i) => [student, studentStart + i]))

  const roleIndex = new Map(roles.map((role, i) => [role.id, roleStart + i]))


  if (roleIndex.size !== roles.length) {
    throw new Error('Each job role must have a unique id.')
  }

  //only one internship per student max
  for (const student of students) {
    addEdge(graph, source, studentIndex.get(student)!, 1, 0)
  }

  const assignmentEdges: {
    student: string
    company: string
    role: string | null
    rating: Rating
    edge: Edge
  }[] = []

  for (const student of students) {
    const ratings = studentRatings.get(student)!

    for (const role of roles) {
      //check that students can go in that role
      if (!canFill(input, student, role)) {
        continue
      }

      const rating = ratings.get(role.company)!

      // Higher ratings have lower costs:
      // rating 5 -> cost 0
      // rating 4 -> cost 1
      // rating 3 -> cost 2
      // rating 2 -> cost 3
      // rating 1 -> cost 4
      const cost = 5 - rating

      const edge = addEdge(graph, studentIndex.get(student)!, roleIndex.get(role.id)!, 1, cost)

      assignmentEdges.push({
        student,
        company: role.company,
        role: role.title,
        rating,
        edge
      })
    }
  }

  // Each job role has its own hiring capacity.
  for (const role of roles) {
    const capacity = Math.max(0, Math.floor(role.capacity))

    addEdge(graph, roleIndex.get(role.id)!, sink, capacity, 0)
  }

  while (true) {
    const distance = Array(graph.length).fill(Infinity) as number[]

    const previousNode = Array(graph.length).fill(-1) as number[]

    const previousEdge = Array(graph.length).fill(-1) as number[]

    distance[source] = 0

    for (let iteration = 0; iteration < graph.length - 1; iteration++) {
      let changed = false

      for (let from = 0; from < graph.length; from++) {
        if (distance[from] === Infinity) {
          continue
        }

        for (let edgeIndex = 0; edgeIndex < graph[from].length; edgeIndex++) {
          const edge = graph[from][edgeIndex]

          if (edge.capacity <= 0) {
            continue
          }

          const nextDistance = distance[from] + edge.cost

          if (nextDistance < distance[edge.to]) {
            distance[edge.to] = nextDistance
            previousNode[edge.to] = from
            previousEdge[edge.to] = edgeIndex
            changed = true
          }
        }
      }

      if (!changed) {
        break
      }
    }

    if (previousNode[sink] === -1) {
      break
    }

    for (let node = sink; node !== source; node = previousNode[node]) {
      const from = previousNode[node]
      const edge = graph[from][previousEdge[node]]

      edge.capacity -= 1
      graph[node][edge.rev].capacity += 1
    }
  }

  const assignments: Assignment[] = assignmentEdges
    .filter(({ edge }) => edge.capacity === 0)
    .map(({ student, company, role, rating }) => ({
      student,
      company,
      role,
      rating
    }))

  const matchedStudents = new Set(assignments.map((assignment) => assignment.student))

  const unmatchedStudents = students.filter((student) => !matchedStudents.has(student))

  const totalRating = assignments.reduce((total, assignment) => total + assignment.rating, 0)

  return {
    assignments,
    unmatchedStudents,
    totalRating
  }
}
