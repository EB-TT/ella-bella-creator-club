import { coerce } from '../lib/fields'

/** One labelled, inline-editable control for a FIELDS entry. */
export function FieldInput({ field, value, onChange }) {
  const set = (raw) => onChange(coerce(field, raw))

  if (field.type === 'bool') {
    return (
      <div className={field.full ? 'field--full' : undefined}>
        <span className="label">{field.label}</span>
        <label className="check-row">
          <input
            type="checkbox"
            className="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {value ? 'Yes' : 'No'}
        </label>
      </div>
    )
  }

  if (field.type === 'enum' && !field.allowFreeText) {
    return (
      <div className={field.full ? 'field--full' : undefined}>
        <label className="label" htmlFor={field.key}>
          {field.label}
        </label>
        <select
          id={field.key}
          className="select"
          value={value || ''}
          onChange={(e) => set(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    )
  }

  // Free-text enums (Creator Tier) get suggestions but stay typeable.
  const listId = field.allowFreeText ? `${field.key}-options` : undefined
  const inputType =
    field.type === 'date' ? 'date' : field.type === 'int' || field.type === 'num' ? 'number' : 'text'

  return (
    <div className={field.full ? 'field--full' : undefined}>
      <label className="label" htmlFor={field.key}>
        {field.label}
      </label>
      <input
        id={field.key}
        className="input"
        type={inputType}
        step={field.type === 'num' ? '0.01' : undefined}
        list={listId}
        value={value ?? ''}
        onChange={(e) => set(e.target.value)}
      />
      {listId && (
        <datalist id={listId}>
          {field.options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </div>
  )
}
