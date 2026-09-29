import { coerce } from '../lib/fields'

function Hint({ field }) {
  if (!field.hint) return null
  return <span className="field-hint">{field.hint}</span>
}

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
        <Hint field={field} />
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
        <Hint field={field} />
      </div>
    )
  }

  // Free-text enums (Creator Tier) get suggestions but stay typeable.
  const listId = field.allowFreeText ? `${field.key}-options` : undefined
  const inputType =
    field.type === 'date' ? 'date' : field.type === 'int' || field.type === 'num' ? 'number' : 'text'

  /* Text is kept exactly as typed and only trimmed on blur. coerce() trims, so
     running it per keystroke ate the space after "Jane" before "Doe" could
     follow — which made multi-word values impossible to type. */
  const isText = inputType === 'text'
  const onText = (e) => onChange(e.target.value === '' ? null : e.target.value)

  if (field.multiline) {
    return (
      <div className={field.full ? 'field--full' : undefined}>
        <label className="label" htmlFor={field.key}>
          {field.label}
        </label>
        <textarea
          id={field.key}
          className="textarea"
          rows={3}
          value={value ?? ''}
          onChange={onText}
          onBlur={(e) => set(e.target.value)}
        />
        <Hint field={field} />
      </div>
    )
  }

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
        onChange={isText ? onText : (e) => set(e.target.value)}
        onBlur={isText ? (e) => set(e.target.value) : undefined}
      />
      {listId && (
        <datalist id={listId}>
          {field.options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
      <Hint field={field} />
    </div>
  )
}
