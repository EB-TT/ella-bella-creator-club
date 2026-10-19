import { coerce } from '../lib/fields'
import { FieldLabel } from './SyncMarker'

function Hint({ field, note }) {
  const text = note || field.hint
  if (!text) return null
  return <span className="field-hint">{text}</span>
}

/** One labelled, inline-editable control for a FIELDS entry. `profiles` feeds
    the Owner dropdown. `synced`/`syncedAt` add the "Synced from TikTok" marker
    (for a field TikTok fills but that stays editable); `note` replaces the
    field's hint text; `allTime` labels a period-driven column as all-time. */
export function FieldInput({
  field,
  value,
  onChange,
  profiles = [],
  synced = false,
  syncedAt,
  note,
  allTime = false,
}) {
  const set = (raw) => onChange(coerce(field, raw))
  const label = (htmlFor) => (
    <FieldLabel field={field} htmlFor={htmlFor} synced={synced} syncedAt={syncedAt} allTime={allTime} />
  )

  if (field.type === 'bool') {
    return (
      <div className={field.full ? 'field--full' : undefined}>
        {label()}
        <label className="check-row">
          <input
            type="checkbox"
            className="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.checkLabel || (value ? 'Yes' : 'No')}
        </label>
        <Hint field={field} note={note} />
      </div>
    )
  }

  if (field.type === 'owner') {
    return (
      <div className={field.full ? 'field--full' : undefined}>
        {label(field.key)}
        <select
          id={field.key}
          className="select"
          value={value || ''}
          onChange={(e) => set(e.target.value)}
        >
          <option value="">Unassigned</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Hint field={field} note={note} />
      </div>
    )
  }

  if (field.type === 'enum') {
    return (
      <div className={field.full ? 'field--full' : undefined}>
        {label(field.key)}
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
        <Hint field={field} note={note} />
      </div>
    )
  }

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
        {label(field.key)}
        <textarea
          id={field.key}
          className="textarea"
          rows={3}
          value={value ?? ''}
          onChange={onText}
          onBlur={(e) => set(e.target.value)}
        />
        <Hint field={field} note={note} />
      </div>
    )
  }

  return (
    <div className={field.full ? 'field--full' : undefined}>
      {label(field.key)}
      <input
        id={field.key}
        className="input"
        type={inputType}
        step={field.type === 'num' ? '0.01' : undefined}
        value={value ?? ''}
        onChange={isText ? onText : (e) => set(e.target.value)}
        onBlur={isText ? (e) => set(e.target.value) : undefined}
      />
      <Hint field={field} note={note} />
    </div>
  )
}
