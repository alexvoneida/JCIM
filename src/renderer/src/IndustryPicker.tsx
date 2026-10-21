import { useState } from 'react'

export const OTHER_INDUSTRY = '__other_industry__'

export default function IndustryPicker({
  bank,
  initial,
  name,
  multiple = false,
  onRemove
}: {
  bank: string[]
  initial: string[]
  name: string
  multiple?: boolean
  onRemove?: (industry: string) => void
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
              <div className="industry-option" key={value}>
                <label>
                  <input
                    type="checkbox"
                    name={name}
                    value={value}
                    checked={selected.includes(value)}
                    onChange={() => toggle(value)}
                  />
                  {value === OTHER_INDUSTRY ? 'Other — add an industry' : value}
                </label>
                {onRemove && value !== OTHER_INDUSTRY && (
                  <button
                    type="button"
                    className="icon-button remove-industry"
                    aria-label={`Remove ${value} from all industries`}
                    onClick={() => onRemove(value)}
                  >
                    ×
                  </button>
                )}
              </div>
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
    </div>
  )
}
