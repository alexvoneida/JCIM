import type { Rating, MatchingInput, Assignment, MatchingResult } from './matching-types'

type Edge = {
  to: number
  rev: number
  capacity: number
  cost: number
}

function addEdge(
  graph: Edge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number
): Edge {
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

export function matchInternships(
  input: MatchingInput
): MatchingResult {
  const { companyLikes, studentRatings, companyCapacities } = input

  const students = Array.from(studentRatings.keys())
  const companies = Array.from(companyCapacities.keys())

  const source = 0
  const studentStart = 1
  const companyStart = studentStart + students.length
  const sink = companyStart + companies.length
  const graph: Edge[][] = Array.from(
    { length: sink + 1 },
    () => []
  )

  const studentIndex = new Map(
    students.map((student, i) => [student, studentStart + i])
  )

  const companyIndex = new Map(
    companies.map((company, i) => [company, companyStart + i])
  )

  // max internship per student is 1 ofc
  for (const student of students) {
    addEdge(graph, source, studentIndex.get(student)!, 1, 0)
  }

  // store the student company assingments
  const assignmentEdges: {
    student: string
    company: string
    rating: Rating
    edge: Edge
  }[] = []

  for (const student of students) {
    const ratings = studentRatings.get(student)!

    for (const company of companies) {
      const likedStudents = companyLikes.get(company) ?? []
      const rating = ratings.get(company)

      //students and companies must both want each other to be matched
      if (!likedStudents.includes(student) || rating === undefined) {
        continue
      }

      // to prioritize students that like the company 5-5 is a cost of 0
      const cost = 5 - rating

      const edge = addEdge(
        graph,
        studentIndex.get(student)!,
        companyIndex.get(company)!,
        1,
        cost
      )

      assignmentEdges.push({ student, company, rating, edge })
    }
  }

  // make sure the companies arent highering too many students
  for (const company of companies) {
    const capacity = Math.max(
      0,
      Math.floor(companyCapacities.get(company) ?? 0)
    )

    addEdge(graph, companyIndex.get(company)!, sink, capacity, 0)
  }

  // Find and send flow along the cheapest remaining path.
  // Bellman-Ford supports negative-cost reverse edges.
  while (true) {
    const distance = Array(graph.length).fill(Infinity) as number[]
    const previousNode = Array(graph.length).fill(-1) as number[]
    const previousEdge = Array(graph.length).fill(-1) as number[]

    distance[source] = 0

    for (let iteration = 0; iteration < graph.length - 1; iteration++) {
      let changed = false

      for (let from = 0; from < graph.length; from++) {
        if (distance[from] === Infinity) continue

        for (let edgeIndex = 0; edgeIndex < graph[from].length; edgeIndex++) {
          const edge = graph[from][edgeIndex]

          if (edge.capacity <= 0) continue

          const nextDistance = distance[from] + edge.cost

          if (nextDistance < distance[edge.to]) {
            distance[edge.to] = nextDistance
            previousNode[edge.to] = from
            previousEdge[edge.to] = edgeIndex
            changed = true
          }
        }
      }

      if (!changed) break
    }

    // if there is no more path then no more students can be matched
    if (previousNode[sink] === -1) break

    // Send one student along this path.
    for (let node = sink; node !== source; node = previousNode[node]) {
      const from = previousNode[node]
      const edge = graph[from][previousEdge[node]]

      edge.capacity -= 1
      graph[node][edge.rev].capacity += 1
    }
  }

  // A used assignment edge has no remaining forward capacity.
  const assignments: Assignment[] = assignmentEdges
    .filter(({ edge }) => edge.capacity === 0)
    .map(({ student, company, rating }) => ({
      student,
      company,
      rating
    }))

  const matchedStudents = new Set(
    assignments.map((assignment) => assignment.student)
  )

  return {
    assignments,
    unmatchedStudents: students.filter(
      (student) => !matchedStudents.has(student)
    ),
    totalRating: assignments.reduce(
      (total, assignment) => total + assignment.rating,
      0
    )
  }
}