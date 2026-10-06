import { useState } from 'react'
import { matchInternships } from './matching'
import type { MatchingInput, Rating } from './matching-types'


const input: MatchingInput = {
  companyLikes: new Map([
    ["Mike's Hardware", [
      'John Smith',
      'Jane Doe',
      'Ernest Jones iv',
      'Leonard Williams',
      'Devon Witherspoon'
    ]],

    ['Target', [
      'John Smith',
      'Michael Wilson',
      'Sarah Miller'
    ]],

    ['Auto Shop', [
      'Jane Doe',
      'Ernest Jones iv',
      'David Anderson'
    ]],

    ['Best Buy', [
      'Leonard Williams',
      'Devon Witherspoon',
      'Michael Wilson',
      'Sarah Miller'
    ]]
  ]),

  studentRatings: new Map<string, Map<string, Rating>>([
    [
      'John Smith',
      new Map([
        ["Mike's Hardware", 5],
        ['Target', 3]
      ])
    ],

    [
      'Jane Doe',
      new Map([
        ["Mike's Hardware", 2],
        ['Auto Shop', 5]
      ])
    ],

    [
      'Ernest Jones iv',
      new Map([
        ["Mike's Hardware", 5],
        ['Auto Shop', 3]
      ])
    ],

    [
      'Leonard Williams',
      new Map([
        ["Mike's Hardware", 5],
        ['Best Buy', 3]
      ])
    ],

    [
      'Devon Witherspoon',
      new Map([
        ["Mike's Hardware", 5],
        ['Best Buy', 2]
      ])
    ],

    [
      'Michael Wilson',
      new Map([
        ['Target', 4],
        ['Best Buy', 5]
      ])
    ],

    [
      'Sarah Miller',
      new Map([
        ['Target', 2],
        ['Best Buy', 5]
      ])
    ],

    [
      'David Anderson',
      new Map([
        ['Auto Shop', 4]
      ])
    ]
  ]),

  companyCapacities: new Map([
    ["Mike's Hardware", 3],
    ['Target', 1],
    ['Auto Shop', 2],
    ['Best Buy', 2]
  ])
}




export default function InternshipMatching() {
  const [showMatches, setShowMatches] = useState(false)

  const result = showMatches
    ? matchInternships(input)
    : null

  return (
    <main>
      <h1>Internship Matching</h1>

      <div className="company-columns">
        {Array.from(input.companyLikes).map(([company, students]) => (
          <div className="company-column" key={company}>
            <h2>{company}</h2>

            {students.map((student) => {
              const rating = input.studentRatings
                .get(student)
                ?.get(company)

              return (
                <div className="student" key={student}>
                  <span>{student}</span>
                  <span>{rating}/5</span>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <button onClick={() => setShowMatches(true)}>
        Generate Matches
      </button>

      {result && (
  <section className="matches">
    <h2>Matched Students</h2>

    {Array.from(input.companyCapacities.keys()).map((company) => {
      const companyMatches = result.assignments.filter(
        (assignment) => assignment.company === company
      )

      return (
        <div className="company-matches" key={company}>
          <h3>{company}</h3>

          {companyMatches.length === 0 ? (
            <p>No students matched</p>
          ) : (
            companyMatches.map((assignment) => (
              <div className="match" key={assignment.student}>
                <span>{assignment.student}</span>
                <span>{assignment.rating}/5</span>
              </div>
            ))
          )}
        </div>
      )
    })}

    {result.unmatchedStudents.length > 0 && (
      <>
        <h3>Unmatched Students</h3>

        {result.unmatchedStudents.map((student) => (
          <p key={student}>{student}</p>
        ))}
      </>
    )}
  </section>
)}
    </main>
  )
}