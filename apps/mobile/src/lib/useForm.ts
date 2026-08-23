import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * A deliberately thin form layer — ours, not a library.
 *
 * The app had no multi-field editing before this, and the artist profile
 * needs ~30 controls across nine sections with a single save. What that
 * actually requires is small: controlled values, a dirty flag that
 * compares against what was loaded, per-field validation that runs on
 * save rather than on every keystroke, and a way to reset. A form library
 * would bring resolvers, refs and a schema DSL for a screen that needs
 * none of it, and would be the largest dependency in the app.
 *
 * Validation runs on submit, not per-keystroke, on purpose: an artist
 * typing an hourly rate should not be told "invalid" after the first
 * digit. Once a field HAS errored, it re-validates as they fix it, so
 * the message clears as soon as it is true again.
 */
export type Validator<T> = (values: T) => Partial<Record<keyof T, string>>;

export interface FormState<T extends Record<string, unknown>> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  /**
   * The one form-level message: a validation summary or a failed save.
   *
   * It lives here rather than in each screen's own useState so that it
   * can be cleared automatically the moment any field changes. A banner
   * reading "fix the highlighted fields" while nothing is highlighted any
   * more is a small lie, and one every editing screen would otherwise
   * have to remember not to tell.
   */
  formError: string | null;
  setFormError: (message: string | null) => void;
  dirty: boolean;
  /** Fields changed since load — what a per-section "edited" marker reads. */
  dirtyFields: (keyof T)[];
  setField: <K extends keyof T>(key: K, value: T[K]) => void;
  setFields: (patch: Partial<T>) => void;
  /** Runs the validator; returns true and clears errors when it passes. */
  validate: () => boolean;
  /** Back to the last loaded values, errors cleared. */
  reset: (next?: T) => void;
  /** Adopt server-returned values as the new clean baseline after a save. */
  commit: (next: T) => void;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => shallowEqual(v, b[i]));
  }
  return false;
}

export function useForm<T extends Record<string, unknown>>(
  initial: T,
  validator?: Validator<T>,
): FormState<T> {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * The clean baseline every dirty check is measured against.
   *
   * State, not a ref — deliberately, after a ref version shipped a bug:
   * `commit(form.values)` passes the SAME object back, so `setValues`
   * saw an unchanged reference, the dirty memo never recomputed, and a
   * successfully saved form went on showing "unsaved changes" with a live
   * Save button. Moving the baseline into state makes adopting a new one
   * a render-causing event, which is what it actually is.
   */
  const [baseline, setBaseline] = useState<T>(initial);
  const hasValidated = useRef(false);

  /**
   * The validator is held in a ref so the effect below can depend on
   * `values` alone. Depending on `validator` directly would turn an
   * inline arrow — the obvious thing for a caller to write — into an
   * infinite render loop: new identity each render, effect re-runs,
   * `setErrors` gets a fresh object, render again.
   */
  const validatorRef = useRef(validator);
  useEffect(() => {
    validatorRef.current = validator;
  });

  /**
   * Re-validation after the first save attempt, as an effect rather than
   * inside the `setValues` updater: a state updater must be pure, and
   * calling `setErrors` from inside one runs twice under StrictMode.
   * Before the first attempt `hasValidated` is false and this does
   * nothing, which is the "don't scold someone mid-typing" rule.
   */
  useEffect(() => {
    if (!hasValidated.current || !validatorRef.current) return;
    setErrors(validatorRef.current(values));
  }, [values]);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setFormError(null);
    setValues((current) => ({ ...current, [key]: value }));
  }, []);

  const setFields = useCallback((patch: Partial<T>) => {
    setFormError(null);
    setValues((current) => ({ ...current, ...patch }));
  }, []);

  const dirtyFields = useMemo(
    () => (Object.keys(values) as (keyof T)[]).filter((k) => !shallowEqual(values[k], baseline[k])),
    [values, baseline],
  );

  const validate = useCallback(() => {
    hasValidated.current = true;
    if (!validator) {
      setErrors({});
      return true;
    }
    const next = validator(values);
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [validator, values]);

  const reset = useCallback(
    (next?: T) => {
      const target = next ?? baseline;
      hasValidated.current = false;
      setBaseline(target);
      setValues(target);
      setErrors({});
      setFormError(null);
    },
    [baseline],
  );

  const commit = useCallback((next: T) => {
    hasValidated.current = false;
    setBaseline(next);
    setValues(next);
    setErrors({});
    setFormError(null);
  }, []);

  return {
    values,
    errors,
    formError,
    setFormError,
    dirty: dirtyFields.length > 0,
    dirtyFields,
    setField,
    setFields,
    validate,
    reset,
    commit,
  };
}

/**
 * Validation rules, mirroring what the API and web enforce.
 *
 * Kept as standalone functions so they are checkable without rendering,
 * and so the messages live in one place rather than beside each input.
 */
export const rules = {
  /** Dollars typed by a person, stored as cents. Blank is a legitimate "unset". */
  money(value: string, label: string): string | undefined {
    if (value.trim() === '') return undefined;
    const n = Number(value);
    if (Number.isNaN(n)) return `${label} must be a number.`;
    if (n < 0) return `${label} can't be negative.`;
    if (n > 100_000) return `${label} looks too large — check the amount.`;
    return undefined;
  },
  /** Whole minutes. The API stores an Int. */
  minutes(value: string, label: string): string | undefined {
    if (value.trim() === '') return undefined;
    const n = Number(value);
    if (Number.isNaN(n)) return `${label} must be a number.`;
    if (!Number.isInteger(n)) return `${label} must be a whole number of minutes.`;
    if (n < 0) return `${label} can't be negative.`;
    if (n > 480) return `${label} looks too large — that's over eight hours.`;
    return undefined;
  },
  email(value: string, label: string): string | undefined {
    if (value.trim() === '') return undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return `${label} doesn't look like an email address.`;
    return undefined;
  },
  url(value: string, label: string): string | undefined {
    if (value.trim() === '') return undefined;
    if (!/^https?:\/\/\S+$/i.test(value.trim())) return `${label} must start with http:// or https://`;
    return undefined;
  },
  maxLength(value: string, max: number, label: string): string | undefined {
    if (value.length > max) return `${label} is too long (${value.length} of ${max}).`;
    return undefined;
  },
};

/** Dollars string → cents, or null for blank. Matches web's Math.round(Number(x) * 100). */
export function dollarsToCents(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : Math.round(n * 100);
}

/** Cents → the dollars string an input shows. Blank for null. */
export function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return '';
  return String(cents / 100);
}
