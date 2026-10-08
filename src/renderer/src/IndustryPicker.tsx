import { useState } from 'react'

export const OTHER_INDUSTRY = '__other_industry__'

export default function IndustryPicker({
  bank,
  initial,
  name,
  multiple = false
}: {
  bank: string[]
  initial: string[]
  name: string
  multiple?: boolean
}) {
  const [selected, setSelected] = useState(initial)
  const label = multiple ? 'Industries of interest' : 'Industry'
  function toggle(value: string) {
    setSelected((current) =>
      current.includes(value) ? current.filter((i) => i !== value) : [...current, value]
    )
  }
  return (
    <div className="industry-picker">
      {multiple ? (
        <fieldset>
          <legend>{label}</legend>
          <p className="field-help">Choose all that apply.</p>
          <div className="industry-options">
            {[...bank, OTHER_INDUSTRY].map((value) => (
              <label key={value}>
                <input
                  type="checkbox"
                  name={name}
                  value={value}
                  checked={selected.includes(value)}
                  onChange={() => toggle(value)}
                />
                {value === OTHER_INDUSTRY ? 'Other — add an industry' : value}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <label>
          {label}
          <select
            name={name}
            aria-label={label}
            value={selected[0] ?? ''}
            onChange={(e) => setSelected(e.target.value ? [e.target.value] : [])}
          >
            <option value="">Not provided</option>
            {bank.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
            <option value={OTHER_INDUSTRY}>Other — add an industry</option>
          </select>
        </label>
      )}
      {selected.includes(OTHER_INDUSTRY) && (
        <label>
          New industry name
          <input name={`${name}-other`} placeholder="e.g. Renewable energy" />
        </label>
      )}
      <p className="field-help">
        Students and employers share these options. New industries become available to both when
        saved.
      </p>
    </div>
  )
}
