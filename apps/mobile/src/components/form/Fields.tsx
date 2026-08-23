import Feather from '@expo/vector-icons/Feather';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The form controls, styled once so every editor looks like the same app.
 *
 * Each takes `error` and renders it below the control in the palette's
 * one legitimate red — a rejected value is exactly the punctuation case.
 */

function FieldShell({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      {children}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  multiline,
  keyboardType,
  autoCapitalize = 'sentences',
  editable = true,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  editable?: boolean;
  /** A fixed leading token, e.g. `@` or `$`. Part of the control, not the value. */
  prefix?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <View
        style={[
          styles.inputRow,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          !editable && styles.inputDisabled,
        ]}
      >
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          style={[styles.input, multiline && styles.inputMultiline]}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.fgMuted}
          accessibilityLabel={label}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={!keyboardType}
          editable={editable}
        />
      </View>
    </FieldShell>
  );
}

export function SwitchField({
  label,
  description,
  value,
  onChange,
  disabled,
  disabledNote,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Why it is locked — web shows this, and silence would read as a bug. */
  disabledNote?: string;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text style={[styles.switchLabel, disabled && styles.mutedText]}>{label}</Text>
        {description ? <Text style={styles.hint}>{description}</Text> : null}
        {disabled && disabledNote ? <Text style={styles.lockedNote}>{disabledNote}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: colors.inputBorder, true: colors.accent }}
        thumbColor={colors.fg}
        ios_backgroundColor={colors.inputBorder}
      />
    </View>
  );
}

/** Removable chips plus a free-text add — web's specialties control. */
export function ChipsField({
  label,
  values,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const trimmed = draft.trim();
    // Case-insensitive dedupe: "Traditional" and "traditional" are the
    // same specialty to a person, and two chips would look like a bug.
    if (!trimmed || values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, trimmed]);
    setDraft('');
  }

  return (
    <FieldShell label={label} hint={hint}>
      {values.length > 0 ? (
        <View style={styles.chips}>
          {values.map((v) => (
            <Pressable
              key={v}
              onPress={() => onChange(values.filter((x) => x !== v))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${v}`}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipLabel}>{v}</Text>
              <Feather name="x" size={12} color={colors.fgMuted} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder={placeholder}
          placeholderTextColor={colors.fgMuted}
          accessibilityLabel={`Add ${label}`}
          returnKeyType="done"
          autoCapitalize="words"
        />
        <Pressable
          onPress={add}
          disabled={!draft.trim()}
          accessibilityRole="button"
          accessibilityLabel={`Add ${label}`}
          hitSlop={8}
          style={({ pressed }) => [styles.addChip, !draft.trim() && styles.addChipOff, pressed && styles.pressed]}
        >
          <Feather name="plus" size={16} color={draft.trim() ? colors.accent : colors.fgMuted} />
        </Pressable>
      </View>
    </FieldShell>
  );
}

/** A checkbox list — web's Services Offered. */
export function CheckListField({
  label,
  options,
  selected,
  onChange,
  hint,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  hint?: string;
}) {
  return (
    <FieldShell label={label} hint={hint}>
      <View style={styles.checkList}>
        {options.length === 0 ? <Text style={styles.hint}>Your studio has no services set up yet.</Text> : null}
        {options.map((option) => {
          const on = selected.includes(option.id);
          return (
            <Pressable
              key={option.id}
              onPress={() => onChange(on ? selected.filter((x) => x !== option.id) : [...selected, option.id])}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
            >
              <View style={[styles.checkBox, on && styles.checkBoxOn]}>
                {on ? <Feather name="check" size={13} color={colors.accentFg} /> : null}
              </View>
              <Text style={[styles.checkLabel, on && styles.checkLabelOn]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </FieldShell>
  );
}

/** Mutually exclusive options — web's Flash Booking Review radios. */
export function RadioField<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: { value: T; label: string; description?: string }[];
  value: T;
  onChange: (next: T) => void;
  hint?: string;
}) {
  return (
    <FieldShell label={label} hint={hint}>
      <View style={styles.checkList}>
        {options.map((option) => {
          const on = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.radioRow, pressed && styles.pressed]}
            >
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
              <View style={styles.radioText}>
                <Text style={[styles.checkLabel, on && styles.checkLabelOn]}>{option.label}</Text>
                {option.description ? <Text style={styles.hint}>{option.description}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </FieldShell>
  );
}

export function FormDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  field: { gap: space.sm, paddingVertical: space.md },
  label: { ...type.label, color: colors.fgMuted },
  hint: { ...type.meta, color: colors.fgMuted },
  lockedNote: { ...type.meta, color: colors.accent, marginTop: 2 },
  error: { ...type.meta, color: colors.danger },
  mutedText: { color: colors.fgMuted },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: space.md,
  },
  inputFocused: { borderColor: colors.accent },
  inputError: { borderColor: colors.dangerStrong },
  inputDisabled: { opacity: 0.5 },
  prefix: { ...type.body, color: colors.fgMuted },
  input: { flex: 1, ...type.body, fontSize: 15, color: colors.fg, paddingVertical: space.md },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  switchText: { flex: 1, gap: 2 },
  switchLabel: { ...type.body, color: colors.fg },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  chipLabel: { ...type.small, color: colors.fgSecondary },
  addChip: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  addChipOff: { opacity: 0.4 },

  checkList: { gap: space.xs },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkLabel: { ...type.body, color: colors.fgSecondary, flex: 1 },
  checkLabelOn: { color: colors.fg },

  radioRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.accent },
  radioText: { flex: 1, gap: 2 },

  divider: { height: hairline, backgroundColor: colors.borderSoft },
  pressed: { opacity: 0.6 },
});
